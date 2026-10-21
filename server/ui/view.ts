/**
 * HomeMend MCP App view.
 *
 * Rendered by the host (Alexa+, or the simulator) inside a sandboxed iframe. It receives the tool
 * result via `ui/notifications/tool-result`, renders a card for the result `kind`, and lets the person
 * continue by touch: every button is a real `tools/call` through the host (app.callServerTool).
 * After an app-initiated call it re-renders and informs the host via updateModelContext so the
 * conversation stays in sync with what is on screen.
 */
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";

type Dict = Record<string, any>;

const app = new App({ name: "HomeMend view", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
const root = document.getElementById("root")!;
let current: Dict | undefined;
let busy = false;

// ---------- host integration ----------
app.ontoolresult = (result: CallToolResult) => {
  render(result);
};
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
});

// Report the card's content height (not the iframe viewport) so the host can size the frame.
const reportSize = () => {
  const card = root.firstElementChild as HTMLElement | null;
  const h = Math.ceil((card ?? root).getBoundingClientRect().height);
  const w = Math.ceil(root.getBoundingClientRect().width);
  if (h > 0) void app.sendSizeChanged({ height: h, width: w }).catch(() => {});
};
new ResizeObserver(reportSize).observe(root);
const mo = new MutationObserver(() => requestAnimationFrame(reportSize));
mo.observe(root, { childList: true, subtree: true });

async function call(name: string, args: Dict, label: string) {
  if (busy) return;
  busy = true;
  root.classList.add("busy");
  try {
    // Tell the conversation what the person did by touch.
    void app.sendMessage({ role: "user", content: [{ type: "text", text: label }] }).catch(() => {});
    const result = await app.callServerTool({ name, arguments: args });
    render(result as CallToolResult);
    const text = (result as CallToolResult).content?.find((c: any) => c.type === "text") as { text: string } | undefined;
    void app
      .updateModelContext({ content: text ? [{ type: "text", text: text.text }] : [], structuredContent: (result as CallToolResult).structuredContent as Dict })
      .catch(() => {});
  } catch (err) {
    renderError(err instanceof Error ? err.message : String(err));
  } finally {
    busy = false;
    root.classList.remove("busy");
  }
}

// ---------- rendering ----------
function render(result: CallToolResult) {
  const sc = (result.structuredContent ?? {}) as Dict;
  current = sc;
  if (result.isError || sc.kind === "error") {
    renderError(sc.message ?? (result.content?.[0] as any)?.text ?? "Something went wrong.");
    return;
  }
  const renderers: Record<string, (v: Dict) => HTMLElement> = {
    step: renderStep,
    diagnosis: renderDiagnosis,
    escalate: renderEscalate,
    resolved: renderResolved,
    clarify: renderClarify,
    parts: renderParts,
    order: renderOrder,
    brief: renderBrief,
    appliances: renderAppliances,
    case: renderCase,
  };
  const fn = renderers[sc.kind];
  root.replaceChildren(fn ? fn(sc) : card([el("p", { class: "body" }, (result.content?.[0] as any)?.text ?? "")]));
}

function renderError(message: string) {
  root.replaceChildren(card([el("div", { class: "row" }, [pill("Couldn't do that", "danger")]), el("p", { class: "body" }, message)]));
}

