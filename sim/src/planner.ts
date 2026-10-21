/**
 * Rule-based "Alexa+ layer" for the simulator.
 *
 * In production, Alexa+ (an LLM) decides which HomeMend tool to call from the person's words and the
 * tool descriptions. We cannot reach Alexa+ from a hackathon, so this deterministic planner stands in:
 * it maps an utterance plus lightweight conversation state to exactly one MCP tools/call (or a
 * scripted reply). Everything after the tools/call is real: the server, its state, and the MCP App.
 */
export interface PlannerState {
  caseId?: string;
  lastKind?: string;
  lastSymptom?: string;
  pendingQuote?: { part_id: string; case_id?: string; name: string };
  parts?: { id: string; name: string; price_cents: number }[];
  clarify?: { id: string; label: string }[];
  awaitingObservation?: boolean;
}

export type Plan = { kind: "tool"; name: string; args: Record<string, unknown>; note: string } | { kind: "say"; text: string };

const APPLIANCE_RE = /\b(dish ?washer|washing machine|washer|dryer|tumble dryer|fridge|refrigerator|freezer|ice maker|oven|range|stove|cooker|garbage disposal|disposal|water heater|boiler|hot water|air conditioner|air conditioning|aircon|a\/?c|hvac|router|wi-?fi|internet|modem)\b/i;
const PROBLEM_RE = /\b(not|isn'?t|won'?t|doesn'?t|don'?t|can'?t|stopped|broken|broke|leak\w*|nois\w*|hum\w*|smell\w*|stuck|jam\w*|error|flash\w*|warm|cold|slow|dropping|drain\w*|spin\w*|heat\w*|cool\w*|wet|dirty|cloudy|puddle|water at|standing water|no hot water|something('s| is) wrong|problem|issue|trouble)\b/i;
const ORDINAL: Record<string, number> = { first: 0, one: 0, "1": 0, "1st": 0, best: 0, top: 0, second: 1, two: 1, "2": 1, "2nd": 1, third: 2, three: 2, "3": 2, "3rd": 2, fourth: 3, "4": 3, fifth: 4, "5": 4 };

