// Nutrition resolver + rollup.
//
// Single source of truth for "what are the macros of this thing?" —
// used by ItemCard, recipe previews, and the MealDetail totals card.
// Keep every render path flowing through `resolveNutrition` / `
// recipeNutrition` so the data-source hierarchy stays consistent and
// we don't accidentally double-count between UI surfaces.
//
// Source hierarchy (highest signal first; Phase 1 ships tiers 3+4+5,
// tiers 1+2 plug in during Phase 2/4):
//
//   1. pantryRow.nutritionOverride           — user typed this jar's label.
//   2. brand_nutrition[(canonicalId, brand)] — OFF / user-contributed.
//   3. ingredient_info[canonicalId].nutrition — generic canonical.
//   4. ingredients.js canonical.nutrition     — in-code fallback.
//   5. null → UI renders "tap to add".
//
// `per` schemes the registry uses:
//   "100g"    → base unit in canonical's ladder is grams; divide by 100.
//   "count"   → each item carries the nutrition (eggs, apples).
//   "serving" → use nutrition.serving_g to scale grams.

import { findIngredient } from "../data/ingredients";

// Resolve the best available nutrition for a pantry row. Phase 1 only
// uses tiers 3 + 4 (canonical); the optional `brandNutrition` map hooks
// in during Phase 2 and `pantryRow.nutritionOverride` during Phase 4.
// Caller passes `getInfo` from useIngredientInfo() to avoid re-reading
// the context inside every list render.
export function resolveNutrition(pantryRow, { brandNutrition, getInfo } = {}) {
  if (!pantryRow) return { nutrition: null, source: null };
  // 1. Pantry-row override (Phase 4).
  if (pantryRow.nutritionOverride && hasNumbers(pantryRow.nutritionOverride)) {
    return { nutrition: pantryRow.nutritionOverride, source: "pantry" };
  }
  const canonId = pantryRow.ingredientId || pantryRow.canonicalId || null;
  // 2. brand_nutrition row (Phase 2). Key format mirrors useBrandNutrition.
  if (canonId && pantryRow.brand && brandNutrition) {
    const brandKey = String(pantryRow.brand).trim().toLowerCase();
    const hit = brandNutrition.get?.(`${canonId}::${brandKey}`);
    if (hit?.nutrition && hasNumbers(hit.nutrition)) {
      return { nutrition: hit.nutrition, source: "brand", brand: hit.displayBrand || pantryRow.brand };
    }
  }
  // 3. ingredient_info.nutrition — the admin-approved canonical average.
  if (canonId && typeof getInfo === "function") {
    const info = getInfo(canonId);
    if (info?.nutrition && hasNumbers(info.nutrition)) {
      return { nutrition: info.nutrition, source: "canonical" };
    }
  }
  // 4. In-code registry fallback — fires when ingredient_info hasn't
  //    been seeded for this canonical yet.
  if (canonId) {
    const canon = findIngredient(canonId);
    if (canon?.nutrition && hasNumbers(canon.nutrition)) {
      return { nutrition: canon.nutrition, source: "default" };
    }
  }
  return { nutrition: null, source: null };
}

function hasNumbers(n) {
  if (!n || typeof n !== "object") return false;
  // At least one macro has to be a real number; otherwise there's
  // nothing to render and the UI should treat it as missing.
  return ["kcal", "protein_g", "fat_g", "carb_g"].some(k => typeof n[k] === "number");
}

// Scale factor for applying a nutrition block to a quantity. Returns
// null when the conversion isn't possible (unknown unit, missing
// serving_g on a per-serving nutrition, etc.) — callers should
// treat that as a coverage gap rather than a zero.
export function scaleFactor(qty, canonical, nutrition) {
  if (!qty || !canonical || !nutrition?.per) return null;
  const fromEntry = canonical.units?.find(u => u.id === qty.unit);
  if (!fromEntry) return null;
  const baseAmount = Number(qty.amount) * Number(fromEntry.toBase);
  if (!Number.isFinite(baseAmount)) return null;
  switch (nutrition.per) {
    case "100g":
      // Mass ladders have toBase in grams. A canonical with a "count"
      // default but nutrition.per === "100g" (seeded that way) would
      // resolve correctly only when the row's unit is a mass unit —
      // we bail when it isn't, which is the right answer.
      if (!isMassLadder(canonical)) return null;
      return baseAmount / 100;
    case "count":
      // Count ladders: toBase=1 per item. baseAmount is the count.
      return baseAmount;
    case "serving":
      if (!Number.isFinite(Number(nutrition.serving_g))) return null;
      if (!isMassLadder(canonical)) return null;
      return baseAmount / Number(nutrition.serving_g);
    default:
      return null;
  }
}

