// Canonical ingredient registry.
//
// Every pantry item and every recipe ingredient that needs pantry tracking
// points at an `id` in this list. That gives us:
//   - one source of truth for name + emoji + category
//   - a defined set of units per ingredient (so the user isn't guessing "is
//     sticks spelled 'stick' or 'sticks'?")
//   - unit conversion (`toBase` factor) so the recipe's "2 tbsp butter" can
//     be checked against the pantry's "1.5 sticks butter".
//
// Base units by convention:
//   - mass:    grams (g)
//   - volume:  milliliters (ml)
//   - count:   units (eggs, cloves, slices, lemons)
//
// Add a new ingredient here and it's automatically available in the AddItem
// modal and can be referenced from any recipe.
//
// ─────────────────────────────────────────────────────────────────────────
// Rich display metadata lives in INGREDIENT_INFO (further down in the
// file). Each ingredient can optionally carry:
//
//   ── Cooking-centric ──────────────────────────────────────────────────
//   description:   short prose ("Italian hard cheese aged 12–36 months…")
//   flavorProfile: compact taste descriptor ("Nutty, savory, umami…")
//   prepTips:      one-line kitchen advice ("Grate just before use")
//   storage: {
//     location:     "fridge" | "pantry" | "freezer"
//     shelfLifeDays:number (approximate; use the loosely-safe number)
//     tips:         "…"    (optional, e.g. "Wrap in parchment, not plastic")
//   }
//   substitutions: [{ id: "pecorino", note: "Sharper, 1:1" }, …]
//   pairs:         [otherIngredientId, …]  — classic complements
//   clashes:       [otherIngredientId, …]  — classic conflicts (rare)
//
//   ── Nutrition (approximate, per reference serving) ───────────────────
//   nutrition: {
//     per:       "100g" | "serving" | "count"
//     kcal, protein_g, fat_g, carb_g
//     fiber_g, sodium_mg  (both optional)
//   }
//
//   ── Social / cultural ────────────────────────────────────────────────
//   origin:        "Lazio, Italy"
//   culturalNotes: "…"          — the story, history, tradition
//   winePairings:  ["Chardonnay", …]
//   recipes:       ["Cacio e Pepe", …]  — classic preparations
//
//   ── Sourcing / allergens / seasonality ───────────────────────────────
//   allergens:     ["dairy","gluten","nut","egg","shellfish","soy","sesame"]
//   seasonality:   { peakMonths: [5,6,7,8] }  — 1..12
//   sourcing:      "Look for grass-fed / wild-caught / …"
//
// Every field is optional — populated fields render their own section on
// the IngredientCard; empty fields fall back to SUBCATEGORY_INFO defaults
// (cheese subcategories especially), then to nothing.
// ─────────────────────────────────────────────────────────────────────────

// Shared unit ladder for the long tail of cheese varieties. Specialty
// cheeses we track individually (parmesan wedges, mozz balls, feta blocks,
// cream cheese bricks, goat cheese logs) keep their bespoke units above —
// this preset is just the "here's a hunk of cheese, price it by weight"
// shape used by everything in `cheeseMembers(…)` below.
const CHEESE_STANDARD_UNITS = [
  { id: "oz",    label: "oz",     toBase: 28.35 },
  { id: "lb",    label: "lb",     toBase: 453.6 },
  { id: "wedge", label: "wedges", toBase: 226 },  // ~8oz wedge
  { id: "g",     label: "g",      toBase: 1 },
];

// Compact builder for the cheese hub. Tuples are:
//   [id, name, shortName, defaultUnit, estCentsPerGram]
// The `subcategory` label is threaded onto every member so the Cheese
// drill-down can group them by tradition (Fresh / Soft Ripened / Blue /…).
// estCentsPerGram lets the pantry estimate a $ total when the user adds
// without a receipt — a rough retail-per-lb ÷ 453.6.
function cheeseMembers(subcategory, rows) {
  return rows.map(([id, name, shortName, defaultUnit, estCentsPerBase]) => ({
    id, name, shortName, subcategory,
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: CHEESE_STANDARD_UNITS,
    defaultUnit,
    estCentsPerBase,
  }));
}

