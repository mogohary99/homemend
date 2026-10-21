import { describe, it, expect } from "vitest";
import { Engine, EngineError, type Clock } from "../src/engine.js";
import { MemoryStore } from "../src/store.js";

function fixedClock(start: string): Clock & { advance(days: number): void } {
  let t = new Date(start);
  return { now: () => t, advance: (d) => (t = new Date(t.getTime() + d * 86_400_000)) };
}

describe("HomeMend engine", () => {
  it("seeds a household and lists appliances", () => {
    const e = new Engine(new MemoryStore(), "h1", fixedClock("2026-10-21T10:00:00Z"));
    const v = e.listAppliances();
    expect(v.appliances.length).toBe(5);
    expect(v.appliances.map((a) => a.type)).toContain("dishwasher");
  });

  it("walks the dishwasher drain tree to a diagnosis, orders a part, and resolves after delivery", () => {
    const store = new MemoryStore();
    const clock = fixedClock("2026-10-21T10:00:00Z");
    const e = new Engine(store, "h2", clock);

    const s1 = e.startCase({ appliance: "dishwasher", symptom: "it's not draining, there's water at the bottom" });
    expect(s1.kind).toBe("step");
    if (s1.kind !== "step") return;
    expect(s1.step.id).toBe("filter");
    expect(s1.step_number).toBe(1);

    // Starting again for the same appliance resumes instead of duplicating.
    const again = e.startCase({ appliance: "the kitchen dishwasher", symptom: "still not draining" });
    expect(again.kind).toBe("step");
    if (again.kind === "step") expect(again.case_id).toBe(s1.case_id);

    const s2 = e.reportStep({ case_id: s1.case_id, outcome: "not_fixed" });
    expect(s2.kind).toBe("step");
    if (s2.kind !== "step") return;
    expect(s2.step.id).toBe("drain_hose");
    expect(s2.step_number).toBe(2);

    const d = e.reportStep({ case_id: s1.case_id, outcome: "found_issue", observation: "the hose is cracked near the clamp" });
    expect(d.kind).toBe("diagnosis");
    if (d.kind !== "diagnosis") return;
    expect(d.diagnosis.part_types).toContain("drain_hose");
    expect(d.recommended_parts[0].fitment).toBe("verified"); // NF-DW500 is in fits_models
    expect(d.status).toBe("diagnosed");

    const parts = e.findParts({ case_id: s1.case_id });
    expect(parts.parts.length).toBeGreaterThan(1);

    // Two-phase purchase: quote first, nothing placed.
    const quote = e.orderPart({ part_id: parts.parts[0].id, case_id: s1.case_id });
    expect(quote.phase).toBe("quote");
    expect(quote.requires_confirmation).toBe(true);
    expect(e.getCase({ case_id: s1.case_id }).case.status).toBe("diagnosed");

    const placed = e.orderPart({ part_id: parts.parts[0].id, case_id: s1.case_id, confirm: true });
    expect(placed.phase).toBe("placed");
    expect(placed.order.status).toBe("placed");
    expect(e.getCase({ case_id: s1.case_id }).case.status).toBe("awaiting_part");

    // Brief today: part is on the way, fridge filter due in 3 days.
    const b1 = e.brief();
    expect(b1.arrivals[0].arrived).toBe(false);
    expect(b1.maintenance_due.some((m) => m.task.includes("water filter") && m.overdue_days === -3)).toBe(true);

    // Next day: part delivered → case moves to verify_fix, follow-up fires.
    clock.advance(1);
    const b2 = e.brief();
    expect(b2.arrivals[0].arrived).toBe(true);
    expect(b2.followups.length).toBe(1);
    expect(e.getCase({ case_id: s1.case_id }).case.status).toBe("verify_fix");

    const done = e.reportStep({ case_id: s1.case_id, outcome: "fixed" });
    expect(done.kind).toBe("resolved");
    expect(e.getCase({ case_id: s1.case_id }).case.status).toBe("resolved");
    expect(e.brief().open_cases.length).toBe(0);
  });

  it("asks for clarification when two appliances of the same type exist", () => {
    const e = new Engine(new MemoryStore(), "h3", fixedClock("2026-10-21T10:00:00Z"));
    e.registerAppliance({ type: "dishwasher", room: "basement" });
    const v = e.startCase({ appliance: "dishwasher", symptom: "not draining" });
    expect(v.kind).toBe("clarify");
    if (v.kind === "clarify") expect(v.options.length).toBe(2);
    const v2 = e.startCase({ appliance: "basement dishwasher", symptom: "not draining" });
    expect(v2.kind).toBe("step");
  });

  it("resolves immediately when a step fixes the problem and logs related maintenance", () => {
    const e = new Engine(new MemoryStore(), "h4", fixedClock("2026-10-21T10:00:00Z"));
    const s = e.startCase({ appliance: "dishwasher", symptom: "water at the bottom" });
    if (s.kind !== "step") throw new Error();
    const r = e.reportStep({ case_id: s.case_id, outcome: "fixed" });
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.maintenance_added).toMatch(/Clean the filter/);
  });

  it("escalates unsafe faults", () => {
    const e = new Engine(new MemoryStore(), "h5", fixedClock("2026-10-21T10:00:00Z"));
    const s = e.startCase({ appliance: "washer", symptom: "it won't spin" });
    if (s.kind !== "step") throw new Error();
    e.reportStep({ outcome: "not_fixed" }); // load_balance
    e.reportStep({ outcome: "not_fixed" }); // drain_filter
    e.reportStep({ outcome: "not_fixed" }); // lid_switch
    const esc = e.reportStep({ outcome: "not_fixed" }); // belt_listen → escalate
    expect(esc.kind).toBe("escalate");
  });

  it("rejects unknown appliances and dates with clear errors", () => {
    const e = new Engine(new MemoryStore(), "h6", fixedClock("2026-10-21T10:00:00Z"));
    expect(() => e.startCase({ appliance: "toaster", symptom: "burning" })).toThrow(EngineError);
    expect(() => e.registerAppliance({ type: "dishwasher", purchased_on: "yesterday-ish" })).toThrow(/ISO date/);
    expect(() => e.scheduleFollowup({ due: "whenever" })).toThrow(EngineError);
  });

  it("completes maintenance and reschedules", () => {
    const e = new Engine(new MemoryStore(), "h7", fixedClock("2026-10-21T10:00:00Z"));
    const b = e.completeMaintenance({ appliance: "fridge", task: "water filter" });
    expect(b.summary).toMatch(/Logged "Replace the water filter"/);
    expect(b.maintenance_due.some((m) => m.task.includes("water filter"))).toBe(false);
  });
});
