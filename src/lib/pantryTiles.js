// Pantry-tab tile taxonomy + classifier.
//
// Mirror of fridgeTiles.js for items whose physical location is "pantry".
// Eleven tiles covering the shape of a well-stocked home pantry, plus a
// bonus "Dried Chilies" tile for anyone doing Mexican cooking seriously.
//
// Same contract as fridgeTiles: PANTRY_TILES (display order) and
// pantryTileIdForItem(item, { findIngredient, hubForIngredient }) which
// returns a tile id — never null — so every pantry row lands somewhere
// reachable via drill-down.

export const PANTRY_TILES = [
  { id: "pasta_grains",      emoji: "🍝", label: "Pasta & Grains",      blurb: "Dried pasta, rice, farro, quinoa, oats, polenta" },
  { id: "beans_legumes",     emoji: "🫘", label: "Beans & Legumes",     blurb: "Canned beans, dried beans, lentils, chickpeas" },
  { id: "canned_jarred",     emoji: "🥫", label: "Canned & Jarred",     blurb: "San Marzano tomatoes, stock, tuna, coconut milk" },
  { id: "baking",            emoji: "🌾", label: "Baking",              blurb: "Flour, sugar, baking soda, cocoa, vanilla" },
  { id: "spices_dried_herbs",emoji: "🧂", label: "Spices & Dried Herbs",blurb: "Salt, pepper, cumin, paprika, bay leaves" },
  { id: "condiments_sauces", emoji: "🫙", label: "Condiments & Sauces", blurb: "Soy sauce, fish sauce, mustard, vinegars" },
  { id: "oils_fats",         emoji: "🧈", label: "Oils & Fats",         blurb: "Olive oil, neutral oil, sesame oil, ghee" },
  { id: "sweeteners",        emoji: "🍯", label: "Sweeteners",          blurb: "Honey, maple syrup, molasses, agave" },
  { id: "nuts_seeds",        emoji: "🥜", label: "Nuts & Seeds",        blurb: "Almonds, pine nuts, sesame, nut butters" },
  { id: "cooking_alcohol",   emoji: "🍷", label: "Cooking Alcohol",     blurb: "White wine, red wine, sake, vermouth" },
  { id: "bread_dry_goods",   emoji: "🍞", label: "Bread & Dry Goods",   blurb: "Crackers, breadcrumbs, panko, croutons" },
  { id: "dried_chilies",     emoji: "🌶️", label: "Dried Chilies",      blurb: "Ancho, guajillo, pasilla, chipotle, árbol" },
];

// Most of the granular tiles don't have registry ingredients yet — the
// sets are forward-looking so when the registry expands (baking aisle,
// spice rack, the dried chili pantry) the classifier routes correctly
// without another edit. Same pattern as fridgeTiles.

const PASTA_GRAIN_IDS = new Set([
  "spaghetti", "linguine", "bucatini", "penne", "rigatoni", "fettuccine",
  "orzo", "couscous", "rice", "jasmine_rice", "basmati_rice", "arborio",
  "brown_rice", "wild_rice", "farro", "barley", "quinoa", "polenta",
  "cornmeal", "oats", "rolled_oats", "steel_cut_oats",
]);

const BEAN_LEGUME_IDS = new Set([
  "black_beans", "kidney_beans", "pinto_beans", "cannellini", "navy_beans",
  "garbanzo", "chickpeas", "lentils", "red_lentils", "green_lentils",
  "split_peas", "black_eyed_peas", "lima_beans", "butter_beans",
]);

// Canned & jarred — shelf-stable preserved items. Stock is here (vs.
// Condiments) because culturally it sits with canned tomatoes and tuna
// on the pantry shelf.
const CANNED_JARRED_IDS = new Set([
  "canned_tomatoes", "crushed_tomatoes", "diced_tomatoes", "whole_tomatoes",
  "tomato_paste", "tomato_sauce", "passata",
  "coconut_milk", "coconut_cream",
  "chicken_stock", "beef_stock", "vegetable_stock", "bone_broth",
  "canned_tuna", "tuna", "sardines", "anchovies",
  "artichokes", "roasted_peppers", "capers", "olives",
  "chipotles_adobo", "salsa_verde",
]);

const BAKING_IDS = new Set([
  "flour", "bread_flour", "cake_flour", "pastry_flour", "whole_wheat_flour",
  "sugar", "brown_sugar", "powdered_sugar", "turbinado", "demerara",
  "baking_soda", "baking_powder", "yeast", "cornstarch",
  "cocoa", "cocoa_powder", "chocolate_chips", "dark_chocolate",
  "vanilla", "vanilla_extract", "almond_extract",
]);

// Dried spices — bay leaves and dried herbs live here, not in Fresh Herbs
// (which is a fridge-only tile).
const SPICE_DRIED_HERB_IDS = new Set([
  "salt", "kosher_salt", "sea_salt", "table_salt", "flaky_salt",
  "black_pepper", "white_pepper", "peppercorns",
  "cumin", "ground_cumin", "cumin_seed",
  "paprika", "smoked_paprika", "sweet_paprika",
  "oregano", "dried_oregano", "bay_leaves", "cinnamon", "ground_cinnamon",
  "turmeric", "coriander", "ground_coriander", "cardamom",
  "cloves", "nutmeg", "allspice", "star_anise", "fennel_seed",
  "mustard_seed", "curry_powder", "garam_masala", "chili_powder",
  "red_pepper_flakes", "cayenne", "old_bay", "zaatar", "sumac",
]);

