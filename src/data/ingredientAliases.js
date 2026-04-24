// ─────────────────────────────────────────────────────────────────────────────
// Ingredient alias registry — strong / weak / blocked tiers for
// deterministic raw-text → canonical_id resolution. Used by
// src/lib/resolveIngredient.js (imported by both the browser client
// and the generate-recipe edge function).
//
// Sibling to CANONICAL_ALIASES in src/data/ingredients.js. That table
// handles LEGACY SLUG redirects (migrations 0060 / 0122 — ground_beef
// → beef + state=ground). This table handles RAW-TEXT aliases from AI
// recipes, free-text notes, and user-typed names, with explicit
// confidence tiers and context disambiguation.
//
// All canonical ids referenced here must exist in INGREDIENTS or HUBS
// in src/data/ingredients.js. The resolver falls back to a hub id
// when raw text has no canonical peer at all.
// ─────────────────────────────────────────────────────────────────────────────

// Strong — exact 1:1 mappings that are safe in every context.
// Keys are lowercased normalized raw text.
export const STRONG_ALIASES = {
  parm: "parmesan",
  parma: "parmesan",
  parmigiano: "parmesan",
  "parmigiano reggiano": "parmesan",
  "pecorino romano": "pecorino",
  evoo: "olive_oil",
  "extra virgin olive oil": "olive_oil",
  "greek yoghurt": "greek_yogurt",
  yoghurt: "yogurt",
  coriander: "cilantro",
  "coriander leaves": "cilantro",
  scallion: "green_onion",
  scallions: "green_onion",
  "spring onion": "green_onion",
  "spring onions": "green_onion",
  "all purpose flour": "flour",
  "all-purpose flour": "flour",
  ap: "flour",
  "ap flour": "flour",
  "plain flour": "flour",
  jumbo: "eggs",
  egg: "eggs",
  prawns: "shrimp",
  prawn: "shrimp",
  "spring chicken": "chicken",
  "chicken breasts": "chicken_breast",
  "chicken thighs": "chicken_thigh",
  "boneless skinless chicken breast": "chicken_breast",
  "boneless skinless chicken thighs": "chicken_thigh",
  "new york strip": "ny_strip",
  "new-york strip": "ny_strip",
  strip: "ny_strip",
  "chuck": "chuck_roast",
  "kewpie": "mayo",
  "mayonnaise": "mayo",
  tamari: "soy_sauce",
  shoyu: "soy_sauce",
  "bell peppers": "bell_pepper",
  "red pepper": "bell_pepper",
  "green pepper": "bell_pepper",
  cuke: "cucumber",
  cukes: "cucumber",
};

// Weak — ambiguous head nouns. On their own they resolve to
// `defaultCanonical`, but CONTEXT_PRIORS can push them to a different
// candidate when recipe signals fire.
export const WEAK_ALIASES = {
  butter: {
    candidates: ["butter", "peanut_butter"],
    defaultCanonical: "butter",
  },
  cream: {
    candidates: ["heavy_cream", "sour_cream", "cream_cheese"],
    defaultCanonical: "heavy_cream",
  },
  cheese: {
    candidates: ["cheddar", "mozzarella", "parmesan", "cream_cheese", "cheese_hub"],
    defaultCanonical: "cheese_hub",
  },
  milk: {
    candidates: ["milk", "almond_milk", "oat_milk"],
    defaultCanonical: "milk",
  },
  flour: {
    candidates: ["flour", "almond_flour", "coconut_flour", "rice_flour", "bread_flour", "cake_flour"],
    defaultCanonical: "flour",
  },
  sugar: {
    candidates: ["sugar"],
    defaultCanonical: "sugar",
  },
  rice: {
    candidates: ["rice", "basmati_rice", "jasmine_rice", "brown_rice", "arborio_rice"],
    defaultCanonical: "rice",
  },
  pasta: {
    candidates: ["pasta", "spaghetti", "penne", "fettuccine", "linguine"],
    defaultCanonical: "pasta_hub",
  },
  wine: {
    candidates: ["red_wine", "white_wine"],
    defaultCanonical: "red_wine",
  },
  oil: {
    candidates: ["olive_oil"],
    defaultCanonical: "olive_oil",
  },
  onion: {
    candidates: ["yellow_onion", "shallot", "pearl_onion", "green_onion"],
    defaultCanonical: "yellow_onion",
  },
  pepper: {
    candidates: ["bell_pepper"],
    defaultCanonical: "bell_pepper",
  },
  chicken: {
    // "chicken" alone in a recipe usually means breast meat, but
    // dish context (soup, stock, roast) can push toward the whole
    // bird canonical or a different cut.
    candidates: ["chicken", "chicken_breast", "chicken_thigh", "ground_chicken"],
    defaultCanonical: "chicken",
  },
  beef: {
    candidates: ["beef", "ground_beef", "ribeye", "sirloin", "brisket", "chuck_roast"],
    defaultCanonical: "beef",
  },
  pork: {
    candidates: ["pork", "ground_pork", "pork_chop", "pork_loin", "pork_shoulder"],
    defaultCanonical: "pork",
  },
  yogurt: {
    candidates: ["yogurt", "greek_yogurt"],
    defaultCanonical: "yogurt",
  },
};

