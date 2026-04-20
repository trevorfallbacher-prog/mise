// Keyword → tile inference dictionary.
//
// Used by AddItemModal: as the user types an item name, we
// longest-match against these keyword lists and surface a
// "⭐ SUGGESTED" highlight on the matched tile in the picker.
// User still confirms the pick — inference is a nudge, not an
// autopilot.
//
// Why this data lives here and not in the tile files themselves:
//   * Keyword lists are user-facing (they define what "counts as
//     pasta"); the tile definitions in *Tiles.js are
//     app-structural. Separating them makes it easy to tune
//     inference without perturbing the heuristic-classifier
//     behavior that drives how un-tagged items get routed.
//   * Adding/removing keywords is pure data entry — no schema
//     change, no function signatures to update.
//
// Match rules:
//   * Substring on the lowercased name (not word-boundary) — "pasta"
//     matches "cavatappi pasta" AND "pastaria" (the latter is an
//     edge case we accept; the user still confirms).
//   * Priority: longest matching keyword wins. "chicken pot pie"
//     matches both "chicken" (meat_poultry) and "pie" (baking?); the
//     longer phrase "chicken pot pie" would win if present.
//   * Ties break on the tile's position in TILE_KEYWORD_PRIORITY —
//     more specific tiles (frozen_meals, seafood) before generic
//     ones (canned_jarred, condiments_sauces).
//
// Adding a new keyword:
//   Pick the tile, find its entry below, append the lowercase
//   string. Reload; the picker will start suggesting.

// Ordered map — priority for tie-breaks. Earlier entries win when
// two tiles share a matching keyword of equal length. Order reflects
// specificity: a "frozen pizza" should route to frozen_meals, not
// the generic "pizza" -> pizza mapping that doesn't exist elsewhere.
export const TILE_KEYWORDS = [
  {
    tileId: "frozen_meals",
    keywords: [
      "frozen pizza", "frozen dinner", "tv dinner", "hot pocket",
      "frozen meal", "frozen burrito", "frozen lasagna", "microwave meal",
    ],
  },
  {
    tileId: "frozen_produce",
    keywords: [
      "frozen peas", "frozen corn", "frozen berries", "frozen broccoli",
      "frozen mango", "frozen strawberries", "frozen veg", "frozen fruit",
    ],
  },
  {
    tileId: "pasta_grains",
    keywords: [
      "pasta", "noodle", "noodles", "ramen", "udon", "soba",
      "rice noodle", "rice noodles", "instant noodle", "instant noodles",
      "spaghetti", "penne", "rigatoni",
      "fettuccine", "cavatappi", "fusilli", "rotini", "farfalle",
      "bow-tie", "bow tie", "macaroni", "bucatini", "linguine",
      "angel hair", "ziti", "orecchiette", "tortellini", "ravioli",
      "gnocchi", "orzo", "lasagna", "rice", "farro", "quinoa", "oats",
      "oatmeal", "polenta", "barley", "couscous", "bulgur",
    ],
  },
  {
    tileId: "bread",
    keywords: [
      "bread", "loaf", "bagel", "tortilla", "pita", "naan", "baguette",
      "roll", "rolls", "bun", "buns", "english muffin", "flatbread",
      "sourdough", "ciabatta", "focaccia", "brioche", "challah",
    ],
  },
  {
    tileId: "seafood",
    keywords: [
      "salmon", "shrimp", "prawn", "tuna", "cod", "scallops", "crab",
      "imitation crab", "surimi", "lobster", "fish", "halibut",
      "sardine", "anchovy", "octopus", "squid", "oyster", "mussel", "clam",
    ],
  },
  {
    tileId: "meat_poultry",
    keywords: [
      "chicken", "beef", "steak", "ground beef", "pork", "lamb", "turkey",
      "bacon", "sausage", "ham", "hot dog", "hotdog", "prosciutto",
      "pepperoni", "salami", "chorizo", "venison", "duck", "goose",
    ],
  },
  {
    tileId: "dairy",
    keywords: [
      "milk", "cream", "half and half", "heavy cream", "yogurt", "yoghurt",
      "cheese", "mozzarella", "cheddar", "provolone", "parmesan",
      "pepper jack", "monterey jack", "feta", "brie", "camembert",
      "ricotta", "mascarpone", "cream cheese", "cottage cheese", "butter",
      "ghee", "egg", "eggs", "sour cream",
    ],
  },
  {
    tileId: "fresh_herbs",
    keywords: [
      "fresh basil", "fresh parsley", "fresh cilantro", "fresh mint",
      "fresh dill", "fresh thyme", "fresh rosemary", "fresh chives",
      "fresh sage", "fresh tarragon",
    ],
  },
  {
    tileId: "produce",
    keywords: [
      "apple", "banana", "orange", "grape", "berry", "blueberries",
      "raspberries", "strawberries", "tomato", "cherry tomato", "potato",
      "sweet potato", "onion", "shallot", "garlic", "ginger", "carrot",
      "celery", "spinach", "kale", "lettuce", "arugula", "cucumber",
      "bell pepper", "jalapeño", "serrano", "chili", "avocado", "lemon",
      "lime", "mushroom", "zucchini", "squash", "pumpkin", "eggplant",
      "broccoli", "cauliflower", "cabbage", "asparagus", "leek", "fennel",
      "radish", "beet", "corn",
    ],
  },
  {
    tileId: "beans_legumes",
    keywords: [
      "bean", "beans", "black bean", "pinto bean", "kidney bean",
      "cannellini", "garbanzo", "chickpea", "lentil", "split pea",
      "tofu", "edamame", "tempeh", "hummus",
    ],
  },
  {
    tileId: "dried_chilies",
    keywords: [
      "ancho", "guajillo", "pasilla", "chipotle", "árbol", "arbol",
      "dried chili", "dried chile", "cascabel", "morita", "new mexico chile",
    ],
  },
  {
    tileId: "spices_dried_herbs",
    keywords: [
      "salt", "pepper", "peppercorn", "paprika", "smoked paprika", "cumin",
      "coriander", "oregano", "thyme", "rosemary", "basil", "bay leaf",
      "bay leaves", "cinnamon", "nutmeg", "cloves", "cardamom", "allspice",
      "turmeric", "ginger powder", "chili powder", "cayenne",
      "red pepper flakes", "garlic powder", "onion powder",
      "italian seasoning", "herbs de provence", "curry powder",
      "garam masala", "five spice", "zaatar", "sumac", "everything bagel",
      "furikake", "togarashi", "old bay", "ras el hanout", "berbere",
    ],
  },
  {
    tileId: "condiments_sauces",
    keywords: [
      "ketchup", "mustard", "mayo", "mayonnaise", "sauce", "dressing",
      "vinegar", "soy sauce", "fish sauce", "oyster sauce", "hoisin",
      "worcestershire", "hot sauce", "sriracha", "tabasco", "bbq",
      "barbecue", "salsa", "pesto", "tapenade", "aioli", "tahini",
      "miso", "gochujang", "harissa", "chutney", "pickles", "relish",
      "marinara", "alfredo", "teriyaki", "ranch",
    ],
  },
  {
    tileId: "oils_fats",
    keywords: [
      "olive oil", "vegetable oil", "canola oil", "avocado oil",
      "sesame oil", "coconut oil", "peanut oil", "grapeseed oil",
      "sunflower oil", "neutral oil", "shortening", "lard",
    ],
  },
  {
    tileId: "sweeteners",
    keywords: [
      "honey", "maple syrup", "molasses", "agave", "brown sugar",
      "powdered sugar", "stevia", "monk fruit", "corn syrup",
    ],
  },
  {
    tileId: "nuts_seeds",
    keywords: [
      "almond", "peanut", "cashew", "walnut", "pecan", "pistachio",
      "macadamia", "hazelnut", "pine nut", "brazil nut",
      "sesame seed", "sunflower seed", "pumpkin seed", "flax seed",
      "chia seed", "hemp seed", "nut butter", "peanut butter",
      "almond butter", "tahini",
    ],
  },
  {
    tileId: "baking",
    keywords: [
      "flour", "all-purpose", "bread flour", "cake flour", "pastry flour",
      "whole wheat flour", "00 flour", "semolina", "rice flour",
      "almond flour", "coconut flour", "cornmeal", "masa", "sugar",
      "baking soda", "baking powder", "cocoa", "vanilla", "vanilla extract",
      "yeast", "cornstarch", "chocolate chip", "sprinkles",
    ],
  },
  {
    tileId: "canned_jarred",
    keywords: [
      "canned", "can of", "jarred", "jar of", "crushed tomatoes",
      "san marzano", "tomato paste", "tomato sauce", "tuna can",
      "coconut milk", "stock", "broth", "bouillon", "capers",
      "olives", "artichoke hearts", "sun dried",
    ],
  },
  {
    tileId: "cooking_alcohol",
    keywords: [
      "white wine", "red wine", "cooking wine", "vermouth", "sake",
      "mirin", "rice wine", "sherry", "marsala", "port",
    ],
  },
  {
    tileId: "drinks",
    keywords: [
      "orange juice", "apple juice", "lemonade", "sparkling water",
      "seltzer", "soda", "tonic", "almond milk", "oat milk", "soy milk",
      "plant milk", "coconut water", "coffee", "tea",
    ],
  },
];

