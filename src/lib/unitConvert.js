// Legacy-signature wrapper around the strict conversion core.
//
// Every function here is a thin adapter over src/lib/units/convert.js
// so downstream callers (CookComplete, UnitPicker, unitPrefs,
// nutrition, useConsumptionLogs, IAteThisSheet) keep their existing
// imports and return-shape expectations.
//
// The ONLY conversion algorithm in the codebase is convertStrict.
// Everything below either (a) prepares arguments before handing them
// to convertStrict, or (b) maps convertStrict's structured result
// into the legacy { ok, value, reason, bridged } shape.
//
// No alias maps, no unit factor tables, no density tables live in
// this file. All of those are owned by src/lib/units/.

import { toBase, CUT_WEIGHTS_G, COUNT_WEIGHTS_G, CANONICAL_ALIASES, INGREDIENT_DENSITY_G_PER_ML } from "../data/ingredients";
import {
  MASS_UNITS,
  VOLUME_UNITS,
  normalizeUnitId,
  universalLadderFor,
} from "./units";
import { convertStrict } from "./units/convert";

// Re-exports so downstream files that `import { MASS_UNITS, ... }
// from "./unitConvert"` keep resolving without having to learn the
// new folder path.
export { MASS_UNITS, VOLUME_UNITS, universalLadderFor };

// ─── Density + ladder hydration ─────────────────────────────────
// convertStrict reads density from `ingredient.density_g_per_ml`
// (or legacy `ingredient.density`). The bundled canonicals don't
// carry that field inline — density lives in the central
// INGREDIENT_DENSITY_G_PER_ML table keyed by canonical id, with a
// CANONICAL_ALIASES walk for legacy compound slugs. Before handing
// an ingredient to convertStrict, we attach the resolved density so
// the strict core's `readDensity` sees it.
function hydrateDensity(ingredient) {
  if (!ingredient) return ingredient;
  if (ingredient.density_g_per_ml != null || ingredient.density != null) {
    return ingredient;
  }
  const id = ingredient.id;
  if (INGREDIENT_DENSITY_G_PER_ML[id] != null) {
    return { ...ingredient, density_g_per_ml: Number(INGREDIENT_DENSITY_G_PER_ML[id]) };
  }
  const alias = CANONICAL_ALIASES[id];
  if (alias?.base && INGREDIENT_DENSITY_G_PER_ML[alias.base] != null) {
    return { ...ingredient, density_g_per_ml: Number(INGREDIENT_DENSITY_G_PER_ML[alias.base]) };
  }
  return ingredient;
}

// True when the ingredient has an explicit g/ml density available
// through the central table or the canonical itself. Used by the
// UnitPicker to decide whether to offer cross-family unit choices.
export function hasDensityBridge(ingredient) {
  if (!ingredient) return false;
  if (ingredient.density_g_per_ml != null || ingredient.density != null) return true;
  if (INGREDIENT_DENSITY_G_PER_ML[ingredient.id] != null) return true;
  const alias = CANONICAL_ALIASES[ingredient.id];
  if (alias?.base && INGREDIENT_DENSITY_G_PER_ML[alias.base] != null) return true;
  return false;
}

// A canonical is "mass-based" iff its ladder includes `{g:1}` or
// `{ml:1}` as its base anchor. Count-only ladders lack this. Gates
// downstream code that only makes sense on weight/volume ladders
// (scaleFactor, row-calibration overrides, etc.).
export function isMassLadder(canonical) {
  return (canonical?.units || []).some(
    u => (u.id === "g" || u.id === "ml") && Number(u.toBase) === 1,
  );
}

