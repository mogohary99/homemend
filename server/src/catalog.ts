/**
 * HomeMend demo parts catalog.
 *
 * This is a clearly-labelled demonstration catalog with fictional SKUs and prices. In production this
 * module would call a retailer's parts API with the appliance model number for fitment. Brands are
 * fictional on purpose so demo videos contain no third-party trademarks.
 */
export interface Part {
  id: string;
  part_type: string;
  name: string;
  description: string;
  price_cents: number;
  rating: number; // 0..5
  reviews: number;
  delivery_days: number;
  /** Appliance types this part is for. */
  fits: string[];
  /** Fitment is "verified" when the household appliance model is known and in this list; "likely" otherwise. */
  fits_models?: string[];
  image: string; // emoji/icon key rendered by the view; keeps the bundle self-contained
}

export const CATALOG: Part[] = [
  { id: "HM-DH-150", part_type: "drain_hose", name: "Drain hose, 1.5 m, universal", description: "Corrugated polypropylene drain hose with molded 7/8 in and 1 in ends. Includes high-loop clip.", price_cents: 1899, rating: 4.7, reviews: 2140, delivery_days: 1, fits: ["dishwasher"], fits_models: ["NF-DW400", "NF-DW500", "CR-D7"], image: "hose" },
  { id: "HM-DH-200", part_type: "drain_hose", name: "Drain hose, 2.0 m, extended", description: "Longer run for island installs. Same molded ends and clip.", price_cents: 2499, rating: 4.6, reviews: 860, delivery_days: 2, fits: ["dishwasher"], fits_models: ["NF-DW400", "NF-DW500"], image: "hose" },
  { id: "HM-HC-02", part_type: "hose_clamp", name: "Stainless hose clamps, 2 pack", description: "Worm-drive clamps, 3/4 in to 1 1/4 in.", price_cents: 599, rating: 4.8, reviews: 5120, delivery_days: 1, fits: ["dishwasher", "washer"], image: "clamp" },
  { id: "HM-DP-110", part_type: "drain_pump", name: "Drain pump assembly", description: "Synchronous drain pump, 30 W, with gasket. Plug-in replacement.", price_cents: 4299, rating: 4.5, reviews: 640, delivery_days: 2, fits: ["dishwasher"], fits_models: ["NF-DW400", "NF-DW500"], image: "pump" },
  { id: "HM-IV-220", part_type: "inlet_valve", name: "Water inlet valve", description: "Single-coil inlet valve with inline screen.", price_cents: 2799, rating: 4.4, reviews: 410, delivery_days: 2, fits: ["dishwasher", "washer"], image: "valve" },
  { id: "HM-DL-330", part_type: "door_lock", name: "Door lock switch assembly", description: "Three-wire electromechanical door lock. Includes mounting screws.", price_cents: 3499, rating: 4.6, reviews: 980, delivery_days: 1, fits: ["washer"], fits_models: ["CR-W800"], image: "lock" },
  { id: "HM-DB-440", part_type: "drive_belt", name: "Drive belt", description: "Poly-V multi-rib drive belt, 1200 mm.", price_cents: 1599, rating: 4.7, reviews: 1320, delivery_days: 1, fits: ["washer", "dryer"], image: "belt" },
  { id: "HM-HE-550", part_type: "heating_element", name: "Dryer heating element", description: "5300 W coil element in housing. Includes thermostat bracket.", price_cents: 5499, rating: 4.5, reviews: 770, delivery_days: 2, fits: ["dryer"], fits_models: ["BL-TD60"], image: "element" },
  { id: "HM-TF-560", part_type: "thermal_fuse", name: "Thermal fuse", description: "Single-shot thermal fuse, 196°C.", price_cents: 899, rating: 4.8, reviews: 3010, delivery_days: 1, fits: ["dryer"], image: "fuse" },
  { id: "HM-CF-660", part_type: "condenser_fan", name: "Condenser fan motor", description: "12 V DC fan motor with blade and bracket.", price_cents: 3899, rating: 4.3, reviews: 290, delivery_days: 2, fits: ["refrigerator"], image: "fan" },
  { id: "HM-DF-670", part_type: "defrost_heater", name: "Defrost heater", description: "Glass-tube defrost heater, 450 W.", price_cents: 3299, rating: 4.4, reviews: 350, delivery_days: 2, fits: ["refrigerator"], image: "element" },
  { id: "HM-DT-680", part_type: "defrost_thermostat", name: "Defrost thermostat", description: "Bimetal defrost termination thermostat, L47-20F.", price_cents: 1299, rating: 4.6, reviews: 880, delivery_days: 1, fits: ["refrigerator"], image: "fuse" },
  { id: "HM-WF-690", part_type: "water_filter", name: "Refrigerator water filter", description: "Carbon block filter, 6 month / 300 gallon.", price_cents: 3499, rating: 4.7, reviews: 12400, delivery_days: 1, fits: ["refrigerator"], image: "filter" },
  { id: "HM-BE-770", part_type: "bake_element", name: "Oven bake element", description: "2585 W bake element with push-on terminals.", price_cents: 3999, rating: 4.6, reviews: 1500, delivery_days: 1, fits: ["oven"], image: "element" },
  { id: "HM-OI-780", part_type: "oven_igniter", name: "Oven igniter", description: "Flat-style hot surface igniter with bracket.", price_cents: 4599, rating: 4.5, reviews: 2200, delivery_days: 1, fits: ["oven"], image: "igniter" },
  { id: "HM-GD-880", part_type: "disposal_unit", name: "Garbage disposal, 1/2 HP", description: "Continuous feed disposal with quick-mount collar.", price_cents: 9900, rating: 4.6, reviews: 4300, delivery_days: 2, fits: ["garbage_disposal"], image: "disposal" },
  { id: "HM-WE-990", part_type: "water_heater_element", name: "Water heater element, 4500 W", description: "Screw-in incoloy element with gasket.", price_cents: 2199, rating: 4.7, reviews: 1900, delivery_days: 1, fits: ["water_heater"], image: "element" },
  { id: "HM-TC-991", part_type: "thermocouple", name: "Universal thermocouple, 24 in", description: "Copper thermocouple with adapter fittings.", price_cents: 1199, rating: 4.6, reviews: 2600, delivery_days: 1, fits: ["water_heater"], image: "fuse" },
  { id: "HM-RC-995", part_type: "run_capacitor", name: "Dual run capacitor 45/5 µF", description: "440 V dual run capacitor. Technician installation recommended.", price_cents: 2499, rating: 4.5, reviews: 1700, delivery_days: 1, fits: ["air_conditioner"], image: "capacitor" },
  { id: "HM-AF-996", part_type: "air_filter", name: "Pleated air filter, MERV 11, 4 pack", description: "16x25x1 pleated filters.", price_cents: 3299, rating: 4.7, reviews: 8800, delivery_days: 1, fits: ["air_conditioner"], image: "filter" },
  { id: "HM-RT-997", part_type: "wifi_router", name: "Dual-band Wi‑Fi 6 router", description: "AX1800, four gigabit ports.", price_cents: 7999, rating: 4.4, reviews: 6100, delivery_days: 1, fits: ["router"], image: "router" },
];

export function partsFor(partTypes: string[], applianceType: string, model?: string): Part[] {
  const parts = CATALOG.filter((p) => partTypes.includes(p.part_type) && p.fits.includes(applianceType));
  // Verified fitment first, then rating.
  return parts
    .map((p) => ({ p, verified: !!(model && p.fits_models?.includes(model)) }))
    .sort((a, b) => Number(b.verified) - Number(a.verified) || b.p.rating - a.p.rating)
    .map((x) => x.p);
}

export function getPart(id: string): Part | undefined {
  return CATALOG.find((p) => p.id === id);
}

export function fitment(part: Part, model?: string): "verified" | "likely" | "unknown" {
  if (model && part.fits_models?.includes(model)) return "verified";
  if (part.fits_models && model) return "likely";
  return part.fits_models ? "likely" : "unknown";
}
