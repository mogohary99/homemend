# Friction log — HomeMend

Severity: **Blocker** (no workaround), **High** (costly workaround), **Medium** (slowed me down), **Low** (annoyance).

| # | Task attempted | Steps taken | Expected | Actual | Severity | Workaround | Suggestion |
|---|---|---|---|---|---|---|---|
| 1 | Read the official rules programmatically to build a checklist | `WebFetch`/HTTP GET on `amazonappdev2026.devpost.com/rules` | HTML | **HTTP 403** for non-browser user agents | Medium | `curl` with a browser `User-Agent` | Allow read-only fetch of public rule pages, or publish rules as Markdown |
| 2 | Find the Alexa+ sample MCP server code | Opened `mcp-toolkit-quickstart` and `mcp-toolkit-overview` | A hello-world server with `structuredContent`/`_meta.ui` | Prose only; the CLI (`@alexa-ai/cli`) 404s on npm; several redirects (`/docs/vega/0.24/...` → `/docs/vega/latest`) return a bare "Redirect" page to fetchers | High | Used the MCP TS SDK docs + ext-apps quickstart instead | Ship a public `alexa-plus-mcp-addon-sample` repo even while the toolkit is in preview |
| 3 | Install SDK with npm workspaces | `npm install` in a workspace whose member folder had no `package.json` yet | Error naming the folder | `npm error Cannot read properties of null (reading 'edgesOut')` | Low | Switched to pnpm | (npm bug) |
| 4 | Register tools in SDK v2 | Searched ts.sdk docs for `registerTool` handler signature and `extra` param | API reference | `/v2/clients/overview` 404; tools page omits the second handler arg | Medium | Read `dist/index.d.mts` | Generate the v2 reference from the `.d.mts` |
| 5 | Make the MCP App card fill its iframe | Reported `documentElement` height via `sendSizeChanged` | Host grows the iframe | Height stayed at the initial 120 px because the document height equals the iframe viewport | Medium | Measure the card element + `MutationObserver` | Add a "sizing" note to the ext-apps quickstart |
| 6 | Wire `AppBridge` size events | Used `bridge.onsizechanged` (matches the notification name) | Compiles | `TS2551: Property 'onsizechanged' does not exist… Did you mean 'onsizechange'?` | Low | Renamed | Align property names with method names (`sendSizeChanged`) |
| 7 | Understand what Alexa+ sends in `hostContext` | Read lifecycle + layout pages | List of `deviceClass` values, dimensions | Only "`deviceClass` is authoritative"; values unspecified | Medium | Chose `echoShow8` | Publish the enum and per-class canvas sizes |
| 8 | Confirm which protocol version Alexa+ negotiates | Read lifecycle page | 2025-11-25 | Example shows `"protocolVersion": "2025-03-26"` | Low | Server supports both | Update the example |
| 9 | Reproduce "live through judging" cheaply | Looked for a sanctioned free host | Guidance | FAQ suggests Lambda; credits exhausted Oct 7; new AWS accounts report Bedrock quota 0 on the board | Medium | Dockerfile + Render/Fly configs; simulator can also be served by the server | Pre-provision a small hackathon-wide host or extend credits |
| 10 | Speech-driven demo in the simulator | Used Web Speech API | Works in Chrome | Works; Safari lacks `webkitSpeechRecognition` continuous results | Low | Text input fallback | n/a (browser) |

Time lost to items 1–4 and 7–8: roughly 2.5 hours of a 56-hour window.