// Blocked — raw-text phrases that must NEVER resolve to the listed
// canonical ids. Complements HEAD_NOUN_MODIFIER_EXCLUSIONS in
// src/data/ingredients.js (which is a per-token guard inside
// scoreIngredientMatch); this table operates at the phrase level
// BEFORE fuzzy scoring runs, and also overrides an already-claimed
// canonicalId when it contradicts the raw text.
//
// Shape: { [rawPhrase]: { forbid: string[], redirectTo: string } }
// `redirectTo` must be a real canonical id — resolver short-circuits
// to it at high confidence when the phrase fires.
export const BLOCKED_ALIASES = {
  "peanut butter":  { forbid: ["butter"],                      redirectTo: "peanut_butter" },
  "almond butter":  { forbid: ["butter", "peanut_butter"],     redirectTo: "peanut_butter" },
  "cashew butter":  { forbid: ["butter", "peanut_butter"],     redirectTo: "peanut_butter" },
  "apple butter":   { forbid: ["butter"],                      redirectTo: "butter" }, // fall back until apple_butter exists
  "almond milk":    { forbid: ["milk"],                        redirectTo: "almond_milk" },
  "oat milk":       { forbid: ["milk"],                        redirectTo: "oat_milk" },
  "coconut milk":   { forbid: ["milk", "almond_milk", "oat_milk"], redirectTo: "milk" },
  "soy milk":       { forbid: ["milk"],                        redirectTo: "almond_milk" },
  "sour cream":     { forbid: ["heavy_cream"],                 redirectTo: "sour_cream" },
  "ice cream":      { forbid: ["heavy_cream", "sour_cream"],   redirectTo: "heavy_cream" },
  "whipped cream":  { forbid: ["sour_cream"],                  redirectTo: "heavy_cream" },
  "cream cheese":   { forbid: ["heavy_cream", "sour_cream", "cheddar", "mozzarella"], redirectTo: "cream_cheese" },
  "baking soda":    { forbid: ["flour"],                       redirectTo: "flour" }, // no baking_soda canonical yet — hub fallback
  "baking powder":  { forbid: ["flour"],                       redirectTo: "flour" },
  "club soda":      { forbid: [],                              redirectTo: "white_wine" },
  "brown sugar":    { forbid: [],                              redirectTo: "sugar" },
  "powdered sugar": { forbid: [],                              redirectTo: "sugar" },
  "cocoa powder":   { forbid: ["flour"],                       redirectTo: "flour" },
  "almond flour":   { forbid: ["flour"],                       redirectTo: "almond_flour" },
  "coconut flour":  { forbid: ["flour"],                       redirectTo: "coconut_flour" },
  "rice flour":     { forbid: ["flour"],                       redirectTo: "rice_flour" },
  "bread flour":    { forbid: ["flour"],                       redirectTo: "bread_flour" },
  "cake flour":     { forbid: ["flour"],                       redirectTo: "cake_flour" },
  "rose water":     { forbid: [],                              redirectTo: "milk" }, // no rose_water canonical — weak fallback
  "coconut water":  { forbid: [],                              redirectTo: "oat_milk" },
};

