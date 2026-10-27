import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Sources, hash } from "../src/sources.ts";
import { Store } from "../src/store.ts";
import { Engine } from "../src/engine.ts";
import { checkAllocations, validateMission } from "../src/domain.ts";
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "aftershock-test-"));
  const sources = new Sources(path.join(dir, "sources"));
  const store = new Store(path.join(dir, "app"));
  const engine = new Engine(sources, store, "sample", path.join(dir, "app"));
  return {
    dir,
    sources,
    store,
    engine,
    close() {
      store.close();
      sources.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const input = (key: string, kits = 60) => ({
  demands: [{ shelterId: "north", kits }],
  deadlineMinutes: 90,
  idempotencyKey: key,
});
test("live commitment: maintenance rejection, revision, real reservation and dependency repair", async () => {
  const f = setup();
  try {
    const m = f.engine.create(input("mission-one"));
    await f.engine.idle();
    assert.equal(f.store.mission(m.id)?.status, "committed");
    let orders = f.store.orders().filter((o) => o.status === "reserved");
    assert.equal(
      orders.reduce((n, o) => n + o.kits, 0),
      60,
    );
    assert(orders.every((o) => o.vehicleId !== "V1"));
    assert(f.store.traces(m.traceId).some((t) => t.action === "reject"));
    assert(orders[0].evidence.length >= 5);
    const old = orders[0];
    const event = {
      eventId: "close-bridge",
      table: "roads",
      id: "bridge",
      patch: { open: false },
      expectedVersion: 1,
    };
    f.engine.event(event);
    assert(f.engine.event(event).replayed);
    await f.engine.reconcile();
    assert.equal(f.store.orders().find((o) => o.id === old.id)?.status, "held");
    await assert.rejects(() => f.engine.release(old.id));
    await f.engine.idle();
    orders = f.store.orders().filter((o) => o.status === "reserved");
    assert(orders.length > 0);
    assert(orders.every((o) => !o.routeIds.includes("bridge")));
    assert.equal(
      f.store.orders().find((o) => o.id === old.id)?.status,
      "cancelled",
    );
    assert.equal(
      checkAllocations(f.sources.snapshot(), orders, [], orders[0].deadlineAt)
        .length,
      0,
    );
  } finally {
    f.close();
  }
});
test("duplicate mission and conflicting reuse cannot reserve twice", async () => {
  const f = setup();
  try {
    const one = f.engine.create(input("same-key"));
    const two = f.engine.create(input("same-key"));
    assert.equal(one.id, two.id);
    assert.throws(
      () => f.engine.create(input("same-key", 20)),
      /different mission/,
    );
    await f.engine.idle();
    assert.equal(
      f.store.orders().filter((o) => o.status === "reserved").length,
      1,
    );
  } finally {
    f.close();
  }
});
test("concurrent missions cannot double allocate fleet or stock", async () => {
  const f = setup();
  try {
    f.engine.create(input("concurrent-a", 100));
    f.engine.create(input("concurrent-b", 100));
    await f.engine.idle();
    const orders = f.store.busy();
    assert.equal(new Set(orders.map((o) => o.vehicleId)).size, orders.length);
    assert.deepEqual(
      checkAllocations(
        f.sources.snapshot(),
        orders,
        [],
        new Date(Date.now() + 90 * 60000).toISOString(),
      ),
      [],
    );
  } finally {
    f.close();
  }
});
test("impossible mission returns quantified shortfall; no fabricated success", async () => {
  const f = setup();
  try {
    const m = f.engine.create(input("impossible", 900));
    await f.engine.idle();
    assert.equal(f.store.mission(m.id)?.status, "partial");
    const total = f.store.busy().reduce((n, o) => n + o.kits, 0);
    assert(total < 900);
    assert(f.store.mission(m.id)?.reason.includes(String(900 - total)));
  } finally {
    f.close();
  }
});
test("source versions, shape validation, deadline and release gates", async () => {
  const f = setup();
  try {
    assert.throws(() => validateMission(input("x", -1)));
    assert.throws(() =>
      f.sources.update("roads", "bridge", { open: "false" }, 1),
    );
    assert.throws(
      () => f.sources.update("roads", "bridge", { open: false }, 8),
      /changed/,
    );
    const m = f.engine.create({ ...input("too-late"), deadlineMinutes: 1 });
    await f.engine.idle();
    assert.equal(f.store.busy().length, 0);
    assert.equal(f.store.mission(m.id)?.status, "partial");
  } finally {
    f.close();
  }
});
test("unaffected commitments survive selective repair", async () => {
  const f = setup();
  try {
    const a = f.engine.create(input("north-one"));
    await f.engine.idle();
    const b = f.engine.create({
      demands: [{ shelterId: "east", kits: 50 }],
      deadlineMinutes: 90,
      idempotencyKey: "east-one",
    });
    await f.engine.idle();
    const preserved = f.store
      .orders()
      .find((o) => o.missionId === b.id && o.status === "reserved")!;
    assert(preserved);
    f.engine.event({
      eventId: "incident-one",
      table: "roads",
      id: "bridge",
      patch: { open: false },
      expectedVersion: 1,
    });
    await f.engine.reconcile();
    await f.engine.idle();
    assert.equal(
      f.store.orders().find((o) => o.id === preserved.id)?.status,
      "reserved",
    );
    assert.equal(f.store.mission(a.id)?.status, "committed");
  } finally {
    f.close();
  }
});
test("world memory and reservations survive restart; departed orders are never rolled back", async () => {
  const f = setup();
  try {
    const m = f.engine.create(input("restart-one"));
    await f.engine.idle();
    const order = f.store.busy()[0];
    await f.engine.release(order.id);
    const reboot = new Engine(
      f.sources,
      f.store,
      "sample",
      path.join(f.dir, "app"),
    );
    assert.equal(
      reboot.world.view("graph").entity("fleet:ops:V1")?.attrs.excluded,
      true,
    );
    f.sources.update("roads", "bridge", { open: false }, 1);
    await reboot.reconcile();
    await reboot.idle();
    assert.equal(
      f.store.orders().find((o) => o.id === order.id)?.status,
      "departed",
    );
    assert(f.store.mission(m.id));
  } finally {
    f.close();
  }
});
test("hash ignores source column order", () =>
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 })));
test("remembered maintenance exclusion changes the next proposal, and fresh clearance removes it", async () => {
  const f = setup();
  try {
    f.engine.create(input("learn-maintenance", 20));
    await f.engine.idle();
    const next = f.engine.create(input("remember-maintenance", 20));
    await f.engine.idle();
    assert.equal(f.store.mission(next.id)?.status, "committed");
    assert(!f.store.traces(next.traceId).some((t) => t.action === "reject"));
    f.sources.update("maintenance", "V1", { hold: false }, 1);
    const cleared = f.engine.create(input("fresh-clearance", 200));
    await f.engine.idle();
    assert(
      f.store
        .busy()
        .some((o) => o.missionId === cleared.id && o.vehicleId === "V1"),
    );
    assert.equal(
      f.engine.world.view("graph").entity("fleet:ops:V1")?.attrs.excluded,
      false,
    );
  } finally {
    f.close();
  }
});
test("expired missions cancel reservations before any further investigation", async () => {
  const f = setup();
  try {
    const m = f.engine.create(input("expired-mission"));
    await f.engine.idle();
    const saved = f.store.mission(m.id)!;
    saved.deadlineAt = new Date(Date.now() - 1000).toISOString();
    f.store.saveMission(saved);
    const before = f.store.traces(m.traceId).length;
    await f.engine.plan(m.id);
    assert.equal(f.store.mission(m.id)?.status, "expired");
    assert.equal(f.store.busy().length, 0);
    assert.deepEqual(
      f.store
        .traces(m.traceId)
        .slice(before)
        .map((t) => t.action),
      ["expired"],
    );
  } finally {
    f.close();
  }
});
test("twenty input scenarios independently satisfy all committed constraints", async () => {
  for (let seed = 1; seed <= 20; seed++) {
    const f = setup();
    try {
      if (seed % 3 === 0)
        f.sources.update("roads", "bridge", { open: false }, 1);
      if (seed % 4 === 0)
        f.sources.update("inventory", "depot-west", { stock: 20 }, 1);
      f.engine.create(input("generated-" + seed, seed * 13));
      await f.engine.idle();
      const orders = f.store.busy();
      assert.deepEqual(
        checkAllocations(
          f.sources.snapshot(),
          orders,
          [],
          new Date(Date.now() + 90 * 60000).toISOString(),
        ),
        [],
      );
      assert(orders.every((o) => o.evidence.length >= 5));
    } finally {
      f.close();
    }
  }
});
