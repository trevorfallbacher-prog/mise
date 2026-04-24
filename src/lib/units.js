// Public barrel for the units subsystem. All core definitions live
// in the src/lib/units/ folder:
//
//   src/lib/units/aliases.js   — UNIT_ALIASES, normalizeUnitId, amount multipliers
//   src/lib/units/registry.js  — MASS_FACTORS_G, VOLUME_FACTORS_ML, UNIT_FAMILY,
//                                unitFamily, isKnownUnit, universalLadderFor
//   src/lib/units/convert.js   — convertStrict (structured errors), convertOrThrow
//
// This file re-exports them so existing `import ... from "./units"`
// paths keep working, and adds THIN helpers that build on the core:
//   - unitLabel         — display label resolver (ladder-aware)
//   - preferredUnitForCanonical / measuredInForCanonical — system
//                         toggle + canonical metadata bridge
//   - formatKitchenAmount — vulgar fractions + scale-friendly rounding
//   - validateCanonicalLadder / validateAllCanonicals — dev asserts
//
// NO UNIT CONSTANTS OR ALIASES ARE DEFINED IN THIS FILE. Anything
// that looks like a factor or an alias must be imported from the
// folder.

export {
  UNIT_ALIASES,
  UNIT_AMOUNT_MULTIPLIERS,
  normalizeUnitId,
} from "./units/aliases";

export {
  MASS_FACTORS_G,
  VOLUME_FACTORS_ML,
  UNIT_FAMILY,
  MASS_UNITS,
  VOLUME_UNITS,
  unitFamily,
  isKnownUnit,
  universalLadderFor,
} from "./units/registry";

export { convertStrict, convertOrThrow } from "./units/convert";

export {
  DISPLAY_CONTEXT,
  getDisplayUnitForIngredient,
  getDisplayLabelForIngredient,
  getUnitPickerOptions,
  getUserOverride,
  setUserOverride,
  clearUserOverride,
} from "./units/display";

import { normalizeUnitId } from "./units/aliases";
import {
  MASS_FACTORS_G,
  VOLUME_FACTORS_ML,
  UNIT_FAMILY,
  unitFamily,
  isKnownUnit,
} from "./units/registry";

// ─── Label resolver ─────────────────────────────────────────────
// Prefers the ingredient's ladder label (so "half_gallon" reads as
// "half gallons" on milk), falls back to a universal label table.
const UNIVERSAL_LABELS = Object.freeze({
  mg: "mg", g: "g", kg: "kg", oz: "oz", lb: "lb",
  ml: "ml", l: "l",
  tsp: "tsp", tbsp: "tbsp", fl_oz: "fl oz", cup: "cups",
  pint: "pints", quart: "quarts",
  half_gallon: "half gallons", gallon: "gallons",
  count: "ct",
});

export function unitLabel(unitId, ingredient) {
  const n = normalizeUnitId(unitId);
  if (!n) return unitId || "";
  const entry = ingredient?.units?.find(u => normalizeUnitId(u.id) === n);
  return entry?.label || UNIVERSAL_LABELS[n] || n;
}

// ─── Preferred-unit resolution (canonical-driven) ───────────────
// Each canonical may declare:
//   preferredUnit: { us: "tbsp", metric: "g" }   // what to SHOW
//   measuredIn:    { us: "oz",   metric: "g" }   // how it's SOLD
//
// This module reads those fields. It does NOT guess. If neither
// field is set and no ladder-derived fallback applies, returns null
// and the caller keeps the original amount string unchanged.

const SYSTEM_FAMILY_DEFAULTS = Object.freeze({
  us:     Object.freeze({ mass: "oz", volume: "fl_oz", count: "count" }),
  metric: Object.freeze({ mass: "g",  volume: "ml",    count: "count" }),
});

function systemKey(system) {
  return system === "metric" ? "metric" : "us";
}

// Return the unit id the user should SEE for this canonical under
// this measurement system. Precedence:
//   1. canonical.preferredUnit[system]  — author's explicit intent.
//   2. canonical.defaultUnit if its family is idiomatic for the
//      system (US keeps "stick"/"cup", metric requires g/ml/kg/l).
//   3. Universal family-default (oz for mass US, g for mass metric,
//      fl_oz for volume US, ml for volume metric, count for count).
//   4. null when the canonical has no ladder (caller keeps raw).
export function preferredUnitForCanonical(canonical, system) {
  if (!canonical) return null;
  const sys = systemKey(system);

  const hint = canonical.preferredUnit?.[sys];
  if (hint && isKnownUnit(hint)) return normalizeUnitId(hint);

  const def = canonical.defaultUnit;
  if (def) {
    const fam = unitFamily(def);
    if (sys === "us" && fam) return normalizeUnitId(def);
    if (sys === "metric" && (def === "g" || def === "ml" || def === "kg" || def === "l")) {
      return normalizeUnitId(def);
    }
  }

  const anchor = (canonical.units || []).find(u => Number(u.toBase) === 1);
  const fam = anchor ? unitFamily(anchor.id) : null;
  if (fam) return SYSTEM_FAMILY_DEFAULTS[sys][fam] || null;
  return null;
}

// Return the unit this canonical is typically SOLD in (package label
// unit) under the current system. Drives scan-row display and
// "buy 2 of these" suggestions — answers a different question from
// preferredUnitForCanonical, which drives cooking display.
export function measuredInForCanonical(canonical, system) {
  if (!canonical) return null;
  const sys = systemKey(system);
  const hint = canonical.measuredIn?.[sys];
  if (hint && isKnownUnit(hint)) return normalizeUnitId(hint);
  // Fall through to preferredUnit when measuredIn is unset — better
  // than guessing a package unit that may contradict how the user
  // thinks about the product.
  return preferredUnitForCanonical(canonical, system);
}

