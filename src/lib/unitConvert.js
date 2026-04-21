// Unit conversion for the cook-complete pantry-reconcile flow.
//
// Every ingredient in src/data/ingredients.js declares its own `units[]`
// ladder with a `toBase` factor. Within a single ingredient's ladder,
// conversion between any two units is just:
//
//   baseAmount = amount * fromUnit.toBase
//   outAmount  = baseAmount / toUnit.toBase
//
// That's the whole converter. The tricky "mass vs volume vs count"
// question handles itself — each ingredient picks ONE family and
// declares its ladder entirely in that family. Tortillas are count-only
// (1 ct = 1, 1 pack = 10), butter is mass+volume but all toBase into
// grams (a tbsp entry just uses 14.2g as its factor), milk is volume
// only. So cross-family collisions can't happen within one ladder.
//
// What CAN happen: a unit that isn't in this ingredient's ladder
// (recipe says "2 cloves garlic" but the pantry row is in "head" —
// both ARE in the garlic ladder so we're fine; but if a recipe
// somehow said "2 g tortillas" we'd fail fast, which is right).
//
// Everything here is pure — no DB, no React. Call it from the cook-
// complete flow to resolve "used 2 tbsp butter" → "decrement the
// pantry's 1.5-stick row by 28.4 g → 1.25 sticks remaining".

import { toBase, CUT_WEIGHTS_G, CANONICAL_ALIASES, INGREDIENT_DENSITY_G_PER_ML } from "../data/ingredients";

// Universal mass / volume conversion factors. These are PHYSICS, not
// ingredient-specific — 1 lb is always 453.6 g whether we're weighing
// flour or ribeye. Each canonical used to re-declare these same
// numbers in its units[] array, which (a) duplicated data and (b)
// created bugs when a canonical forgot to include a unit (heavy_cream
// without gallon, garlic without oz, etc.). convertWithBridge now
// falls back to these tables when the canonical's ladder can't resolve
// a unit directly — same-family mass↔mass or volume↔volume conversions
// "just work" regardless of what's declared on the canonical.
//
// Each value is toBase where the base is GRAMS (for mass) or
// MILLILITRES (for volume). Volumes are water-based — for other
// liquids (oil, honey) the density factor per canonical could refine
// this; deferred until a user reports drift.
const UNIVERSAL_MASS_G = {
  mg: 0.001, g: 1, kg: 1000,
  oz: 28.35, lb: 453.6,
};
const UNIVERSAL_VOLUME_ML = {
  ml: 1, l: 1000,
  tsp: 5, tbsp: 15, cup: 240,
  fl_oz: 29.57, pint: 473, quart: 946,
  half_gallon: 1893, gallon: 3785,
};
const MASS_UNITS   = new Set(Object.keys(UNIVERSAL_MASS_G));
const VOLUME_UNITS = new Set(Object.keys(UNIVERSAL_VOLUME_ML));

// True when the two units span mass AND volume (i.e. one is mass,
// the other is volume). This is the density-bridge case — different
// families, same ingredient, needs g/ml to cross.
function sameMassVolumeFamilies(a, b) {
  if (!a || !b) return false;
  return (MASS_UNITS.has(a) && VOLUME_UNITS.has(b)) ||
         (VOLUME_UNITS.has(a) && MASS_UNITS.has(b));
}

// Look up the ingredient's density (g/ml) from the central
// INGREDIENT_DENSITY_G_PER_ML table, walking CANONICAL_ALIASES so a
// legacy compound slug (ground_beef → beef) still finds the right
// value. Defaults to 1.0 (water-equivalent) for ingredients without
// an explicit entry — works for most water-adjacent liquids (broth,
// stock, juice, most dairy) within ~10%. Dense syrups and flours
// need explicit entries or they'd drift.
function resolveDensity(ingredient) {
  if (!ingredient) return 0;
  const id = ingredient.id;
  if (INGREDIENT_DENSITY_G_PER_ML[id] != null) {
    return Number(INGREDIENT_DENSITY_G_PER_ML[id]) || 0;
  }
  const alias = CANONICAL_ALIASES[id];
  if (alias?.base && INGREDIENT_DENSITY_G_PER_ML[alias.base] != null) {
    return Number(INGREDIENT_DENSITY_G_PER_ML[alias.base]) || 0;
  }
  return 1.0;
}

