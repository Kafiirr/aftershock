import { config, safeMessage } from "../src/config.ts";
import { TABLES } from "../src/domain.ts";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const address = Object.values(networkInterfaces())
  .flat()
  .find((n) => n?.family === "IPv4" && !n.internal)?.address;
const base = config.sourceBase || `http://${address}:${config.sourcePort}`;
if (!/^[a-z][a-z0-9_]*$/.test(config.database))
  throw new Error("Invalid Zetaris database name");
if (!/^https?:\/\/[a-zA-Z0-9.:-]+$/.test(base))
  throw new Error("Invalid source base URL");
const sql = [
  `CREATE LIGHTNING DATABASE ${config.database} DESCRIBE BY "AFTERSHOCK synthetic operations"`,
  ...TABLES.map(
    (table) =>
      `CREATE LIGHTNING REST TABLE ${table} FROM ${config.database} REQUEST (endpoint "${base}/source/${table}", method "get", response_type "json", http_encoding "URLENCODED") HEADER () BODY ()`,
  ),
];
console.log(JSON.stringify({ sourceBase: base, statements: sql }, null, 2));
if (!process.argv.includes("--apply")) {
  console.log(
    "Review above, then run npm run seed:zetaris -- --apply. This adds only aftershock sources.",
  );
  process.exit(0);
}
const results = [];
for (const statement of sql) {
  const r = await fetch(config.zetarisUrl + "/sql-editor/sqls/run", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.zetarisKey,
      "X-Org-ID": config.org,
      "X-Request-ID": randomUUID(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      queryId: randomUUID(),
      sql: statement,
      source: "SqlEditor",
      limit: 200,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  if (!r.ok || /error|exception/i.test(text)) {
    if (/already exist|already registered/i.test(text)) {
      results.push({ statement, status: "exists" });
      continue;
    }
    throw new Error(
      `Registration failed HTTP ${r.status}: ${safeMessage(new Error(text))}`,
    );
  }
  results.push({ statement, status: "registered" });
  console.log("Registered:", statement.split(" REQUEST")[0]);
}
mkdirSync("diagnostics", { recursive: true });
writeFileSync(
  "diagnostics/source-registration.json",
  JSON.stringify({ base, results }, null, 2),
);