const CONDIMENT_SAUCE_IDS = new Set([
  "soy_sauce", "tamari", "fish_sauce", "mirin",
  "miso", "white_miso", "red_miso",
  "hot_sauce", "sriracha", "tabasco", "gochujang", "harissa",
  "mustard", "dijon", "yellow_mustard", "whole_grain_mustard",
  "ketchup", "worcestershire", "tahini", "hoisin", "oyster_sauce",
  "mayo", "mayonnaise",
  "vinegar", "rice_vinegar", "white_vinegar", "apple_cider_vinegar",
  "red_wine_vinegar", "white_wine_vinegar", "champagne_vinegar",
  "sherry_vinegar", "balsamic",
]);

const OIL_FAT_IDS = new Set([
  "olive_oil", "extra_virgin_olive_oil",
  "vegetable_oil", "canola_oil", "neutral_oil", "grapeseed_oil",
  "sunflower_oil", "safflower_oil", "avocado_oil",
  "sesame_oil", "toasted_sesame_oil",
  "coconut_oil", "ghee", "lard", "duck_fat", "schmaltz",
  "shortening",
]);

const SWEETENER_IDS = new Set([
  "honey", "maple_syrup", "molasses", "agave", "piloncillo",
  "corn_syrup", "golden_syrup", "date_syrup",
]);

// Nut butters included here — peanut butter, almond butter, etc. —
// because when we think "where's the nut butter," we reach for the same
// shelf as the actual nuts.
const NUT_SEED_IDS = new Set([
  "almonds", "walnuts", "pecans", "cashews", "peanuts", "pistachios",
  "hazelnuts", "macadamia", "pine_nuts", "brazil_nuts",
  "sesame", "sesame_seeds", "pumpkin_seeds", "pepitas",
  "sunflower_seeds", "chia", "chia_seeds", "flax", "flax_seeds",
  "peanut_butter", "almond_butter", "cashew_butter", "nut_butter",
]);

const COOKING_ALCOHOL_IDS = new Set([
  "white_wine", "red_wine", "sake", "mirin",
  "vermouth", "dry_vermouth", "sweet_vermouth",
  "beer", "brandy", "cognac", "rum", "sherry", "port", "marsala",
]);

// Bread & dry goods — the cracker/breadcrumb/panko family. Fresh sandwich
// bread lives in the Fridge tab's Bread & Baked tile (or in the pantry
// depending on the user's storage); everything shelf-stable dry lands
// here.
const BREAD_DRY_GOOD_IDS = new Set([
  "crackers", "saltines", "breadcrumbs", "panko", "croutons",
  "melba_toast", "rice_cakes", "water_crackers",
]);

// Dried chilies — its own tile per the user's spec. Only populated if
// someone's actually cooking mole or pozole.
const DRIED_CHILI_IDS = new Set([
  "ancho", "ancho_chili", "guajillo", "pasilla",
  "chipotle", "chipotle_morita", "arbol", "de_arbol",
  "cascabel", "mulato", "negro_chili", "new_mexico_chili",
]);

// Ordered classifier. First match wins — order matters when an id could
// fit multiple tiles. Order here mirrors the PANTRY_TILES display order
// with one override: dried chilies are checked before spices so a
// chipotle doesn't get routed to the generic spice tile.
export function pantryTileIdForItem(item, { findIngredient, hubForIngredient }) {
  if (item?.pantryTile) return item.pantryTile;

  const ing = item?.ingredientId ? findIngredient(item.ingredientId) : null;
  const hub = ing ? hubForIngredient(ing) : null;

  // Dried chilies first — more specific than the general spice tile.
  if (ing && DRIED_CHILI_IDS.has(ing.id)) return "dried_chilies";

  // Hubs map to tiles directly where applicable.
  if (hub && hub.id === "pasta_hub") return "pasta_grains";
  if (hub && hub.id === "rice_hub")  return "pasta_grains";
  if (hub && hub.id === "bean_hub")  return "beans_legumes";
  if (hub && hub.id === "bread_hub") return "bread_dry_goods";

  if (ing && PASTA_GRAIN_IDS.has(ing.id))      return "pasta_grains";
  if (ing && BEAN_LEGUME_IDS.has(ing.id))      return "beans_legumes";
  if (ing && CANNED_JARRED_IDS.has(ing.id))    return "canned_jarred";
  if (ing && BAKING_IDS.has(ing.id))           return "baking";
  if (ing && SPICE_DRIED_HERB_IDS.has(ing.id)) return "spices_dried_herbs";
  if (ing && CONDIMENT_SAUCE_IDS.has(ing.id))  return "condiments_sauces";
  if (ing && OIL_FAT_IDS.has(ing.id))          return "oils_fats";
  if (ing && SWEETENER_IDS.has(ing.id))        return "sweeteners";
  if (ing && NUT_SEED_IDS.has(ing.id))         return "nuts_seeds";
  if (ing && COOKING_ALCOHOL_IDS.has(ing.id))  return "cooking_alcohol";
  if (ing && BREAD_DRY_GOOD_IDS.has(ing.id))   return "bread_dry_goods";

  // Free-text fallback. Registry category is "pantry" for almost
  // everything here so we can't route that way — send unknown pantry
  // items to Canned & Jarred as the least-surprising catch-all (most
  // "I don't know what this is" pantry rows are preserved items).
  return "canned_jarred";
}