function renderStep(v: Dict) {
  const pct = Math.min(100, Math.round((v.step_number / Math.max(v.total_steps_estimate, v.step_number)) * 100));
  const children: HTMLElement[] = [
    el("div", { class: "row between" }, [el("span", { class: "eyebrow" }, `${v.appliance.label} · ${v.tree_title}`), pill(`Step ${v.step_number} of ~${v.total_steps_estimate}`)]),
    el("div", { class: "progress" }, [el("div", { style: `width:${pct}%` })]),
    el("div", { class: "hero" }, [el("div", { class: "stepnum" }, String(v.step_number)), el("h1", { class: "title" }, v.step.title)]),
    el("p", { class: "body" }, v.step.instruction),
  ];
  if (v.step.safety) children.push(el("div", { class: "safety" }, [el("strong", {}, "Safety first. "), document.createTextNode(v.step.safety)]));
  const meta: HTMLElement[] = [];
  if (v.step.minutes) meta.push(pill(`~${v.step.minutes} min`));
  if (v.appliance.model) meta.push(pill(`Model ${v.appliance.model}`));
  if (meta.length) children.push(el("div", { class: "row" }, meta));
  children.push(
    el("div", { class: "actions" }, [
      btn("That fixed it", "success", () => call("report_step_result", { case_id: v.case_id, outcome: "fixed" }, "That fixed it")),
      btn("No change", "", () => call("report_step_result", { case_id: v.case_id, outcome: "not_fixed" }, "No change")),
      btn("I found something", "primary", () => askObservation(v.case_id)),
      btn("Skip", "", () => call("report_step_result", { case_id: v.case_id, outcome: "skipped" }, "Skip this step")),
    ]),
  );
  return card(children);
}

function askObservation(caseId: string) {
  const ta = el("textarea", { rows: "2", placeholder: "What did you find? e.g. the hose is cracked near the clamp", "aria-label": "What did you find" }) as HTMLTextAreaElement;
  const box = card([
    el("span", { class: "eyebrow" }, "What did you find?"),
    ta,
    el("div", { class: "actions" }, [
      btn("Send", "primary", () => call("report_step_result", { case_id: caseId, outcome: "found_issue", observation: ta.value.trim() || "found a problem" }, `I found something: ${ta.value.trim() || "a problem"}`)),
      btn("Back", "", () => current && render({ content: [], structuredContent: current } as any)),
    ]),
  ]);
  root.replaceChildren(box);
  ta.focus();
}

function renderDiagnosis(v: Dict) {
  const children: HTMLElement[] = [
    el("div", { class: "row between" }, [el("span", { class: "eyebrow" }, `${v.appliance.label} · Diagnosis`), pill(`${v.diagnosis.confidence} confidence`, v.diagnosis.confidence === "high" ? "ok" : "warn")]),
    el("h1", { class: "title" }, v.diagnosis.summary),
    el("div", { class: "row" }, [pill(v.diagnosis.diy ? "DIY friendly" : "Technician recommended", v.diagnosis.diy ? "ok" : "warn"), ...v.diagnosis.part_types.map((p: string) => pill(p.replace(/_/g, " ")))]),
  ];
  if (v.recommended_parts?.length) {
    const top = v.recommended_parts[0];
    children.push(
      el("div", { class: "nested row between" }, [
        el("div", {}, [el("div", { class: "subtitle" }, top.name), el("div", { class: "small muted" }, `${top.price} · ${top.delivery}${top.fitment === "verified" ? " · Fits your model" : ""}`)]),
        btn("See parts", "primary", () => call("find_parts", { case_id: v.case_id }, "Show me the parts")),
      ]),
    );
  }
  children.push(el("p", { class: "small muted" }, `After the repair: ${v.diagnosis.verify_hint}`));
  return card(children);
}

function renderEscalate(v: Dict) {
  return card([
    el("div", { class: "row between" }, [el("span", { class: "eyebrow" }, `${v.appliance.label}`), pill("Technician recommended", "warn")]),
    el("h1", { class: "title" }, v.escalation.summary),
    el("p", { class: "body" }, v.escalation.reason),
    el("div", { class: "actions" }, [btn("Show case history", "", () => call("get_case", { case_id: v.case_id }, "Show the case history"))]),
  ]);
}

function renderResolved(v: Dict) {
  const children = [
    el("div", { class: "row between" }, [el("span", { class: "eyebrow" }, v.appliance.label), pill("Resolved", "ok")]),
    el("div", { class: "hero" }, [el("div", { class: "glyph" }, [svg("check")]), el("h1", { class: "title" }, "Fixed and logged")]),
    el("p", { class: "body" }, v.resolution),
    el("p", { class: "small muted" }, `${v.steps_taken} step${v.steps_taken === 1 ? "" : "s"} · saved to the appliance history`),
  ];
  if (v.maintenance_added) children.push(el("div", { class: "nested small" }, `Maintenance: ${v.maintenance_added}`));
  children.push(el("div", { class: "actions" }, [btn("What else needs attention?", "", () => call("get_household_brief", {}, "What else needs attention at home?"))]));
  return card(children);
}