// Heuristic: if the canonical's ladder includes any unit id in
// MASS_UNIT_IDS, we treat it as mass-based. Otherwise it's count.
// Hand-curated set; expand if the registry gains new mass units.
const MASS_UNIT_IDS = new Set(["g", "kg", "oz", "lb", "lbs", "stick", "cup", "tbsp", "tsp", "ml", "l"]);
function isMassLadder(canonical) {
  return (canonical?.units || []).some(u => MASS_UNIT_IDS.has(u.id));
}

// Parse a free-text amount string into { amount, unit } against a
// canonical's ladder. Handles unicode fractions ("½ cup"), mixed
// fractions ("1½ tbsp"), and common English unit aliases. Returns
// null for anything we can't confidently parse — the coverage ratio
// surfaces that honestly instead of guessing.
const UNICODE_FRACTIONS = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 1/3, "⅔": 2/3,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};
const UNIT_ALIASES = {
  tablespoon: "tbsp", tablespoons: "tbsp", tbsps: "tbsp",
  teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp",
  cups: "cup",
  ounce: "oz", ounces: "oz",
  pound: "lb", pounds: "lb", lbs: "lb",
  gram: "g", grams: "g",
  kilogram: "kg", kilograms: "kg",
  milliliter: "ml", milliliters: "ml",
  liter: "l", liters: "l",
  // Size words that mean "1 count" — "1 large onion", "2 small eggs"
  large: "count", small: "count", medium: "count", xl: "count",
  // Countable plant parts — both forms.
  clove: "count", cloves: "count",
  sprig: "count", sprigs: "count",
  stalk: "count", stalks: "count",
  head:  "count", heads: "count",
  count: "count", counts: "count", ct: "count",
  whole: "count",
};
export function parseAmountString(str, canonical) {
  if (!str || !canonical) return null;
  if (typeof str !== "string") return null;
  const trimmed = str.trim().toLowerCase();
  // Pull off any leading numeric — decimal, integer, unicode fraction,
  // or an integer immediately followed by a unicode fraction ("1½").
  const m = trimmed.match(/^(\d+(?:\.\d+)?)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])?\s*(.*)$/);
  if (!m) return null;
  const intPart  = m[1] ? Number(m[1]) : 0;
  const fracPart = m[2] ? UNICODE_FRACTIONS[m[2]] : 0;
  const amount = intPart + fracPart;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const rest = (m[3] || "").trim();
  // Peel the first whitespace-delimited token as a candidate unit.
  // The tail is free-text ("cloves, minced" → unit = "cloves").
  const unitToken = (rest.split(/[\s,.;:]/)[0] || "").replace(/[^a-z]/g, "");
  const unitId = UNIT_ALIASES[unitToken] || unitToken || (canonical.defaultUnit || null);
  if (!unitId) return null;
  const hasUnit = canonical.units?.some(u => u.id === unitId);
  if (!hasUnit) return null;
  return { amount, unit: unitId };
}

// Compute nutrition for one recipe. Sums macros across every
// ingredient that we can both (a) resolve to a canonical with
// nutrition AND (b) convert its amount into the canonical's per-unit
// base. Everything else counts as a coverage gap.
//
// Returns:
//   total        — sum across the whole recipe
//   perServing   — total / recipe.serves (floor 1)
//   coverage     — { resolved, total } so the UI can disclose gaps
//                  honestly ("based on 7 of 9 ingredients")
export function recipeNutrition(recipe, { pantry = [], brandNutrition, getInfo } = {}) {
  const totals = { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sodium_mg: 0, sugar_g: 0 };
  let resolved = 0;
  const ingredients = recipe?.ingredients || [];
  for (const ing of ingredients) {
    const canonicalId = ing.ingredientId;
    if (!canonicalId) continue;
    const canon = findIngredient(canonicalId);
    if (!canon) continue;
    // Prefer a matching pantry row so brand + override apply. Fall
    // back to a canonical-only shell when the user hasn't stocked it
    // (recipes can reference ingredients the pantry doesn't carry).
    const pantryRow = pantry.find(p => (p.ingredientId || p.canonicalId) === canonicalId)
      || { ingredientId: canonicalId, brand: null, nutritionOverride: null };
    const { nutrition } = resolveNutrition(pantryRow, { brandNutrition, getInfo });
    if (!nutrition) continue;
    // Prefer structured qty when Claude / the registry stamped it;
    // otherwise parse the free-text amount. Recipe rows shaped like
    // `{ amount: "2 tbsp", qty: { amount: 2, unit: "tbsp" } }` are
    // common for bundled recipes; AI drafts typically only set
    // `amount`.
    const qty = ing.qty || parseAmountString(ing.amount, canon);
    if (!qty) continue;
    const factor = scaleFactor(qty, canon, nutrition);
    if (factor == null) continue;
    for (const key of Object.keys(totals)) {
      if (typeof nutrition[key] === "number") totals[key] += nutrition[key] * factor;
    }
    resolved++;
  }
  const serves = Math.max(1, Number(recipe?.serves) || 1);
  const perServing = Object.fromEntries(
    Object.entries(totals).map(([k, v]) => [k, v / serves])
  );
  return {
    total: round(totals),
    perServing: round(perServing),
    coverage: { resolved, total: ingredients.length },
  };
}