// ─── Kitchen-friendly formatting ───────────────────────────────
// Raw conversion output like 2.347 cup / 47.3 g is accurate but
// unfriendly during a cook. formatKitchenAmount snaps to shapes
// cooks actually measure.

const FRACTIONS = Object.freeze([
  { v: 0,     s: ""  },
  { v: 0.125, s: "⅛" },
  { v: 0.25,  s: "¼" },
  { v: 0.333, s: "⅓" },
  { v: 0.375, s: "⅜" },
  { v: 0.5,   s: "½" },
  { v: 0.625, s: "⅝" },
  { v: 0.667, s: "⅔" },
  { v: 0.75,  s: "¾" },
  { v: 0.875, s: "⅞" },
  { v: 1,     s: ""  },
]);
const FRACTION_UNITS = Object.freeze(new Set(["cup", "tbsp", "tsp", "fl_oz", "pint", "quart"]));

function snapFraction(n) {
  const whole = Math.floor(n);
  const frac = n - whole;
  let best = FRACTIONS[0];
  let bestGap = Infinity;
  for (const f of FRACTIONS) {
    const gap = Math.abs(f.v - frac);
    if (gap < bestGap) { best = f; bestGap = gap; }
  }
  if (bestGap > 0.08) return null;  // not clean, let decimal path handle it
  if (best.v === 1)   return String(whole + 1);
  if (whole === 0 && best.s === "") return "0";
  if (best.s === "")  return String(whole);
  return whole > 0 ? `${whole}${best.s}` : best.s;
}

function snapToNearest(n, step) {
  return Math.round(n / step) * step;
}

export function formatKitchenAmount(amount, unitId) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "0";
  const unit = normalizeUnitId(unitId);

  if (unit === "count") return String(Math.round(n));

  if (unit && FRACTION_UNITS.has(unit)) {
    const snapped = snapFraction(n);
    if (snapped !== null) return snapped;
  }

  if (unit === "g") {
    if (n < 10)   return String(Math.round(n * 2) / 2);
    if (n < 1000) return String(snapToNearest(n, 5));
    return String(snapToNearest(n, 10));
  }
  if (unit === "kg") return String(Math.round(n * 100) / 100);

  if (unit === "ml") {
    if (n < 10)   return String(Math.round(n * 2) / 2);
    if (n < 1000) return String(snapToNearest(n, 5));
    return String(snapToNearest(n, 10));
  }
  if (unit === "l") return String(Math.round(n * 100) / 100);

  return String(Number(n.toFixed(2)));
}

// ─── Dev-time validation ────────────────────────────────────────
// Sanity checks every canonical at app boot so an id/family
// mismatch (like the olive_oil `id:"oz" toBase:29.6` bug) fails
// LOUDLY in dev. Caller (App.jsx dev boot) logs or throws.

export function validateCanonicalLadder(canonical) {
  const out = [];
  if (!canonical || !Array.isArray(canonical.units)) return out;

  const seenIds = new Set();
  let anchor = null;

  for (const u of canonical.units) {
    const id = normalizeUnitId(u.id);
    if (!id) {
      out.push({ id: canonical.id, level: "error", message: `unit '${u.id}' not in UNIT_ALIASES` });
      continue;
    }
    if (seenIds.has(id)) {
      out.push({ id: canonical.id, level: "warn", message: `duplicate unit '${id}' in ladder` });
    }
    seenIds.add(id);

    const fam = UNIT_FAMILY[id];
    const toBase = Number(u.toBase);

    if (fam === "mass" && MASS_FACTORS_G[id]) {
      const expected = MASS_FACTORS_G[id];
      if (Math.abs(toBase - expected) / expected > 0.05) {
        out.push({
          id: canonical.id, level: "error",
          message: `mass unit '${id}' toBase=${toBase}g but universal is ${expected}g — likely family mismatch`,
        });
      }
    }

    // Guard the olive_oil bug class: `id: "oz"` with a fluid-range
    // toBase means someone typed the mass id but meant fluid ounces.
    if (fam === "mass" && id === "oz" && toBase > 28.9) {
      out.push({
        id: canonical.id, level: "error",
        message: `'oz' with toBase ${toBase} — use 'fl_oz' for fluid ounces (28.35g mass vs 29.57ml volume)`,
      });
    }

    if (toBase === 1) anchor = id;
  }

  if (!anchor) {
    out.push({
      id: canonical.id, level: "warn",
      message: "no base anchor (no unit with toBase:1) — cross-ladder conversions may fail",
    });
  }

  // Canonicals that declare a volume ladder AND a mass ladder MUST
  // expose density_g_per_ml (or the legacy registry lookup will be
  // used) — otherwise density-bridge conversions return `no-density`.
  const hasMass   = canonical.units.some(u => UNIT_FAMILY[normalizeUnitId(u.id)] === "mass");
  const hasVolume = canonical.units.some(u => UNIT_FAMILY[normalizeUnitId(u.id)] === "volume");
  if (hasMass && hasVolume) {
    const density = Number(canonical.density_g_per_ml ?? canonical.density);
    if (!Number.isFinite(density) || density <= 0) {
      out.push({
        id: canonical.id, level: "warn",
        message: "ladder spans mass+volume but no density_g_per_ml declared — cross-family conversions will require legacy density table",
      });
    }
  }

  return out;
}

export function validateAllCanonicals(ingredients) {
  const out = [];
  if (!Array.isArray(ingredients)) return out;
  for (const ing of ingredients) {
    out.push(...validateCanonicalLadder(ing));
  }
  return out;
}