export function plan(utteranceRaw: string, s: PlannerState): Plan {
  const u = utteranceRaw.trim().replace(/^(alexa|hey alexa|ask homemend|homemend)[,:]?\s*/i, "").trim();
  const lower = u.toLowerCase();
  if (!lower) return { kind: "say", text: "I didn't catch that." };

  // --- conversation-state-dependent turns first ---
  if (s.clarify?.length) {
    const hit = s.clarify.find((o) => o.label.split(/\s+/).some((w) => w.length > 3 && lower.includes(w.toLowerCase())));
    if (hit) return { kind: "tool", name: "start_repair_case", args: { appliance: hit.id, symptom: s.lastSymptom ?? u }, note: `clarified → ${hit.label}` };
  }
  if (s.awaitingObservation && s.caseId) {
    return { kind: "tool", name: "report_step_result", args: { case_id: s.caseId, outcome: "found_issue", observation: u }, note: "observation after 'found something'" };
  }
  if (s.pendingQuote) {
    if (/^(yes|yeah|yep|sure|ok|okay|confirm|go ahead|do it|order it|place (the )?order|buy it|please do)\b/.test(lower))
      return { kind: "tool", name: "order_part", args: { part_id: s.pendingQuote.part_id, case_id: s.pendingQuote.case_id, confirm: true }, note: "confirmed quote" };
    if (/^(no|nope|not now|cancel|never mind|don'?t)\b/.test(lower)) return { kind: "say", text: `Okay, I won't order the ${s.pendingQuote.name}. The case stays open, and you can order it any time.` };
  }
  if (s.parts?.length) {
    const m = lower.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|one|two|three|best|top|cheapest|cheaper)\b/);
    if (m && /\b(order|buy|get|take|that|one|option|pick|choose)\b/.test(lower)) {
      let idx = ORDINAL[m[1]] ?? 0;
      if (/cheap/.test(m[1])) idx = s.parts.reduce((bi, p, i, arr) => (p.price_cents < arr[bi].price_cents ? i : bi), 0);
      const p = s.parts[Math.min(idx, s.parts.length - 1)];
      return { kind: "tool", name: "order_part", args: { part_id: p.id, case_id: s.caseId }, note: `selected option ${idx + 1} → quote` };
    }
  }

  // --- global intents ---
  if (/\b(what('s| is| do)?\s*(up|new|due|pending|going on)|need(s)? (my )?attention|home brief|brief me|anything (due|pending|new)|any updates?|to ?do( list)? at home|status at home)\b/.test(lower))
    return { kind: "tool", name: "get_household_brief", args: {}, note: "brief intent" };
  if (/\b(did|has|is) (my|the) (part|order|hose|pump|filter|package|delivery)\b.*\b(arrive|come|here|delivered|get here)\b|\bwhere('s| is) (my|the) (part|order)\b/.test(lower))
    return { kind: "tool", name: "get_household_brief", args: {}, note: "arrival question → brief" };
  if (/\b(list|show|what|which) (my |are my |do you know about my )?(appliances|devices)\b|\bwhat do you know about my (home|house|kitchen)\b/.test(lower))
    return { kind: "tool", name: "list_appliances", args: {}, note: "appliances intent" };
  const reg = lower.match(/\b(add|register|i (just )?(got|bought)|we have) (a |an |my |the )?(new )?(?<type>dish ?washer|washing machine|washer|dryer|fridge|refrigerator|oven|range|stove|garbage disposal|disposal|water heater|air conditioner|ac|router)\b(?: (?:in|for) the (?<room>[a-z ]+?))?(?:[,.]? model (?<model>[a-z0-9-]+))?\s*$/);
  if (reg?.groups) return { kind: "tool", name: "register_appliance", args: { type: reg.groups.type, room: reg.groups.room?.trim(), model: reg.groups.model?.toUpperCase() }, note: "register intent" };
  if (/\b(i )?(replaced|changed|cleaned|flushed|vacuumed|did) (the )?(.*)(filter|coils?|vent|gasket|tank|firmware)\b/.test(lower) && !/\b(not|didn'?t)\b/.test(lower)) {
    const appl = lower.match(APPLIANCE_RE)?.[1];
    const task = lower.match(/(filter|coils?|vent|gasket|tank|firmware)/)?.[1];
    return { kind: "tool", name: "complete_maintenance_task", args: { appliance: appl, task }, note: "maintenance done" };
  }
  const fu = lower.match(/\b(remind me|follow up|check (back )?in|check on it) (?<when>tomorrow|today|in \d+ (days?|weeks?)|next week|on \d{4}-\d{2}-\d{2})\b/);
  if (fu?.groups && s.caseId) return { kind: "tool", name: "schedule_followup", args: { case_id: s.caseId, due: fu.groups.when.replace(/^on /, "") }, note: "follow-up intent" };
  if (/\b(where were we|where did we leave|status of|how('s| is) the (repair|case)|what did we try|show (me )?the case|case history)\b/.test(lower))
    return { kind: "tool", name: "get_case", args: s.caseId ? { case_id: s.caseId } : {}, note: "case status" };

  // --- in-case turns ---
  const inCase = !!s.caseId && ["step", "case", "diagnosis", "order", "parts", "brief"].includes(s.lastKind ?? "");
  if (inCase) {
    if (/\b(fixed|works now|working (again|now)|that did it|that was it|problem('s| is) gone|all good now|it('s| is) draining|solved|it works)\b/.test(lower) && !/\b(not|isn'?t|still)\b/.test(lower))
      return { kind: "tool", name: "report_step_result", args: { case_id: s.caseId, outcome: "fixed" }, note: "outcome fixed" };
    if (/\b(found|there('s| is) a|it('s| is) (cracked|broken|clogged|kinked|loose|split|torn|burnt|frayed|jammed|blocked|leaking|dead))\b|\b(crack|clog|kink|tear|burn|fray|jam|block)\w*\b/.test(lower))
      return { kind: "tool", name: "report_step_result", args: { case_id: s.caseId, outcome: "found_issue", observation: u }, note: "outcome found_issue" };
    if (/\b(no change|nothing changed|didn'?t (help|work|change)|still (not|the same|broken|doing it)|same (problem|thing)|that wasn'?t it|not fixed|it('s| is) (clean|clear|fine|ok|okay) but|checked.*(clean|clear|fine|nothing)|looks (clean|fine|ok|normal)|all clear|done,? (it'?s|nothing))\b/.test(lower))
      return { kind: "tool", name: "report_step_result", args: { case_id: s.caseId, outcome: "not_fixed" }, note: "outcome not_fixed" };
    if (/^(done|ok|okay|next|did that|i did (that|it)|checked( it)?|tried (that|it))\b/.test(lower) && !/fix/.test(lower))
      return { kind: "tool", name: "report_step_result", args: { case_id: s.caseId, outcome: "not_fixed" }, note: "outcome done → not_fixed" };
    if (/\b(skip|can'?t do that|not possible|later)\b/.test(lower)) return { kind: "tool", name: "report_step_result", args: { case_id: s.caseId, outcome: "skipped" }, note: "outcome skipped" };
    if (/\b(find|show|order|buy|get|need|see)\b.*\b(parts?|replacement|hose|pump|filter|belt|element|fuse|lock|valve|igniter)\b/.test(lower) && !s.parts?.length)
      return { kind: "tool", name: "find_parts", args: { case_id: s.caseId }, note: "parts intent" };
    if (/\b(other options|different one|something else|cheaper|see (the )?(others|options))\b/.test(lower)) return { kind: "tool", name: "find_parts", args: { case_id: s.caseId }, note: "parts (other options)" };
    if (/\b(installed|put (it|the new one) in|it'?s in|new (hose|part|pump|filter) is in)\b/.test(lower)) return { kind: "tool", name: "get_case", args: { case_id: s.caseId }, note: "installed → show case for verification" };
  }

  // --- new problem ---
  const appl = u.match(APPLIANCE_RE);
  if (appl && (PROBLEM_RE.test(lower) || /\b(help|fix|repair|look at)\b/.test(lower)))
    return { kind: "tool", name: "start_repair_case", args: { appliance: appl[1], symptom: u }, note: "new problem → start case" };
  if (/\b(find|show|order|buy|need)\b.*\b(filter|part|parts)\b/.test(lower) && appl)
    return { kind: "tool", name: "find_parts", args: { appliance: appl[1], part_type: /water/.test(lower) ? "water_filter" : /air/.test(lower) ? "air_filter" : undefined }, note: "parts for appliance" };

  // --- fallbacks ---
  if (/^(hi|hello|hey|good (morning|evening|afternoon))\b/.test(lower)) return { kind: "say", text: "Hi. I can troubleshoot appliance problems step by step, find and order the right parts, and keep track of home maintenance. What's going on?" };
  // Judges type their own sentences. If an appliance is named at all, open (or resume) a case with the whole
  // sentence as the symptom: the server's tree matcher and resume logic do the rest, and a wrong guess is cheap
  // to correct ("skip" / "that wasn't it"). Alexa+ would make this call from the tool descriptions.
  if (appl) return { kind: "tool", name: "start_repair_case", args: { appliance: appl[1], symptom: u }, note: "appliance mentioned → start/resume case" };
  if (PROBLEM_RE.test(lower) && !inCase)
    return { kind: "say", text: "Which appliance is that? I can help with the dishwasher, washer, dryer, fridge, oven, garbage disposal, water heater, air conditioner, or router." };
  if (/^(yes|yeah|yep|sure|ok|okay|no|nope)\b/.test(lower) && inCase) return { kind: "tool", name: "get_case", args: { case_id: s.caseId }, note: "bare yes/no in a case → show where we are" };
  if (/\b(thanks|thank you|great|awesome|perfect)\b/.test(lower)) return { kind: "say", text: "You're welcome. I'll keep an eye on things and check in when there's something to do." };
  if (/\b(help|what can you do)\b/.test(lower)) return { kind: "say", text: "Tell me what's wrong, like 'the dryer runs but doesn't heat'. I'll walk you through safe checks one at a time, diagnose it, find parts that fit your model, and follow up when they arrive. You can also ask what needs attention at home." };
  return { kind: "say", text: "I'm not sure how to help with that in HomeMend. Describe an appliance problem, ask what needs attention at home, or ask about a part." };
}

/** Update planner memory from the tool result's structuredContent. */
export function remember(s: PlannerState, toolName: string, sc: any): PlannerState {
  const n: PlannerState = { ...s, awaitingObservation: false, clarify: undefined };
  if (!sc || typeof sc !== "object") return n;
  n.lastKind = sc.kind;
  if (sc.kind === "error") return { ...s, lastKind: s.lastKind };
  if (sc.case_id) n.caseId = sc.case_id;
  if (sc.kind === "case" && sc.case?.case_id) n.caseId = sc.case.case_id;
  if (sc.kind === "clarify") n.clarify = sc.options;
  if (toolName === "start_repair_case") n.lastSymptom = sc.symptom ?? s.lastSymptom;
  n.pendingQuote = sc.kind === "order" && sc.phase === "quote" ? { part_id: sc.order.part.id, case_id: sc.order.case_id, name: sc.order.part.name } : undefined;
  n.parts = sc.kind === "parts" ? sc.parts : sc.kind === "diagnosis" ? sc.recommended_parts : undefined;
  if (sc.kind === "resolved" || sc.kind === "escalate") n.caseId = undefined;
  if (sc.kind === "brief" && !n.caseId && sc.open_cases?.length === 1) n.caseId = sc.open_cases[0].case_id;
  return n;
}