// True when both units are in the same universal family (both mass or
// both volume). Count is neither — count↔mass bridging still needs
// effectiveCountWeightG.
function sameUniversalFamily(a, b) {
  const na = normalizeUnitId(a);
  const nb = normalizeUnitId(b);
  if (!na || !nb) return false;
  if (MASS_UNITS.has(na)   && MASS_UNITS.has(nb))   return true;
  if (VOLUME_UNITS.has(na) && VOLUME_UNITS.has(nb)) return true;
  return false;
}

// Universal conversion between two mass units or two volume units,
// ingredient-agnostic. Returns { ok, value } or { ok: false }.
function convertUniversal(qty, toUnit) {
  const from = normalizeUnitId(qty.unit);
  const to   = normalizeUnitId(toUnit);
  if (!from || !to) return { ok: false };
  if (MASS_UNITS.has(from) && MASS_UNITS.has(to)) {
    const g = Number(qty.amount) * UNIVERSAL_MASS_G[from];
    if (!Number.isFinite(g)) return { ok: false };
    return { ok: true, value: g / UNIVERSAL_MASS_G[to] };
  }
  if (VOLUME_UNITS.has(from) && VOLUME_UNITS.has(to)) {
    const ml = Number(qty.amount) * UNIVERSAL_VOLUME_ML[from];
    if (!Number.isFinite(ml)) return { ok: false };
    return { ok: true, value: ml / UNIVERSAL_VOLUME_ML[to] };
  }
  return { ok: false };
}

// A canonical is "mass-based" iff its ladder includes `{g:1}` or
// `{ml:1}` as its gram/volume anchor — i.e. every other unit in the
// ladder declares how many grams (or millilitres, treated as grams
// for conversion purposes) it equals. Count-based canonicals (eggs,
// apple) intentionally lack this anchor; callers can gate cross-
// family bridges on this signal so pure-count ladders don't get a
// countWeightG override applied where it'd poison the math.
//
// Why accept `ml:1`: liquid canonicals (milk, oil, maple syrup) use
// a millilitre base. For mass-conversion purposes we approximate
// 1 ml ≈ 1 g — exact for water-based liquids, within ~10% for oils.
export function isMassLadder(canonical) {
  return (canonical?.units || []).some(
    u => (u.id === "g" || u.id === "ml") && Number(u.toBase) === 1,
  );
}

// Resolve the effective grams-per-count for a pantry row against its
// canonical. Precedence (most-specific wins):
//   1. pantryRow.countWeightG (explicit user override from the
//      ItemCard "each ~__g" field; migration 0121).
//   2. Derived from packageAmount + packageUnit + max — a 680g four-
//      pack derives to 170g each. Needs package-level mass metadata.
//   3. Cut-specific default from CUT_WEIGHTS_G[base][cut] — "chicken
//      with cut=breast → 200g per count." Pulls from the registry's
//      anatomical weight table so every meat pantry row with a cut
//      axis set knows how much one count weighs without the user
//      hand-entering it.
//   4. null — caller falls back to the canonical's own count.toBase
//      (which for chicken / beef / pork / turkey now carries a
//      reasonable default, so most downstream paths still work).
//
// Only returns a positive finite number or null.
export function effectiveCountWeightG(pantryRow, canonical) {
  if (!canonical) return null;
  // 1. explicit row-level override
  const explicit = Number(pantryRow?.countWeightG);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  // 2. derived from package metadata. Only meaningful on mass ladders:
  // a mass-ladder canonical has every unit's toBase in grams, so
  // pkgAmt × entry.toBase = grams. On a count-only ladder (tortillas,
  // bread_slice) pack.toBase=10 is counts, not grams, and the math
  // would return garbage. Bail; path #3 (cut weights) and explicit
  // overrides still apply.
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
      const entry = canonical.units?.find(u => u.id === pkgUnit);
      if (entry) {
        const g = pkgAmt * Number(entry.toBase);
        if (Number.isFinite(g) && g > 0) return g / count;
      }
    }
  }

  // 3. cut-specific default from the registry. Walks aliases so a
  // legacy compound slug like chicken_breast (alias → chicken +
  // cut=breast) still finds the right weight when the pantry row
  // was written under the old model and cut isn't yet populated.
  const cut = pantryRow?.cut || CANONICAL_ALIASES[pantryRow?.ingredientId || ""]?.cut || null;
  if (cut) {
    const baseId = CUT_WEIGHTS_G[canonical.id]
      ? canonical.id
      : (CANONICAL_ALIASES[canonical.id]?.base || null);
    const g = baseId ? CUT_WEIGHTS_G[baseId]?.[cut] : null;
    if (Number.isFinite(g) && g > 0) return g;
  }
  return null;
}

