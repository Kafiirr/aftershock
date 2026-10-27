import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
if (existsSync(".env"))
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
export const config = {
  mode: process.env.APP_MODE === "live" ? "live" : "sample",
  port: Number(process.env.PORT || 4317),
  sourcePort: Number(process.env.SOURCE_PORT || 4318),
  publicOrigin: process.env.APP_ORIGIN || "",
  dataDir: path.resolve(process.env.DATA_DIR || "data/runtime"),
  zetarisUrl: (process.env.ZETARIS_REST_URL || "").replace(/\/$/, ""),
  zetarisKey: process.env.ZETARIS_API_KEY || "",
  org: process.env.ZETARIS_ORG_ID || "1",
  meterlessUrl: (process.env.METERLESS_BASE_URL || "").replace(/\/$/, ""),
  meterlessKey: process.env.METERLESS_RUNTIME_TOKEN || "",
  model: process.env.METERLESS_MODEL || "meterless/auto",
  appId: process.env.METERLESS_APP_ID || "aftershock",
  sourceBase: process.env.SOURCE_PUBLIC_URL || "",
  database: process.env.ZETARIS_DATABASE || "aftershock_ops",
  freshnessMs: 300000,
};
export function safeMessage(error: unknown): string {
  let text = error instanceof Error ? error.message : "Unexpected failure";
  for (const key of [config.zetarisKey, config.meterlessKey])
    if (key) text = text.replaceAll(key, "[REDACTED]");
  return text.slice(0, 500);
}
