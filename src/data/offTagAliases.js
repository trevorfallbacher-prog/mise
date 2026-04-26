// Curated OFF taxonomy slug → bundled canonical mappings.
//
// Sister to off_category_tag_canonicals (the LEARNED tag map seeded
// reactively when an admin corrects a scan) and to STRONG_ALIASES in
// src/data/ingredientAliases.js (which keys raw ingredient phrases).
// This table is the PROACTIVE seed — common OFF taxonomy slugs that
// we want to map at "exact" confidence on day one without waiting
// for someone to scan-and-correct first.
//
// Why we need both:
//   * The learned tag map only fires once a user has corrected a
//     scan that carried that tag. Before that first correction, even
//     an obvious tag like "en:colas" produces NO Tier-1 hit and the
//     resolver has to fall through to fuzzy (which mismatches sodas
//     to whatever sub-string of `productName` happens to fuzz).
//   * The bundled canonical aliases / fuzzy tiers don't see the OFF
//     taxonomy at all — they're keyed on raw text or hint phrases.
//
// What this table closes: the cold-start gap on the long tail of OFF
// taxonomy slugs we KNOW resolve to a single canonical. One row in
// this table covers thousands of UPCs sharing that tag.
//
// Maintenance:
//   - Slug naming: OFF tags use `en:` prefixes (English taxonomy);
//     resolver normalizes to lowercase before lookup. Both the
//     prefixed AND bare forms are listed when both occur in the wild.
//   - canonical_id MUST exist in INGREDIENTS (or a known synthetic).
//     Pointing at a non-existent slug ghost-pairs and silently fails.
//     If a target slug isn't in the bundled registry yet, leave the
//     entry commented out with a TODO so the addition is a one-liner
//     once the canonical lands.

import { findIngredient } from "./ingredients";