// Convert { amount, unit } into a target unit within the same ingredient's
// ladder. Returns { ok, value } or { ok: false, reason }.
//
//   convert({ amount: 2, unit: "tbsp" }, "stick", butterIngredient)
//     → { ok: true, value: 0.25 }   // 2 tbsp = 0.25 sticks of butter
//
// Callers that want a soft fallback (display the raw unit when
// conversion fails) should check `ok` before using `value`.
// Case-insensitive lookup + common alias map. Pantry data in the
// wild carries "Lbs", "Oz", "Count" (mixed case from various
// scanner paths), "lbs" / "lb" interchangeably, etc. Without this,
// strict === lookups on canonical.units lose rows whose capitalization
// doesn't match the registry's lowercase id. Real-world reports:
// "can't convert pantry Oz → clove" when the ladder has "oz".
const UNIT_ALIASES = {
  lbs: "lb", pound: "lb", pounds: "lb",
  ounce: "oz", ounces: "oz",
  gram: "g", grams: "g",
  kilogram: "kg", kilograms: "kg",
  milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  liter: "l", liters: "l", litre: "l", litres: "l",
  teaspoon: "tsp", teaspoons: "tsp",
  tablespoon: "tbsp", tablespoons: "tbsp",
  cups: "cup",
  clove: "clove", cloves: "clove",
  count: "count", counts: "count", ct: "count",
  piece: "count", pieces: "count", pcs: "count",
};
function normalizeUnitId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const lowered = raw.trim().toLowerCase();
  return UNIT_ALIASES[lowered] || lowered;
}
function findUnit(ingredient, unitId) {
  const want = normalizeUnitId(unitId);
  if (!want) return null;
  return ingredient?.units?.find(u => normalizeUnitId(u.id) === want) || null;
}

export function convert(qty, toUnit, ingredient) {
  if (!qty || !ingredient) {
    return { ok: false, reason: "missing-args", value: NaN };
  }
  const fromEntry = findUnit(ingredient, qty.unit);
  const toEntry   = findUnit(ingredient, toUnit);
  if (fromEntry && toEntry) {
    const base = Number(qty.amount) * fromEntry.toBase;
    if (!Number.isFinite(base)) return { ok: false, reason: "bad-amount", value: NaN };
    return { ok: true, value: base / toEntry.toBase };
  }
  // Universal fallback for mass↔mass and volume↔volume. Works when
  // the canonical's ladder is missing one (or both) of the units
  // but both live in the same physical family. Bug that drove this:
  // heavy_cream ladder used to lack gallon, so 0.5 gal → cup
  // failed silently ("can't convert pantry gallon → cup"). Now any
  // canonical, even one with a partial ladder, resolves mass↔mass
  // and volume↔volume through the universal tables.
  if (sameUniversalFamily(qty.unit, toUnit)) {
    const univ = convertUniversal(qty, toUnit);
    if (univ.ok) return { ok: true, value: univ.value };
  }
  if (!fromEntry) return { ok: false, reason: "from-unit-unknown", value: NaN };
  return { ok: false, reason: "to-unit-unknown", value: NaN };
}

