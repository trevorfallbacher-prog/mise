// Bundled IDENTIFIED-AS food types.
//
// This is the "what kind of thing is this" taxonomy — the semantic
// identity layer, parallel to STORED IN (tiles, where it lives).
// Every pantry item can identify as exactly one type (see the hotdog-
// is-a-sandwich debate and our single-type decision in the chunk-18
// plan: USDA defaults + user overrides beats multi-type complexity).
//
// Source: WWEIA (What We Eat in America) Food Categories from the
// USDA's Food and Nutrient Database for Dietary Studies. WWEIA
// provides ~160 categories organized at the level humans actually
// think about food ("Pizza", "Sandwiches", "Cheese" — not nutrient
// profiles or gastronomic traditions). We curate the ~50 categories
// most relevant to home-kitchen pantry management; the rest (baby
// foods, infant formulas, human milk, etc.) aren't useful here.
//
// Why seed from USDA rather than invent our own:
//   * Authoritative classification — "USDA calls this a Sausage" is
//     defensible in a way "we call it a Sausage" isn't when users
//     disagree
//   * Free and permissive (USDA data is public domain)
//   * Covers the hotdog / sandwich / pizza debates already — WWEIA
//     has made the call; we inherit it as the default
//   * User types layer on top so households can override ("in our
//     house hot dogs are sandwiches") without pushing against us
//
// Shape of each type:
//   id              — stable snake_case id, prefixed 'wweia_' so
//                     it can't collide with user_type uuids
//   label           — user-facing name ("Pizza", "Cheese", "Sausages")
//   emoji           — display glyph
//   blurb           — short hint for the picker
//   defaultTileId   — where items of this type usually live. Auto-
//                     suggests STORED IN when the user picks this
//                     type; user can override. Null when it varies
//                     too much to pick one sensibly.
//   aliases         — optional list of lowercase keyword strings that
//                     infer this type. "hot dog", "frankfurter",
//                     "wiener" → Sausages type.
//   canonicalId     — optional id of a single bundled canonical
//                     ingredient (from src/data/ingredients.js) that
//                     items of this type ARE. Identity, NOT
//                     composition. "Franks Best Cheese Dogs" picks
//                     Food Category = Hot dogs → canonical_id =
//                     'hot_dog' lands on the pantry row. A recipe
//                     calling for "20 hot dogs" then matches every
//                     row where canonical_id = 'hot_dog' exactly.
//                     Composition (what's inside: sausage + bun, or
//                     beef + bun, or tofu + bun) lives on
//                     ingredient_ids[] separately — user-free to
//                     tag anything they want. Broad types
//                     (wweia_vegetables, wweia_beef) stay unannotated
//                     rather than stamp a wrong canonical on every
//                     custom entry. Null = no clean identity mapping.
//   parentId        — future nesting ("Cheese > Soft Cheese"). Unused
//                     today; included for forward-compat.

