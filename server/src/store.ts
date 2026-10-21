/**
 * HomeMend persistent store.
 *
 * A small JSON-file store keyed by household. Each household's state is a single document
 * persisted atomically (write temp file + rename). Volume is tiny (one household = a few KB),
 * so a database would be over-engineering; the abstraction lets us swap in DynamoDB/SQLite later.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

export type ApplianceType =
  | "dishwasher"
  | "washer"
  | "dryer"
  | "refrigerator"
  | "oven"
  | "garbage_disposal"
  | "water_heater"
  | "air_conditioner"
  | "router";

export interface Appliance {
  id: string;
  type: ApplianceType;
  /** Fictional brand/model in seed data to avoid third-party trademarks in demos. */
  brand?: string;
  model?: string;
  room?: string;
  purchased_on?: string; // ISO date
  created_at: string;
}

export type CaseStatus = "triage" | "diagnosed" | "awaiting_part" | "verify_fix" | "resolved" | "escalated";

export interface CaseStep {
  step_id: string;
  node_id: string;
  asked_at: string;
  outcome?: "fixed" | "not_fixed" | "found_issue" | "skipped";
  observation?: string;
}

export interface RepairCase {
  id: string;
  appliance_id: string;
  symptom: string;
  tree_id: string;
  current_node: string;
  status: CaseStatus;
  steps: CaseStep[];
  diagnosis?: { summary: string; part_types: string[]; confidence: "low" | "medium" | "high" };
  order_id?: string;
  resolution?: string;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  case_id?: string;
  appliance_id: string;
  part_id: string;
  part_name: string;
  price_cents: number;
  currency: "USD";
  status: "quoted" | "placed" | "delivered";
  quoted_at: string;
  placed_at?: string;
  eta: string; // ISO date
}

export interface FollowUp {
  id: string;
  case_id: string;
  due: string; // ISO date
  note: string;
  done: boolean;
}

export interface MaintenanceTask {
  id: string;
  appliance_id: string;
  task: string;
  interval_days: number;
  last_done?: string; // ISO date
  next_due: string; // ISO date
}

export interface Household {
  id: string;
  appliances: Appliance[];
  cases: RepairCase[];
  orders: Order[];
  followups: FollowUp[];
  maintenance: MaintenanceTask[];
  /** Monotonic counter for human-friendly ids. */
  seq: number;
}

export interface Store {
  load(householdId: string): Household;
  save(h: Household): void;
}

const HOUSEHOLD_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function assertHouseholdId(id: string): string {
  if (!HOUSEHOLD_ID.test(id)) throw new Error("Invalid household id");
  return id;
}

export function emptyHousehold(id: string): Household {
  return { id, appliances: [], cases: [], orders: [], followups: [], maintenance: [], seq: 0 };
}

export class FileStore implements Store {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private path(id: string) {
    return join(this.dir, `${assertHouseholdId(id)}.json`);
  }
  load(id: string): Household {
    const p = this.path(id);
    if (!existsSync(p)) return emptyHousehold(id);
    try {
      return JSON.parse(readFileSync(p, "utf8")) as Household;
    } catch (err) {
      // A corrupt file should not take the whole service down; start fresh but keep the bad file.
      renameSync(p, `${p}.corrupt-${Date.now()}`);
      console.error(`[store] corrupt household file for ${id}, moved aside`, err);
      return emptyHousehold(id);
    }
  }
  save(h: Household): void {
    const p = this.path(h.id);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(h, null, 2));
    renameSync(tmp, p);
  }
}

export class MemoryStore implements Store {
  private map = new Map<string, Household>();
  load(id: string): Household {
    assertHouseholdId(id);
    const h = this.map.get(id);
    return h ? structuredClone(h) : emptyHousehold(id);
  }
  save(h: Household): void {
    this.map.set(h.id, structuredClone(h));
  }
}
