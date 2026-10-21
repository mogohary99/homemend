/**
 * HomeMend engine: the orchestration layer behind every MCP tool.
 *
 * Owns the repair-case state machine (triage → diagnosed → awaiting_part → verify_fix → resolved),
 * the household appliance registry, orders with a two-phase purchase (quote → confirm), follow-ups,
 * and the maintenance schedule. Everything is persisted per household so a conversation can be
 * resumed days later from any Alexa+ device.
 */
const randomUUID = () => crypto.randomUUID();
import type { Appliance, ApplianceType, Household, Order, RepairCase, Store, FollowUp, MaintenanceTask } from "./store.js";
import { APPLIANCE_LABEL, DEFAULT_MAINTENANCE, detectApplianceType, getTree, pickTree, type CheckNode, type TreeNode } from "./knowledge.js";
import { fitment, getPart, partsFor, type Part } from "./catalog.js";

export class EngineError extends Error {
  constructor(message: string, public code: "not_found" | "invalid" | "ambiguous" | "conflict" = "invalid") {
    super(message);
  }
}

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

const DAY = 86_400_000;
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export interface ApplianceView {
  id: string;
  type: ApplianceType;
  label: string; // "kitchen dishwasher"
  brand?: string;
  model?: string;
  room?: string;
  purchased_on?: string;
  age_years?: number;
  open_case_id?: string;
}

export interface StepView {
  kind: "step";
  case_id: string;
  appliance: ApplianceView;
  symptom: string;
  tree_title: string;
  step_number: number;
  total_steps_estimate: number;
  step: { id: string; title: string; instruction: string; safety?: string; minutes?: number };
  status: RepairCase["status"];
  summary: string;
}
export interface DiagnosisView {
  kind: "diagnosis";
  case_id: string;
  appliance: ApplianceView;
  status: RepairCase["status"];
  diagnosis: { summary: string; part_types: string[]; confidence: string; diy: boolean; verify_hint: string };
  recommended_parts: PartView[];
  summary: string;
}
export interface EscalateView {
  kind: "escalate";
  case_id: string;
  appliance: ApplianceView;
  status: RepairCase["status"];
  escalation: { summary: string; reason: string };
  summary: string;
}
export interface ResolvedView {
  kind: "resolved";
  case_id: string;
  appliance: ApplianceView;
  status: RepairCase["status"];
  resolution: string;
  steps_taken: number;
  maintenance_added?: string;
  summary: string;
}
export interface ClarifyView {
  kind: "clarify";
  question: string;
  options: { id: string; label: string }[];
  summary: string;
}
export interface PartView {
  id: string;
  name: string;
  description: string;
  price: string;
  price_cents: number;
  rating: number;
  reviews: number;
  delivery: string; // "Tomorrow" / "In 2 days"
  delivery_date: string;
  fitment: "verified" | "likely" | "unknown";
  image: string;
}
export interface PartsView {
  kind: "parts";
  case_id?: string;
  appliance: ApplianceView;
  part_types: string[];
  parts: PartView[];
  summary: string;
}
export interface OrderView {
  kind: "order";
  phase: "quote" | "placed" | "delivered";
  order: {
    id: string;
    case_id?: string;
    part: PartView;
    appliance: ApplianceView;
    status: Order["status"];
    total: string;
    eta: string;
    eta_label: string;
    followup_date?: string;
  };
  requires_confirmation: boolean;
  summary: string;
}
export interface BriefView {
  kind: "brief";
  date: string;
  open_cases: { case_id: string; appliance: string; symptom: string; status: string; next_action: string }[];
  arrivals: { order_id: string; part: string; eta: string; arrived: boolean; case_id?: string }[];
  maintenance_due: { task_id: string; appliance: string; task: string; due: string; overdue_days: number }[];
  followups: { id: string; case_id: string; due: string; note: string }[];
  summary: string;
}
export interface AppliancesView {
  kind: "appliances";
  appliances: ApplianceView[];
  summary: string;
}
export interface CaseView {
  kind: "case";
  case: {
    case_id: string;
    appliance: ApplianceView;
    symptom: string;
    status: RepairCase["status"];
    steps: { title: string; outcome?: string; observation?: string }[];
    diagnosis?: RepairCase["diagnosis"];
    order?: OrderView["order"];
    resolution?: string;
    created_at: string;
  };
  summary: string;
}
export type View = StepView | DiagnosisView | EscalateView | ResolvedView | ClarifyView | PartsView | OrderView | BriefView | AppliancesView | CaseView;

