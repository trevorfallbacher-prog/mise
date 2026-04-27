// Dietary-warning resolver — given a pantry row + a user profile,
// returns the list of ingredients that violate the user's dietary
// preferences.
//
// ARCHITECTURE: PROPERTY INHERITANCE FROM CHILDREN, NOT RELABELING.
//
// A row has a parent canonical (canonicalId) AND child compositional
// canonicals (ingredient_ids — populated by the explicit-tags path
// AND auto-populated from claim canonicals via
// resolveCanonicalWithClaims). The diet check walks the FULL TREE
// and aggregates:
//
//   - "Contains dairy"   = any child's category === "dairy" AND it
//                          isn't a registered dairy substitute
//   - "Not vegan"        = any child has info.diet.vegan === false
//   - "Not vegetarian"   = any child has info.diet.vegetarian === false
//   - "Has gluten"       = any child has info.diet.glutenFree === false
//   - (etc.)
//
// We do NOT add new flags to existing ingredients (no relabeling).
// We use what's already in the seed data + ingredient_info table:
//   - diet.vegan / diet.vegetarian / diet.glutenFree / diet.keto
//     / diet.halal / diet.kosher / diet.fodmap / diet.allium /
//     diet.nightshade — already populated for seeded canonicals
//   - category — already on every ingredient (dairy / meat /
//     produce / pantry); used to detect dairy presence without
//     needing a separate dairy_free flag
//
// AI enrichment (categorize-product-photo edge fn) attaches these
// flags when minting new pending canonicals, so the inheritance
// works for future-added canonicals too.
//
// For "Cheese Frank":
//   row.canonicalId       = frank
//   row.ingredient_ids    = ["cheese"]   (auto from claim resolution)
//   user.dietary          = "dairyfree"
//   findIngredient("cheese").category === "dairy"
//   → warning: { canonicalId: "cheese", reason: "dairy" }

import { findIngredient, getIngredientInfo, isCompatibleWithDiet } from "../data/ingredients";

// Plant-based / dairy-substitute canonicals that LOOK like dairy
// (often called "milk" / "yogurt" colloquially) but contain no
// actual dairy. These bypass the category-based dairy check.
const DAIRY_SUBSTITUTE_IDS = new Set([
  "almond_milk", "soy_milk", "oat_milk", "rice_milk", "coconut_milk_drink",
  "cashew_milk", "hemp_milk", "pea_milk",
  "vegan_butter", "vegan_cheese", "nutritional_yeast",
  "soy_yogurt", "almond_yogurt", "coconut_yogurt", "oat_yogurt",
  "vegan_cream", "vegan_sour_cream", "vegan_ice_cream",
  "almond_butter", "cashew_butter", "peanut_butter", "sunflower_butter",
]);

// Map profile.dietary single-string into the userDiet flag-shape
// that isCompatibleWithDiet expects. Profile uses simple ids
// ("vegan" / "dairyfree" / "keto"); the diet checker uses booleans
// keyed by trait. This is the bridge.
export function userDietFromProfile(profile) {
  if (!profile?.dietary) return null;
  const v = String(profile.dietary).toLowerCase();
  if (v === "everything") return null;
  const out = {};
  if (v === "vegan")      { out.vegan = true; out.vegetarian = true; out.dairyFree = true; }
  if (v === "vegetarian") out.vegetarian = true;
  if (v === "keto")       out.keto = true;
  if (v === "halal")      out.halal = true;
  if (v === "kosher")     out.kosher = "kosher";
  if (v === "dairyfree" || v === "dairy_free") out.dairyFree = true;
  if (v === "glutenfree" || v === "gluten_free") out.glutenFree = true;
  return Object.keys(out).length > 0 ? out : null;
}

// Per-ingredient diet check that EXTENDS isCompatibleWithDiet with
// category-derived dairy detection. The seed data already encodes
// vegan / vegetarian / keto / halal / kosher / fodmap / nightshade
// / allium via diet flags — those go through isCompatibleWithDiet
// unchanged. Dairy is the special case: rather than add a
// dairy_free flag to every dairy ingredient (relabeling),
// derive presence from ingredient.category === "dairy" excluding
// known dairy substitutes.
function dietViolation(ing, info, userDiet) {
  if (!ing || !userDiet) return null;
  // Dairy check — category-based, no relabeling.
  if (userDiet.dairyFree
      && ing.category === "dairy"
      && !DAIRY_SUBSTITUTE_IDS.has(ing.id)) {
    return "dairy";
  }
  // Everything else flows through the existing diet checker.
  if (info && !isCompatibleWithDiet(info, userDiet)) {
    const diet = info.diet || {};
    if (userDiet.vegan && diet.vegan === false)             return "not vegan";
    if (userDiet.vegetarian && diet.vegetarian === false)   return "not vegetarian";
    if (userDiet.keto && diet.keto === false)               return "not keto";
    if (userDiet.glutenFree && diet.glutenFree === false)   return "gluten";
    if (userDiet.halal && diet.halal === false)             return "not halal";
    if (userDiet.kosher && diet.kosher === "nonkosher")     return "not kosher";
    return "diet mismatch";
  }
  return null;
}

// Resolve dietary warnings for a pantry row. Walks the row's
// canonicalId AND ingredient_ids (the row's compositional tree)
// and returns one entry per child whose existing properties
// conflict with the user's diet. Empty array = row is safe.
//
// Property INHERITANCE: cheese has category=="dairy" in the seed
// data already; the row doesn't need its own dairy_free flag — it
// inherits the dairy property from its child (cheese ingredient
// id surfaced in ingredient_ids).
export function dietaryWarningsForRow(row, profile, dbMap = null) {
  const userDiet = userDietFromProfile(profile);
  if (!userDiet) return [];
  const seen = new Set();
  const ids = [];
  if (row?.canonicalId) ids.push(row.canonicalId);
  if (row?.ingredientId && row.ingredientId !== row.canonicalId) ids.push(row.ingredientId);
  if (Array.isArray(row?.ingredientIds))   for (const id of row.ingredientIds)   if (id) ids.push(id);
  if (Array.isArray(row?.ingredient_ids))  for (const id of row.ingredient_ids)  if (id) ids.push(id);
  const warnings = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const ing = findIngredient(id);
    if (!ing) continue;
    const info = getIngredientInfo(ing, dbMap);
    const reason = dietViolation(ing, info, userDiet);
    if (!reason) continue;
    warnings.push({
      canonicalId: id,
      name:        ing.name || ing.shortName || id,
      reason,
    });
  }
  return warnings;
}

export function rowHasDietaryWarning(row, profile, dbMap = null) {
  return dietaryWarningsForRow(row, profile, dbMap).length > 0;
}