// Convert { amount, unit } into a target unit, with an automatic
// cross-family bridge when the same-ladder path can't reach it.
//
// Two-stage:
//   1. convert() — same-ladder, exact, fast. Works for any pair of
//      units that both live in the ingredient's units[] array.
//   2. Bridge via effectiveCountWeightG — kicks in when exactly one
//      side is "count" and the other is a mass-family unit NOT on
//      the ladder (or when the ladder's count entry has a placeholder
//      toBase of 1). Uses the pantry row's grams-per-count (explicit
//      or derived from packageAmount/packageUnit/max) to bridge
//      count ↔ grams, then grams ↔ target.
//
// Returns { ok, value, bridged, reason }. `bridged: true` tells the
// caller the conversion used the cross-family path, which is useful
// for display hints ("≈") since bridged values are approximations
// (they depend on a per-row or canonical average weight).
//
// This is the helper to reach for anywhere recipe-unit meets pantry-
// unit and the two might not be in the same ladder family. Covers:
//   - recipe "3 chicken breasts" ↔ pantry "1.5 lb" (same ladder: count
//     has toBase=200g on chicken_breast; 3×200 / 453.6 = 1.32 lb)
//   - recipe "8 tortillas" ↔ pantry "16 oz pack" (bridged: tortillas
//     ladder has no oz, but pantry row carries packageAmount=16 oz
//     + max=8 → effectiveCountWeightG derives 56.7g/tortilla → 8×56.7
//     / 28.35 = 16 oz)
//   - recipe "2 oz chicken" ↔ pantry "8 count chicken breasts" (same
//     ladder, reverse direction, 2oz × 28.35 / 200 = 0.28 breasts —
//     user sees "you used ~1/3 of a breast")
export function convertWithBridge(qty, toUnit, ingredient, row) {
  if (!qty || !ingredient || !toUnit) {
    return { ok: false, reason: "missing-args", value: NaN, bridged: false };
  }
  // Normalize on entry so "Count" / "COUNT" / "count" all read as
  // count, and aliases like "lbs"/"lb" both resolve. Everything
  // downstream sees canonical lowercase ids.
  const normFromUnit = normalizeUnitId(qty.unit);
  const normToUnit   = normalizeUnitId(toUnit);
  const fromIsCount = normFromUnit === "count";
  const toIsCount   = normToUnit === "count";
  const countInvolved = fromIsCount || toIsCount;

  // Resolve grams-per-count ONCE. Used in two places below: same-
  // ladder count↔mass (override the canonical's baked-in count.toBase
  // when the pantry row knows better) AND pure bridge (units outside
  // the ladder). "Package size is bible" — if the user calibrated
  // this row to 170g breasts, 170 wins over the canonical's 200g
  // default everywhere a count appears.
  const gramsPerCount = countInvolved ? effectiveCountWeightG(row, ingredient) : null;
  const canOverride = countInvolved && gramsPerCount && isMassLadder(ingredient);

  // Same-ladder first. Most canonicals encode count-to-mass via
  // count.toBase (chicken_breast count.toBase=200g). When the row
  // carries a better gramsPerCount, we substitute it for the count
  // side of the conversion so row-level calibration takes precedence.
  if (!canOverride) {
    const direct = convert(qty, toUnit, ingredient);
    if (direct.ok) return { ...direct, bridged: false };
  } else {
    // Same-ladder path with the count override applied. Pre-compute
    // grams manually using gramsPerCount for the count side and the
    // canonical's toBase for the mass side, then divide.
    const fromEntry = fromIsCount ? null : findUnit(ingredient, qty.unit);
    const toEntry   = toIsCount   ? null : findUnit(ingredient, toUnit);
    if ((fromIsCount || fromEntry) && (toIsCount || toEntry)) {
      const grams = fromIsCount
        ? Number(qty.amount) * gramsPerCount
        : Number(qty.amount) * Number(fromEntry.toBase);
      if (Number.isFinite(grams)) {
        const value = toIsCount
          ? grams / gramsPerCount
          : grams / Number(toEntry.toBase);
        if (Number.isFinite(value)) {
          // bridged:true flags this as row-calibrated — the display
          // uses "≈" because per-row grams-per-count is a calibration
          // choice, not a universal constant.
          return { ok: true, value, bridged: true };
        }
      }
    }
  }

  // Mass ↔ Volume bridge via ingredient density. 2 tbsp olive oil
  // (volume) needs to convert to oz (mass) and vice-versa — the
  // universal ladder can't do this because mass and volume are
  // different physical families. INGREDIENT_DENSITY_G_PER_ML holds
  // gram-per-ml values for common cooking ingredients (oils, flours,
  // honey, salts, etc.); unknown ingredients default to 1.0 (water-
  // equivalent), which is fine for most dairy / broth / juice calls.
  if (!countInvolved && sameMassVolumeFamilies(normFromUnit, normToUnit)) {
    const density = resolveDensity(ingredient);
    if (density > 0) {
      const ml = normFromUnit in UNIVERSAL_VOLUME_ML
        ? Number(qty.amount) * UNIVERSAL_VOLUME_ML[normFromUnit]
        : (Number(qty.amount) * UNIVERSAL_MASS_G[normFromUnit]) / density;
      if (Number.isFinite(ml)) {
        const value = normToUnit in UNIVERSAL_VOLUME_ML
          ? ml / UNIVERSAL_VOLUME_ML[normToUnit]
          : (ml * density) / UNIVERSAL_MASS_G[normToUnit];
        if (Number.isFinite(value)) {
          return { ok: true, value, bridged: true };
        }
      }
    }
  }

  // Pure bridge: count ↔ mass where one side is NOT in the ladder.
  // Common case: tortillas canonical has only count+pack in its
  // ladder (no oz), but the pantry row carries packageAmount=16oz.
  // gramsPerCount from effectiveCountWeightG gives us the bridge.
  if (!gramsPerCount) {
    return { ok: false, reason: "no-bridge", value: NaN, bridged: false };
  }
  if (fromIsCount === toIsCount) {
    return { ok: false, reason: "no-bridge", value: NaN, bridged: false };
  }
  const fromEntry = fromIsCount ? null : findUnit(ingredient, qty.unit);
  const toEntry   = toIsCount   ? null : findUnit(ingredient, toUnit);
  if (!fromIsCount && !fromEntry) return { ok: false, reason: "from-unit-unknown", value: NaN, bridged: false };
  if (!toIsCount   && !toEntry)   return { ok: false, reason: "to-unit-unknown",   value: NaN, bridged: false };

  const grams = fromIsCount
    ? Number(qty.amount) * gramsPerCount
    : Number(qty.amount) * Number(fromEntry.toBase);
  if (!Number.isFinite(grams)) {
    return { ok: false, reason: "bad-amount", value: NaN, bridged: false };
  }
  const value = toIsCount
    ? grams / gramsPerCount
    : grams / Number(toEntry.toBase);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: "bad-amount", value: NaN, bridged: false };
  }
  return { ok: true, value, bridged: true };
}

