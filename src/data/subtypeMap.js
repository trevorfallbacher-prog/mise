// WWEIA food-type → brand-expertise subtype bridge.
//
// The brand picker (src/lib/pickPrimaryBrand.js) classifies a brand
// as primary / secondary / inclusion using a `subtype` axis defined
// in src/data/brandExpertise.js (cookie, candy, sauce, deli, etc.).
// The picker reads subtype from `findIngredient(canonicalId).subtype`
// — but that only works when the canonical is in our bundled registry.
//
// This map closes the gap. When we DON'T have the canonical in the
// registry but DO have a WWEIA typeId (from typeIdForCanonical, from
// inferFoodTypeFromName, or from OFF/USDA-derived data), we can still
// resolve a subtype by looking up the typeId here.
//
// Net effect: a UPC for an unknown canonical that OFF tags as
// "en:cookies" / "en:chocolate-biscuits" maps to typeId=wweia_baked_sweets
// → subtype=cookie. The picker can then demote M&M's-on-the-cookie
// even though the canonical itself was never registered.
//
// Coverage notes:
//   * Mapped to ONE of the brand-expertise subtypes — not all
//     WWEIA types have a corresponding subtype. WWEIA "vegetables"
//     or "fruits" have no brand-expertise mapping (no curated brand
//     in our seed produces those as inclusion-licensors), so they
//     stay unmapped (return null).
//   * Coarse mapping is fine. WWEIA's "wweia_poultry" maps to
//     "chicken_cut" even though it also covers turkey — the picker
//     uses subtype as a coarse demotion gate, not for product
//     identity. Refining further would need MORE subtypes, not a
//     finer typeId map.

export const SUBTYPE_FOR_TYPE_ID = {
  // ── dairy ─────────────────────────────────────────────
  wweia_cheese:           "cheese",
  wweia_yogurt:           "yogurt",
  wweia_milk:             "milk",
  wweia_butter:           "butter",
  wweia_ice_cream:        "ice_cream",

  // ── meat & sausages ───────────────────────────────────
  wweia_poultry:          "chicken_cut",
  wweia_hot_dogs:         "sausage",
  wweia_sausages:         "sausage",

  // ── pantry baked / sweets ─────────────────────────────
  wweia_baked_sweets:     "cookie",      // cookies + pastries roll up here
  wweia_crackers:         "cracker",
  wweia_candy:            "candy",
  wweia_cereal:           "cereal",
  wweia_bread:            "bread",

  // ── pantry shelf-stable / boxed meals ─────────────────
  wweia_pizza:            "boxed_meal",
  wweia_sandwiches:       "boxed_meal",
  wweia_dumplings:        "boxed_meal",
  wweia_frozen_meals:     "boxed_meal",
  wweia_soups:            "boxed_meal",

  // ── pantry baking ─────────────────────────────────────
  wweia_baking_essentials: "baking",
  wweia_flour:             "baking",
  wweia_sugars:            "sweetener",

  // ── pantry sauces / condiments / dressings ────────────
  wweia_ketchup:           "sauce",
  wweia_hot_sauce:         "sauce",
  wweia_bbq_sauce:         "sauce",
  wweia_pesto:             "sauce",
  wweia_salsa:             "sauce",
  wweia_asian_sauces:      "sauce",
  wweia_soy_sauce:         "sauce",
  wweia_fish_sauce:        "sauce",
  wweia_worcestershire:    "sauce",
  wweia_miso:              "sauce",
  wweia_other_sauces:      "sauce",
  wweia_mustard:           "condiment",
  wweia_mayo:              "condiment",
  wweia_salad_dressing:    "dressing",
  wweia_tahini:            "spread",

  // ── pantry beverages ──────────────────────────────────
  wweia_alcohol:           "beverage",
  wweia_juices:            "beverage",
  wweia_coffee_tea:        "beverage",
};

// Tolerant lookup. Accepts the full "wweia_*" id or a bare token
// ("cookies" → "wweia_baked_sweets" → "cookie") so callers can
// pass either form. Returns null when no mapping fits.
export function subtypeForTypeId(typeId) {
  if (!typeId) return null;
  const slug = String(typeId).toLowerCase();
  // Direct hit on the full WWEIA id
  if (SUBTYPE_FOR_TYPE_ID[slug]) return SUBTYPE_FOR_TYPE_ID[slug];
  // Bare token — synthesize the WWEIA prefix and re-check
  const wweia = slug.startsWith("wweia_") ? slug : `wweia_${slug}`;
  return SUBTYPE_FOR_TYPE_ID[wweia] || null;
}