// Fast lookup of tile priority by index.
const PRIORITY = new Map(TILE_KEYWORDS.map((t, i) => [t.tileId, i]));

/**
 * Given a user-typed name, return the tile_id that best matches —
 * null when nothing is confidently inferable. The picker renders a
 * "⭐ SUGGESTED" treatment on this tile so the user knows we have a
 * guess; tapping any other tile overrides. This is a nudge, not an
 * autopilot — never silently stamp the tile without the user picking.
 *
 * Algorithm:
 *   1. Lowercase the name
 *   2. For each (tileId, keywords) entry, find the longest keyword
 *      whose lowercased form appears as a substring of the name
 *   3. Track the (tileId, match-length) pair with the longest match
 *   4. Ties break on TILE_KEYWORDS order (earlier = more specific)
 *
 * Minimum match length = 3 chars so trivial matches ("a", "oil")
 * don't fire accidentally. Callers can raise the threshold if the
 * picker feels too suggestion-happy.
 */
export function inferTileFromName(name) {
  const lower = (name || "").toLowerCase().trim();
  if (lower.length < 3) return null;

  let best = null; // { tileId, length }
  for (const entry of TILE_KEYWORDS) {
    for (const kw of entry.keywords) {
      if (kw.length < 3) continue;
      if (!lower.includes(kw)) continue;
      if (
        best === null ||
        kw.length > best.length ||
        (kw.length === best.length && PRIORITY.get(entry.tileId) < PRIORITY.get(best.tileId))
      ) {
        best = { tileId: entry.tileId, length: kw.length };
      }
    }
  }
  return best?.tileId || null;
}
