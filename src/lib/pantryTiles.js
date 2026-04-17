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
  { id: "bread",             emoji: "🍞", label: "Bread",               blurb: "Tortillas, pita, naan, sandwich bread, bagels" },
  { id: "dried_chilies",     emoji: "🌶️", label: "Dried Chilies",      blurb: "Ancho, guajillo, pasilla, chipotle, árbol" },
  // Catch-all — anything the classifier couldn't place. Always
  // reachable so items don't vanish when moved here from another
  // location with a different tile taxonomy.
  { id: "misc",              emoji: "📦", label: "Miscellaneous",       blurb: "Anything that doesn't fit the other tiles" },
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
  // Dry-crumb / cracker family lives with baking — they share a shelf
  // with flour and cornstarch in most kitchens and they ARE derivatives
  // of stale bread. Moved out of the old bread_dry_goods tile so Bread
  // can be a proper "actual bread" tile (tortillas, pita, sandwich bread).
  "crackers", "saltines", "breadcrumbs", "panko", "croutons",
  "melba_toast", "rice_cakes", "water_crackers",
]);

// Dried spices — bay leaves and dried herbs live here, not in Fresh Herbs
// (which is a fridge-only tile).
const SPICE_DRIED_HERB_IDS = new Set([
  // Salts
  "salt", "kosher_salt", "sea_salt", "table_salt", "flaky_salt",
  "smoked_salt", "truffle_salt", "celery_salt", "garlic_salt",
  "onion_salt", "seasoned_salt", "msg",
  // Peppers & heat
  "black_pepper", "white_pepper", "peppercorns", "lemon_pepper",
  "red_pepper_flakes", "cayenne", "chili_powder",
  // Core ground spices
  "cumin", "ground_cumin", "cumin_seed",
  "paprika", "smoked_paprika", "sweet_paprika",
  "cinnamon", "ground_cinnamon",
  "turmeric", "coriander", "ground_coriander", "cardamom",
  "cloves", "nutmeg", "allspice", "star_anise", "mace",
  "fennel_seed", "mustard_seed", "ground_mustard",
  "cream_of_tartar",
  "saffron", "annatto",
  // Dried herbs
  "oregano", "dried_oregano", "bay_leaves",
  "dried_thyme", "dried_rosemary", "dried_sage",
  "dried_basil", "dried_parsley", "dried_dill",
  "dried_tarragon", "dried_marjoram",
  "dried_chives", "dried_mint",
  // Powders
  "garlic_powder", "onion_powder", "ginger_powder",
  // Seeds
  "poppy_seed", "caraway_seed", "celery_seed",
  "white_sesame", "black_sesame",
  "fenugreek", "juniper_berries",
  // Blends
  "curry_powder", "garam_masala",
  "old_bay", "zaatar", "sumac",
  "five_spice", "ras_el_hanout", "berbere", "dukkah",
  "italian_seasoning", "herbs_de_provence",
  "taco_seasoning", "ranch_seasoning", "everything_bagel",
  "cajun_seasoning", "jerk_seasoning",
  "furikake", "togarashi",
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

// Bread — actual bread products people store on the counter or in the
// bread drawer. Tortillas, pita, and naan were falling through to the
// canned_jarred catch-all; they live here now. Dry cracker-family items
// (breadcrumbs, panko, croutons, saltines) moved into the Baking tile
// where they share a shelf with flour in most kitchens.
const BREAD_IDS = new Set([
  "tortillas", "corn_tortillas", "flour_tortillas",
  "pita", "pita_bread", "naan", "lavash", "flatbread", "roti",
  "sandwich_bread", "white_bread", "wheat_bread", "sourdough",
  "baguette", "ciabatta", "focaccia", "rye_bread", "brioche",
  "bagels", "english_muffins", "hamburger_buns", "hot_dog_buns",
  "dinner_rolls", "kaiser_rolls", "challah",
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
  // Explicit user placement wins (migration 0036) — see fridgeTiles.js
  // for the rationale. User-set tile_id trumps the heuristic.
  if (item?.tileId) return item.tileId;
  if (item?.pantryTile) return item.pantryTile;

  const ing = item?.ingredientId ? findIngredient(item.ingredientId) : null;
  const hub = ing ? hubForIngredient(ing) : null;

  // Dried chilies first — more specific than the general spice tile.
  if (ing && DRIED_CHILI_IDS.has(ing.id)) return "dried_chilies";

  // Hubs map to tiles directly where applicable.
  if (hub && hub.id === "pasta_hub") return "pasta_grains";
  if (hub && hub.id === "rice_hub")  return "pasta_grains";
  if (hub && hub.id === "bean_hub")  return "beans_legumes";
  if (hub && hub.id === "bread_hub") return "bread";

  if (ing && PASTA_GRAIN_IDS.has(ing.id))      return "pasta_grains";
  if (ing && BEAN_LEGUME_IDS.has(ing.id))      return "beans_legumes";
  // Baking before canned_jarred so breadcrumbs / panko / crackers route
  // to their new home instead of hitting the free-text fallback below.
  if (ing && BAKING_IDS.has(ing.id))           return "baking";
  if (ing && BREAD_IDS.has(ing.id))            return "bread";
  if (ing && CANNED_JARRED_IDS.has(ing.id))    return "canned_jarred";
  if (ing && SPICE_DRIED_HERB_IDS.has(ing.id)) return "spices_dried_herbs";
  if (ing && CONDIMENT_SAUCE_IDS.has(ing.id))  return "condiments_sauces";
  if (ing && OIL_FAT_IDS.has(ing.id))          return "oils_fats";
  if (ing && SWEETENER_IDS.has(ing.id))        return "sweeteners";
  if (ing && NUT_SEED_IDS.has(ing.id))         return "nuts_seeds";
  if (ing && COOKING_ALCOHOL_IDS.has(ing.id))  return "cooking_alcohol";

  // Free-text fallback: the item has no canonical ingredient match. Before
  // dumping into canned_jarred, do a keyword scan on the item's name so
  // common un-linked entries route to the right tile instead of the catch-all.
  // This catches "Italian Seasoning", "Garlic Powder", "Ground Cumin", etc.
  // that users added manually without picking a registry ingredient.
  const lower = (item?.name || "").toLowerCase();
  const spiceKeywords = [
    "powder", "ground", "dried", "seasoning", "spice", "herb",
    "pepper", "salt", "cumin", "paprika", "oregano", "thyme",
    "rosemary", "cinnamon", "turmeric", "nutmeg", "allspice",
    "cayenne", "chili", "garlic powder", "onion powder",
    "garam", "curry", "saffron", "zaatar", "sumac", "flakes",
  ];
  if (spiceKeywords.some(kw => lower.includes(kw))) return "spices_dried_herbs";

  // Miscellaneous is the residual catch-all — always reachable via
  // drill-down so nothing silently drops out of the UI. Canned &
  // Jarred is reserved for items that actually match the canned
  // keywords / ids above, not a de-facto dumping ground.
  return "misc";
}
