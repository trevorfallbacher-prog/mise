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

import { findIngredient, CUT_NUTRITION, DEFAULT_CUT_PER_HUB, CANONICAL_ALIASES } from "../data/ingredients";
import { convertWithBridge, effectiveCountWeightG, isMassLadder } from "./unitConvert";

// Resolve the best available nutrition for a pantry row. Phase 1 only
// uses tiers 3 + 4 (canonical); the optional `brandNutrition` map hooks
// in during Phase 2 and `pantryRow.nutritionOverride` during Phase 4.
// Caller passes `getInfo` from useIngredientInfo() to avoid re-reading
// the context inside every list render.
export function resolveNutrition(pantryRow, { brandNutrition, getInfo } = {}) {
  if (!pantryRow) return { nutrition: null, source: null };
  // 1. Pantry-row override (Phase 4).
  if (pantryRow.nutritionOverride && acceptableForResolve(pantryRow.nutritionOverride)) {
    return { nutrition: pantryRow.nutritionOverride, source: "pantry" };
  }
  const canonId = pantryRow.ingredientId || pantryRow.canonicalId || null;
  // 2. brand_nutrition row (Phase 2). Key format mirrors useBrandNutrition.
  // Exact match first (O(1) Map lookup). On a miss, fall through to a
  // word-boundary prefix match so a pantry row branded "Philadelphia"
  // still resolves against a brand_nutrition row written as
  // "Philadelphia Original". Word-boundary discipline (next char must
  // be whitespace or end-of-string) prevents misfires like "Joe's" →
  // "Trader Joe's" (fails because "Joe's" is not a prefix of "Trader
  // Joe's" from char 0). The prefix branch walks `rows` once per miss;
  // the table is small (one row per popular (canonical, brand) pair).
  if (canonId && pantryRow.brand && brandNutrition) {
    const brandKey = String(pantryRow.brand).trim().toLowerCase();
    let hit = brandNutrition.get?.(`${canonId}::${brandKey}`);
    if (!hit?.nutrition && Array.isArray(brandNutrition.rows)) {
      const candidates = brandNutrition.rows.filter(
        r => r?.canonicalId === canonId
          && r?.nutrition
          && isBrandPrefixMatch(brandKey, r.brand),
      );
      if (candidates.length) {
        // When multiple fuzzy candidates qualify, prefer the shortest
        // stored brand — a generic "Philadelphia" row beats a
        // hyper-specific "Philadelphia Original Limited Edition"
        // because the shorter string is closer to the user's input.
        candidates.sort((a, b) => (a.brand || "").length - (b.brand || "").length);
        hit = candidates[0];
      }
    }
    if (hit?.nutrition && acceptableForResolve(hit.nutrition)) {
      return { nutrition: hit.nutrition, source: "brand", brand: hit.displayBrand || pantryRow.brand };
    }
  }
  // 3. ingredient_info.nutrition — the admin-approved canonical average.
  if (canonId && typeof getInfo === "function") {
    const info = getInfo(canonId);
    if (info?.nutrition && acceptableForResolve(info.nutrition)) {
      return { nutrition: info.nutrition, source: "canonical" };
    }
  }
  // 4. Cut-specific registry lookup — for meat-hub canonicals
  //    (chicken / beef / pork / turkey) the hub itself doesn't carry
  //    nutrition because the value depends on the cut. Walk the row's
  //    cut axis to resolve a per-100g value from CUT_NUTRITION.
  //    Precedence within the tier:
  //      a. pantryRow.cut — new-model canonical+cut rows.
  //      b. CANONICAL_ALIASES[canonId]?.cut — legacy compound slugs
  //         like "chicken_breast" still carry cut info via the alias.
  //      c. DEFAULT_CUT_PER_HUB[hub] — untagged hub rows fall to the
  //         hub's conventional default (matches count.toBase).
  //    Resolved hub can come from the canonical we just found (aliases
  //    route to the base) OR from CANONICAL_ALIASES when canonId is a
  //    legacy compound slug.
  if (canonId) {
    const canon = findIngredient(canonId);
    const aliasEntry = CANONICAL_ALIASES[canonId];
    const hubId = canon?.id || aliasEntry?.base || canonId;
    if (CUT_NUTRITION[hubId]) {
      const cut = pantryRow.cut
        || aliasEntry?.cut
        || DEFAULT_CUT_PER_HUB[hubId]
        || null;
      const cutN = cut ? CUT_NUTRITION[hubId][cut] : null;
      if (cutN && acceptableForResolve(cutN)) {
        return { nutrition: cutN, source: "cut" };
      }
    }
  }
  // 5. In-code registry fallback — fires when ingredient_info hasn't
  //    been seeded for this canonical yet.
  if (canonId) {
    const canon = findIngredient(canonId);
    if (canon?.nutrition && acceptableForResolve(canon.nutrition)) {
      return { nutrition: canon.nutrition, source: "default" };
    }
  }
  return { nutrition: null, source: null };
}