// ─── Effective count-weight resolver ────────────────────────────
// The precedence used to be inlined into convertWithBridge. It's
// still here as an export because nutrition.js and other callers
// ask for grams-per-count directly without running a conversion.
//
// Precedence (most-specific wins):
//   1. pantryRow.countWeightG — explicit user override.
//   2. Derived from packageAmount/packageUnit/max — 680g 4-pack ⇒ 170g each.
//   3. CUT_WEIGHTS_G[base][cut] — anatomical default for meat cuts.
//   4. COUNT_WEIGHTS_G[id] — last-resort default for count-only canonicals.
//   5. null — caller must bail.
export function effectiveCountWeightG(pantryRow, canonical) {
  if (!canonical) return null;
  const explicit = Number(pantryRow?.countWeightG);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  if (isMassLadder(canonical)) {
    const pkgAmt  = Number(pantryRow?.packageAmount);
    const pkgUnit = pantryRow?.packageUnit;
    const maxCount = Number(pantryRow?.max);
    const count = (Number.isFinite(maxCount) && maxCount > 0)
      ? maxCount
      : Number(pantryRow?.amount);
    if (Number.isFinite(pkgAmt) && pkgAmt > 0 &&
        Number.isFinite(count)  && count  > 0 &&
        pkgUnit && pkgUnit !== "count") {
      const entry = canonical.units?.find(u => normalizeUnitId(u.id) === normalizeUnitId(pkgUnit));
      if (entry) {
        const g = pkgAmt * Number(entry.toBase);
        if (Number.isFinite(g) && g > 0) return g / count;
      }
    }
  }

  const cut = pantryRow?.cut || CANONICAL_ALIASES[pantryRow?.ingredientId || ""]?.cut || null;
  if (cut) {
    const baseId = CUT_WEIGHTS_G[canonical.id]
      ? canonical.id
      : (CANONICAL_ALIASES[canonical.id]?.base || null);
    const g = baseId ? CUT_WEIGHTS_G[baseId]?.[cut] : null;
    if (Number.isFinite(g) && g > 0) return g;
  }

  const countDefault = Number(COUNT_WEIGHTS_G[canonical.id]);
  if (Number.isFinite(countDefault) && countDefault > 0) return countDefault;
  return null;
}

// ─── Conversion wrappers ────────────────────────────────────────
// All three wrap convertStrict and map its structured result into
// the legacy { ok, value, reason, bridged } shape that downstream
// files expect.

// Convert within an ingredient's ladder (and universal same-family
// fallback). NO density bridge, NO count bridge — callers that need
// those reach for convertWithBridge.
export function convert(qty, toUnit, ingredient) {
  if (!qty || !ingredient) {
    return { ok: false, reason: "missing-args", value: NaN };
  }
  const res = convertStrict(qty, toUnit, hydrateDensity(ingredient));
  if (res.ok) {
    // Only accept ladder + same-family here to preserve the old
    // contract where convert() is explicitly the "no bridge" entry
    // point. Bridged paths are strict's domain — surface to callers
    // via convertWithBridge so they opt in consciously.
    if (res.path === "ladder" || res.path === "same-family") {
      return { ok: true, value: res.value };
    }
    return { ok: false, reason: "no-bridge", value: NaN };
  }
  return mapFailure(res);
}

// Convert with the full bridge set — density + count. Accepts an
// optional pantry row for row-level calibration (gramsPerCount
// override, package-derived weights). Returns `bridged: true` when
// the result came from a density or count bridge (display "≈").
export function convertWithBridge(qty, toUnit, ingredient, row) {
  if (!qty || !ingredient || !toUnit) {
    return { ok: false, reason: "missing-args", value: NaN, bridged: false };
  }
  const fromNorm = normalizeUnitId(qty.unit);
  const toNorm   = normalizeUnitId(toUnit);
  const countInvolved = fromNorm === "count" || toNorm === "count";

  const hydrated = hydrateDensity(ingredient);

  // Resolve the most-specific grams-per-count (row override, pkg
  // derivation, cut default, canonical default). Pass to strict via
  // `options.row.countWeightG` so the count-bridge path sees it.
  const gramsPerCount = countInvolved ? effectiveCountWeightG(row, ingredient) : null;
  const strictRow = gramsPerCount != null
    ? { ...(row || {}), countWeightG: gramsPerCount }
    : row || undefined;

  // If the canonical's ladder declares its own count entry but the
  // row carries a calibrated gramsPerCount, the row MUST win. Strip
  // the ladder's count entry before handing to convertStrict so the
  // count-bridge path activates and uses `row.countWeightG`.
  const ingForStrict = (gramsPerCount != null && countInvolved && hydrated?.units)
    ? { ...hydrated, units: hydrated.units.filter(u => normalizeUnitId(u.id) !== "count") }
    : hydrated;

  const res = convertStrict(qty, toUnit, ingForStrict, { row: strictRow });
  if (!res.ok) {
    const mapped = mapFailure(res);
    return { ...mapped, bridged: false };
  }
  return {
    ok: true,
    value: res.value,
    bridged: res.path !== "ladder" && res.path !== "same-family",
  };
}

// Ingredient-agnostic conversion between two mass units or two
// volume units. No ingredient context, no density assumed — routes
// through convertStrict's same-family path only.
export function convertUniversal(qty, toUnit) {
  const res = convertStrict(qty, toUnit, null);
  if (res.ok && res.path === "same-family") {
    return { ok: true, value: res.value };
  }
  return { ok: false };
}

