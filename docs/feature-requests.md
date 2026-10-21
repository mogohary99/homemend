# Feature requests

| Request | Why it matters to HomeMend | Priority |
|---|---|---|
| **Public Alexa+ MCP host simulator** (even a static web page that renders MCP Apps with the real `hostContext`, speech, and the hydrated data-only layout) | Every Alexa+ entrant rebuilt a different host; results are not comparable and nobody can verify how their `structuredContent` sounds or looks on an Echo Show | Critical |
| **Documented `hostContext` for Alexa+ webviews**: `deviceClass` enum, canvas sizes per class, theme tokens as CSS variables | Needed to make one view work on Echo Show 8/15/21, Fire TV and mobile without guessing | Important |
| **Proactive follow-ups from add-ons** (a server-initiated notification/`resources/updated` → Alexa proactive card "Your part arrived, want to install it?") | HomeMend schedules follow-ups; today the person must ask. Proactive delivery is the difference between a tool and an agent | Important |
| **Elicitation examples for Alexa+** (how form-mode `elicitation/create` is rendered and spoken) | Clarifying "which dishwasher?" is a natural voice turn; I had to fall back to returning options as structured content | Important |
| **Purchasing primitive**: a standard "confirm purchase" interaction that Alexa+ renders with its own trusted UI, taking `structuredContent.quote` and returning a confirmation token | Two-phase ordering should not rely on each add-on's own confirmation card | Important |
| **Account-linked household identity in `_meta`** (a stable, opaque household id on every `tools/call`) | HomeMend keys all state by household; today I use a header that only my simulator sends | Important |
| **`ui://` resource caching guidance + ETag support** | Views are 60–250 KB; Alexa recommends content-hashed URIs but the client caching behaviour is unspecified | Nice-to-have |
| **A rules page in Markdown + a submission JSON schema** | Lets entrants validate submissions automatically | Nice-to-have |
