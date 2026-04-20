// Course-compatibility sets for the "Follow the category" priority
// mode in AIRecipe.
//
// When the user picks a tight-category course (bake / dessert / prep)
// AND priority="category", we filter the pantry rows fed into the
// Claude prompt so incompatible items (savory meats, full proteins
// on a bake, raw vegetables on a dessert) never become narrative
// pressure. Without this filter, Claude drafts savory skillets under
// the Baked Goods chip because the hot dog on the shelf is too
// tempting to leave behind.
//
// Sets are curated — we prefer a miss (compatible item dropped from
// the palette because it's not on the list) over a false positive
// (savory meat leaking into a bake). Add ids here when you notice
// gaps; don't sub in a regex vibe check.
//
// BOTH the client's prompt builder AND the edge function need to
// agree on these sets. Edge fn copies the list into its own module
// (Supabase edge functions can't currently import from src/); keep
// them in sync when editing.

// ── BAKE ──────────────────────────────────────────────────────────────
// Flour-sugar-butter-eggs-leavening + aromatics + fruit + chocolate/nuts.
// Explicitly no meat, fish, prepared deli items, or strong-savory vegetables.
// Zucchini / carrot / pumpkin / banana are here because quick-bread and
// muffin applications keep them in-frame.
export const BAKE_COMPATIBLE_CANONICALS = new Set([
  // Flours
  "flour", "all_purpose_flour", "bread_flour", "cake_flour",
  "pastry_flour", "whole_wheat_flour", "almond_flour", "oat_flour",
  "rye_flour", "cornmeal", "semolina",
  // Sugars / sweeteners
  "sugar", "white_sugar", "brown_sugar", "light_brown_sugar",
  "dark_brown_sugar", "powdered_sugar", "confectioners_sugar",
  "honey", "maple_syrup", "molasses", "corn_syrup", "agave",
  // Fats
  "butter", "unsalted_butter", "salted_butter", "shortening", "lard",
  "oil_neutral", "vegetable_oil", "canola_oil", "olive_oil", "coconut_oil",
  // Dairy
  "eggs", "egg_whites", "egg_yolks", "milk", "whole_milk", "skim_milk",
  "buttermilk", "heavy_cream", "half_and_half", "sour_cream",
  "cream_cheese", "mascarpone", "ricotta", "yogurt", "greek_yogurt",
  // Leavening + core bake chemistry
  "yeast", "active_dry_yeast", "instant_yeast", "baking_powder",
  "baking_soda", "cream_of_tartar", "salt", "kosher_salt", "sea_salt",
  "vanilla_extract", "vanilla_bean", "almond_extract",
  // Chocolate / cocoa
  "chocolate", "chocolate_chips", "dark_chocolate", "milk_chocolate",
  "white_chocolate", "semisweet_chocolate", "cocoa", "cocoa_powder",
  // Nuts + seeds
  "walnuts", "pecans", "almonds", "hazelnuts", "peanuts", "peanut_butter",
  "cashews", "pistachios", "poppy_seeds", "sesame_seeds", "chia_seeds",
  "flax_seeds", "sunflower_seeds", "pumpkin_seeds",
  // Grains + oats
  "oats", "rolled_oats", "steel_cut_oats", "quick_oats",
  // Spices + aromatics for sweet bakes
  "cinnamon", "ground_cinnamon", "nutmeg", "cardamom", "ginger_ground",
  "cloves", "allspice", "star_anise", "black_pepper",
  // Citrus (zest / juice)
  "lemon", "lime", "orange", "lemon_juice", "lime_juice", "orange_juice",
  "lemon_zest", "orange_zest",
  // Fruit (fresh / dried / preserved)
  "banana", "apple", "pear", "berries", "blueberries", "raspberries",
  "strawberries", "blackberries", "cherries", "cranberries",
  "pumpkin", "pumpkin_puree", "zucchini", "carrot", "sweet_potato",
  "raisins", "dates", "figs", "prunes", "currants",
  "jam", "preserves", "marmalade", "fruit_preserves",
  // Coffee / tea for mochas, spice cakes, etc.
  "coffee", "instant_coffee", "espresso_powder",
]);