// One curated row per (slug → canonical). Slugs lowercased; lookup
// normalizes the input the same way before checking the map.
export const OFF_TAG_ALIASES = {
  // ── Sodas / colas ──────────────────────────────────────────────
  // Bundled `soda` canonical added alongside this file.
  "en:colas":                         "soda",
  "colas":                            "soda",
  "en:sodas":                         "soda",
  "sodas":                            "soda",
  "en:carbonated-soft-drinks":        "soda",
  "carbonated-soft-drinks":           "soda",
  "en:soft-drinks":                   "soda",
  "soft-drinks":                      "soda",
  "en:diet-cola-soft-drinks":         "soda",
  "diet-cola-soft-drinks":            "soda",

  // ── Yogurts ────────────────────────────────────────────────────
  "en:yogurts":                       "yogurt",
  "yogurts":                          "yogurt",
  "en:plain-yogurts":                 "yogurt",
  "plain-yogurts":                    "yogurt",
  "en:greek-yogurts":                 "greek_yogurt",
  "greek-yogurts":                    "greek_yogurt",
  "en:greek-style-yogurts":           "greek_yogurt",
  "greek-style-yogurts":              "greek_yogurt",

  // ── Cheeses (only mappings to existing canonicals) ─────────────
  "en:cheddars":                      "cheddar",
  "cheddars":                         "cheddar",
  "en:mozzarellas":                   "mozzarella",
  "mozzarellas":                      "mozzarella",
  "en:parmigiano-reggiano":           "parmesan",
  "parmigiano-reggiano":              "parmesan",
  "en:feta":                          "feta",
  "feta":                             "feta",
  "en:bries":                         "brie",
  "bries":                            "brie",
  "en:goat-cheeses":                  "goat_cheese",
  "goat-cheeses":                     "goat_cheese",
  "en:cottage-cheeses":               "cottage_cheese",
  "cottage-cheeses":                  "cottage_cheese",
  "en:cream-cheeses":                 "cream_cheese",
  "cream-cheeses":                    "cream_cheese",

  // ── Milks ──────────────────────────────────────────────────────
  "en:milks":                         "milk",
  "milks":                            "milk",
  "en:whole-milks":                   "milk",
  "whole-milks":                      "milk",
  "en:skimmed-milks":                 "milk_skim",
  "skimmed-milks":                    "milk_skim",
  "en:almond-milks":                  "almond_milk",
  "almond-milks":                     "almond_milk",
  "en:oat-milks":                     "oat_milk",
  "oat-milks":                        "oat_milk",
  "en:half-and-half":                 "half_and_half",
  "half-and-half":                    "half_and_half",
  "en:butters":                       "butter",
  "butters":                          "butter",
  "en:heavy-creams":                  "heavy_cream",
  "heavy-creams":                     "heavy_cream",
  "en:sour-creams":                   "sour_cream",
  "sour-creams":                      "sour_cream",

  // ── Pasta variants ─────────────────────────────────────────────
  "en:spaghetti":                     "spaghetti",
  "spaghetti":                        "spaghetti",
  "en:penne":                         "penne",
  "penne":                            "penne",
  "en:fettuccine":                    "fettuccine",
  "fettuccine":                       "fettuccine",
  "en:linguine":                      "linguine",
  "linguine":                         "linguine",
  "en:rigatoni":                      "rigatoni",
  "rigatoni":                         "rigatoni",
  "en:fusilli":                       "fusilli",
  "fusilli":                          "fusilli",
  "en:rotini":                        "rotini",
  "rotini":                           "rotini",
  "en:lasagna-noodles":               "lasagna",
  "lasagna-noodles":                  "lasagna",

  // ── Rice variants ──────────────────────────────────────────────
  "en:basmati-rice":                  "basmati_rice",
  "basmati-rice":                     "basmati_rice",
  "en:jasmine-rice":                  "jasmine_rice",
  "jasmine-rice":                     "jasmine_rice",
  "en:brown-rice":                    "brown_rice",
  "brown-rice":                       "brown_rice",
  "en:arborio-rice":                  "arborio_rice",
  "arborio-rice":                     "arborio_rice",

  // ── Meat (state-aware: ground forms route through CANONICAL_ALIASES
  //    in ingredients.js, but the alias resolves to base+state at read,
  //    so pointing at the ground_* slugs is fine — the registry
  //    redirects correctly.) ──────────────────────────────────────
  "en:ground-beef":                   "ground_beef",
  "ground-beef":                      "ground_beef",
  "en:ground-pork":                   "ground_pork",
  "ground-pork":                      "ground_pork",
  "en:ground-turkey":                 "ground_turkey",
  "ground-turkey":                    "ground_turkey",
  "en:ground-chicken":                "ground_chicken",
  "ground-chicken":                   "ground_chicken",
  "en:bacons":                        "bacon",
  "bacons":                           "bacon",
  "en:salamis":                       "salami",
  "salamis":                          "salami",
  "en:hams":                          "ham",
  "hams":                             "ham",
  "en:prosciuttos":                   "prosciutto",
  "prosciuttos":                      "prosciutto",

  // ── Seafood ────────────────────────────────────────────────────
  "en:salmons":                       "salmon",
  "salmons":                          "salmon",
  "en:tunas":                         "tuna",
  "tunas":                            "tuna",
  "en:cods":                          "cod",
  "cods":                             "cod",
  "en:shrimps":                       "shrimp",
  "shrimps":                          "shrimp",

  // ── Bread / baked goods ────────────────────────────────────────
  "en:baguettes":                     "baguette",
  "baguettes":                        "baguette",
  "en:bagels":                        "bagel",
  "bagels":                           "bagel",
  "en:ciabattas":                     "ciabatta",
  "ciabattas":                        "ciabatta",
  "en:focaccias":                     "focaccia",
  "focaccias":                        "focaccia",
  "en:sourdough":                     "sourdough",
  "sourdough":                        "sourdough",
  "en:tortillas":                     "tortillas",
  "tortillas":                        "tortillas",
  "en:english-muffins":               "english_muffin",
  "english-muffins":                  "english_muffin",

  // ── Pantry staples ─────────────────────────────────────────────
  "en:olive-oils":                    "olive_oil",
  "olive-oils":                       "olive_oil",
  "en:extra-virgin-olive-oils":       "olive_oil",
  "extra-virgin-olive-oils":          "olive_oil",
  "en:soy-sauces":                    "soy_sauce",
  "soy-sauces":                       "soy_sauce",
  "en:fish-sauces":                   "fish_sauce",
  "fish-sauces":                      "fish_sauce",
  "en:hot-sauces":                    "hot_sauce",
  "hot-sauces":                       "hot_sauce",
  "en:ketchups":                      "ketchup",
  "ketchups":                         "ketchup",
  "en:mustards":                      "mustard",
  "mustards":                         "mustard",
  "en:mayonnaises":                   "mayo",
  "mayonnaises":                      "mayo",
  "en:honeys":                        "honey",
  "honeys":                           "honey",
  "en:maple-syrups":                  "maple_syrup",
  "maple-syrups":                     "maple_syrup",

  // ── Eggs / produce / juices ────────────────────────────────────
  "en:eggs":                          "eggs",
  "eggs":                             "eggs",
  "en:orange-juices":                 "oj",
  "orange-juices":                    "oj",

  // ── Coffees ────────────────────────────────────────────────────
  "en:coffees":                       "coffee",
  "coffees":                          "coffee",

  // ── Wines ──────────────────────────────────────────────────────
  "en:red-wines":                     "red_wine",
  "red-wines":                        "red_wine",
  "en:white-wines":                   "white_wine",
  "white-wines":                      "white_wine",
};

/**
 * Look up an OFF taxonomy slug against the seeded alias map. Returns
 * the canonical_id when a hit lands AND the target canonical exists
 * in the registry (defensive — silently skip stale alias entries
 * pointing at canonicals that have since been renamed/removed).
 *
 * Caller normalizes input to lowercase; we match only against the
 * map's lowercased keys.
 */
export function lookupOffTagAlias(tag) {
  if (!tag) return null;
  const key = String(tag).toLowerCase().trim();
  if (!key) return null;
  const canonicalId = OFF_TAG_ALIASES[key];
  if (!canonicalId) return null;
  // Guard: the alias points at a slug that no longer exists in the
  // registry. Treat as a miss rather than ghost-pair the resolver
  // onto a dead slug.
  const ing = findIngredient(canonicalId);
  if (!ing) return null;
  return canonicalId;
}
