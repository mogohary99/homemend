/**
 * End-to-end: real MCP client over Streamable HTTP against the real Express app.
 * Verifies protocol negotiation (2025-11-25), tool listing with MCP Apps metadata, a full
 * repair journey through tools/call, the UI resource, and the Origin check.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createApp } from "../src/main.js";
import { MemoryStore } from "../src/store.js";

let http: Server;
let url: URL;
const view = { uri: "ui://homemend/view-test.html", html: "<!doctype html><html><body>view</body></html>" };

beforeAll(async () => {
  const app = createApp({ store: new MemoryStore(), view, clock: { now: () => new Date("2026-10-21T10:00:00Z") } });
  await new Promise<void>((r) => {
    http = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = http.address();
  if (typeof addr === "object" && addr) url = new URL(`http://127.0.0.1:${addr.port}/mcp`);
});
afterAll(async () => {
  await new Promise<void>((r) => http.close(() => r()));
});

async function connect(household = "test-house") {
  const client = new Client({ name: "homemend-test-client", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { "X-Homemend-Household": household } } });
  await client.connect(transport);
  return client;
}

describe("HomeMend over Streamable HTTP", () => {
  it("negotiates a 2025-11-25-era protocol version and advertises tools + the UI resource", async () => {
    const client = await connect();
    expect(client.getServerVersion()?.name).toBe("homemend");
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["complete_maintenance_task", "find_parts", "get_case", "get_household_brief", "list_appliances", "order_part", "register_appliance", "report_step_result", "schedule_followup", "start_repair_case"].sort(),
    );
    const start = tools.tools.find((t) => t.name === "start_repair_case")!;
    expect((start._meta as any)?.ui?.resourceUri).toBe(view.uri);
    const resources = await client.listResources();
    expect(resources.resources[0].uri).toBe(view.uri);
    const read = await client.readResource({ uri: view.uri });
    expect(read.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    await client.close();
  });

  it("runs the dishwasher journey end to end through tools/call", async () => {
    const client = await connect("journey");
    const s1 = (await client.callTool({ name: "start_repair_case", arguments: { appliance: "dishwasher", symptom: "not draining" } })) as any;
    expect(s1.isError).toBeFalsy();
    expect(s1.structuredContent.kind).toBe("step");
    expect(s1.content[0].text).toMatch(/Step 1/);
    const caseId = s1.structuredContent.case_id as string;

    const s2 = (await client.callTool({ name: "report_step_result", arguments: { case_id: caseId, outcome: "not_fixed" } })) as any;
    expect(s2.structuredContent.step.id).toBe("drain_hose");

    const d = (await client.callTool({ name: "report_step_result", arguments: { case_id: caseId, outcome: "found_issue", observation: "cracked hose" } })) as any;
    expect(d.structuredContent.kind).toBe("diagnosis");

    const parts = (await client.callTool({ name: "find_parts", arguments: { case_id: caseId } })) as any;
    expect(parts.structuredContent.parts.length).toBeGreaterThan(0);
    const partId = parts.structuredContent.parts[0].id;

    const quote = (await client.callTool({ name: "order_part", arguments: { part_id: partId, case_id: caseId } })) as any;
    expect(quote.structuredContent.phase).toBe("quote");
    const placed = (await client.callTool({ name: "order_part", arguments: { part_id: partId, case_id: caseId, confirm: true } })) as any;
    expect(placed.structuredContent.phase).toBe("placed");

    const brief = (await client.callTool({ name: "get_household_brief", arguments: {} })) as any;
    expect(brief.structuredContent.open_cases[0].status).toBe("awaiting_part");
    await client.close();

    // A *new session* for the same household sees the same state (state across sessions).
    const client2 = await connect("journey");
    const c = (await client2.callTool({ name: "get_case", arguments: {} })) as any;
    expect(c.structuredContent.case.case_id).toBe(caseId);
    expect(c.structuredContent.case.status).toBe("awaiting_part");
    await client2.close();
  });

  it("returns isError results for domain errors instead of protocol errors", async () => {
    const client = await connect("errors");
    const r = (await client.callTool({ name: "start_repair_case", arguments: { appliance: "toaster", symptom: "smoke" } })) as any;
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("not_found");
    await client.close();
  });

  it("rejects disallowed Origins with 403 and bad household ids with 400", async () => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "https://evil.example" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "1" } } }) });
    expect(res.status).toBe(403);
    const bad = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-homemend-household": "../etc" }, body: "{}" });
    expect(bad.status).toBe(400);
    const health = await (await fetch(new URL("/health", url))).json();
    expect(health.ok).toBe(true);
  });

  it("speaks raw Streamable HTTP: initialize returns protocolVersion 2025-11-25 when asked", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "curl", version: "1" } } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.serverInfo.name).toBe("homemend");
  });
});
