/**
 * Triage knowledge base.
 *
 * Hand-authored decision trees for the most common household appliance complaints. Each tree is a
 * directed graph of "check" nodes (one safe, concrete thing the person can do right now) that end
 * in "diagnosis" nodes (what is wrong, which part types fix it) or "escalate" nodes (call a pro).
 *
 * This is deliberately deterministic: the LLM host (Alexa+) handles language; HomeMend owns the
 * safety-reviewed procedure and the state of where the household is in that procedure.
 */
import type { ApplianceType } from "./store.js";

export interface CheckNode {
  kind: "check";
  id: string;
  title: string; // short, speakable
  instruction: string; // one or two sentences
  safety?: string;
  /** Edges keyed by outcome. `found_issue` is used when the step reveals a visible fault. */
  next: { fixed?: string; not_fixed: string; found_issue?: string; skipped?: string };
  /** Optional hint for how long this takes (minutes). */
  minutes?: number;
}
export interface DiagnosisNode {
  kind: "diagnosis";
  id: string;
  summary: string;
  part_types: string[];
  confidence: "low" | "medium" | "high";
  diy: boolean;
  verify_hint: string;
}
export interface EscalateNode {
  kind: "escalate";
  id: string;
  summary: string;
  reason: string;
}
export type TreeNode = CheckNode | DiagnosisNode | EscalateNode;

export interface TriageTree {
  id: string;
  appliance: ApplianceType;
  title: string;
  /** Lower-cased keywords matched against the symptom text. */
  keywords: string[];
  root: string;
  nodes: Record<string, TreeNode>;
}

const t = (tree: TriageTree) => tree;

