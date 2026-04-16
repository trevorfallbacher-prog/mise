// Freezer-tab tile taxonomy + classifier.
//
// Third and final of the three physical-location tile sets. Mirrors
// fridgeTiles.js and pantryTiles.js: FREEZER_TILES registry (display
// order) + freezerTileIdForItem classifier. Never returns null — every
// row lands somewhere reachable via drill-down.
//
// The freezer classifier is subtly different from the other two: it's
// driven mostly by the ingredient's registry category (meat / produce /
// dairy) rather than by id-specific overrides, because the freezer is
// where items from every other aisle temporarily live. Butter in the
// freezer is still butter (category:"dairy") — we just route it to a
// freezer-specific tile.

export const FREEZER_TILES = [
  { id: "frozen_meat_poultry", emoji: "🥩", label: "Meat & Poultry",     blurb: "Chicken, beef, pork, lamb, sausage, bacon" },
  { id: "frozen_seafood",      emoji: "🐟", label: "Seafood",            blurb: "Fish fillets, shrimp, scallops, squid" },
  { id: "frozen_stocks_sauces",emoji: "🫙", label: "Stocks & Sauces",    blurb: "Frozen stock, tomato sauce, mole, ragu" },
  { id: "frozen_veg",          emoji: "🌽", label: "Vegetables",         blurb: "Peas, corn, spinach, edamame, mixed veg" },
  { id: "frozen_fruit",        emoji: "🍓", label: "Fruit",              blurb: "Berries, mango, banana, peaches" },
  { id: "frozen_bread_dough",  emoji: "🍞", label: "Bread & Dough",      blurb: "Bread, pizza dough, pie crust, puff pastry" },
  { id: "frozen_meal_prep",    emoji: "🍱", label: "Meal Prep",          blurb: "Cooked meals, leftovers, batch portions" },
  { id: "frozen_desserts",     emoji: "🧁", label: "Desserts",           blurb: "Ice cream, frozen yogurt, sorbet, pastry" },
  { id: "frozen_butter_dairy", emoji: "🧈", label: "Butter & Dairy",     blurb: "Butter, cream — the \"remembered to freeze it\" tile" },
  { id: "frozen_herbs",        emoji: "🌿", label: "Fresh Herbs Frozen", blurb: "Herb cubes, vacuum-sealed fresh herbs" },
];

// Seafood ids (category:"meat" in the registry, but get their own tile).
// Mirrors fridgeTiles.SEAFOOD_IDS — kept in sync by hand since the sets
// aren't shared state; two duplicates are easier to reason about than
// a single cross-module constant imported at class-init time.
const SEAFOOD_IDS = new Set([
  "salmon", "shrimp", "cod", "scallops", "tuna", "tilapia",
  "anchovies", "clams", "mussels", "crab", "lobster", "halibut",
  "sardines", "octopus", "squid", "oysters",
]);

// Fruits vs. vegetables inside category:"produce". Avocado and tomato are
// technically botanical fruits but culinarily vegetables — left in the
// veg bucket because nobody freezes avocado thinking "fruit bowl."
const FRUIT_IDS = new Set([
  "apple", "banana", "blueberry", "orange", "strawberry", "lemon", "lime",
  "peach", "mango", "cherry", "grape", "pineapple",
  "raspberry", "blackberry", "watermelon", "melon", "cantaloupe",
  "pear", "plum", "apricot", "pomegranate", "cranberry",
]);

// Fresh herbs — same set as fridgeTiles. When they end up in the freezer
// (pesto cubes, oil-in-ice-cube-tray, vac-sealed bunches) they route to
// the dedicated herb tile, not to the generic produce/vegetables tile.
const HERB_IDS = new Set([
  "basil", "parsley", "cilantro", "mint",
  "thyme", "rosemary", "tarragon", "chives", "sage", "dill", "oregano",
]);

// Bread & dough family — same set as fridgeTiles BREAD_IDS plus the
// freezer-specific "bought it frozen" items (pizza dough, pie crust,
// puff pastry, phyllo).
const BREAD_DOUGH_IDS = new Set([
  "bread", "baguette", "ciabatta", "tortillas",
  "pita", "english_muffins", "croissants", "sourdough",
  "pizza_dough", "pie_crust", "puff_pastry", "phyllo",
  "dumpling_wrappers", "wonton_wrappers", "spring_roll_wrappers",
]);

