# HomeMend — a household repair agent for Alexa+

> "Alexa, the dishwasher isn't draining." → one safe check at a time → diagnosis → the right part for *your* model → confirmed order → a follow-up the day it arrives → "Fixed and logged."

HomeMend is a **self-hosted MCP server** (Model Context Protocol, spec **2025-11-25+ over Streamable HTTP**) that gives Alexa+ a household repair and maintenance agent, plus a **simulated Alexa+ host** (a real MCP client with MCP Apps rendering) because the Alexa+ add-on toolkit is not available to hackathon participants.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026**, Alexa+ track.

**Live:** `https://homemend.strongkit.workers.dev/mcp` (Cloudflare Workers + D1, up through judging) · simulator at `https://homemend.strongkit.workers.dev/sim/` · `docs/deploy.md` explains the hosting.

## Why it is not a chatbot

| What Alexa+ judges called *creative* | HomeMend |
|---|---|
| Agentic workflow that orchestrates across services | triage engine → parts catalog → ordering → follow-up scheduler → maintenance calendar, driven by 10 tools |
| Context-aware add-on that maintains state across sessions | every case, order and reminder is persisted per household; reopen the conversation days later from any device |
| Purchasing capabilities | two-phase purchase: `order_part` quotes first, places only after an explicit confirmation turn |
| Media support (cards, carousels) / MCP Apps | one MCP App view renders step cards, parts carousel, order confirmation, home brief, case history; every button is a real `tools/call` |

The LLM (Alexa+) owns language. HomeMend owns the safety-reviewed procedure and the state of where the household is in it.

## Architecture

```
┌──────────────────────────────┐      Streamable HTTP (JSON-RPC)      ┌──────────────────────────────┐
│  Alexa+ (simulated host)     │ ───── POST /mcp  initialize ───────▶ │  HomeMend MCP server (Node)   │
│  sim/  · real MCP client     │ ◀──── tools/list, tools/call ─────── │  server/src/mcp.ts  10 tools  │
│  · rule-based planner        │ ───── resources/read ui://… ───────▶ │  server/src/engine.ts         │
│  · MCP Apps host (AppBridge) │                                       │  server/src/knowledge.ts      │
│  · speech in/out (browser)   │  sandbox proxy  GET /sandbox.html     │  server/src/catalog.ts        │
│  · MCP inspector             │ ◀──────────────────────────────────── │  server/src/store.ts (JSON)   │
└──────────────────────────────┘                                       └──────────────────────────────┘
         ▲ iframe (opaque origin)                                                ▲ reads dist-ui/view.html
         └── MCP App view  server/ui/view.ts  (ui://homemend/view-<hash>.html)  ┘
```

- **Transport**: `@modelcontextprotocol/server` 2.3.1 + `@modelcontextprotocol/node` Streamable HTTP, stateless (one server per request), JSON responses, Origin validation (403), per-household identity via `X-Homemend-Household` (in production this comes from the account-linked token).
- **Protocol**: the SDK implements 2026-07-28 and negotiates down; the simulator requests **2025-11-25** and the inspector shows the negotiated version. A raw `initialize` with `protocolVersion: "2025-11-25"` returns `2025-11-25` (covered by tests).
- **MCP Apps**: `registerAppTool` / `registerAppResource` from `@modelcontextprotocol/ext-apps` 2.0.3; view is a single self-contained HTML bundle (Vite + singlefile), content-hashed URI, `prefersBorder`, dark/light via host theme, Alexa+ visual tokens (card `#14181E`, nested `#1B2028`, 768×480 base canvas).
- **State**: `FileStore` (atomic JSON per household) behind a `Store` interface; `MemoryStore` for tests. Swap for DynamoDB without touching the engine.
- **Knowledge**: 10 hand-authored triage trees (dishwasher ×2, washer, dryer, refrigerator, oven, disposal, water heater, AC, router) with safety notes, escalation nodes and part types; a fictional-brand demo parts catalog with model fitment.

### Tools

| Tool | Purpose | UI |
|---|---|---|
| `get_household_brief` | what needs attention: open cases, arrivals, follow-ups, maintenance due | brief |
| `list_appliances` / `register_appliance` | household registry (also seeds maintenance intervals) | list |
| `start_repair_case` | opens/resumes a case, returns step 1; clarifies if ambiguous | step card |
| `report_step_result` | `fixed` / `not_fixed` / `found_issue` / `skipped` → next step, diagnosis, escalation, or resolution | step / diagnosis / resolved |
| `get_case` | history, status, order, delivery | case |
| `find_parts` | best-match parts with fitment, price, delivery | carousel |
| `order_part` | quote → confirm (never places without `confirm: true`) | order |
| `schedule_followup` / `complete_maintenance_task` | reminders and the preventive loop | case / brief |

## Run it

Requirements: Node 20+, pnpm 9+ (`corepack enable`).

```bash
pnpm install
pnpm -C server build:ui      # builds the MCP App view (server/dist-ui/view.html)
pnpm -C server dev           # MCP server on http://127.0.0.1:3001/mcp
pnpm -C sim dev              # simulator on http://localhost:5173
```

Open http://localhost:5173, press **▶ Guided demo**, or type/say:

1. "What needs attention at home?"
2. "The dishwasher isn't draining, there's water at the bottom"
3. "I checked, the filter is clean" → "I found it, the drain hose is cracked near the clamp"
4. "Show me the parts" → "Order the first one" → "Yes, place the order"
5. **Advance a day** (demo clock) → "What needs attention at home?" → tap **Install** → **Installed — it works**

Reload the page: the conversation resumes from the server's state.

### Talk to it from any MCP client

```bash
curl -s -X POST http://127.0.0.1:3001/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Claude Desktop / Claude Code / Cursor: add `http://127.0.0.1:3001/mcp` as a Streamable HTTP server. Any host that supports MCP Apps renders the cards; others get the text summaries.

## Tests

```bash
pnpm -C server test         # 12 tests: engine state machine + real MCP client over Streamable HTTP
pnpm -C server typecheck
```

`test/mcp.test.ts` boots the Express app, connects `@modelcontextprotocol/client` over Streamable HTTP, runs the full journey through `tools/call`, verifies state survives a new session, Origin rejection (403), household-id validation (400), and the raw 2025-11-25 handshake.

## Deploy (must stay live through judging)

- **Docker**: `docker build -t homemend . && docker run -p 3001:3001 -e PUBLIC_URL=https://your.host homemend`
- **Render**: `render.yaml` blueprint (free plan; sleeps when idle, wakes on first request).
- **Fly.io**: `fly launch --copy-config` with `fly.toml` (persistent volume for `/data`).

Environment: `PORT`, `HOST`, `PUBLIC_URL`, `ALLOWED_ORIGINS` (comma list, for a separately hosted simulator), `HOMEMEND_DATA_DIR`, `HOMEMEND_ALLOW_DEMO_CLOCK=false` to disable the demo time-travel header.

## What is simulated, what is real

- **Real**: the MCP server, its protocol handling, state, tools, the MCP App views, the simulator's MCP client and MCP Apps host, the JSON-RPC traffic in the inspector.
- **Simulated**: the Alexa+ layer. Nobody can reach Alexa+ from this hackathon, so a deterministic planner (`sim/src/planner.ts`) picks a tool for each utterance, and the browser speaks the tool's text content. In production Alexa+ does both with an LLM and this server does not change.
- **Demo data**: fictional appliance brands and a demo parts catalog, on purpose (no third-party trademarks). The `X-Homemend-Clock` header is a documented demo control to show delivery-day follow-ups.

## License

MIT © 2026 Mohamed Gohary