export const TREES: TriageTree[] = [
  t({
    id: "dishwasher.not_draining",
    appliance: "dishwasher",
    title: "Dishwasher not draining",
    keywords: ["drain", "standing water", "water at the bottom", "water left", "puddle", "won't empty", "not emptying"],
    root: "filter",
    nodes: {
      filter: {
        kind: "check",
        id: "filter",
        title: "Check the filter",
        instruction:
          "Remove the bottom rack, twist out the cylindrical filter at the base of the tub, and rinse it under the tap. Look for food, glass, or labels blocking it.",
        minutes: 3,
        next: { fixed: "resolved_filter", not_fixed: "drain_hose", found_issue: "resolved_filter" },
      },
      drain_hose: {
        kind: "check",
        id: "drain_hose",
        title: "Check the drain hose",
        instruction:
          "Under the sink, follow the corrugated hose from the dishwasher to the drain or disposal. Straighten any kinks and make sure the high loop is intact. Squeeze it along its length to feel for a blockage or crack.",
        safety: "Turn the dishwasher off at the power switch first.",
        minutes: 5,
        next: { fixed: "resolved_hose_kink", not_fixed: "air_gap", found_issue: "diag_hose" },
      },
      air_gap: {
        kind: "check",
        id: "air_gap",
        title: "Check the air gap or disposal plug",
        instruction:
          "If you have a chrome air gap on the sink, pop the cap off and clear any debris. If the hose goes into a garbage disposal that was installed recently, make sure the knockout plug was removed.",
        minutes: 3,
        next: { fixed: "resolved_air_gap", not_fixed: "pump_listen" },
      },
      pump_listen: {
        kind: "check",
        id: "pump_listen",
        title: "Listen to the drain pump",
        instruction:
          "Start a rinse cycle and cancel it after a minute to force a drain. Listen near the bottom front. A steady hum with no water moving usually means the drain pump impeller is jammed or the pump has failed.",
        minutes: 4,
        next: { fixed: "resolved_filter", not_fixed: "diag_pump", found_issue: "diag_pump" },
      },
      diag_hose: {
        kind: "diagnosis",
        id: "diag_hose",
        summary: "The drain hose is damaged or blocked and should be replaced.",
        part_types: ["drain_hose", "hose_clamp"],
        confidence: "high",
        diy: true,
        verify_hint: "Run a short cycle and confirm the tub is empty at the end.",
      },
      diag_pump: {
        kind: "diagnosis",
        id: "diag_pump",
        summary: "The drain pump is likely jammed or failed.",
        part_types: ["drain_pump"],
        confidence: "medium",
        diy: true,
        verify_hint: "Run a short cycle and confirm the tub is empty at the end.",
      },
      resolved_filter: {
        kind: "diagnosis",
        id: "resolved_filter",
        summary: "A clogged filter was the cause. Cleaning it fixed the drain.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run a short cycle and confirm the tub is empty at the end.",
      },
      resolved_hose_kink: {
        kind: "diagnosis",
        id: "resolved_hose_kink",
        summary: "A kinked drain hose was the cause. Straightening it fixed the drain.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run a short cycle and confirm the tub is empty at the end.",
      },
      resolved_air_gap: {
        kind: "diagnosis",
        id: "resolved_air_gap",
        summary: "A blocked air gap was the cause. Clearing it fixed the drain.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run a short cycle and confirm the tub is empty at the end.",
      },
    },
  }),
  t({
    id: "dishwasher.not_cleaning",
    appliance: "dishwasher",
    title: "Dishes come out dirty or cloudy",
    keywords: ["dirty", "not cleaning", "cloudy", "film", "residue", "spots", "gritty"],
    root: "spray_arms",
    nodes: {
      spray_arms: {
        kind: "check",
        id: "spray_arms",
        title: "Clear the spray arms",
        instruction: "Pull out the racks, unclip the spray arms, and poke any blocked holes clear with a toothpick. Rinse and refit.",
        minutes: 5,
        next: { fixed: "resolved_arms", not_fixed: "water_temp", found_issue: "resolved_arms" },
      },
      water_temp: {
        kind: "check",
        id: "water_temp",
        title: "Check incoming water temperature",
        instruction: "Run the kitchen hot tap for a minute before starting the dishwasher. It should be hot to the touch. If it never gets hot, the water heater is the real problem.",
        minutes: 2,
        next: { fixed: "resolved_temp", not_fixed: "rinse_aid" },
      },
      rinse_aid: {
        kind: "check",
        id: "rinse_aid",
        title: "Rinse aid and detergent",
        instruction: "Top up the rinse aid, and switch to a fresh detergent. If the glass is permanently etched, that is damage from past hard-water washes and will not wash off.",
        minutes: 2,
        next: { fixed: "resolved_temp", not_fixed: "diag_inlet" },
      },
      diag_inlet: {
        kind: "diagnosis",
        id: "diag_inlet",
        summary: "Weak water fill is likely. The inlet valve or its screen may be restricted.",
        part_types: ["inlet_valve"],
        confidence: "medium",
        diy: true,
        verify_hint: "Run a normal cycle and check the glasses.",
      },
      resolved_arms: {
        kind: "diagnosis",
        id: "resolved_arms",
        summary: "Blocked spray arms were the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run a normal cycle and check the glasses.",
      },
      resolved_temp: {
        kind: "diagnosis",
        id: "resolved_temp",
        summary: "Low water temperature or detergent was the cause.",
        part_types: [],
        confidence: "medium",
        diy: true,
        verify_hint: "Run a normal cycle and check the glasses.",
      },
    },
  }),
  t({
    id: "washer.not_spinning",
    appliance: "washer",
    title: "Washer not spinning or draining",
    keywords: ["spin", "spinning", "soaking wet", "won't drain", "not draining", "clothes wet", "stuck on wash"],
    root: "load_balance",
    nodes: {
      load_balance: {
        kind: "check",
        id: "load_balance",
        title: "Rebalance the load",
        instruction: "Open the lid or door, spread the clothes evenly around the drum, remove anything heavy like a single towel, and start a spin-only cycle.",
        minutes: 2,
        next: { fixed: "resolved_balance", not_fixed: "drain_filter" },
      },
      drain_filter: {
        kind: "check",
        id: "drain_filter",
        title: "Clean the drain pump filter",
        instruction: "On a front loader, open the small door at the bottom front, put a towel and a tray down, and slowly unscrew the filter. Remove coins, hair ties, and lint.",
        safety: "Unplug the washer first. Some water will come out.",
        minutes: 8,
        next: { fixed: "resolved_filter", not_fixed: "lid_switch", found_issue: "resolved_filter" },
      },
      lid_switch: {
        kind: "check",
        id: "lid_switch",
        title: "Test the lid or door lock",
        instruction: "Close the lid or door firmly and listen for a click when the cycle starts. If there is no click and the display shows a lock error, the lock switch is failing.",
        minutes: 2,
        next: { fixed: "resolved_balance", not_fixed: "belt_listen", found_issue: "diag_lid" },
      },
      belt_listen: {
        kind: "check",
        id: "belt_listen",
        title: "Listen to the motor",
        instruction: "Start a spin cycle and listen. A motor running while the drum stays still points to a broken drive belt or coupler. Silence points to the motor or control board.",
        minutes: 3,
        next: { fixed: "resolved_balance", not_fixed: "escalate_control", found_issue: "diag_belt" },
      },
      diag_lid: {
        kind: "diagnosis",
        id: "diag_lid",
        summary: "The lid or door lock switch has failed, so the washer will not spin for safety.",
        part_types: ["door_lock"],
        confidence: "high",
        diy: true,
        verify_hint: "Run a spin-only cycle with a small load.",
      },
      diag_belt: {
        kind: "diagnosis",
        id: "diag_belt",
        summary: "The drive belt is worn or broken.",
        part_types: ["drive_belt"],
        confidence: "medium",
        diy: true,
        verify_hint: "Run a spin-only cycle with a small load.",
      },
      escalate_control: {
        kind: "escalate",
        id: "escalate_control",
        summary: "This looks like a motor or control board fault.",
        reason: "Those repairs involve mains voltage and diagnostics with a meter. A technician visit is the safer next step.",
      },
      resolved_balance: {
        kind: "diagnosis",
        id: "resolved_balance",
        summary: "An unbalanced load or an unlatched door was the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run a spin-only cycle with a small load.",
      },
      resolved_filter: {
        kind: "diagnosis",
        id: "resolved_filter",
        summary: "A blocked drain pump filter was the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run a spin-only cycle with a small load.",
      },
    },
  }),
  t({
    id: "dryer.not_heating",
    appliance: "dryer",
    title: "Dryer runs but does not heat",
    keywords: ["not heating", "no heat", "cold", "takes forever", "still damp", "not drying"],
    root: "lint",
    nodes: {
      lint: {
        kind: "check",
        id: "lint",
        title: "Clear lint from the filter and vent",
        instruction: "Empty the lint screen, then pull the dryer out and disconnect the exhaust hose. Clear lint from the hose and the wall vent. Restricted airflow is the most common cause of poor heat.",
        safety: "Unplug the dryer or turn off the gas valve first.",
        minutes: 15,
        next: { fixed: "resolved_vent", not_fixed: "breaker", found_issue: "resolved_vent" },
      },
      breaker: {
        kind: "check",
        id: "breaker",
        title: "Check the breaker",
        instruction: "Electric dryers use two breakers. If one has tripped, the drum turns but the element gets no power. Reset both fully off and then on.",
        minutes: 2,
        next: { fixed: "resolved_breaker", not_fixed: "diag_element" },
      },
      diag_element: {
        kind: "diagnosis",
        id: "diag_element",
        summary: "The heating element or its thermal fuse has likely failed.",
        part_types: ["heating_element", "thermal_fuse"],
        confidence: "medium",
        diy: true,
        verify_hint: "Run a timed dry for ten minutes and feel for heat at the door.",
      },
      resolved_vent: {
        kind: "diagnosis",
        id: "resolved_vent",
        summary: "A clogged vent was restricting airflow.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run a timed dry for ten minutes and feel for heat at the door.",
      },
      resolved_breaker: {
        kind: "diagnosis",
        id: "resolved_breaker",
        summary: "A tripped breaker leg was the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run a timed dry for ten minutes and feel for heat at the door.",
      },
    },
  }),
  t({
    id: "refrigerator.not_cooling",
    appliance: "refrigerator",
    title: "Refrigerator not cold enough",
    keywords: ["not cold", "warm", "not cooling", "ice melting", "freezer thaw", "food spoil"],
    root: "settings_airflow",
    nodes: {
      settings_airflow: {
        kind: "check",
        id: "settings_airflow",
        title: "Settings and airflow",
        instruction: "Confirm the fridge is set to about 37°F (3°C) and the freezer to 0°F (-18°C). Make sure vents inside are not blocked by food and the door seals close fully.",
        minutes: 2,
        next: { fixed: "resolved_settings", not_fixed: "condenser" },
      },
      condenser: {
        kind: "check",
        id: "condenser",
        title: "Clean the condenser coils",
        instruction: "Remove the kick plate at the bottom front or the back panel and vacuum the dust off the coils. Check that the small fan near the compressor spins when the fridge runs.",
        safety: "Unplug the fridge first.",
        minutes: 10,
        next: { fixed: "resolved_coils", not_fixed: "frost", found_issue: "diag_condenser_fan" },
      },
      frost: {
        kind: "check",
        id: "frost",
        title: "Look for frost on the back wall of the freezer",
        instruction: "Remove the freezer drawers and look at the back panel. Heavy frost means the defrost system has failed and the evaporator is iced over.",
        minutes: 3,
        next: { fixed: "resolved_coils", not_fixed: "escalate_sealed", found_issue: "diag_defrost" },
      },
      diag_condenser_fan: {
        kind: "diagnosis",
        id: "diag_condenser_fan",
        summary: "The condenser fan motor is not running.",
        part_types: ["condenser_fan"],
        confidence: "medium",
        diy: true,
        verify_hint: "Check temperatures after six hours.",
      },
      diag_defrost: {
        kind: "diagnosis",
        id: "diag_defrost",
        summary: "The defrost system has failed. Most often it is the defrost heater or thermostat.",
        part_types: ["defrost_heater", "defrost_thermostat"],
        confidence: "medium",
        diy: true,
        verify_hint: "Check temperatures after twelve hours.",
      },
      escalate_sealed: {
        kind: "escalate",
        id: "escalate_sealed",
        summary: "This may be a compressor or sealed-system fault.",
        reason: "Refrigerant work requires a licensed technician. Move perishables to a cooler.",
      },
      resolved_settings: {
        kind: "diagnosis",
        id: "resolved_settings",
        summary: "Settings or blocked vents were the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Check temperatures after six hours.",
      },
      resolved_coils: {
        kind: "diagnosis",
        id: "resolved_coils",
        summary: "Dirty condenser coils were the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Check temperatures after six hours.",
      },
    },
  }),
  t({
    id: "oven.not_heating",
    appliance: "oven",
    title: "Oven not heating",
    keywords: ["oven", "not heating", "won't heat", "no heat", "undercooked", "takes long to preheat", "won't ignite"],
    root: "mode",
    nodes: {
      mode: {
        kind: "check",
        id: "mode",
        title: "Check mode and clock",
        instruction: "Make sure the oven is not in a delayed start, Sabbath, or demo mode and the clock is set. Select Bake at 350°F (175°C) and wait five minutes.",
        minutes: 5,
        next: { fixed: "resolved_mode", not_fixed: "element_glow" },
      },
      element_glow: {
        kind: "check",
        id: "element_glow",
        title: "Watch the element or igniter",
        instruction: "Electric: the bottom element should glow red within a few minutes. Gas: the igniter should glow then the burner should light within about ninety seconds. A glow with no flame means a weak igniter.",
        minutes: 3,
        next: { fixed: "resolved_mode", not_fixed: "escalate_control", found_issue: "diag_element" },
      },
      diag_element: {
        kind: "diagnosis",
        id: "diag_element",
        summary: "The bake element or igniter has failed.",
        part_types: ["bake_element", "oven_igniter"],
        confidence: "high",
        diy: true,
        verify_hint: "Preheat to 350°F and confirm with an oven thermometer.",
      },
      escalate_control: {
        kind: "escalate",
        id: "escalate_control",
        summary: "No glow at all points to the control board or a safety valve.",
        reason: "Gas and high-voltage control faults should be handled by a technician.",
      },
      resolved_mode: {
        kind: "diagnosis",
        id: "resolved_mode",
        summary: "A mode or clock setting was the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Preheat to 350°F and confirm with an oven thermometer.",
      },
    },
  }),
  t({
    id: "garbage_disposal.humming",
    appliance: "garbage_disposal",
    title: "Disposal hums but does not spin",
    keywords: ["hum", "humming", "jammed", "won't turn", "stuck", "not grinding", "disposal"],
    root: "reset",
    nodes: {
      reset: {
        kind: "check",
        id: "reset",
        title: "Free the jam",
        instruction: "Switch the disposal off. Insert the hex wrench into the hole under the unit and work it back and forth until the plate turns freely. Press the red reset button underneath, then test.",
        safety: "Never put your hand in the chamber. Use tongs to remove objects.",
        minutes: 5,
        next: { fixed: "resolved_jam", not_fixed: "diag_motor", found_issue: "resolved_jam" },
      },
      diag_motor: {
        kind: "diagnosis",
        id: "diag_motor",
        summary: "The motor is seized or the start capacitor has failed. Replacement is usually cheaper than repair.",
        part_types: ["disposal_unit"],
        confidence: "medium",
        diy: true,
        verify_hint: "Run water and switch it on for ten seconds.",
      },
      resolved_jam: {
        kind: "diagnosis",
        id: "resolved_jam",
        summary: "A jam was the cause and it is cleared.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run water and switch it on for ten seconds.",
      },
    },
  }),
  t({
    id: "water_heater.no_hot_water",
    appliance: "water_heater",
    title: "No hot water",
    keywords: ["no hot water", "cold shower", "lukewarm", "water heater", "hot water", "not hot"],
    root: "pilot_breaker",
    nodes: {
      pilot_breaker: {
        kind: "check",
        id: "pilot_breaker",
        title: "Pilot light or breaker",
        instruction: "Gas: look through the small window at the bottom for a pilot flame. If it is out, follow the relight label on the tank. Electric: reset the water heater breaker and press the red reset button behind the upper access panel.",
        safety: "If you smell gas, stop and ventilate. Do not relight.",
        minutes: 5,
        next: { fixed: "resolved_pilot", not_fixed: "diag_element" },
      },
      diag_element: {
        kind: "diagnosis",
        id: "diag_element",
        summary: "Electric: a heating element or thermostat has failed. Gas: the thermocouple or gas valve.",
        part_types: ["water_heater_element", "thermocouple"],
        confidence: "medium",
        diy: false,
        verify_hint: "Allow an hour, then test the hot tap.",
      },
      resolved_pilot: {
        kind: "diagnosis",
        id: "resolved_pilot",
        summary: "The pilot light or breaker was the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Allow an hour, then test the hot tap.",
      },
    },
  }),
  t({
    id: "air_conditioner.not_cooling",
    appliance: "air_conditioner",
    title: "AC running but not cooling",
    keywords: ["not cooling", "warm air", "ac", "air conditioner", "blowing warm", "not cold"],
    root: "filter",
    nodes: {
      filter: {
        kind: "check",
        id: "filter",
        title: "Replace the air filter",
        instruction: "Slide out the return filter. If you cannot see light through it, replace it. Set the thermostat to Cool and at least 3 degrees below room temperature.",
        minutes: 3,
        next: { fixed: "resolved_filter", not_fixed: "outdoor_unit", found_issue: "resolved_filter" },
      },
      outdoor_unit: {
        kind: "check",
        id: "outdoor_unit",
        title: "Check the outdoor unit",
        instruction: "Go outside. The fan on top should be spinning and the coil should be clear of leaves and grass. Hose the coil down gently if it is dirty.",
        safety: "Turn the system off at the thermostat before cleaning.",
        minutes: 10,
        next: { fixed: "resolved_coil", not_fixed: "escalate_refrigerant", found_issue: "diag_capacitor" },
      },
      diag_capacitor: {
        kind: "diagnosis",
        id: "diag_capacitor",
        summary: "The outdoor fan is not running. A failed run capacitor is the usual cause.",
        part_types: ["run_capacitor"],
        confidence: "medium",
        diy: false,
        verify_hint: "Run the system for thirty minutes and check vent temperature.",
      },
      escalate_refrigerant: {
        kind: "escalate",
        id: "escalate_refrigerant",
        summary: "Airflow is fine but there is no cooling. This points to low refrigerant or a compressor fault.",
        reason: "Refrigerant handling requires a licensed technician.",
      },
      resolved_filter: {
        kind: "diagnosis",
        id: "resolved_filter",
        summary: "A clogged filter was the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run the system for thirty minutes and check vent temperature.",
      },
      resolved_coil: {
        kind: "diagnosis",
        id: "resolved_coil",
        summary: "A dirty outdoor coil was the cause.",
        part_types: [],
        confidence: "high",
        diy: true,
        verify_hint: "Run the system for thirty minutes and check vent temperature.",
      },
    },
  }),
  t({
    id: "router.slow_or_dropping",
    appliance: "router",
    title: "Wi‑Fi slow or dropping",
    keywords: ["wifi", "wi-fi", "internet", "router", "dropping", "slow", "no connection", "offline"],
    root: "power_cycle",
    nodes: {
      power_cycle: {
        kind: "check",
        id: "power_cycle",
        title: "Power cycle modem and router",
        instruction: "Unplug both the modem and the router, wait thirty seconds, plug the modem in first and wait for its lights to settle, then plug in the router.",
        minutes: 4,
        next: { fixed: "resolved_power", not_fixed: "placement" },
      },
      placement: {
        kind: "check",
        id: "placement",
        title: "Check placement and interference",
        instruction: "Move the router off the floor and away from the microwave, cordless phone base, and metal cabinets. Try the 5 GHz network name if the device supports it.",
        minutes: 5,
        next: { fixed: "resolved_placement", not_fixed: "diag_router" },
      },
      diag_router: {
        kind: "diagnosis",
        id: "diag_router",
        summary: "The router firmware or hardware is likely at fault if the modem lights are normal.",
        part_types: ["wifi_router"],
        confidence: "low",
        diy: true,
        verify_hint: "Run a speed test from the same spot.",
      },
      resolved_power: {
        kind: "diagnosis",
        id: "resolved_power",
        summary: "A power cycle fixed it.",
        part_types: [],
        confidence: "medium",
        diy: true,
        verify_hint: "Run a speed test from the same spot.",
      },
      resolved_placement: {
        kind: "diagnosis",
        id: "resolved_placement",
        summary: "Placement or interference was the cause.",
        part_types: [],
        confidence: "medium",
        diy: true,
        verify_hint: "Run a speed test from the same spot.",
      },
    },
  }),
];