// Stocks & sauces — homemade stocks frozen in bags, batch-made sauces.
// Includes tomato paste (lives in pantry sealed, often moved to freezer
// in 1-tbsp dollops once opened) and canned tomatoes (ditto).
const STOCKS_SAUCES_IDS = new Set([
  "chicken_stock", "beef_stock", "vegetable_stock", "bone_broth",
  "tomato_sauce", "marinara", "ragu", "bolognese", "pesto",
  "mole", "salsa", "salsa_verde",
  "tomato_paste", "canned_tomatoes",
]);

// Desserts — ice cream, frozen desserts, frozen pastries. Sparse in the
// current registry; forward-looking.
const DESSERT_IDS = new Set([
  "ice_cream", "frozen_yogurt", "sorbet", "gelato", "popsicles",
  "frozen_pastry", "frozen_cake", "mochi_ice_cream",
]);

// Butter & dairy frozen — category:"dairy" rows that land in the freezer.
// Butter is the canonical case ("remembered to freeze it" tile). Cream,
// heavy cream, and milk can also be frozen (with caveats) — route here.
// Cheese can technically be frozen too but the texture damage is severe;
// still, route hard cheeses here for completeness.
const BUTTER_DAIRY_IDS = new Set([
  "butter", "cream", "heavy_cream", "milk", "milk_2pct", "milk_skim",
  "half_and_half", "buttermilk", "sour_cream", "cream_cheese",
  "mozzarella", "parmesan", "parmigiano", "cheddar",
]);

// Classify a pantry item into a freezer tile id. Order here is tuned so
// more-specific matches win before less-specific ones:
//   1. Seafood before meat (seafood ids are category:"meat" in registry)
//   2. Herbs before produce (herb ids are category:"produce")
//   3. Fruit before veg (subset of produce, not a distinct category)
//   4. Bread/dough ids before categories
//   5. Butter/dairy last among "category wins" checks
// Fallback is meal_prep — the natural home for "I cooked this and
// froze it," which is the most common untracked-registry freezer row.
export function freezerTileIdForItem(item, { findIngredient, hubForIngredient }) {
  if (item?.freezerTile) return item.freezerTile;

  const ing = item?.ingredientId ? findIngredient(item.ingredientId) : null;
  const hub = ing ? hubForIngredient(ing) : null;

  // Seafood first.
  if (ing && SEAFOOD_IDS.has(ing.id)) return "frozen_seafood";
  if (hub && hub.id === "seafood_hub") return "frozen_seafood";

  // Stocks and sauces — shelf-stable items sometimes moved to the freezer
  // for portion control (tomato paste dollops, stock cubes).
  if (ing && STOCKS_SAUCES_IDS.has(ing.id)) return "frozen_stocks_sauces";

  // Fresh herbs (frozen cubes, vac-sealed bunches).
  if (ing && HERB_IDS.has(ing.id)) return "frozen_herbs";

  // Bread + dough.
  if (ing && BREAD_DOUGH_IDS.has(ing.id)) return "frozen_bread_dough";
  if (hub && hub.id === "bread_hub") return "frozen_bread_dough";

  // Desserts (ice cream, etc.).
  if (ing && DESSERT_IDS.has(ing.id)) return "frozen_desserts";

  // Butter & dairy frozen — covers the registry's dairy category with
  // eggs excluded (eggs aren't on the butter/dairy tile — people don't
  // typically freeze whole eggs).
  if (ing && BUTTER_DAIRY_IDS.has(ing.id)) return "frozen_butter_dairy";
  if (hub && (hub.id === "cheese_hub" || hub.id === "milk_hub" || hub.id === "yogurt_hub")) {
    return "frozen_butter_dairy";
  }

  // Produce — fruits separate from vegetables.
  if (ing && FRUIT_IDS.has(ing.id)) return "frozen_fruit";
  if (ing && ing.category === "produce") return "frozen_veg";

  // Meat — after seafood split above.
  if (ing && ing.category === "meat") return "frozen_meat_poultry";

  // Free-text fallback: use the item's own category field.
  if (item?.category === "meat")    return "frozen_meat_poultry";
  if (item?.category === "produce") return "frozen_veg";
  if (item?.category === "dairy")   return "frozen_butter_dairy";
  if (item?.category === "frozen")  return "frozen_meal_prep";

  // Catch-all: Meal Prep. A row without registry metadata that landed
  // in the freezer is almost always a cooked-and-saved portion.
  return "frozen_meal_prep";
}
