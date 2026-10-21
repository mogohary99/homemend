import { describe, it, expect } from "vitest";
import { plan, remember, type PlannerState } from "../../sim/src/planner";

/**
 * The simulator's rule-based planner stands in for Alexa+. Judges will type their own sentences, so it must
 * route realistic phrasings to the right tool and never dead-end when an appliance is named.
 */
const tool = (p: ReturnType<typeof plan>) => (p.kind === "tool" ? p.name : `say:${p.text.slice(0, 30)}`);

describe("planner: fresh conversation", () => {
  const fresh: PlannerState = {};
  const cases: [string, string][] = [
    ["the dishwasher isn't draining", "start_repair_case"],
    ["My dishwasher has water at the bottom", "start_repair_case"],
    ["dryer runs but there's no heat", "start_repair_case"],
    ["the washing machine is leaking", "start_repair_case"],
    ["fridge is making a loud humming noise", "start_repair_case"],
    ["the oven won't heat up", "start_repair_case"],
    ["our AC is blowing warm air", "start_repair_case"],
    ["the wifi keeps dropping", "start_repair_case"],
    ["help me with the garbage disposal", "start_repair_case"],
    ["something is wrong with the water heater", "start_repair_case"],
    ["Alexa, the dishwasher smells bad", "start_repair_case"],
    ["my dishwasher", "start_repair_case"], // an appliance alone: open or resume its case
    ["what needs attention at home?", "get_household_brief"],
    ["anything due this week?", "get_household_brief"],
    ["did my part arrive?", "get_household_brief"],
    ["what appliances do you know about?", "list_appliances"],
    ["I replaced the fridge water filter", "complete_maintenance_task"],
    ["add a dishwasher in the basement model NF-DW500", "register_appliance"],
    ["I need a water filter for the fridge", "find_parts"],
  ];
  for (const [u, expected] of cases) it(`"${u}" → ${expected}`, () => expect(tool(plan(u, fresh))).toBe(expected));

  it("asks which appliance when a problem is described without naming one", () => {
    const p = plan("it's broken and making a weird noise", fresh);
    expect(p.kind).toBe("say");
    if (p.kind === "say") expect(p.text).toMatch(/Which appliance/);
  });
  it("greets, helps, and admits what it cannot do", () => {
    expect(tool(plan("hello", fresh))).toMatch(/^say:Hi/);
    expect(tool(plan("what can you do", fresh))).toMatch(/^say:Tell me/);
    expect(tool(plan("play some jazz", fresh))).toMatch(/^say:I'm not sure/);
  });
});

describe("planner: inside a case", () => {
  const inCase: PlannerState = { caseId: "case-001", lastKind: "step" };
  const cases: [string, string, string][] = [
    ["no change", "report_step_result", "not_fixed"],
    ["I checked, the filter is clean", "report_step_result", "not_fixed"],
    ["that fixed it!", "report_step_result", "fixed"],
    ["it's draining now", "report_step_result", "fixed"],
    ["I found a cracked hose", "report_step_result", "found_issue"],
    ["the hose is kinked", "report_step_result", "found_issue"],
    ["skip this step", "report_step_result", "skipped"],
    ["done", "report_step_result", "not_fixed"],
  ];
  for (const [u, expected, outcome] of cases)
    it(`"${u}" → ${expected}(${outcome})`, () => {
      const p = plan(u, inCase);
      expect(tool(p)).toBe(expected);
      if (p.kind === "tool") expect(p.args.outcome).toBe(outcome);
    });
  it("routes part and status questions", () => {
    expect(tool(plan("show me the parts", { ...inCase, lastKind: "diagnosis" }))).toBe("find_parts");
    expect(tool(plan("where were we with the dishwasher?", inCase))).toBe("get_case");
    expect(tool(plan("remind me in 3 days", inCase))).toBe("schedule_followup");
    expect(tool(plan("yes", inCase))).toBe("get_case");
  });
  it("quote → confirm is explicit and a decline keeps the case open", () => {
    const quoted = remember(inCase, "order_part", { kind: "order", phase: "quote", case_id: "case-001", order: { case_id: "case-001", part: { id: "HM-DH-150", name: "Drain hose" } } });
    expect(quoted.pendingQuote?.part_id).toBe("HM-DH-150");
    const yes = plan("yes, place the order", quoted);
    expect(tool(yes)).toBe("order_part");
    if (yes.kind === "tool") expect(yes.args.confirm).toBe(true);
    expect(plan("not now", quoted).kind).toBe("say");
  });
  it("picks a carousel option by ordinal or price", () => {
    const parts = remember(inCase, "find_parts", { kind: "parts", case_id: "case-001", parts: [{ id: "A", name: "a", price_cents: 2000 }, { id: "B", name: "b", price_cents: 900 }] });
    const first = plan("order the first one", parts);
    const cheap = plan("order the cheapest one", parts);
    expect(first.kind === "tool" && first.args.part_id).toBe("A");
    expect(cheap.kind === "tool" && cheap.args.part_id).toBe("B");
  });
});
