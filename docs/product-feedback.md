# Product feedback — HomeMend (Alexa+ track)

Everything below was experienced while building HomeMend on 2026-10-21. Nothing is hypothetical.

## Tools, APIs and SDKs used, and for what

| Tool | Version | Used for |
|---|---|---|
| MCP TypeScript SDK v2: `@modelcontextprotocol/server`, `/node`, `/express`, `/client` | 2.3.1 / 2.1.1 / 2.0.2 / 2.3.1 | the server (Streamable HTTP, tools, resources), the simulator's client |
| MCP Apps extension `@modelcontextprotocol/ext-apps` | 2.0.3 | `registerAppTool` / `registerAppResource` on the server; `App` in the view; `AppBridge` + `PostMessageTransport` in the host |
| MCP specification 2025-11-25 (transports, lifecycle) | — | protocol behaviour, verified with raw curl and the conformance checker |
| Alexa+ add-on documentation (MCP Toolkit overview, client lifecycle, design guide: conversation surface, display modes, components & patterns, visual foundations, layout & rendering) | pages dated up to Jul 2026 | tool/result design (`structuredContent` + speakable text), card patterns, tokens, 768×480 canvas, content-hashed `ui://` URIs |
| Devpost hackathon site, FAQ, discussion board | — | rules, staff clarifications |
| Node 20 / pnpm 12 / Vite 8 / Vitest 5 / TypeScript 7 | — | build, tests |

## What worked well

- **SDK v2 + Streamable HTTP**: the stateless pattern (one `McpServer` + `NodeStreamableHTTPServerTransport` per request) worked first time; `enableJsonResponse` gave sub-100 ms tool calls locally. Version negotiation from a 2026-07-28 SDK down to a 2025-11-25 client was transparent.
- **`createMcpExpressApp`** applies Host/Origin protection sensibly for localhost binds.
- **ext-apps**: `registerAppTool` normalises `_meta.ui`; `App.callServerTool` + `updateModelContext` + `sendMessage` gave a clean "touch is a real tools/call" model. The `basic-host` example was the single most useful reference for the host side.
- **Alexa+ design guide**: the component rules (3–5 carousel items, first item < 500 ms, structured confirmation data for later recall questions, dark+light, content-hashed URIs) are concrete and directly shaped the tool results.
- **Discussion board**: Amazon staff answers were fast and decisive (emulator OK, own simulator OK, replay mode OK, live-through-judging requirement).

## What needs work

1. **Alexa+ docs are not reachable to participants in several places**: `/docs/alexaplus/add-ons/mcp-toolkit-quickstart` has no code sample for a server; the overview says "available to select partners only" while individual pages read as open onboarding. The npm package `@alexa-ai/cli` 404s. Three separate board threads hit the same `AssumeRole AddOn3PDeveloperToolsRead` wall. A single banner at the top of every add-on page ("Preview: hackathon participants build a self-hosted MCP server and demo it with their own host") would have saved hours.
2. **No published Alexa+ host contract for MCP Apps**: the lifecycle page shows `_meta.ui.resourceUri` and `invoking`/`invoked` strings but not the `hostContext` the webview passes (`deviceClass` values are only mentioned on the layout page), nor how Alexa renders `structuredContent` when there is no view ("hydrated" mode says "contact your Solutions Architect"). I had to guess `deviceClass: "echoShow8"`.
3. **The client lifecycle example sends `protocolVersion: "2025-03-26"`** while the rules and overview say 2025-11-25. Which one does the real Alexa+ client send today?
4. **SDK v2 docs site**: `/v2/clients/overview` returned 404; `/v2/serving/http` does not document `sessionIdGenerator`/`allowedOrigins` (they are in the `.d.mts`). The npm READMEs were better than the site.
5. **ext-apps `AppBridge`** property is `onsizechange` while the spec notification is `size-changed` and the view method is `sendSizeChanged` — easy to get wrong; TypeScript caught it, docs did not.
6. **View sizing**: nothing tells a view author that `document.documentElement` height inside the sandboxed iframe equals the iframe viewport, so a naive `ResizeObserver` reports no growth. Measuring the card element fixed it. A note in the quickstart would help.
7. **Devpost pages return 403 to non-browser fetchers**, so automated rule checks/agents cannot read the rules; the FAQ had an incorrect Bee statement for weeks (acknowledged by staff).
8. **No way to test elicitation or account linking** without the toolkit; I designed around it (clarification is returned as structured content instead of `elicitation/create`).

## Onboarding (zero → hello world)

About 45 minutes from reading the rules to a server answering `initialize` with `2025-11-25`, almost all of it spent discovering that SDK v2 is a different package family (`@modelcontextprotocol/server` vs the v1 `sdk`) and reading the type definitions for `registerTool`. Once found, the APIs are coherent. The MCP Apps host side took longer (~2 h) because the only reference is an example app, not a guide.

## Would I build with these again?

**Yes.** MCP + MCP Apps is a genuinely good surface for an assistant add-on: one server, structured results, interactive cards, and the same code serves Alexa+, Claude and Cursor. The gaps are documentation and access, not technology. I would build the production HomeMend on the same stack the day the Alexa+ toolkit opens.