// Context priors — when a WEAK_ALIASES key fires, these rules push
// the result toward a specific candidate. Each rule has a `when`
// predicate (any field matching triggers a vote) and a `prefer`
// target. Rules are evaluated in order; the prefer-count decides.
//
// Signals:
//   cooccurs:    substring match in context.coIngredients[]
//   dishFamily:  substring match in context.dishContract.familyName
//                or context.dishContract.dishName
//   titleTokens: substring match in context.recipeTitle
//
// The resolver also layers context.historicalMatches (rawText →
// canonical_id from prior successful resolves) on top of these
// rules — a historical hit counts as two votes.
export const CONTEXT_PRIORS = {
  butter: [
    { when: { cooccurs: ["peanut", "jelly", "banana"] }, prefer: "peanut_butter" },
    { when: { titleTokens: ["peanut"] },                 prefer: "peanut_butter" },
    { when: { dishFamily: ["cookie", "cake", "pastry", "biscuit", "scone"] }, prefer: "butter" },
    { when: { cooccurs: ["flour", "sugar", "egg", "milk"] }, prefer: "butter" },
  ],
  cream: [
    { when: { titleTokens: ["sour"] },                   prefer: "sour_cream" },
    { when: { cooccurs: ["taco", "burrito", "nacho", "salsa"] }, prefer: "sour_cream" },
    { when: { dishFamily: ["cheesecake"] },              prefer: "cream_cheese" },
    { when: { titleTokens: ["bagel"] },                  prefer: "cream_cheese" },
    { when: { cooccurs: ["bagel"] },                     prefer: "cream_cheese" },
  ],
  cheese: [
    { when: { dishFamily: ["pizza", "lasagna", "caprese"] }, prefer: "mozzarella" },
    { when: { titleTokens: ["pizza", "lasagna", "caprese"] }, prefer: "mozzarella" },
    { when: { dishFamily: ["mac and cheese", "quesadilla", "grilled cheese"] }, prefer: "cheddar" },
    { when: { dishFamily: ["carbonara", "cacio e pepe", "risotto"] }, prefer: "parmesan" },
    { when: { titleTokens: ["cheesecake"] },             prefer: "cream_cheese" },
  ],
  milk: [
    { when: { titleTokens: ["oat"] },                    prefer: "oat_milk" },
    { when: { titleTokens: ["almond"] },                 prefer: "almond_milk" },
  ],
  flour: [
    { when: { titleTokens: ["almond"] },                 prefer: "almond_flour" },
    { when: { titleTokens: ["coconut"] },                prefer: "coconut_flour" },
    { when: { titleTokens: ["rice"] },                   prefer: "rice_flour" },
    { when: { dishFamily: ["bread", "pizza"] },          prefer: "bread_flour" },
    { when: { dishFamily: ["cake", "cupcake"] },         prefer: "cake_flour" },
  ],
  rice: [
    { when: { dishFamily: ["thai", "indian", "biryani"] }, prefer: "basmati_rice" },
    { when: { dishFamily: ["risotto"] },                 prefer: "arborio_rice" },
    { when: { dishFamily: ["sushi"] },                   prefer: "jasmine_rice" },
  ],
  pasta: [
    { when: { titleTokens: ["spaghetti"] },              prefer: "spaghetti" },
    { when: { titleTokens: ["fettuccine"] },             prefer: "fettuccine" },
    { when: { titleTokens: ["penne"] },                  prefer: "penne" },
    { when: { titleTokens: ["linguine"] },               prefer: "linguine" },
  ],
  wine: [
    { when: { titleTokens: ["marsala", "burgundy", "chianti", "cabernet", "merlot"] }, prefer: "red_wine" },
    { when: { titleTokens: ["chardonnay", "riesling", "sauvignon"] }, prefer: "white_wine" },
    { when: { dishFamily: ["beef", "braise", "stew"] },  prefer: "red_wine" },
    { when: { dishFamily: ["chicken", "fish", "seafood"] }, prefer: "white_wine" },
  ],
  chicken: [
    { when: { dishFamily: ["stock", "broth", "soup"] },  prefer: "chicken" },
    { when: { dishFamily: ["marsala", "piccata", "parmesan"] }, prefer: "chicken_breast" },
    { when: { titleTokens: ["thigh"] },                  prefer: "chicken_thigh" },
    { when: { titleTokens: ["wing"] },                   prefer: "chicken_wing" },
    { when: { titleTokens: ["ground"] },                 prefer: "ground_chicken" },
  ],
  beef: [
    { when: { titleTokens: ["ground", "burger", "meatball", "taco", "chili"] }, prefer: "ground_beef" },
    { when: { titleTokens: ["steak", "grilled"] },       prefer: "ribeye" },
    { when: { titleTokens: ["brisket"] },                prefer: "brisket" },
    { when: { dishFamily: ["stew", "braise", "pot roast"] }, prefer: "chuck_roast" },
  ],
  pork: [
    { when: { titleTokens: ["chop"] },                   prefer: "pork_chop" },
    { when: { titleTokens: ["loin"] },                   prefer: "pork_loin" },
    { when: { titleTokens: ["pulled", "carnitas", "shoulder"] }, prefer: "pork_shoulder" },
    { when: { titleTokens: ["ground", "meatball"] },     prefer: "ground_pork" },
  ],
};

// Required-ingredient contract seeds — the minimum canonical set a
// named dish MUST contain. The classifier also emits these, but
// seeding known dishes here gives the server a deterministic
// fallback when the classifier hasn't enumerated them yet. Dish
// name matching is a case-insensitive substring test.
//
// Keep this list intentionally small — only dishes where missing a
// listed canonical makes the recipe plainly wrong (the chicken-marsala
// problem). Overly aggressive entries force retries on legitimate
// creative variations.
export const REQUIRED_INGREDIENTS_BY_DISH = {
  "chicken marsala":    ["chicken"],
  "chicken piccata":    ["chicken"],
  "chicken parmesan":   ["chicken", "parmesan"],
  "chicken parmigiana": ["chicken", "parmesan"],
  "beef stroganoff":    ["beef"],
  "beef wellington":    ["beef"],
  "pork chop":          ["pork"],
  "carbonara":          ["pasta_hub", "eggs"],
  "cacio e pepe":       ["pasta_hub", "pecorino"],
  "risotto":            ["arborio_rice"],
  "lasagna":            ["pasta_hub"],
  "mac and cheese":     ["pasta_hub", "cheddar"],
  "shrimp scampi":      ["shrimp"],
  "fish tacos":         ["tortillas"],
  "bolognese":          ["ground_beef"],
  "pad thai":           ["rice_noodles"],
};
