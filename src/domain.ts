export type Table =
  "inventory" | "shelters" | "fleet" | "roads" | "maintenance";
export const TABLES: Table[] = [
  "inventory",
  "shelters",
  "fleet",
  "roads",
  "maintenance",
];
export type Row = {
  id: string;
  name: string;
  version: number;
  [key: string]: unknown;
};
export type Snapshot = Record<Table, Row[]>;
export type Demand = { shelterId: string; kits: number };
export type MissionInput = {
  demands: Demand[];
  deadlineMinutes: number;
  idempotencyKey: string;
};
export type Allocation = {
  depotId: string;
  shelterId: string;
  vehicleId: string;
  kits: number;
  routeIds: string[];
  minutes: number;
};
export type Evidence = {
  table: Table;
  id: string;
  version: number;
  hash: string;
  observedAt: string;
  source: string;
  query: string;
};
export type Order = Allocation & {
  id: string;
  missionId: string;
  status: "reserved" | "held" | "departed" | "completed" | "cancelled";
  createdAt: string;
  expiresAt: string;
  deadlineAt: string;
  evidence: Evidence[];
  checks: string[];
  reason: string;
  supersedes?: string;
};
export type Mission = MissionInput & {
  id: string;
  createdAt: string;
  deadlineAt: string;
  status: string;
  reason: string;
  traceId: string;
  mode: string;
  engine?: unknown;
  usage?: unknown[];
};
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function validateMission(input: unknown): MissionInput {
  const x = input as MissionInput;
  if (
    !x ||
    !Array.isArray(x.demands) ||
    x.demands.length < 1 ||
    x.demands.length > 4
  )
    throw new AppError(
      "INVALID_DEMAND",
      "Provide one to four shelter demands.",
    );
  const seen = new Set<string>();
  for (const d of x.demands) {
    if (
      !d ||
      typeof d.shelterId !== "string" ||
      !Number.isSafeInteger(d.kits) ||
      d.kits < 1 ||
      d.kits > 10000 ||
      seen.has(d.shelterId)
    )
      throw new AppError(
        "INVALID_DEMAND",
        "Shelters must be unique and quantities must be positive integers up to 10,000.",
      );
    seen.add(d.shelterId);
  }
  if (
    !Number.isInteger(x.deadlineMinutes) ||
    x.deadlineMinutes < 1 ||
    x.deadlineMinutes > 360
  )
    throw new AppError(
      "INVALID_DEADLINE",
      "Deadline must be 1–360 minutes from mission creation.",
    );
  if (
    typeof x.idempotencyKey !== "string" ||
    x.idempotencyKey.length < 3 ||
    x.idempotencyKey.length > 100
  )
    throw new AppError(
      "INVALID_KEY",
      "Provide a 3–100 character idempotency key.",
    );
  return {
    demands: x.demands.map((d) => ({ shelterId: d.shelterId, kits: d.kits })),
    deadlineMinutes: x.deadlineMinutes,
    idempotencyKey: x.idempotencyKey,
  };
}
export function routes(
  s: Snapshot,
  from: string,
  to: string,
): { ids: string[]; minutes: number }[] {
  const found: { ids: string[]; minutes: number }[] = [];
  function walk(
    node: string,
    visited: Set<string>,
    ids: string[],
    minutes: number,
  ) {
    if (node === to) {
      found.push({ ids, minutes });
      return;
    }
    if (ids.length >= 8) return;
    for (const r of s.roads) {
      if (!r.open) continue;
      const next = r.from === node ? r.to : r.to === node ? r.from : null;
      if (typeof next !== "string" || visited.has(next)) continue;
      walk(
        next,
        new Set([...visited, next]),
        [...ids, r.id],
        minutes + Number(r.minutes),
      );
    }
  }
  walk(from, new Set([from]), [], 0);
  return found
    .sort(
      (a, b) =>
        a.minutes - b.minutes || a.ids.join().localeCompare(b.ids.join()),
    )
    .slice(0, 3);
}
export function checkAllocations(
  s: Snapshot,
  allocations: Allocation[],
  busy: Order[],
  deadlineAt: string,
  now = Date.now(),
): string[] {
  const errors: string[] = [];
  const used = new Set(busy.map((o) => o.vehicleId));
  const totals = new Map<string, number>();
  for (const o of busy)
    totals.set(o.depotId, (totals.get(o.depotId) || 0) + o.kits);
  for (const a of allocations) {
    const v = s.fleet.find((x) => x.id === a.vehicleId),
      d = s.inventory.find((x) => x.id === a.depotId),
      target = s.shelters.find((x) => x.id === a.shelterId);
    if (!Number.isSafeInteger(a.kits) || a.kits < 1)
      errors.push("Invalid quantity");
    if (!v || !d || !target) {
      errors.push("Unknown vehicle, depot or shelter");
      continue;
    }
    if (v.depotId !== d.id) errors.push(`${v.id}: wrong depot`);
    if (!v.available || s.maintenance.some((m) => m.id === v.id && m.hold))
      errors.push(`${v.id}: unavailable or maintenance hold`);
    if (used.has(v.id)) errors.push(`${v.id}: already reserved`);
    used.add(v.id);
    if (a.kits > Number(v.capacity)) errors.push(`${v.id}: capacity exceeded`);
    totals.set(d.id, (totals.get(d.id) || 0) + a.kits);
    let at = d.id,
      minutes = 0;
    const visited = new Set<string>([at]);
    for (const id of a.routeIds) {
      const road = s.roads.find((r) => r.id === id);
      if (!road || !road.open) {
        errors.push(`${id}: route closed or missing`);
        break;
      }
      const next =
        road.from === at ? road.to : road.to === at ? road.from : null;
      if (typeof next !== "string" || visited.has(next)) {
        errors.push("Route is disconnected or cyclic");
        break;
      }
      at = next;
      visited.add(at);
      minutes += Number(road.minutes);
    }
    if (at !== target.id) errors.push("Route does not reach shelter");
    if (minutes !== a.minutes)
      errors.push("Travel time does not match road records");
    if (now + minutes * 60000 > Date.parse(deadlineAt))
      errors.push(`${target.id}: arrival misses deadline`);
  }
  for (const [id, kits] of totals) {
    if (kits > Number(s.inventory.find((d) => d.id === id)?.stock ?? 0))
      errors.push(`${id}: insufficient unreserved stock`);
  }
  return [...new Set(errors)];
}
export function plans(
  s: Snapshot,
  demands: Demand[],
  busy: Order[],
  deadlineAt: string,
): {
  id: string;
  allocations: Allocation[];
  shortfall: number;
  minutes: number;
}[] {
  return [0, 1, 2]
    .map((strategy) => {
      const allocations: Allocation[] = [];
      const used = new Set(busy.map((o) => o.vehicleId));
      const available = new Map(
        s.inventory.map((d) => [
          d.id,
          Number(d.stock) -
            busy
              .filter((o) => o.depotId === d.id)
              .reduce((n, o) => n + o.kits, 0),
        ]),
      );
      let shortfall = 0;
      for (const demand of demands) {
        let remaining = demand.kits;
        while (remaining > 0) {
          const options: Allocation[] = [];
          for (const v of s.fleet) {
            if (
              used.has(v.id) ||
              !v.available ||
              v.excluded === true ||
              s.maintenance.some((m) => m.id === v.id && m.hold)
            )
              continue;
            const depot = String(v.depotId);
            const amount = Math.min(
              remaining,
              Number(v.capacity),
              available.get(depot) || 0,
            );
            if (amount <= 0) continue;
            for (const path of routes(s, depot, demand.shelterId)) {
              if (Date.now() + path.minutes * 60000 <= Date.parse(deadlineAt))
                options.push({
                  depotId: depot,
                  shelterId: demand.shelterId,
                  vehicleId: v.id,
                  kits: amount,
                  routeIds: path.ids,
                  minutes: path.minutes,
                });
            }
          }
          options.sort((a, b) =>
            strategy === 1
              ? b.kits - a.kits || a.minutes - b.minutes
              : a.minutes - b.minutes ||
                (strategy === 2
                  ? b.vehicleId.localeCompare(a.vehicleId)
                  : a.vehicleId.localeCompare(b.vehicleId)),
          );
          const best = options[0];
          if (!best) break;
          allocations.push(best);
          used.add(best.vehicleId);
          available.set(best.depotId, available.get(best.depotId)! - best.kits);
          remaining -= best.kits;
        }
        shortfall += remaining;
      }
      return {
        id: `option-${strategy + 1}`,
        allocations,
        shortfall,
        minutes: allocations.reduce((n, a) => n + a.minutes, 0),
      };
    })
    .sort((a, b) => a.shortfall - b.shortfall || a.minutes - b.minutes);
}
