import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WorldModel } from "../vendor/world-model/reference/src/index.ts";
import { Markovian } from "../vendor/markovian/reference/src/index.ts";
import {
  AppError,
  TABLES,
  validateMission,
  plans,
  checkAllocations,
  type Table,
  type Row,
  type Snapshot,
  type Mission,
  type Order,
  type Allocation,
  type Evidence,
} from "./domain.ts";
import { Sources, hash } from "./sources.ts";
import { Store } from "./store.ts";
import { Nightshift, zetaris, normalizeRows } from "./providers.ts";
import { config, safeMessage } from "./config.ts";
export class Engine {
  world: WorldModel;
  running = new Set<string>();
  pending = new Map<string, Promise<void>>();
  lastSourceHash = "";
  constructor(
    public sources: Sources,
    public store: Store,
    public mode: "sample" | "live",
    public directory: string,
  ) {
    this.world = new WorldModel({
      namespace: "aftershock",
      storage: "local",
      directory,
      conflictPolicy: "most-recent-wins",
    });
    for (const m of store.missions())
      if (m.status === "planning") {
        m.status = "blocked";
        m.reason = "Process restarted during planning. Retry this mission.";
        store.saveMission(m);
      }
  }
  async observe(
    table: Table,
    traceId: string,
  ): Promise<{ rows: Row[]; evidence: Evidence[] }> {
    const query = `SELECT * FROM ${config.database}.${table}`;
    const rows =
      this.mode === "live"
        ? normalizeRows(table, await zetaris(query))
        : this.sources.read(table);
    if (rows.length === 0)
      throw new AppError("EMPTY_SOURCE", `No ${table} records returned.`, 503);
    const observedAt = new Date().toISOString();
    const evidence: Evidence[] = [];
    for (const row of rows) {
      const fingerprint = hash(row),
        old = this.world.view("graph").entity(`${table}:ops:${row.id}`);
      if (old?.attrs.hash !== fingerprint) {
        await this.world.upsertEntity({
          type: table,
          externalKey: { system: "ops", id: row.id },
          name: row.name,
          attrs: { ...row, hash: fingerprint },
          source: {
            kind: this.mode === "live" ? "zetaris" : "sample",
            at: observedAt,
            by: "Cartographer",
            runId: traceId,
            checksum: fingerprint,
          },
        });
      }
      evidence.push({
        table,
        id: row.id,
        version: row.version,
        hash: fingerprint,
        observedAt,
        source:
          this.mode === "live"
            ? `zetaris:${config.database}.${table}`
            : `sample:${table}`,
        query: this.mode === "live" ? query : "local fixture read",
      });
    }
    this.store.trace(
      traceId,
      "Cartographer",
      this.mode === "live" ? "zetaris_query" : "sample_source_read",
      {
        table,
        rows: rows.length,
        query: this.mode === "live" ? query : undefined,
        versions: rows.map((r) => ({ id: r.id, version: r.version })),
        provider:
          this.mode === "live" ? "Zetaris" : "local deterministic sample",
      },
      "Planner",
    );
    // Planner reads the Meterless World Model projection, not the raw query result.
    const projected = rows.map((row) => {
      const attrs = {
        ...this.world.view("graph").entity(`${table}:ops:${row.id}`)!.attrs,
      };
      delete attrs.hash;
      return attrs as Row;
    });
    return { rows: projected, evidence };
  }
  create(input: unknown): Mission {
    const clean = validateMission(input);
    for (const d of clean.demands)
      if (!this.sources.read("shelters").some((s) => s.id === d.shelterId))
        throw new AppError(
          "UNKNOWN_SHELTER",
          `Unknown shelter ${d.shelterId}.`,
        );
    const existing = this.store
      .missions()
      .find((m) => m.idempotencyKey === clean.idempotencyKey);
    if (existing) {
      if (
        JSON.stringify(existing.demands) !== JSON.stringify(clean.demands) ||
        existing.deadlineMinutes !== clean.deadlineMinutes
      )
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This key was already used for different mission inputs.",
          409,
        );
      return existing;
    }
    const now = new Date(),
      id = "mission-" + randomUUID();
    const m: Mission = {
      ...clean,
      id,
      createdAt: now.toISOString(),
      deadlineAt: new Date(
        now.getTime() + clean.deadlineMinutes * 60000,
      ).toISOString(),
      status: "queued",
      reason: "Awaiting evidence investigation",
      traceId: id,
      mode: this.mode,
    };
    this.store.saveMission(m);
    this.schedule(id);
    return m;
  }
  schedule(id: string) {
    if (this.running.has(id)) return;
    this.running.add(id);
    const task = this.plan(id)
      .catch((e) => {
        const m = this.store.mission(id)!;
        m.status = "blocked";
        m.reason = safeMessage(e);
        this.store.saveMission(m);
        this.store.trace(m.traceId, "Orchestrator", "error", {
          code: e instanceof AppError ? e.code : "INTERNAL",
          message: m.reason,
        });
      })
      .finally(() => {
        this.running.delete(id);
        this.pending.delete(id);
      });
    this.pending.set(id, task);
  }
  async idle() {
    while (this.pending.size) await Promise.all([...this.pending.values()]);
  }
  async plan(id: string) {
    const m = this.store.mission(id)!;
    if (Date.parse(m.deadlineAt) <= Date.now()) {
      this.store.transaction(() => {
        for (const o of this.store
          .orders()
          .filter(
            (o) =>
              o.missionId === id && ["reserved", "held"].includes(o.status),
          )) {
          o.status = "cancelled";
          o.reason = "Mission deadline expired before departure.";
          this.store.saveOrder(o);
        }
        m.status = "expired";
        m.reason =
          "Arrival deadline passed. Create a new mission with a new deadline.";
        this.store.saveMission(m);
      });
      this.store.trace(m.traceId, "Executor", "expired", { missionId: id });
      return;
    }
    m.status = "planning";
    m.reason = "Investigating current source records";
    this.store.saveMission(m);
    const provider = new Nightshift();
    let evidence: Evidence[] = [];
    const snapshot = {} as Snapshot;
    for (const table of TABLES.filter((t) => t !== "maintenance")) {
      const result = await this.observe(table, m.traceId);
      snapshot[table] = result.rows;
      evidence.push(...result.evidence);
    }
    snapshot.maintenance = [];
    const retained = this.store.busy().filter((o) => o.missionId === id);
    const demands = m.demands
      .map((d) => ({
        ...d,
        kits: Math.max(
          0,
          d.kits -
            retained
              .filter((o) => o.shelterId === d.shelterId)
              .reduce((n, o) => n + o.kits, 0),
        ),
      }))
      .filter((d) => d.kits > 0);
    if (!demands.length) {
      m.status = "committed";
      m.reason = "All requested kits already have valid commitments.";
      this.store.saveMission(m);
      return;
    }
    if (this.mode === "live") {
      const map = await provider.json(
        "Cartographer",
        'Inspect only the inventory and vehicle clearance evidence. Return at most three short factual concerns citing IDs, and the next source to consult, as {"concerns":["..."],"nextSource":"maintenance"}. Do not solve routes or allocate vehicles; the Planner does that next. Missing clearance records mean clearance is unknown, not that a vehicle is unsafe.',
        {
          inventory: snapshot.inventory,
          fleet: snapshot.fleet,
          maintenance: snapshot.maintenance,
          demands,
        },
      );
      this.store.trace(
        m.traceId,
        "Cartographer",
        "assess_evidence",
        map,
        "Planner",
      );
    }
    let selected: Allocation[] | undefined;
    let shortfall = 0;
    let learned = false;
    let failure = "";
    const markovian = new Markovian({
      chunkConfig: {
        chunkSize: 4000,
        maxChunks: 3,
        carryoverTokens: 256,
        overlapTokens: 0,
      },
    });
    const chain = await markovian.run({
      goal: `Reserve relief kits for mission ${id}. Preserve existing valid orders. Deadline ${m.deadlineAt}.`,
      reflect: false,
      stepFn: async ({ step, carryover }) => {
        this.store.trace(m.traceId, "Markovian", "resume", {
          step,
          carryover,
          mode: this.mode,
          exactConstraints:
            "Re-read from structured world state; never from compressed text.",
        });
        const options = plans(
          snapshot,
          demands,
          this.store.busy(),
          m.deadlineAt,
        );
        const minimal = Math.min(...options.map((p) => p.shortfall));
        const eligible = options.filter((p) => p.shortfall === minimal);
        let choice = eligible[0],
          reason =
            "Deterministic sample policy: satisfy demand, then minimize travel time.";
        if (this.mode === "live") {
          const result = await provider.json(
            "Planner",
            'Choose one provided option ID. Do not alter quantities or IDs. Prefer satisfying all demand, then shortest total travel. Return {"optionId":"option-1","reason":"brief explanation"}.',
            {
              demands,
              deadlineAt: m.deadlineAt,
              options: eligible,
              carryover,
              exclusions: snapshot.maintenance.filter((v) => v.hold),
            },
          );
          const found = eligible.find((p) => p.id === result.optionId);
          if (!found)
            throw new AppError(
              "INVALID_PROPOSAL",
              "Planner returned an unknown option. No action committed.",
              503,
            );
          choice = found;
          reason = String(result.reason || "Selected candidate");
        }
        this.store.trace(
          m.traceId,
          "Planner",
          "propose",
          {
            step,
            ...choice,
            reason,
            policy:
              this.mode === "sample"
                ? "deterministic search"
                : "Nightshift model selection",
          },
          "Challenger",
        );
        if (!learned) {
          this.store.trace(
            m.traceId,
            "Challenger",
            "request_evidence",
            {
              table: "maintenance",
              reason:
                "Roster availability alone does not establish current vehicle clearance.",
            },
            "Cartographer",
          );
          const found = await this.observe("maintenance", m.traceId);
          snapshot.maintenance = found.rows;
          evidence.push(...found.evidence);
          learned = true;
          for (const v of found.rows) {
            const vehicle = snapshot.fleet.find((f) => f.id === v.id);
            if (vehicle) vehicle.excluded = !!v.hold;
            await this.world.assertFact({
              about: `fleet:ops:${v.id}`,
              predicate: "excluded",
              value: !!v.hold,
              confidence: 1,
              source: {
                kind: "maintenance",
                at: new Date().toISOString(),
                by: "Cartographer",
                runId: m.traceId,
              },
            });
            await this.world.upsertEntity({
              type: "fleet",
              externalKey: { system: "ops", id: v.id },
              attrs: { excluded: !!v.hold, exclusionVersion: v.version },
              source: {
                kind: "maintenance",
                at: new Date().toISOString(),
                by: "Cartographer",
                runId: m.traceId,
              },
            });
          }
          this.store.trace(
            m.traceId,
            "Cartographer",
            "reconcile",
            {
              conflicts: found.rows
                .filter((v) => v.hold)
                .map((v) => ({
                  vehicle: v.id,
                  rosterAvailable: snapshot.fleet.find((f) => f.id === v.id)
                    ?.available,
                  hold: v.hold,
                  version: v.version,
                })),
              source: "Current maintenance ledger",
            },
            "Challenger",
          );
        }
        const errors = checkAllocations(
          snapshot,
          choice.allocations,
          this.store.busy(),
          m.deadlineAt,
        );
        if (
          plans(snapshot, demands, this.store.busy(), m.deadlineAt)[0]
            .shortfall < choice.shortfall
        )
          errors.push(
            "New clearance evidence permits more demand to be served; revise the proposal.",
          );
        let verdict = {
          decision: errors.length ? "revise" : "approve",
          reason: errors.join("; ") || "All explicit preconditions passed.",
        };
        if (this.mode === "live") {
          const review = await provider.json(
            "Challenger",
            'Review only remainingDemands against this proposal. preservedOrders already satisfy other demand and must not be reallocated. Source shelter demand is context, not a new mission request. Any failed check requires revise. A declared shortfall is allowed when no candidate satisfies all remaining demand. Request revision for unsupported claims. Return {"decision":"approve" or "revise","reason":"brief evidence-backed reason"}.',
            {
              proposal: choice,
              remainingDemands: demands,
              preservedOrders: retained,
              checks: errors,
              maintenance: snapshot.maintenance,
              deadlineAt: m.deadlineAt,
            },
          );
          if (!["approve", "revise"].includes(review.decision))
            throw new AppError(
              "INVALID_REVIEW",
              "Challenger returned an invalid decision.",
              503,
            );
          verdict = {
            decision: errors.length ? "revise" : review.decision,
            reason: String(review.reason || verdict.reason),
          };
        }
        if (verdict.decision === "revise") {
          failure = errors.join("; ") || verdict.reason;
          this.store.trace(
            m.traceId,
            "Challenger",
            "reject",
            { errors, reason: verdict.reason },
            "Planner",
          );
          return {
            content: `Proposal rejected: ${failure}\n[STATE_CHECKPOINT]\n${JSON.stringify({ mission: id, step, next: "revise", excluded: snapshot.maintenance.filter((v) => v.hold).map((v) => v.id), reason: failure.slice(0, 250) })}`,
          };
        }
        shortfall = choice.shortfall;
        selected = choice.allocations;
        this.store.trace(
          m.traceId,
          "Challenger",
          "approve",
          {
            checks: [
              "stock",
              "capacity",
              "availability",
              "maintenance",
              "route continuity",
              "arrival deadline",
            ],
            reason: verdict.reason,
            shortfall,
          },
          "Executor",
        );
        return {
          content: `Approved ${selected.length} allocations; shortfall ${shortfall}. [TASK_COMPLETE]`,
        };
      },
    });
    m.usage = provider.usage;
    m.engine = {
      name: "Meterless Markovian",
      status: chain.status,
      chunks: chain.chunks,
      chunkConfig: chain.chunkConfig,
      durationMs: chain.durationMs,
      accounting:
        "Engine estimates cover chunk text only. Provider usage below covers every model call. No measured savings claim.",
    };
    mkdirSync(path.join(this.directory, "chains"), { recursive: true });
    writeFileSync(
      path.join(this.directory, "chains", id + "-" + Date.now() + ".json"),
      JSON.stringify(
        { missionId: id, chain, providerUsage: provider.usage },
        null,
        2,
      ),
    );
    if (!selected) {
      this.store.trace(m.traceId, "Orchestrator", "blocked", {
        error: failure || chain.error || "No approved plan",
      });
      m.status = "blocked";
      m.reason =
        failure ||
        chain.error ||
        "Bounded investigation ended without approval.";
      this.store.saveMission(m);
      return;
    }
    // Re-fetch through the sponsor before committing; then compare with authoritative local sources inside the transaction.
    if (this.mode === "live")
      for (const table of TABLES) {
        const fresh = await this.observe(table, m.traceId);
        for (const old of evidence.filter((e) => e.table === table))
          if (fresh.evidence.find((e) => e.id === old.id)?.hash !== old.hash)
            throw new AppError(
              "STALE_EVIDENCE",
              "Source changed during planning. Retry with current evidence.",
              409,
            );
        // Unchanged facts were just verified again; retain that observation time.
        evidence = evidence
          .filter((e) => e.table !== table)
          .concat(fresh.evidence);
      }
    const finalPlan = selected;
    this.store.transaction(() => {
      const now = Date.now(),
        current = this.sources.snapshot();
      for (const e of evidence) {
        if (
          hash(current[e.table].find((r) => r.id === e.id)) !== e.hash ||
          now - Date.parse(e.observedAt) > config.freshnessMs
        )
          throw new AppError(
            "STALE_EVIDENCE",
            "Evidence changed or expired before reservation.",
            409,
          );
      }
      const problems = checkAllocations(
        current,
        finalPlan,
        this.store.busy(),
        m.deadlineAt,
      );
      if (problems.length)
        throw new AppError("RESERVATION_CONFLICT", problems.join("; "), 409);
      const held = this.store
        .orders()
        .filter((o) => o.missionId === id && o.status === "held");
      for (const allocation of finalPlan) {
        const deps = evidence.filter(
          (e) =>
            (e.table === "inventory" && e.id === allocation.depotId) ||
            (e.table === "shelters" && e.id === allocation.shelterId) ||
            (["fleet", "maintenance"].includes(e.table) &&
              e.id === allocation.vehicleId) ||
            (e.table === "roads" && allocation.routeIds.includes(e.id)),
        );
        const o: Order = {
          ...allocation,
          id: "dispatch-" + randomUUID(),
          missionId: id,
          status: "reserved",
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 15 * 60000).toISOString(),
          deadlineAt: m.deadlineAt,
          evidence: deps,
          checks: [
            "stock",
            "capacity",
            "availability",
            "maintenance",
            "route",
            "deadline",
            "source versions",
          ],
          reason:
            "Preconditions checked against current authoritative sandbox state.",
          supersedes: held.find((x) => x.shelterId === allocation.shelterId)
            ?.id,
        };
        this.store.saveOrder(o);
      }
      for (const o of held) {
        o.status = "cancelled";
        this.store.saveOrder(o);
      }
      m.status = shortfall ? "partial" : "committed";
      m.reason = shortfall
        ? `${shortfall} kits remain unallocated under the current search policy and constraints.`
        : `${finalPlan.reduce((n, a) => n + a.kits, 0)} kits reserved; ${retained.length} existing commitments preserved.`;
      this.store.saveMission(m);
    });
    for (const o of this.store
      .orders()
      .filter((o) => o.missionId === id && o.status === "reserved")) {
      await this.world.upsertEntity({
        type: "commitment",
        externalKey: { system: "dispatch", id: o.id },
        attrs: { status: o.status, kits: o.kits, missionId: id },
        source: {
          kind: "executor",
          by: "Executor",
          at: o.createdAt,
          runId: m.traceId,
        },
      });
      for (const e of o.evidence)
        await this.world.relate({
          from: `commitment:dispatch:${o.id}`,
          type: `depends-on-${e.table}-${e.id}`,
          to: `${e.table}:ops:${e.id}`,
          attrs: { version: e.version, hash: e.hash },
          source: {
            kind: "executor",
            at: o.createdAt,
            by: "Executor",
            runId: m.traceId,
          },
        });
    }
    this.store.trace(
      m.traceId,
      "Executor",
      "reserved",
      {
        orderIds: this.store
          .orders()
          .filter((o) => o.missionId === id && o.status === "reserved")
          .map((o) => o.id),
        shortfall,
        retained: retained.length,
        usage: provider.usage,
      },
      "Watcher",
    );
  }
  async reconcile() {
    const current = this.sources.snapshot(),
      fingerprint = hash(current),
      changed = fingerprint !== this.lastSourceHash;
    this.lastSourceHash = fingerprint;
    const repair = new Set<string>();
    for (const o of this.store
      .orders()
      .filter((o) => o.status === "reserved")) {
      const stale = o.evidence.filter(
        (e) => hash(current[e.table].find((r) => r.id === e.id)) !== e.hash,
      );
      const errors = checkAllocations(
        current,
        [o],
        this.store.busy().filter((x) => x.id !== o.id),
        o.deadlineAt,
      );
      if (
        stale.length ||
        errors.length ||
        Date.now() > Date.parse(o.expiresAt)
      ) {
        o.status = "held";
        o.reason = stale.length
          ? `Changed evidence: ${stale.map((e) => `${e.table}/${e.id}`).join(", ")}`
          : errors.join("; ") || "Reservation expired";
        this.store.saveOrder(o);
        repair.add(o.missionId);
        this.store.trace(
          o.missionId,
          "Watcher",
          "hold",
          { orderId: o.id, reason: o.reason, dependencies: stale },
          "Planner",
        );
        await this.world.upsertEntity({
          type: "commitment",
          externalKey: { system: "dispatch", id: o.id },
          attrs: { status: "held", reason: o.reason },
          source: { kind: "watcher", at: new Date().toISOString() },
        });
      }
    }
    if (changed)
      for (const m of this.store.missions())
        if (
          ["blocked", "partial"].includes(m.status) &&
          Date.parse(m.deadlineAt) > Date.now()
        )
          repair.add(m.id);
    for (const id of repair) this.schedule(id);
    return { affected: [...repair] };
  }
  event(body: any) {
    if (
      !body ||
      typeof body.eventId !== "string" ||
      body.eventId.length < 3 ||
      body.eventId.length > 100
    )
      throw new AppError("INVALID_EVENT", "Provide an event ID.");
    const old = this.store.db
      .prepare("SELECT body FROM events WHERE id=?")
      .get(body.eventId) as any;
    const requestHash = hash({
      table: body.table,
      id: body.id,
      patch: body.patch,
      expectedVersion: body.expectedVersion,
    });
    if (old) {
      const value = JSON.parse(old.body);
      if (value.requestHash !== requestHash)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "Event ID reused with different content.",
          409,
        );
      return { ...value, replayed: true };
    }
    const row = this.sources.update(
      body.table,
      body.id,
      body.patch,
      body.expectedVersion,
    );
    const result = {
      eventId: body.eventId,
      requestHash,
      table: body.table,
      row,
    };
    this.store.db
      .prepare("INSERT INTO events VALUES(?,?)")
      .run(body.eventId, JSON.stringify(result));
    this.store.trace(
      "source-events",
      "Operator",
      "source_changed",
      { table: body.table, row },
      "Watcher",
    );
    return result;
  }
  async release(id: string) {
    const o = this.store.orders().find((o) => o.id === id);
    if (!o) throw new AppError("NOT_FOUND", "Dispatch not found.", 404);
    if (o.status !== "reserved")
      throw new AppError(
        "INVALID_STATE",
        "Only a reserved order can depart.",
        409,
      );
    if (this.mode === "live")
      for (const table of [...new Set(o.evidence.map((e) => e.table))]) {
        const fresh = await this.observe(table, o.missionId);
        if (
          o.evidence.some(
            (e) =>
              e.table === table &&
              fresh.evidence.find((f) => f.id === e.id)?.hash !== e.hash,
          )
        )
          throw new AppError(
            "STALE_EVIDENCE",
            "Dispatch evidence changed; hold for repair.",
            409,
          );
      }
    const released = this.store.transaction(() => {
      const latest = this.store.orders().find((x) => x.id === id)!;
      if (
        latest.status !== "reserved" ||
        Date.parse(latest.expiresAt) < Date.now()
      )
        throw new AppError(
          "INVALID_STATE",
          "Reservation is no longer releasable.",
          409,
        );
      const s = this.sources.snapshot();
      const errors = checkAllocations(
        s,
        [latest],
        this.store.busy().filter((x) => x.id !== id),
        latest.deadlineAt,
      );
      if (
        errors.length ||
        latest.evidence.some(
          (e) => hash(s[e.table].find((r) => r.id === e.id)) !== e.hash,
        )
      )
        throw new AppError(
          "PRECONDITION_FAILED",
          errors.join("; ") || "Source version changed.",
          409,
        );
      latest.status = "departed";
      latest.reason = "Released into the synthetic dispatch simulator.";
      this.store.saveOrder(latest);
      return latest;
    });
    this.store.trace(released.missionId, "Executor", "released", {
      orderId: released.id,
      kits: released.kits,
      checks: released.checks,
    });
    return released;
  }
  state() {
    return {
      mode: this.mode,
      synthetic: true,
      missions: this.store.missions(),
      orders: this.store.orders(),
      sources: this.sources.snapshot(),
      traces: this.store.traces(),
      running: [...this.running],
      limits: {
        scope:
          "One district, one dispatch wave. Vehicles are not automatically recycled.",
        freshnessSeconds: config.freshnessMs / 1000,
      },
      engines: ["Meterless World Model", "Meterless Markovian"],
    };
  }
}