export const INGREDIENTS = [
  // ── dairy / eggs ────────────────────────────────────────────────────────
  {
    id: "eggs", name: "Eggs", emoji: "🥚", category: "dairy",
    units: [
      { id: "count", label: "eggs",   toBase: 1 },
      { id: "dozen", label: "dozen",  toBase: 12 },
    ],
    defaultUnit: "count",
    estCentsPerBase: 45, // ~$5.40/dozen
  },
  {
    id: "butter", name: "Unsalted Butter", emoji: "🧈", category: "dairy",
    units: [
      { id: "stick", label: "sticks", toBase: 113 },
      { id: "tbsp",  label: "tbsp",   toBase: 14.2 },
      { id: "cup",   label: "cups",   toBase: 227 },
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "g",     label: "g",      toBase: 1 },
    ],
    defaultUnit: "stick",
    estCentsPerBase: 1.5, // ~$6.80/lb
  },
  {
    id: "milk", name: "Whole Milk", shortName: "Whole",
    parentId: "milk_hub", emoji: "🥛", category: "dairy",
    units: [
      { id: "gallon",      label: "gallons",      toBase: 3785 },
      { id: "half_gallon", label: "half gallons", toBase: 1893 },
      { id: "quart",       label: "quarts",       toBase: 946 },
      { id: "pint",        label: "pints",        toBase: 473 },
      { id: "cup",         label: "cups",         toBase: 240 },
      { id: "fl_oz",       label: "fl oz",        toBase: 29.57 },
      { id: "tbsp",        label: "tbsp",         toBase: 15 },
      { id: "ml",          label: "ml",           toBase: 1 },
    ],
    defaultUnit: "gallon",
    estCentsPerBase: 0.12, // ~$4.50/gallon
  },
  {
    id: "milk_2pct", name: "2% Milk", shortName: "2%",
    parentId: "milk_hub", emoji: "🥛", category: "dairy",
    units: [
      { id: "gallon",      label: "gallons",      toBase: 3785 },
      { id: "half_gallon", label: "half gallons", toBase: 1893 },
      { id: "quart",       label: "quarts",       toBase: 946 },
      { id: "fl_oz",       label: "fl oz",        toBase: 29.57 },
      { id: "cup",         label: "cups",         toBase: 240 },
    ],
    defaultUnit: "gallon",
    estCentsPerBase: 0.12,
  },
  {
    id: "milk_skim", name: "Skim Milk", shortName: "Skim",
    parentId: "milk_hub", emoji: "🥛", category: "dairy",
    units: [
      { id: "gallon",      label: "gallons",      toBase: 3785 },
      { id: "half_gallon", label: "half gallons", toBase: 1893 },
      { id: "quart",       label: "quarts",       toBase: 946 },
      { id: "fl_oz",       label: "fl oz",        toBase: 29.57 },
    ],
    defaultUnit: "gallon",
    estCentsPerBase: 0.12,
  },
  {
    id: "buttermilk", name: "Buttermilk", shortName: "Buttermilk",
    parentId: "milk_hub", emoji: "🥛", category: "dairy",
    units: [
      { id: "quart", label: "quarts", toBase: 946 },
      { id: "pint",  label: "pints",  toBase: 473 },
      { id: "cup",   label: "cups",   toBase: 240 },
      { id: "fl_oz", label: "fl oz",  toBase: 29.57 },
    ],
    defaultUnit: "quart",
  },
  {
    id: "heavy_cream", name: "Heavy Cream", emoji: "🥛", category: "dairy",
    units: [
      { id: "pint",  label: "pints", toBase: 473 },
      { id: "quart", label: "quarts", toBase: 946 },
      { id: "cup",   label: "cups",  toBase: 240 },
      { id: "fl_oz", label: "fl oz", toBase: 29.57 },
      { id: "tbsp",  label: "tbsp",  toBase: 15 },
      { id: "ml",    label: "ml",    toBase: 1 },
    ],
    defaultUnit: "pint",
  },
  {
    id: "parmesan", name: "Parmesan", shortName: "Parmesan",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",    label: "oz",          toBase: 28.35 },
      { id: "wedge", label: "wedges",      toBase: 226 }, // ~8oz wedge
      { id: "cup",   label: "cups grated", toBase: 90 },
      { id: "g",     label: "g",           toBase: 1 },
      { id: "lb",    label: "lb",          toBase: 453.6 },
    ],
    defaultUnit: "oz",
    estCentsPerBase: 4.8, // ~$22/lb
  },
  {
    id: "pecorino", name: "Pecorino Romano", shortName: "Pecorino",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",    label: "oz",          toBase: 28.35 },
      { id: "wedge", label: "wedges",      toBase: 226 },
      { id: "cup",   label: "cups grated", toBase: 90 },
      { id: "g",     label: "g",           toBase: 1 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "gruyere", name: "Gruyère", shortName: "Gruyère",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",    label: "oz",          toBase: 28.35 },
      { id: "block", label: "blocks",      toBase: 226 },
      { id: "cup",   label: "cups grated", toBase: 90 },
      { id: "g",     label: "g",           toBase: 1 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "mozzarella", name: "Fresh Mozzarella", shortName: "Mozzarella",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",    label: "oz",    toBase: 28.35 },
      { id: "ball",  label: "balls", toBase: 226 }, // 8oz ball
      { id: "g",     label: "g",     toBase: 1 },
      { id: "lb",    label: "lb",    toBase: 453.6 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "cheddar", name: "Cheddar", shortName: "Cheddar",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",    label: "oz",          toBase: 28.35 },
      { id: "block", label: "blocks",      toBase: 226 },
      { id: "cup",   label: "cups grated", toBase: 113 },
      { id: "slice", label: "slices",      toBase: 21 },
      { id: "lb",    label: "lb",          toBase: 453.6 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "feta", name: "Feta", shortName: "Feta",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",    label: "oz",   toBase: 28.35 },
      { id: "block", label: "blocks", toBase: 170 }, // 6oz tub
      { id: "g",     label: "g",    toBase: 1 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "goat_cheese", name: "Goat Cheese", shortName: "Goat",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",  label: "oz",  toBase: 28.35 },
      { id: "log", label: "logs", toBase: 113 }, // 4oz log
      { id: "g",   label: "g",   toBase: 1 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "cream_cheese", name: "Cream Cheese", shortName: "Cream",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",    label: "oz",    toBase: 28.35 },
      { id: "block", label: "blocks", toBase: 226 }, // 8oz brick
      { id: "tub",   label: "tubs",  toBase: 226 },
      { id: "tbsp",  label: "tbsp",  toBase: 14.5 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "brie", name: "Brie", shortName: "Brie",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",    label: "oz",    toBase: 28.35 },
      { id: "wheel", label: "wheels", toBase: 226 },
      { id: "wedge", label: "wedges", toBase: 85 },
    ],
    defaultUnit: "oz",
  },
  {
    // Catch-all for Alouette, Boursin, Rondelé, etc. — the stuff sold in a
    // small tub that doesn't fit the hard/semi-hard cheese buckets.
    id: "spreadable_cheese", name: "Spreadable Cheese", shortName: "Spreadable",
    parentId: "cheese_hub", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz",   label: "oz",   toBase: 28.35 },
      { id: "tub",  label: "tubs", toBase: 198 }, // typical 6.5oz tub
      { id: "tbsp", label: "tbsp", toBase: 14 },
    ],
    defaultUnit: "oz",
    estCentsPerBase: 3.3, // ~$15/lb — fancy spreadables (Boursin, Alouette)
  },
  // Additional cheese_hub members — shared units preset, defined via helpers
  // below so we don't repeat the same oz/lb/wedge/g ladder 60 times. Keep
  // individual specialties (ricotta tubs, mozz balls) as-is above.
  // estCentsPerBase below is cents-per-gram. Rough retail math:
  //   $/lb ÷ 453.6 ≈ cents/g  (e.g. $10/lb ≈ 2.2, $20/lb ≈ 4.4, $30/lb ≈ 6.6)
  ...cheeseMembers("Fresh / Unaged", [
    ["burrata",         "Burrata",         "Burrata",         "oz",   3.1],
    ["ricotta",         "Ricotta",         "Ricotta",         "cup",  0.9],
    ["mascarpone",      "Mascarpone",      "Mascarpone",      "oz",   2.2],
    ["queso_fresco",    "Queso Fresco",    "Queso Fresco",    "oz",   1.3],
    ["paneer",          "Paneer",          "Paneer",          "oz",   1.5],
    ["fromage_blanc",   "Fromage Blanc",   "Fromage Blanc",   "oz",   1.8],
    ["quark",           "Quark",           "Quark",           "oz",   1.1],
    ["stracchino",      "Stracchino",      "Stracchino",      "oz",   3.3],
  ]),
  ...cheeseMembers("Soft Ripened", [
    ["camembert",       "Camembert",       "Camembert",       "oz",   2.6],
    ["coulommiers",     "Coulommiers",     "Coulommiers",     "oz",   3.5],
    ["brillat_savarin", "Brillat-Savarin", "Brillat-Savarin", "oz",   4.8],
    ["saint_andre",     "Saint-André",     "Saint-André",     "oz",   4.4],
    ["explorateur",     "Explorateur",     "Explorateur",     "oz",   5.3],
    ["humboldt_fog",    "Humboldt Fog",    "Humboldt Fog",    "oz",   6.2],
  ]),
  ...cheeseMembers("Semi-Soft", [
    ["havarti",         "Havarti",         "Havarti",         "oz",   1.8],
    ["fontina",         "Fontina",         "Fontina",         "oz",   2.4],
    ["muenster",        "Muenster",        "Muenster",        "oz",   1.3],
    ["taleggio",        "Taleggio",        "Taleggio",        "oz",   4.4],
    ["port_salut",      "Port Salut",      "Port Salut",      "oz",   2.4],
    ["raclette",        "Raclette",        "Raclette",        "oz",   4.0],
    ["butterkase",      "Butterkäse",      "Butterkäse",      "oz",   2.0],
    ["tomme_savoie",    "Tomme de Savoie", "Tomme de Savoie", "oz",   3.5],
  ]),
  ...cheeseMembers("Washed Rind", [
    ["limburger",       "Limburger",       "Limburger",       "oz",   2.4],
    ["epoisses",        "Époisses",        "Époisses",        "oz",   6.6],
    ["langres",         "Langres",         "Langres",         "oz",   5.7],
    ["vacherin_mdor",   "Vacherin Mont d'Or","Vacherin MdO",   "oz",   7.7],
    ["stinking_bishop", "Stinking Bishop", "Stinking Bishop", "oz",   6.2],
  ]),
  ...cheeseMembers("Semi-Hard", [
    ["gouda",           "Gouda",           "Gouda",           "oz",   1.8],
    ["edam",            "Edam",            "Edam",            "oz",   2.0],
    ["comte",           "Comté",           "Comté",           "oz",   4.8],
    ["jarlsberg",       "Jarlsberg",       "Jarlsberg",       "oz",   2.6],
    ["manchego",        "Manchego",        "Manchego",        "oz",   4.0],
    ["provolone",       "Provolone",       "Provolone",       "oz",   1.8],
    ["colby",           "Colby",           "Colby",           "oz",   1.3],
    ["monterey_jack",   "Monterey Jack",   "Monterey Jack",   "oz",   1.3],
    ["emmental",        "Emmental",        "Emmental",        "oz",   2.9],
  ]),
  ...cheeseMembers("Hard / Aged", [
    ["parmigiano",      "Parmigiano-Reggiano", "Parm-Reggiano","oz",  4.8],
    ["aged_cheddar",    "Aged Cheddar",    "Aged Cheddar",    "oz",   3.1],
    ["aged_gouda",      "Aged Gouda",      "Aged Gouda",      "oz",   4.4],
    ["asiago",          "Asiago",          "Asiago",          "oz",   3.1],
    ["grana_padano",    "Grana Padano",    "Grana Padano",    "oz",   4.0],
    ["mimolette",       "Mimolette",       "Mimolette",       "oz",   4.4],
    ["piave",           "Piave",           "Piave",           "oz",   4.8],
    ["sbrinz",          "Sbrinz",          "Sbrinz",          "oz",   5.3],
  ]),
  ...cheeseMembers("Blue", [
    ["gorgonzola",      "Gorgonzola",      "Gorgonzola",      "oz",   3.1],
    ["roquefort",       "Roquefort",       "Roquefort",       "oz",   5.3],
    ["stilton",         "Stilton",         "Stilton",         "oz",   4.4],
    ["maytag_blue",     "Maytag Blue",     "Maytag Blue",     "oz",   4.8],
    ["cabrales",        "Cabrales",        "Cabrales",        "oz",   6.2],
    ["bleu_dauvergne",  "Bleu d'Auvergne", "Bleu d'Auvergne", "oz",   4.0],
    ["cambozola",       "Cambozola",       "Cambozola",       "oz",   3.1],
    ["cashel_blue",     "Cashel Blue",     "Cashel Blue",     "oz",   4.4],
  ]),
  ...cheeseMembers("Smoked", [
    ["smoked_gouda",    "Smoked Gouda",    "Smoked Gouda",    "oz",   2.2],
    ["smoked_mozz",     "Smoked Mozzarella","Smoked Mozz",    "oz",   2.2],
    ["scamorza",        "Scamorza",        "Scamorza",        "oz",   2.4],
    ["smoked_cheddar",  "Smoked Cheddar",  "Smoked Cheddar",  "oz",   2.2],
    ["idiazabal",       "Idiazábal",       "Idiazábal",       "oz",   4.8],
  ]),
  ...cheeseMembers("Alpine", [
    ["appenzeller",     "Appenzeller",     "Appenzeller",     "oz",   4.4],
    ["beaufort",        "Beaufort",        "Beaufort",        "oz",   6.2],
    ["abondance",       "Abondance",       "Abondance",       "oz",   4.8],
    ["vacherin_frib",   "Vacherin Fribourgeois","Vacherin Frib","oz",  4.8],
  ]),
  ...cheeseMembers("American Originals", [
    ["pepper_jack",     "Pepper Jack",     "Pepper Jack",     "oz",   1.3],
    ["brick_cheese",    "Brick",           "Brick",           "oz",   1.8],
    ["teleme",          "Teleme",          "Teleme",          "oz",   3.3],
    ["cougar_gold",     "Cougar Gold",     "Cougar Gold",     "oz",   6.2],
  ]),
  {
    id: "yogurt", name: "Plain Yogurt", shortName: "Plain",
    parentId: "yogurt_hub", emoji: "🥛", category: "dairy",
    units: [
      { id: "oz",    label: "oz",      toBase: 28.35 },
      { id: "cup",   label: "cups",    toBase: 245 },
      { id: "tub",   label: "tubs",    toBase: 907 }, // 32oz tub
      { id: "cup_pk",label: "cups (6oz)", toBase: 170 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "greek_yogurt", name: "Greek Yogurt", shortName: "Greek",
    parentId: "yogurt_hub", emoji: "🥛", category: "dairy",
    units: [
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "cup",   label: "cups",   toBase: 245 },
      { id: "tub",   label: "tubs",   toBase: 907 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "sour_cream", name: "Sour Cream", emoji: "🥛", category: "dairy",
    units: [
      { id: "oz",   label: "oz",   toBase: 28.35 },
      { id: "tub",  label: "tubs", toBase: 454 }, // 16oz tub
      { id: "tbsp", label: "tbsp", toBase: 14.5 },
      { id: "cup",  label: "cups", toBase: 230 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "cottage_cheese", name: "Cottage Cheese", emoji: "🥛", category: "dairy",
    units: [
      { id: "oz",  label: "oz",   toBase: 28.35 },
      { id: "tub", label: "tubs", toBase: 454 },
      { id: "cup", label: "cups", toBase: 225 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "half_and_half", name: "Half & Half", shortName: "Half & Half",
    parentId: "milk_hub", emoji: "🥛", category: "dairy",
    units: [
      { id: "quart", label: "quarts", toBase: 946 },
      { id: "pint",  label: "pints",  toBase: 473 },
      { id: "cup",   label: "cups",   toBase: 240 },
      { id: "fl_oz", label: "fl oz",  toBase: 29.57 },
      { id: "tbsp",  label: "tbsp",   toBase: 15 },
    ],
    defaultUnit: "quart",
  },
  {
    id: "oat_milk", name: "Oat Milk", shortName: "Oat",
    parentId: "milk_hub", emoji: "🥛", category: "dairy",
    units: [
      { id: "half_gallon", label: "half gallons", toBase: 1893 },
      { id: "quart",       label: "quarts",       toBase: 946 },
      { id: "carton",      label: "cartons",      toBase: 1420 }, // 48oz
      { id: "fl_oz",       label: "fl oz",        toBase: 29.57 },
      { id: "cup",         label: "cups",         toBase: 240 },
    ],
    defaultUnit: "half_gallon",
  },
  {
    id: "almond_milk", name: "Almond Milk", shortName: "Almond",
    parentId: "milk_hub", emoji: "🥛", category: "dairy",
    units: [
      { id: "half_gallon", label: "half gallons", toBase: 1893 },
      { id: "quart",       label: "quarts",       toBase: 946 },
      { id: "fl_oz",       label: "fl oz",        toBase: 29.57 },
      { id: "cup",         label: "cups",         toBase: 240 },
    ],
    defaultUnit: "half_gallon",
  },

  // ── meat / pork / seafood ───────────────────────────────────────────────
  {
    id: "chicken", name: "Chicken (whole)", shortName: "Whole",
    parentId: "chicken_hub", emoji: "🍗", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "kg", label: "kg", toBase: 1000 },
    ],
    defaultUnit: "lb",
  },
  {
    // Cut-based units feel more natural for recipes ("4 breasts") than weight.
    // Average boneless/skinless breast ~200g, but we expose lb/oz too for the
    // weight-minded and for items the user bought by weight (family packs).
    id: "chicken_breast", name: "Chicken Breast", shortName: "Breast",
    parentId: "chicken_hub", emoji: "🍗", category: "meat",
    units: [
      { id: "count", label: "breasts", toBase: 200 },
      { id: "lb",    label: "lb",      toBase: 453.6 },
      { id: "oz",    label: "oz",      toBase: 28.35 },
      { id: "kg",    label: "kg",      toBase: 1000 },
    ],
    defaultUnit: "count",
  },
  {
    id: "chicken_thigh", name: "Chicken Thighs", shortName: "Thighs",
    parentId: "chicken_hub", emoji: "🍗", category: "meat",
    units: [
      { id: "count", label: "thighs", toBase: 120 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
      { id: "oz",    label: "oz",     toBase: 28.35 },
    ],
    defaultUnit: "count",
  },
  {
    id: "chicken_leg", name: "Chicken Legs", shortName: "Legs",
    parentId: "chicken_hub", emoji: "🍗", category: "meat",
    units: [
      { id: "count", label: "legs", toBase: 150 },
      { id: "lb",    label: "lb",   toBase: 453.6 },
      { id: "oz",    label: "oz",   toBase: 28.35 },
    ],
    defaultUnit: "count",
  },
  {
    id: "chicken_wing", name: "Chicken Wings", shortName: "Wings",
    parentId: "chicken_hub", emoji: "🍗", category: "meat",
    units: [
      { id: "count", label: "wings", toBase: 50 },
      { id: "lb",    label: "lb",    toBase: 453.6 },
      { id: "oz",    label: "oz",    toBase: 28.35 },
    ],
    defaultUnit: "count",
  },
  // Beef ───────────────────
  {
    id: "steak", name: "Steak", shortName: "Steak",
    parentId: "beef_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb",    label: "lb",       toBase: 453.6 },
      { id: "oz",    label: "oz",       toBase: 28.35 },
      { id: "count", label: "steaks",   toBase: 340 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "ribeye", name: "Ribeye", shortName: "Ribeye",
    parentId: "beef_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "count", label: "steaks", toBase: 340 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
      { id: "oz",    label: "oz",     toBase: 28.35 },
    ],
    defaultUnit: "count",
  },
  {
    id: "ny_strip", name: "NY Strip", shortName: "NY Strip",
    parentId: "beef_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "count", label: "steaks", toBase: 340 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
      { id: "oz",    label: "oz",     toBase: 28.35 },
    ],
    defaultUnit: "count",
  },
  {
    id: "sirloin", name: "Sirloin", shortName: "Sirloin",
    parentId: "beef_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "brisket", name: "Brisket", shortName: "Brisket",
    parentId: "beef_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "kg", label: "kg", toBase: 1000 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "chuck_roast", name: "Chuck Roast", shortName: "Chuck",
    parentId: "beef_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "ground_beef", name: "Ground Beef", shortName: "Ground",
    parentId: "beef_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },

  // Pork ───────────────────
  {
    id: "pork_chop", name: "Pork Chops", shortName: "Chops",
    parentId: "pork_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "count", label: "chops", toBase: 200 },
      { id: "lb",    label: "lb",    toBase: 453.6 },
      { id: "oz",    label: "oz",    toBase: 28.35 },
    ],
    defaultUnit: "count",
  },
  {
    id: "pork_loin", name: "Pork Loin", shortName: "Loin",
    parentId: "pork_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "pork_shoulder", name: "Pork Shoulder", shortName: "Shoulder",
    parentId: "pork_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "ground_pork", name: "Ground Pork", shortName: "Ground",
    parentId: "pork_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "sausage", name: "Sausage", shortName: "Sausage",
    parentId: "pork_hub", emoji: "🌭", category: "meat",
    units: [
      { id: "count", label: "links", toBase: 85 },
      { id: "lb",    label: "lb",    toBase: 453.6 },
      { id: "oz",    label: "oz",    toBase: 28.35 },
    ],
    defaultUnit: "count",
  },
  {
    id: "bacon", name: "Bacon / Pancetta", shortName: "Bacon",
    parentId: "pork_hub", emoji: "🥓", category: "meat",
    units: [
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "slice", label: "slices", toBase: 14 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "guanciale", name: "Guanciale", shortName: "Guanciale",
    parentId: "pork_hub", emoji: "🥓", category: "meat",
    units: [
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "g",  label: "g",  toBase: 1 },
      { id: "lb", label: "lb", toBase: 453.6 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "ham", name: "Ham", shortName: "Ham",
    parentId: "pork_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "slice", label: "slices", toBase: 15 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "prosciutto", name: "Prosciutto", shortName: "Prosciutto",
    parentId: "pork_hub", emoji: "🥓", category: "meat",
    units: [
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "slice", label: "slices", toBase: 10 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "salami", name: "Salami", shortName: "Salami",
    parentId: "pork_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "slice", label: "slices", toBase: 7 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
    ],
    defaultUnit: "oz",
  },

  // Turkey ───────────────────
  {
    id: "ground_turkey", name: "Ground Turkey", shortName: "Ground",
    parentId: "turkey_hub", emoji: "🦃", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "deli_turkey", name: "Sliced Turkey (deli)", shortName: "Sliced (deli)",
    parentId: "turkey_hub", emoji: "🦃", category: "meat",
    units: [
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
      { id: "slice", label: "slices", toBase: 14 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "turkey_breast", name: "Turkey Breast", shortName: "Breast",
    parentId: "turkey_hub", emoji: "🦃", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },

  // Seafood ───────────────────
  {
    id: "salmon", name: "Salmon", shortName: "Salmon",
    parentId: "seafood_hub", emoji: "🐟", category: "meat",
    units: [
      { id: "lb",    label: "lb",     toBase: 453.6 },
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "fillet",label: "fillets",toBase: 170 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "tuna", name: "Tuna (fresh)", shortName: "Tuna",
    parentId: "seafood_hub", emoji: "🐟", category: "meat",
    units: [
      { id: "lb",    label: "lb",     toBase: 453.6 },
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "steak", label: "steaks", toBase: 170 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "cod", name: "Cod", shortName: "Cod",
    parentId: "seafood_hub", emoji: "🐟", category: "meat",
    units: [
      { id: "fillet",label: "fillets",toBase: 170 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
      { id: "oz",    label: "oz",     toBase: 28.35 },
    ],
    defaultUnit: "fillet",
  },
  {
    id: "tilapia", name: "Tilapia", shortName: "Tilapia",
    parentId: "seafood_hub", emoji: "🐟", category: "meat",
    units: [
      { id: "fillet",label: "fillets",toBase: 140 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
    ],
    defaultUnit: "fillet",
  },
  {
    id: "shrimp", name: "Shrimp", shortName: "Shrimp",
    parentId: "seafood_hub", emoji: "🍤", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "scallops", name: "Scallops", shortName: "Scallops",
    parentId: "seafood_hub", emoji: "🦪", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
    ],
    defaultUnit: "lb",
  },

  // ── produce ─────────────────────────────────────────────────────────────
  {
    id: "garlic", name: "Garlic", emoji: "🧄", category: "produce",
    units: [
      { id: "clove", label: "cloves", toBase: 1 },
      { id: "head",  label: "heads",  toBase: 10 },
    ],
    defaultUnit: "clove",
  },
  {
    id: "yellow_onion", name: "Yellow Onion", emoji: "🧅", category: "produce",
    units: [{ id: "count", label: "onions", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "shallot", name: "Shallot", emoji: "🧅", category: "produce",
    units: [{ id: "count", label: "shallots", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "pearl_onion", name: "Pearl Onions", emoji: "🧅", category: "produce",
    units: [{ id: "count", label: "onions", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "carrot", name: "Carrot", emoji: "🥕", category: "produce",
    units: [{ id: "count", label: "carrots", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "tomato", name: "Tomato", emoji: "🍅", category: "produce",
    units: [
      { id: "count", label: "tomatoes", toBase: 1 },
      { id: "lb",    label: "lb",       toBase: 4 }, // roughly 4 tomatoes / lb
    ],
    defaultUnit: "count",
  },
  {
    id: "lemon", name: "Lemon", emoji: "🍋", category: "produce",
    units: [{ id: "count", label: "lemons", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "spinach", name: "Baby Spinach", emoji: "🥬", category: "produce",
    units: [
      { id: "cup", label: "cups", toBase: 30 },
      { id: "oz",  label: "oz",   toBase: 28.35 },
      { id: "g",   label: "g",    toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "basil", name: "Fresh Basil", emoji: "🌿", category: "produce",
    units: [
      { id: "bunch", label: "bunches",     toBase: 30 },
      { id: "cup",   label: "cups leaves", toBase: 15 },
      { id: "leaf",  label: "leaves",      toBase: 0.3 },
    ],
    defaultUnit: "bunch",
  },
  {
    id: "parsley", name: "Parsley", emoji: "🌿", category: "produce",
    units: [
      { id: "bunch", label: "bunches", toBase: 30 },
      { id: "cup",   label: "cups",    toBase: 15 },
    ],
    defaultUnit: "bunch",
  },
  {
    id: "mushroom", name: "Cremini Mushrooms", emoji: "🍄", category: "produce",
    units: [
      { id: "oz",  label: "oz",   toBase: 28.35 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
      { id: "cup", label: "cups", toBase: 70 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "bell_pepper", name: "Bell Pepper", emoji: "🫑", category: "produce",
    units: [{ id: "count", label: "peppers", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "cucumber", name: "Cucumber", emoji: "🥒", category: "produce",
    units: [{ id: "count", label: "cucumbers", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "avocado", name: "Avocado", emoji: "🥑", category: "produce",
    units: [{ id: "count", label: "avocados", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "potato", name: "Potato", emoji: "🥔", category: "produce",
    units: [
      { id: "count", label: "potatoes", toBase: 1 },
      { id: "lb",    label: "lb",       toBase: 3 }, // ~3 mediums per lb
      { id: "bag",   label: "bags",     toBase: 15 }, // 5lb bag
    ],
    defaultUnit: "lb",
  },
  {
    id: "sweet_potato", name: "Sweet Potato", emoji: "🍠", category: "produce",
    units: [
      { id: "count", label: "potatoes", toBase: 1 },
      { id: "lb",    label: "lb",       toBase: 2.5 },
    ],
    defaultUnit: "count",
  },
  {
    id: "broccoli", name: "Broccoli", emoji: "🥦", category: "produce",
    units: [
      { id: "head", label: "heads", toBase: 450 },
      { id: "lb",   label: "lb",    toBase: 453.6 },
      { id: "cup",  label: "cups florets", toBase: 90 },
    ],
    defaultUnit: "head",
  },
  {
    id: "cauliflower", name: "Cauliflower", emoji: "🥦", category: "produce",
    units: [
      { id: "head", label: "heads", toBase: 700 },
      { id: "lb",   label: "lb",    toBase: 453.6 },
    ],
    defaultUnit: "head",
  },
  {
    id: "lettuce", name: "Lettuce", emoji: "🥬", category: "produce",
    units: [
      { id: "head", label: "heads", toBase: 500 },
      { id: "cup",  label: "cups",  toBase: 55 },
    ],
    defaultUnit: "head",
  },
  {
    id: "arugula", name: "Arugula", emoji: "🥬", category: "produce",
    units: [
      { id: "oz",  label: "oz",   toBase: 28.35 },
      { id: "cup", label: "cups", toBase: 20 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "kale", name: "Kale", emoji: "🥬", category: "produce",
    units: [
      { id: "bunch", label: "bunches", toBase: 200 },
      { id: "oz",    label: "oz",      toBase: 28.35 },
      { id: "cup",   label: "cups",    toBase: 67 },
    ],
    defaultUnit: "bunch",
  },
  {
    id: "zucchini", name: "Zucchini", emoji: "🥒", category: "produce",
    units: [{ id: "count", label: "zucchini", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "apple", name: "Apple", emoji: "🍎", category: "produce",
    units: [
      { id: "count", label: "apples", toBase: 1 },
      { id: "lb",    label: "lb",     toBase: 3 },
      { id: "bag",   label: "bags",   toBase: 9 }, // 3lb bag
    ],
    defaultUnit: "count",
  },
  {
    id: "banana", name: "Banana", emoji: "🍌", category: "produce",
    units: [
      { id: "count", label: "bananas", toBase: 1 },
      { id: "bunch", label: "bunches", toBase: 5 },
      { id: "lb",    label: "lb",      toBase: 3 },
    ],
    defaultUnit: "count",
  },
  {
    id: "orange", name: "Orange", emoji: "🍊", category: "produce",
    units: [
      { id: "count", label: "oranges", toBase: 1 },
      { id: "lb",    label: "lb",      toBase: 3 },
      { id: "bag",   label: "bags",    toBase: 12 },
    ],
    defaultUnit: "count",
  },
  {
    id: "lime", name: "Lime", emoji: "🍋", category: "produce",
    units: [{ id: "count", label: "limes", toBase: 1 }],
    defaultUnit: "count",
  },
  {
    id: "strawberry", name: "Strawberries", emoji: "🍓", category: "produce",
    units: [
      { id: "oz",        label: "oz",        toBase: 28.35 },
      { id: "container", label: "containers",toBase: 454 }, // 16oz clamshell
      { id: "cup",       label: "cups",      toBase: 144 },
    ],
    defaultUnit: "container",
  },
  {
    id: "blueberry", name: "Blueberries", emoji: "🫐", category: "produce",
    units: [
      { id: "oz",        label: "oz",         toBase: 28.35 },
      { id: "container", label: "containers", toBase: 170 }, // 6oz pint
      { id: "cup",       label: "cups",       toBase: 148 },
    ],
    defaultUnit: "container",
  },
  {
    id: "cilantro", name: "Cilantro", emoji: "🌿", category: "produce",
    units: [
      { id: "bunch", label: "bunches", toBase: 30 },
      { id: "cup",   label: "cups",    toBase: 15 },
    ],
    defaultUnit: "bunch",
  },
  {
    id: "ginger", name: "Ginger", emoji: "🫚", category: "produce",
    units: [
      { id: "oz",    label: "oz",    toBase: 28.35 },
      { id: "piece", label: "pieces", toBase: 40 },
    ],
    defaultUnit: "piece",
  },

  // ── pantry / dry goods ──────────────────────────────────────────────────
  {
    id: "flour", name: "All-Purpose Flour", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 120 },
      { id: "tbsp", label: "tbsp", toBase: 7.5 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "sugar", name: "Sugar", emoji: "🍬", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 200 },
      { id: "tbsp", label: "tbsp", toBase: 12.5 },
      { id: "tsp",  label: "tsp",  toBase: 4.2 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "olive_oil", name: "Olive Oil", emoji: "🫒", category: "pantry",
    units: [
      { id: "tbsp", label: "tbsp",  toBase: 15 },
      { id: "cup",  label: "cups",  toBase: 240 },
      { id: "tsp",  label: "tsp",   toBase: 5 },
      { id: "oz",   label: "fl oz", toBase: 29.6 },
      { id: "ml",   label: "ml",    toBase: 1 },
    ],
    defaultUnit: "tbsp",
  },
  // Pasta ───────────────────
  {
    id: "spaghetti", name: "Spaghetti", shortName: "Spaghetti",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
      { id: "g",   label: "g",     toBase: 1 },
    ],
    defaultUnit: "box",
  },
  {
    id: "penne", name: "Penne", shortName: "Penne",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "rigatoni", name: "Rigatoni", shortName: "Rigatoni",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "fettuccine", name: "Fettuccine", shortName: "Fettuccine",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "orzo", name: "Orzo", shortName: "Orzo",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
      { id: "cup", label: "cups",  toBase: 200 },
    ],
    defaultUnit: "box",
  },
  {
    id: "lasagna", name: "Lasagna Noodles", shortName: "Lasagna",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "box",   label: "boxes",   toBase: 454 },
      { id: "oz",    label: "oz",      toBase: 28.35 },
      { id: "lb",    label: "lb",      toBase: 453.6 },
      { id: "sheet", label: "sheets",  toBase: 20 },
    ],
    defaultUnit: "box",
  },

  // Bread ───────────────────
  {
    id: "bread", name: "Sandwich Bread", shortName: "Sandwich",
    parentId: "bread_hub", emoji: "🍞", category: "pantry",
    units: [
      { id: "slice", label: "slices", toBase: 1 },
      { id: "loaf",  label: "loaves", toBase: 20 },
    ],
    defaultUnit: "loaf",
  },
  {
    id: "sourdough", name: "Sourdough", shortName: "Sourdough",
    parentId: "bread_hub", emoji: "🍞", category: "pantry",
    units: [
      { id: "slice", label: "slices", toBase: 1 },
      { id: "loaf",  label: "loaves", toBase: 16 },
    ],
    defaultUnit: "loaf",
  },
  {
    id: "baguette", name: "Baguette", shortName: "Baguette",
    parentId: "bread_hub", emoji: "🥖", category: "pantry",
    units: [
      { id: "count", label: "whole",  toBase: 20 },
      { id: "slice", label: "slices", toBase: 1 },
    ],
    defaultUnit: "count",
  },
  {
    id: "ciabatta", name: "Ciabatta / Focaccia", shortName: "Ciabatta",
    parentId: "bread_hub", emoji: "🍞", category: "pantry",
    units: [
      { id: "count", label: "rolls",   toBase: 1 },
      { id: "loaf",  label: "loaves",  toBase: 6 },
    ],
    defaultUnit: "count",
  },
  {
    id: "bagel", name: "Bagels", shortName: "Bagel",
    parentId: "bread_hub", emoji: "🥯", category: "pantry",
    units: [
      { id: "count", label: "bagels", toBase: 1 },
      { id: "pack",  label: "packs",  toBase: 6 },
    ],
    defaultUnit: "count",
  },
  {
    id: "english_muffin", name: "English Muffins", shortName: "English Muffin",
    parentId: "bread_hub", emoji: "🍞", category: "pantry",
    units: [
      { id: "count", label: "muffins", toBase: 1 },
      { id: "pack",  label: "packs",   toBase: 6 },
    ],
    defaultUnit: "pack",
  },
  {
    id: "balsamic", name: "Balsamic Vinegar", emoji: "🍶", category: "pantry",
    units: [
      { id: "tsp",    label: "tsp",    toBase: 5 },
      { id: "tbsp",   label: "tbsp",   toBase: 15 },
      { id: "cup",    label: "cups",   toBase: 240 },
      { id: "bottle", label: "bottles",toBase: 250 },
      { id: "ml",     label: "ml",     toBase: 1 },
    ],
    defaultUnit: "tbsp",
  },
  {
    id: "dijon", name: "Dijon Mustard", emoji: "🟡", category: "pantry",
    units: [
      { id: "tsp",  label: "tsp",  toBase: 5 },
      { id: "tbsp", label: "tbsp", toBase: 15 },
      { id: "jar",  label: "jars", toBase: 200 },
    ],
    defaultUnit: "tsp",
  },
  {
    id: "tomato_paste", name: "Tomato Paste", emoji: "🍅", category: "pantry",
    units: [
      { id: "tbsp", label: "tbsp", toBase: 15 },
      { id: "can",  label: "cans", toBase: 170 },
      { id: "oz",   label: "oz",   toBase: 28.35 },
    ],
    defaultUnit: "tbsp",
  },
  {
    id: "chicken_stock", name: "Chicken Stock", emoji: "🍲", category: "pantry",
    units: [
      { id: "cup",    label: "cups",   toBase: 240 },
      { id: "quart",  label: "quarts", toBase: 946 },
      { id: "ml",     label: "ml",     toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "beef_stock", name: "Beef Stock", emoji: "🍲", category: "pantry",
    units: [
      { id: "cup",   label: "cups",   toBase: 240 },
      { id: "quart", label: "quarts", toBase: 946 },
      { id: "ml",    label: "ml",     toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "red_wine", name: "Red Wine", emoji: "🍷", category: "pantry",
    units: [
      { id: "cup",    label: "cups",    toBase: 240 },
      { id: "bottle", label: "bottles", toBase: 750 },
      { id: "ml",     label: "ml",      toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "white_wine", name: "White Wine / Sherry", emoji: "🍷", category: "pantry",
    units: [
      { id: "cup",    label: "cups",    toBase: 240 },
      { id: "bottle", label: "bottles", toBase: 750 },
      { id: "ml",     label: "ml",      toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  // Rice ───────────────────
  {
    id: "rice", name: "White Rice", shortName: "White",
    parentId: "rice_hub", emoji: "🍚", category: "pantry",
    units: [
      { id: "cup", label: "cups", toBase: 185 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
      { id: "bag", label: "bags", toBase: 2268 }, // 5lb bag
      { id: "g",   label: "g",    toBase: 1 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "brown_rice", name: "Brown Rice", shortName: "Brown",
    parentId: "rice_hub", emoji: "🍚", category: "pantry",
    units: [
      { id: "cup", label: "cups", toBase: 190 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
      { id: "bag", label: "bags", toBase: 908 }, // 2lb bag
    ],
    defaultUnit: "lb",
  },
  {
    id: "jasmine_rice", name: "Jasmine Rice", shortName: "Jasmine",
    parentId: "rice_hub", emoji: "🍚", category: "pantry",
    units: [
      { id: "cup", label: "cups", toBase: 185 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
      { id: "bag", label: "bags", toBase: 2268 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "basmati_rice", name: "Basmati Rice", shortName: "Basmati",
    parentId: "rice_hub", emoji: "🍚", category: "pantry",
    units: [
      { id: "cup", label: "cups", toBase: 185 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
      { id: "bag", label: "bags", toBase: 2268 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "arborio_rice", name: "Arborio Rice", shortName: "Arborio",
    parentId: "rice_hub", emoji: "🍚", category: "pantry",
    units: [
      { id: "cup", label: "cups", toBase: 200 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
      { id: "bag", label: "bags", toBase: 454 }, // 1lb bag typical
    ],
    defaultUnit: "bag",
  },
  {
    id: "quinoa", name: "Quinoa", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup", label: "cups", toBase: 170 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
      { id: "g",   label: "g",    toBase: 1 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "oats", name: "Rolled Oats", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",       label: "cups",       toBase: 80 },
      { id: "container", label: "containers", toBase: 1134 }, // 40oz canister
      { id: "lb",        label: "lb",         toBase: 453.6 },
    ],
    defaultUnit: "container",
  },
  // Beans & legumes ───────────────────
  {
    id: "black_beans", name: "Black Beans", shortName: "Black",
    parentId: "bean_hub", emoji: "🫘", category: "pantry",
    units: [
      { id: "can", label: "cans", toBase: 425 }, // 15oz
      { id: "cup", label: "cups dry", toBase: 190 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "can",
  },
  {
    id: "chickpeas", name: "Chickpeas", shortName: "Chickpeas",
    parentId: "bean_hub", emoji: "🫘", category: "pantry",
    units: [
      { id: "can", label: "cans", toBase: 425 },
      { id: "cup", label: "cups dry", toBase: 200 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "can",
  },
  {
    id: "lentils", name: "Lentils", shortName: "Lentils",
    parentId: "bean_hub", emoji: "🫘", category: "pantry",
    units: [
      { id: "cup", label: "cups", toBase: 200 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
      { id: "bag", label: "bags", toBase: 454 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "kidney_beans", name: "Kidney Beans", shortName: "Kidney",
    parentId: "bean_hub", emoji: "🫘", category: "pantry",
    units: [
      { id: "can", label: "cans", toBase: 425 },
      { id: "cup", label: "cups dry", toBase: 190 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "can",
  },
  {
    id: "pinto_beans", name: "Pinto Beans", shortName: "Pinto",
    parentId: "bean_hub", emoji: "🫘", category: "pantry",
    units: [
      { id: "can", label: "cans", toBase: 425 },
      { id: "cup", label: "cups dry", toBase: 190 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "can",
  },
  {
    id: "cannellini_beans", name: "Cannellini Beans", shortName: "Cannellini",
    parentId: "bean_hub", emoji: "🫘", category: "pantry",
    units: [
      { id: "can", label: "cans", toBase: 425 },
      { id: "cup", label: "cups dry", toBase: 190 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "can",
  },
  {
    id: "canned_tomatoes", name: "Canned Tomatoes", emoji: "🥫", category: "pantry",
    units: [
      { id: "can", label: "cans", toBase: 794 }, // 28oz
      { id: "oz",  label: "oz",   toBase: 28.35 },
    ],
    defaultUnit: "can",
  },
  {
    id: "peanut_butter", name: "Peanut Butter", emoji: "🥜", category: "pantry",
    units: [
      { id: "jar",  label: "jars", toBase: 454 }, // 16oz jar
      { id: "tbsp", label: "tbsp", toBase: 16 },
      { id: "cup",  label: "cups", toBase: 258 },
      { id: "oz",   label: "oz",   toBase: 28.35 },
    ],
    defaultUnit: "jar",
  },
  {
    id: "honey", name: "Honey", emoji: "🍯", category: "pantry",
    units: [
      { id: "jar",  label: "jars", toBase: 340 }, // 12oz squeeze bottle
      { id: "tbsp", label: "tbsp", toBase: 21 },
      { id: "cup",  label: "cups", toBase: 340 },
      { id: "oz",   label: "oz",   toBase: 28.35 },
    ],
    defaultUnit: "jar",
  },
  {
    id: "maple_syrup", name: "Maple Syrup", emoji: "🍁", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 355 }, // 12oz
      { id: "tbsp",   label: "tbsp",    toBase: 20 },
      { id: "cup",    label: "cups",    toBase: 322 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "bottle",
  },
  {
    id: "coffee", name: "Coffee (whole bean)", emoji: "☕", category: "pantry",
    units: [
      { id: "oz",  label: "oz",   toBase: 28.35 },
      { id: "lb",  label: "lb",   toBase: 453.6 },
      { id: "bag", label: "bags", toBase: 340 }, // 12oz bag
    ],
    defaultUnit: "bag",
  },
  {
    id: "soy_sauce", name: "Soy Sauce", emoji: "🍶", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 296 }, // 10oz
      { id: "tbsp",   label: "tbsp",    toBase: 15 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "bottle",
  },
  {
    id: "vinegar", name: "Vinegar", emoji: "🍶", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 473 },
      { id: "tbsp",   label: "tbsp",    toBase: 15 },
      { id: "cup",    label: "cups",    toBase: 240 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "bottle",
  },
  {
    id: "tortillas", name: "Tortillas", emoji: "🌮", category: "pantry",
    units: [
      { id: "count", label: "tortillas", toBase: 1 },
      { id: "pack",  label: "packs",     toBase: 10 },
    ],
    defaultUnit: "pack",
  },
  {
    id: "oj", name: "Orange Juice", emoji: "🧃", category: "dairy",
    units: [
      { id: "half_gallon", label: "half gallons", toBase: 1893 },
      { id: "quart",       label: "quarts",       toBase: 946 },
      { id: "fl_oz",       label: "fl oz",        toBase: 29.57 },
      { id: "cup",         label: "cups",         toBase: 240 },
    ],
    defaultUnit: "half_gallon",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Lookups & helpers
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Price hints — rough retail cents-per-base-unit for each ingredient. Kept
// in one table rather than sprinkled through INGREDIENTS so we can tune
// prices without rewriting every ingredient entry. Mass items use cents/g,
// volume items cents/ml, count items cents/each.
//
// Anything an ingredient already carries inline (e.g. the cheese_hub
// members generated via cheeseMembers) wins — this map is a fallback.
// ─────────────────────────────────────────────────────────────────────────────
const PRICE_HINTS = {
  // ── meat ──────────────────────────────────────────
  chicken: 0.66, chicken_breast: 1.1, chicken_thigh: 0.77,
  chicken_leg: 0.55, chicken_wing: 0.88,
  steak: 2.2, ribeye: 4.0, ny_strip: 3.7, sirloin: 2.2,
  brisket: 1.8, chuck_roast: 1.5, ground_beef: 1.3,
  pork_chop: 1.1, pork_loin: 0.88, pork_shoulder: 0.88, ground_pork: 1.1,
  sausage: 1.3, bacon: 2.0, guanciale: 4.8, ham: 1.5,
  prosciutto: 6.6, salami: 3.1,
  ground_turkey: 1.1, deli_turkey: 2.2, turkey_breast: 1.5,
  salmon: 3.1, tuna: 4.0, cod: 2.6, tilapia: 1.8, shrimp: 2.4, scallops: 4.4,
  // ── dairy (non-cheese) ─────────────────────────────
  heavy_cream: 0.6, sour_cream: 0.5, cottage_cheese: 0.6,
  half_and_half: 0.4, buttermilk: 0.25,
  oat_milk: 0.2, almond_milk: 0.15, oj: 0.15,
  yogurt: 0.5, greek_yogurt: 0.9,
  // cheeses not generated by cheeseMembers()
  feta: 2.6, goat_cheese: 4.0, cream_cheese: 1.3, brie: 3.5,
  mozzarella: 2.6, cheddar: 1.8, gruyere: 4.4, pecorino: 4.8,
  // ── produce ───────────────────────────────────────
  // count-based: cents per each
  lemon: 75, lime: 50, apple: 100, banana: 35, orange: 125,
  avocado: 150, yellow_onion: 80, shallot: 100, pearl_onion: 10,
  carrot: 35, bell_pepper: 125, cucumber: 125, zucchini: 125,
  potato: 80, sweet_potato: 150, tomato: 100,
  // mass-based: cents per gram
  mushroom: 1.1, spinach: 1.3, arugula: 1.8, kale: 1.1,
  broccoli: 0.9, cauliflower: 0.8, lettuce: 0.7,
  basil: 2.0, parsley: 1.0, cilantro: 1.0, ginger: 1.1,
  strawberry: 1.1, blueberry: 2.2, garlic: 30,
  // ── pantry ────────────────────────────────────────
  flour: 0.3, sugar: 0.3, olive_oil: 2.5,
  spaghetti: 0.4, penne: 0.4, rigatoni: 0.4, fettuccine: 0.4,
  orzo: 0.5, lasagna: 0.5,
  rice: 0.3, brown_rice: 0.4, jasmine_rice: 0.4,
  basmati_rice: 0.5, arborio_rice: 0.9,
  quinoa: 1.1, oats: 0.3,
  black_beans: 0.5, chickpeas: 0.5, lentils: 0.5,
  kidney_beans: 0.5, pinto_beans: 0.5, cannellini_beans: 0.5,
  canned_tomatoes: 0.4, tomato_paste: 1.0,
  chicken_stock: 0.4, beef_stock: 0.4,
  red_wine: 1.3, white_wine: 1.3,
  peanut_butter: 1.1, honey: 2.0, maple_syrup: 3.5,
  coffee: 2.4, soy_sauce: 1.3, vinegar: 0.5, dijon: 1.5, balsamic: 2.5,
  // bread members — base is "slice" (1 slice = 1 base unit)
  bread: 15, sourdough: 50, baguette: 15, ciabatta: 200,
  bagel: 75, english_muffin: 50,
  tortillas: 15,
};
for (const ing of INGREDIENTS) {
  if (PRICE_HINTS[ing.id] != null && ing.estCentsPerBase == null) {
    ing.estCentsPerBase = PRICE_HINTS[ing.id];
  }
}

// Sub-category tags for the legacy cheese entries (the ones declared inline
// above, which have bespoke unit ladders and weren't generated via
// cheeseMembers). Keeps the Cheese drill-down neatly grouped.
const CHEESE_LEGACY_SUBCATEGORY = {
  parmesan:          "Hard / Aged",
  pecorino:          "Hard / Aged",
  gruyere:           "Alpine",
  mozzarella:        "Fresh / Unaged",
  cheddar:           "Semi-Hard",
  feta:              "Fresh / Unaged",
  goat_cheese:       "Fresh / Unaged",
  cream_cheese:      "Fresh / Unaged",
  brie:              "Soft Ripened",
  spreadable_cheese: "Fresh / Unaged",
};
for (const ing of INGREDIENTS) {
  if (CHEESE_LEGACY_SUBCATEGORY[ing.id] && !ing.subcategory) {
    ing.subcategory = CHEESE_LEGACY_SUBCATEGORY[ing.id];
  }
}

const byId = new Map(INGREDIENTS.map(i => [i.id, i]));

export function findIngredient(id) {
  return id ? byId.get(id) || null : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingredient hubs — group related ingredients under one searchable parent so
// the Add flow is "pick Chicken → pick cut" instead of scrolling 400 items,
// and so the Pantry list can collapse 20 kinds of cheese into one card.
//
// `aggregateUnit` is what we sum the group into for the pantry summary.
// (We can always convert each member to grams/ml via toBase, then back out.)
// ─────────────────────────────────────────────────────────────────────────────
export const HUBS = [
  // ── meat ────────────────────────────────────────────────────────────────
  {
    id: "chicken_hub",
    name: "Chicken",
    emoji: "🍗",
    category: "meat",
    aggregateUnit: "lb",
    aggregateLabel: "lb",
    aggregateBase: 453.6, // grams per aggregate unit
  },
  {
    id: "beef_hub",
    name: "Beef",
    emoji: "🥩",
    category: "meat",
    aggregateUnit: "lb",
    aggregateLabel: "lb",
    aggregateBase: 453.6,
  },
  {
    id: "pork_hub",
    name: "Pork",
    emoji: "🥓",
    category: "meat",
    aggregateUnit: "lb",
    aggregateLabel: "lb",
    aggregateBase: 453.6,
  },
  {
    id: "turkey_hub",
    name: "Turkey",
    emoji: "🦃",
    category: "meat",
    aggregateUnit: "lb",
    aggregateLabel: "lb",
    aggregateBase: 453.6,
  },
  {
    id: "seafood_hub",
    name: "Seafood",
    emoji: "🐟",
    category: "meat",
    aggregateUnit: "lb",
    aggregateLabel: "lb",
    aggregateBase: 453.6,
  },

  // ── dairy ───────────────────────────────────────────────────────────────
  {
    id: "cheese_hub",
    name: "Cheese",
    emoji: "🧀",
    category: "dairy",
    aggregateUnit: "oz",
    aggregateLabel: "oz",
    aggregateBase: 28.35,
  },
  {
    id: "milk_hub",
    name: "Milk",
    emoji: "🥛",
    category: "dairy",
    aggregateUnit: "gallon",
    aggregateLabel: "gal",
    aggregateBase: 3785,
  },
  {
    id: "yogurt_hub",
    name: "Yogurt",
    emoji: "🥛",
    category: "dairy",
    aggregateUnit: "oz",
    aggregateLabel: "oz",
    aggregateBase: 28.35,
  },

  // ── pantry ──────────────────────────────────────────────────────────────
  {
    id: "bread_hub",
    name: "Bread",
    emoji: "🍞",
    category: "pantry",
    aggregateUnit: "loaf",
    aggregateLabel: "loaves",
    aggregateBase: 20, // slices per loaf (base unit is slices)
  },
  {
    id: "pasta_hub",
    name: "Pasta",
    emoji: "🍝",
    category: "pantry",
    aggregateUnit: "lb",
    aggregateLabel: "lb",
    aggregateBase: 453.6,
  },
  {
    id: "rice_hub",
    name: "Rice",
    emoji: "🍚",
    category: "pantry",
    aggregateUnit: "lb",
    aggregateLabel: "lb",
    aggregateBase: 453.6,
  },
  {
    id: "bean_hub",
    name: "Beans",
    emoji: "🫘",
    category: "pantry",
    aggregateUnit: "can",
    aggregateLabel: "cans",
    aggregateBase: 425,
  },
];

const hubsById = new Map(HUBS.map(h => [h.id, h]));

export function findHub(id) {
  return id ? hubsById.get(id) || null : null;
}

// Return the hub an ingredient belongs to, or null if it's a standalone.
export function hubForIngredient(ingredientOrId) {
  const ing = typeof ingredientOrId === "string"
    ? findIngredient(ingredientOrId)
    : ingredientOrId;
  return ing?.parentId ? hubsById.get(ing.parentId) || null : null;
}

// Members (children) of a hub, in registry order.
export function membersOfHub(hubId) {
  return INGREDIENTS.filter(i => i.parentId === hubId);
}

// Ingredients that are NOT in any hub — shown alongside hub tiles in pickers.
export function standaloneIngredients() {
  return INGREDIENTS.filter(i => !i.parentId);
}

export function unitLabel(ingredient, unitId) {
  if (!ingredient) return unitId || "";
  return ingredient.units.find(u => u.id === unitId)?.label || unitId;
}

// Convert a { amount, unit } pair to the ingredient's base unit (g / ml / count).
// Returns NaN if either the ingredient or unit is unknown.
export function toBase(qty, ingredient) {
  if (!qty || !ingredient) return NaN;
  const u = ingredient.units.find(x => x.id === qty.unit);
  if (!u) return NaN;
  return Number(qty.amount) * u.toBase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback unit inference for scanned items that don't match the registry.
//
// The scanner sometimes returns ingredientId: null with a sensible emoji but a
// nonsense unit like "count" (e.g. "Alouette" cheese as 1 count). We use the
// emoji + category to pick a reasonable unit list so the user can actually
// edit the thing with a real dropdown instead of being stuck at "1 count".
// ─────────────────────────────────────────────────────────────────────────────

// Unit presets, so we don't repeat the same weight/volume ladders over and over.
const UNITS_CHEESE = [
  { id: "oz",    label: "oz",     toBase: 28.35 },
  { id: "lb",    label: "lb",     toBase: 453.6 },
  { id: "block", label: "blocks", toBase: 226 },
  { id: "tub",   label: "tubs",   toBase: 198 },
  { id: "g",     label: "g",      toBase: 1 },
];
const UNITS_DAIRY_LIQUID = [
  { id: "gallon",      label: "gallons",      toBase: 3785 },
  { id: "half_gallon", label: "half gallons", toBase: 1893 },
  { id: "quart",       label: "quarts",       toBase: 946 },
  { id: "pint",        label: "pints",        toBase: 473 },
  { id: "cup",         label: "cups",         toBase: 240 },
  { id: "fl_oz",       label: "fl oz",        toBase: 29.57 },
];
const UNITS_MEAT = [
  { id: "lb", label: "lb", toBase: 453.6 },
  { id: "oz", label: "oz", toBase: 28.35 },
  { id: "kg", label: "kg", toBase: 1000 },
];
const UNITS_DRY_WEIGHT = [
  { id: "oz",  label: "oz",  toBase: 28.35 },
  { id: "lb",  label: "lb",  toBase: 453.6 },
  { id: "cup", label: "cups",toBase: 150 },
  { id: "bag", label: "bags",toBase: 454 },
  { id: "g",   label: "g",   toBase: 1 },
];
const UNITS_PRODUCE_COUNT = [
  { id: "count", label: "count", toBase: 1 },
  { id: "lb",    label: "lb",    toBase: 453.6 },
  { id: "bunch", label: "bunches", toBase: 5 },
];
const UNITS_BREAD = [
  { id: "slice", label: "slices", toBase: 1 },
  { id: "loaf",  label: "loaves", toBase: 20 },
  { id: "count", label: "count",  toBase: 1 },
];
const UNITS_GENERIC = [
  { id: "count", label: "count", toBase: 1 },
  { id: "oz",    label: "oz",    toBase: 28.35 },
  { id: "lb",    label: "lb",    toBase: 453.6 },
];

// Given a scanned (non-canonical) item's emoji + category, pick a sensible
// unit list + default unit. Used in the scanner confirm screen so the user
// gets a real dropdown (oz, lb, fl oz) instead of being locked into "count".
export function inferUnitsForScanned({ emoji, category, unit }) {
  // Cheese — emoji is the strongest signal, category "dairy" often misleads.
  if (emoji === "🧀") {
    return { units: UNITS_CHEESE, defaultUnit: "oz" };
  }
  // Liquid dairy: milk glass, juice box.
  if (emoji === "🥛" || emoji === "🧃") {
    return { units: UNITS_DAIRY_LIQUID, defaultUnit: "half_gallon" };
  }
  // Egg — only case "count" is actually right.
  if (emoji === "🥚") {
    return {
      units: [
        { id: "count", label: "eggs",  toBase: 1 },
        { id: "dozen", label: "dozen", toBase: 12 },
      ],
      defaultUnit: "count",
    };
  }
  // Meats
  if (emoji === "🥩" || emoji === "🍗" || emoji === "🥓" || emoji === "🦃" ||
      emoji === "🐟" || emoji === "🍤" || category === "meat") {
    return { units: UNITS_MEAT, defaultUnit: "lb" };
  }
  // Bread-ish
  if (emoji === "🍞" || emoji === "🥖" || emoji === "🥐" || emoji === "🥯") {
    return { units: UNITS_BREAD, defaultUnit: "loaf" };
  }
  // Dry/pantry grains & similar
  if (emoji === "🍚" || emoji === "🌾" || emoji === "🥜" || category === "dry") {
    return { units: UNITS_DRY_WEIGHT, defaultUnit: "lb" };
  }
  // Produce fallback — usually legitimately counted (apples, peppers).
  if (category === "produce") {
    return { units: UNITS_PRODUCE_COUNT, defaultUnit: "count" };
  }
  // Dairy fallback without a more specific emoji — probably a tub (yogurt etc.).
  if (category === "dairy") {
    return {
      units: [
        { id: "oz",  label: "oz",  toBase: 28.35 },
        { id: "tub", label: "tubs",toBase: 454 },
        { id: "cup", label: "cups",toBase: 240 },
        { id: "lb",  label: "lb",  toBase: 453.6 },
      ],
      defaultUnit: "oz",
    };
  }
  // Last ditch. Preserve whatever unit Claude guessed (might be "bottle", "jar", etc.).
  return { units: UNITS_GENERIC, defaultUnit: unit || "count" };
}

// Compare pantry "have" vs recipe "need". Both are { amount, unit }.
// Returns one of "ok" | "low" | "missing" | "unknown" (if conversion fails).
//   - missing: no pantry item OR have < need after conversion
//   - low:     have ≥ need, but leftover would be below the pantry item's
//              lowThreshold (also converted to base units)
//   - ok:      plenty
// ─────────────────────────────────────────────────────────────────────────────
// Ingredient info — description, flavor profile, wine pairings, suggested
// recipes. Drives the detail sheet the user sees when they tap an
// ingredient row in the drill-down. We seed rich content for a couple
// dozen popular items (cheeses + meats mostly) and fall back to a
// subcategory-level blurb for everything else so nothing feels empty.
// ─────────────────────────────────────────────────────────────────────────────

// Per-cheese-subcategory defaults. Written so that even an obscure entry
// like Piave or Stinking Bishop has a sensible profile until we curate it.
const SUBCATEGORY_INFO = {
  // Cheese subcategories
  "Fresh / Unaged": {
    description: "Young cheeses with high moisture and no rind. Milky and soft, meant to be eaten within days of production.",
    flavorProfile: "Mild, milky, clean; light acidity",
    winePairings: ["Prosecco", "Sauvignon Blanc", "Pinot Grigio", "Dry Rosé"],
    recipes: ["Caprese salad", "Ricotta toast", "Stuffed pastas", "Fresh tomato & basil"],
  },
  "Soft Ripened": {
    description: "Bloomy-rind cheeses ripened from the outside in. Soft, sometimes oozy paste under a velvety white rind.",
    flavorProfile: "Buttery, mushroomy, creamy; earthy rind",
    winePairings: ["Champagne", "Chardonnay", "Pinot Noir", "Beaujolais"],
    recipes: ["Baked brie with honey", "Cheese boards", "Melted on crusty bread", "Fig & jam pairings"],
  },
  "Semi-Soft": {
    description: "Cheeses with a pliable, sliceable paste — softer than a Gouda, firmer than a Brie. Great melters.",
    flavorProfile: "Mild to savory; creamy, sometimes tangy",
    winePairings: ["Riesling", "Pinot Gris", "Chardonnay", "Light reds"],
    recipes: ["Grilled cheese", "Raclette night", "Quesadillas", "Pasta bakes"],
  },
  "Washed Rind": {
    description: "Cheeses washed with brine, wine, or beer during aging. Sticky orange rinds, bold barnyard aromas.",
    flavorProfile: "Pungent, meaty, funky; softer interior than the smell suggests",
    winePairings: ["Gewürztraminer", "Alsatian Riesling", "Trappist ale", "Sauternes"],
    recipes: ["Served at room temp on bread", "Melted into pasta", "Tartiflette", "With charcuterie"],
  },
  "Semi-Hard": {
    description: "Pressed cheeses aged a few months — firm, sliceable, reliably melty. The workhorses of the cheese drawer.",
    flavorProfile: "Nutty, mellow, balanced; slight sweetness",
    winePairings: ["Cabernet Sauvignon", "Merlot", "Chardonnay", "Tempranillo"],
    recipes: ["Grilled cheese", "Mac & cheese", "Cheeseburgers", "Fondue"],
  },
  "Hard / Aged": {
    description: "Long-aged cheeses with low moisture and concentrated flavor. Shave, grate, or snack in thin slivers.",
    flavorProfile: "Nutty, savory, umami; crystalline crunch",
    winePairings: ["Barolo", "Chianti Classico", "Sangiovese", "Aged Amarone"],
    recipes: ["Pasta finishing", "Risotto", "Caesar salad", "Shaved over roasted vegetables"],
  },
  "Blue": {
    description: "Cheeses inoculated with Penicillium mold, producing blue-green veins throughout the paste.",
    flavorProfile: "Salty, spicy, sharp; creamy or crumbly depending on age",
    winePairings: ["Port", "Sauternes", "Late-harvest Riesling", "Zinfandel"],
    recipes: ["Blue cheese burger", "Wedge salad", "Steak topping", "Pear & walnut salads"],
  },
  "Smoked": {
    description: "Cheeses cold- or hot-smoked over wood to impart a distinct savory layer on top of the base cheese.",
    flavorProfile: "Smoky, savory, often salty; base cheese profile still shows through",
    winePairings: ["Zinfandel", "Syrah/Shiraz", "Smoky Rioja", "Amber ales"],
    recipes: ["Smoked cheese board", "Stuffed burgers", "Mac & cheese", "Breakfast sandwiches"],
  },
  "Alpine": {
    description: "Mountain cheeses from the Swiss/French Alps. Dense, nutty pastes made for melting in fondue or raclette.",
    flavorProfile: "Nutty, brothy, slightly sweet; savory long finish",
    winePairings: ["Savoie whites", "Chasselas", "Dry Riesling", "Light Pinot Noir"],
    recipes: ["Classic fondue", "Raclette", "Croque monsieur", "French onion soup topping"],
  },
  "American Originals": {
    description: "Cheeses developed in the United States — from factory classics to Pacific Northwest curios.",
    flavorProfile: "Varies widely; generally approachable and melty",
    winePairings: ["Zinfandel", "Cabernet Sauvignon", "Chardonnay", "Craft lagers"],
    recipes: ["Grilled cheese", "Nachos", "Burgers", "Mac & cheese"],
  },
};

// Rich per-ingredient info. Anything on the ingredient overrides the
// subcategory fallback in `getIngredientInfo` below.
const INGREDIENT_INFO = {
  // ── dairy staples ──────────────────────────────────────────────────
  butter: {
    description: "Churned cream concentrated to ~80% fat. The indispensable cooking fat — conducts heat evenly, browns beautifully, emulsifies sauces, and enriches anything it touches.",
    flavorProfile: "Rich, creamy, faintly sweet; browns into toasted-nut territory",
    prepTips: "For a golden sear: melt butter into hot oil so the oil's smoke point protects the milk solids from burning. For sauces: finish off-heat, whisking cold cubes in a little at a time (monter au beurre).",
    storage: {
      location: "fridge",
      shelfLifeDays: 90,
      tips: "Wrap tightly — butter absorbs fridge odors. Freezes beautifully for up to a year in its original wrap plus a zip-top bag.",
    },
    substitutions: [
      { id: "olive_oil", note: "For savory sautés; loses the browning and enrichment." },
      { id: "ghee",      note: "Pure butterfat — no milk solids. Higher smoke point, no burning." },
    ],
    pairs: ["garlic", "parsley", "lemon", "sage"],
    nutrition: { per: "100g", kcal: 717, protein_g: 1, fat_g: 81, carb_g: 0, sodium_mg: 11 },
    origin: "Europe; churned butter dates to at least 4,500 BCE in cooler dairy-herding cultures.",
    culturalNotes: "French cuisine built its reputation on butter; Mediterranean cuisines lean on olive oil — the same dish (fish, vegetables, pasta) tells a different story depending which fat carries it.",
    allergens: ["dairy"],
    sourcing: "European-style (≥82% fat) makes richer sauces and flakier pastry; American-style is fine for everyday cooking and has more water for stovetop sautés.",
  },

  eggs: {
    description: "Chicken eggs — the single most versatile ingredient in the kitchen. Emulsify sauces, leaven cakes, bind meatballs, thicken custards, or stand alone as the meal.",
    flavorProfile: "Rich, mild, buttery yolk; clean, neutral white that picks up anything you add",
    prepTips: "Cold eggs crack cleanly, room-temp eggs whip to more volume. For even cooking, start hard-boiled eggs in simmering water and shock in ice at 9 minutes. For silky scrambled: low heat, constant stirring, pull off just before they look done.",
    storage: {
      location: "fridge",
      shelfLifeDays: 35,
      tips: "Store in the carton (not the door) — temperature's more stable on the main shelf. A fresh egg sinks; a bad one floats.",
    },
    substitutions: [
      { id: "flax_egg", note: "1 tbsp ground flax + 3 tbsp water for baking. Doesn't work for scrambles or custards." },
    ],
    pairs: ["butter", "cream", "parmesan", "chive", "tarragon"],
    nutrition: { per: "count", kcal: 72, protein_g: 6, fat_g: 5, carb_g: 0.4, sodium_mg: 71 },
    origin: "Domesticated from the red junglefowl in Southeast Asia ~8,000 years ago; now the world's most-eaten animal protein.",
    culturalNotes: "Escoffier said 'the cuisine of a nation can be judged by its egg cookery' — which is why French apprentices start with the omelette.",
    allergens: ["egg"],
    sourcing: "Pasture-raised yolks are deeper orange and richer in omega-3s. 'Cage-free' is a minimum bar, not a gold standard.",
  },

  milk: {
    description: "Whole cow's milk, ~3.25% fat. The liquid foundation of custards, béchamels, soaked croutons, and a thousand breakfasts.",
    flavorProfile: "Clean, sweet, faintly grassy; cream on top if unhomogenized",
    prepTips: "Always scald (heat to just below simmer) before adding to eggs for custards — it shortens cook time and prevents curdling. Milk burns fast; use a heavy pot and don't walk away.",
    storage: {
      location: "fridge",
      shelfLifeDays: 10,
      tips: "Coldest shelf, not the door. Ultra-pasteurized lasts much longer; traditional pasteurized tastes better but spoils sooner.",
    },
    substitutions: [
      { id: "half_and_half", note: "Richer — cut 1:1 with water to mimic whole milk in recipes." },
      { id: "oat_milk",      note: "Best non-dairy swap in savory cooking. Avoid for custards that need egg-proteins to set against milk solids." },
    ],
    pairs: ["butter", "vanilla", "cinnamon", "honey"],
    nutrition: { per: "100g", kcal: 61, protein_g: 3.2, fat_g: 3.3, carb_g: 4.8, sodium_mg: 43 },
    origin: "Cattle domesticated ~10,000 years ago in the Fertile Crescent; Northern European populations evolved lactose tolerance within the last 7,500.",
    allergens: ["dairy"],
    sourcing: "Grass-fed milk has higher omega-3 and conjugated linoleic acid. Small-dairy glass bottles are the pinnacle — worth it for drinking, overkill for cooking.",
  },

  // ── popular cheeses ────────────────────────────────────────────────
  parmesan: {
    description: "Italian hard cheese made from cow's milk and aged 12-36 months. Granular, crystalline texture from tyrosine protein clusters.",
    flavorProfile: "Nutty, savory, sharp; intense umami finish with hints of pineapple",
    prepTips: "Grate on a microplane just before using — pre-grated dries out and loses bloom. Save rinds to simmer into stocks and bean pots (they melt into the liquid).",
    storage: {
      location: "fridge",
      shelfLifeDays: 180,
      tips: "Wrap in parchment, then loosely in foil — the cheese needs to breathe a little. A sweating wedge means you've wrapped it too tight.",
    },
    substitutions: [
      { id: "pecorino",   note: "Sharper, saltier. Use slightly less." },
      { id: "grana_padano", note: "Softer, younger cousin. Milder but interchangeable in most uses." },
    ],
    pairs: ["butter", "black_pepper", "garlic", "basil"],
    nutrition: { per: "100g", kcal: 431, protein_g: 38, fat_g: 29, carb_g: 4, sodium_mg: 1529 },
    winePairings: ["Barolo", "Chianti Classico", "Sangiovese", "Aged Chardonnay"],
    recipes: ["Pasta carbonara", "Risotto alla Milanese", "Caesar salad", "Parmigiana"],
    origin: "Emilia-Romagna, Italy — the true 'Parmigiano-Reggiano' is PDO-protected and made only in a specific zone.",
    culturalNotes: "Italian banks have accepted Parmigiano wheels as loan collateral since the 1950s — they age for years and only appreciate in value.",
    allergens: ["dairy"],
    sourcing: "Look for the dot-matrix rind stamp on true Parmigiano-Reggiano. 'Parmesan' with no origin guarantee is fine for everyday grating; save the real thing for finishing.",
  },
  parmigiano: {
    description: "The original 'Parmigiano-Reggiano' — a protected Italian cheese aged 24+ months in the Parma/Reggio region.",
    flavorProfile: "Deeply nutty, fruity, salty; tyrosine crystals give it crunch",
    winePairings: ["Barolo", "Brunello di Montalcino", "Lambrusco", "Vintage Champagne"],
    recipes: ["Finish any pasta", "Risotto", "Shaved on prosciutto", "Eaten in chunks with balsamic"],
  },
  pecorino: {
    description: "Italian sheep's milk cheese, saltier and sharper than Parmesan. Aged firm for grating (Pecorino Romano) or young for eating (Pecorino Toscano).",
    flavorProfile: "Sharp, salty, tangy; pronounced sheep-milk funk that parmesan lacks",
    prepTips: "Grate fresh and pile loose — don't pack it. For cacio e pepe, the fineness of the grate matters more than any other ingredient; use a microplane, not a box grater.",
    storage: {
      location: "fridge",
      shelfLifeDays: 150,
      tips: "Parchment + foil. Don't let it touch other cheeses in the drawer — the sheep-milk aroma bleeds.",
    },
    substitutions: [
      { id: "parmesan",  note: "Milder and less salty. Cut the recipe's salt by a pinch if substituting." },
    ],
    pairs: ["black_pepper", "spaghetti", "honey", "fava"],
    nutrition: { per: "100g", kcal: 419, protein_g: 28, fat_g: 33, carb_g: 2, sodium_mg: 1800 },
    winePairings: ["Chianti", "Vermentino", "Nero d'Avola", "Dry Rosé"],
    recipes: ["Cacio e pepe", "Pasta alla gricia", "Shaved on fava beans", "With honey & pears"],
    origin: "Lazio and Sardinia, Italy — Pecorino Romano is the oldest documented Italian cheese, fed to Roman legions.",
    culturalNotes: "'Pecorino' literally means 'from sheep' (pecora). The 'Romano' was added centuries after Roman shepherds brought the craft to Sardinia, where most of it is actually made today.",
    allergens: ["dairy"],
    sourcing: "Pecorino Romano DOP is the reference for cacio e pepe and pasta alla gricia. For table eating, a younger Pecorino Toscano is mellower.",
  },
  mozzarella: {
    description: "Fresh Italian cheese, traditionally made from water buffalo milk (Mozzarella di Bufala) or cow's milk (fior di latte). Soft, stretchy, sold in balls packed in water.",
    flavorProfile: "Milky, clean, lightly sweet; tender bite that squeaks briefly against the teeth",
    prepTips: "Pull from the fridge 30 minutes before serving — cold mozz is rubbery and mute. Tear rather than cut for salads so the craggy edges catch oil and salt.",
    storage: {
      location: "fridge",
      shelfLifeDays: 7,
      tips: "Keep it submerged in its brine. Once opened, use within 2–3 days; it sours quickly.",
    },
    substitutions: [
      { id: "burrata",  note: "Richer, creamier center. Use in the same dishes for a more decadent version." },
      { id: "ricotta",  note: "For cooked dishes (pizza, pasta bakes) when fresh mozz isn't available." },
    ],
    pairs: ["tomato", "basil", "olive_oil", "balsamic"],
    nutrition: { per: "100g", kcal: 280, protein_g: 18, fat_g: 22, carb_g: 3, sodium_mg: 627 },
    winePairings: ["Prosecco", "Pinot Grigio", "Falanghina", "Rosé"],
    recipes: ["Caprese", "Pizza Margherita", "Fresh pasta", "Grilled on tomato toast"],
    origin: "Campania, Italy — the bufala version is PDO-protected and comes from a specific zone around Naples.",
    culturalNotes: "'Mozzarella' comes from 'mozzare' (to cut by hand) — traditional makers literally pinch off balls from a rope of stretched curd.",
    allergens: ["dairy"],
    sourcing: "For caprese and pizza Margherita, splurge on bufala at least once and taste the difference. For everything else, good fior di latte is excellent.",
  },
  burrata: {
    description: "A pouch of fresh mozzarella filled with stracciatella and cream. Cuts open to an oozing center.",
    flavorProfile: "Rich, buttery, milky; silkier than mozzarella",
    winePairings: ["Champagne", "Vermentino", "Gavi", "Chenin Blanc"],
    recipes: ["On toast with olive oil & sea salt", "With ripe peaches & prosciutto", "On pizza after baking", "Over roasted tomatoes"],
  },
  cheddar: {
    description: "English-origin pressed cow's milk cheese, 'cheddared' in slabs during production. Ranges from mild to extra sharp.",
    flavorProfile: "Creamy, tangy, sharp; increases in complexity with age",
    winePairings: ["Cabernet Sauvignon", "Zinfandel", "Aged Bordeaux", "Stout"],
    recipes: ["Grilled cheese", "Mac & cheese", "Cheeseburger", "Ploughman's lunch"],
  },
  aged_cheddar: {
    description: "Cheddar aged 2+ years. Drier, crumblier, and dotted with tyrosine crystals.",
    flavorProfile: "Sharp, nutty, slightly sweet; crystalline crunch",
    winePairings: ["Cabernet Sauvignon", "Vintage Port", "Amarone", "Barrel-aged stout"],
    recipes: ["Cheese board with chutney", "Apple & cheddar pie", "Shaved on soups", "Paired with dark chocolate"],
  },
  gruyere: {
    description: "Swiss Alpine cheese from the Gruyères region, pressed and aged 5-12 months. The quintessential melter — fondue, gratin, croque monsieur.",
    flavorProfile: "Nutty, brothy, earthy; savory long finish with a slight sweetness from the Alpine grasses",
    prepTips: "Shred just before cooking — pre-shredded bags are coated with anti-caking starch that muddies the melt. For fondue, toss the shreds with a spoon of cornstarch to prevent the fat from breaking.",
    storage: {
      location: "fridge",
      shelfLifeDays: 120,
      tips: "Parchment + foil in the cheese drawer. A little surface mold on an aged Gruyère is normal — scrape it off, not a disaster.",
    },
    substitutions: [
      { id: "comte",    note: "French cousin from the Jura. More nuanced, interchangeable in most applications." },
      { id: "emmental", note: "Milder, holier. Melts well but lacks Gruyère's depth." },
    ],
    pairs: ["ham", "white_wine", "potato", "yellow_onion"],
    nutrition: { per: "100g", kcal: 413, protein_g: 30, fat_g: 32, carb_g: 0.4, sodium_mg: 714 },
    winePairings: ["Chasselas", "Dry Riesling", "Chardonnay", "Pinot Noir"],
    recipes: ["Fondue", "French onion soup", "Croque monsieur", "Quiche Lorraine"],
    origin: "Canton of Fribourg, Switzerland — named for the town of Gruyères, made since at least 1115 CE.",
    culturalNotes: "Swiss soldiers in the Vatican Guard were once paid partly in Gruyère rations. The cheese travels well and doesn't spoil fast — a medieval protein bar.",
    allergens: ["dairy"],
    sourcing: "'Gruyère AOP' (Swiss) is the real one; 'Le Gruyère' alone can be French-style. Both are excellent — AOP is deeper.",
  },
  comte: {
    description: "French Alpine cheese from the Jura mountains, aged 6-24 months. Cousin to Gruyère with a longer finish.",
    flavorProfile: "Nutty, fruity, caramelized; brown butter notes",
    winePairings: ["Jura Chardonnay", "Vin Jaune", "Savagnin", "Pinot Noir"],
    recipes: ["Cheese board", "Gougères", "Melted on baguette", "Grated over gratins"],
  },
  brie: {
    description: "French bloomy-rind cheese, soft and oozy at room temperature. Most common cheese-board cheese.",
    flavorProfile: "Buttery, mushroomy, mild; earthy rind",
    winePairings: ["Champagne", "Chardonnay", "Pinot Noir", "Beaujolais"],
    recipes: ["Baked brie with honey", "Brie + apple + prosciutto sandwich", "Cheese boards", "Melted into pasta"],
  },
  camembert: {
    description: "Normandy cheese, a smaller and more assertive cousin of Brie. Sold in its iconic wooden box.",
    flavorProfile: "Earthy, mushroomy, barnyard; softer paste than Brie",
    winePairings: ["Normandy cider", "Chablis", "Pinot Noir", "Champagne"],
    recipes: ["Baked in its box", "On crusty baguette", "With apple slices", "Cheese boards"],
  },
  feta: {
    description: "Greek brine-cured cheese, traditionally made from sheep and goat milk. Crumbly and bright.",
    flavorProfile: "Salty, tangy, sharp; crumbly texture",
    winePairings: ["Assyrtiko", "Sauvignon Blanc", "Retsina", "Rosé"],
    recipes: ["Greek salad", "Spanakopita", "Crumbled on watermelon", "Roasted with tomatoes & olives"],
  },
  goat_cheese: {
    description: "Fresh chèvre — soft, spreadable cheese made from goat's milk. Often sold in small logs.",
    flavorProfile: "Tangy, grassy, clean; slightly lemony",
    winePairings: ["Sancerre", "Sauvignon Blanc", "Chenin Blanc", "Pouilly-Fumé"],
    recipes: ["Beet & goat cheese salad", "Goat cheese tart", "Warm crostini with honey", "Stuffed dates"],
  },
  cream_cheese: {
    description: "Fresh, soft American cheese made from cream + milk. The bagel cheese.",
    flavorProfile: "Mild, tangy, rich; very smooth",
    winePairings: ["Mimosas", "Off-dry Riesling", "Prosecco"],
    recipes: ["Bagel & lox", "Cheesecake", "Cream-cheese frosting", "Rangoons & dips"],
  },
  gouda: {
    description: "Dutch cow's milk cheese. Young gouda is mild and supple; aged versions turn butterscotchy.",
    flavorProfile: "Buttery, slightly sweet; caramelly when aged",
    winePairings: ["Chardonnay", "Merlot", "Pinot Noir", "Belgian ale"],
    recipes: ["Grilled cheese", "Cheese board", "Melted in toasties", "Shaved on apples"],
  },
  aged_gouda: {
    description: "Gouda aged 1-5 years. Dry, crystalline, deeply sweet-savory.",
    flavorProfile: "Butterscotch, caramel, umami; snappy crystals",
    winePairings: ["Vintage Port", "Madeira", "Amarone", "Old Ale"],
    recipes: ["Cheese plates", "With dark chocolate", "Shaved on charcuterie", "In stroopwafel-cheese pairings"],
  },
  manchego: {
    description: "Spanish sheep's milk cheese from La Mancha, pressed and aged 3-12+ months. Recognizable basket-weave rind.",
    flavorProfile: "Nutty, buttery, grassy; tangy with age",
    winePairings: ["Tempranillo", "Rioja Reserva", "Sherry (Amontillado)", "Cava"],
    recipes: ["With membrillo (quince paste)", "Tapas boards", "Shaved on jamón", "Grilled on bread"],
  },
  mascarpone: {
    description: "Italian triple-cream cheese. Thicker than crème fraîche, essentially a pourable cream cheese.",
    flavorProfile: "Sweet, buttery, very rich; pillowy texture",
    winePairings: ["Moscato d'Asti", "Vin Santo", "Prosecco", "Late-harvest Riesling"],
    recipes: ["Tiramisu", "Pasta alla norcina", "Folded into risotto", "On toast with berries"],
  },
  ricotta: {
    description: "Italian whey cheese, cooked and drained. Soft, pillowy, lightly sweet — not a true cheese by European rules.",
    flavorProfile: "Mild, milky, subtly sweet; fluffy curds",
    winePairings: ["Prosecco", "Pinot Grigio", "Orvieto", "Dry Rosé"],
    recipes: ["Lasagna", "Stuffed shells", "Ricotta pancakes", "On toast with honey + lemon"],
  },
  gorgonzola: {
    description: "Italian blue cheese. Dolce is young and creamy; piccante is aged and sharper.",
    flavorProfile: "Creamy, tangy, spicy-sharp; buttery mouthfeel",
    winePairings: ["Recioto", "Port", "Moscato d'Asti", "Amarone"],
    recipes: ["Gorgonzola gnocchi", "On pear + walnut salad", "Risotto", "Pizza quattro formaggi"],
  },
  roquefort: {
    description: "French sheep's milk blue, aged in the caves of Combalou. The original blue cheese.",
    flavorProfile: "Intense, salty, sharp; creamy yet crumbly",
    winePairings: ["Sauternes", "Tawny Port", "Monbazillac", "Gewürztraminer"],
    recipes: ["Roquefort butter on steak", "Endive salad", "On crusty bread with honey", "Steak sauce"],
  },
  stilton: {
    description: "English blue cheese from the Midlands, firm and crumbly with bold blue veining.",
    flavorProfile: "Rich, tangy, savory; mellow compared to Roquefort",
    winePairings: ["Vintage Port", "Madeira", "Late Bottled Port", "Stout"],
    recipes: ["Christmas cheese board", "Stilton & pear tart", "Crumbled in soup", "With walnuts"],
  },
  humboldt_fog: {
    description: "American artisan goat cheese (Cypress Grove, California) with a central ash line and bloomy rind.",
    flavorProfile: "Tangy, lemony, floral; creamy-to-chalky texture",
    winePairings: ["Sauvignon Blanc", "Sancerre", "Prosecco", "Dry Rosé"],
    recipes: ["Cheese board centerpiece", "On beet salad", "With fig jam", "Crostini with honey"],
  },
  epoisses: {
    description: "French Burgundy washed-rind cheese, washed with Marc de Bourgogne. Pungent, sticky, unforgettable.",
    flavorProfile: "Barnyard, boozy, meaty; creamy spoon-able interior",
    winePairings: ["Marc de Bourgogne", "Gewürztraminer", "Burgundy", "Trappist ale"],
    recipes: ["Spooned onto toast", "Melted on baked potato", "With charcuterie", "Cheese course"],
  },

  // ── meats ──────────────────────────────────────────────────────────
  chicken_breast: {
    description: "Lean, boneless/skinless cut from the pectoral muscle. Quick to cook, easy to overcook — the window between juicy and shoe-leather is maybe 30 seconds.",
    flavorProfile: "Mild, lightly savory; needs seasoning and fat to come alive",
    prepTips: "Pound to even thickness (½-inch) for uniform cooking. Brine 30 min in 1 tbsp salt + 1 cup water before cooking for noticeably juicier results. Pull at 160°F — carryover brings it to 165°F safe temp.",
    storage: {
      location: "fridge",
      shelfLifeDays: 2,
      tips: "On the bottom shelf so drips don't cross-contaminate. Freeze within 1–2 days if you're not using — freezes well up to 4 months in a zip-top bag.",
    },
    substitutions: [
      { id: "chicken_thigh", note: "Darker, fattier, more forgiving. Better for braises and slow cooks." },
      { id: "turkey_breast", note: "1:1 swap; adjust cooking time down slightly for even thinner cuts." },
    ],
    pairs: ["lemon", "garlic", "rosemary", "butter"],
    nutrition: { per: "100g", kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0, sodium_mg: 74 },
    winePairings: ["Chardonnay", "Sauvignon Blanc", "Pinot Noir", "Dry Riesling"],
    recipes: ["Chicken piccata", "Chicken parmesan", "Grilled chicken salad", "Chicken marsala"],
    origin: "Domesticated ~8,000 years ago in Southeast Asia; the breast was historically the less-prized cut — it was the thigh meat that was eaten first.",
    culturalNotes: "The US consumes ~65 billion chicken breasts annually. American breeding has selected for oversized breasts since the 1950s — they're roughly 4× their natural size.",
    allergens: [],
    sourcing: "Pasture-raised or heritage breeds (Freedom Ranger, Bresse) have better flavor and firmer texture. 'Air-chilled' is a genuine quality upgrade over standard water-chilled.",
  },
  chicken_thigh: {
    description: "Dark-meat cut from the upper leg. More forgiving than breast, richer flavor.",
    flavorProfile: "Rich, juicy, deeply savory; handles high heat",
    winePairings: ["Pinot Noir", "Grenache", "Chardonnay", "Zinfandel"],
    recipes: ["Chicken thighs with lemon & olives", "Chicken adobo", "Thai basil chicken", "Roasted with potatoes"],
  },
  chicken: {
    description: "Whole bird, 3–5 lb. The most versatile protein in the kitchen — roast it, spatchcock it, break it down for parts, simmer the carcass into stock.",
    flavorProfile: "Balanced light + dark meat; crispy skin is the whole game",
    prepTips: "Dry-brine 24 hours ahead (salt + pepper + whatever herbs, uncovered in fridge). This does more for crispy skin + seasoned meat than any marinade. Truss only if the legs splay wildly; otherwise let the bird breathe.",
    storage: {
      location: "fridge",
      shelfLifeDays: 2,
      tips: "Dry-brine = uncovered on a rack for 24 hours. Cover only if storing longer than that. Stock from the carcass freezes beautifully for 6 months.",
    },
    substitutions: [
      { id: "cornish_hen", note: "Smaller (~1 lb) versions of the same bird. Cook in 45 min instead of 90. Great for individual portions." },
    ],
    pairs: ["lemon", "thyme", "garlic", "butter", "white_wine"],
    nutrition: { per: "100g", kcal: 239, protein_g: 27, fat_g: 14, carb_g: 0, sodium_mg: 82 },
    winePairings: ["Chardonnay", "Pinot Noir", "Côtes du Rhône", "Beaujolais"],
    recipes: ["Classic roast chicken", "Spatchcocked + grilled", "Chicken stock", "Coq au vin"],
    origin: "Descended from the red junglefowl of Southeast Asia. Gallus gallus domesticus is now the most numerous bird on Earth by roughly an order of magnitude.",
    culturalNotes: "A whole roast chicken is the French 'poulet rôti' — the benchmark dish any aspiring cook is measured against. If you can nail a roast chicken, you can cook.",
    allergens: [],
    sourcing: "Pasture-raised > organic > 'free range' > conventional. An air-chilled, pasture-raised bird tastes like a different animal than a factory-farmed one.",
  },
  ribeye: {
    description: "Fatty, well-marbled steak cut from the rib primal. Considered the most flavorful beef cut.",
    flavorProfile: "Rich, beefy, buttery; intense marbling renders into the meat",
    winePairings: ["Cabernet Sauvignon", "Malbec", "Syrah/Shiraz", "Zinfandel"],
    recipes: ["Cast-iron ribeye", "Grilled with compound butter", "Tomahawk for sharing", "Steak frites"],
  },
  ny_strip: {
    description: "Tender cut from the short loin — firmer and less fatty than a ribeye, with a beefy chew.",
    flavorProfile: "Beefy, moderately marbled; clean finish",
    winePairings: ["Cabernet Sauvignon", "Bordeaux", "Tempranillo", "Chianti Classico"],
    recipes: ["Pan-seared with rosemary butter", "Grilled NY strip", "Steak au poivre", "Steakhouse dinner"],
  },
  sirloin: {
    description: "Leaner, firmer cut from the back of the cow. Great value for everyday steak dinners and the workhorse cut for fajitas, stir-fries, and kebabs.",
    flavorProfile: "Beefy, firm; less marbling than ribeye or strip — flavor comes from technique, not fat",
    prepTips: "Slice against the grain after cooking, always. Rest 5 minutes before slicing. A high-heat sear (cast-iron, ripping hot, no oil) gives a Maillard crust leaner cuts desperately need.",
    storage: {
      location: "fridge",
      shelfLifeDays: 3,
      tips: "Room-temp 30 minutes before cooking — cold meat hits the pan and steams instead of sears. Freeze in flat packs, not chunks, for quick defrost.",
    },
    substitutions: [
      { id: "ribeye",     note: "Fattier, more forgiving. Spend here for special occasions." },
      { id: "flank_steak", note: "Thinner, more grain. Also great for fajitas and steak tacos." },
    ],
    pairs: ["garlic", "rosemary", "butter", "red_wine"],
    nutrition: { per: "100g", kcal: 183, protein_g: 25, fat_g: 8.7, carb_g: 0, sodium_mg: 53 },
    winePairings: ["Malbec", "Cabernet Sauvignon", "Syrah", "Côtes du Rhône"],
    recipes: ["Beef stir-fry", "Steak sandwiches", "Steak salad", "Pan-seared with chimichurri"],
    origin: "'Sirloin' is from the French 'surlonge' — above the loin. Large working-muscle area, which is why it's leaner.",
    culturalNotes: "English legend says King James I was so impressed by a beef dinner he knighted the cut: 'Arise, Sir Loin.' Charming, apocryphal — the name actually predates him.",
    allergens: [],
    sourcing: "Grass-fed has a firmer texture and more mineral flavor; grain-finished is more buttery. Dry-aged (if you can find it) concentrates flavor and tenderizes the muscle.",
  },
  brisket: {
    description: "Tough, fatty cut from the breast. Needs long, slow cooking to break down into tender layers.",
    flavorProfile: "Deeply beefy, fatty, smoky when BBQ'd",
    winePairings: ["Zinfandel", "Malbec", "Syrah/Shiraz", "Barbera"],
    recipes: ["Texas BBQ brisket", "Jewish braised brisket", "Beef pho", "Pastrami"],
  },
  ground_beef: {
    description: "Coarsely or finely ground beef, usually 80/20 fat-to-lean for burgers and sauces.",
    flavorProfile: "Savory, rich; texture depends on grind & fat ratio",
    winePairings: ["Zinfandel", "Chianti", "Malbec", "Merlot"],
    recipes: ["Cheeseburgers", "Bolognese", "Chili", "Meatballs"],
  },
  salmon: {
    description: "Fatty, rich fish with bright pink-orange flesh. Wild or farmed, fillet or whole.",
    flavorProfile: "Rich, buttery, clean; stands up to big flavors",
    winePairings: ["Pinot Noir", "Chardonnay", "Dry Rosé", "Grüner Veltliner"],
    recipes: ["Pan-seared with crispy skin", "Cedar-plank grilled", "Poached with herbs", "Lox/gravlax"],
  },
  shrimp: {
    description: "Sweet, briny crustaceans sold by size (count per lb). Cook in 2-3 minutes — overcooking makes them rubbery.",
    flavorProfile: "Sweet, briny, snappy; takes on surrounding flavors",
    winePairings: ["Sauvignon Blanc", "Albariño", "Dry Rosé", "Grüner Veltliner"],
    recipes: ["Shrimp scampi", "Shrimp & grits", "Garlic shrimp tapas", "Gambas al ajillo"],
  },
  bacon: {
    description: "Cured and smoked pork belly, sliced thin. America's breakfast meat; Italy's pancetta is the unsmoked cousin, France's lardon the thicker chunk.",
    flavorProfile: "Salty, smoky, fatty; savory long finish with a sweet edge from any maple or brown-sugar cure",
    prepTips: "Start bacon in a COLD pan and heat slowly — the fat renders fully and the strips end up evenly crisp instead of curled. Save the grease (strain into a jar, fridge it) — it's the best cooking fat you're not using.",
    storage: {
      location: "fridge",
      shelfLifeDays: 7,
      tips: "Once opened, roll unused strips in parchment and freeze — snap off what you need. Unopened packs keep 2+ weeks past the date if the bag is unpunctured.",
    },
    substitutions: [
      { id: "pancetta",   note: "Unsmoked Italian cure. Use 1:1 where the smoke isn't the point (carbonara, pasta dishes)." },
      { id: "guanciale",  note: "Cured pork jowl. The authentic choice for Roman pastas — richer, more intense than bacon." },
    ],
    pairs: ["eggs", "tomato", "maple_syrup", "black_pepper"],
    nutrition: { per: "100g", kcal: 541, protein_g: 37, fat_g: 42, carb_g: 1.4, sodium_mg: 1717 },
    winePairings: ["Pinot Noir", "Zinfandel", "Sparkling wine with brunch", "Chardonnay"],
    recipes: ["BLT", "Carbonara", "Bacon-wrapped anything", "Breakfast hash"],
    origin: "Cured pork techniques date to ancient China and Rome; 'bacon' as a word is Old French (bacö, 'back'), referring to the cured back cuts.",
    culturalNotes: "American bacon is belly cut — most of the rest of the world's 'bacon' is the leaner back cut ('rashers' in the UK, 'peameal' in Canada). The US-centric belly version is the outlier, not the norm.",
    allergens: [],
    sourcing: "Look for 'uncured' (nitrate-free) bacons that use celery powder instead of sodium nitrate if you care — they taste the same. Thick-cut holds up in pasta; thin-cut crisps faster for BLTs.",
  },
  guanciale: {
    description: "Cured pork jowl — fattier, richer, and more intensely flavored than pancetta or bacon. The authentic fat for Roman pasta: carbonara, gricia, amatriciana.",
    flavorProfile: "Deeply porky, rich, faintly funky; pepper rim adds warmth. Renders to a puddle of amber fat that perfumes the pasta.",
    prepTips: "Start in a cold pan on medium-low so the fat renders slowly and evenly. Pull the crisped pieces out when the outside is browned and the centers are still tender — over-rendering turns them into jerky.",
    storage: {
      location: "fridge",
      shelfLifeDays: 90,
      tips: "Wrapped in parchment, sealed in a zip-top — it keeps for months. The cure is its preservation. Slice as needed rather than pre-dicing.",
    },
    substitutions: [
      { id: "pancetta", note: "Most common swap. Leaner, less funky — acceptable but noticeably different in a gricia." },
      { id: "bacon",    note: "Last resort. Smoke changes the dish's character. Skip the smoke by blanching 60 seconds first." },
    ],
    pairs: ["spaghetti", "pecorino", "black_pepper", "eggs"],
    nutrition: { per: "100g", kcal: 660, protein_g: 7, fat_g: 69, carb_g: 0, sodium_mg: 1350 },
    winePairings: ["Frascati", "Cesanese", "Lambrusco", "Chianti"],
    recipes: ["Carbonara", "Pasta alla gricia", "Amatriciana", "Tossed through bitter greens"],
    origin: "Lazio and Umbria, Italy. 'Guancia' means cheek — cured with salt, black pepper, and sometimes wine, then aged 2–3 months.",
    culturalNotes: "Purists insist Roman pastas must use guanciale — not pancetta, not bacon. The fat content and texture are genuinely different, and you can taste it.",
    allergens: [],
    sourcing: "Italian imports are best. A good specialty grocer or Italian deli will have it; online specialty meat shops ship it cured. Domestic producers are catching up fast.",
  },
  ham: {
    description: "Cured pork leg. Ranges from deli slices to bone-in whole hams to dry-cured Iberian specialties. Versatile cooked-meat staple.",
    flavorProfile: "Salty, savory, lightly sweet; smoke varies by style",
    prepTips: "Deli slices: keep flat-packed in the fridge, use within a week. Whole hams: glaze with brown sugar + mustard + a splash of bourbon in the last 30 min of baking. Slice bone-in hams thinly against the grain.",
    storage: {
      location: "fridge",
      shelfLifeDays: 7,
      tips: "Once opened, deli ham loses quality fast — plan to use within 5 days. Bone-in ham lasts 7–10 days if well-wrapped.",
    },
    substitutions: [
      { id: "prosciutto", note: "Dry-cured, eaten raw. Use in cold applications, not sandwiches or gratins." },
      { id: "turkey",     note: "Leaner deli alternative. Mild; needs more seasoning in cooked applications." },
    ],
    pairs: ["gruyere", "mustard", "butter", "bread"],
    nutrition: { per: "100g", kcal: 145, protein_g: 21, fat_g: 6, carb_g: 2, sodium_mg: 1203 },
    winePairings: ["Riesling", "Gewürztraminer", "Pinot Noir", "Rosé"],
    recipes: ["Croque monsieur", "Ham & cheese omelette", "Holiday baked ham", "Split pea soup"],
    origin: "Cured pork legs appear across world cuisines — China (jinhua ham), Spain (jamón ibérico), Italy (prosciutto), Germany (Schwarzwälder Schinken). Every pork-eating culture has one.",
    culturalNotes: "Easter ham is a Christian tradition rooted in spring pig slaughters — hams cured in fall were ready to eat by spring.",
    allergens: [],
    sourcing: "For a sandwich: a specialty-shop cured ham will taste noticeably better than pre-packaged. For holidays: bone-in is worth the extra fuss — you get stock from the bone.",
  },
  prosciutto: {
    description: "Italian dry-cured ham, aged 12-24 months. Sliced paper-thin, eaten without cooking.",
    flavorProfile: "Salty, sweet, buttery; melts on the tongue",
    winePairings: ["Prosecco", "Franciacorta", "Lambrusco", "Chianti"],
    recipes: ["Prosciutto + melon", "Wrapped around asparagus", "On pizza after baking", "Antipasto platters"],
  },

  // ── produce: alliums + herbs ──────────────────────────────────────
  garlic: {
    description: "Bulb of the allium family, broken into cloves. The foundational aromatic in most of the world's cuisines — on every inhabited continent, some version of garlic-in-oil starts dinner.",
    flavorProfile: "Sharp and pungent raw; sweet, mellow, and nutty when cooked; deeply caramelized and jammy when roasted whole",
    prepTips: "Smash cloves with the flat of a knife to loosen the papery skin. Chop just before using — pre-chopped garlic oxidizes within an hour. Never burn it; brown garlic is bitter garlic.",
    storage: {
      location: "pantry",
      shelfLifeDays: 90,
      tips: "Cool, dry, airy spot — not the fridge (goes moldy). If you see a green sprout inside, it's safe but bitter; halve and remove the germ.",
    },
    substitutions: [
      { id: "shallot", note: "Sweeter, subtler. 1 clove ≈ ½ small shallot, minced." },
    ],
    pairs: ["olive_oil", "butter", "parsley", "lemon"],
    nutrition: { per: "100g", kcal: 149, protein_g: 6.4, fat_g: 0.5, carb_g: 33, fiber_g: 2.1, sodium_mg: 17 },
    origin: "Central Asia — domesticated over 5,000 years ago. Fed to the pyramid builders as a stimulant and antibiotic.",
    culturalNotes: "Every Mediterranean grandmother has an opinion about pre-peeled garlic (generally: don't). The difference between fresh and jarred is audible in a quiet kitchen.",
    allergens: [],
    seasonality: { peakMonths: [7, 8, 9] },
    sourcing: "Hardneck varieties (Rocambole, Porcelain) have deeper flavor and easier-to-peel cloves. California-grown softneck is the everyday workhorse.",
  },

  yellow_onion: {
    description: "The default onion. Thick, papery skin over a sharp, pungent flesh that mellows and sweetens when cooked. The base of roughly every soup, sauté, and stew in Western cooking.",
    flavorProfile: "Sharp and pungent raw; sweet and savory when cooked; deeply caramelized when slow-cooked 30+ minutes in butter",
    prepTips: "Chill 15 minutes before chopping to reduce the tear-inducing vapor. For uniform dice: halve through the root, peel, make horizontal cuts toward (not through) the root, then vertical cuts, then slice across.",
    storage: {
      location: "pantry",
      shelfLifeDays: 60,
      tips: "Cool, dry, DARK spot in a mesh bag or open basket. Never next to potatoes — both emit ethylene gas that ripens the other.",
    },
    substitutions: [
      { id: "shallot", note: "Subtler, sweeter. Use for finer sauces and vinaigrettes." },
      { id: "pearl_onion", note: "Whole-form variety for braises and stews." },
    ],
    pairs: ["garlic", "butter", "olive_oil", "carrot"],
    nutrition: { per: "100g", kcal: 40, protein_g: 1.1, fat_g: 0.1, carb_g: 9.3, fiber_g: 1.7, sodium_mg: 4 },
    origin: "Central Asia, cultivated ~7,000 years ago. 'The onion is the poor man's food' — Egyptian proverb.",
    culturalNotes: "Deeply caramelized onions (45 min+ in butter, constant stirring) are the secret foundation of French onion soup, coq au vin, and half the soups that ever tasted like 'mom made this.'",
    allergens: [],
    seasonality: { peakMonths: [8, 9, 10] },
    sourcing: "Look for firm bulbs with dry, papery skin — soft spots mean rot underneath. Storage onions (yellow) are what you want; sweet onions (Vidalia, Walla Walla) are specialty.",
  },

  shallot: {
    description: "Small, elongated allium — milder, sweeter, and more refined than an onion. The go-to for vinaigrettes, pan sauces, and anywhere you want onion character without the bite.",
    flavorProfile: "Delicate, sweet, faintly garlicky; no bitter aftertaste raw",
    prepTips: "Mince fine for vinaigrettes — bigger pieces stay crunchy in the mouth. For pan sauces, sweat in butter before adding wine so they surrender their sugars.",
    storage: {
      location: "pantry",
      shelfLifeDays: 45,
      tips: "Same as yellow onions — cool, dark, airy. Once cut, refrigerate and use within 2 days; the delicate flavor fades fast.",
    },
    substitutions: [
      { id: "yellow_onion", note: "Use half the amount; the bite is stronger and less refined." },
      { id: "garlic", note: "Same amount for pan sauces; accepts that the result will be more assertive." },
    ],
    pairs: ["butter", "white_wine", "dijon", "parsley"],
    nutrition: { per: "100g", kcal: 72, protein_g: 2.5, fat_g: 0.1, carb_g: 17, fiber_g: 3.2, sodium_mg: 12 },
    origin: "Named for the ancient city of Ashkelon (Ascalon) in modern Israel, where crusaders first encountered them.",
    culturalNotes: "French cooks consider shallots the 'onion for sauces' — onion is too bold, garlic too assertive; shallot is the neutral. Eschalot / échalote in French.",
    allergens: [],
    seasonality: { peakMonths: [7, 8, 9] },
    sourcing: "French gray shallots (échalote grise) have deeper flavor but are hard to find. Jersey (banana) shallots are the usual supermarket option — smaller, milder, still good.",
  },

  pearl_onion: {
    description: "Miniature onions ~½-inch across. Sold in mesh bags (fresh) or jars (pickled). The classic garnish for braises, casseroles, and a proper gin martini.",
    flavorProfile: "Mild, sweet, delicate; less aggressive than a full onion",
    prepTips: "To peel fresh ones: blanch 60 seconds, shock in ice water, squeeze the root end — the onion slips out of its skin. Doing 30 of them individually is the only thing worse than crying through yellow-onion dice.",
    storage: {
      location: "pantry",
      shelfLifeDays: 30,
      tips: "Fresh: cool dry mesh bag, same as yellow onions. Frozen pearl onions (pre-peeled) are a legitimate shortcut for braises — nobody will taste the difference.",
    },
    substitutions: [
      { id: "yellow_onion", note: "Quartered chunks work for the flavor; you lose the whole-onion visual moment." },
    ],
    pairs: ["bacon", "red_wine", "thyme", "mushroom"],
    nutrition: { per: "100g", kcal: 40, protein_g: 1.1, fat_g: 0.1, carb_g: 9.3, fiber_g: 1.7, sodium_mg: 4 },
    origin: "Bred from regular onions for size and uniformity; Dutch and French cooks made them famous as garnish onions.",
    culturalNotes: "The bourguignon question: traditional recipe calls for ~20 pearl onions per serving, each individually peeled. Frozen pre-peeled is the modern grace.",
    allergens: [],
    seasonality: { peakMonths: [8, 9, 10] },
    sourcing: "Frozen pearl onions are the move for braises — already peeled, consistent sizing, half the price of fresh. Fresh for spring peas + new pearl onions is worth the peeling penance.",
  },

  basil: {
    description: "Sweet Italian herb with large, tender leaves. The summer-tomato herb, the pesto herb, the herb you add last so it doesn't blacken.",
    flavorProfile: "Sweet, peppery, aniseed; clove-ish on the back end; turns soapy and thin if heated too long",
    prepTips: "Tear, don't chop — oxidation blackens cut edges. Add at the very end or scatter raw on top. For pesto, blanch 10 seconds + ice-shock to lock the color in.",
    storage: {
      location: "pantry",
      shelfLifeDays: 7,
      tips: "Never refrigerate — basil blackens in the cold. Stand stems in a glass of water on the counter like cut flowers; covers loose with a bag over the leaves.",
    },
    substitutions: [
      { id: "parsley", note: "Different flavor entirely but works in a pinch as a soft green garnish." },
      { id: "thai_basil", note: "For Asian dishes — stronger, spicier, anise-forward." },
    ],
    pairs: ["tomato", "mozzarella", "olive_oil", "garlic"],
    nutrition: { per: "100g", kcal: 23, protein_g: 3.2, fat_g: 0.6, carb_g: 2.7, fiber_g: 1.6, sodium_mg: 4 },
    origin: "India and Southeast Asia originally; the Italian Genovese cultivar is what pasta built its reputation on.",
    culturalNotes: "Pesto alla Genovese is protected DOP — real basilico Genovese grown near the coast has smaller leaves and less mint character than what most of us grow.",
    allergens: [],
    seasonality: { peakMonths: [6, 7, 8, 9] },
    sourcing: "Greenhouse basil year-round is fine; summer's farmers-market basil is incomparably better. A pot on the windowsill is almost always worth it.",
  },

  parsley: {
    description: "Flat-leaf (Italian) parsley is the workhorse herb in Western kitchens — brighter than you remember, and not the garnish you scraped off your diner plate.",
    flavorProfile: "Clean, grassy, peppery; refreshing bitter edge that cuts through fat",
    prepTips: "Chop LESS than you think — over-chopped parsley is mushy and bruised. A quick mince with a sharp knife is better than a rough chop. Use stems in stocks and dressings; they're more flavorful than the leaves.",
    storage: {
      location: "fridge",
      shelfLifeDays: 10,
      tips: "Wrap stems in a damp paper towel inside a zip-top bag, or stand in a glass of water with the leaves covered loosely. Refreshes wilted parsley in 30 minutes.",
    },
    substitutions: [
      { id: "cilantro", note: "Different profile (citrusy, divisive) but similar green-brightener role." },
      { id: "chervil", note: "Finer, aniseed-tinged. Use in French preparations where the parsley was already subtle." },
    ],
    pairs: ["garlic", "lemon", "olive_oil", "butter"],
    nutrition: { per: "100g", kcal: 36, protein_g: 3, fat_g: 0.8, carb_g: 6.3, fiber_g: 3.3, sodium_mg: 56 },
    origin: "Mediterranean. The ancient Greeks made parsley wreaths for athletic victors; 'requiring parsley' was a Greek euphemism for the gravely ill (parsley grew on graves).",
    culturalNotes: "Curly-leaf parsley is what ended up on every steakhouse plate in the 1970s. Flat-leaf (Italian) is for actual cooking — stronger flavor, easier to chop.",
    allergens: [],
    seasonality: { peakMonths: [5, 6, 7, 8, 9] },
    sourcing: "Flat-leaf for cooking, always. Curly is fine for decoration. Bunches should be perky, not slimy or yellowing at the base.",
  },

  cilantro: {
    description: "Fresh coriander leaves — the herb that Mexican, Thai, Vietnamese, and North African cuisines lean on hardest. Divisive: a small fraction of people taste soap (a genetic variant of the OR6A2 olfactory receptor).",
    flavorProfile: "Bright, citrusy, soapy-to-some, fresh; cools and lifts fatty or spicy dishes",
    prepTips: "Chop stems and leaves — stems carry more flavor than the leaves and are common in Thai/Mexican cooking. Add at the very end; cilantro wilts to mush with any real heat.",
    storage: {
      location: "fridge",
      shelfLifeDays: 10,
      tips: "Stand stems in a glass of water, loose bag over the top. Or wrap in slightly damp paper towel inside a zip-top. Slimy cilantro is a total loss — no rescue.",
    },
    substitutions: [
      { id: "parsley", note: "Closest visual match; entirely different flavor. Use if cilantro allergy/aversion is in play." },
    ],
    pairs: ["lime", "garlic", "jalapeno", "avocado"],
    nutrition: { per: "100g", kcal: 23, protein_g: 2.1, fat_g: 0.5, carb_g: 3.7, fiber_g: 2.8, sodium_mg: 46 },
    origin: "Eastern Mediterranean and Central Asia. One of the oldest cultivated herbs — seeds (coriander) found in Egyptian tombs.",
    culturalNotes: "The soap-taste haters are genuine — roughly 4–14% of people depending on heritage, due to a gene variant. Not picky eaters; literally a different sensory experience.",
    allergens: [],
    seasonality: { peakMonths: [5, 6, 7, 8] },
    sourcing: "Bunches should be vibrant green with no slime at the base. 'Culantro' (recao) is a stronger, sturdier cousin used in Caribbean cooking — a legit substitute if you can find it.",
  },
};

// Look up display info for an ingredient — ingredient-specific fields win,
// subcategory fallback fills the gaps. Returns null-safe defaults for
// every schema field so the UI can safely read `info.storage?.location`
// without per-key existence checks.
//
// When adding a new metadata field: add it to INGREDIENT_INFO entries,
// extend this merge, and add a render branch in IngredientCard. The
// empty-return shape below documents every surface-level key the UI can
// rely on.
export function getIngredientInfo(ingredient) {
  if (!ingredient) return null;
  const sub = ingredient.subcategory ? SUBCATEGORY_INFO[ingredient.subcategory] : null;
  const ing = INGREDIENT_INFO[ingredient.id] || null;
  return {
    // ── cooking-centric ────────────────────────────────────────────────
    description:    ing?.description    || sub?.description    || null,
    flavorProfile:  ing?.flavorProfile  || sub?.flavorProfile  || null,
    prepTips:       ing?.prepTips       || sub?.prepTips       || null,
    storage:        ing?.storage        || sub?.storage        || null,
    substitutions:  ing?.substitutions  || sub?.substitutions  || [],
    pairs:          ing?.pairs          || sub?.pairs          || [],
    clashes:        ing?.clashes        || sub?.clashes        || [],
    // ── nutrition ──────────────────────────────────────────────────────
    nutrition:      ing?.nutrition      || sub?.nutrition      || null,
    // ── social / cultural ──────────────────────────────────────────────
    origin:         ing?.origin         || sub?.origin         || null,
    culturalNotes:  ing?.culturalNotes  || sub?.culturalNotes  || null,
    winePairings:   ing?.winePairings   || sub?.winePairings   || [],
    recipes:        ing?.recipes        || sub?.recipes        || [],
    // ── sourcing / allergens / seasonality ─────────────────────────────
    allergens:      ing?.allergens      || sub?.allergens      || [],
    seasonality:    ing?.seasonality    || sub?.seasonality    || null,
    sourcing:       ing?.sourcing       || sub?.sourcing       || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual-entry price estimation.
//
// When the user types "milk, 1 gallon" into the Add modal (no receipt in
// play), we still want a reasonable dollar amount so monthly spend and the
// pantry tile are useful. Each ingredient carries its own
// `estCentsPerBase` (cents per 1 unit of its base — g for mass, ml for
// volume, count for count). If an ingredient doesn't have one we return
// null rather than pretending: a nonsense estimate is worse than none.
// ─────────────────────────────────────────────────────────────────────────────

// Returns an estimated integer cents for { amount, unit } of `ingredient`,
// or null if the ingredient isn't priced yet or the inputs are nonsense.
export function estimatePriceCents({ amount, unit, ingredient }) {
  if (!ingredient || !amount) return null;
  const rate = ingredient.estCentsPerBase;
  if (rate == null) return null;
  const baseQty = toBase({ amount, unit }, ingredient);
  if (!Number.isFinite(baseQty) || baseQty <= 0) return null;
  return Math.max(1, Math.round(baseQty * rate));
}

export function compareQty({ have, need, lowThreshold, ingredient }) {
  const haveBase = toBase(have, ingredient);
  const needBase = toBase(need, ingredient);
  if (Number.isNaN(haveBase) || Number.isNaN(needBase)) return "unknown";
  if (haveBase < needBase) return "missing";
  const thresholdBase = lowThreshold != null
    ? toBase({ amount: lowThreshold, unit: have.unit }, ingredient)
    : 0;
  if (haveBase - needBase <= thresholdBase) return "low";
  return "ok";
}