export const FOOD_TYPES = [
  // ── Dairy & eggs ────────────────────────────────────────────────
  {
    id: "wweia_cheese", label: "Cheese", emoji: "🧀",
    defaultTileId: "dairy",
    blurb: "Blocks, shreds, slices, spreads",
    aliases: ["cheese", "mozzarella", "cheddar", "provolone", "parmesan", "feta", "brie", "camembert", "ricotta", "mascarpone", "cream cheese", "pepper jack", "monterey jack", "gouda", "manchego", "blue cheese", "asiago", "cottage cheese"],
  },
  {
    id: "wweia_yogurt", label: "Yogurt", emoji: "🥣",
    defaultTileId: "dairy",
    blurb: "Greek, regular, plant-based, kefir",
    aliases: ["yogurt", "yoghurt", "kefir", "skyr"],
  },
  {
    id: "wweia_milk", label: "Milk", emoji: "🥛",
    defaultTileId: "dairy",
    blurb: "Cow, plant, flavored",
    aliases: ["milk", "almond milk", "oat milk", "soy milk", "coconut milk beverage", "half and half", "heavy cream"],
  },
  {
    id: "wweia_butter", label: "Butter & spreads", emoji: "🧈",
    defaultTileId: "dairy",
    blurb: "Butter, margarine, ghee",
    aliases: ["butter", "margarine", "ghee"],
    canonicalId: "butter",
  },
  {
    id: "wweia_eggs", label: "Eggs", emoji: "🥚",
    defaultTileId: "dairy",
    blurb: "Whole eggs, whites, substitutes",
    aliases: ["egg", "eggs", "egg whites", "egg substitute"],
    canonicalId: "eggs",
  },

  // ── Proteins ────────────────────────────────────────────────────
  {
    id: "wweia_beef", label: "Beef", emoji: "🥩",
    defaultTileId: "meat_poultry",
    blurb: "Ground, steak, roasts, cured",
    aliases: ["beef", "steak", "ground beef", "ribeye", "sirloin", "brisket", "chuck"],
  },
  {
    id: "wweia_pork", label: "Pork", emoji: "🥓",
    defaultTileId: "meat_poultry",
    blurb: "Bacon, chops, tenderloin, ground",
    aliases: ["pork", "bacon", "ham", "pork chop", "pork tenderloin", "pancetta", "prosciutto"],
  },
  {
    id: "wweia_poultry", label: "Poultry", emoji: "🍗",
    defaultTileId: "meat_poultry",
    blurb: "Chicken, turkey, duck",
    aliases: ["chicken", "turkey", "duck", "goose", "cornish hen"],
  },
  {
    id: "wweia_lamb", label: "Lamb", emoji: "🥩",
    defaultTileId: "meat_poultry",
    blurb: "Ground, chops, roasts",
    aliases: ["lamb", "mutton"],
  },
  {
    id: "wweia_hot_dogs", label: "Hot dogs", emoji: "🌭",
    defaultTileId: "meat_poultry",
    blurb: "Franks, cheese dogs, plant-based dogs",
    // Split out from wweia_sausages so "Franks Best Cheese Dogs"
    // carries the hot_dog canonical specifically — recipes calling
    // for "20 hot dogs" should find them without a runtime alias
    // fallback. Sausage links, salami, etc. stay under wweia_sausages.
    aliases: ["hot dog", "hotdog", "hot dogs", "hotdogs", "frankfurter", "wiener", "frank", "franks", "cheese dog", "cheese dogs"],
    canonicalId: "hot_dog",
  },
  {
    id: "wweia_sausages", label: "Sausages", emoji: "🌭",
    defaultTileId: "meat_poultry",
    blurb: "Sausage links, salami, pepperoni, chorizo",
    aliases: ["sausage", "bratwurst", "chorizo", "salami", "pepperoni", "kielbasa", "andouille", "italian sausage", "breakfast sausage"],
    canonicalId: "sausage",
  },
  {
    id: "wweia_fish", label: "Fish", emoji: "🐟",
    defaultTileId: "seafood",
    blurb: "Fresh, frozen, canned, smoked",
    aliases: ["fish", "salmon", "tuna", "cod", "halibut", "tilapia", "trout", "sardine", "anchovy", "mackerel"],
  },
  {
    id: "wweia_shellfish", label: "Shellfish", emoji: "🦐",
    defaultTileId: "seafood",
    blurb: "Shrimp, crab, lobster, scallops",
    aliases: ["shrimp", "prawn", "crab", "lobster", "scallops", "mussels", "clams", "oysters", "imitation crab", "surimi"],
  },
  {
    id: "wweia_legumes", label: "Legumes", emoji: "🫘",
    defaultTileId: "beans_legumes",
    blurb: "Beans, lentils, chickpeas, tofu",
    aliases: ["bean", "beans", "lentil", "chickpea", "garbanzo", "black bean", "pinto", "kidney bean", "tofu", "tempeh", "edamame"],
  },
  {
    id: "wweia_nuts_seeds", label: "Nuts & seeds", emoji: "🥜",
    defaultTileId: "nuts_seeds",
    blurb: "Whole, butters, flours",
    aliases: ["almond", "peanut", "walnut", "pecan", "cashew", "pistachio", "macadamia", "hazelnut", "pine nut", "sunflower seed", "pumpkin seed", "sesame seed", "flax", "chia"],
  },

  // ── Grains, breads, pasta ──────────────────────────────────────
  {
    id: "wweia_bread", label: "Bread", emoji: "🍞",
    defaultTileId: "bread",
    blurb: "Loaves, rolls, bagels, tortillas",
    aliases: ["bread", "loaf", "roll", "rolls", "bagel", "tortilla", "pita", "naan", "baguette", "sourdough", "ciabatta", "focaccia", "brioche", "challah", "english muffin"],
    canonicalId: "bread",
  },
  {
    id: "wweia_pasta", label: "Pasta", emoji: "🍝",
    defaultTileId: "pasta_grains",
    blurb: "Dried, fresh, stuffed",
    aliases: ["pasta", "noodle", "noodles", "ramen", "udon", "soba", "rice noodle", "rice noodles", "instant noodle", "instant noodles", "spaghetti", "penne", "rigatoni", "fettuccine", "cavatappi", "fusilli", "rotini", "farfalle", "bow-tie", "macaroni", "bucatini", "linguine", "angel hair", "ziti", "orecchiette", "tortellini", "ravioli", "gnocchi", "orzo", "lasagna"],
    // Generic 'pasta' canonical catches recipes that call for
    // "1 lb pasta" without a specific shape. Shape-specific items
    // (penne, rigatoni) already match via name-based canonical
    // picking during add; this is the brand-name/custom fallback.
    canonicalId: "pasta",
  },
  {
    id: "wweia_rice", label: "Rice", emoji: "🍚",
    defaultTileId: "pasta_grains",
    blurb: "White, brown, wild, specialty",
    aliases: ["rice", "jasmine rice", "basmati", "arborio", "brown rice", "wild rice"],
    canonicalId: "rice",
  },
  {
    id: "wweia_grains", label: "Other grains", emoji: "🌾",
    defaultTileId: "pasta_grains",
    blurb: "Quinoa, farro, oats, barley, polenta",
    aliases: ["quinoa", "farro", "barley", "oats", "oatmeal", "polenta", "cornmeal", "couscous", "bulgur", "millet", "spelt"],
  },
  {
    id: "wweia_cereal", label: "Cereal & granola", emoji: "🥣",
    defaultTileId: "pasta_grains",
    blurb: "Breakfast cereals, muesli, granola",
    aliases: ["cereal", "granola", "muesli", "cornflakes", "cheerios", "bran"],
  },
  {
    id: "wweia_crackers", label: "Crackers & chips", emoji: "🍪",
    defaultTileId: "canned_jarred",
    blurb: "Crackers, chips, pretzels, popcorn",
    aliases: ["cracker", "crackers", "chip", "chips", "pretzel", "popcorn", "tortilla chips", "corn chips", "potato chips", "ritz", "goldfish", "doritos", "tostitos", "fritos", "ruffles", "lays"],
    canonicalId: "crackers",
  },

  // ── Mixed dishes / prepared ─────────────────────────────────────
  {
    id: "wweia_pizza", label: "Pizza", emoji: "🍕",
    defaultTileId: "frozen_meals",
    blurb: "Frozen, leftover, fresh",
    aliases: ["pizza", "calzone", "stromboli"],
  },
  {
    id: "wweia_sandwiches", label: "Sandwiches", emoji: "🥪",
    defaultTileId: "bread",
    blurb: "Built sandwiches, wraps, subs",
    aliases: ["sandwich", "sub", "wrap", "hoagie", "panini", "burger"],
  },
  {
    id: "wweia_dumplings", label: "Dumplings", emoji: "🥟",
    defaultTileId: "frozen_meals",
    blurb: "Potstickers, ravioli, wontons, perogies",
    aliases: ["dumpling", "dumplings", "potsticker", "wonton", "gyoza", "pierogi", "xiao long bao"],
  },
  {
    id: "wweia_soups", label: "Soups & broths", emoji: "🍲",
    defaultTileId: "canned_jarred",
    blurb: "Canned, cartoned, homemade leftovers",
    aliases: ["soup", "broth", "stock", "bouillon", "chowder", "bisque", "chili"],
  },
  {
    id: "wweia_frozen_meals", label: "Frozen meals", emoji: "🥡",
    defaultTileId: "frozen_meals",
    blurb: "TV dinners, microwave meals, burritos",
    aliases: ["frozen meal", "tv dinner", "frozen dinner", "hot pocket", "microwave meal", "frozen burrito", "frozen lasagna"],
  },
  {
    id: "wweia_leftovers", label: "Leftovers", emoji: "🍱",
    defaultTileId: "leftovers",
    blurb: "Cooked meals saved for later",
    aliases: ["leftover", "leftovers"],
  },

  // ── Produce ─────────────────────────────────────────────────────
  {
    id: "wweia_vegetables", label: "Vegetables", emoji: "🥦",
    defaultTileId: "produce",
    blurb: "Fresh, frozen, canned",
    aliases: ["vegetable", "broccoli", "cauliflower", "carrot", "celery", "onion", "garlic", "potato", "spinach", "kale", "lettuce", "arugula", "cucumber", "zucchini", "squash", "pumpkin", "eggplant", "mushroom", "asparagus", "cabbage", "leek", "fennel", "radish", "beet", "corn"],
  },
  {
    id: "wweia_fruits", label: "Fruits", emoji: "🍎",
    defaultTileId: "produce",
    blurb: "Fresh, frozen, dried, canned",
    aliases: ["fruit", "apple", "banana", "orange", "grape", "berry", "blueberries", "strawberries", "raspberries", "mango", "pineapple", "melon", "peach", "pear", "plum", "cherry"],
  },
  {
    id: "wweia_tomatoes", label: "Tomatoes", emoji: "🍅",
    defaultTileId: "produce",
    blurb: "Fresh, canned, paste, sauces",
    aliases: ["tomato", "cherry tomato", "roma tomato", "sun-dried tomato", "canned tomato", "tomato paste", "tomato sauce", "marinara"],
    canonicalId: "tomato",
  },
  {
    id: "wweia_green_onions", label: "Green onions", emoji: "🌱",
    defaultTileId: "produce",
    // Split out from wweia_vegetables — green onions / scallions get
    // called out in recipes so often ("20 scallions chopped") that
    // they earn their own canonical bridge.
    blurb: "Scallions, spring onions",
    aliases: ["green onion", "green onions", "scallion", "scallions", "spring onion", "spring onions"],
    canonicalId: "green_onion",
  },
  {
    id: "wweia_herbs_fresh", label: "Fresh herbs", emoji: "🌿",
    defaultTileId: "fresh_herbs",
    blurb: "Basil, parsley, cilantro, mint",
    aliases: ["fresh basil", "fresh parsley", "fresh cilantro", "fresh mint", "fresh dill", "fresh thyme", "fresh rosemary", "fresh chives"],
  },
  {
    id: "wweia_chilies", label: "Chilies & peppers", emoji: "🌶️",
    defaultTileId: "produce",
    blurb: "Fresh, dried, pickled, powdered",
    aliases: ["bell pepper", "jalapeño", "serrano", "habanero", "poblano", "chili", "chile", "ancho", "guajillo", "chipotle", "árbol"],
  },

  // ── Pantry staples ──────────────────────────────────────────────
  {
    id: "wweia_flour", label: "Flour", emoji: "🌾",
    defaultTileId: "baking",
    blurb: "AP, bread, whole wheat, specialty",
    aliases: ["flour", "all-purpose", "bread flour", "cake flour", "pastry flour", "whole wheat flour", "00 flour", "semolina", "rice flour", "almond flour", "coconut flour", "cornmeal", "masa"],
    // Default to the most common flour; specific flour types are
    // usually matched at add-time via the canonical registry.
    canonicalId: "flour",
  },
  {
    id: "wweia_sugars", label: "Sugars & sweeteners", emoji: "🍯",
    defaultTileId: "sweeteners",
    blurb: "Granulated, brown, powdered, honey, syrup",
    aliases: ["sugar", "brown sugar", "powdered sugar", "honey", "maple syrup", "molasses", "agave", "stevia", "monk fruit"],
    canonicalId: "sugar",
  },
  {
    // Catch-all for the baking drawer beyond flour + sugar.
    // Covers leaveners (yeast, baking powder / soda), extracts
    // (vanilla, almond), thickeners (cornstarch, cream of tartar),
    // and flavor/decor (cocoa powder, chocolate chips, sprinkles,
    // food coloring). Vanilla extract technically parses as an
    // alcohol but no one looks for it there — user executive call:
    // it lives here.
    id: "wweia_baking_essentials", label: "Baking essentials", emoji: "🧁",
    defaultTileId: "baking",
    blurb: "Leaveners, extracts, cocoa, cornstarch, chips",
    aliases: [
      "yeast", "active dry yeast", "instant yeast", "sourdough starter",
      "baking powder", "baking soda",
      "vanilla extract", "almond extract", "lemon extract", "peppermint extract",
      "cornstarch", "corn starch", "arrowroot", "cream of tartar",
      "cocoa powder", "cacao powder", "baking chocolate",
      "chocolate chip", "chocolate chips", "sprinkles", "food coloring",
    ],
  },
  {
    id: "wweia_oils", label: "Oils", emoji: "🫗",
    defaultTileId: "oils_fats",
    blurb: "Cooking, finishing, specialty",
    aliases: ["olive oil", "vegetable oil", "canola oil", "avocado oil", "sesame oil", "coconut oil", "peanut oil", "grapeseed oil"],
    canonicalId: "olive_oil",
  },
  {
    id: "wweia_vinegars", label: "Vinegars", emoji: "🫙",
    defaultTileId: "condiments_sauces",
    blurb: "Balsamic, red wine, rice, apple cider",
    aliases: ["vinegar", "balsamic", "red wine vinegar", "white vinegar", "apple cider vinegar", "rice vinegar", "sherry vinegar"],
  },
  {
    id: "wweia_spices", label: "Spices & dried herbs", emoji: "🧂",
    defaultTileId: "spices_dried_herbs",
    blurb: "Salts, peppers, ground, whole, blends",
    aliases: ["salt", "pepper", "peppercorn", "paprika", "cumin", "coriander", "oregano", "thyme", "rosemary", "basil", "bay leaf", "cinnamon", "nutmeg", "cloves", "cardamom", "turmeric", "chili powder", "cayenne", "garlic powder", "onion powder", "italian seasoning", "curry powder"],
  },
  // ── Condiments & sauces (split into specific types so brand
  //    variants wrap up usefully — "all my mayos" is the right
  //    drawer view, "all my condiments" is too broad) ────────────
  {
    id: "wweia_mayo", label: "Mayo", emoji: "🥚",
    defaultTileId: "condiments_sauces",
    blurb: "Hellmann's, Duke's, Kewpie, aioli, homemade",
    aliases: ["mayo", "mayonnaise", "miracle whip", "kewpie", "hellmann", "hellmanns", "duke's", "dukes", "aioli", "japanese mayo"],
    canonicalId: "mayo",
  },
  {
    id: "wweia_ketchup", label: "Ketchup", emoji: "🍅",
    defaultTileId: "condiments_sauces",
    blurb: "Heinz, curry ketchup, fancy ketchup",
    aliases: ["ketchup", "catsup", "tomato ketchup", "heinz ketchup", "curry ketchup", "banana ketchup", "mushroom ketchup"],
    canonicalId: "ketchup",
  },
  {
    id: "wweia_mustard", label: "Mustard", emoji: "🌭",
    defaultTileId: "condiments_sauces",
    blurb: "Dijon, yellow, whole-grain, honey mustard",
    aliases: ["mustard", "dijon", "yellow mustard", "brown mustard", "honey mustard", "whole grain mustard", "grainy mustard", "english mustard", "spicy brown"],
    canonicalId: "mustard",
  },
  {
    id: "wweia_hot_sauce", label: "Hot sauce", emoji: "🌶️",
    defaultTileId: "condiments_sauces",
    blurb: "Sriracha, Tabasco, Cholula, Frank's, sambal, harissa, gochujang",
    aliases: ["hot sauce", "sriracha", "tabasco", "cholula", "franks", "frank's", "tapatio", "crystal hot sauce", "sambal", "sambal oelek", "harissa", "gochujang", "chili oil", "chili crisp", "lao gan ma", "valentina", "yucateco"],
    canonicalId: "hot_sauce",
  },
  {
    id: "wweia_bbq_sauce", label: "BBQ sauce", emoji: "🍖",
    defaultTileId: "condiments_sauces",
    blurb: "Sweet Baby Ray's, Stubb's, Carolina, Kansas City",
    aliases: ["bbq", "bbq sauce", "barbecue", "barbecue sauce", "sweet baby rays", "sweet baby ray's", "stubbs", "stubb's", "open pit", "bullseye", "kraft bbq"],
  },
  {
    id: "wweia_soy_sauce", label: "Soy sauce", emoji: "🍜",
    defaultTileId: "condiments_sauces",
    blurb: "Shoyu, tamari, dark soy, light soy",
    aliases: ["soy sauce", "shoyu", "tamari", "kikkoman", "dark soy", "light soy", "low sodium soy", "thin soy", "thick soy"],
    canonicalId: "soy_sauce",
  },
  {
    id: "wweia_fish_sauce", label: "Fish sauce", emoji: "🐟",
    defaultTileId: "condiments_sauces",
    blurb: "Nam pla, Red Boat, Three Crabs",
    aliases: ["fish sauce", "nam pla", "red boat", "three crabs", "nuoc mam", "colatura"],
    canonicalId: "fish_sauce",
  },
  {
    id: "wweia_asian_sauces", label: "Asian sauces", emoji: "🥢",
    defaultTileId: "condiments_sauces",
    blurb: "Oyster, hoisin, teriyaki, char siu, plum, duck sauce",
    aliases: ["oyster sauce", "hoisin", "teriyaki", "char siu", "plum sauce", "duck sauce", "sweet chili", "sweet chili sauce", "ponzu", "sushi soy", "eel sauce", "unagi sauce", "black bean sauce", "xo sauce", "ketjap manis"],
  },
  {
    id: "wweia_salsa", label: "Salsa", emoji: "🫑",
    defaultTileId: "condiments_sauces",
    blurb: "Pico, verde, rojo, chipotle",
    aliases: ["salsa", "pico de gallo", "salsa verde", "salsa rojo", "salsa roja", "chipotle salsa", "restaurant style salsa"],
  },
  {
    id: "wweia_pesto", label: "Pesto", emoji: "🌿",
    defaultTileId: "condiments_sauces",
    blurb: "Genovese, jarred, homemade",
    aliases: ["pesto", "genovese pesto", "pesto alla genovese", "sun-dried tomato pesto", "arugula pesto"],
    canonicalId: "pesto",
  },
  {
    id: "wweia_salad_dressing", label: "Salad dressing", emoji: "🥗",
    defaultTileId: "condiments_sauces",
    blurb: "Ranch, Caesar, Italian, vinaigrette, blue cheese",
    aliases: ["ranch", "caesar", "caesar dressing", "italian dressing", "vinaigrette", "thousand island", "blue cheese dressing", "french dressing", "russian dressing", "honey mustard dressing", "green goddess"],
  },
  {
    id: "wweia_miso", label: "Miso", emoji: "🍲",
    defaultTileId: "condiments_sauces",
    blurb: "Red, white, shiro, aka",
    aliases: ["miso", "shiro miso", "aka miso", "red miso", "white miso", "awase miso"],
    canonicalId: "miso",
  },
  {
    id: "wweia_worcestershire", label: "Worcestershire", emoji: "🫙",
    defaultTileId: "condiments_sauces",
    blurb: "Lea & Perrins and knockoffs",
    aliases: ["worcestershire", "lea and perrins", "lea & perrins"],
  },
  {
    id: "wweia_tahini", label: "Tahini", emoji: "🫙",
    defaultTileId: "condiments_sauces",
    blurb: "Sesame paste, for hummus + dressings",
    aliases: ["tahini", "sesame paste", "soom", "al kanater"],
  },
  {
    id: "wweia_other_sauces", label: "Other sauces & condiments", emoji: "🥫",
    defaultTileId: "condiments_sauces",
    blurb: "Catch-all for anything that doesn't fit the specific types",
    aliases: ["chutney", "relish", "marmalade", "jam", "preserves", "dipping sauce", "cocktail sauce", "tartar sauce", "horseradish", "wasabi"],
  },
  {
    id: "wweia_canned_goods", label: "Canned goods", emoji: "🥫",
    defaultTileId: "canned_jarred",
    blurb: "Beans, tomatoes, soups, tuna, coconut milk",
    aliases: ["canned", "can of", "jarred", "jar of", "coconut milk", "capers", "olives", "artichoke hearts"],
  },
  {
    id: "wweia_pickles", label: "Pickles & ferments", emoji: "🥒",
    defaultTileId: "condiments_sauces",
    blurb: "Pickles, kimchi, sauerkraut, relish",
    aliases: ["pickle", "pickles", "kimchi", "sauerkraut", "relish", "chutney", "pickled"],
  },

  // ── Beverages ───────────────────────────────────────────────────
  {
    id: "wweia_coffee_tea", label: "Coffee & tea", emoji: "☕",
    defaultTileId: "drinks",
    blurb: "Beans, grounds, bags, loose leaf",
    aliases: ["coffee", "espresso", "tea", "matcha", "chai"],
  },
  {
    id: "wweia_juices", label: "Juices & soft drinks", emoji: "🧃",
    defaultTileId: "drinks",
    blurb: "OJ, apple juice, soda, sparkling water",
    aliases: ["juice", "soda", "sparkling water", "seltzer", "tonic", "lemonade"],
  },
  {
    id: "wweia_alcohol", label: "Cooking alcohol", emoji: "🍷",
    defaultTileId: "cooking_alcohol",
    blurb: "Wine, vermouth, sake, mirin — for cooking",
    aliases: ["cooking wine", "white wine", "red wine", "vermouth", "sake", "mirin", "rice wine", "sherry", "marsala"],
  },

  // ── Sweets & desserts ──────────────────────────────────────────
  {
    id: "wweia_candy", label: "Candy", emoji: "🍬",
    defaultTileId: "sweeteners",
    blurb: "Chocolate, gummies, hard candy",
    aliases: ["candy", "chocolate", "chocolate chip", "gummy", "sprinkles", "m&m"],
  },
  {
    id: "wweia_baked_sweets", label: "Baked sweets", emoji: "🍰",
    defaultTileId: "bread",
    blurb: "Cakes, cookies, pastries, muffins",
    aliases: ["cake", "cookie", "cookies", "pastry", "muffin", "donut", "brownie", "pie"],
  },
  {
    id: "wweia_ice_cream", label: "Ice cream & frozen desserts", emoji: "🍦",
    defaultTileId: "frozen_meals",
    blurb: "Pints, bars, sorbet, gelato",
    aliases: ["ice cream", "sorbet", "gelato", "popsicle", "frozen yogurt"],
  },
];

