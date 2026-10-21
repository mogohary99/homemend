/**
 * HomeMend HTTP entry point.
 *
 *   POST/GET/DELETE /mcp   Streamable HTTP MCP endpoint (spec 2025-11-25 and later, stateless)
 *   GET  /health           liveness + protocol info (used by hosting health checks and the judges)
 *   GET  /sandbox.html     MCP Apps sandbox proxy page (served from this origin so the simulator can
 *                          isolate app HTML on a different origin, per the MCP Apps spec)
 *   GET  /                 landing page for judges
 *   GET  /sim/*            the Alexa+ simulator, when it has been built into ../sim/dist
 */
import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createHomeMendServer, SERVER_INFO, type ViewResource } from "./mcp.js";
import { FileStore, type Store } from "./store.js";
import type { Clock } from "./engine.js";
import { buildAllowedOrigins, CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS, CORS_METHODS, landingHtml, RequestContextError, resolveRequestContext, SANDBOX_HTML, sandboxCspHeader } from "./http-common.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const DATA_DIR = process.env.HOMEMEND_DATA_DIR ?? join(here, "..", "data");
const PUBLIC_URL = process.env.PUBLIC_URL; // e.g. https://homemend.example.com
const ALLOW_DEMO_CLOCK = process.env.HOMEMEND_ALLOW_DEMO_CLOCK !== "false";

const allowedOrigins = buildAllowedOrigins({ port: PORT, publicUrl: PUBLIC_URL, extra: process.env.ALLOWED_ORIGINS });

export function loadView(): ViewResource {
  const candidates = [join(here, "..", "dist-ui", "view.html"), join(here, "..", "..", "dist-ui", "view.html")];
  const path = candidates.find((p) => existsSync(p));
  const html = path
    ? readFileSync(path, "utf8")
    : `<!doctype html><html><body style="font-family:system-ui;padding:16px">HomeMend view bundle not built. Run <code>pnpm build:ui</code>.</body></html>`;
  const hash = createHash("sha256").update(html).digest("hex").slice(0, 8);
  // Content-hashed URI so hosts can cache aggressively (Alexa+ layout guidance).
  return { uri: `ui://homemend/view-${hash}.html`, html };
}

export function createApp(deps: { store: Store; view: ViewResource; clock?: Clock }) {
  const app = createMcpExpressApp({ host: HOST });
  app.set("trust proxy", true);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
      exposedHeaders: CORS_EXPOSED_HEADERS,
      allowedHeaders: CORS_ALLOWED_HEADERS,
      methods: CORS_METHODS,
    }),
  );

  // Spec: servers MUST validate Origin on the MCP endpoint (DNS-rebinding protection).
  app.use("/mcp", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Forbidden origin" }, id: null });
      return;
    }
    next();
  });

  app.all("/mcp", async (req, res) => {
    let householdId: string;
    let clock: Clock;
    try {
      ({ householdId, clock } = resolveRequestContext((n) => req.header(n), { allowDemoClock: ALLOW_DEMO_CLOCK, defaultClock: deps.clock }));
    } catch (err) {
      const message = err instanceof RequestContextError ? err.message : "Bad request";
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
      return;
    }
    const server = createHomeMendServer({ store: deps.store, householdId, clock, view: deps.view });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[homemend] transport error", err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, server: SERVER_INFO, transport: "streamable-http", protocol: ["2025-11-25", "2026-07-28"], view: deps.view.uri, time: new Date().toISOString() });
  });

  // MCP Apps sandbox proxy. CSP is applied via HTTP header based on the ?csp= param the host passes.
  app.get("/sandbox.html", (req, res) => {
    res.setHeader("Content-Security-Policy", sandboxCspHeader(req.query.csp));
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(SANDBOX_HTML);
  });

  const simDist = join(here, "..", "..", "sim", "dist");
  if (existsSync(simDist)) {
    app.use("/sim", express.static(simDist));
    app.get("/sim/{*path}", (_req, res) => res.sendFile(join(simDist, "index.html")));
  }
  app.get("/", (_req, res) => {
    res.type("html").send(landingHtml(existsSync(simDist)));
  });
  return app;
}

// Start when run directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp({ store: new FileStore(DATA_DIR), view: loadView() });
  app.listen(PORT, HOST, () => {
    console.log(`[homemend] MCP server listening on http://${HOST}:${PORT}/mcp  (data: ${DATA_DIR})`);
  });
}