/** Words people use for each appliance type. */
export const APPLIANCE_ALIASES: Record<ApplianceType, string[]> = {
  dishwasher: ["dishwasher", "dish washer"],
  washer: ["washer", "washing machine", "laundry machine", "front loader", "top loader"],
  dryer: ["dryer", "tumble dryer", "clothes dryer"],
  refrigerator: ["fridge", "refrigerator", "freezer", "ice maker"],
  oven: ["oven", "range", "stove", "cooker"],
  garbage_disposal: ["disposal", "garbage disposal", "disposer"],
  water_heater: ["water heater", "boiler", "hot water heater", "hot water tank"],
  air_conditioner: ["ac", "a/c", "air conditioner", "air conditioning", "aircon", "hvac"],
  router: ["router", "wifi", "wi-fi", "internet", "modem"],
};

export const APPLIANCE_LABEL: Record<ApplianceType, string> = {
  dishwasher: "dishwasher",
  washer: "washer",
  dryer: "dryer",
  refrigerator: "refrigerator",
  oven: "oven",
  garbage_disposal: "garbage disposal",
  water_heater: "water heater",
  air_conditioner: "air conditioner",
  router: "Wi‑Fi router",
};

/** Default maintenance tasks by appliance type (interval in days). */
export const DEFAULT_MAINTENANCE: Record<ApplianceType, { task: string; interval_days: number }[]> = {
  dishwasher: [{ task: "Clean the filter", interval_days: 30 }, { task: "Run a cleaning cycle", interval_days: 90 }],
  washer: [{ task: "Clean the drain pump filter", interval_days: 90 }, { task: "Wipe the door gasket", interval_days: 30 }],
  dryer: [{ task: "Clear the exhaust vent", interval_days: 180 }],
  refrigerator: [{ task: "Replace the water filter", interval_days: 180 }, { task: "Vacuum the condenser coils", interval_days: 180 }],
  oven: [{ task: "Check the door gasket", interval_days: 365 }],
  garbage_disposal: [{ task: "Grind ice and citrus to clean", interval_days: 30 }],
  water_heater: [{ task: "Flush sediment from the tank", interval_days: 365 }],
  air_conditioner: [{ task: "Replace the air filter", interval_days: 90 }],
  router: [{ task: "Check for firmware updates", interval_days: 90 }],
};