// Fast id lookup.
const typesById = new Map(FOOD_TYPES.map(t => [t.id, t]));

export function findFoodType(id) {
  if (!id) return null;
  return typesById.get(id) || null;
}

/**
 * Infer the most-likely bundled FOOD_TYPE from a user-typed name.
 * Longest-matching alias wins; ties break on FOOD_TYPES order so
 * more specific types earlier in the list get preference over
 * broader ones. Returns the type's id or null.
 *
 * Example:
 *   "Home Run Inn Pizza" -> "wweia_pizza" (alias "pizza")
 *   "Hellman's Mayo"     -> "wweia_mayo" (alias "mayo" beats shorter)
 *   "Cavatappi Pasta"    -> "wweia_pasta" (alias "pasta" OR "cavatappi")
 *   "some random text"   -> null
 *
 * Minimum alias length = 3 chars so "oil" triggers wweia_oils but
 * trivial matches like "a" don't fire.
 */
/**
 * Return the canonical ingredient id a bundled WWEIA type maps to,
 * or null when the type has no clean identity mapping (broad buckets
 * like "Vegetables" or "Beef"). Identity, not composition — this
 * lands on pantry_items.canonical_id so a recipe calling for
 * "20 hot dogs" matches every row where canonical_id = 'hot_dog'
 * exactly. Composition (sausage + bun, or beef + bun, or tofu + bun)
 * lives on ingredient_ids[] and stays user-free.
 *
 * Takes a typeId string (bundled slug OR user-type uuid). User-type
 * uuids return null today — the user_types table doesn't carry a
 * canonical bridge yet (tracked in backlog for a future migration).
 * Null / unknown ids also return null.
 */
