import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { config } from "../src/config.ts";
import { Nightshift, zetaris } from "../src/providers.ts";
test("provider auth failures are explicit and credentials never appear in errors", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "wrong secret-test-token" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const saved = { ...config };
  try {
    config.meterlessUrl = `http://127.0.0.1:${port}`;
    config.meterlessKey = "secret-test-token";
    config.zetarisUrl = config.meterlessUrl;
    config.zetarisKey = "secret-test-token";
    await assert.rejects(
      () => new Nightshift().discover(),
      (e) =>
        e instanceof Error &&
        e.message.includes("401") &&
        !e.message.includes("secret-test-token"),
    );
    await assert.rejects(() => zetaris("SELECT 1"), /401/);
  } finally {
    Object.assign(config, saved);
    server.close();
  }
});
test("SQL adapter normal result and fail-closed pagination", async () => {
  let pages = 1;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ records: [{ one: "1" }], totalPages: pages }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const saved = { ...config };
  try {
    config.zetarisUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    config.zetarisKey = "test";
    assert.deepEqual(await zetaris("SELECT 1"), [{ one: "1" }]);
    pages = 2;
    await assert.rejects(() => zetaris("SELECT 1"), /partial snapshot/);
  } finally {
    Object.assign(config, saved);
    server.close();
  }
});