export class Engine {
  constructor(private store: Store, private householdId: string, private clock: Clock = systemClock) {}

  // ---------- helpers ----------
  private load(): Household {
    const h = this.store.load(this.householdId);
    if (h.appliances.length === 0 && h.seq === 0) {
      seedHousehold(h, this.clock.now());
      this.store.save(h);
    }
    return h;
  }
  private nextId(h: Household, prefix: string) {
    h.seq += 1;
    return `${prefix}-${h.seq.toString().padStart(3, "0")}`;
  }
  private applianceView(h: Household, a: Appliance): ApplianceView {
    const open = h.cases.find((c) => c.appliance_id === a.id && c.status !== "resolved" && c.status !== "escalated");
    const label = [a.room, APPLIANCE_LABEL[a.type]].filter(Boolean).join(" ");
    const age = a.purchased_on ? Math.floor((this.clock.now().getTime() - new Date(a.purchased_on).getTime()) / (365 * DAY)) : undefined;
    return { id: a.id, type: a.type, label, brand: a.brand, model: a.model, room: a.room, purchased_on: a.purchased_on, age_years: age, open_case_id: open?.id };
  }
  private partView(p: Part, model?: string): PartView {
    const now = this.clock.now();
    const eta = addDays(now, p.delivery_days);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      price: money(p.price_cents),
      price_cents: p.price_cents,
      rating: p.rating,
      reviews: p.reviews,
      delivery: p.delivery_days === 1 ? "Tomorrow" : `In ${p.delivery_days} days`,
      delivery_date: isoDate(eta),
      fitment: fitment(p, model),
      image: p.image,
    };
  }
  private orderView(h: Household, o: Order): OrderView["order"] {
    const part = getPart(o.part_id)!;
    const appliance = h.appliances.find((a) => a.id === o.appliance_id)!;
    const followup = h.followups.find((f) => f.case_id === o.case_id && !f.done);
    const etaDate = new Date(o.eta);
    const days = Math.round((etaDate.getTime() - startOfDay(this.clock.now()).getTime()) / DAY);
    return {
      id: o.id,
      case_id: o.case_id,
      part: this.partView(part, appliance.model),
      appliance: this.applianceView(h, appliance),
      status: o.status,
      total: money(o.price_cents),
      eta: o.eta,
      eta_label: o.status === "delivered" ? "Delivered" : days <= 0 ? "Arriving today" : days === 1 ? "Arriving tomorrow" : `Arriving in ${days} days`,
      followup_date: followup?.due,
    };
  }
  private resolveAppliance(h: Household, ref: string): Appliance | Appliance[] {
    const lower = ref.toLowerCase().trim();
    const byId = h.appliances.find((a) => a.id.toLowerCase() === lower);
    if (byId) return byId;
    const type = detectApplianceType(lower);
    let candidates = type ? h.appliances.filter((a) => a.type === type) : [];
    if (candidates.length > 1) {
      const byRoom = candidates.filter((a) => a.room && lower.includes(a.room.toLowerCase()));
      if (byRoom.length === 1) return byRoom[0];
    }
    if (candidates.length === 0 && !type) {
      // maybe they said the room or brand
      candidates = h.appliances.filter((a) => (a.room && lower.includes(a.room.toLowerCase())) || (a.brand && lower.includes(a.brand.toLowerCase())));
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return candidates;
    if (type) throw new EngineError(`No ${APPLIANCE_LABEL[type]} is registered for this household yet.`, "not_found");
    throw new EngineError(`I could not tell which appliance "${ref}" refers to.`, "not_found");
  }
  private deliverDueOrders(h: Household) {
    const today = startOfDay(this.clock.now());
    for (const o of h.orders) {
      if (o.status === "placed" && new Date(o.eta).getTime() <= today.getTime()) {
        o.status = "delivered";
        const c = h.cases.find((c) => c.id === o.case_id);
        if (c && c.status === "awaiting_part") {
          c.status = "verify_fix";
          c.updated_at = this.clock.now().toISOString();
        }
      }
    }
  }

  // ---------- appliances ----------
  listAppliances(): AppliancesView {
    const h = this.load();
    const appliances = h.appliances.map((a) => this.applianceView(h, a));
    return { kind: "appliances", appliances, summary: `${appliances.length} appliances are registered: ${appliances.map((a) => a.label).join(", ")}.` };
  }

  registerAppliance(input: { type: string; brand?: string; model?: string; room?: string; purchased_on?: string }): AppliancesView {
    const h = this.load();
    const type = detectApplianceType(input.type) ?? (Object.keys(APPLIANCE_LABEL).includes(input.type) ? (input.type as ApplianceType) : undefined);
    if (!type) throw new EngineError(`Unsupported appliance type "${input.type}". Supported: ${Object.keys(APPLIANCE_LABEL).join(", ")}.`);
    if (input.purchased_on && Number.isNaN(Date.parse(input.purchased_on))) throw new EngineError("purchased_on must be an ISO date.");
    const a: Appliance = {
      id: this.nextId(h, "appl"),
      type,
      brand: input.brand?.trim() || undefined,
      model: input.model?.trim() || undefined,
      room: input.room?.trim().toLowerCase() || undefined,
      purchased_on: input.purchased_on,
      created_at: this.clock.now().toISOString(),
    };
    h.appliances.push(a);
    for (const m of DEFAULT_MAINTENANCE[type]) {
      h.maintenance.push({ id: this.nextId(h, "mt"), appliance_id: a.id, task: m.task, interval_days: m.interval_days, next_due: isoDate(addDays(this.clock.now(), m.interval_days)) });
    }
    this.store.save(h);
    const view = this.listAppliances();
    return { ...view, summary: `Added the ${this.applianceView(h, a).label}${a.model ? ` (model ${a.model})` : ""} and set up ${DEFAULT_MAINTENANCE[type].length} maintenance reminders.` };
  }

  // ---------- repair cases ----------
  startCase(input: { appliance: string; symptom: string }): StepView | ClarifyView {
    const h = this.load();
    const resolved = this.resolveAppliance(h, input.appliance);
    if (Array.isArray(resolved)) {
      return {
        kind: "clarify",
        question: `Which ${APPLIANCE_LABEL[resolved[0].type]} do you mean?`,
        options: resolved.map((a) => ({ id: a.id, label: this.applianceView(h, a).label })),
        summary: `There are ${resolved.length} ${APPLIANCE_LABEL[resolved[0].type]}s registered. Which one: ${resolved.map((a) => this.applianceView(h, a).label).join(" or ")}?`,
      };
    }
    const appliance = resolved;
    const existing = h.cases.find((c) => c.appliance_id === appliance.id && c.status !== "resolved" && c.status !== "escalated");
    if (existing) {
      // Resume rather than duplicate: this is what "state across sessions" means in practice.
      return this.currentStepView(h, existing, `You already have an open case for the ${this.applianceView(h, appliance).label}. Picking up where you left off.`);
    }
    const tree = pickTree(appliance.type, input.symptom);
    if (!tree) throw new EngineError(`I do not have a troubleshooting guide for a ${APPLIANCE_LABEL[appliance.type]} yet.`, "not_found");
    const now = this.clock.now().toISOString();
    const c: RepairCase = {
      id: this.nextId(h, "case"),
      appliance_id: appliance.id,
      symptom: input.symptom.trim(),
      tree_id: tree.id,
      current_node: tree.root,
      status: "triage",
      steps: [{ step_id: this.nextId(h, "step"), node_id: tree.root, asked_at: now }],
      created_at: now,
      updated_at: now,
    };
    h.cases.push(c);
    this.store.save(h);
    return this.currentStepView(h, c, `Opened a repair case for the ${this.applianceView(h, appliance).label}: ${tree.title}. Let's start with the most likely cause.`);
  }

  private currentStepView(h: Household, c: RepairCase, lead: string): StepView {
    const tree = getTree(c.tree_id)!;
    const node = tree.nodes[c.current_node];
    if (node.kind !== "check") throw new EngineError("Case is not awaiting a check step.", "conflict");
    const appliance = this.applianceView(h, h.appliances.find((a) => a.id === c.appliance_id)!);
    const checks = Object.values(tree.nodes).filter((n) => n.kind === "check").length;
    const stepNumber = c.steps.length;
    return {
      kind: "step",
      case_id: c.id,
      appliance,
      symptom: c.symptom,
      tree_title: tree.title,
      step_number: stepNumber,
      total_steps_estimate: checks,
      step: { id: node.id, title: node.title, instruction: node.instruction, safety: node.safety, minutes: node.minutes },
      status: c.status,
      summary: `${lead} Step ${stepNumber}: ${node.title}. ${node.safety ? node.safety + " " : ""}${node.instruction} Tell me "that fixed it", "no change", or what you found.`,
    };
  }

  reportStep(input: { case_id?: string; outcome: "fixed" | "not_fixed" | "found_issue" | "skipped"; observation?: string }): View {
    const h = this.load();
    const c = this.findCase(h, input.case_id);
    const tree = getTree(c.tree_id)!;
    const node = tree.nodes[c.current_node];
    const now = this.clock.now().toISOString();

    if (c.status === "verify_fix" || c.status === "awaiting_part") {
      // Post-repair verification turn.
      if (input.outcome === "fixed") return this.resolve(h, c, `Replaced ${c.diagnosis?.part_types.join(", ") || "part"}; verified fixed.`);
      if (input.outcome === "not_fixed") {
        c.status = "escalated";
        c.updated_at = now;
        this.store.save(h);
        const appliance = this.applianceView(h, h.appliances.find((a) => a.id === c.appliance_id)!);
        return {
          kind: "escalate",
          case_id: c.id,
          appliance,
          status: c.status,
          escalation: { summary: "The replacement did not fix it.", reason: "A technician should look at this next. Your case history, parts, and steps are saved to share with them." },
          summary: `Sorry to hear that. Since the ${appliance.label} still has the problem after the repair, I recommend a technician. I have kept the full case history so you can share it.`,
        };
      }
      throw new EngineError("While verifying a fix, report either fixed or not_fixed.", "invalid");
    }

    if (node.kind !== "check") throw new EngineError("This case is not waiting on a troubleshooting step.", "conflict");
    const last = c.steps[c.steps.length - 1];
    last.outcome = input.outcome;
    last.observation = input.observation?.trim() || undefined;

    const nextId = node.next[input.outcome] ?? node.next.not_fixed;
    const next: TreeNode | undefined = tree.nodes[nextId];
    if (!next) throw new EngineError("Knowledge base error: dangling edge.", "conflict");
    c.updated_at = now;

    if (next.kind === "check") {
      c.current_node = next.id;
      c.steps.push({ step_id: this.nextId(h, "step"), node_id: next.id, asked_at: now });
      this.store.save(h);
      const lead = input.outcome === "found_issue" ? "Good find. Let's keep going." : input.outcome === "skipped" ? "Okay, skipping that." : "Okay, that wasn't it.";
      return this.currentStepView(h, c, lead);
    }
    if (next.kind === "escalate") {
      c.status = "escalated";
      c.current_node = next.id;
      this.store.save(h);
      const appliance = this.applianceView(h, h.appliances.find((a) => a.id === c.appliance_id)!);
      return {
        kind: "escalate",
        case_id: c.id,
        appliance,
        status: c.status,
        escalation: { summary: next.summary, reason: next.reason },
        summary: `${next.summary} ${next.reason} I have saved everything you checked so far for the technician.`,
      };
    }
    // diagnosis
    c.current_node = next.id;
    c.diagnosis = { summary: next.summary, part_types: next.part_types, confidence: next.confidence };
    if (next.part_types.length === 0 || input.outcome === "fixed") {
      return this.resolve(h, c, next.summary);
    }
    c.status = "diagnosed";
    this.store.save(h);
    const appliance = this.applianceView(h, h.appliances.find((a) => a.id === c.appliance_id)!);
    const parts = partsFor(next.part_types, appliance.type, appliance.model).slice(0, 5).map((p) => this.partView(p, appliance.model));
    const top = parts[0];
    return {
      kind: "diagnosis",
      case_id: c.id,
      appliance,
      status: c.status,
      diagnosis: { summary: next.summary, part_types: next.part_types, confidence: next.confidence, diy: next.diy, verify_hint: next.verify_hint },
      recommended_parts: parts,
      summary: `${next.summary} ${next.diy ? "This is a do-it-yourself repair." : "This one is best left to a technician."}${top ? ` The matching part is ${top.name} for ${top.price}, ${top.delivery.toLowerCase()}. Want me to order it?` : ""}`,
    };
  }

  private resolve(h: Household, c: RepairCase, resolution: string): ResolvedView {
    const now = this.clock.now();
    c.status = "resolved";
    c.resolution = resolution;
    c.updated_at = now.toISOString();
    for (const f of h.followups) if (f.case_id === c.id) f.done = true;
    // Preventive loop: if the fix was a maintenance item, mark it done and reschedule.
    let maintenanceAdded: string | undefined;
    const appliance = h.appliances.find((a) => a.id === c.appliance_id)!;
    const lower = resolution.toLowerCase();
    const related = h.maintenance.find((m) => m.appliance_id === appliance.id && lower.includes(m.task.toLowerCase().split(" ").slice(-1)[0]));
    if (related) {
      related.last_done = isoDate(now);
      related.next_due = isoDate(addDays(now, related.interval_days));
      maintenanceAdded = `${related.task} rescheduled for ${related.next_due}`;
    }
    this.store.save(h);
    const av = this.applianceView(h, appliance);
    return {
      kind: "resolved",
      case_id: c.id,
      appliance: av,
      status: c.status,
      resolution,
      steps_taken: c.steps.length,
      maintenance_added: maintenanceAdded,
      summary: `Great, the ${av.label} is fixed. ${resolution} I logged it in the appliance history${maintenanceAdded ? ` and ${maintenanceAdded}` : ""}.`,
    };
  }

  private findCase(h: Household, caseId?: string): RepairCase {
    this.deliverDueOrders(h);
    if (caseId) {
      const c = h.cases.find((c) => c.id === caseId);
      if (!c) throw new EngineError(`No case ${caseId}.`, "not_found");
      return c;
    }
    const open = h.cases.filter((c) => c.status !== "resolved" && c.status !== "escalated").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (open.length === 0) throw new EngineError("There is no open repair case. Describe the problem to start one.", "not_found");
    if (open.length > 1) throw new EngineError(`There are ${open.length} open cases; specify case_id (${open.map((c) => c.id).join(", ")}).`, "ambiguous");
    return open[0];
  }

  getCase(input: { case_id?: string }): CaseView {
    const h = this.load();
    const c = this.findCase(h, input.case_id);
    this.store.save(h);
    const tree = getTree(c.tree_id)!;
    const appliance = this.applianceView(h, h.appliances.find((a) => a.id === c.appliance_id)!);
    const order = h.orders.find((o) => o.id === c.order_id);
    const statusText: Record<RepairCase["status"], string> = {
      triage: "we are still troubleshooting",
      diagnosed: "the cause is identified and a part is recommended",
      awaiting_part: "the part is on its way",
      verify_fix: "the part has arrived and the repair needs to be verified",
      resolved: "it is resolved",
      escalated: "it needs a technician",
    };
    return {
      kind: "case",
      case: {
        case_id: c.id,
        appliance,
        symptom: c.symptom,
        status: c.status,
        steps: c.steps.map((s) => ({ title: (tree.nodes[s.node_id] as CheckNode).title, outcome: s.outcome, observation: s.observation })),
        diagnosis: c.diagnosis,
        order: order ? this.orderView(h, order) : undefined,
        resolution: c.resolution,
        created_at: c.created_at,
      },
      summary: `Case for the ${appliance.label} (${c.symptom}): ${statusText[c.status]}.${order ? ` ${order.status === "delivered" ? "The part has been delivered." : `The ${getPart(order.part_id)!.name} is ${this.orderView(h, order).eta_label.toLowerCase()}.`}` : ""}`,
    };
  }

  // ---------- parts & orders ----------
  findParts(input: { case_id?: string; appliance?: string; part_type?: string }): PartsView {
    const h = this.load();
    let appliance: Appliance;
    let partTypes: string[];
    let caseId: string | undefined;
    if (input.case_id || (!input.appliance && !input.part_type)) {
      const c = this.findCase(h, input.case_id);
      if (!c.diagnosis) throw new EngineError("This case has no diagnosis yet, so I cannot recommend parts. Continue troubleshooting first.", "conflict");
      appliance = h.appliances.find((a) => a.id === c.appliance_id)!;
      partTypes = input.part_type ? [input.part_type] : c.diagnosis.part_types;
      caseId = c.id;
    } else {
      const r = this.resolveAppliance(h, input.appliance ?? "");
      if (Array.isArray(r)) throw new EngineError(`Several ${APPLIANCE_LABEL[r[0].type]}s match; say which room.`, "ambiguous");
      appliance = r;
      partTypes = input.part_type ? [input.part_type] : h.maintenance.filter((m) => m.appliance_id === appliance.id).map((m) => m.task.toLowerCase().includes("filter") ? (appliance.type === "refrigerator" ? "water_filter" : "air_filter") : "").filter(Boolean);
      if (partTypes.length === 0) throw new EngineError("Tell me which part you need.", "invalid");
    }
    const av = this.applianceView(h, appliance);
    const parts = partsFor(partTypes, appliance.type, appliance.model).slice(0, 5).map((p) => this.partView(p, appliance.model));
    if (parts.length === 0) throw new EngineError(`No ${partTypes.join(" or ")} is in the catalog for a ${APPLIANCE_LABEL[appliance.type]}.`, "not_found");
    this.store.save(h);
    return {
      kind: "parts",
      case_id: caseId,
      appliance: av,
      part_types: partTypes,
      parts,
      summary: `I found ${parts.length} option${parts.length > 1 ? "s" : ""} for the ${av.label}. The best match is ${parts[0].name} at ${parts[0].price}, ${parts[0].delivery.toLowerCase()}${parts[0].fitment === "verified" ? ", confirmed to fit your model" : ""}. Say "order the first one" or pick another.`,
    };
  }

  orderPart(input: { part_id: string; case_id?: string; confirm?: boolean }): OrderView {
    const h = this.load();
    const part = getPart(input.part_id);
    if (!part) throw new EngineError(`Unknown part ${input.part_id}.`, "not_found");
    let c: RepairCase | undefined;
    try {
      c = this.findCase(h, input.case_id);
    } catch {
      c = undefined;
    }
    const appliance = c ? h.appliances.find((a) => a.id === c!.appliance_id)! : h.appliances.find((a) => part.fits.includes(a.type));
    if (!appliance) throw new EngineError("I could not tell which appliance this part is for.", "invalid");
    const now = this.clock.now();

    // Phase 1: quote. Nothing is purchased until the person confirms.
    let order = h.orders.find((o) => o.part_id === part.id && o.case_id === c?.id && o.status === "quoted");
    if (!order) {
      order = {
        id: this.nextId(h, "ord"),
        case_id: c?.id,
        appliance_id: appliance.id,
        part_id: part.id,
        part_name: part.name,
        price_cents: part.price_cents,
        currency: "USD",
        status: "quoted",
        quoted_at: now.toISOString(),
        eta: isoDate(addDays(now, part.delivery_days)),
      };
      h.orders.push(order);
    }
    if (!input.confirm) {
      this.store.save(h);
      const ov = this.orderView(h, order);
      return {
        kind: "order",
        phase: "quote",
        order: ov,
        requires_confirmation: true,
        summary: `${part.name} is ${money(part.price_cents)} with delivery ${ov.eta_label.toLowerCase().replace("arriving ", "")}. Shall I place the order?`,
      };
    }
    // Phase 2: confirmed.
    order.status = "placed";
    order.placed_at = now.toISOString();
    if (c) {
      c.order_id = order.id;
      c.status = "awaiting_part";
      c.updated_at = now.toISOString();
      const due = isoDate(addDays(new Date(order.eta), 0));
      h.followups.push({ id: this.nextId(h, "fu"), case_id: c.id, due, note: `Check whether the ${part.name.toLowerCase()} arrived and walk through installing it.`, done: false });
    }
    this.store.save(h);
    const ov = this.orderView(h, order);
    return {
      kind: "order",
      phase: "placed",
      order: ov,
      requires_confirmation: false,
      summary: `Done. I ordered the ${part.name} for ${money(part.price_cents)}, ${ov.eta_label.toLowerCase()}.${c ? " I'll check in when it arrives and walk you through the install." : ""}`,
    };
  }

  // ---------- follow-ups, maintenance, brief ----------
  scheduleFollowup(input: { case_id?: string; due: string; note?: string }): CaseView {
    const h = this.load();
    const c = this.findCase(h, input.case_id);
    const due = parseDue(input.due, this.clock.now());
    h.followups.push({ id: this.nextId(h, "fu"), case_id: c.id, due, note: input.note?.trim() || "Follow up on this repair.", done: false });
    this.store.save(h);
    const view = this.getCase({ case_id: c.id });
    return { ...view, summary: `Okay, I'll follow up on the ${view.case.appliance.label} on ${due}.` };
  }

  completeMaintenance(input: { task_id?: string; appliance?: string; task?: string }): BriefView {
    const h = this.load();
    let task: MaintenanceTask | undefined;
    if (input.task_id) task = h.maintenance.find((m) => m.id === input.task_id);
    else if (input.appliance || input.task) {
      const r = input.appliance ? this.resolveAppliance(h, input.appliance) : undefined;
      const applianceIds = r ? (Array.isArray(r) ? r : [r]).map((a) => a.id) : h.appliances.map((a) => a.id);
      const lower = (input.task ?? "").toLowerCase();
      task = h.maintenance.find((m) => applianceIds.includes(m.appliance_id) && (!lower || m.task.toLowerCase().includes(lower.split(" ").pop()!)));
    }
    if (!task) throw new EngineError("I could not find that maintenance task.", "not_found");
    const now = this.clock.now();
    task.last_done = isoDate(now);
    task.next_due = isoDate(addDays(now, task.interval_days));
    this.store.save(h);
    const brief = this.brief();
    const a = this.applianceView(h, h.appliances.find((x) => x.id === task!.appliance_id)!);
    return { ...brief, summary: `Logged "${task.task}" for the ${a.label}. Next due ${task.next_due}. ${brief.summary}` };
  }

  brief(): BriefView {
    const h = this.load();
    this.deliverDueOrders(h);
    this.store.save(h);
    const today = startOfDay(this.clock.now());
    const openCases = h.cases
      .filter((c) => c.status !== "resolved" && c.status !== "escalated")
      .map((c) => {
        const a = this.applianceView(h, h.appliances.find((x) => x.id === c.appliance_id)!);
        const next: Record<RepairCase["status"], string> = {
          triage: "Continue troubleshooting",
          diagnosed: "Order the recommended part",
          awaiting_part: "Waiting for the part",
          verify_fix: "Install the part and confirm the fix",
          resolved: "",
          escalated: "",
        };
        return { case_id: c.id, appliance: a.label, symptom: c.symptom, status: c.status, next_action: next[c.status] };
      });
    const arrivals = h.orders
      .filter((o) => o.status !== "quoted" && h.cases.find((c) => c.id === o.case_id)?.status !== "resolved")
      .map((o) => ({ order_id: o.id, part: o.part_name, eta: o.eta, arrived: o.status === "delivered", case_id: o.case_id }));
    const maintenanceDue = h.maintenance
      .map((m) => ({ m, overdue: Math.floor((today.getTime() - new Date(m.next_due).getTime()) / DAY) }))
      .filter((x) => x.overdue >= -7)
      .sort((a, b) => b.overdue - a.overdue)
      .map(({ m, overdue }) => ({ task_id: m.id, appliance: this.applianceView(h, h.appliances.find((a) => a.id === m.appliance_id)!).label, task: m.task, due: m.next_due, overdue_days: overdue }));
    const followups = h.followups.filter((f) => !f.done && new Date(f.due).getTime() <= today.getTime()).map((f) => ({ id: f.id, case_id: f.case_id, due: f.due, note: f.note }));

    const bits: string[] = [];
    const arrived = arrivals.filter((a) => a.arrived);
    if (arrived.length) bits.push(`${arrived.length === 1 ? `The ${arrived[0].part.toLowerCase()} has arrived` : `${arrived.length} parts have arrived`}, so you can finish that repair.`);
    const otherOpen = openCases.filter((c) => c.status !== "verify_fix");
    if (otherOpen.length) bits.push(`${otherOpen.length} repair case${otherOpen.length > 1 ? "s are" : " is"} open: ${otherOpen.map((c) => `${c.appliance} (${c.next_action.toLowerCase()})`).join("; ")}.`);
    const due = maintenanceDue.filter((m) => m.overdue_days >= 0);
    const soon = maintenanceDue.filter((m) => m.overdue_days < 0);
    if (due.length) bits.push(`Maintenance due: ${due.map((m) => `${m.task.toLowerCase()} on the ${m.appliance}`).join(", ")}.`);
    if (soon.length) bits.push(`Coming up: ${soon.map((m) => `${m.task.toLowerCase()} on the ${m.appliance} in ${-m.overdue_days} day${-m.overdue_days === 1 ? "" : "s"}`).join(", ")}.`);
    if (bits.length === 0) bits.push("Nothing needs attention at home right now. All appliances are up to date.");
    return { kind: "brief", date: isoDate(this.clock.now()), open_cases: openCases, arrivals, maintenance_due: maintenanceDue, followups, summary: bits.join(" ") };
  }
}