// Read-side gate. Stricter than hasNumbers — even if a row slipped
// past the write-side `validateNutrition` (old data, a direct SQL edit,
// a future OFF ingestion path we haven't gated yet), the resolver
// pretends the tier is empty and falls through to the next one. The
// tolerant fallback in `scaleFactor` still handles the legacy
// `per="1 tsp (5g)"` shape separately, so we deliberately DON'T bounce
// those here — bouncing legacy rows would strand existing DB data the
// user hasn't had a chance to re-enrich yet. We only refuse shapes
// that the scaleFactor can't interpret under any branch.
function acceptableForResolve(n) {
  if (!hasNumbers(n)) return false;
  // Modern enum is always fine.
  if (n.per === "100g" || n.per === "count") return true;
  if (n.per === "serving") {
    const sg = Number(n.serving_g);
    return Number.isFinite(sg) && sg > 0;
  }
  // Legacy free-text "(Ng)" shape — scaleFactor salvages it.
  if (typeof n.per === "string" && /\(\s*[\d.]+\s*g\s*\)/i.test(n.per)) return true;
  // Anything else is garbage — skip the tier.
  return false;
}

// Word-boundary prefix match on two already-lowercased brand strings.
// One must be a prefix of the other, with the break point at a word
// boundary so we never match mid-word (e.g. "Phil" → "Philadelphia").
// Intentionally symmetric: both "stored shorter than input" and "input
// shorter than stored" match, since either ordering can be the
// generic-vs-specific case depending on which end has more data.
function isBrandPrefixMatch(a, b) {
  if (!a || !b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!longer.startsWith(shorter)) return false;
  if (longer.length === shorter.length) return true; // exact (Map.get handles; safety net here)
  return /\s/.test(longer[shorter.length]);
}

function hasNumbers(n) {
  if (!n || typeof n !== "object") return false;
  // At least one macro has to be a real number; otherwise there's
  // nothing to render and the UI should treat it as missing.
  return ["kcal", "protein_g", "fat_g", "carb_g"].some(k => typeof n[k] === "number");
}

// Strict sanity check on a nutrition block before it's written to the
// DB (or trusted at read time). Rejects lazy / malformed entries that
// would otherwise silently inflate the dashboard:
//   - wrong `per` value (not in the enum)
//   - per="serving" without a positive numeric serving_g
//   - kcal missing, non-finite, negative, or absurdly large (>10000 per
//     base unit — a stick of butter is 813 kcal, dense fat is 900; 10k
//     is unreachable by real food, so it's a safe ceiling)
//   - any macro that's present but not a finite non-negative number
// Returns { ok: true } on pass or { ok: false, reason } on failure. Used
// by useBrandNutrition.upsert and the pantry-override write path to
// reject bad data at the boundary rather than propagating it.
export function validateNutrition(n) {
  if (!n || typeof n !== "object") return { ok: false, reason: "not an object" };
  const per = n.per;
  if (per !== "100g" && per !== "count" && per !== "serving") {
    return { ok: false, reason: `per must be "100g"|"count"|"serving", got ${JSON.stringify(per)}` };
  }
  if (per === "serving") {
    const sg = Number(n.serving_g);
    if (!Number.isFinite(sg) || sg <= 0 || sg > 5000) {
      return { ok: false, reason: `serving_g required and must be 0-5000g when per="serving", got ${JSON.stringify(n.serving_g)}` };
    }
  }
  const kcal = Number(n.kcal);
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 10000) {
    return { ok: false, reason: `kcal must be 0-10000, got ${JSON.stringify(n.kcal)}` };
  }
  const MACRO_CEILINGS = { protein_g: 100, fat_g: 100, carb_g: 100, fiber_g: 100, sugar_g: 100, sodium_mg: 50000 };
  for (const [key, ceiling] of Object.entries(MACRO_CEILINGS)) {
    if (n[key] == null) continue;
    const v = Number(n[key]);
    if (!Number.isFinite(v) || v < 0 || v > ceiling) {
      return { ok: false, reason: `${key} must be 0-${ceiling}, got ${JSON.stringify(n[key])}` };
    }
  }
  return { ok: true };
}

