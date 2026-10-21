/**
 * HomeMend MCP server factory.
 *
 * One McpServer is created per HTTP request (stateless Streamable HTTP). Household identity comes
 * from the transport layer (see main.ts) — in a production Alexa+ add-on it would come from the
 * account-linked OAuth token.
 *
 * Every tool returns both `content` (a speakable summary Alexa+ can weave into its reply) and
 * `structuredContent` (typed data for the MCP App view and for Alexa's own rendering).
 */
import { McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";
import { Engine, EngineError, type View } from "./engine.js";
import type { Clock } from "./engine.js";
import type { Store } from "./store.js";

export const SERVER_INFO = { name: "homemend", version: "0.1.0", title: "HomeMend — household repair agent" };

export interface ViewResource {
  uri: string;
  html: string;
}

function ok(view: View) {
  return {
    content: [{ type: "text" as const, text: view.summary }],
    structuredContent: view as unknown as Record<string, unknown>,
  };
}

function fail(err: unknown) {
  const message = err instanceof EngineError ? err.message : err instanceof Error ? err.message : String(err);
  const code = err instanceof EngineError ? err.code : "internal";
  if (!(err instanceof EngineError)) console.error("[homemend] tool error", err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    structuredContent: { kind: "error", code, message },
  };
}

const run = (fn: () => View) => {
  try {
    return ok(fn());
  } catch (e) {
    return fail(e);
  }
};

export function createHomeMendServer(opts: { store: Store; householdId: string; clock: Clock; view: ViewResource }): McpServer {
  const { store, householdId, clock, view } = opts;
  const engine = new Engine(store, householdId, clock);
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "HomeMend is a household repair and maintenance agent. Use it when the person mentions an appliance problem, a part, a repair, or asks what needs attention at home. Always walk one troubleshooting step at a time; never order a part without an explicit confirmation turn.",
  });

  const ui = { ui: { resourceUri: view.uri } };

  registerAppTool(
    server,
    "get_household_brief",
    {
      title: "What needs attention at home",
      description:
        "Summarize everything that needs attention in the household right now: open repair cases and their next action, parts that have arrived or are on the way, follow-ups due, and maintenance tasks due or coming up. Call this for questions like 'what needs attention', 'any updates on my repairs', 'did my part arrive', or at the start of a home-related conversation.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: ui,
    },
    async () => run(() => engine.brief()),
  );

  registerAppTool(
    server,
    "list_appliances",
    {
      title: "List registered appliances",
      description: "List the appliances registered for this household with room, brand, model, age, and whether a repair case is open. Use when the person asks what appliances HomeMend knows about, or before registering a new one.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: ui,
    },
    async () => run(() => engine.listAppliances()),
  );

  registerAppTool(
    server,
    "register_appliance",
    {
      title: "Register an appliance",
      description:
        "Add an appliance to the household registry so HomeMend can troubleshoot it, check part fitment by model, and schedule its maintenance. Supported types: dishwasher, washer, dryer, refrigerator, oven, garbage_disposal, water_heater, air_conditioner, router. Room and model are optional but improve part matching.",
      inputSchema: z.object({
        type: z.string().describe("Appliance type or common name, e.g. 'dishwasher', 'fridge', 'washing machine'"),
        brand: z.string().optional(),
        model: z.string().optional().describe("Model number printed on the appliance label"),
        room: z.string().optional().describe("Where it lives, e.g. 'kitchen', 'basement'"),
        purchased_on: z.string().optional().describe("ISO date YYYY-MM-DD"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: ui,
    },
    async (args) => run(() => engine.registerAppliance(args)),
  );

  registerAppTool(
    server,
    "start_repair_case",
    {
      title: "Start troubleshooting an appliance problem",
      description:
        "Open a repair case when the person describes something wrong with an appliance (e.g. 'the dishwasher isn't draining', 'dryer runs but no heat'). Returns the first safe troubleshooting step. If a case is already open for that appliance it resumes it. If several appliances match, returns a clarification with options. Pass the person's own words as the symptom.",
      inputSchema: z.object({
        appliance: z.string().describe("What the person called it, e.g. 'the dishwasher', 'kitchen fridge', or an appliance id"),
        symptom: z.string().describe("The problem in the person's words"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: ui,
    },
    async (args) => run(() => engine.startCase(args)),
  );

  registerAppTool(
    server,
    "report_step_result",
    {
      title: "Report the result of a troubleshooting step",
      description:
        "Record what happened after the person tried the current step and get the next step, a diagnosis with recommended parts, or an escalation. outcome: 'fixed' if the problem is gone, 'not_fixed' if nothing changed, 'found_issue' if they found something wrong (include observation, e.g. 'the hose is cracked'), 'skipped' if they could not do it. Also used after a part is installed to confirm the fix ('fixed') or report it persists ('not_fixed'). case_id is optional when only one case is open.",
      inputSchema: z.object({
        case_id: z.string().optional(),
        outcome: z.enum(["fixed", "not_fixed", "found_issue", "skipped"]),
        observation: z.string().optional().describe("What the person saw or found, in their words"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: ui,
    },
    async (args) => run(() => engine.reportStep(args)),
  );

  registerAppTool(
    server,
    "get_case",
    {
      title: "Get a repair case",
      description: "Show the status and history of a repair case: steps tried, diagnosis, order and delivery status, resolution. Use for 'where were we with the dishwasher', 'did the part arrive', 'what did we try'. case_id optional when only one case is open.",
      inputSchema: z.object({ case_id: z.string().optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: ui,
    },
    async (args) => run(() => engine.getCase(args)),
  );

  registerAppTool(
    server,
    "find_parts",
    {
      title: "Find replacement parts",
      description:
        "Find compatible replacement parts, best match first, with price, delivery estimate, rating, and whether fitment is verified for the household's appliance model. Usually called after a diagnosis (pass case_id, or omit when one case is open). Can also be called with an appliance and part_type for maintenance items like 'water_filter' or 'air_filter'. Returns up to 5 options to present as a carousel.",
      inputSchema: z.object({
        case_id: z.string().optional(),
        appliance: z.string().optional(),
        part_type: z.string().optional().describe("e.g. drain_hose, drain_pump, water_filter, air_filter, heating_element"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: ui,
    },
    async (args) => run(() => engine.findParts(args)),
  );

  registerAppTool(
    server,
    "order_part",
    {
      title: "Order a replacement part",
      description:
        "Two-phase purchase. Call without confirm (or confirm=false) to get a quote with total and delivery date; the person must explicitly agree before you call again with confirm=true to place the order. Placing the order links it to the repair case and schedules a follow-up for the delivery day. Never set confirm=true unless the person said yes to the quote in this conversation.",
      inputSchema: z.object({
        part_id: z.string().describe("Part id from find_parts, e.g. HM-DH-150"),
        case_id: z.string().optional(),
        confirm: z.boolean().optional().describe("true only after the person confirmed the quote"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: ui,
    },
    async (args) => run(() => engine.orderPart(args)),
  );

  registerAppTool(
    server,
    "schedule_followup",
    {
      title: "Schedule a follow-up on a repair",
      description: "Schedule a reminder to come back to a repair case on a date ('tomorrow', 'in 3 days', 'next week', or YYYY-MM-DD), for example to check whether a fix held or a technician came.",
      inputSchema: z.object({ case_id: z.string().optional(), due: z.string(), note: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: ui,
    },
    async (args) => run(() => engine.scheduleFollowup(args)),
  );

  registerAppTool(
    server,
    "complete_maintenance_task",
    {
      title: "Log a completed maintenance task",
      description: "Mark a routine maintenance task as done (e.g. 'I replaced the fridge water filter', 'cleaned the dishwasher filter') and reschedule it for the next interval. Identify the task by task_id from the brief, or by appliance and task words.",
      inputSchema: z.object({ task_id: z.string().optional(), appliance: z.string().optional(), task: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: ui,
    },
    async (args) => run(() => engine.completeMaintenance(args)),
  );

  registerAppResource(
    server,
    "HomeMend view",
    view.uri,
    {
      description: "Interactive HomeMend card (steps, diagnosis, parts carousel, order confirmation, household brief).",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: { prefersBorder: true } },
    },
    async () => ({ contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: view.html }] }),
  );

  return server;
}
