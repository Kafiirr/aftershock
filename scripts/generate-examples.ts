import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Sources } from "../src/sources.ts";
import { Store } from "../src/store.ts";
import { Engine } from "../src/engine.ts";

// Execute the real sample engine. Runtime never reads these output files.
for (const [name, demands] of [
  ["north", [{ shelterId: "north", kits: 60 }]],
  [
    "two-shelters",
    [
      { shelterId: "east", kits: 35 },
      { shelterId: "south", kits: 45 },
    ],
  ],
  ["shortfall", [{ shelterId: "north", kits: 900 }]],
] as const) {
  const root = mkdtempSync(path.join(tmpdir(), "aftershock-example-"));
  const sources = new Sources(path.join(root, "sources"));
  const store = new Store(path.join(root, "app"));
  try {
    const engine = new Engine(sources, store, "sample", path.join(root, "app"));
    const input = {
      demands,
      deadlineMinutes: 90,
      idempotencyKey: `example-${name}`,
    };
    const mission = engine.create(input);
    await engine.idle();
    const output = {
      generatedAt: new Date().toISOString(),
      mode: "sample",
      policy: "Deterministic policies; no LLM or live sponsor queries.",
      mission: store.mission(mission.id),
      orders: store.orders(),
      trace: store.traces(mission.traceId),
    };
    for (const folder of ["input_examples", "output_examples"])
      mkdirSync(folder, { recursive: true });
    writeFileSync(
      `input_examples/${name}.json`,
      JSON.stringify(input, null, 2) + "\n",
    );
    writeFileSync(
      `output_examples/${name}.json`,
      JSON.stringify(output, null, 2) + "\n",
    );
  } finally {
    store.close();
    sources.close();
    rmSync(root, { recursive: true, force: true });
  }
}
