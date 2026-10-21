# Deploying HomeMend (live through judging, Nov 9–20, 2026)

The Alexa+ track requires the MCP server to be reachable for the whole judging window. HomeMend has
two equivalent runtimes:

| Runtime | Entry point | Storage | Use |
|---|---|---|---|
| Node 20+ | `server/src/main.ts` (Express + `@modelcontextprotocol/node`) | JSON files (`server/data/`) | local dev, Docker, any VM/PaaS |
| Cloudflare Workers | `worker/src/worker.ts` (`WebStandardStreamableHTTPServerTransport`) | D1 (SQLite) | **recommended hosted deployment** |

Both expose the same endpoints: `POST /mcp`, `GET /health`, `GET /sandbox.html`, `GET /` and the
simulator at `/sim/`. The same smoke test (`pnpm -C server smoke <url>`) and the same conformance
checker pass against both.

## Why Cloudflare Workers (evidence gathered 2026-10-21)

Requirements: zero cost, HTTPS, always-on until Nov 20, durable state, no surprise bills.

| Option | Cost | Always on? | Durable state | Verdict |
|---|---|---|---|---|
| **Cloudflare Workers Free + D1** | $0; no payment method needed for the Free plan | Yes (no sleep; 100k req/day, 10 ms CPU/request — our requests take 4–10 ms *wall* locally) | D1: 5M row reads/day, 100k writes/day, 5 GB ([pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/workers/platform/limits/)) | **Chosen** |
| Render Free | $0 | **No** — spins down after inactivity, ~30–60 s cold start; a judge's first MCP call would time out | **No** — ephemeral disk, data lost on every restart | Rejected |
| Fly.io | Pay-as-you-go; requires a card | Yes | Volumes (paid) | Rejected (cost, card) |
| Supabase Edge Functions Free | $0 | **No** — free projects pause after 7 days of inactivity | Postgres | Rejected (pause risk during judging) |
| AWS (App Runner/Lambda + DynamoDB) | Free tier needs an AWS account + card | Yes | DynamoDB | Not available (owner has no AWS account) |

The Worker keeps the Node design (stateless, one MCP server instance per request) and adds one
guarantee: the household document is loaded from D1 before the request is handled and **written back
before the HTTP response is returned**, so a judge's next request always observes the previous write.
Static simulator assets are served by Workers Static Assets (free and unlimited).

## One-time setup (owner action — needs a Cloudflare account)

1. Create a free Cloudflare account (no card): <https://dash.cloudflare.com/sign-up>.
2. In the repo, log in once (opens the browser; approve the Wrangler OAuth prompt):

   ```sh
   cd homemend/worker
   PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm exec wrangler login     # wrangler needs Node ≥ 22
   ```

3. Create the database and paste its id into `wrangler.jsonc` (`database_id`):

   ```sh
   pnpm exec wrangler d1 create homemend
   ```

4. Deploy (builds the view + simulator, applies the migration, uploads the Worker):

   ```sh
   pnpm deploy
   ```

   The output prints the URL, e.g. `https://homemend.<account>.workers.dev`.

5. Verify from anywhere:

   ```sh
   pnpm -C ../server smoke https://homemend.<account>.workers.dev/mcp
   node ../../mcp-http-conformance/src/cli.js https://homemend.<account>.workers.dev/mcp
   ```

   Open `https://homemend.<account>.workers.dev/sim/` for the Alexa+ simulator.

### Optional hardening

- `HOMEMEND_ALLOW_DEMO_CLOCK=false` in `wrangler.jsonc` `vars` disables the "advance a day" header.
- `ALLOWED_ORIGINS` adds extra browser origins (the Worker's own origin is always allowed; all other
  origins get 403 on `/mcp`, as the MCP spec requires).

## Local development of the Worker (no account needed)

```sh
cd homemend/worker
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm dev        # workerd + local D1 at http://127.0.0.1:8788
pnpm -C ../server smoke http://127.0.0.1:8788/mcp
```

## Docker / VM alternative (Node runtime)

`Dockerfile`, `render.yaml` and `fly.toml` remain for the Node runtime. Mount a volume at
`HOMEMEND_DATA_DIR` for persistence and set `PUBLIC_URL` to the public origin.
