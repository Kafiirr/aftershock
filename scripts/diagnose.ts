import { config, safeMessage } from "../src/config.ts";
import { zetaris, Nightshift } from "../src/providers.ts";
const result: any = { mode: config.mode, checkedAt: new Date().toISOString() };
try {
  result.zetaris = { status: "pass", rows: await zetaris("SELECT 1 AS one") };
} catch (e) {
  result.zetaris = { status: "fail", error: safeMessage(e) };
}
try {
  const client = new Nightshift();
  const models: any = await client.discover();
  result.nightshift = {
    status: "pass",
    routes: models.data?.map((m: any) => m.id),
  };
} catch (e) {
  result.nightshift = { status: "fail", error: safeMessage(e) };
}
console.log(JSON.stringify(result, null, 2));
if (result.zetaris.status !== "pass" || result.nightshift.status !== "pass")
  process.exitCode = 1;