// Scale factor for applying a nutrition block to a quantity. Returns
// null when the conversion isn't possible (unknown unit, missing
// serving_g on a per-serving nutrition, etc.) — callers should
// treat that as a coverage gap rather than a zero.
//
// Every mass-based canonical's ladder declares `toBase` in GRAMS (butter,
// flour, spices — see the spice factory in src/data/ingredients.js for the
// gram-base convention). Count-based canonicals (eggs, apples, bananas)
// declare `toBase=1` per count. The nutrition.per value picks which axis
// we're scaling along.
//
// opts.countWeightG (optional) — per-row grams-per-count. Two distinct
// roles depending on the canonical's ladder shape:
//   - Mass ladder (chicken_breast, sausage): overrides the canonical's
//     default count.toBase so "each breast in THIS pack is 170g"
//     calibrates downstream math. Delegated to convertWithBridge via
//     the synthetic row so the same override logic powers CookComplete.
//   - Count-only ladder (tortillas, bread_slice): acts as the MISSING
//     grams anchor. The canonical has no `g:1` entry so convertWithBridge's
//     pure-bridge path can't resolve count→g (the mass-side unit isn't
//     in the ladder). Compute grams directly from counts × override.
//     Without the override we still bail — no grams axis to scale along.
export function scaleFactor(qty, canonical, nutrition, opts = {}) {
  if (!qty || !canonical || !nutrition) return null;

  // Tolerant fallback — pre-v3 AI enrichment wrote free-text into
  // `per` ("1 tsp (5g)", "1 medium apple (182g)"). The gram weight is
  // right there in parentheses; salvage it so rows already persisted
  // in production still resolve instead of silently scoring zero.
  // Forward-going, the edge function strips malformed blocks before
  // they land — this branch only matters for the migration window.
  const per = coercePer(nutrition);
  if (!per) return null;

  const rowGramsPerCount = Number(opts.countWeightG);
  const haveOverride = Number.isFinite(rowGramsPerCount) && rowGramsPerCount > 0;
  const massLadder = isMassLadder(canonical);

  // Mass-ladder path: delegate qty→grams to convertWithBridge. Pass
  // the override through synthRow on count units so the row's
  // calibrated weight wins over the canonical's baked-in count.toBase.
  const synthRow = haveOverride && massLadder && qty.unit === "count"
    ? { countWeightG: rowGramsPerCount }
    : null;

  // Count-only ladder + override: roll qty up to counts via the
  // canonical's own ladder (pack.toBase=10 counts, count.toBase=1),
  // then multiply by grams-per-count to land on grams.
  // convertWithBridge's pure-bridge path can't do this because it
  // requires the mass-side unit to exist in the canonical's ladder,
  // which tortillas / bread_slice don't declare.
  let countOnlyGrams = null;
  if (haveOverride && !massLadder) {
    const fromEntry = canonical.units?.find(u => u.id === qty.unit);
    const countEntry = canonical.units?.find(u => u.id === "count");
    if (fromEntry && countEntry) {
      const counts = Number(qty.amount) * Number(fromEntry.toBase) / Number(countEntry.toBase);
      if (Number.isFinite(counts)) countOnlyGrams = counts * rowGramsPerCount;
    }
  }

  switch (per.kind) {
    case "100g": {
      if (countOnlyGrams != null) return countOnlyGrams / 100;
      if (!massLadder) return null;
      const res = convertWithBridge(qty, "g", canonical, synthRow);
      return res.ok ? res.value / 100 : null;
    }
    case "count": {
      const res = convertWithBridge(qty, "count", canonical, synthRow);
      return res.ok ? res.value : null;
    }
    case "serving": {
      const g = per.serving_g;
      if (!Number.isFinite(g) || g <= 0) return null;
      if (countOnlyGrams != null) return countOnlyGrams / g;
      if (!massLadder) return null;
      const res = convertWithBridge(qty, "g", canonical, synthRow);
      return res.ok ? res.value / g : null;
    }
    default:
      return null;
  }
}

// Normalize nutrition.per into a structured shape the switch above can
// consume. Handles the modern enum {"100g","count","serving"} and the
// legacy free-text format ("1 tsp (5g)", "1 medium apple (182g)")
// written by pre-v3 AI enrichments. The free-text fallback reads as
// "per=serving with serving_g=N" — the gram weight is the canonical
// reference; the leading "1 tsp" / "1 medium apple" is flavor text for
// humans, not a conversion instruction.
function coercePer(nutrition) {
  const raw = nutrition?.per;
  if (raw === "100g")    return { kind: "100g" };
  if (raw === "count")   return { kind: "count" };
  if (raw === "serving") return { kind: "serving", serving_g: Number(nutrition.serving_g) };
  if (typeof raw === "string") {
    // Match a trailing "(<number><optional space>g)" group.
    const m = raw.match(/\(\s*([\d.]+)\s*g\s*\)/i);
    if (m) {
      const g = Number(m[1]);
      if (Number.isFinite(g) && g > 0) return { kind: "serving", serving_g: g };
    }
    if (/^\s*100\s*g\s*$/i.test(raw)) return { kind: "100g" };
  }
  return null;
}

