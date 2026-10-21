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
import { FileStore, assertHouseholdId, type Store } from "./store.js";
import { systemClock, type Clock } from "./engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const DATA_DIR = process.env.HOMEMEND_DATA_DIR ?? join(here, "..", "data");
const PUBLIC_URL = process.env.PUBLIC_URL; // e.g. https://homemend.example.com
const ALLOW_DEMO_CLOCK = process.env.HOMEMEND_ALLOW_DEMO_CLOCK !== "false";

/** Origins allowed to call the MCP endpoint from a browser (the simulator). */
const allowedOrigins = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...(PUBLIC_URL ? [new URL(PUBLIC_URL).origin] : []),
  ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

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
      exposedHeaders: ["Mcp-Session-Id", "MCP-Protocol-Version"],
      allowedHeaders: ["Content-Type", "Accept", "Authorization", "Mcp-Session-Id", "MCP-Protocol-Version", "Last-Event-ID", "X-Homemend-Household", "X-Homemend-Clock"],
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
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
    // Household identity. A real Alexa+ add-on gets this from the account-linked token.
    let householdId = "demo-household";
    try {
      const h = req.header("x-homemend-household");
      if (h) householdId = assertHouseholdId(h);
    } catch {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid X-Homemend-Household" }, id: null });
      return;
    }
    // Demo-only clock override so a judge can "advance a day" and see follow-ups fire. Clearly a simulator control.
    let clock: Clock = deps.clock ?? systemClock;
    const clockHeader = req.header("x-homemend-clock");
    if (clockHeader && ALLOW_DEMO_CLOCK) {
      const t = Date.parse(clockHeader);
      if (!Number.isNaN(t)) clock = { now: () => new Date(t) };
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
    const csp = parseCsp(req.query.csp);
    const connect = ["'self'", ...csp.connectDomains].join(" ");
    const resources = ["'self'", "data:", "blob:", ...csp.resourceDomains].join(" ");
    res.setHeader(
      "Content-Security-Policy",
      [
        `default-src 'self'`,
        `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${csp.resourceDomains.join(" ")}`.trim(),
        `style-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`.trim(),
        `img-src ${resources}`,
        `font-src ${resources}`,
        `media-src ${resources}`,
        `connect-src ${connect}`,
        `frame-src ${csp.frameDomains.length ? csp.frameDomains.join(" ") : "'none'"}`,
        `object-src 'none'`,
        `base-uri 'self'`,
      ].join("; "),
    );
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

function parseCsp(raw: unknown): { connectDomains: string[]; resourceDomains: string[]; frameDomains: string[] } {
  const out = { connectDomains: [] as string[], resourceDomains: [] as string[], frameDomains: [] as string[] };
  if (typeof raw !== "string") return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && /^https?:\/\/[a-z0-9.*:-]+$/i.test(s)) : []);
    out.connectDomains = clean(parsed.connectDomains);
    out.resourceDomains = clean(parsed.resourceDomains);
    out.frameDomains = clean(parsed.frameDomains);
  } catch {
    /* ignore malformed csp */
  }
  return out;
}

const SANDBOX_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>HomeMend sandbox</title>
<style>html,body{margin:0;height:100vh;width:100vw;background:transparent}body{display:flex;flex-direction:column}iframe{border:0;flex:1;background:transparent;color-scheme:inherit}</style></head>
<body><script>
(function(){
  if (window.self === window.top) { document.body.textContent = 'This page is only used inside the HomeMend simulator.'; return; }
  var HOST_ORIGIN = document.referrer ? new URL(document.referrer).origin : null;
  var inner = document.createElement('iframe');
  // Opaque origin for the untrusted view HTML: isolated from this proxy and from the host.
  inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  document.body.appendChild(inner);
  window.addEventListener('message', function (event) {
    if (event.source === window.parent) {
      if (HOST_ORIGIN && event.origin !== HOST_ORIGIN) return;
      var d = event.data;
      if (d && d.method === 'ui/notifications/sandbox-resource-ready') {
        var p = d.params || {};
        if (typeof p.sandbox === 'string') inner.setAttribute('sandbox', p.sandbox);
        var allow = [];
        var perms = p.permissions || {};
        if (perms.camera) allow.push('camera'); if (perms.microphone) allow.push('microphone'); if (perms.geolocation) allow.push('geolocation'); if (perms.clipboardWrite) allow.push('clipboard-write');
        if (allow.length) inner.setAttribute('allow', allow.join('; '));
        var doc = inner.contentDocument || (inner.contentWindow && inner.contentWindow.document);
        if (doc) { doc.open(); doc.write(p.html); doc.close(); } else { inner.srcdoc = p.html; }
      } else if (inner.contentWindow) {
        inner.contentWindow.postMessage(d, '*');
      }
    } else if (event.source === inner.contentWindow) {
      window.parent.postMessage(event.data, HOST_ORIGIN || '*');
    }
  });
  window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} }, HOST_ORIGIN || '*');
})();
</script></body></html>`;

function landingHtml(hasSim: boolean) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HomeMend MCP server</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;line-height:1.5;color:#14181e}code{background:#f1f3f6;padding:2px 6px;border-radius:4px}a{color:#2d415e}</style></head>
<body><h1>HomeMend</h1><p>Household repair &amp; maintenance agent for Alexa+ — a self-hosted MCP server (Streamable HTTP, spec 2025-11-25+) with MCP Apps views.</p>
<ul><li>MCP endpoint: <code>POST /mcp</code></li><li>Health: <a href="/health">/health</a></li>${hasSim ? `<li>Alexa+ simulator: <a href="/sim/">/sim/</a></li>` : ""}</ul>
<p>Built for the Amazon Developer Hackathon 2026 (Alexa+ track).</p></body></html>`;
}

// Start when run directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp({ store: new FileStore(DATA_DIR), view: loadView() });
  app.listen(PORT, HOST, () => {
    console.log(`[homemend] MCP server listening on http://${HOST}:${PORT}/mcp  (data: ${DATA_DIR})`);
  });
}
