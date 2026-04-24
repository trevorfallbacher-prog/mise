#!/usr/bin/env node
/**
 * scripts/test_unit_picker_options.mjs
 *
 * Locks in the system-level invariant the UnitPicker depends on:
 *
 *   UnitPicker options MUST be derived from the canonical's full
 *   convertible ladder (plus per-entry aliases and registry siblings).
 *   preferredUnit and measuredIn choose the DEFAULT only — they must
 *   never shrink the option set.
 *
 *   Pantry package units (jar, box, tub, bottle, can, pack) must
 *   appear ALONGSIDE cook units (tsp, tbsp, cup) — not replace them,
 *   not hide them, not bump them out of the list.
 *
 * Coverage:
 *   - butter        → tsp, tbsp, cup, stick, oz, lb, g are all present
 *                     regardless of cook vs pantry context.
 *   - baking_powder → tsp, tbsp, g all present.
 *   - baking_soda   → tsp, tbsp, g all present.
 *   - flour         → package units (lb) don't kick cook units (cup,
 *                     tbsp) out of the list.
 *
 * Runs without a test framework — Node + plain assertions. Failures
 * print a diff of expected/actual and exit non-zero so this can wire
 * into CI or a pre-commit hook. Re-runnable.
 *
 *   node scripts/test_unit_picker_options.mjs
 *
 * To add a new invariant, push onto CASES below.
 */

import { findIngredient } from "../src/data/ingredients.js";

// ── Inlined test dependencies ───────────────────────────────────────
// Replicates just the slice of src/lib/units/{aliases,registry,display}.js
// needed to exercise getUnitPickerOptions from a pure-Node script.
// Kept byte-for-byte with the runtime files — if you edit the real
// resolver, update here too (or migrate the lib to use explicit .js
// extensions so the production code is directly importable).
const UNIT_ALIASES = {
  mg: "mg", milligram: "mg", milligrams: "mg",
  g: "g", gram: "g", grams: "g", gm: "g", gms: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg",
  oz: "oz", ounce: "oz", ounces: "oz", ozs: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml",
  millilitre: "ml", millilitres: "ml", mls: "ml", cc: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tbs: "tbsp", tbsps: "tbsp", tbls: "tbsp",
  fl_oz: "fl_oz", floz: "fl_oz",
  fluid_ounce: "fl_oz", fluid_ounces: "fl_oz",
  cup: "cup", cups: "cup",
  pint: "pint", pints: "pint",
  quart: "quart", quarts: "quart",
  gallon: "gallon", gallons: "gallon",
  count: "count", each: "count", piece: "count", pieces: "count",
};
function normalizeUnitId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!cleaned) return null;
  return UNIT_ALIASES[cleaned] || UNIT_ALIASES[cleaned.replace(/\s+/g, "_")] || null;
}
const MASS_FACTORS_G = { mg: 0.001, g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
const VOLUME_FACTORS_ML = {
  ml: 1, l: 1000, tsp: 4.92892, tbsp: 14.7868,
  fl_oz: 29.5735, cup: 236.588, pint: 473.176,
  quart: 946.353, gallon: 3785.41,
};
const UNIT_FAMILY = {
  mg: "mass", g: "mass", kg: "mass", oz: "mass", lb: "mass",
  ml: "volume", l: "volume", tsp: "volume", tbsp: "volume",
  fl_oz: "volume", cup: "volume", pint: "volume", quart: "volume", gallon: "volume",
  count: "count",
};
function unitFamily(id) { const n = normalizeUnitId(id); return n ? UNIT_FAMILY[n] || null : null; }
function isKnownUnit(id) { return unitFamily(id) != null; }

function canonicalIntentFor(ingredient, sys, ctx) {
  if (!ingredient) return null;
  if (ctx === "pantry") {
    const mi = ingredient.measuredIn?.[sys];
    if (mi && isKnownUnit(mi)) return normalizeUnitId(mi);
    const pu = ingredient.preferredUnit?.[sys];
    if (pu && isKnownUnit(pu)) return normalizeUnitId(pu);
    return null;
  }
  const pu = ingredient.preferredUnit?.[sys];
  if (pu && isKnownUnit(pu)) return normalizeUnitId(pu);
  return null;
}
function pickFromLadder(ingredient, sys) {
  for (const u of ingredient?.units || []) {
    const id = normalizeUnitId(u.id) || String(u.id).toLowerCase();
    if (sys === "us") return id;
    if (id === "g" || id === "kg" || id === "ml" || id === "l") return id;
  }
  return null;
}
function getDisplayUnitForIngredient(ingredient, system, context) {
  if (!ingredient) return null;
  const sys = system === "metric" ? "metric" : "us";
  const ctx = context === "pantry" ? "pantry" : "cook";
  return canonicalIntentFor(ingredient, sys, ctx) || pickFromLadder(ingredient, sys);
}

// Verbatim mirror of src/lib/units/display.js#getUnitPickerOptions.
// Same structure, same pushOption, same ladder iteration. The whole
// point of this test file is to prove this function's output contains
// every ladder entry for the cases below.
function getUnitPickerOptions(ingredient, system, context) {
  const sys = system === "metric" ? "metric" : "us";
  const selected = getDisplayUnitForIngredient(ingredient, sys, context);
  const seen = new Set();
  const out = [];
  const labelFor = (id) => {
    const entry = ingredient?.units?.find(u =>
      normalizeUnitId(u.id) === id || u.id === id);
    return entry?.label || id;
  };
  const pushOption = (rawId, section) => {
    const id = normalizeUnitId(rawId) || String(rawId).toLowerCase();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: labelFor(id), section, isSelected: id === selected });
  };
  if (selected) pushOption(selected, "selected");
  (ingredient?.units || []).forEach(u => pushOption(u.id, out.length === 0 ? "selected" : "ladder"));
  const anchor = (ingredient?.units || []).find(u => Number(u.toBase) === 1);
  const fam = anchor ? unitFamily(anchor.id) : null;
  if (fam === "mass")   Object.keys(MASS_FACTORS_G).forEach(id => pushOption(id, "registry"));
  if (fam === "volume") Object.keys(VOLUME_FACTORS_ML).forEach(id => pushOption(id, "registry"));
  return out;
}