// Compute nutrition for a MEAL — sum of perServing across pieces.
// A meal of { main-for-2 + side-for-4 } is still "meal for 2" — each
// piece contributes its own perServing macros; the resulting totals
// represent one eater's share of the whole meal.
export function mealNutrition(meal, { pantry = [], brandNutrition, getInfo } = {}) {
  const totals = { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sodium_mg: 0, sugar_g: 0 };
  let resolvedPieces = 0;
  let totalIngredientsResolved = 0;
  let totalIngredients = 0;
  const pieces = meal?.pieces || [];
  for (const p of pieces) {
    const r = p?.recipe;
    if (!r) continue;
    const n = recipeNutrition(r, { pantry, brandNutrition, getInfo });
    if (n.coverage.total === 0) continue;
    for (const key of Object.keys(totals)) {
      if (typeof n.perServing[key] === "number") totals[key] += n.perServing[key];
    }
    if (n.coverage.resolved > 0) resolvedPieces++;
    totalIngredientsResolved += n.coverage.resolved;
    totalIngredients        += n.coverage.total;
  }
  return {
    total: round(totals),
    coverage: {
      pieces:      { resolved: resolvedPieces,        total: pieces.length },
      ingredients: { resolved: totalIngredientsResolved, total: totalIngredients },
    },
  };
}

// Compute per-unit nutrition for a single pantry row, scaled to its
// row.amount + row.unit. Used by the ItemCard chip to answer "how
// many kcal in this jar?" without reference to any recipe. Returns
// the raw source + scaled numbers; UI picks which to show.
export function pantryItemNutrition(pantryRow, { brandNutrition, getInfo } = {}) {
  const { nutrition, source, brand } = resolveNutrition(pantryRow, { brandNutrition, getInfo });
  if (!nutrition) return { nutrition: null, source: null };
  return { nutrition, source, brand };
}

// Round every value in a macros object to 1 decimal place for display.
// Keeps the total-rollup honest internally (we sum raw floats) but
// surfaces reasonable numbers instead of "712.39428 kcal".
function round(macros) {
  const out = {};
  for (const [k, v] of Object.entries(macros || {})) {
    out[k] = Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
  }
  return out;
}

// Compact "142 kcal · 12p · 8c · 7f" display string. Used by ItemCard
// chip + recipe summary line. Drops zero macros to save space; always
// leads with kcal.
export function formatMacros(macros, { verbose = false } = {}) {
  if (!macros) return "—";
  const kcal = Math.round(macros.kcal || 0);
  const p = Math.round(macros.protein_g || 0);
  const c = Math.round(macros.carb_g    || 0);
  const f = Math.round(macros.fat_g     || 0);
  if (verbose) {
    return `${kcal} kcal · ${p}g protein · ${c}g carbs · ${f}g fat`;
  }
  return `${kcal} kcal · ${p}p · ${c}c · ${f}f`;
}

// Source badge label + color. Keeps the hierarchy legible on the UI
// without the user having to guess where a number came from.
export function sourceBadge(source) {
  switch (source) {
    case "pantry":    return { label: "YOU",      color: "#7ec87e" };
    case "brand":     return { label: "BRAND",    color: "#c7a8d4" };
    case "canonical": return { label: "CANONICAL", color: "#b8a878" };
    case "default":   return { label: "EST.",     color: "#888"    };
    default:          return { label: "",         color: "#555"    };
  }
}