// ─── Pantry-row helpers ─────────────────────────────────────────

export function decrementRow(row, used, ingredient) {
  if (!row || !used || !ingredient) return null;
  const res = convertStrict(used, row.unit, hydrateDensity(ingredient), { row });
  if (!res.ok) return null;
  const next = Number(row.amount) - res.value;
  return Math.max(0, Number(next.toFixed(4)));
}

// Consume `used` across FIFO rows. Walks rows, converting `remaining`
// into each row's unit via convertStrict, deducting, converting the
// deduction back into `used.unit` to subtract from remaining. Exits
// when remaining ≤ 0 or rows exhaust.
export function planInstanceDecrement(rows, used, ingredient) {
  const out = [];
  const usedAmt = Number(used?.amount);
  if (!Array.isArray(rows) || rows.length === 0 || !used || !ingredient ||
      !Number.isFinite(usedAmt) || usedAmt <= 0) {
    return { entries: out, unsatisfied: Number.isFinite(usedAmt) ? usedAmt : 0 };
  }
  const hydrated = hydrateDensity(ingredient);
  let remaining = usedAmt;

  for (const row of rows) {
    if (remaining <= 0) break;
    const rowAmt = Number(row.amount);
    if (!Number.isFinite(rowAmt) || rowAmt <= 0) continue;

    // Convert remaining (in used.unit) into row.unit.
    const needInRow = convertStrict(
      { amount: remaining, unit: used.unit },
      row.unit,
      hydrated,
      { row },
    );
    if (!needInRow.ok) continue;

    const consumeInRow = Math.min(rowAmt, needInRow.value);
    const consumed = Number(consumeInRow.toFixed(4));
    const newAmount = Math.max(0, Number((rowAmt - consumeInRow).toFixed(4)));
    out.push({ row, newAmount, consumedAmount: consumed, unit: row.unit });

    // Back-convert the consumed amount into used.unit to decrement
    // the remaining. If the back-convert fails (shouldn't, since
    // forward succeeded in the same ladder), stop gracefully.
    const consumedInUsed = convertStrict(
      { amount: consumeInRow, unit: row.unit },
      used.unit,
      hydrated,
      { row },
    );
    if (!consumedInUsed.ok) break;
    remaining -= consumedInUsed.value;
  }

  const unsatisfied = Math.max(0, Number(remaining.toFixed(4)));
  return { entries: out, unsatisfied };
}

// ─── Display helpers ────────────────────────────────────────────

// Human-readable "2 cloves" / "½ cup" / "60 g" string for a qty +
// ingredient. Not a conversion; stays here so formatQty users don't
// have to chase a second import path.
export function formatQty(qty, ingredient) {
  if (!qty) return "";
  const entry = ingredient?.units?.find(u => normalizeUnitId(u.id) === normalizeUnitId(qty.unit));
  const label = entry?.label || qty.unit || "";
  const amt = Number(qty.amount);
  if (!Number.isFinite(amt)) return `${qty.amount} ${label}`.trim();
  const pretty = prettyFraction(amt);
  return `${pretty} ${label}`.trim();
}

function prettyFraction(n) {
  const FRACTIONS = {
    0.125: "⅛", 0.25: "¼", 0.333: "⅓", 0.5: "½",
    0.667: "⅔", 0.75: "¾", 0.875: "⅞",
  };
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 1000) / 1000;
  const match = Object.entries(FRACTIONS).find(([k]) => Math.abs(Number(k) - frac) < 0.005);
  if (match) return whole > 0 ? `${whole}${match[1]}` : match[1];
  return String(Number(n.toFixed(2)));
}

// ─── Failure mapping ────────────────────────────────────────────
// Translate convertStrict's error codes into the reason strings the
// legacy callers expect. Keeps downstream branching (`res.reason
// === "from-unit-unknown"` in UI toasts, logs) working unchanged.
function mapFailure(res) {
  const map = {
    "missing-args":      "missing-args",
    "unknown-from-unit": "from-unit-unknown",
    "unknown-to-unit":   "to-unit-unknown",
    "bad-amount":        "bad-amount",
    "no-density":        "no-density",
    "no-count-weight":   "no-bridge",
    "incompatible":      "no-bridge",
    "unresolvable":      "no-bridge",
  };
  return { ok: false, reason: map[res.reason] || res.reason || "unresolvable", value: NaN };
}

// Re-export toBase so callers that want raw ladder math stay working.
export { toBase };