// Subtract a "used" quantity from a pantry row, both keyed to the same
// ingredient. Returns the new row amount in the row's own unit, or null
// if the conversion isn't possible (caller should show a warning and
// fall back to the user picking a number manually).
//
//   decrementRow(
//     { amount: 1.5, unit: "stick" },    // the pantry row
//     { amount: 2,   unit: "tbsp"  },    // the amount the recipe used
//     butterIngredient,
//   ) → 1.25   // 1.5 sticks − 2 tbsp = 1.25 sticks
//
// Clamps at zero so we don't end up with negative inventory if the
// user overshoots.
export function decrementRow(row, used, ingredient) {
  if (!row || !used || !ingredient) return null;
  const converted = convert(used, row.unit, ingredient);
  if (!converted.ok) return null;
  const next = Number(row.amount) - converted.value;
  return Math.max(0, Number(next.toFixed(4)));
}

// Consume `used` across an array of pantry rows (an identity stack — N
// sibling instances sharing canonical + state + composition). Rows are
// drawn FIFO in the order supplied by the caller (CookComplete sorts
// earliest expires first so the next-to-spoil instance is always
// cracked before a fresher sibling). Returns one entry per row
// touched:
//
//   [{ row, newAmount, consumedAmount, unit, unsatisfied }]
//
// * newAmount is in row.unit. 0 = delete the row.
// * consumedAmount is also in row.unit — what the caller would tell
//   the user ("2 cans drawn from Apr 20 batch").
// * unsatisfied is the remainder in `used.unit` when the rows ran out
//   before fully satisfying demand. 0 when everything was consumed.
//
// Keeps `decrementRow` as the single-row primitive; this is the
// multi-row orchestrator built on top of `convert`.
export function planInstanceDecrement(rows, used, ingredient) {
  const out = [];
  if (!Array.isArray(rows) || rows.length === 0 || !used || !ingredient) {
    return { entries: out, unsatisfied: Number(used?.amount) || 0 };
  }
  let remainingBase = Number(used.amount) * (findUnit(ingredient, used.unit)?.toBase ?? NaN);
  if (!Number.isFinite(remainingBase)) {
    // Unit isn't in the ingredient's ladder — caller should fall back
    // to a single-row un-convertible entry, same as decrementRow's
    // null return.
    return { entries: out, unsatisfied: Number(used.amount) };
  }
  for (const row of rows) {
    if (remainingBase <= 0) break;
    const rowFactor = findUnit(ingredient, row.unit)?.toBase;
    if (!rowFactor) continue;
    const rowBase = Number(row.amount) * rowFactor;
    if (!Number.isFinite(rowBase) || rowBase <= 0) continue;
    const consumeBase = Math.min(rowBase, remainingBase);
    const consumedInUnit = Number((consumeBase / rowFactor).toFixed(4));
    const newAmount = Math.max(0, Number(((rowBase - consumeBase) / rowFactor).toFixed(4)));
    out.push({
      row,
      newAmount,
      consumedAmount: consumedInUnit,
      unit: row.unit,
    });
    remainingBase -= consumeBase;
  }
  const unsatisfiedBase = Math.max(0, remainingBase);
  const usedFactor = findUnit(ingredient, used.unit)?.toBase ?? 1;
  const unsatisfied = Number((unsatisfiedBase / usedFactor).toFixed(4));
  return { entries: out, unsatisfied };
}

