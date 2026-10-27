import { DatabaseSync } from "node:sqlite";
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { type Mission, type Order, AppError } from "./domain.ts";
import { safeMessage } from "./config.ts";
export class Store {
  db: DatabaseSync;
  logs: string;
  listeners = new Set<(event: any) => void>();
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.logs = path.join(dir, "logs");
    mkdirSync(this.logs, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "dispatch.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS missions(id TEXT PRIMARY KEY,idem TEXT UNIQUE,body TEXT);CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,body TEXT);CREATE TABLE IF NOT EXISTS trace(seq INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT);CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,body TEXT)",
    );
  }
  missions(): Mission[] {
    return this.db
      .prepare("SELECT body FROM missions ORDER BY rowid DESC")
      .all()
      .map((r: any) => JSON.parse(r.body));
  }
  orders(): Order[] {
    return this.db
      .prepare("SELECT body FROM orders ORDER BY rowid DESC")
      .all()
      .map((r: any) => JSON.parse(r.body));
  }
  mission(id: string) {
    return this.missions().find((m) => m.id === id);
  }
  saveMission(m: Mission) {
    this.db
      .prepare(
        "INSERT INTO missions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(m.id, m.idempotencyKey, JSON.stringify(m));
  }
  saveOrder(o: Order) {
    this.db
      .prepare(
        "INSERT INTO orders VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(o.id, JSON.stringify(o));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  trace(
    traceId: string,
    agent: string,
    action: string,
    detail: unknown,
    target?: string,
  ) {
    const event = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      traceId,
      agent,
      action,
      target,
      detail,
    };
    const text = safeMessageLong(event);
    this.db.prepare("INSERT INTO trace(body) VALUES(?)").run(text);
    appendFileSync(path.join(this.logs, traceId + ".jsonl"), text + "\n");
    console.log(text);
    for (const fn of this.listeners) fn(JSON.parse(text));
  }
  traces(traceId?: string) {
    const rows = this.db
      .prepare("SELECT body FROM trace ORDER BY seq DESC LIMIT 500")
      .all()
      .map((r: any) => JSON.parse(r.body));
    return rows.reverse().filter((e) => !traceId || e.traceId === traceId);
  }
  busy() {
    return this.orders().filter((o) =>
      ["reserved", "departed", "completed"].includes(o.status),
    );
  }
  close() {
    this.db.close();
  }
}
function safeMessageLong(value: unknown) {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "string" ? safeMessage(new Error(v)) : v,
  );
}
