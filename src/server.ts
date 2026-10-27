import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config, safeMessage } from "./config.ts";
import { Sources } from "./sources.ts";
import { Store } from "./store.ts";
import { Engine } from "./engine.ts";
import { AppError, TABLES, type Table } from "./domain.ts";
const sourceDir = path.join(config.dataDir, "sources-" + config.mode),
  runDir = path.join(config.dataDir, config.mode);
const sources = new Sources(sourceDir),
  store = new Store(runDir),
  engine = new Engine(sources, store, config.mode as "sample" | "live", runDir);
const json = (res: http.ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
};
async function body(req: http.IncomingMessage) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 20000)
      throw new AppError("BODY_TOO_LARGE", "Request too large.", 413);
  }
  try {
    return JSON.parse(data);
  } catch {
    throw new AppError("BAD_JSON", "Invalid JSON body.");
  }
}
const sourceServer = http.createServer((req, res) => {
  const table = req.url?.match(
    /^\/source\/(inventory|shelters|fleet|roads|maintenance)$/,
  )?.[1] as Table;
  if (req.method === "GET" && table) return json(res, 200, sources.read(table));
  json(res, 404, { error: "Not found" });
});
sourceServer.listen(config.sourcePort, "0.0.0.0");
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${config.port}`),
      method = req.method || "GET";
    if (!["GET", "HEAD"].includes(method)) {
      const origin = req.headers.origin;
      if (
        origin &&
        !new Set([
          `http://localhost:${config.port}`,
          `http://127.0.0.1:${config.port}`,
          config.publicOrigin,
        ]).has(origin)
      )
        throw new AppError(
          "ORIGIN_DENIED",
          "Cross-origin writes are disabled.",
          403,
        );
      if (!req.headers["content-type"]?.includes("application/json"))
        throw new AppError("CONTENT_TYPE", "Use application/json.", 415);
    }
    if (method === "GET" && url.pathname === "/api/state")
      return json(res, 200, engine.state());
    if (method === "GET" && url.pathname === "/api/health")
      return json(res, 200, { status: "up", mode: config.mode });
    if (method === "POST" && url.pathname === "/api/missions")
      return json(res, 202, engine.create(await body(req)));
    if (method === "POST" && url.pathname === "/api/events") {
      const result = engine.event(await body(req));
      await engine.reconcile();
      return json(res, 200, result);
    }
    if (method === "GET" && url.pathname.startsWith("/api/missions/")) {
      const m = store.mission(url.pathname.split("/")[3]);
      if (!m) throw new AppError("NOT_FOUND", "Mission not found.", 404);
      return json(res, 200, {
        ...m,
        orders: store.orders().filter((o) => o.missionId === m.id),
        trace: store.traces(m.traceId),
      });
    }
    if (
      method === "POST" &&
      /^\/api\/missions\/[^/]+\/retry$/.test(url.pathname)
    ) {
      const id = url.pathname.split("/")[3];
      const mission = store.mission(id);
      if (!mission) throw new AppError("NOT_FOUND", "Mission not found.", 404);
      if (mission.status === "cancelled")
        throw new AppError(
          "INVALID_STATE",
          "A cancelled mission cannot be retried.",
          409,
        );
      engine.schedule(id);
      return json(res, 202, { id });
    }
    if (
      method === "POST" &&
      /^\/api\/missions\/[^/]+\/cancel$/.test(url.pathname)
    ) {
      const id = url.pathname.split("/")[3];
      const m = store.mission(id);
      if (!m) throw new AppError("NOT_FOUND", "Mission not found.", 404);
      if (
        engine.running.has(id) ||
        store
          .orders()
          .some(
            (o) =>
              o.missionId === id &&
              ["departed", "completed"].includes(o.status),
          )
      )
        throw new AppError(
          "INVALID_STATE",
          "Cannot cancel a mission while planning or after departure.",
          409,
        );
      store.transaction(() => {
        for (const o of store
          .orders()
          .filter(
            (o) =>
              o.missionId === id && ["reserved", "held"].includes(o.status),
          )) {
          o.status = "cancelled";
          o.reason = "Cancelled by operator before departure.";
          store.saveOrder(o);
        }
        m.status = "cancelled";
        m.reason = "Cancelled by operator.";
        store.saveMission(m);
      });
      store.trace(m.traceId, "Operator", "cancelled", { missionId: id });
      return json(res, 200, m);
    }
    if (
      method === "POST" &&
      /^\/api\/orders\/[^/]+\/release$/.test(url.pathname)
    )
      return json(res, 200, await engine.release(url.pathname.split("/")[3]));
    if (
      method === "POST" &&
      /^\/api\/orders\/[^/]+\/complete$/.test(url.pathname)
    ) {
      const id = url.pathname.split("/")[3];
      const order = store.orders().find((o) => o.id === id);
      if (!order || order.status !== "departed")
        throw new AppError(
          "INVALID_STATE",
          "Only a departed dispatch can receive a simulated delivery receipt.",
          409,
        );
      order.status = "completed";
      order.reason =
        "Synthetic delivery completion acknowledged by the operator.";
      store.saveOrder(order);
      store.trace(order.missionId, "Simulator", "completed", {
        orderId: id,
        kits: order.kits,
      });
      return json(res, 200, order);
    }
    const files: Record<string, [string, string]> = {
      "/": ["index.html", "text/html"],
      "/app.js": ["app.js", "text/javascript"],
      "/style.css": ["style.css", "text/css"],
    };
    const f = files[url.pathname];
    if (method === "GET" && f && existsSync(path.join("public", f[0]))) {
      res.writeHead(200, {
        "Content-Type": f[1],
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      });
      return res.end(readFileSync(path.join("public", f[0])));
    }
    json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, e instanceof AppError ? e.status : 500, {
      error: {
        code: e instanceof AppError ? e.code : "INTERNAL",
        message: safeMessage(e),
      },
    });
  }
});
server.listen(config.port, process.env.APP_HOST || "127.0.0.1", () =>
  console.log(`AFTERSHOCK ${config.mode}: http://localhost:${config.port}`),
);
let checking = false;
const timer = setInterval(async () => {
  if (checking) return;
  checking = true;
  try {
    await engine.reconcile();
  } catch (e) {
    console.error(safeMessage(e));
  } finally {
    checking = false;
  }
}, 5000);
process.on("SIGTERM", () => {
  clearInterval(timer);
  server.close();
  sourceServer.close();
  process.exit(0);
});