function renderClarify(v: Dict) {
  return card([
    el("span", { class: "eyebrow" }, "Which one?"),
    el("h1", { class: "title" }, v.question),
    el("div", { class: "actions" }, v.options.map((o: Dict) => btn(o.label, "primary", () => call("start_repair_case", { appliance: o.id, symptom: current?.symptom ?? "problem" }, `The ${o.label}`)))),
  ]);
}

function renderParts(v: Dict) {
  const cards = v.parts.map((p: Dict, i: number) =>
    el("div", { class: `part${i === 0 ? " best" : ""}`, role: "group", "aria-label": p.name }, [
      el("div", { class: "icon" }, [svg(p.image)]),
      el("div", { class: "row between" }, [i === 0 ? pill("Best match", "ok") : pill(`Option ${i + 1}`), p.fitment === "verified" ? pill("Fits your model", "ok") : pill(p.fitment === "likely" ? "Likely fit" : "Universal")]),
      el("div", { class: "name" }, p.name),
      el("div", { class: "small muted" }, p.description),
      el("div", { class: "row between" }, [el("div", { class: "price" }, p.price), el("div", { class: "small muted" }, p.delivery)]),
      el("div", { class: "stars" }, `${"★".repeat(Math.round(p.rating))}${"☆".repeat(5 - Math.round(p.rating))} ${p.rating} (${p.reviews.toLocaleString()})`),
      btn("Order", "primary", () => call("order_part", { part_id: p.id, case_id: v.case_id }, `Order the ${p.name}`)),
    ]),
  );
  return card([
    el("div", { class: "row between" }, [el("span", { class: "eyebrow" }, `${v.appliance.label} · ${v.part_types.map((p: string) => p.replace(/_/g, " ")).join(", ")}`), pill(`${v.parts.length} options`)]),
    el("div", { class: "carousel", role: "list" }, cards),
    el("p", { class: "footer-note" }, "Prices and availability from the HomeMend demo catalog."),
  ]);
}

function renderOrder(v: Dict) {
  const o = v.order;
  const isQuote = v.phase === "quote";
  const children: HTMLElement[] = [
    el("div", { class: "row between" }, [el("span", { class: "eyebrow" }, isQuote ? "Confirm order" : o.status === "delivered" ? "Delivered" : "Order placed"), pill(isQuote ? "Awaiting your confirmation" : o.status === "delivered" ? "Delivered" : o.eta_label, isQuote ? "warn" : "ok")]),
    el("div", { class: "hero" }, [el("div", { class: "glyph" }, [svg(o.part.image)]), el("div", {}, [el("h1", { class: "title" }, o.part.name), el("div", { class: "small muted" }, `For the ${o.appliance.label}${o.appliance.model ? ` · model ${o.appliance.model}` : ""}`)])]),
    el("dl", { class: "kv" }, [el("dt", {}, "Total"), el("dd", {}, o.total), el("dt", {}, isQuote ? "Delivery" : "Arrives"), el("dd", {}, `${o.eta}${isQuote ? ` (${o.part.delivery.toLowerCase()})` : ""}`), ...(o.followup_date ? [el("dt", {}, "Follow-up"), el("dd", {}, `I'll check in on ${o.followup_date}`)] : [])]),
  ];
  if (isQuote) {
    children.push(el("div", { class: "actions" }, [btn(`Place order · ${o.total}`, "primary", () => call("order_part", { part_id: o.part.id, case_id: o.case_id, confirm: true }, "Yes, place the order")), btn("Not now", "", () => call("find_parts", { case_id: o.case_id }, "Show me the other options"))]));
  } else {
    children.push(el("div", { class: "actions" }, [btn("Show case", "", () => call("get_case", { case_id: o.case_id }, "Show the case"))]));
  }
  children.push(el("p", { class: "footer-note" }, isQuote ? "Nothing is charged until you confirm." : `Order ${o.id} · HomeMend demo catalog`));
  return card(children);
}