export function detectApplianceType(text: string): ApplianceType | undefined {
  const lower = text.toLowerCase();
  // Longest alias first so "water heater" beats "water".
  const candidates: { type: ApplianceType; alias: string }[] = [];
  for (const [type, aliases] of Object.entries(APPLIANCE_ALIASES) as [ApplianceType, string[]][]) {
    for (const alias of aliases) {
      if (new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}([^a-z]|$)`).test(lower)) {
        candidates.push({ type, alias });
      }
    }
  }
  candidates.sort((a, b) => b.alias.length - a.alias.length);
  return candidates[0]?.type;
}

export function pickTree(appliance: ApplianceType, symptom: string): TriageTree | undefined {
  const lower = symptom.toLowerCase();
  const trees = TREES.filter((tr) => tr.appliance === appliance);
  if (trees.length === 0) return undefined;
  let best: { tree: TriageTree; score: number } | undefined;
  for (const tree of trees) {
    let score = 0;
    for (const kw of tree.keywords) if (lower.includes(kw)) score += kw.length;
    if (!best || score > best.score) best = { tree, score };
  }
  // If nothing matched, fall back to the first tree for that appliance (most common complaint).
  return best?.score ? best.tree : trees[0];
}

export function getTree(id: string): TriageTree | undefined {
  return TREES.find((t) => t.id === id);
}
