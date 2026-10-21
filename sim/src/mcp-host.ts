/**
 * The simulator's MCP host: a real MCP client over Streamable HTTP plus an MCP Apps host (AppBridge)
 * that renders HomeMend's `ui://` view inside a sandboxed iframe, exactly the way an Alexa+ device
 * would. Every JSON-RPC message is mirrored to the inspector so judges can see the protocol at work.
 */
import { Client, StreamableHTTPClientTransport, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import { AppBridge, PostMessageTransport, type McpUiResourceCsp, type McpUiResourcePermissions } from "@modelcontextprotocol/ext-apps/app-bridge";

export interface WireEvent {
  dir: "→" | "←";
  at: number;
  method?: string;
  id?: number | string;
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
  ms?: number;
}

export interface HostOptions {
  serverUrl: string;
  household: string;
  clockOverride?: string; // ISO; demo-only time travel
  onWire: (e: WireEvent) => void;
}

export class McpHost {
  client!: Client;
  tools = new Map<string, Tool>();
  protocolVersion?: string;
  serverName?: string;
  private viewCache = new Map<string, { html: string; csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions }>();
  constructor(private opts: HostOptions) {}

  get sandboxUrl() {
    return new URL("/sandbox.html", this.opts.serverUrl).href;
  }

  async connect() {
    const headers: Record<string, string> = { "X-Homemend-Household": this.opts.household };
    if (this.opts.clockOverride) headers["X-Homemend-Clock"] = this.opts.clockOverride;
    const onWire = this.opts.onWire;
    const loggingFetch: typeof fetch = async (input, init) => {
      const started = performance.now();
      let reqBody: unknown;
      try {
        reqBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      } catch {
        reqBody = init?.body;
      }
      const reqHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      if (reqBody) onWire({ dir: "→", at: Date.now(), method: (reqBody as any)?.method, id: (reqBody as any)?.id, headers: pickHeaders(reqHeaders), body: reqBody });
      const res = await fetch(input, init);
      const clone = res.clone();
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = await clone.json().catch(() => undefined);
        onWire({ dir: "←", at: Date.now(), status: res.status, id: (body as any)?.id, headers: pickHeaders(Object.fromEntries(res.headers.entries())), body, ms: Math.round(performance.now() - started) });
      } else if (res.status !== 200 || ct.includes("text/event-stream")) {
        onWire({ dir: "←", at: Date.now(), status: res.status, headers: pickHeaders(Object.fromEntries(res.headers.entries())), body: ct.includes("event-stream") ? "(SSE stream)" : await clone.text().catch(() => ""), ms: Math.round(performance.now() - started) });
      }
      return res;
    };
    // Default ("legacy") negotiation = the 2025-11-25 sequence the Alexa+ MCP client uses.
    this.client = new Client({ name: "Alexa+ experience (simulated)", version: "0.1.0" }, { capabilities: { elicitation: {} } });
    const transport = new StreamableHTTPClientTransport(new URL(this.opts.serverUrl), { requestInit: { headers }, fetch: loggingFetch });
    await this.client.connect(transport);
    this.serverName = this.client.getServerVersion()?.name;
    this.protocolVersion = (transport as any).protocolVersion ?? (this.client as any)._transport?.protocolVersion;
    const list = await this.client.listTools();
    this.tools = new Map(list.tools.map((t) => [t.name, t]));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await this.client.callTool({ name, arguments: args })) as CallToolResult;
  }

  uiResourceUri(toolName: string): string | undefined {
    const t = this.tools.get(toolName);
    const meta = t?._meta as any;
    return meta?.ui?.resourceUri ?? meta?.["ui/resourceUri"];
  }

  async readView(uri: string) {
    const cached = this.viewCache.get(uri);
    if (cached) return cached;
    const r = await this.client.readResource({ uri });
    const c = r.contents[0] as any;
    if (!c || c.mimeType !== "text/html;profile=mcp-app") throw new Error(`Resource ${uri} is not an MCP App view`);
    const meta = c._meta?.ui ?? {};
    const v = { html: c.text as string, csp: meta.csp as McpUiResourceCsp | undefined, permissions: meta.permissions as McpUiResourcePermissions | undefined };
    this.viewCache.set(uri, v);
    return v;
  }

  /**
   * Mount an MCP App for a tool call inside `iframe` and feed it the result.
   * Mirrors examples/basic-host from the ext-apps repo (sandbox proxy on a different origin).
   */
  async mountApp(
    iframe: HTMLIFrameElement,
    toolName: string,
    input: Record<string, unknown>,
    resultPromise: Promise<CallToolResult>,
    cb: { onMessage: (text: string) => void; onModelContext: (text: string | undefined, sc: unknown) => void; onDisplayMode: (m: string) => void; theme: "dark" | "light" },
  ): Promise<AppBridge> {
    const uri = this.uiResourceUri(toolName);
    if (!uri) throw new Error("tool has no UI");
    const view = await this.readView(uri);
    const tool = this.tools.get(toolName)!;
    const caps = this.client.getServerCapabilities();
    const bridge = new AppBridge(
      this.client,
      { name: "Alexa+ experience (simulated)", version: "0.1.0" },
      { openLinks: {}, serverTools: caps?.tools, serverResources: caps?.resources, updateModelContext: { text: {} } },
      {
        hostContext: {
          theme: cb.theme,
          platform: "web",
          displayMode: "inline",
          availableDisplayModes: ["inline", "fullscreen"],
          containerDimensions: { maxHeight: 2000 },
          locale: "en-US",
          deviceClass: "echoShow8",
          toolInfo: { tool },
        } as any,
      },
    );
    bridge.onmessage = async (params) => {
      const text = params.content.map((c: any) => (c.type === "text" ? c.text : "")).join(" ");
      cb.onMessage(text);
      return {};
    };
    bridge.onupdatemodelcontext = async (params) => {
      const text = params.content?.map((c: any) => (c.type === "text" ? c.text : "")).join(" ");
      cb.onModelContext(text, params.structuredContent);
      return {};
    };
    bridge.onopenlink = async (params) => {
      window.open(params.url, "_blank", "noopener,noreferrer");
      return {};
    };
    bridge.onsizechange = (params) => {
      if (params.height) iframe.style.height = `${Math.ceil(params.height)}px`;
    };
    bridge.onrequestdisplaymode = async (params) => {
      cb.onDisplayMode(params.mode);
      return { mode: params.mode };
    };
    const initialized = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    // Load the sandbox proxy (served by the HomeMend server origin) and wait for it to be ready.
    const proxyReady = new Promise<void>((resolve) => {
      const l = (e: MessageEvent) => {
        if (e.source === iframe.contentWindow && e.data?.method === "ui/notifications/sandbox-proxy-ready") {
          window.removeEventListener("message", l);
          resolve();
        }
      };
      window.addEventListener("message", l);
    });
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
    const url = new URL(this.sandboxUrl);
    if (view.csp) url.searchParams.set("csp", JSON.stringify(view.csp));
    iframe.src = url.href;
    await proxyReady;
    await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
    await bridge.sendSandboxResourceReady({ html: view.html, csp: view.csp, permissions: view.permissions });
    await initialized;
    await bridge.sendToolInput({ arguments: input });
    resultPromise.then(
      (r) => bridge.sendToolResult(r),
      (e) => bridge.sendToolCancelled({ reason: e instanceof Error ? e.message : String(e) }),
    );
    return bridge;
  }
}

function pickHeaders(h: Record<string, string>) {
  const keep = ["content-type", "accept", "mcp-protocol-version", "mcp-session-id", "x-homemend-household", "x-homemend-clock"];
  return Object.fromEntries(Object.entries(h).filter(([k]) => keep.includes(k.toLowerCase())));
}