function renderBrief(v: Dict) {
  const items: HTMLElement[] = [];
  for (const a of v.arrivals.filter((a: Dict) => a.arrived)) {
    items.push(item(svg("box", "ok"), `${a.part} has arrived`, "Ready to install", btn("Install", "primary", () => call("get_case", { case_id: a.case_id }, `Let's install the ${a.part.toLowerCase()}`))));
  }
  for (const c of v.open_cases.filter((c: Dict) => c.status !== "verify_fix" || !v.arrivals.some((a: Dict) => a.case_id === c.case_id && a.arrived))) {
    items.push(item(svg("wrench"), `${cap(c.appliance)}: ${c.symptom}`, c.next_action, btn("Continue", "", () => call("get_case", { case_id: c.case_id }, `Continue with the ${c.appliance}`))));
  }
  for (const a of v.arrivals.filter((a: Dict) => !a.arrived)) {
    items.push(item(svg("truck"), `${a.part} on the way`, `Arrives ${a.eta}`, undefined));
  }
  for (const m of v.maintenance_due) {
    const due = m.overdue_days > 0 ? `${m.overdue_days} day${m.overdue_days === 1 ? "" : "s"} overdue` : m.overdue_days === 0 ? "Due today" : `Due in ${-m.overdue_days} day${m.overdue_days === -1 ? "" : "s"}`;
    items.push(item(svg("calendar", m.overdue_days >= 0 ? "bad" : ""), `${m.task} · ${m.appliance}`, due, btn("Done", "", () => call("complete_maintenance_task", { task_id: m.task_id }, `I did: ${m.task.toLowerCase()} on the ${m.appliance}`))));
  }
  if (items.length === 0) items.push(item(svg("check", "ok"), "All clear", "Nothing needs attention right now", undefined));
  return card([el("div", { class: "row between" }, [el("span", { class: "eyebrow" }, `Home brief · ${v.date}`), pill(`${items.length} item${items.length === 1 ? "" : "s"}`)]), el("div", { class: "list" }, items)]);
}

function renderAppliances(v: Dict) {
  return card([
    el("div", { class: "row between" }, [el("span", { class: "eyebrow" }, "Your appliances"), pill(`${v.appliances.length}`)]),
    el("div", { class: "list" }, v.appliances.map((a: Dict) => item(svg("appliance"), cap(a.label), [a.brand, a.model, a.age_years != null ? `${a.age_years} yr${a.age_years === 1 ? "" : "s"} old` : null].filter(Boolean).join(" · "), a.open_case_id ? pill("Open case", "warn") : undefined))),
  ]);
}

function renderCase(v: Dict) {
  const c = v.case;
  const statusLabel: Dict = { triage: ["Troubleshooting", "warn"], diagnosed: ["Diagnosed", "warn"], awaiting_part: ["Part on the way", ""], verify_fix: ["Install & verify", "warn"], resolved: ["Resolved", "ok"], escalated: ["Technician", "danger"] };
  const [label, tone] = statusLabel[c.status] ?? [c.status, ""];
  const steps = c.steps.map((s: Dict, i: number) => {
    const tone = s.outcome === "fixed" || s.outcome === "found_issue" ? "ok" : s.outcome === "not_fixed" ? "bad" : "";
    return el("div", { class: "row" }, [el("div", { class: `check ${tone}` }, s.outcome ? (s.outcome === "not_fixed" ? "✕" : "✓") : String(i + 1)), el("div", {}, [el("div", { class: "body" }, s.title), s.observation ? el("div", { class: "small muted" }, `“${s.observation}”`) : el("span")])]);
  });
  const children: HTMLElement[] = [
    el("div", { class: "row between" }, [el("span", { class: "eyebrow" }, `${c.appliance.label} · case ${c.case_id}`), pill(label, tone)]),
    el("h1", { class: "title" }, cap(c.symptom)),
    el("div", { class: "list" }, steps),
  ];
  if (c.diagnosis) children.push(el("div", { class: "nested" }, [el("div", { class: "subtitle" }, "Diagnosis"), el("div", { class: "body" }, c.diagnosis.summary)]));
  if (c.order) children.push(el("div", { class: "nested row between" }, [el("div", {}, [el("div", { class: "subtitle" }, c.order.part.name), el("div", { class: "small muted" }, `${c.order.total} · ${c.order.eta_label}`)]), c.order.status === "delivered" ? pill("Delivered", "ok") : pill(c.order.eta_label)]));
  const actions: HTMLElement[] = [];
  if (c.status === "triage") actions.push(btn("Continue troubleshooting", "primary", () => call("report_step_result", { case_id: c.case_id, outcome: "skipped" }, "Let's continue")));
  if (c.status === "diagnosed") actions.push(btn("See parts", "primary", () => call("find_parts", { case_id: c.case_id }, "Show me the parts")));
  if (c.status === "verify_fix") actions.push(btn("Installed — it works", "success", () => call("report_step_result", { case_id: c.case_id, outcome: "fixed" }, "I installed it and it works")), btn("Still broken", "", () => call("report_step_result", { case_id: c.case_id, outcome: "not_fixed" }, "It's still broken")));
  if (actions.length) children.push(el("div", { class: "actions" }, actions));
  return card(children);
}

