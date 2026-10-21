/**
 * HomeMend judge smoke test. Runs the real end-to-end journey against any deployment:
 *
 *   pnpm -C server smoke                       # local  http://127.0.0.1:3001/mcp
 *   pnpm -C server smoke https://host/mcp      # hosted
 *
 * What it proves: transport conformance basics (version negotiation, Origin validation, bad input
 * → 400/JSON-RPC errors), the multi-step repair flow, two-phase ordering, and persistence across
 * separate MCP clients ("sessions"). Exit code 1 if anything fails.
 */
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = process.argv[2] ?? "http://127.0.0.1:3001/mcp";
const household = `smoke-${Date.now().toString(36)}`;
const results: { name: string; ok: boolean; detail: string; ms: number }[] = [];

async function check(name: string, fn: () => Promise<string>) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err), ms: Math.round(performance.now() - t0) });
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { type: string; text?: string }[] };

async function connect(label: string, extraHeaders: Record<string, string> = {}) {
  const client = new Client({ name: `homemend-smoke-${label}`, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { "X-Homemend-Household": household, ...extraHeaders } },
  });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as ToolResult;
  return { client, call, close: () => client.close() };
}

const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };

await check("health endpoint", async () => {
  const r = await fetch(new URL("/health", url));
  assert(r.ok, `status ${r.status}`);
  const j = (await r.json()) as { ok: boolean; storage?: string; runtime?: string };
  assert(j.ok, "health not ok");
  return `storage=${j.storage ?? "fs"} runtime=${j.runtime ?? "node"}`;
});

await check("initialize negotiates 2025-11-25 (cold start timing)", async () => {
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } }),
  });
  assert(r.status === 200, `status ${r.status}`);
  const j = (await r.json()) as { result?: { protocolVersion?: string; serverInfo?: { name: string } } };
  assert(j.result?.protocolVersion === "2025-11-25", `negotiated ${j.result?.protocolVersion}`);
  return `server=${j.result?.serverInfo?.name}`;
});

await check("foreign Origin is rejected with 403", async () => {
  const r = await fetch(url, {
    method: "POST",
    headers: { ...headers, origin: "https://evil.example" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
  });
  assert(r.status === 403, `status ${r.status}`);
  return "403";
});

await check("invalid household header → 400", async () => {
  const r = await fetch(url, { method: "POST", headers: { ...headers, "X-Homemend-Household": "not valid!!" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }) });
  assert(r.status === 400, `status ${r.status}`);
  return "400";
});

await check("malformed JSON → 400", async () => {
  const r = await fetch(url, { method: "POST", headers, body: "{not json" });
  assert(r.status === 400, `status ${r.status}`);
  return "400";
});

let caseId = "";
let partId = "";
let orderId = "";

await check("session A: tools, brief, start case, first step", async () => {
  const a = await connect("A");
  try {
    const tools = await a.client.listTools();
    assert(tools.tools.length === 10, `expected 10 tools, got ${tools.tools.length}`);
    const brief = await a.call("get_household_brief");
    assert(!brief.isError, "brief errored");
    const started = await a.call("start_repair_case", { appliance: "the dishwasher", symptom: "it is not draining" });
    assert(!started.isError, "start_repair_case errored: " + JSON.stringify(started.content));
    const sc = started.structuredContent as { case?: { id: string }; case_id?: string; kind?: string } | undefined;
    caseId = (sc?.case_id as string) ?? sc?.case?.id ?? "";
    assert(caseId, "no case id in structuredContent: " + JSON.stringify(sc));
    const step = await a.call("report_step_result", { case_id: caseId, outcome: "not_fixed", observation: "filter was clean" });
    assert(!step.isError, "report_step_result errored");
    return `case=${caseId} kind=${(step.structuredContent as { kind?: string })?.kind}`;
  } finally {
    await a.close();
  }
});

await check("session B (new client): case persisted, continue to diagnosis", async () => {
  const b = await connect("B");
  try {
    const got = await b.call("get_case", { case_id: caseId });
    assert(!got.isError, "get_case errored");
    const sc = got.structuredContent as { case?: { case_id: string; steps: unknown[]; status: string } };
    assert(sc.case?.case_id === caseId, "case id mismatch");
    assert((sc.case?.steps.length ?? 0) >= 1, "steps from session A missing");
    // Walk the tree until a diagnosis (bounded).
    let kind = "";
    for (let i = 0; i < 8; i++) {
      const r = await b.call("report_step_result", { case_id: caseId, outcome: i === 2 ? "found_issue" : "not_fixed", observation: i === 2 ? "drain hose is kinked and cracked" : undefined });
      assert(!r.isError, `step ${i} errored: ` + JSON.stringify(r.content));
      kind = (r.structuredContent as { kind?: string })?.kind ?? "";
      if (kind !== "step" && kind !== "clarify") break;
    }
    return `status=${sc.case?.status} → ${kind}`;
  } finally {
    await b.close();
  }
});

await check("two-phase order: quote, then confirm", async () => {
  const c = await connect("C");
  try {
    const parts = await c.call("find_parts", { case_id: caseId });
    assert(!parts.isError, "find_parts errored: " + JSON.stringify(parts.content));
    const list = (parts.structuredContent as { parts?: { id: string }[] })?.parts ?? [];
    assert(list.length > 0, "no parts returned");
    partId = list[0].id;
    const quote = await c.call("order_part", { part_id: partId, case_id: caseId });
    assert(!quote.isError, "quote errored");
    const q = quote.structuredContent as { order?: { status: string; id: string } };
    assert(q.order?.status === "quoted", `expected quoted, got ${q.order?.status}`);
    orderId = q.order.id;
    const placed = await c.call("order_part", { part_id: partId, case_id: caseId, confirm: true });
    const p = placed.structuredContent as { order?: { status: string; id: string } };
    assert(p.order?.status === "placed", `expected placed, got ${p.order?.status}`);
    return `part=${partId} order=${p.order.id}`;
  } finally {
    await c.close();
  }
});

await check("session D: brief shows the placed order (persistence)", async () => {
  const d = await connect("D");
  try {
    const brief = await d.call("get_household_brief");
    const text = JSON.stringify(brief.structuredContent ?? brief.content);
    assert(text.includes(orderId) || text.includes(partId), "order not visible in brief");
    return "order visible";
  } finally {
    await d.close();
  }
});

await check("tool error path: unknown case id → isError", async () => {
  const e = await connect("E");
  try {
    const r = await e.call("get_case", { case_id: "case-does-not-exist" });
    assert(r.isError, "expected isError for unknown case");
    return r.content?.[0]?.text?.slice(0, 60) ?? "isError";
  } finally {
    await e.close();
  }
});

await check("household isolation: other household sees no cases", async () => {
  const client = new Client({ name: "homemend-smoke-F", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { "X-Homemend-Household": `${household}-other` } } });
  await client.connect(transport);
  try {
    const r = (await client.callTool({ name: "get_case", arguments: { case_id: caseId } })) as ToolResult;
    assert(r.isError, "other household could read our case");
    return "isolated";
  } finally {
    await client.close();
  }
});

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${String(r.ms).padStart(5)} ms  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed against ${url} (household ${household})`);
process.exit(failed ? 1 : 0);
