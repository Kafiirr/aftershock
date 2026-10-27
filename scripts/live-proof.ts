import { writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const base = "http://localhost:4317";
const get = async () =>
  (await (await fetch(base + "/api/state")).json()) as any;
const before = await get();
assert.equal(before.mode, "live");
const mission = before.missions.find(
  (m: any) => m.idempotencyKey === "live-proof-001",
);
assert.equal(mission?.status, "committed");
const north = before.orders.find(
  (o: any) =>
    o.missionId === mission.id &&
    o.shelterId === "north" &&
    o.status === "reserved",
);
const east = before.orders.find(
  (o: any) =>
    o.missionId === mission.id &&
    o.shelterId === "east" &&
    o.status === "reserved",
);
assert(north.routeIds.includes("bridge"));
assert(east);
mkdirSync("diagnostics", { recursive: true });
writeFileSync(
  "diagnostics/live-before-closure.json",
  JSON.stringify(before, null, 2),
);
const bridge = before.sources.roads.find((r: any) => r.id === "bridge");
const start = Date.now();
const response = await fetch(base + "/api/events", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    eventId: "live-bridge-proof-" + start,
    table: "roads",
    id: "bridge",
    expectedVersion: bridge.version,
    patch: { open: false },
  }),
});
assert(response.ok);
const held = await get();
assert.equal(held.orders.find((o: any) => o.id === north.id).status, "held");
assert.equal(held.orders.find((o: any) => o.id === east.id).status, "reserved");
console.log("PASS immediate hold and unaffected order preserved");
for (let i = 0; i < 150; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const after = await get();
  if (after.running.length) continue;
  const current = after.missions.find((m: any) => m.id === mission.id);
  if (current.status !== "committed") throw new Error(current.reason);
  const replacement = after.orders.find(
    (o: any) =>
      o.missionId === mission.id &&
      o.shelterId === "north" &&
      o.status === "reserved",
  );
  assert(replacement);
  assert(!replacement.routeIds.includes("bridge"));
  assert.equal(
    after.orders.find((o: any) => o.id === east.id).status,
    "reserved",
  );
  assert.equal(
    after.orders.find((o: any) => o.id === north.id).status,
    "cancelled",
  );
  writeFileSync(
    "diagnostics/live-after-repair.json",
    JSON.stringify(after, null, 2),
  );
  writeFileSync(
    "diagnostics/live-proof-summary.json",
    JSON.stringify(
      {
        passed: true,
        mode: "live",
        missionId: mission.id,
        originalOrder: north.id,
        replacementOrder: replacement.id,
        preservedOrder: east.id,
        recoveryMs: Date.now() - start,
        models: current.usage.map((u: any) => u.model).filter(Boolean),
        knownLimit:
          "One measured synthetic run; not a field or performance guarantee.",
      },
      null,
      2,
    ),
  );
  console.log("PASS real Zetaris + Nightshift repair; evidence saved");
  process.exit(0);
}
throw new Error("Repair did not finish within five minutes");