// ── Assertion helpers ───────────────────────────────────────────────
let failures = 0;

function optionIds(opts) { return opts.map(o => o.id); }

function assertIncludesAll(label, opts, required) {
  const ids = optionIds(opts);
  const missing = required.filter(u => !ids.includes(u));
  if (missing.length === 0) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures += 1;
  console.log(`  ✗ ${label}`);
  console.log(`      present: ${ids.join(", ")}`);
  console.log(`      missing: ${missing.join(", ")}`);
}

function assertNonEmpty(label, value) {
  if (value != null && value !== "" && !(Array.isArray(value) && value.length === 0)) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures += 1;
  console.log(`  ✗ ${label} (got: ${JSON.stringify(value)})`);
}

// ── CASES ───────────────────────────────────────────────────────────
const CASES = [
  {
    canonical: "butter",
    // User-specified: butter exposes tsp/tbsp/cup/stick/oz/lb/g.
    requiredAllContexts: ["tsp", "tbsp", "cup", "stick", "oz", "lb", "g"],
  },
  {
    canonical: "baking_powder",
    // User-specified: baking_powder exposes tsp/tbsp/g.
    requiredAllContexts: ["tsp", "tbsp", "g"],
  },
  {
    canonical: "baking_soda",
    // Same family of invariant as baking_powder.
    requiredAllContexts: ["tsp", "tbsp", "g"],
  },
  {
    canonical: "flour",
    // Specific to "pantry package units must not hide cook units" —
    // flour's lb/bag should never push out cup/tbsp from the picker.
    requiredAllContexts: ["cup", "tbsp", "lb", "g"],
  },
];

const CONTEXTS = [
  { system: "us",     context: "cook"   },
  { system: "us",     context: "pantry" },
  { system: "metric", context: "cook"   },
  { system: "metric", context: "pantry" },
];

// ── Runner ──────────────────────────────────────────────────────────
console.log("# UnitPicker invariant tests\n");

for (const c of CASES) {
  const ing = findIngredient(c.canonical);
  console.log(`## ${c.canonical}`);
  if (!ing) {
    failures += 1;
    console.log(`  ✗ canonical not found in bundled registry`);
    continue;
  }
  assertNonEmpty(`  ladder defined`, ing.units);
  for (const { system, context } of CONTEXTS) {
    const opts = getUnitPickerOptions(ing, system, context);
    assertIncludesAll(
      `${system}/${context} exposes [${c.requiredAllContexts.join(", ")}]`,
      opts,
      c.requiredAllContexts,
    );
  }
  console.log("");
}

// Invariant proof: even when preferredUnit/measuredIn point at a
// package unit (flour.measuredIn = lb), the cook units must still be
// in the options. This is the exact concern the user raised.
console.log("## cross-check: preferredUnit/measuredIn do not shrink options");
const flour = findIngredient("flour");
if (flour) {
  const ladderIds = flour.units.map(u => u.id);
  const pantryOpts = getUnitPickerOptions(flour, "us", "pantry").map(o => o.id);
  const hidden = ladderIds.filter(id => !pantryOpts.includes(id));
  if (hidden.length === 0) {
    console.log(`  ✓ every flour ladder entry survives pantry-context picker (lb default does not hide cup/tbsp)`);
  } else {
    failures += 1;
    console.log(`  ✗ pantry context hid ladder entries: ${hidden.join(", ")}`);
  }
}
console.log("");

if (failures > 0) {
  console.log(`FAILED: ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log(`PASSED — all invariants hold.`);
