import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  AppError,
  TABLES,
  type Table,
  type Row,
  type Snapshot,
} from "./domain.ts";
const canonical = (x: any): any =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : x;
export const hash = (row: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(row)) ?? "missing")
    .digest("hex")
    .slice(0, 20);
export class Sources {
  db: DatabaseSync;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "depot.sqlite"));
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS inventory(id TEXT PRIMARY KEY, name TEXT, stock INTEGER, version INTEGER)",
    );
    if (
      !(this.db.prepare("SELECT count(*) AS n FROM inventory").get() as any).n
    ) {
      const stmt = this.db.prepare("INSERT INTO inventory VALUES(?,?,?,1)");
      stmt.run("depot-west", "West logistics hub", 160);
      stmt.run("depot-east", "East logistics hub", 140);
    }
    const seed: Record<string, unknown> = {
      "fleet.json": [
        {
          id: "V1",
          name: "Swift / roster available",
          depotId: "depot-west",
          capacity: 80,
          available: true,
          version: 1,
        },
        {
          id: "V2",
          name: "Atlas",
          depotId: "depot-west",
          capacity: 80,
          available: true,
          version: 1,
        },
        {
          id: "V3",
          name: "Orion",
          depotId: "depot-east",
          capacity: 80,
          available: true,
          version: 1,
        },
        {
          id: "V4",
          name: "Mango",
          depotId: "depot-east",
          capacity: 70,
          available: true,
          version: 1,
        },
        {
          id: "V5",
          name: "Cedar",
          depotId: "depot-west",
          capacity: 70,
          available: true,
          version: 1,
        },
      ],
      "maintenance.json": ["V1", "V2", "V3", "V4", "V5"].map((id) => ({
        id,
        name:
          id === "V1"
            ? "Brake inspection unresolved"
            : "Fleet inspection clear",
        hold: id === "V1",
        version: 1,
      })),
      "roads.json": [
        ["west-link", "West approach", "depot-west", "junction-west", 5],
        ["east-link", "East approach", "depot-east", "junction-east", 5],
        ["bridge", "Cendana bridge", "junction-west", "north", 8],
        ["north-east", "North ridge", "junction-east", "north", 24],
        ["west-shelter", "West access", "junction-west", "west", 12],
        ["east-shelter", "East access", "junction-east", "east", 10],
        ["south-west", "South embankment", "junction-west", "south", 22],
        ["south-east", "South access", "junction-east", "south", 14],
        ["bypass", "Hill bypass", "junction-west", "north", 35],
      ].map(([id, name, from, to, minutes]) => ({
        id,
        name,
        from,
        to,
        minutes,
        open: true,
        version: 1,
      })),
    };
    for (const [file, data] of Object.entries(seed))
      if (!existsSync(path.join(dir, file)))
        this.atomic(file, JSON.stringify(data, null, 2));
    if (!existsSync(path.join(dir, "shelters.csv")))
      this.atomic(
        "shelters.csv",
        "id,name,demand,version\nnorth,North school,60,1\neast,East community hall,50,1\nsouth,South sports centre,70,1\nwest,West clinic,60,1\n",
      );
  }
  atomic(file: string, text: string) {
    writeFileSync(path.join(this.dir, file + ".tmp"), text);
    renameSync(path.join(this.dir, file + ".tmp"), path.join(this.dir, file));
  }
  read(table: Table): Row[] {
    if (table === "inventory")
      return this.db
        .prepare("SELECT * FROM inventory ORDER BY id")
        .all() as Row[];
    if (table === "shelters")
      return readFileSync(path.join(this.dir, "shelters.csv"), "utf8")
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => {
          const [id, name, demand, version] = line.split(",");
          return { id, name, demand: Number(demand), version: Number(version) };
        });
    return JSON.parse(
      readFileSync(path.join(this.dir, table + ".json"), "utf8"),
    );
  }
  snapshot(): Snapshot {
    return Object.fromEntries(TABLES.map((t) => [t, this.read(t)])) as Snapshot;
  }
  update(
    table: Table,
    id: string,
    patch: Record<string, unknown>,
    expectedVersion: number,
  ): Row {
    const fields: Record<Table, string[]> = {
      inventory: ["stock"],
      shelters: ["demand"],
      fleet: ["available", "capacity"],
      roads: ["open", "minutes"],
      maintenance: ["hold"],
    };
    if (!TABLES.includes(table))
      throw new AppError("BAD_SOURCE", "Unknown source.");
    if (
      !patch ||
      typeof patch !== "object" ||
      Object.keys(patch).length === 0 ||
      Object.keys(patch).some((k) => !fields[table].includes(k))
    )
      throw new AppError("BAD_PATCH", "Unsupported source field.");
    for (const [k, v] of Object.entries(patch)) {
      if (
        ["open", "available", "hold"].includes(k)
          ? typeof v !== "boolean"
          : !Number.isSafeInteger(v) ||
            Number(v) < (["stock", "demand"].includes(k) ? 0 : 1) ||
            Number(v) > 10000
      )
        throw new AppError("BAD_PATCH", "Invalid field value.");
    }
    const rows = this.read(table),
      row = rows.find((r) => r.id === id);
    if (!row) throw new AppError("NOT_FOUND", "Source record not found.", 404);
    if (row.version !== expectedVersion)
      throw new AppError(
        "VERSION_CONFLICT",
        "Source changed. Refresh before editing.",
        409,
      );
    Object.assign(row, patch, { version: row.version + 1 });
    if (table === "inventory")
      this.db
        .prepare("UPDATE inventory SET stock=?,version=? WHERE id=?")
        .run(Number(row.stock), row.version, id);
    else if (table === "shelters")
      this.atomic(
        "shelters.csv",
        "id,name,demand,version\n" +
          rows
            .map((r) => `${r.id},${r.name},${r.demand},${r.version}`)
            .join("\n") +
          "\n",
      );
    else this.atomic(table + ".json", JSON.stringify(rows, null, 2));
    return row;
  }
  close() {
    this.db.close();
  }
}