export function canonicalIdForType(typeId) {
  if (!typeId) return null;
  const t = typesById.get(typeId);
  return t && t.canonicalId ? t.canonicalId : null;
}

// Reverse of canonicalIdForType — given a canonical ingredient
// (bundled OR synthetic / user-minted) return the best-fit WWEIA
// food type. Two-pass:
//   1. Exact match on FOOD_TYPES[].canonicalId. Covers bundled
//      canonicals with clean 1:1 identity mappings
//      (mayo, ketchup, hot_dog, pizza, olive_oil, …).
//   2. Alias infer on the canonical's name — catches synthetic
//      canonicals ("apple cider vinegar" → wweia_vinegars via
//      the "vinegar" alias) and bundled canonicals without an
//      explicit canonicalId bridge ("cheddar" → wweia_cheese).
// Feeds the AddItemModal cascade so the second a canonical is
// chosen, CATEGORY auto-pins without the user tapping it.
const canonicalIdToType = (() => {
  const m = new Map();
  for (const t of FOOD_TYPES) {
    if (t.canonicalId && !m.has(t.canonicalId)) m.set(t.canonicalId, t.id);
  }
  return m;
})();
export function typeIdForCanonical(canonical) {
  if (!canonical) return null;
  const id = typeof canonical === "string" ? canonical : canonical.id;
  if (id && canonicalIdToType.has(id)) return canonicalIdToType.get(id);
  const name = typeof canonical === "string" ? id : canonical.name;
  return inferFoodTypeFromName(name);
}

export function inferFoodTypeFromName(name) {
  const lower = (name || "").toLowerCase().trim();
  if (lower.length < 3) return null;
  let best = null;
  let bestLen = 0;
  let bestIdx = Infinity;
  FOOD_TYPES.forEach((t, idx) => {
    for (const alias of t.aliases || []) {
      if (alias.length < 3) continue;
      if (!lower.includes(alias)) continue;
      if (alias.length > bestLen ||
          (alias.length === bestLen && idx < bestIdx)) {
        best = t.id;
        bestLen = alias.length;
        bestIdx = idx;
      }
    }
  });
  return best;
}
