// UNIT ALIAS MAP — the ONLY place raw unit strings are normalized.
//
// No other file in the codebase may define aliases. If you find
// another map, delete it and import from here. Ingesting a raw
// unit token anywhere in the app must go through normalizeUnitId.
//
// Rules:
//   - Every alias lowercases its key and maps to a canonical id.
//   - Canonical ids are lowercase, underscore-separated, and also
//     present as self-referential entries so downstream `in` checks
//     don't have to special-case them.
//   - Multi-word forms ("fl oz", "half gallon") collapse spaces to
//     underscores during normalization.
//   - Unknown input returns null. Never guess.

export const UNIT_ALIASES = Object.freeze({
  // ── mass ─────────────────────────────────────────────────────
  mg: "mg", milligram: "mg", milligrams: "mg",
  g:  "g",  gram: "g", grams: "g", gm: "g", gms: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg",
  oz: "oz", ounce: "oz", ounces: "oz", ozs: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",

  // ── volume (metric) ──────────────────────────────────────────
  ml: "ml", milliliter: "ml", milliliters: "ml",
  millilitre: "ml", millilitres: "ml", mls: "ml",
  cc: "ml",              // cubic centimetres ≡ ml
  l:  "l",  liter: "l", liters: "l", litre: "l", litres: "l", ltr: "l",

  // ── volume (US) ──────────────────────────────────────────────
  tsp:  "tsp",  teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tbs:  "tbsp", tbsps: "tbsp", tbls: "tbsp",
  fl_oz: "fl_oz", floz: "fl_oz",
  fluid_ounce: "fl_oz", fluid_ounces: "fl_oz",
  cup: "cup", cups: "cup",
  pint: "pint", pints: "pint", pt: "pint", pts: "pint",
  quart: "quart", quarts: "quart", qt: "quart", qts: "quart",
  half_gallon: "half_gallon", halfgallon: "half_gallon",
  gallon: "gallon", gallons: "gallon", gal: "gallon", gals: "gallon",

  // ── count ────────────────────────────────────────────────────
  count: "count", counts: "count", ct: "count", cts: "count",
  piece: "count", pieces: "count", pc: "count", pcs: "count",
  each: "count", ea: "count", item: "count", items: "count",
});

// Some normalized units require the AMOUNT to be scaled when the
// input unit is used. `cl` is the canonical case: 1 centilitre = 10
// millilitres, and we store everything in ml internally. Callers
// that read raw scanner output should look up the original raw unit
// in this map BEFORE normalizing.
export const UNIT_AMOUNT_MULTIPLIERS = Object.freeze({
  cl: 10,
});

// Normalize a raw unit string to its canonical id. Deterministic:
//   - lowercases, trims, strips trailing period
//   - direct alias lookup
//   - tries underscore form for multi-word inputs ("fl oz" → "fl_oz")
//   - returns null for unknown inputs (NEVER guesses)
export function normalizeUnitId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!cleaned) return null;
  if (UNIT_ALIASES[cleaned]) return UNIT_ALIASES[cleaned];
  const underscored = cleaned.replace(/\s+/g, "_");
  if (UNIT_ALIASES[underscored]) return UNIT_ALIASES[underscored];
  return null;
}