// ── DESSERT ──────────────────────────────────────────────────────────
// Superset of bake + frozen/custard/confection ingredients. A dessert
// doesn't need to be baked, so gelatin, mascarpone, liqueurs, and
// ice-cream-base dairy all belong here too.
export const DESSERT_COMPATIBLE_CANONICALS = new Set([
  ...BAKE_COMPATIBLE_CANONICALS,
  // Set / thickener
  "gelatin", "cornstarch", "tapioca_starch", "arrowroot", "agar",
  // Rich dairy for custards / ice creams / panna cotta
  "condensed_milk", "sweetened_condensed_milk", "evaporated_milk",
  // Liqueurs / alcohol used in desserts
  "rum", "brandy", "kahlua", "grand_marnier", "amaretto",
  // Confection staples
  "marshmallows", "caramel", "toffee", "praline",
]);

// ── PREP ─────────────────────────────────────────────────────────────
// Components / condiments only. Aromatics, vinegars, acids, herbs,
// spices, stocks' building blocks. No full proteins (stock bones
// are a special case — user will probably add them manually when
// they mean to make stock).
export const PREP_COMPATIBLE_CANONICALS = new Set([
  // Aromatics
  "onion", "yellow_onion", "red_onion", "shallot", "garlic", "ginger",
  "celery", "carrot", "leek", "scallion", "green_onion",
  // Acids / vinegars / citrus
  "vinegar", "white_vinegar", "apple_cider_vinegar", "red_wine_vinegar",
  "white_wine_vinegar", "rice_vinegar", "balsamic_vinegar",
  "lemon", "lime", "lemon_juice", "lime_juice",
  // Salt + sweeteners for balance
  "salt", "kosher_salt", "sea_salt", "sugar", "honey", "maple_syrup",
  // Umami / funk
  "soy_sauce", "fish_sauce", "worcestershire", "miso", "anchovy",
  "mustard", "dijon_mustard", "whole_grain_mustard",
  // Fats for confits / dressings
  "olive_oil", "neutral_oil", "sesame_oil", "butter",
  // Herbs (fresh + dried)
  "parsley", "cilantro", "basil", "thyme", "rosemary", "sage",
  "oregano", "tarragon", "dill", "chives", "bay_leaf",
  "dried_thyme", "dried_oregano", "dried_basil", "dried_parsley",
  // Whole spices + blends
  "black_pepper", "peppercorns", "white_pepper", "red_pepper_flakes",
  "cumin", "coriander", "paprika", "smoked_paprika", "turmeric",
  "fennel_seed", "mustard_seed", "celery_seed", "caraway",
  "cinnamon", "cloves", "allspice", "star_anise", "juniper",
  // Aromatics for pickles / ferments
  "garlic_cloves", "chili", "jalapeno", "serrano", "red_chili",
]);

// Resolve which set to use for a given course id. Null for any
// course that doesn't filter (main / side / appetizer / any).
export function compatibilitySetFor(course) {
  if (course === "bake")    return BAKE_COMPATIBLE_CANONICALS;
  if (course === "dessert") return DESSERT_COMPATIBLE_CANONICALS;
  if (course === "prep")    return PREP_COMPATIBLE_CANONICALS;
  return null;
}

// Filter a list of pantry rows down to items compatible with the
// given course, when priority is "category". Non-filtering courses
// (and non-category priority) pass through unchanged.
//
// Policy when a row's canonicalId isn't in the set:
//   - Drop. Better a smaller palette than a contaminated one.
//   - Exception: rows with no canonicalId at all (free-text) are
//     kept only when course is null/non-tight — no way to verify
//     compatibility of "homemade sauce" (the free-text name). If
//     that becomes a real annoyance we can add a keyword check,
//     but initially it's better to hide them than risk Claude
//     weaving them into a bake.
export function filterPantryByCourse(rows, course, priority) {
  if (priority !== "category") return rows;
  const set = compatibilitySetFor(course);
  if (!set) return rows;
  return (rows || []).filter(r => r?.canonicalId && set.has(r.canonicalId));
}