// Re-exported from unitConvert to preserve every existing
// `import { effectiveCountWeightG } from "./nutrition"` call site.
// Single source of truth for the math lives alongside convertWithBridge
// in unitConvert.js — they share the countWeightG resolution logic
// so fixing grams-per-count rules in one spot propagates everywhere.
// Module-scope binding via the top-of-file import lets scaleFactor
// below use the same function without a second import.
export { effectiveCountWeightG, isMassLadder };

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
  // Countable discrete items in meat/processed categories. Only
  // resolves to "count" when the canonical's ladder actually has a
  // count entry — parseAmountString drops the token otherwise so
  // "1 package of flour" stays unparsed instead of silently claiming
  // to be 1 count of flour (flour is a mass ladder).
  link: "count", links: "count",
  pack: "count", packs: "count",
  package: "count", packages: "count",
  pkg: "count", pkgs: "count",
  piece: "count", pieces: "count",
  slice: "count", slices: "count",
  patty: "count", patties: "count",
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
    const countWeightG = effectiveCountWeightG(pantryRow, canon);
    const factor = scaleFactor(qty, canon, nutrition, { countWeightG });
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

// DEBUG: Per-ingredient breakdown of recipeNutrition. Same resolver
// chain, but returns one row per recipe ingredient annotated with what
// happened — canonical match, parsed qty, nutrition source, scale
// factor, macro contribution, and a `reason` when a row didn't
// contribute. Used by the CookComplete debug screen to expose where
// calories are being silently dropped. Safe to delete once the
// dashboard is trusted.
export function recipeNutritionBreakdown(recipe, { pantry = [], brandNutrition, getInfo } = {}) {
  const ingredients = recipe?.ingredients || [];
  const items = [];
  const totals = { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sodium_mg: 0, sugar_g: 0 };
  let resolved = 0;
  for (const ing of ingredients) {
    const row = {
      name: ing.item || ing.ingredientId || "(unnamed)",
      canonicalId: ing.ingredientId || null,
      amount: ing.amount || null,
      qty: ing.qty || null,
      parsedQty: null,
      source: null,
      brand: null,
      factor: null,
      nutrition: null,
      macros: null,
      kcal: 0,
      reason: null,
    };
    if (!ing.ingredientId) { row.reason = "no canonical id on recipe ingredient"; items.push(row); continue; }
    const canon = findIngredient(ing.ingredientId);
    if (!canon) { row.reason = `canonical "${ing.ingredientId}" not found in registry`; items.push(row); continue; }
    row.canonical = canon.name;
    const pantryRow = pantry.find(p => (p.ingredientId || p.canonicalId) === ing.ingredientId)
      || { ingredientId: ing.ingredientId, brand: null, nutritionOverride: null };
    const { nutrition, source, brand } = resolveNutrition(pantryRow, { brandNutrition, getInfo });
    row.source = source;
    row.brand = brand || null;
    row.nutrition = nutrition;
    if (!nutrition) { row.reason = "no nutrition from any resolver tier"; items.push(row); continue; }
    const parsed = ing.qty || parseAmountString(ing.amount, canon);
    row.parsedQty = parsed;
    if (!parsed) { row.reason = `could not parse amount "${ing.amount}"`; items.push(row); continue; }
    const countWeightG = effectiveCountWeightG(pantryRow, canon);
    row.countWeightG = countWeightG;
    const factor = scaleFactor(parsed, canon, nutrition, { countWeightG });
    row.factor = factor;
    if (factor == null) {
      const missingGrams =
        (nutrition.per === "100g" || nutrition.per === "serving") &&
        parsed.unit === "count" &&
        !(Number.isFinite(countWeightG) && countWeightG > 0);
      row.reason = missingGrams
        ? `per="${nutrition.per}" needs grams-per-count — set "each ~g" on the pantry row`
        : `scaleFactor returned null (per="${nutrition.per}", unit="${parsed.unit}")`;
      items.push(row);
      continue;
    }
    const macros = {};
    for (const key of Object.keys(totals)) {
      if (typeof nutrition[key] === "number") {
        const v = nutrition[key] * factor;
        macros[key] = v;
        totals[key] += v;
      }
    }
    row.macros = macros;
    row.kcal = macros.kcal || 0;
    resolved++;
    items.push(row);
  }
  const serves = Math.max(1, Number(recipe?.serves) || 1);
  const perServing = Object.fromEntries(
    Object.entries(totals).map(([k, v]) => [k, v / serves])
  );
  return {
    items,
    total: totals,
    perServing,
    serves,
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
    case "cut":       return { label: "CUT",      color: "#a8553a" };
    case "default":   return { label: "EST.",     color: "#888"    };
    default:          return { label: "",         color: "#555"    };
  }
}
