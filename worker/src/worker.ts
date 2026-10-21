/**
 * HomeMend on Cloudflare Workers.
 *
 * Same MCP server as src/main.ts (Node), different edges:
 *   - transport: WebStandardStreamableHTTPServerTransport (fetch Request/Response), stateless per request
 *   - persistence: D1 (SQLite). The household document is loaded before the request is handled and
 *     written back *before* the response is returned, so a judge's next call always sees the write.
 *   - static: the Alexa+ simulator is served from ./public/sim by Workers Static Assets.
 */
import { WebStandardStreamableHTTPServerTransport } from "../../server/src/web-transport.js";
import { createHomeMendServer, SERVER_INFO, type ViewResource } from "../../server/src/mcp.js";
import { emptyHousehold, assertHouseholdId, type Household, type Store } from "../../server/src/store.js";
import { buildAllowedOrigins, CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS, CORS_METHODS, landingHtml, RequestContextError, resolveRequestContext, SANDBOX_HTML, sandboxCspHeader } from "../../server/src/http-common.js";
import viewHtml from "../../server/dist-ui/view.html";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  PUBLIC_URL?: string;
  ALLOWED_ORIGINS?: string;
  HOMEMEND_ALLOW_DEMO_CLOCK?: string;
}

// Content-hashed view URI (same scheme as the Node server) so hosts can cache the resource.
const VIEW: ViewResource = await (async () => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(viewHtml));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 8);
  return { uri: `ui://homemend/view-${hash}.html`, html: viewHtml };
})();

/** Synchronous Store over one preloaded household; `dirty` tells the handler to write back. */
class RequestStore implements Store {
  dirty = false;
  constructor(public current: Household) {}
  load(id: string): Household {
    assertHouseholdId(id);
    return id === this.current.id ? structuredClone(this.current) : emptyHousehold(id);
  }
  save(h: Household): void {
    this.current = structuredClone(h);
    this.dirty = true;
  }
}

async function loadHousehold(db: D1Database, id: string): Promise<Household> {
  const row = await db.prepare("SELECT doc FROM households WHERE id = ?1").bind(id).first<{ doc: string }>();
  if (!row) return emptyHousehold(id);
  try {
    return JSON.parse(row.doc) as Household;
  } catch {
    return emptyHousehold(id);
  }
}

async function saveHousehold(db: D1Database, h: Household): Promise<void> {
  await db
    .prepare("INSERT INTO households (id, doc, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at")
    .bind(h.id, JSON.stringify(h), new Date().toISOString())
    .run();
}

function corsHeaders(origin: string | null, allowed: Set<string>): Record<string, string> {
  if (!origin || !allowed.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": CORS_METHODS.join(", "),
    "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS.join(", "),
    "Access-Control-Expose-Headers": CORS_EXPOSED_HEADERS.join(", "),
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
}

const rpcError = (status: number, message: string, cors: Record<string, string>) => json(status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null }, cors);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // workers.dev also answers plain HTTP. Send everything to HTTPS (308 keeps the method for MCP POSTs).
    if (url.protocol === "http:" || /"scheme":"http"/.test(request.headers.get("cf-visitor") ?? "")) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    const allowed = buildAllowedOrigins({ publicUrl: env.PUBLIC_URL, extra: env.ALLOWED_ORIGINS });
    allowed.add(url.origin);
    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin, allowed);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/mcp") {
      // Spec: servers MUST validate Origin on the MCP endpoint (DNS-rebinding protection).
      if (origin && !allowed.has(origin)) return rpcError(403, "Forbidden origin", cors);
      let householdId: string;
      let clock;
      try {
        ({ householdId, clock } = resolveRequestContext((n) => request.headers.get(n), { allowDemoClock: env.HOMEMEND_ALLOW_DEMO_CLOCK !== "false" }));
      } catch (err) {
        return rpcError(400, err instanceof RequestContextError ? err.message : "Bad request", cors);
      }
      const store = new RequestStore(await loadHousehold(env.DB, householdId));
      const server = createHomeMendServer({ store, householdId, clock, view: VIEW });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try {
        await server.connect(transport);
        const res = await transport.handleRequest(request);
        // Drain the body first: tool handlers run while the response is produced, and we must
        // persist their writes before the client can issue its next request.
        const body = await res.arrayBuffer();
        if (store.dirty) await saveHousehold(env.DB, store.current);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(cors)) headers.set(k, v);
        return new Response(body, { status: res.status, headers });
      } catch (err) {
        console.error("[homemend] transport error", err);
        return rpcError(500, "Internal error", cors);
      } finally {
        ctx.waitUntil(Promise.allSettled([transport.close(), server.close()]));
      }
    }

    if (url.pathname === "/health") {
      return json(200, { ok: true, server: SERVER_INFO, transport: "streamable-http", protocol: ["2025-11-25", "2026-07-28"], view: VIEW.uri, storage: "cloudflare-d1", runtime: "cloudflare-workers", time: new Date().toISOString() }, cors);
    }

    if (url.pathname === "/sandbox.html") {
      return new Response(SANDBOX_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": sandboxCspHeader(url.searchParams.get("csp")), "cache-control": "no-store" } });
    }

    if (url.pathname === "/") return new Response(landingHtml(true, "Cloudflare D1"), { headers: { "content-type": "text/html; charset=utf-8" } });

    // Anything else: static assets already had their chance before the Worker ran.
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