// Human-readable "2 cloves" / "½ cup" / "60 g" string for a qty + ingredient.
// Falls back gracefully if the unit isn't in the ingredient's ladder.
// Used by the confirm-removal summary and the leftover-row display.
export function formatQty(qty, ingredient) {
  if (!qty) return "";
  const entry = ingredient?.units?.find(u => u.id === qty.unit);
  const label = entry?.label || qty.unit || "";
  const amt = Number(qty.amount);
  if (!Number.isFinite(amt)) return `${qty.amount} ${label}`.trim();
  // Render small fractions as nice glyphs for the common kitchen amounts.
  const pretty = prettyFraction(amt);
  return `${pretty} ${label}`.trim();
}

// "0.25" → "¼", "1.5" → "1½", "2" → "2". Falls back to the raw number
// with up to two decimal places when we don't have a glyph.
function prettyFraction(n) {
  const FRACTIONS = {
    0.125: "⅛", 0.25: "¼", 0.333: "⅓", 0.5: "½",
    0.667: "⅔", 0.75: "¾", 0.875: "⅞",
  };
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 1000) / 1000;
  const match = Object.entries(FRACTIONS).find(([k]) => Math.abs(Number(k) - frac) < 0.005);
  if (match) return whole > 0 ? `${whole}${match[1]}` : match[1];
  // Two decimal places max, strip trailing zeros.
  return String(Number(n.toFixed(2)));
}

// Re-export toBase for callers that want to do their own math against
// the canonical base amount (useful for ranking multi-match pantry rows
// by "closest yield to what the recipe needs").
export { toBase };
