// Fridge-tab tile taxonomy + classifier.
//
// Pantry items with location === "fridge" are grouped into a small set of
// tiles that match how people actually think about what's in their fridge
// ("where's the cheese?" → Dairy tile). Empty tiles still render (greyed
// out) so the user can drill into any category and add the first item.
//
// Pantry and Freezer tabs will get their own tile sets later; the data
// file here is structured so that extending is a matter of adding more
// arrays + a parallel classifier.

// Display metadata for each tile. Order = render order on the grid.
export const FRIDGE_TILES = [
  { id: "meat_poultry", emoji: "🥩", label: "Meat & Poultry", blurb: "Chicken, beef, pork, lamb, turkey, bacon" },
  { id: "seafood",      emoji: "🐟", label: "Seafood",        blurb: "Fish, shrimp, scallops, shellfish" },
  { id: "dairy",        emoji: "🧀", label: "Dairy & Eggs",   blurb: "Milk, cream, yogurt, cheese, butter, eggs" },
  { id: "produce",      emoji: "🥦", label: "Produce",        blurb: "Vegetables and fruit" },
  { id: "fresh_herbs",  emoji: "🌿", label: "Fresh Herbs",    blurb: "Basil, parsley, cilantro, mint" },
  { id: "condiments",   emoji: "🫙", label: "Condiments & Sauces", blurb: "Mustard, soy sauce, hot sauce, miso" },
  { id: "drinks",       emoji: "🥤", label: "Drinks",         blurb: "OJ, plant milks, sparkling water" },
  { id: "bread_baked",  emoji: "🥖", label: "Bread & Baked",  blurb: "Sandwich bread, tortillas, pita" },
  { id: "leftovers",    emoji: "🍱", label: "Leftovers",      blurb: "Anything cooked and stored" },
  // Catch-all — anything the classifier couldn't place. Keeps items
  // visible when the user moves them between locations and the new
  // location's tile set doesn't know about their canonical. Never
  // "hide" an item; the drawer for this tile is always the safety net.
  { id: "misc",         emoji: "📦", label: "Miscellaneous",  blurb: "Anything that doesn't fit the other tiles" },
];

// Ingredient-id sets used to route canonical rows to the right tile when the
// registry's top-level `category` isn't granular enough.
//
// Many of these IDs don't exist in the registry YET — seafood, herbs beyond
// the big 3, plant milks. The sets are forward-looking so when the registry
// expands the classifier already routes correctly without another edit.
const SEAFOOD_IDS = new Set([
  "salmon", "shrimp", "cod", "scallops", "tuna", "tilapia",
  "anchovies", "clams", "mussels", "crab", "lobster", "halibut",
  "sardines", "octopus", "squid", "oysters",
]);

const HERB_IDS = new Set([
  "basil", "parsley", "cilantro", "mint",
  "thyme", "rosemary", "tarragon", "chives", "sage", "dill", "oregano",
]);

// Plant milks live with drinks even though the registry files them under
// "dairy" (shared with the milk hub for substitutability). Same for OJ.
const DRINK_IDS = new Set([
  "oj", "almond_milk", "oat_milk", "soy_milk", "coconut_milk_drink",
  "juice", "kombucha", "sparkling_water", "soda", "sports_drink",
]);

// Condiments live in the fridge AFTER OPENING in almost every case (soy
// sauce and honey are the notable pantry-stable exceptions but most users
// still shelf them in the fridge door, so we include them here for the
// Fridge tab's convenience).
const CONDIMENT_IDS = new Set([
  "dijon", "mustard", "ketchup",
  "soy_sauce", "fish_sauce", "oyster_sauce", "hoisin", "mirin",
  "hot_sauce", "sriracha", "tabasco", "gochujang",
  "worcestershire", "tahini", "miso",
  "mayo", "mayonnaise", "jam", "jelly",
]);

const BREAD_IDS = new Set([
  "bread", "baguette", "ciabatta", "tortillas",
  "pita", "english_muffins", "croissants", "sourdough",
]);

// Classify a pantry item into a fridge tile id.
// Accepts a pantry row and helpers from the data module (injected to avoid
// a circular import at the component layer). Returns a tile id from
// FRIDGE_TILES, or "condiments" as the catch-all fridge bucket so nothing
// ever silently disappears from the UI.
export function tileIdForItem(item, { findIngredient, hubForIngredient }) {
  // Explicit user placement wins (migration 0036). When the user or a
  // family-shared template set item.tileId, skip the heuristic and
  // return it directly. Solves the "frozen pizza lands on dairy
  // because mozzarella is its primary component" problem — the
  // aggregate Meal has its own identity that no heuristic on its
  // components can recover.
  if (item?.tileId) return item.tileId;
  // Legacy explicit tag (pre-0036). Kept for back-compat.
  if (item?.fridgeTile) return item.fridgeTile;

  const ing = item?.ingredientId ? findIngredient(item.ingredientId) : null;
  const hub = ing ? hubForIngredient(ing) : null;

  // Seafood first — the registry has fish/shellfish under category:"meat"
  // which would otherwise route them to Meat & Poultry.
  if (ing && SEAFOOD_IDS.has(ing.id)) return "seafood";
  if (hub && hub.id === "seafood_hub") return "seafood";

  // Eggs were their own tile in an earlier iteration — merged into Dairy
  // now (too small a category to earn a tile of its own, and people
  // reach for the egg carton on the same trip as the milk). Left here
  // as a no-op so the id still maps cleanly if an old row carries
  // fridgeTile: "eggs".
  if (item?.fridgeTile === "eggs") return "dairy";

  // Plant milks + OJ — registered under "dairy" (so substitutions work in
  // recipes) but users think of them as drinks.
  if (ing && DRINK_IDS.has(ing.id)) return "drinks";

  // Fresh herbs — registered under "produce" but get their own tile.
  if (ing && HERB_IDS.has(ing.id)) return "fresh_herbs";

  // Bread family — registered under "pantry" but when an item was
  // physically placed in the fridge (humid-climate storage), it should
  // show up under the Bread tile.
  if (ing && BREAD_IDS.has(ing.id)) return "bread_baked";
  if (hub && hub.id === "bread_hub") return "bread_baked";

  // Condiments — mostly "pantry" category in the registry; users put them
  // in the fridge after opening.
  if (ing && CONDIMENT_IDS.has(ing.id)) return "condiments";

  // Category-based routing for canonical rows that didn't hit a specific id.
  if (ing && ing.category === "meat") return "meat_poultry";
  if (ing && ing.category === "dairy") return "dairy";
  if (ing && ing.category === "produce") return "produce";

  // Free-text rows: route by the item's own category field.
  if (item?.category === "meat") return "meat_poultry";
  if (item?.category === "dairy") return "dairy";
  if (item?.category === "produce") return "produce";

  // Catch-all. Unclassifiable rows land in Miscellaneous so they're
  // always reachable via drill-down — never silently dropped from
  // the UI. Condiments is reserved for items that genuinely match
  // CONDIMENT_IDS above, not a de-facto dumping ground.
  return "misc";
}

// Suggested fridge-tile emoji given an item's registry category — used as
// a hint on the confirm screen and in future "suggest where this goes"
// flows. Thin wrapper over tileIdForItem that returns the emoji instead.
export function tileEmojiForItem(item, helpers) {
  const id = tileIdForItem(item, helpers);
  return FRIDGE_TILES.find(t => t.id === id)?.emoji || "🫙";
}