// ---------- tiny DOM helpers ----------
function el(tag: string, attrs: Record<string, string> = {}, children: (HTMLElement | Node | string)[] | string = []): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (typeof children === "string") e.textContent = children;
  else for (const c of children) e.append(c as any);
  return e;
}
function card(children: HTMLElement[]) {
  return el("section", { class: "card" }, children);
}
function pill(text: string, tone = "") {
  return el("span", { class: `pill ${tone}`.trim() }, text);
}
function btn(text: string, tone: string, onClick: () => void) {
  const b = el("button", { class: tone, type: "button" }, text) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}
function item(icon: HTMLElement, title: string, sub: string, right?: HTMLElement) {
  return el("div", { class: "item" }, [el("div", { class: "row", style: "flex-wrap:nowrap;min-width:0" }, [icon, el("div", { class: "l" }, [el("div", { class: "t" }, title), el("div", { class: "s" }, sub)])]), right ?? el("span")]);
}
function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
const PATHS: Record<string, string> = {
  check: "M5 13l4 4L19 7",
  wrench: "M14.7 6.3a4 4 0 0 0 5 5l-9.6 9.6a2 2 0 1 1-2.8-2.8L16.9 8.5",
  truck: "M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  box: "M3 8l9-4 9 4v9l-9 4-9-4zM3 8l9 4 9-4M12 12v9",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  appliance: "M5 3h14v18H5zM5 8h14M9 13h.01",
  hose: "M4 6c6 0 6 12 12 12h4M4 6h3M17 18h3",
  pump: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4v4l3 2M2 12h3M19 12h3",
  clamp: "M6 8h12v8H6zM9 8V5h6v3M9 16v3h6v-3",
  valve: "M4 12h16M12 4v16M8 8h8v8H8z",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  belt: "M4 12a8 4 0 1 0 16 0 8 4 0 1 0-16 0",
  element: "M4 8h16M4 12h16M4 16h16M4 8c0-2 2-2 2 0M18 16c0 2 2 2 2 0",
  fuse: "M3 12h5l2-4 4 8 2-4h5",
  fan: "M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 10V3M12 14v7M10 12H3M14 12h7",
  filter: "M4 5h16l-6 8v6l-4 2v-8z",
  igniter: "M12 3c-3 4-6 6-6 10a6 6 0 0 0 12 0c0-4-3-6-6-10zM12 13v4",
  disposal: "M6 4h12v6H6zM8 10v9h8v-9",
  capacitor: "M9 5v14M15 5v14M3 12h6M15 12h6",
  router: "M4 14h16v6H4zM8 17h.01M12 17h.01M12 14V8M9 10a4 4 0 0 1 6 0M6 7a8 8 0 0 1 12 0",
};
function svg(name: string, tone = "") {
  const d = PATHS[name] ?? PATHS.appliance;
  const wrap = el("div", { class: `check ${tone}`.trim(), style: "width:36px;height:36px" });
  wrap.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  return wrap;
}
