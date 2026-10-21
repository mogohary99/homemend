/**
 * Pieces of the HTTP surface shared by the Node server (src/main.ts) and the Cloudflare Worker
 * (../worker/src/worker.ts): origin allowlist, request-context headers, the MCP Apps sandbox
 * proxy page and its CSP, and the landing page.
 */
import { assertHouseholdId } from "./store.js";
import { systemClock, type Clock } from "./engine.js";

export const CORS_ALLOWED_HEADERS = ["Content-Type", "Accept", "Authorization", "Mcp-Session-Id", "MCP-Protocol-Version", "Last-Event-ID", "X-Homemend-Household", "X-Homemend-Clock"];
export const CORS_EXPOSED_HEADERS = ["Mcp-Session-Id", "MCP-Protocol-Version"];
export const CORS_METHODS = ["GET", "POST", "DELETE", "OPTIONS"];

/** Origins allowed to call the MCP endpoint from a browser (the simulator). */
export function buildAllowedOrigins(opts: { port?: number; publicUrl?: string; extra?: string }): Set<string> {
  const set = new Set<string>(["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"]);
  if (opts.port) {
    set.add(`http://localhost:${opts.port}`);
    set.add(`http://127.0.0.1:${opts.port}`);
  }
  if (opts.publicUrl) {
    try {
      set.add(new URL(opts.publicUrl).origin);
    } catch {
      /* ignore malformed PUBLIC_URL */
    }
  }
  for (const o of (opts.extra ?? "").split(",").map((s) => s.trim()).filter(Boolean)) set.add(o);
  return set;
}

export class RequestContextError extends Error {}

/**
 * Household identity + demo clock from request headers.
 * A real Alexa+ add-on gets the household from the account-linked OAuth token; here it is a header
 * so judges and the simulator can create isolated households. The clock header is a documented,
 * demo-only control ("advance a day") and can be disabled with HOMEMEND_ALLOW_DEMO_CLOCK=false.
 */
export function resolveRequestContext(
  header: (name: string) => string | null | undefined,
  opts: { allowDemoClock: boolean; defaultClock?: Clock },
): { householdId: string; clock: Clock } {
  let householdId = "demo-household";
  const h = header("x-homemend-household");
  if (h) {
    try {
      householdId = assertHouseholdId(h);
    } catch {
      throw new RequestContextError("Invalid X-Homemend-Household (expected 1-64 chars of [a-zA-Z0-9_-])");
    }
  }
  let clock: Clock = opts.defaultClock ?? systemClock;
  const c = header("x-homemend-clock");
  if (c && opts.allowDemoClock) {
    const t = Date.parse(c);
    if (!Number.isNaN(t)) clock = { now: () => new Date(t) };
  }
  return { householdId, clock };
}

export function parseCsp(raw: unknown): { connectDomains: string[]; resourceDomains: string[]; frameDomains: string[] } {
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

/** Content-Security-Policy header value for the sandbox proxy, derived from the host-supplied ?csp= JSON. */
export function sandboxCspHeader(raw: unknown): string {
  const csp = parseCsp(raw);
  const connect = ["'self'", ...csp.connectDomains].join(" ");
  const resources = ["'self'", "data:", "blob:", ...csp.resourceDomains].join(" ");
  return [
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
  ].join("; ");
}

export const SANDBOX_HTML = `<!doctype html>
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

export function landingHtml(hasSim: boolean, storage = "json files on disk") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HomeMend MCP server</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;line-height:1.5;color:#14181e}code{background:#f1f3f6;padding:2px 6px;border-radius:4px}a{color:#2d415e}</style></head>
<body><h1>HomeMend</h1><p>Household repair &amp; maintenance agent for Alexa+ — a self-hosted MCP server (Streamable HTTP, spec 2025-11-25+) with MCP Apps views.</p>
<ul><li>MCP endpoint: <code>POST /mcp</code> (add <code>X-Homemend-Household: &lt;your-id&gt;</code> for an isolated household)</li><li>Health: <a href="/health">/health</a></li>${hasSim ? `<li>Alexa+ simulator: <a href="/sim/">/sim/</a></li>` : ""}<li>Storage: ${storage}</li></ul>
<p>Built for the Amazon Developer Hackathon 2026 (Alexa+ track). Source: <a href="https://github.com/mogohary99/homemend">github.com/mogohary99/homemend</a></p></body></html>`;
}