// ---------- utilities ----------
export function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function parseDue(text: string, now: Date): string {
  const t = text.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t === "tomorrow") return isoDate(addDays(now, 1));
  if (t === "today") return isoDate(now);
  const m = t.match(/in (\d+) (day|week)s?/);
  if (m) return isoDate(addDays(now, Number(m[1]) * (m[2] === "week" ? 7 : 1)));
  if (/next week/.test(t)) return isoDate(addDays(now, 7));
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return isoDate(new Date(parsed));
  throw new EngineError(`I could not understand the date "${text}". Use YYYY-MM-DD, "tomorrow", or "in 3 days".`);
}

/** Demo household with fictional brands (no third-party trademarks). */
export function seedHousehold(h: Household, now: Date) {
  const mk = (type: ApplianceType, brand: string, model: string, room: string, yearsAgo: number): Appliance => ({
    id: `appl-${(++h.seq).toString().padStart(3, "0")}`,
    type,
    brand,
    model,
    room,
    purchased_on: isoDate(addDays(now, -365 * yearsAgo)),
    created_at: now.toISOString(),
  });
  h.appliances.push(
    mk("dishwasher", "Nordfeld", "NF-DW500", "kitchen", 4),
    mk("refrigerator", "Nordfeld", "NF-FR900", "kitchen", 6),
    mk("washer", "Carrow", "CR-W800", "laundry room", 3),
    mk("dryer", "Brightline", "BL-TD60", "laundry room", 3),
    mk("oven", "Carrow", "CR-OV44", "kitchen", 8),
  );
  for (const a of h.appliances) {
    for (const m of DEFAULT_MAINTENANCE[a.type]) {
      // Stagger: fridge water filter is due in 3 days so the brief has something to say.
      const offset = a.type === "refrigerator" && m.task.includes("filter") ? 3 : Math.round(m.interval_days * 0.6);
      h.maintenance.push({ id: `mt-${(++h.seq).toString().padStart(3, "0")}`, appliance_id: a.id, task: m.task, interval_days: m.interval_days, last_done: isoDate(addDays(now, offset - m.interval_days)), next_due: isoDate(addDays(now, offset)) });
    }
  }
}
