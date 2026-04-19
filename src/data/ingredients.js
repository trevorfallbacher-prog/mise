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
//     location:     "fridge" | "pantry" | "freezer"      (primary / default)
//     shelfLifeDays:number (approximate; use the loosely-safe number)
//     shelfLife: {                                        (v2 — optional)
//       fridge:  number | null,
//       freezer: number | null,
//       pantry:  number | null,
//     }
//     tips:         "…"    (optional, e.g. "Wrap in parchment, not plastic")
//     spoilageSigns:"Slimy, sour smell, mold on top — toss." (v2, optional)
//     freezable:    boolean                                (v2, optional)
//     freezeNotes:  "In portioned zip-top bags, 6 months." (v2, optional)
//     prepYield: {                                         (v2, optional)
//       whole:  "1 medium onion",
//       yields: "~1 cup diced",
//     }
//   }
//   substitutions: [
//     // tier is optional; defaults to "direct" when omitted. (v2)
//     { id: "pecorino", tier: "direct"|"emergency"|"dietary"|"pro", note: "…" }, …
//   ]
//   irreplaceable:     boolean    (v2 — true when no real sub exists)
//   irreplaceableNote: "Saffron is saffron. No sub works."   (v2, optional)
//   pairs:         [otherIngredientId, …]  — classic complements
//   clashes:       [otherIngredientId, …]  — classic conflicts (rare)
//
//   ── Flavor (structured, v2) ─────────────────────────────────────────
//   // flavorProfile (the one-line string) stays as-is. This object is for
//   // filtering, pairing suggestions, and "how it tastes when cooked".
//   flavor: {
//     primary:   [ "sweet" | "sour" | "salt" | "bitter" | "umami" | "fat" | "heat", … ]
//     intensity: "mild" | "moderate" | "strong" | "aggressive"
//     heatChange: {
//       raw:     "grassy, sharp",
//       cooked:  "nutty, caramelized",
//       charred: "bitter with smoky depth",
//     }
//   }
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
//   allergens:     ["dairy","gluten","treenut","peanut","egg","shellfish",
//                   "soy","sesame","sulfites","mustard","fish"]
//   // v2: optional specificity — which tree nuts, which shellfish, etc.
//   allergenDetail:{ treenut: ["almond","hazelnut"], shellfish: ["shrimp"] }
//   seasonality: {
//     peakMonthsN:        [5,6,7,8]    — northern-hemisphere peak (1..12)
//     peakMonthsS:        [11,12,1,2]  — southern-hemisphere peak  (v2)
//     yearRound:          boolean       (v2)
//     preservedAvailable: boolean       (v2 — canned/frozen works year-round)
//   }
//   sourcing:      "Look for grass-fed / wild-caught / …"
//
//   ── Dietary / lifestyle flags (v2) ───────────────────────────────────
//   diet: {
//     vegan:      boolean,
//     vegetarian: boolean,     (vegan implies vegetarian)
//     keto:       boolean,     (<5g net carbs per reference serving)
//     halal:      boolean,     (default true; false for pork/alcohol/…)
//     kosher:     "meat" | "dairy" | "pareve" | "nonkosher",
//     fodmap:     "low" | "moderate" | "high",
//     nightshade: boolean,     (tomato, pepper, eggplant, potato)
//     allium:     boolean,     (onion/garlic family)
//   }
//
//   ── Market intelligence (structured, v2) ─────────────────────────────
//   // sourcing (prose) stays as-is. `market` is for filters and chips.
//   market: {
//     priceTier:     "budget" | "moderate" | "premium" | "luxury",
//     availability:  "supermarket" | "specialty" | "online" | "seasonal",
//     organicCommon: boolean,
//     qualityMatters:boolean,   (cheap version ruins the dish)
//     qualityNote:   "Generic parmesan doesn't behave like Parmigiano.",
//   }
//
//   ── Skill + course links (v2) ────────────────────────────────────────
//   skillDev: {
//     skills:              [skillId, …]   — references src/data/index.js skills
//     difficulty:          "easy" | "moderate" | "technical" | "expert",
//     proFromScratch:      boolean,       — can be made at home by a pro
//     fromScratchRecipeId: "homemade_stock" | null,
//   }
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
    // `chicken` is the BASE canonical (the species). Whether a
    // specific pantry row is "whole," "ground," "diced," etc. is
    // carried on pantry_items.state (a separate axis per CLAUDE.md
    // identity hierarchy). Previously the display read "Chicken
    // (whole)" which baked state into the name; shortName is now
    // empty so the registry isn't lying about its role.
    id: "chicken", name: "Chicken", shortName: null,
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
    // BASE canonical for all beef cuts / forms. Pantry rows carry
    // state (ground, whole, cubed, etc.) on the state column —
    // NOT as a separate canonical. Legacy `ground_beef` slug is
    // aliased below to this canonical + state='ground'.
    id: "beef", name: "Beef", shortName: "Beef",
    parentId: "beef_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "kg", label: "kg", toBase: 1000 },
    ],
    defaultUnit: "lb",
  },
  {
    // DEPRECATED — state ("ground") baked into canonical id. Kept
    // in the registry for back-compat so findIngredient continues
    // to resolve old pantry_items rows; CANONICAL_ALIASES routes
    // this slug to { base: "beef", state: "ground" }. Migration
    // 0060 rewrites existing rows to the base slug. New code
    // should NOT reference this id.
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
    // BASE canonical for all pork cuts / forms. See beef comment
    // above — same pattern. Aliased slugs: ground_pork.
    id: "pork", name: "Pork", shortName: "Pork",
    parentId: "pork_hub", emoji: "🥩", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "kg", label: "kg", toBase: 1000 },
    ],
    defaultUnit: "lb",
  },
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
    // DEPRECATED — see ground_beef. Aliased to { base: "pork",
    // state: "ground" }. Migration 0060 rewrites existing rows.
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
    id: "hot_dog", name: "Hot Dog", shortName: "Hot Dog",
    parentId: "pork_hub", emoji: "🌭", category: "meat",
    units: [
      { id: "count", label: "dogs", toBase: 50 },
      { id: "pack",  label: "packs", toBase: 400 }, // ~8 per pack
      { id: "lb",    label: "lb",    toBase: 453.6 },
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
    // BASE canonical for all turkey cuts / forms. See beef comment
    // above — same pattern. Aliased slugs: ground_turkey.
    id: "turkey", name: "Turkey", shortName: "Turkey",
    parentId: "turkey_hub", emoji: "🦃", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "kg", label: "kg", toBase: 1000 },
    ],
    defaultUnit: "lb",
  },
  {
    // DEPRECATED — see ground_beef. Aliased to { base: "turkey",
    // state: "ground" }. Migration 0060 rewrites existing rows.
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
    id: "green_onion", name: "Green Onion", shortName: "Green Onion",
    emoji: "🌱", category: "produce",
    units: [
      { id: "count", label: "stalks",  toBase: 1 },
      { id: "bunch", label: "bunches", toBase: 8 },
    ],
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
  // Flours — hub member registry. Protein content varies dramatically
  // across types and drives gluten behavior, so they are NOT
  // interchangeable in baking. The hub groups them for the picker
  // while keeping each as a first-class canonical for recipe matching.
  {
    id: "flour", name: "All-Purpose Flour", shortName: "All-Purpose",
    parentId: "flour_hub", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 120 },
      { id: "tbsp", label: "tbsp", toBase: 7.5 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "bread_flour", name: "Bread Flour", shortName: "Bread",
    parentId: "flour_hub", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 120 },
      { id: "tbsp", label: "tbsp", toBase: 7.5 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "whole_wheat_flour", name: "Whole Wheat Flour", shortName: "Whole Wheat",
    parentId: "flour_hub", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 120 },
      { id: "tbsp", label: "tbsp", toBase: 7.5 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "pastry_flour", name: "Pastry Flour", shortName: "Pastry",
    parentId: "flour_hub", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 120 },
      { id: "tbsp", label: "tbsp", toBase: 7.5 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "cake_flour", name: "Cake Flour", shortName: "Cake",
    parentId: "flour_hub", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 120 },
      { id: "tbsp", label: "tbsp", toBase: 7.5 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "zero_zero_flour", name: "00 Flour", shortName: "00",
    parentId: "flour_hub", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 120 },
      { id: "tbsp", label: "tbsp", toBase: 7.5 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "kg",   label: "kg",   toBase: 1000 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "semolina", name: "Semolina Flour", shortName: "Semolina",
    parentId: "flour_hub", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 160 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "rice_flour", name: "Rice Flour", shortName: "Rice",
    parentId: "flour_hub", emoji: "🌾", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 160 },
      { id: "tbsp", label: "tbsp", toBase: 10 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "almond_flour", name: "Almond Flour", shortName: "Almond",
    parentId: "flour_hub", emoji: "🌰", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 96 },
      { id: "tbsp", label: "tbsp", toBase: 6 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "coconut_flour", name: "Coconut Flour", shortName: "Coconut",
    parentId: "flour_hub", emoji: "🥥", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 112 },
      { id: "tbsp", label: "tbsp", toBase: 7 },
      { id: "g",    label: "g",    toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "cornmeal", name: "Cornmeal", shortName: "Cornmeal",
    parentId: "flour_hub", emoji: "🌽", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 140 },
      { id: "tbsp", label: "tbsp", toBase: 9 },
      { id: "g",    label: "g",    toBase: 1 },
      { id: "lb",   label: "lb",   toBase: 453.6 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "masa_harina", name: "Masa Harina", shortName: "Masa",
    parentId: "flour_hub", emoji: "🌽", category: "pantry",
    units: [
      { id: "cup",  label: "cups", toBase: 120 },
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
  {
    // Generic pasta fallback for "I just have pasta" / recipe-matching
    // when the user's item doesn't specify a shape. Sits alongside the
    // specific cuts — recipes calling for "pasta" match this OR any
    // of the specific members (via the hub membership).
    id: "pasta", name: "Pasta", shortName: "Pasta",
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
    id: "cavatappi", name: "Cavatappi", shortName: "Cavatappi",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "fusilli", name: "Fusilli", shortName: "Fusilli",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "rotini", name: "Rotini", shortName: "Rotini",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "farfalle", name: "Farfalle", shortName: "Bow-Tie",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "macaroni", name: "Elbow Macaroni", shortName: "Macaroni",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
      { id: "cup", label: "cups",  toBase: 140 },
    ],
    defaultUnit: "box",
  },
  {
    id: "bucatini", name: "Bucatini", shortName: "Bucatini",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "linguine", name: "Linguine", shortName: "Linguine",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "angel_hair", name: "Angel Hair", shortName: "Angel Hair",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "ziti", name: "Ziti", shortName: "Ziti",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "orecchiette", name: "Orecchiette", shortName: "Orecchiette",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "box", label: "boxes", toBase: 454 },
    ],
    defaultUnit: "box",
  },
  {
    id: "tortellini", name: "Tortellini", shortName: "Tortellini",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "pkg", label: "pkgs",  toBase: 255 },  // ~9oz fresh pkg
    ],
    defaultUnit: "pkg",
  },
  {
    id: "ravioli", name: "Ravioli", shortName: "Ravioli",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "pkg", label: "pkgs",  toBase: 255 },
    ],
    defaultUnit: "pkg",
  },
  {
    id: "gnocchi", name: "Gnocchi", shortName: "Gnocchi",
    parentId: "pasta_hub", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz",  label: "oz",    toBase: 28.35 },
      { id: "lb",  label: "lb",    toBase: 453.6 },
      { id: "pkg", label: "pkgs",  toBase: 500 },  // ~1.1lb shelf-stable pkg
    ],
    defaultUnit: "pkg",
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
      { id: "tsp",    label: "tsp",     toBase: 5 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "bottle",
    estCentsPerBase: 0.7, // ~$4 for a 15oz Kikkoman
  },
  {
    // Compound ingredient — bottled sriracha is one product, homemade is
    // another with the same id. Links to the "sriracha" scratch recipe
    // via skillDev.fromScratchRecipeId (Phase 1 of the compound work).
    id: "sriracha", name: "Sriracha", emoji: "🌶️", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 482 }, // ~17 fl oz classic Huy Fong
      { id: "tbsp",   label: "tbsp",    toBase: 15 },
      { id: "tsp",    label: "tsp",     toBase: 5 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "bottle",
    estCentsPerBase: 2.0, // ~$8–10 for the 28oz rooster bottle
  },
  {
    // Compound ingredient — jarred pesto varies wildly by brand; the
    // scratch recipe produces a ~1 cup yield. Category "pantry" for
    // shelf placement purposes; physical location defaults to fridge
    // after opening (or after making).
    id: "pesto", name: "Pesto", emoji: "🌿", category: "pantry",
    units: [
      { id: "jar",    label: "jars",    toBase: 180 }, // ~6 oz supermarket jar
      { id: "cup",    label: "cups",    toBase: 240 },
      { id: "tbsp",   label: "tbsp",    toBase: 15 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "jar",
    estCentsPerBase: 5.5, // ~$8–10 for a 6 oz jar of the decent stuff
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
  // ── condiments batch 2: Asian staples ──────────────────────────────
  {
    id: "fish_sauce", name: "Fish Sauce", emoji: "🐟", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 700 }, // ~24oz glass
      { id: "tbsp",   label: "tbsp",    toBase: 15 },
      { id: "tsp",    label: "tsp",     toBase: 5 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "bottle",
    estCentsPerBase: 1.0, // ~$6–10 for a 24oz Red Boat
  },
  {
    id: "miso", name: "Miso Paste", emoji: "🍲", category: "pantry",
    units: [
      { id: "tub",    label: "tubs",    toBase: 500 }, // ~17oz standard
      { id: "cup",    label: "cups",    toBase: 250 },
      { id: "tbsp",   label: "tbsp",    toBase: 17 },
      { id: "tsp",    label: "tsp",     toBase: 5.7 },
    ],
    defaultUnit: "tub",
    estCentsPerBase: 1.6, // ~$8–10 for the Hikari tub
  },
  {
    id: "hoisin", name: "Hoisin Sauce", emoji: "🥢", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 553 }, // ~19.5oz Lee Kum Kee
      { id: "tbsp",   label: "tbsp",    toBase: 18 },
      { id: "tsp",    label: "tsp",     toBase: 6 },
    ],
    defaultUnit: "bottle",
    estCentsPerBase: 0.7, // ~$4–5 LKK bottle
  },
  {
    id: "mirin", name: "Mirin", emoji: "🍶", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 300 }, // 10oz typical
      { id: "tbsp",   label: "tbsp",    toBase: 15 },
      { id: "tsp",    label: "tsp",     toBase: 5 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "bottle",
    estCentsPerBase: 1.8, // ~$5–8 depending on real-hon-mirin vs. aji-mirin
  },
  {
    id: "oyster_sauce", name: "Oyster Sauce", emoji: "🦪", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 510 }, // ~18oz LKK Premium
      { id: "tbsp",   label: "tbsp",    toBase: 18 },
      { id: "tsp",    label: "tsp",     toBase: 6 },
    ],
    defaultUnit: "bottle",
    estCentsPerBase: 0.9, // ~$5 LKK Premium
  },
  // ── condiments batch 1: American staples ────────────────────────────
  {
    id: "mayo", name: "Mayonnaise", emoji: "🥚", category: "pantry",
    units: [
      { id: "jar",    label: "jars",    toBase: 887 }, // 30oz standard Hellmann's
      { id: "cup",    label: "cups",    toBase: 220 },
      { id: "tbsp",   label: "tbsp",    toBase: 14 },
      { id: "tsp",    label: "tsp",     toBase: 4.7 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "jar",
    estCentsPerBase: 0.8, // ~$6–8 for a 30oz jar
  },
  {
    id: "ketchup", name: "Ketchup", emoji: "🥫", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 567 }, // 20oz squeeze bottle
      { id: "tbsp",   label: "tbsp",    toBase: 17 },
      { id: "tsp",    label: "tsp",     toBase: 5.7 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "bottle",
    estCentsPerBase: 0.6, // ~$3–4 for a 20oz Heinz
  },
  {
    id: "mustard", name: "Yellow Mustard", emoji: "🟡", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 397 }, // 14oz squeeze
      { id: "tbsp",   label: "tbsp",    toBase: 15 },
      { id: "tsp",    label: "tsp",     toBase: 5 },
    ],
    defaultUnit: "bottle",
    estCentsPerBase: 0.5, // ~$2–3 for a standard yellow mustard
  },
  {
    id: "hot_sauce", name: "Hot Sauce", emoji: "🌶️", category: "pantry",
    units: [
      { id: "bottle", label: "bottles", toBase: 148 }, // ~5oz Tabasco-size bottle
      { id: "tbsp",   label: "tbsp",    toBase: 15 },
      { id: "tsp",    label: "tsp",     toBase: 5 },
      { id: "fl_oz",  label: "fl oz",   toBase: 29.57 },
    ],
    defaultUnit: "bottle",
    estCentsPerBase: 2.5, // ~$4–5 for a 5oz bottle; varies wildly by brand
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
  // ── spices & dried herbs ────────────────────────────────────────────
  //
  // The home-cook spice rack. Every entry here is the DRIED / GROUND
  // shelf-stable form — fresh basil, fresh thyme, etc. live under
  // produce and route to the fridge's Fresh Herbs tile. Category is
  // "pantry" so the default-location heuristic doesn't try to stash
  // garlic powder in the fridge.

  // ── TIER 1: the absolute basics ──
  // Every kitchen has these — the "salt pepper garlic" tier plus
  // the half-dozen spices that power 80% of home cooking.
  ...[
    // Salts
    ["kosher_salt",     "Kosher Salt",            "🧂"],
    ["sea_salt",        "Sea Salt",               "🧂"],
    ["table_salt",      "Table Salt",             "🧂"],
    ["flaky_salt",      "Flaky Salt",             "🧂"],
    // Peppers
    ["black_pepper",    "Black Pepper",           "🫚"],
    ["white_pepper",    "White Pepper",           "⚪"],
    ["peppercorns",     "Peppercorns",            "⚫"],
    // Core ground spices
    ["paprika",         "Paprika",                "🟠"],
    ["smoked_paprika",  "Smoked Paprika",         "🟠"],
    ["sweet_paprika",   "Sweet Paprika",          "🟠"],
    ["cayenne",         "Cayenne Pepper",         "🌶️"],
    ["chili_powder",    "Chili Powder",           "🌶️"],
    ["red_pepper_flakes","Red Pepper Flakes",     "🌶️"],
    ["cumin",           "Cumin",                  "🟤"],
    ["ground_cumin",    "Ground Cumin",           "🟤"],
    ["cumin_seed",      "Cumin Seeds",            "🟤"],
    ["coriander",       "Ground Coriander",       "🟤"],
    ["ground_coriander","Ground Coriander Seeds", "🟤"],
    ["cinnamon",        "Cinnamon",               "🟤"],
    ["ground_cinnamon", "Ground Cinnamon",        "🟤"],
    ["turmeric",        "Turmeric",               "🟡"],
    ["oregano",         "Oregano",                "🌿"],
    ["dried_oregano",   "Dried Oregano",          "🌿"],
    ["bay_leaves",      "Bay Leaves",             "🍃"],
  ].map(([id, name, emoji]) => ({
    id, name, emoji, category: "pantry",
    units: id === "bay_leaves"
      ? [{ id: "count", label: "leaves", toBase: 1 }, { id: "pack", label: "packs", toBase: 14 }]
      : [{ id: "tsp", label: "tsp", toBase: 1 }, { id: "tbsp", label: "tbsp", toBase: 3 }, { id: "oz", label: "oz", toBase: 6 }, { id: "jar", label: "jars", toBase: 12 }],
    defaultUnit: id === "bay_leaves" ? "pack" : "jar",
  })),

  // ── TIER 2: well-stocked home cook ──
  ...[
    ["cardamom",        "Cardamom",               "🟢"],
    ["cloves",          "Cloves",                 "🟤"],
    ["nutmeg",          "Nutmeg",                 "🟤"],
    ["allspice",        "Allspice",               "🟤"],
    ["star_anise",      "Star Anise",             "⭐"],
    ["fennel_seed",     "Fennel Seeds",           "🟢"],
    ["mustard_seed",    "Mustard Seeds",          "🟡"],
    ["curry_powder",    "Curry Powder",           "🟡"],
    ["garam_masala",    "Garam Masala",           "🟤"],
  ].map(([id, name, emoji]) => ({
    id, name, emoji, category: "pantry",
    units: (id === "star_anise")
      ? [{ id: "count", label: "pods", toBase: 1 }, { id: "tsp", label: "tsp", toBase: 2 }, { id: "jar", label: "jars", toBase: 20 }]
      : [{ id: "tsp", label: "tsp", toBase: 1 }, { id: "tbsp", label: "tbsp", toBase: 3 }, { id: "oz", label: "oz", toBase: 6 }, { id: "jar", label: "jars", toBase: 12 }],
    defaultUnit: id === "star_anise" ? "jar" : "jar",
  })),

  // ── TIER 3: powders, dried herbs, seasoning salts, seeds, blends ──
  // (garlic_powder, onion_powder, dried_thyme, italian_seasoning, etc.)
  ...[
    ["garlic_powder",       "Garlic Powder",          "🧄"],
    ["onion_powder",        "Onion Powder",           "🧅"],
    ["ginger_powder",       "Ground Ginger",          "🫚"],
    ["italian_seasoning",   "Italian Seasoning",      "🌿"],
    ["herbs_de_provence",   "Herbes de Provence",     "🌿"],
    ["dried_thyme",         "Dried Thyme",            "🌿"],
    ["dried_rosemary",      "Dried Rosemary",         "🌿"],
    ["dried_sage",          "Dried Sage",             "🌿"],
    ["dried_basil",         "Dried Basil",            "🌿"],
    ["dried_parsley",       "Dried Parsley",          "🌿"],
    ["dried_dill",          "Dried Dill",             "🌿"],
    ["dried_tarragon",      "Dried Tarragon",         "🌿"],
    ["dried_marjoram",      "Dried Marjoram",         "🌿"],
    ["celery_salt",         "Celery Salt",            "🧂"],
    ["garlic_salt",         "Garlic Salt",            "🧂"],
    ["onion_salt",          "Onion Salt",             "🧂"],
    ["seasoned_salt",       "Seasoned Salt",          "🧂"],
    ["msg",                 "MSG",                    "🧂"],
    ["saffron",             "Saffron",                "🌸"],
    ["five_spice",          "Chinese Five Spice",     "🧂"],
    ["taco_seasoning",      "Taco Seasoning",         "🌮"],
    ["ranch_seasoning",     "Ranch Seasoning",        "🥗"],
    ["everything_bagel",    "Everything Bagel Seasoning","🥯"],
    ["lemon_pepper",        "Lemon Pepper",           "🍋"],
    ["cajun_seasoning",     "Cajun Seasoning",        "🌶️"],
    ["jerk_seasoning",      "Jerk Seasoning",         "🌶️"],
    ["ras_el_hanout",       "Ras el Hanout",          "🧂"],
    ["berbere",             "Berbere",                "🌶️"],
    ["dukkah",              "Dukkah",                 "🥜"],
    ["furikake",            "Furikake",               "🍚"],
    ["togarashi",           "Shichimi Togarashi",     "🌶️"],
    ["ground_mustard",      "Ground Mustard",         "🟡"],
    ["cream_of_tartar",     "Cream of Tartar",        "🧂"],
    ["poppy_seed",          "Poppy Seeds",            "🌸"],
    ["caraway_seed",        "Caraway Seeds",          "🧂"],
    ["celery_seed",         "Celery Seed",            "🧂"],
    ["dried_chives",        "Dried Chives",           "🌿"],
    ["dried_mint",          "Dried Mint",             "🌿"],
    ["white_sesame",        "White Sesame Seeds",     "🫘"],
    ["black_sesame",        "Black Sesame Seeds",     "🫘"],
    ["mace",                "Mace",                   "🧂"],
    ["fenugreek",           "Fenugreek",              "🧂"],
    ["juniper_berries",     "Juniper Berries",        "🫐"],
    ["annatto",             "Annatto Seeds",          "🟠"],
    ["smoked_salt",         "Smoked Salt",            "🧂"],
    ["truffle_salt",        "Truffle Salt",           "🧂"],
    ["old_bay",             "Old Bay Seasoning",      "🦀"],
    ["zaatar",              "Za'atar",                "🌿"],
    ["sumac",               "Sumac",                  "🟣"],
  ].map(([id, name, emoji]) => ({
    id, name, emoji, category: "pantry",
    units: [
      { id: "tsp",  label: "tsp",  toBase: 1 },
      { id: "tbsp", label: "tbsp", toBase: 3 },
      { id: "oz",   label: "oz",   toBase: 6 },
      { id: "jar",  label: "jars", toBase: 12 },
    ],
    defaultUnit: "jar",
  })),
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

// Canonical aliases — legacy slugs where STATE was baked into the
// canonical id ("ground_beef", "ground_pork", "ground_turkey").
// Per CLAUDE.md the identity hierarchy keeps state as a SEPARATE
// axis (purple), so these deprecated slugs resolve to the BASE
// canonical + a state hint. findIngredient falls through so
// pantry_items rows written under an old slug still render
// correctly until migration 0060 rewrites them to the base.
//
// Shape: { [legacySlug]: { base: <baseSlug>, state: <stateToken> } }
export const CANONICAL_ALIASES = {
  ground_beef:   { base: "beef",   state: "ground" },
  ground_pork:   { base: "pork",   state: "ground" },
  ground_turkey: { base: "turkey", state: "ground" },
};

/**
 * Look up an ingredient by slug. Transparently resolves aliased
 * legacy slugs (ground_beef → beef). Returns null when the slug
 * doesn't match any bundled canonical OR alias.
 *
 * This keeps existing pantry_items.canonical_id values working
 * even after migration 0060 rewrites them; the deprecated slugs
 * resolve to the same underlying ingredient object.
 */
export function findIngredient(id) {
  if (!id) return null;
  const alias = CANONICAL_ALIASES[id];
  if (alias) return byId.get(alias.base) || null;
  return byId.get(id) || null;
}

/**
 * Resolve a canonical slug into its { canonical, state } pair.
 * Callers that want the state axis (pantry row hydration, UI
 * chips) use this instead of findIngredient's flattening lookup.
 *
 * Non-aliased slugs return the slug with state = null so callers
 * can treat every identity uniformly.
 */
export function resolveCanonicalIdentity(id) {
  if (!id) return { canonical: null, state: null };
  const alias = CANONICAL_ALIASES[id];
  if (alias) return { canonical: alias.base, state: alias.state };
  return { canonical: id, state: null };
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
    // Flour hub (chunk 13c) — protein content varies dramatically
    // across types (all-purpose ~11%, bread ~13%, cake ~8%, 00 varies),
    // and they are NOT 1:1 interchangeable in baking. Grouping them
    // under a hub keeps the picker manageable while preserving each
    // as a first-class canonical for recipe matching.
    id: "flour_hub",
    name: "Flour",
    emoji: "🌾",
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

// Lookup table for canonical inference: lowercase name/shortName →
// ingredient id. Built lazily so it's a one-time cost on first use.
// Only includes tokens ≥ 3 chars to avoid spurious matches
// ("a"/"i" would fire on almost anything).
let _canonicalAliasMap = null;
function getCanonicalAliasMap() {
  if (_canonicalAliasMap) return _canonicalAliasMap;
  const map = new Map();
  for (const ing of INGREDIENTS) {
    const tokens = [ing.name, ing.shortName].filter(Boolean);
    for (const t of tokens) {
      const key = t.toLowerCase().trim();
      if (key.length < 3) continue;
      // Keep the FIRST match if duplicate names exist — preserves
      // registry order (specifics before generics when carefully
      // ordered). "Sausage" (specific) wins over a hypothetical
      // broader "Sausage / whatever" appearing later.
      if (!map.has(key)) map.set(key, ing.id);
    }
  }
  _canonicalAliasMap = map;
  return map;
}

/**
 * Infer the most-specific canonical ingredient id from a free-text
 * name. Returns the id or null. Longest-matching alias wins; ties
 * break on registry order.
 *
 * Example:
 *   "Oscar Mayer Bratwurst"        → 'sausage' (no bratwurst canonical;
 *                                   falls through to type default)
 *   "Mama Bear's Green Onion"      → 'green_onion'
 *   "Franks Best Cheese Dogs"      → 'hot_dog'
 *   "Home Run Inn Pizza"           → null  (no pizza canonical yet)
 *   "random text"                  → null
 *
 * Pair with canonicalIdForType (foodTypes.js) — name-based wins when
 * it fires, type default fires otherwise.
 */
export function inferCanonicalFromName(name) {
  const lower = (name || "").toLowerCase().trim();
  if (lower.length < 3) return null;
  const map = getCanonicalAliasMap();
  let bestId = null;
  let bestLen = 0;
  for (const [alias, id] of map) {
    if (alias.length < 3) continue;
    if (!lower.includes(alias)) continue;
    if (alias.length > bestLen) {
      bestId = id;
      bestLen = alias.length;
    }
  }
  return bestId;
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
      shelfLife: { fridge: 90, freezer: 365, pantry: null },
      tips: "Wrap tightly — butter absorbs fridge odors. Freezes beautifully for up to a year in its original wrap plus a zip-top bag.",
      spoilageSigns: "Yellow waxy surface, off smell, rancid-nut aroma. Mold along an exposed edge — trim an inch off or toss.",
      freezable: true,
      freezeNotes: "In its original wrapper inside a zip-top bag. 1 year; no quality loss.",
    },
    substitutions: [
      { id: "ghee",      tier: "direct",    note: "Pure butterfat — no milk solids. Higher smoke point, no burning." },
      { id: "olive_oil", tier: "emergency", note: "For savory sautés; loses the browning and enrichment." },
    ],
    pairs: ["garlic", "parsley", "lemon", "sage"],
    flavor: {
      primary: ["fat", "salt"],
      intensity: "moderate",
      heatChange: {
        raw: "cool, creamy, barely-there sweetness",
        cooked: "rich, silky, aromatic — brown-butter notes develop around 150°C",
        charred: "burned milk solids turn bitter fast; black specks = start over",
      },
    },
    nutrition: { per: "100g", kcal: 717, protein_g: 1, fat_g: 81, carb_g: 0, sodium_mg: 11 },
    origin: "Europe; churned butter dates to at least 4,500 BCE in cooler dairy-herding cultures.",
    culturalNotes: "French cuisine built its reputation on butter; Mediterranean cuisines lean on olive oil — the same dish (fish, vegetables, pasta) tells a different story depending which fat carries it.",
    allergens: ["dairy"],
    diet: { vegan: false, vegetarian: true, keto: true, halal: true, kosher: "dairy", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "European-style (≥82% fat) makes richer sauces and flakier pastry; American-style is fine for everyday cooking and has more water for stovetop sautés.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Kerrygold, Plugra, or any European-style cultured butter makes a visible, tasteable difference in pastry and finishing sauces. For scrambling eggs, store brand is fine.",
    },
    skillDev: { skills: ["sauce", "heat"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
  },

  eggs: {
    description: "Chicken eggs — the single most versatile ingredient in the kitchen. Emulsify sauces, leaven cakes, bind meatballs, thicken custards, or stand alone as the meal.",
    flavorProfile: "Rich, mild, buttery yolk; clean, neutral white that picks up anything you add",
    prepTips: "Cold eggs crack cleanly, room-temp eggs whip to more volume. For even cooking, start hard-boiled eggs in simmering water and shock in ice at 9 minutes. For silky scrambled: low heat, constant stirring, pull off just before they look done.",
    storage: {
      location: "fridge",
      shelfLifeDays: 35,
      shelfLife: { fridge: 35, freezer: 365, pantry: null },
      tips: "Store in the carton (not the door) — temperature's more stable on the main shelf. A fresh egg sinks; a bad one floats.",
      spoilageSigns: "Cracked egg smells sulfurous or ammonia-like — toss. Float-test: raises to vertical = past prime but OK cooked; floats flat = done.",
      freezable: true,
      freezeNotes: "Crack, whisk, portion into ice-cube trays or 2-egg zip-top bags. 1 year. Never freeze in shell.",
      prepYield: { whole: "1 large egg", yields: "~3 tbsp / 50g whisked" },
    },
    substitutions: [
      { id: "flax_egg", tier: "dietary", note: "1 tbsp ground flax + 3 tbsp water for baking. Works as a binder — not for scrambles, custards, or anything where the egg is the star." },
    ],
    pairs: ["butter", "cream", "parmesan", "chive", "tarragon"],
    flavor: {
      primary: ["umami", "fat"],
      intensity: "moderate",
      heatChange: {
        raw: "viscous, slightly salty, neutral",
        cooked: "savory, mellow, buttery — 63°C yolk is peak silky",
        charred: "sulfurous and chewy past 75°C; overcooked whites squeak",
      },
    },
    nutrition: { per: "count", kcal: 72, protein_g: 6, fat_g: 5, carb_g: 0.4, sodium_mg: 71 },
    origin: "Domesticated from the red junglefowl in Southeast Asia ~8,000 years ago; now the world's most-eaten animal protein.",
    culturalNotes: "Escoffier said 'the cuisine of a nation can be judged by its egg cookery' — which is why French apprentices start with the omelette.",
    allergens: ["egg"],
    diet: { vegan: false, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Pasture-raised yolks are deeper orange and richer in omega-3s. 'Cage-free' is a minimum bar, not a gold standard. Freshness beats provenance — a farm-stand egg laid yesterday outcooks a week-old organic.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "In a simple fried egg or custard, you taste the difference between supermarket cage-free and pasture-raised. In a quiche or scrambled eggs, less so.",
    },
    skillDev: { skills: ["egg", "timing", "heat"], difficulty: "moderate", proFromScratch: false, fromScratchRecipeId: null },
  },

  milk: {
    description: "Whole cow's milk, ~3.25% fat. The liquid foundation of custards, béchamels, soaked croutons, and a thousand breakfasts.",
    flavorProfile: "Clean, sweet, faintly grassy; cream on top if unhomogenized",
    prepTips: "Always scald (heat to just below simmer) before adding to eggs for custards — it shortens cook time and prevents curdling. Milk burns fast; use a heavy pot and don't walk away.",
    storage: {
      location: "fridge",
      shelfLifeDays: 10,
      shelfLife: { fridge: 10, freezer: 90, pantry: null },
      tips: "Coldest shelf, not the door. Ultra-pasteurized lasts much longer; traditional pasteurized tastes better but spoils sooner.",
      spoilageSigns: "Sour smell, chunky when poured, yellow tinge. If it curdles on pour into hot coffee, it's gone.",
      freezable: true,
      freezeNotes: "Freezes fine but fat separates on thaw — shake vigorously. Best for cooking post-thaw, not drinking. 3 months.",
    },
    substitutions: [
      { id: "half_and_half", tier: "direct",  note: "Richer — cut 1:1 with water to mimic whole milk in recipes." },
      { id: "oat_milk",      tier: "dietary", note: "Best non-dairy swap in savory cooking. Avoid for custards that need egg-proteins to set against milk solids." },
    ],
    pairs: ["butter", "vanilla", "cinnamon", "honey"],
    flavor: {
      primary: ["fat", "sweet"],
      intensity: "mild",
      heatChange: {
        raw: "clean, slightly sweet, cooling",
        cooked: "mellow, rounded, faintly caramelized when scalded",
        charred: "scorched milk solids taste of burnt popcorn — ruined in seconds",
      },
    },
    nutrition: { per: "100g", kcal: 61, protein_g: 3.2, fat_g: 3.3, carb_g: 4.8, sodium_mg: 43 },
    origin: "Cattle domesticated ~10,000 years ago in the Fertile Crescent; Northern European populations evolved lactose tolerance within the last 7,500.",
    allergens: ["dairy"],
    diet: { vegan: false, vegetarian: true, keto: false, halal: true, kosher: "dairy", fodmap: "moderate", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Grass-fed milk has higher omega-3 and conjugated linoleic acid. Small-dairy glass bottles are the pinnacle — worth it for drinking, overkill for cooking.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "For cooking: barely matters. For drinking: the jump from supermarket to small-dairy glass-bottle is real.",
    },
    skillDev: { skills: ["sauce", "heat"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  // ── popular cheeses ────────────────────────────────────────────────
  parmesan: {
    description: "Italian hard cheese made from cow's milk and aged 12-36 months. Granular, crystalline texture from tyrosine protein clusters.",
    flavorProfile: "Nutty, savory, sharp; intense umami finish with hints of pineapple",
    prepTips: "Grate on a microplane just before using — pre-grated dries out and loses bloom. Save rinds to simmer into stocks and bean pots (they melt into the liquid).",
    storage: {
      location: "fridge",
      shelfLifeDays: 180,
      shelfLife: { fridge: 180, freezer: 365, pantry: null },
      tips: "Wrap in parchment, then loosely in foil — the cheese needs to breathe a little. A sweating wedge means you've wrapped it too tight.",
      spoilageSigns: "Fuzzy mold ≠ the rind. Surface mold on a wedge: scrape ½-inch deep; anything fuzzy past that, toss. Ammonia smell = gone.",
      freezable: true,
      freezeNotes: "Best grated into a zip-top bag, frozen flat, broken off as needed. Wedges freeze but get crumbly.",
    },
    substitutions: [
      { id: "pecorino",     tier: "direct", note: "Sharper, saltier. Cut the dish's added salt by a pinch when swapping." },
      { id: "grana_padano", tier: "direct", note: "Softer, younger cousin. Milder but interchangeable in most uses." },
    ],
    pairs: ["butter", "black_pepper", "garlic", "basil"],
    flavor: {
      primary: ["umami", "salt", "fat"],
      intensity: "strong",
      heatChange: {
        raw: "granular crunch, intense savory-sweet",
        cooked: "melts into a silken umami layer — builds pan sauces' body",
        charred: "caramelizes into a crisp frico; past that, acrid and dry",
      },
    },
    nutrition: { per: "100g", kcal: 431, protein_g: 38, fat_g: 29, carb_g: 4, sodium_mg: 1529 },
    winePairings: ["Barolo", "Chianti Classico", "Sangiovese", "Aged Chardonnay"],
    recipes: ["Pasta carbonara", "Risotto alla Milanese", "Caesar salad", "Parmigiana"],
    origin: "Emilia-Romagna, Italy — the true 'Parmigiano-Reggiano' is PDO-protected and made only in a specific zone.",
    culturalNotes: "Italian banks have accepted Parmigiano wheels as loan collateral since the 1950s — they age for years and only appreciate in value.",
    allergens: ["dairy"],
    diet: { vegan: false, vegetarian: true, keto: true, halal: false, kosher: "dairy", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Look for the dot-matrix rind stamp on true Parmigiano-Reggiano. 'Parmesan' with no origin guarantee is fine for everyday grating; save the real thing for finishing.",
    market: {
      priceTier: "premium",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "The gulf between supermarket-can 'parm' and real Parmigiano-Reggiano DOP is enormous. For cacio e pepe or anything where the cheese IS the dish, the real stuff is non-negotiable.",
    },
    skillDev: { skills: ["seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
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
      shelfLife: { fridge: 150, freezer: 365, pantry: null },
      tips: "Parchment + foil. Don't let it touch other cheeses in the drawer — the sheep-milk aroma bleeds.",
      spoilageSigns: "Sheep-milk funk is normal; ammonia is not. Surface mold: scrape. Deep mold or sour smell: toss.",
      freezable: true,
      freezeNotes: "Grate first, freeze flat in a zip-top. Use within 6 months for peak flavor.",
    },
    substitutions: [
      { id: "parmesan", tier: "direct", note: "Milder and less salty. Cut the recipe's salt by a pinch if substituting." },
    ],
    pairs: ["black_pepper", "spaghetti", "honey", "fava"],
    flavor: {
      primary: ["salt", "umami"],
      intensity: "strong",
      heatChange: {
        raw: "sharp, tangy, mouth-puckering",
        cooked: "melts slower than parm but emulsifies famously in cacio e pepe",
        charred: "crisps into salty shards; sharper than parm frico",
      },
    },
    nutrition: { per: "100g", kcal: 419, protein_g: 28, fat_g: 33, carb_g: 2, sodium_mg: 1800 },
    winePairings: ["Chianti", "Vermentino", "Nero d'Avola", "Dry Rosé"],
    recipes: ["Cacio e pepe", "Pasta alla gricia", "Shaved on fava beans", "With honey & pears"],
    origin: "Lazio and Sardinia, Italy — Pecorino Romano is the oldest documented Italian cheese, fed to Roman legions.",
    culturalNotes: "'Pecorino' literally means 'from sheep' (pecora). The 'Romano' was added centuries after Roman shepherds brought the craft to Sardinia, where most of it is actually made today.",
    allergens: ["dairy"],
    diet: { vegan: false, vegetarian: true, keto: true, halal: false, kosher: "dairy", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Pecorino Romano DOP is the reference for cacio e pepe and pasta alla gricia. For table eating, a younger Pecorino Toscano is mellower.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "For cacio e pepe, it has to be real Pecorino Romano DOP — anything labeled 'Romano cheese' (often cow's milk) won't emulsify the sauce correctly.",
    },
    skillDev: { skills: ["seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },
  mozzarella: {
    description: "Fresh Italian cheese, traditionally made from water buffalo milk (Mozzarella di Bufala) or cow's milk (fior di latte). Soft, stretchy, sold in balls packed in water.",
    flavorProfile: "Milky, clean, lightly sweet; tender bite that squeaks briefly against the teeth",
    prepTips: "Pull from the fridge 30 minutes before serving — cold mozz is rubbery and mute. Tear rather than cut for salads so the craggy edges catch oil and salt.",
    storage: {
      location: "fridge",
      shelfLifeDays: 7,
      shelfLife: { fridge: 7, freezer: 30, pantry: null },
      tips: "Keep it submerged in its brine. Once opened, use within 2–3 days; it sours quickly.",
      spoilageSigns: "Cloudy or sour brine, yellow tint on the ball, or a sharp tang — fresh mozz should smell like cream, not cheese.",
      freezable: true,
      freezeNotes: "OK for cooking (pizza, pasta bakes) — texture suffers badly on thaw, so never freeze for caprese.",
    },
    substitutions: [
      { id: "burrata", tier: "pro",       note: "Richer, creamier center. Upgrade for the same dishes when mozz is the star." },
      { id: "ricotta", tier: "emergency", note: "For cooked dishes (pizza, pasta bakes) when fresh mozz isn't available." },
    ],
    pairs: ["tomato", "basil", "olive_oil", "balsamic"],
    flavor: {
      primary: ["fat", "sweet"],
      intensity: "mild",
      heatChange: {
        raw: "milky, cool, faintly tangy",
        cooked: "melts into a pillowy stretch; sweetens as the water cooks off",
        charred: "blisters into leopard spots on pizza — prized browning that goes bitter past char-black",
      },
    },
    nutrition: { per: "100g", kcal: 280, protein_g: 18, fat_g: 22, carb_g: 3, sodium_mg: 627 },
    winePairings: ["Prosecco", "Pinot Grigio", "Falanghina", "Rosé"],
    recipes: ["Caprese", "Pizza Margherita", "Fresh pasta", "Grilled on tomato toast"],
    origin: "Campania, Italy — the bufala version is PDO-protected and comes from a specific zone around Naples.",
    culturalNotes: "'Mozzarella' comes from 'mozzare' (to cut by hand) — traditional makers literally pinch off balls from a rope of stretched curd.",
    allergens: ["dairy"],
    diet: { vegan: false, vegetarian: true, keto: true, halal: true, kosher: "dairy", fodmap: "moderate", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "For caprese and pizza Margherita, splurge on bufala at least once and taste the difference. For everything else, good fior di latte is excellent.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Supermarket vacuum-packed 'low-moisture' mozz is rubbery and bland. Get water-packed balls for anything where the cheese is the star; save the shredded bag for quick weeknight pizzas.",
    },
    skillDev: { skills: [], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
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
      shelfLife: { fridge: 120, freezer: 365, pantry: null },
      tips: "Parchment + foil in the cheese drawer. A little surface mold on an aged Gruyère is normal — scrape it off, not a disaster.",
      spoilageSigns: "Ammonia sting in the nose, deep blue-green mold through the paste (not surface), cracked rind oozing — past its prime.",
      freezable: true,
      freezeNotes: "Grate first, freeze in a zip-top. Whole wedges get crumbly on thaw.",
    },
    substitutions: [
      { id: "comte",    tier: "direct",    note: "French cousin from the Jura. More nuanced, interchangeable in most applications." },
      { id: "emmental", tier: "emergency", note: "Milder, holier. Melts well but lacks Gruyère's depth." },
    ],
    pairs: ["ham", "white_wine", "potato", "yellow_onion"],
    flavor: {
      primary: ["umami", "fat", "sweet"],
      intensity: "strong",
      heatChange: {
        raw: "firm, deeply nutty, savory-sweet",
        cooked: "melts into an elastic, stretchy pull — the fondue standard for a reason",
        charred: "browns on a gratin into a deep-amber crust with caramelized edges",
      },
    },
    nutrition: { per: "100g", kcal: 413, protein_g: 30, fat_g: 32, carb_g: 0.4, sodium_mg: 714 },
    winePairings: ["Chasselas", "Dry Riesling", "Chardonnay", "Pinot Noir"],
    recipes: ["Fondue", "French onion soup", "Croque monsieur", "Quiche Lorraine"],
    origin: "Canton of Fribourg, Switzerland — named for the town of Gruyères, made since at least 1115 CE.",
    culturalNotes: "Swiss soldiers in the Vatican Guard were once paid partly in Gruyère rations. The cheese travels well and doesn't spoil fast — a medieval protein bar.",
    allergens: ["dairy"],
    diet: { vegan: false, vegetarian: true, keto: true, halal: false, kosher: "dairy", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "'Gruyère AOP' (Swiss) is the real one; 'Le Gruyère' alone can be French-style. Both are excellent — AOP is deeper.",
    market: {
      priceTier: "premium",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Cave-aged Gruyère AOP is on a different planet from the grocery-aisle stuff sold as 'gruyere'. For fondue or French onion soup, the real one pays for itself.",
    },
    skillDev: { skills: ["seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
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
      shelfLife: { fridge: 2, freezer: 120, pantry: null },
      tips: "On the bottom shelf so drips don't cross-contaminate. Freeze within 1–2 days if you're not using — freezes well up to 4 months in a zip-top bag.",
      spoilageSigns: "Grey tint, slime on the surface, sour or sulfurous smell — toss. Fresh chicken should smell like basically nothing.",
      freezable: true,
      freezeNotes: "Individually wrapped then bagged so you can defrost a single breast. 4 months.",
    },
    substitutions: [
      { id: "chicken_thigh", tier: "direct",    note: "Darker, fattier, more forgiving. Better for braises and slow cooks." },
      { id: "turkey_breast", tier: "direct",    note: "1:1 swap; adjust cooking time down slightly for even thinner cuts." },
    ],
    pairs: ["lemon", "garlic", "rosemary", "butter"],
    flavor: {
      primary: ["umami", "salt"],
      intensity: "mild",
      heatChange: {
        raw: "virtually flavorless — a blank protein canvas",
        cooked: "gently savory; picks up whatever you cooked it with (butter, wine, lemon, herbs)",
        charred: "sear marks add roasted depth; past that, dry and chewy fast",
      },
    },
    nutrition: { per: "100g", kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0, sodium_mg: 74 },
    winePairings: ["Chardonnay", "Sauvignon Blanc", "Pinot Noir", "Dry Riesling"],
    recipes: ["Chicken piccata", "Chicken parmesan", "Grilled chicken salad", "Chicken marsala"],
    origin: "Domesticated ~8,000 years ago in Southeast Asia; the breast was historically the less-prized cut — it was the thigh meat that was eaten first.",
    culturalNotes: "The US consumes ~65 billion chicken breasts annually. American breeding has selected for oversized breasts since the 1950s — they're roughly 4× their natural size.",
    allergens: [],
    diet: { vegan: false, vegetarian: false, keto: true, halal: true, kosher: "meat", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Pasture-raised or heritage breeds (Freedom Ranger, Bresse) have better flavor and firmer texture. 'Air-chilled' is a genuine quality upgrade over standard water-chilled.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Air-chilled, pasture-raised chicken breast is a different animal than factory-farmed. Worth the 2× price for dishes where chicken IS the meal; for chicken salad or soup, conventional is fine.",
    },
    skillDev: { skills: ["heat", "timing"], difficulty: "moderate", proFromScratch: false, fromScratchRecipeId: null },
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
      shelfLife: { fridge: 2, freezer: 365, pantry: null },
      tips: "Dry-brine = uncovered on a rack for 24 hours. Cover only if storing longer than that. Stock from the carcass freezes beautifully for 6 months.",
      spoilageSigns: "Slimy, grey, or green tint; sour or sulfurous smell. Raw chicken should look fresh-pink and smell neutral.",
      freezable: true,
      freezeNotes: "Vacuum-seal if you can; zip-top is fine for up to 12 months. Defrost in the fridge, never at room temp.",
    },
    substitutions: [
      { id: "cornish_hen", tier: "direct", note: "Smaller (~1 lb) versions of the same bird. Cook in 45 min instead of 90. Great for individual portions." },
    ],
    pairs: ["lemon", "thyme", "garlic", "butter", "white_wine"],
    flavor: {
      primary: ["umami", "fat"],
      intensity: "moderate",
      heatChange: {
        raw: "neutral, faintly iron",
        cooked: "savory, clean; roasted skin adds deeply caramelized Maillard depth",
        charred: "grilled-skin char is prized; burnt flesh turns acrid",
      },
    },
    nutrition: { per: "100g", kcal: 239, protein_g: 27, fat_g: 14, carb_g: 0, sodium_mg: 82 },
    winePairings: ["Chardonnay", "Pinot Noir", "Côtes du Rhône", "Beaujolais"],
    recipes: ["Classic roast chicken", "Spatchcocked + grilled", "Chicken stock", "Coq au vin"],
    origin: "Descended from the red junglefowl of Southeast Asia. Gallus gallus domesticus is now the most numerous bird on Earth by roughly an order of magnitude.",
    culturalNotes: "A whole roast chicken is the French 'poulet rôti' — the benchmark dish any aspiring cook is measured against. If you can nail a roast chicken, you can cook.",
    allergens: [],
    diet: { vegan: false, vegetarian: false, keto: true, halal: true, kosher: "meat", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Pasture-raised > organic > 'free range' > conventional. An air-chilled, pasture-raised bird tastes like a different animal than a factory-farmed one.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "For a roast chicken dinner, get a pasture-raised bird if it's available. The deeper flavor rewards the technique you're about to put in.",
    },
    skillDev: { skills: ["heat", "seasoning", "timing"], difficulty: "moderate", proFromScratch: false, fromScratchRecipeId: null },
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
      shelfLife: { fridge: 3, freezer: 180, pantry: null },
      tips: "Room-temp 30 minutes before cooking — cold meat hits the pan and steams instead of sears. Freeze in flat packs, not chunks, for quick defrost.",
      spoilageSigns: "Grey-brown dullness through the whole cut (surface browning alone is fine), sticky film, sour smell.",
      freezable: true,
      freezeNotes: "Vacuum-seal or tight-wrap in butcher paper + foil. 6 months for steaks.",
    },
    substitutions: [
      { id: "ribeye",      tier: "pro",       note: "Fattier, more forgiving. The upgrade for special occasions." },
      { id: "flank_steak", tier: "direct",    note: "Thinner, more grain. Also great for fajitas and steak tacos." },
    ],
    pairs: ["garlic", "rosemary", "butter", "red_wine"],
    flavor: {
      primary: ["umami", "salt"],
      intensity: "moderate",
      heatChange: {
        raw: "mineral, iron, fresh-meat coolness",
        cooked: "beefy, clean; the crust does most of the talking",
        charred: "crust reads as caramelized-savory; past medium-well it dries out fast",
      },
    },
    nutrition: { per: "100g", kcal: 183, protein_g: 25, fat_g: 8.7, carb_g: 0, sodium_mg: 53 },
    winePairings: ["Malbec", "Cabernet Sauvignon", "Syrah", "Côtes du Rhône"],
    recipes: ["Beef stir-fry", "Steak sandwiches", "Steak salad", "Pan-seared with chimichurri"],
    origin: "'Sirloin' is from the French 'surlonge' — above the loin. Large working-muscle area, which is why it's leaner.",
    culturalNotes: "English legend says King James I was so impressed by a beef dinner he knighted the cut: 'Arise, Sir Loin.' Charming, apocryphal — the name actually predates him.",
    allergens: [],
    diet: { vegan: false, vegetarian: false, keto: true, halal: true, kosher: "meat", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Grass-fed has a firmer texture and more mineral flavor; grain-finished is more buttery. Dry-aged (if you can find it) concentrates flavor and tenderizes the muscle.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Sirloin's job is value — it's the utility steak. For everyday stir-fries and fajitas, regular supermarket cuts are fine. Splurge on ribeye instead.",
    },
    skillDev: { skills: ["heat", "knife"], difficulty: "moderate", proFromScratch: false, fromScratchRecipeId: null },
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
      shelfLife: { fridge: 7, freezer: 120, pantry: null },
      tips: "Once opened, roll unused strips in parchment and freeze — snap off what you need. Unopened packs keep 2+ weeks past the date if the bag is unpunctured.",
      spoilageSigns: "Green or gray tint, slimy feel, sour smell. Cured pork goes off slowly but unmistakably.",
      freezable: true,
      freezeNotes: "Roll strips in parchment, stack in a zip-top. Snap off individual strips frozen straight into a cold pan.",
    },
    substitutions: [
      { id: "pancetta",   tier: "direct", note: "Unsmoked Italian cure. Use 1:1 where the smoke isn't the point (carbonara, pasta dishes)." },
      { id: "guanciale",  tier: "pro",    note: "Cured pork jowl. The authentic upgrade for Roman pastas — richer, more intense than bacon." },
    ],
    pairs: ["eggs", "tomato", "maple_syrup", "black_pepper"],
    flavor: {
      primary: ["salt", "fat", "umami"],
      intensity: "strong",
      heatChange: {
        raw: "salty-fatty, smoky, slightly sweet if maple-cured",
        cooked: "crisps into the platonic breakfast smell — the fat carries the whole kitchen",
        charred: "burnt sugar in the cure turns bitter; aim for crisp-brown, not black",
      },
    },
    nutrition: { per: "100g", kcal: 541, protein_g: 37, fat_g: 42, carb_g: 1.4, sodium_mg: 1717 },
    winePairings: ["Pinot Noir", "Zinfandel", "Sparkling wine with brunch", "Chardonnay"],
    recipes: ["BLT", "Carbonara", "Bacon-wrapped anything", "Breakfast hash"],
    origin: "Cured pork techniques date to ancient China and Rome; 'bacon' as a word is Old French (bacö, 'back'), referring to the cured back cuts.",
    culturalNotes: "American bacon is belly cut — most of the rest of the world's 'bacon' is the leaner back cut ('rashers' in the UK, 'peameal' in Canada). The US-centric belly version is the outlier, not the norm.",
    allergens: [],
    diet: { vegan: false, vegetarian: false, keto: true, halal: false, kosher: "nonkosher", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Look for 'uncured' (nitrate-free) bacons that use celery powder instead of sodium nitrate if you care — they taste the same. Thick-cut holds up in pasta; thin-cut crisps faster for BLTs.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Butcher-shop dry-cured bacon is distinctly better than supermarket wet-cured — less water weight, cleaner smoke, crisps into shatter-crisp instead of rubbery chew.",
    },
    skillDev: { skills: ["heat", "timing"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
  },
  guanciale: {
    description: "Cured pork jowl — fattier, richer, and more intensely flavored than pancetta or bacon. The authentic fat for Roman pasta: carbonara, gricia, amatriciana.",
    flavorProfile: "Deeply porky, rich, faintly funky; pepper rim adds warmth. Renders to a puddle of amber fat that perfumes the pasta.",
    prepTips: "Start in a cold pan on medium-low so the fat renders slowly and evenly. Pull the crisped pieces out when the outside is browned and the centers are still tender — over-rendering turns them into jerky.",
    storage: {
      location: "fridge",
      shelfLifeDays: 90,
      shelfLife: { fridge: 90, freezer: 365, pantry: null },
      tips: "Wrapped in parchment, sealed in a zip-top — it keeps for months. The cure is its preservation. Slice as needed rather than pre-dicing.",
      spoilageSigns: "Gray mold through the flesh (surface white bloom is fine — just trim). Rancid-nut smell from the fat = past its prime.",
      freezable: true,
      freezeNotes: "Cut into recipe-size chunks before freezing. Wrap tight. 1 year easy.",
    },
    substitutions: [
      { id: "pancetta", tier: "direct",    note: "Most common swap. Leaner, less funky — acceptable but noticeably different in a gricia." },
      { id: "bacon",    tier: "emergency", note: "Last resort. Smoke changes the dish's character. Skip the smoke by blanching 60 seconds first." },
    ],
    pairs: ["spaghetti", "pecorino", "black_pepper", "eggs"],
    flavor: {
      primary: ["fat", "salt", "umami"],
      intensity: "strong",
      heatChange: {
        raw: "salty, fatty, intensely porky",
        cooked: "amber fat renders into a glossy sauce base; crisped edges turn caramel-nutty",
        charred: "black spots go bitter fast; stop at deep amber",
      },
    },
    nutrition: { per: "100g", kcal: 660, protein_g: 7, fat_g: 69, carb_g: 0, sodium_mg: 1350 },
    winePairings: ["Frascati", "Cesanese", "Lambrusco", "Chianti"],
    recipes: ["Carbonara", "Pasta alla gricia", "Amatriciana", "Tossed through bitter greens"],
    origin: "Lazio and Umbria, Italy. 'Guancia' means cheek — cured with salt, black pepper, and sometimes wine, then aged 2–3 months.",
    culturalNotes: "Purists insist Roman pastas must use guanciale — not pancetta, not bacon. The fat content and texture are genuinely different, and you can taste it.",
    allergens: [],
    diet: { vegan: false, vegetarian: false, keto: true, halal: false, kosher: "nonkosher", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Italian imports are best. A good specialty grocer or Italian deli will have it; online specialty meat shops ship it cured. Domestic producers are catching up fast.",
    market: {
      priceTier: "premium",
      availability: "specialty",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Guanciale IS the dish in Roman pastas. A mass-market bacon swap tastes like a different recipe — the jowl's fat content is part of the emulsification.",
    },
    skillDev: { skills: ["heat", "timing"], difficulty: "moderate", proFromScratch: true, fromScratchRecipeId: null },
  },
  ham: {
    description: "Cured pork leg. Ranges from deli slices to bone-in whole hams to dry-cured Iberian specialties. Versatile cooked-meat staple.",
    flavorProfile: "Salty, savory, lightly sweet; smoke varies by style",
    prepTips: "Deli slices: keep flat-packed in the fridge, use within a week. Whole hams: glaze with brown sugar + mustard + a splash of bourbon in the last 30 min of baking. Slice bone-in hams thinly against the grain.",
    storage: {
      location: "fridge",
      shelfLifeDays: 7,
      shelfLife: { fridge: 7, freezer: 60, pantry: null },
      tips: "Once opened, deli ham loses quality fast — plan to use within 5 days. Bone-in ham lasts 7–10 days if well-wrapped.",
      spoilageSigns: "Slimy, tacky surface; sour or ammonia-like smell; any green or gray tint.",
      freezable: true,
      freezeNotes: "Deli slices freeze poorly — texture suffers. Whole or bone-in ham freezes well; 2 months.",
    },
    substitutions: [
      { id: "prosciutto", tier: "pro",       note: "Dry-cured, eaten raw. Upgrade for cold applications; not a sub for sandwiches or gratins." },
      { id: "turkey",     tier: "dietary",   note: "Leaner deli alternative. Mild; needs more seasoning in cooked applications." },
    ],
    pairs: ["gruyere", "mustard", "butter", "bread"],
    flavor: {
      primary: ["salt", "umami", "sweet"],
      intensity: "moderate",
      heatChange: {
        raw: "salty-sweet, smoky, moist — eats fine straight from the package",
        cooked: "glazed edges caramelize; interior stays juicy if you don't overbake",
        charred: "burnt sugar in the glaze goes bitter past deep amber",
      },
    },
    nutrition: { per: "100g", kcal: 145, protein_g: 21, fat_g: 6, carb_g: 2, sodium_mg: 1203 },
    winePairings: ["Riesling", "Gewürztraminer", "Pinot Noir", "Rosé"],
    recipes: ["Croque monsieur", "Ham & cheese omelette", "Holiday baked ham", "Split pea soup"],
    origin: "Cured pork legs appear across world cuisines — China (jinhua ham), Spain (jamón ibérico), Italy (prosciutto), Germany (Schwarzwälder Schinken). Every pork-eating culture has one.",
    culturalNotes: "Easter ham is a Christian tradition rooted in spring pig slaughters — hams cured in fall were ready to eat by spring.",
    allergens: [],
    diet: { vegan: false, vegetarian: false, keto: true, halal: false, kosher: "nonkosher", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "For a sandwich: a specialty-shop cured ham will taste noticeably better than pre-packaged. For holidays: bone-in is worth the extra fuss — you get stock from the bone.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Deli-counter ham is distinctly better than packaged. For a holiday centerpiece, a heritage-breed bone-in ham rewards the roasting time.",
    },
    skillDev: { skills: ["heat", "timing"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
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
      shelfLife: { fridge: null, freezer: 180, pantry: 90 },
      tips: "Cool, dry, airy spot — not the fridge (goes moldy). If you see a green sprout inside, it's safe but bitter; halve and remove the germ.",
      spoilageSigns: "Soft spots, brown bruising, visible mold on the paper, or a sprouting stem that took over the clove.",
      freezable: true,
      freezeNotes: "Peel, mince, pack into ice-cube trays with olive oil. Pop out a cube per sauté.",
      prepYield: { whole: "1 medium head", yields: "~10 cloves / 2–3 tbsp minced" },
    },
    substitutions: [
      { id: "shallot", tier: "direct",  note: "Sweeter, subtler. 1 clove ≈ ½ small shallot, minced." },
    ],
    pairs: ["olive_oil", "butter", "parsley", "lemon"],
    flavor: {
      primary: ["umami", "heat"],
      intensity: "strong",
      heatChange: {
        raw: "pungent, mouth-tingling, almost sulfurous",
        cooked: "sweet, nutty, mellow — the caramelized state you actually want",
        charred: "bitter and acrid in seconds — the #1 reason home sautés fail",
      },
    },
    nutrition: { per: "100g", kcal: 149, protein_g: 6.4, fat_g: 0.5, carb_g: 33, fiber_g: 2.1, sodium_mg: 17 },
    origin: "Central Asia — domesticated over 5,000 years ago. Fed to the pyramid builders as a stimulant and antibiotic.",
    culturalNotes: "Every Mediterranean grandmother has an opinion about pre-peeled garlic (generally: don't). The difference between fresh and jarred is audible in a quiet kitchen.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "high", nightshade: false, allium: true },
    seasonality: { peakMonthsN: [7, 8, 9], peakMonthsS: [1, 2, 3], yearRound: true },
    sourcing: "Hardneck varieties (Rocambole, Porcelain) have deeper flavor and easier-to-peel cloves. California-grown softneck is the everyday workhorse.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Chinese-import garlic is cheaper but milder and faster to sprout. Locally grown hardneck from a farmer's market tastes like a different food.",
    },
    skillDev: { skills: ["knife", "heat", "seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  yellow_onion: {
    description: "The default onion. Thick, papery skin over a sharp, pungent flesh that mellows and sweetens when cooked. The base of roughly every soup, sauté, and stew in Western cooking.",
    flavorProfile: "Sharp and pungent raw; sweet and savory when cooked; deeply caramelized when slow-cooked 30+ minutes in butter",
    prepTips: "Chill 15 minutes before chopping to reduce the tear-inducing vapor. For uniform dice: halve through the root, peel, make horizontal cuts toward (not through) the root, then vertical cuts, then slice across.",
    storage: {
      location: "pantry",
      shelfLifeDays: 60,
      shelfLife: { fridge: null, freezer: 240, pantry: 60 },
      tips: "Cool, dry, DARK spot in a mesh bag or open basket. Never next to potatoes — both emit ethylene gas that ripens the other.",
      spoilageSigns: "Soft spots, dark liquid at the root end, green mold, or that distinctive funky onion-rot smell.",
      freezable: true,
      freezeNotes: "Dice and freeze raw on a sheet tray, then bag. Better yet: pre-caramelize a batch, freeze in tablespoon dollops.",
      prepYield: { whole: "1 medium onion (~170g)", yields: "~1 cup diced / ~1½ cups sliced" },
    },
    substitutions: [
      { id: "shallot",     tier: "pro",    note: "Subtler, sweeter. The upgrade for finer sauces and vinaigrettes." },
      { id: "pearl_onion", tier: "direct", note: "Whole-form variety for braises and stews." },
    ],
    pairs: ["garlic", "butter", "olive_oil", "carrot"],
    flavor: {
      primary: ["umami", "sweet", "heat"],
      intensity: "moderate",
      heatChange: {
        raw: "sharp, watery-pungent, tear-inducing",
        cooked: "sweet and savory; surrenders sugars into anything fatty",
        charred: "deeply caramelized at 45 min+; blackened past that = scrape and start over",
      },
    },
    nutrition: { per: "100g", kcal: 40, protein_g: 1.1, fat_g: 0.1, carb_g: 9.3, fiber_g: 1.7, sodium_mg: 4 },
    origin: "Central Asia, cultivated ~7,000 years ago. 'The onion is the poor man's food' — Egyptian proverb.",
    culturalNotes: "Deeply caramelized onions (45 min+ in butter, constant stirring) are the secret foundation of French onion soup, coq au vin, and half the soups that ever tasted like 'mom made this.'",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "high", nightshade: false, allium: true },
    seasonality: { peakMonthsN: [8, 9, 10], peakMonthsS: [2, 3, 4], yearRound: true },
    sourcing: "Look for firm bulbs with dry, papery skin — soft spots mean rot underneath. Storage onions (yellow) are what you want; sweet onions (Vidalia, Walla Walla) are specialty.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Basic yellow onion is a commodity. The exception: Vidalia / Walla Walla sweet onions for raw salads or caramelized-onion dips where the sweetness matters.",
    },
    skillDev: { skills: ["knife", "heat"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  shallot: {
    description: "Small, elongated allium — milder, sweeter, and more refined than an onion. The go-to for vinaigrettes, pan sauces, and anywhere you want onion character without the bite.",
    flavorProfile: "Delicate, sweet, faintly garlicky; no bitter aftertaste raw",
    prepTips: "Mince fine for vinaigrettes — bigger pieces stay crunchy in the mouth. For pan sauces, sweat in butter before adding wine so they surrender their sugars.",
    storage: {
      location: "pantry",
      shelfLifeDays: 45,
      shelfLife: { fridge: null, freezer: 180, pantry: 45 },
      tips: "Same as yellow onions — cool, dark, airy. Once cut, refrigerate and use within 2 days; the delicate flavor fades fast.",
      spoilageSigns: "Soft spots, green shoots, sour smell. Tight, papery bulbs last; the moment they soften they go fast.",
      freezable: true,
      freezeNotes: "Mince, freeze in oil cubes like garlic. Whole bulbs don't freeze well.",
      prepYield: { whole: "1 medium shallot", yields: "~2 tbsp minced" },
    },
    substitutions: [
      { id: "yellow_onion", tier: "emergency", note: "Use half the amount; the bite is stronger and less refined." },
      { id: "garlic",       tier: "emergency", note: "Same amount for pan sauces; accept that the result will be more assertive." },
    ],
    pairs: ["butter", "white_wine", "dijon", "parsley"],
    flavor: {
      primary: ["sweet", "umami"],
      intensity: "moderate",
      heatChange: {
        raw: "delicate, sweet, barely-there garlic hint",
        cooked: "melts into pan sauces — disappears visually but rounds out everything",
        charred: "bitter fast, just like garlic — keep the heat moderate",
      },
    },
    nutrition: { per: "100g", kcal: 72, protein_g: 2.5, fat_g: 0.1, carb_g: 17, fiber_g: 3.2, sodium_mg: 12 },
    origin: "Named for the ancient city of Ashkelon (Ascalon) in modern Israel, where crusaders first encountered them.",
    culturalNotes: "French cooks consider shallots the 'onion for sauces' — onion is too bold, garlic too assertive; shallot is the neutral. Eschalot / échalote in French.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "high", nightshade: false, allium: true },
    seasonality: { peakMonthsN: [7, 8, 9], peakMonthsS: [1, 2, 3], yearRound: true },
    sourcing: "French gray shallots (échalote grise) have deeper flavor but are hard to find. Jersey (banana) shallots are the usual supermarket option — smaller, milder, still good.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: false,
      qualityNote: "Supermarket Jersey shallots are fine for 95% of uses. Splurge on French grey shallots only when the shallot is the entire character of the dish (mignonette, classical mother sauces).",
    },
    skillDev: { skills: ["knife", "sauce"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  pearl_onion: {
    description: "Miniature onions ~½-inch across. Sold in mesh bags (fresh) or jars (pickled). The classic garnish for braises, casseroles, and a proper gin martini.",
    flavorProfile: "Mild, sweet, delicate; less aggressive than a full onion",
    prepTips: "To peel fresh ones: blanch 60 seconds, shock in ice water, squeeze the root end — the onion slips out of its skin. Doing 30 of them individually is the only thing worse than crying through yellow-onion dice.",
    storage: {
      location: "pantry",
      shelfLifeDays: 30,
      shelfLife: { fridge: 14, freezer: 365, pantry: 30 },
      tips: "Fresh: cool dry mesh bag, same as yellow onions. Frozen pearl onions (pre-peeled) are a legitimate shortcut for braises — nobody will taste the difference.",
      spoilageSigns: "Soft skin-slip, green shoots, sour bog-smell at the mesh-bag bottom.",
      freezable: true,
      freezeNotes: "Frozen pre-peeled pearl onions from the supermarket are the move for braises. 1 year easy.",
    },
    substitutions: [
      { id: "yellow_onion", tier: "emergency", note: "Quartered chunks work for the flavor; you lose the whole-onion visual moment." },
    ],
    pairs: ["bacon", "red_wine", "thyme", "mushroom"],
    flavor: {
      primary: ["sweet", "umami"],
      intensity: "mild",
      heatChange: {
        raw: "crisp, sweet, mild",
        cooked: "picks up whatever wine and fat you braise them in — sweet and glossy",
        charred: "bitter if dry-roasted too long; pearls want braising liquid or a buttery glaze",
      },
    },
    nutrition: { per: "100g", kcal: 40, protein_g: 1.1, fat_g: 0.1, carb_g: 9.3, fiber_g: 1.7, sodium_mg: 4 },
    origin: "Bred from regular onions for size and uniformity; Dutch and French cooks made them famous as garnish onions.",
    culturalNotes: "The bourguignon question: traditional recipe calls for ~20 pearl onions per serving, each individually peeled. Frozen pre-peeled is the modern grace.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "high", nightshade: false, allium: true },
    seasonality: { peakMonthsN: [8, 9, 10], peakMonthsS: [2, 3, 4], yearRound: true },
    sourcing: "Frozen pearl onions are the move for braises — already peeled, consistent sizing, half the price of fresh. Fresh for spring peas + new pearl onions is worth the peeling penance.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: false,
      qualityNote: "Frozen pre-peeled is the practical answer 90% of the time. Fresh is for when the peeling is part of the ritual.",
    },
    skillDev: { skills: ["knife", "timing"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  basil: {
    description: "Sweet Italian herb with large, tender leaves. The summer-tomato herb, the pesto herb, the herb you add last so it doesn't blacken.",
    flavorProfile: "Sweet, peppery, aniseed; clove-ish on the back end; turns soapy and thin if heated too long",
    prepTips: "Tear, don't chop — oxidation blackens cut edges. Add at the very end or scatter raw on top. For pesto, blanch 10 seconds + ice-shock to lock the color in.",
    storage: {
      location: "pantry",
      shelfLifeDays: 7,
      shelfLife: { fridge: null, freezer: 90, pantry: 7 },
      tips: "Never refrigerate — basil blackens in the cold. Stand stems in a glass of water on the counter like cut flowers; covers loose with a bag over the leaves.",
      spoilageSigns: "Black spots on leaves, slimy stems, sour smell — the whole bunch blackens within hours once it starts.",
      freezable: true,
      freezeNotes: "Purée with olive oil into ice-cube trays; 3 months. Dried basil is a different ingredient; not a swap.",
    },
    substitutions: [
      { id: "parsley",    tier: "emergency", note: "Different flavor entirely but works in a pinch as a soft green garnish." },
      { id: "thai_basil", tier: "dietary",   note: "For Asian dishes — stronger, spicier, anise-forward. Not a sub for pesto." },
    ],
    pairs: ["tomato", "mozzarella", "olive_oil", "garlic"],
    flavor: {
      primary: ["sweet", "heat", "umami"],
      intensity: "moderate",
      heatChange: {
        raw: "bright, sweet-peppery, aromatic oils popping",
        cooked: "flavor thins fast above 60°C — always add last",
        charred: "blackens in seconds; the aroma escapes before char sets in",
      },
    },
    nutrition: { per: "100g", kcal: 23, protein_g: 3.2, fat_g: 0.6, carb_g: 2.7, fiber_g: 1.6, sodium_mg: 4 },
    origin: "India and Southeast Asia originally; the Italian Genovese cultivar is what pasta built its reputation on.",
    culturalNotes: "Pesto alla Genovese is protected DOP — real basilico Genovese grown near the coast has smaller leaves and less mint character than what most of us grow.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { peakMonthsN: [6, 7, 8, 9], peakMonthsS: [12, 1, 2, 3], yearRound: false, preservedAvailable: true },
    sourcing: "Greenhouse basil year-round is fine; summer's farmers-market basil is incomparably better. A pot on the windowsill is almost always worth it.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "For pesto, fresh basil is non-negotiable. For tomato sauce, you can get away with the packaged hydroponic stuff in January.",
    },
    skillDev: { skills: ["seasoning", "knife"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  parsley: {
    description: "Flat-leaf (Italian) parsley is the workhorse herb in Western kitchens — brighter than you remember, and not the garnish you scraped off your diner plate.",
    flavorProfile: "Clean, grassy, peppery; refreshing bitter edge that cuts through fat",
    prepTips: "Chop LESS than you think — over-chopped parsley is mushy and bruised. A quick mince with a sharp knife is better than a rough chop. Use stems in stocks and dressings; they're more flavorful than the leaves.",
    storage: {
      location: "fridge",
      shelfLifeDays: 10,
      shelfLife: { fridge: 10, freezer: 180, pantry: null },
      tips: "Wrap stems in a damp paper towel inside a zip-top bag, or stand in a glass of water with the leaves covered loosely. Refreshes wilted parsley in 30 minutes.",
      spoilageSigns: "Yellow leaves, slimy stems, sour smell at the base of the bunch.",
      freezable: true,
      freezeNotes: "Chop, spread on a sheet tray, freeze solid, transfer to a zip-top. 6 months for cooking; texture doesn't work for raw garnish.",
    },
    substitutions: [
      { id: "cilantro", tier: "dietary",   note: "Different profile (citrusy, divisive) but similar green-brightener role." },
      { id: "chervil",  tier: "pro",       note: "Finer, aniseed-tinged. Use in French preparations where parsley was already the subtle choice." },
    ],
    pairs: ["garlic", "lemon", "olive_oil", "butter"],
    flavor: {
      primary: ["bitter", "umami"],
      intensity: "mild",
      heatChange: {
        raw: "grassy, peppery, refreshing",
        cooked: "loses the bright edge fast; use stems in slow cooking, leaves at the end",
        charred: "burns to acrid green char — add off-heat only",
      },
    },
    nutrition: { per: "100g", kcal: 36, protein_g: 3, fat_g: 0.8, carb_g: 6.3, fiber_g: 3.3, sodium_mg: 56 },
    origin: "Mediterranean. The ancient Greeks made parsley wreaths for athletic victors; 'requiring parsley' was a Greek euphemism for the gravely ill (parsley grew on graves).",
    culturalNotes: "Curly-leaf parsley is what ended up on every steakhouse plate in the 1970s. Flat-leaf (Italian) is for actual cooking — stronger flavor, easier to chop.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { peakMonthsN: [5, 6, 7, 8, 9], peakMonthsS: [11, 12, 1, 2, 3], yearRound: true },
    sourcing: "Flat-leaf for cooking, always. Curly is fine for decoration. Bunches should be perky, not slimy or yellowing at the base.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Parsley is parsley. Freshness matters way more than sourcing.",
    },
    skillDev: { skills: ["knife", "seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  // ── produce: fruits + vegetables ──────────────────────────────────
  tomato: {
    description: "Fresh tomato — the one ingredient that deserves actual seasonal respect. August's vine-ripened tomato and January's grocery-store tomato are barely the same food.",
    flavorProfile: "Sweet, acidic, umami-rich; depth of flavor tracks directly with ripeness",
    prepTips: "Never refrigerate a ripe tomato — cold destroys the aromatic compounds and mealies the texture. Salt tomatoes 15 minutes before serving raw; it draws out juice and concentrates flavor.",
    storage: {
      location: "pantry",
      shelfLifeDays: 7,
      shelfLife: { fridge: 5, freezer: 240, pantry: 7 },
      tips: "Counter, stem-end DOWN, out of direct sun. If overripe and you can't eat them in time: quarter and freeze for future sauce.",
      spoilageSigns: "Soft dark bruising, shriveled skin, mold at the stem scar, or a sour-fermented smell.",
      freezable: true,
      freezeNotes: "Whole tomatoes freeze beautifully for future sauce — the skins slip off like magic after a 2-minute thaw under warm water.",
      prepYield: { whole: "1 medium tomato (~150g)", yields: "~1 cup diced" },
    },
    substitutions: [
      { id: "tomato_paste",    tier: "emergency", note: "For cooked dishes; concentrated flavor but no water. Use 1 tbsp paste per fresh tomato." },
      { id: "sundried_tomato", tier: "pro",       note: "For flavor, not volume. A tablespoon adds what a cup of fresh would — upgrade for intensity." },
      { id: "canned_tomatoes", tier: "direct",    note: "Winter winner. Canned San Marzanos beat out-of-season fresh tomatoes for cooking every time." },
    ],
    pairs: ["basil", "mozzarella", "olive_oil", "balsamic"],
    flavor: {
      primary: ["umami", "sour", "sweet"],
      intensity: "moderate",
      heatChange: {
        raw: "bright, acidic, sweet — summer-ripe versions taste like nothing else",
        cooked: "concentrates into deep savory-sweetness as water cooks off",
        charred: "blistered skins add smoky-sweet depth — the base of good salsa asada",
      },
    },
    nutrition: { per: "100g", kcal: 18, protein_g: 0.9, fat_g: 0.2, carb_g: 3.9, fiber_g: 1.2, sodium_mg: 5 },
    origin: "Western South America (Andes) — domesticated in Mexico by the Aztecs. Brought to Europe in the 1500s; long thought poisonous because the leaves and stems are.",
    culturalNotes: "Tomatoes in Italian cooking only date to the 1800s. Caprese, marinara, pasta al pomodoro — all 'traditional' dishes younger than the USA.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: true, allium: false },
    seasonality: { peakMonthsN: [7, 8, 9], peakMonthsS: [1, 2, 3], yearRound: false, preservedAvailable: true },
    sourcing: "Heirloom varieties (Brandywine, Cherokee Purple, Green Zebra) taste like tomato; uniform red supermarket tomatoes are bred for shipping, not flavor. Even in winter, canned San Marzanos beat fresh supermarket tomatoes for cooking.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Farmer's-market summer tomatoes are in a different universe from supermarket tomatoes. If the tomato is the dish (caprese, BLT), the sourcing IS the recipe.",
    },
    skillDev: { skills: ["knife", "seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  bell_pepper: {
    description: "Sweet, crunchy, hollow-fleshed peppers. Red, yellow, and orange are ripe; green is an unripe red. Raw or cooked, they're mild and family-friendly.",
    flavorProfile: "Sweet, grassy raw (green more so); smoky and deep when charred",
    prepTips: "Char directly over a gas flame or under a broiler until black, then steam in a bowl covered with plastic wrap for 10 minutes — skin slips off by hand. Cut lengthwise for fajitas, rings for sandwiches.",
    storage: {
      location: "fridge",
      shelfLifeDays: 14,
      shelfLife: { fridge: 14, freezer: 240, pantry: null },
      tips: "Crisper drawer, unwashed. Once cut, wrap tightly — exposed flesh dries fast. Freezes well for cooking: dice, freeze on a sheet tray, transfer to a bag.",
      spoilageSigns: "Soft wrinkled skin, dark spots, white mold in the core around the seeds.",
      freezable: true,
      freezeNotes: "Dice raw, sheet-freeze, bag. 8 months for cooking use — texture kills raw applications but fine for sauté, stew, stir-fry.",
      prepYield: { whole: "1 medium pepper", yields: "~1 cup sliced / ~¾ cup diced" },
    },
    substitutions: [
      { id: "poblano", tier: "pro",       note: "Mild heat + more character. Upgrade for fajitas and stuffed peppers." },
      { id: "pimento", tier: "emergency", note: "Sweeter, smaller, usually jarred. Substitute in sauces and dressings where texture doesn't matter." },
    ],
    pairs: ["yellow_onion", "olive_oil", "garlic", "chicken_breast"],
    flavor: {
      primary: ["sweet", "bitter"],
      intensity: "mild",
      heatChange: {
        raw: "crisp, grassy, sweet — green peppers carry more bitter edge than red",
        cooked: "softens, sweetens, loses some of the watery freshness",
        charred: "blistered skin peeled off reveals silken smoky-sweet flesh — the upgrade play",
      },
    },
    nutrition: { per: "100g", kcal: 31, protein_g: 1, fat_g: 0.3, carb_g: 6, fiber_g: 2.1, sodium_mg: 4 },
    origin: "Central and South America — domesticated over 9,000 years ago. The 'bell' shape was developed in the 1920s in Hungary from sweeter paprika peppers.",
    culturalNotes: "Red, yellow, and orange peppers are 2–3× the price of green because they're on the vine longer. Green ones are picked early and sold to keep the crop profitable while the rest ripen.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: true, allium: false },
    seasonality: { peakMonthsN: [7, 8, 9, 10], peakMonthsS: [1, 2, 3, 4], yearRound: true },
    sourcing: "Heavy for their size = more flesh. Wrinkled or soft spots = past prime. For fajitas, mix colors for visual interest; flavor differences are subtle.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Commodity vegetable. Green is half the price of colored — use green for cooked applications, colored for raw.",
    },
    skillDev: { skills: ["knife", "heat"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  carrot: {
    description: "Root vegetable — sweet, crunchy raw, transformed to deep caramelized sweetness when roasted or braised. A mirepoix staple along with onion and celery.",
    flavorProfile: "Sweet, earthy; intensifies when cooked. Raw carrots are crisp and grassy; roasted carrots are candy.",
    prepTips: "Peel only if the skin's tough or dirty — young carrots don't need it. For stocks and braises, leave chunky; for raw salads, match the cut (ribbons, julienne, grated) to the dressing.",
    storage: {
      location: "fridge",
      shelfLifeDays: 30,
      shelfLife: { fridge: 30, freezer: 300, pantry: null },
      tips: "Remove any leafy tops — they pull moisture from the root. Store in a zip-top bag in the crisper; they keep for weeks. Limp carrots can be revived 30 min in ice water.",
      spoilageSigns: "Slimy film, white mold, black soft spots, or dried-out cracked skin that won't revive in water.",
      freezable: true,
      freezeNotes: "Blanch 3 minutes, shock in ice water, bag. 10 months. Raw-frozen carrots get texturally weird but work for purées.",
      prepYield: { whole: "1 medium carrot (~60g)", yields: "~½ cup diced / ~⅓ cup grated" },
    },
    substitutions: [
      { id: "parsnip", tier: "direct", note: "Similar cooking behavior; sweeter and more aromatic when roasted." },
    ],
    pairs: ["yellow_onion", "butter", "thyme", "honey"],
    flavor: {
      primary: ["sweet", "bitter"],
      intensity: "mild",
      heatChange: {
        raw: "crisp, grassy, clean sweet",
        cooked: "softens, caramelizes, and turns genuinely candy-like at the edges",
        charred: "deep roasted sweetness with bitter smoky edge — roasting at 425°F is the play",
      },
    },
    nutrition: { per: "100g", kcal: 41, protein_g: 0.9, fat_g: 0.2, carb_g: 10, fiber_g: 2.8, sodium_mg: 69 },
    origin: "Central Asia (Afghanistan) — originally purple. The orange variety was developed in 17th-century Netherlands, possibly as a tribute to William of Orange.",
    culturalNotes: "Rainbow / heirloom carrots (purple, yellow, white, red) are closer to the original species than the uniform orange we grew up with. Purple ones stain everything they touch bright pink.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { peakMonthsN: [9, 10, 11], peakMonthsS: [3, 4, 5], yearRound: true },
    sourcing: "Loose carrots with greens attached are fresher than bagged. 'Baby' carrots are usually whittled-down large carrots; real baby carrots from a farmer's market are another category.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Commodity vegetable. A fresh farmer's-market bunch tastes better raw but disappears into mirepoix. Bagged baby carrots are a huge step down in flavor.",
    },
    skillDev: { skills: ["knife", "heat"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  mushroom: {
    description: "The catch-all category — button, cremini, portobello, shiitake, oyster, chanterelle, morel. Meaty, umami-rich, the vegetarian kitchen's secret weapon.",
    flavorProfile: "Earthy, savory, umami; dried mushrooms concentrate all three to a different dimension",
    prepTips: "Don't wash — wipe with a damp paper towel. Mushrooms absorb water and steam instead of browning. For crispy sear, crowd-free hot pan, dry mushrooms, high heat, salt AFTER they've browned.",
    storage: {
      location: "fridge",
      shelfLifeDays: 7,
      shelfLife: { fridge: 7, freezer: 300, pantry: null },
      tips: "In their original packaging or a paper bag (not plastic — traps moisture, speeds rot). Wrinkled caps mean they're past prime but still fine for soups and stocks.",
      spoilageSigns: "Slimy film on the cap, black spots, sour or ammonia smell. Wrinkled-but-firm is still usable for soup.",
      freezable: true,
      freezeNotes: "Sauté first, then freeze. Raw-frozen mushrooms weep into mush on thaw — pre-cooked ones retain texture better.",
      prepYield: { whole: "8 oz / 227g", yields: "~3 cups sliced raw / ~1 cup cooked" },
    },
    substitutions: [
      { id: "dried_porcini", tier: "pro", note: "Rehydrate in warm water; the soaking liquid becomes an umami bomb for sauces and risottos. Use 1 oz dried per 8 oz fresh." },
    ],
    pairs: ["butter", "garlic", "thyme", "red_wine"],
    flavor: {
      primary: ["umami", "bitter"],
      intensity: "moderate",
      heatChange: {
        raw: "mild, earthy, watery — not great eating on its own",
        cooked: "deeply savory; Maillard browning is the whole reason to cook them hot and dry",
        charred: "meaty-smoky — grilled portobellos are a steak substitute for good reason",
      },
    },
    nutrition: { per: "100g", kcal: 22, protein_g: 3.1, fat_g: 0.3, carb_g: 3.3, fiber_g: 1, sodium_mg: 5 },
    origin: "Mushroom cultivation dates to Imperial China ~1,500 years ago. Agaricus bisporus (white button, cremini, portobello — all same species, different maturities) was first cultivated in 17th-century France.",
    culturalNotes: "Cremini and portobello are just older button mushrooms. Same species, picked at different ages. The 'portobello' name was invented in the 1980s to sell what producers had been throwing away.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "moderate", nightshade: false, allium: false },
    seasonality: { peakMonthsN: [9, 10, 11], peakMonthsS: [3, 4, 5], yearRound: true },
    sourcing: "Button and cremini year-round; specialty (shiitake, oyster, trumpet) at better groceries; wild (morel, chanterelle) at farmer's markets in season. Dried porcini is worth keeping in the pantry permanently.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Cremini taste dramatically better than white button — same species, older, more flavorful. Specialty mushrooms (shiitake, oyster) multiply the effect. Wild seasonal ones change the game.",
    },
    skillDev: { skills: ["heat", "knife"], difficulty: "moderate", proFromScratch: false, fromScratchRecipeId: null },
  },

  spinach: {
    description: "Soft-leaved dark green — wilts in seconds, filling when raw, vanishes into a cup of cooked volume. The kitchen's most reliable green.",
    flavorProfile: "Mild, slightly mineral, faintly sweet; tangy edge with long cooking from oxalic acid",
    prepTips: "Buy in bulk; cooks down to ~10% of raw volume. Wash even 'pre-washed' bags — spinach holds grit. Sauté in olive oil with garlic and a pinch of salt for 90 seconds, pull when just wilted — longer goes slimy.",
    storage: {
      location: "fridge",
      shelfLifeDays: 7,
      shelfLife: { fridge: 7, freezer: 300, pantry: null },
      tips: "Crisper drawer in its original bag or a zip-top with a paper towel to absorb moisture. Wilted spinach can be cooked — slimy spinach cannot.",
      spoilageSigns: "Dark slimy patches, rotten-swamp smell, yellowing across the bunch. Goes from perfect to slime in 24 hours.",
      freezable: true,
      freezeNotes: "Blanch 30 sec, shock, squeeze bone-dry, portion, freeze. 10 months. Frozen commercial spinach is legitimate for soups/fillings.",
      prepYield: { whole: "10 oz / 284g raw", yields: "~1 cup cooked (shrinks to ~10%)" },
    },
    substitutions: [
      { id: "kale",        tier: "direct", note: "Hardier; needs longer cooking or a massage with oil + salt to soften raw." },
      { id: "swiss_chard", tier: "direct", note: "Bigger leaves, earthier flavor. Stems cook separately — dice and sauté with aromatics first." },
    ],
    pairs: ["garlic", "olive_oil", "lemon", "parmesan"],
    flavor: {
      primary: ["bitter", "umami"],
      intensity: "mild",
      heatChange: {
        raw: "tender, mildly mineral, barely-sweet",
        cooked: "softens and concentrates — the oxalic-acid tang rises the longer you cook it",
        charred: "wilts too fast to char meaningfully — not a high-heat green",
      },
    },
    nutrition: { per: "100g", kcal: 23, protein_g: 2.9, fat_g: 0.4, carb_g: 3.6, fiber_g: 2.2, sodium_mg: 79 },
    origin: "Persia (modern Iran) — came to Europe via Moorish Spain in the 11th century. 'Spanish vegetable' in many European languages for centuries.",
    culturalNotes: "Popeye's strength came from spinach's iron content, which turns out to be overstated — an early 1870s study mis-placed a decimal point by 10×, and the error wasn't caught until the 1930s.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { peakMonthsN: [3, 4, 5, 10, 11], peakMonthsS: [4, 5, 9, 10, 11], yearRound: true, preservedAvailable: true },
    sourcing: "Baby spinach for salads, mature (bunched) spinach for cooking. Bunched is cheaper and more flavorful but needs washing. Frozen spinach is legitimate for soups and fillings — squeeze out the water.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Bagged baby spinach is fine. Bunched mature spinach from a farmer's market has deeper flavor but needs a real wash.",
    },
    skillDev: { skills: ["knife", "heat", "timing"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  avocado: {
    description: "Buttery, green-fleshed fruit of the Persea americana tree. Eaten raw — guacamole, smashed on toast, diced in salads, sliced in tacos.",
    flavorProfile: "Rich, buttery, mildly grassy; creamy texture from ~15% fat content (mostly monounsaturated)",
    prepTips: "Ripe when it yields to gentle squeeze (not thumb-piercing pressure). Rock-hard? Bag with an apple or banana for 24 hours — ethylene accelerates ripening. Halve around the pit, twist, pop the pit with a knife tap.",
    storage: {
      location: "pantry",
      shelfLifeDays: 5,
      shelfLife: { fridge: 7, freezer: 150, pantry: 5 },
      tips: "Unripe on the counter. Ripe ones move to the fridge (slows further ripening by ~2–3 days). Cut avocado: cling wrap against the flesh + squeeze of lemon juice keeps it green overnight.",
      spoilageSigns: "Dark stringy flesh inside, sour or fermented smell, brown mushy spots that don't slice away cleanly.",
      freezable: true,
      freezeNotes: "Purée with lime juice, freeze in small portions. 5 months. Whole or sliced avocado does NOT freeze well — texture turns to paste on thaw.",
      prepYield: { whole: "1 large Hass (~200g with pit/skin)", yields: "~¾ cup mashed / ~1 cup diced" },
    },
    substitutions: [],
    pairs: ["lime", "cilantro", "tortillas", "tomato"],
    flavor: {
      primary: ["fat", "sweet"],
      intensity: "mild",
      heatChange: {
        raw: "creamy, buttery, barely-there grassiness",
        cooked: "mostly cosmetic — light warming on toast is fine; hard cooking turns it bitter and gray",
        charred: "grilled avocado halves is a real technique — smoky-sweet, briefly",
      },
    },
    nutrition: { per: "count", kcal: 322, protein_g: 4, fat_g: 29, carb_g: 17, fiber_g: 14, sodium_mg: 14 },
    origin: "Mexico and Central America — cultivated by the Mesoamerican civilizations for 10,000+ years. The Aztec word 'ahuacatl' (from which 'avocado' derives) also meant 'testicle.'",
    culturalNotes: "~90% of the Hass avocados sold in the US come from a single tree bred by Rudolph Hass in 1935. Every store-bought Hass is a clone of that tree.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "moderate", nightshade: false, allium: false },
    seasonality: { peakMonthsN: [5, 6, 7, 8, 9], peakMonthsS: [11, 12, 1, 2, 3], yearRound: true },
    sourcing: "Hass (knobby, darkens when ripe) is the default; Fuerte is a smoother, greener variety. Buy unripe, ripen on the counter — it gives you control.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Hass is Hass — clones of a single 1935 tree. Ripeness matters infinitely more than sourcing.",
    },
    skillDev: { skills: ["knife"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  lime: {
    description: "Small, green citrus. Sharper and more aromatic than lemon; the citrus of choice for Mexican, Thai, and Caribbean cooking.",
    flavorProfile: "Sharp, floral, tart; slightly bitter in the pith and zest",
    prepTips: "Roll on the counter pressing firmly before juicing — breaks the internal membranes, doubles the juice yield. Microwaving 10 seconds also works. Zest before juicing; it's impossible the other way around.",
    storage: {
      location: "fridge",
      shelfLifeDays: 21,
      shelfLife: { fridge: 21, freezer: 120, pantry: 7 },
      tips: "Crisper drawer, not the door. On the counter they'll last a week; in the fridge up to 3. Juice freezes well in ice-cube trays for later use.",
      spoilageSigns: "Hard shriveled skin, brown spots, white/gray mold at the stem end.",
      freezable: true,
      freezeNotes: "Juice into ice-cube trays (1 lime ≈ 2 tbsp), pop out when frozen, bag. 4 months. Whole limes also freeze but lose some aromatic lift.",
      prepYield: { whole: "1 Persian lime", yields: "~2 tbsp juice / 1 tsp zest" },
    },
    substitutions: [
      { id: "lemon", tier: "direct", note: "Similar brightness, different profile. Lemon is more floral-sweet; lime is sharper and more tropical." },
    ],
    pairs: ["cilantro", "avocado", "chicken_breast", "tortillas"],
    flavor: {
      primary: ["sour", "bitter"],
      intensity: "strong",
      heatChange: {
        raw: "sharp, floral, nose-tingling",
        cooked: "acid stays; aromatic oils dissipate — always add at the end",
        charred: "grilled lime halves squeeze better and add smoky sweetness to tacos/salsa",
      },
    },
    nutrition: { per: "count", kcal: 20, protein_g: 0.5, fat_g: 0.1, carb_g: 7, fiber_g: 1.9, sodium_mg: 1 },
    origin: "Southeast Asia — spread through Persian and Arab trade routes. Key limes (the small, aromatic originals) come from the Florida Keys and are used for the namesake pie.",
    culturalNotes: "18th-century British sailors were issued lime juice to prevent scurvy — hence 'limey.' Ironically, Key limes worked far better than the Persian limes the navy eventually substituted.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { peakMonthsN: [5, 6, 7, 8, 9], peakMonthsS: [11, 12, 1, 2, 3], yearRound: true },
    sourcing: "Persian limes (the usual supermarket kind) are larger and juicier. Key limes are tiny, intensely aromatic, usually only available bagged. Bottled 'lime juice' is an insult — always fresh.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Fresh limes are non-negotiable — bottled juice tastes harsh and chemical. Soft, slightly wrinkled limes yield more juice than firm ones.",
    },
    skillDev: { skills: ["knife", "seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  cilantro: {
    description: "Fresh coriander leaves — the herb that Mexican, Thai, Vietnamese, and North African cuisines lean on hardest. Divisive: a small fraction of people taste soap (a genetic variant of the OR6A2 olfactory receptor).",
    flavorProfile: "Bright, citrusy, soapy-to-some, fresh; cools and lifts fatty or spicy dishes",
    prepTips: "Chop stems and leaves — stems carry more flavor than the leaves and are common in Thai/Mexican cooking. Add at the very end; cilantro wilts to mush with any real heat.",
    storage: {
      location: "fridge",
      shelfLifeDays: 10,
      shelfLife: { fridge: 10, freezer: 180, pantry: null },
      tips: "Stand stems in a glass of water, loose bag over the top. Or wrap in slightly damp paper towel inside a zip-top. Slimy cilantro is a total loss — no rescue.",
      spoilageSigns: "Yellow or translucent leaves, slimy stems, sour smell — rots faster than parsley, so check often.",
      freezable: true,
      freezeNotes: "Purée with lime juice + neutral oil into cubes. 6 months. Dried cilantro is essentially flavorless; don't bother.",
    },
    substitutions: [
      { id: "parsley", tier: "dietary", note: "Closest visual match; entirely different flavor. Use if cilantro-aversion is in play (the soap-gene crowd is real)." },
    ],
    pairs: ["lime", "garlic", "jalapeno", "avocado"],
    flavor: {
      primary: ["sour", "heat", "bitter"],
      intensity: "strong",
      heatChange: {
        raw: "bright, citrusy, nose-tingling",
        cooked: "flavor fades fast; stems hold up better than leaves",
        charred: "wilts to slime with any real heat; purely a finishing herb",
      },
    },
    nutrition: { per: "100g", kcal: 23, protein_g: 2.1, fat_g: 0.5, carb_g: 3.7, fiber_g: 2.8, sodium_mg: 46 },
    origin: "Eastern Mediterranean and Central Asia. One of the oldest cultivated herbs — seeds (coriander) found in Egyptian tombs.",
    culturalNotes: "The soap-taste haters are genuine — roughly 4–14% of people depending on heritage, due to a gene variant. Not picky eaters; literally a different sensory experience.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { peakMonthsN: [5, 6, 7, 8], peakMonthsS: [11, 12, 1, 2], yearRound: true },
    sourcing: "Bunches should be vibrant green with no slime at the base. 'Culantro' (recao) is a stronger, sturdier cousin used in Caribbean cooking — a legit substitute if you can find it.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Cheap bunches are fine. Freshness is everything — buy small, buy often.",
    },
    skillDev: { skills: ["knife", "seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  // ── pantry: grains + flours ──────────────────────────────────────
  spaghetti: {
    description: "Long, thin dried wheat pasta. The default noodle of the American Italian kitchen — the shape for carbonara, aglio e olio, meatballs, and a thousand weeknight dinners.",
    flavorProfile: "Clean, wheaty, faintly nutty; takes on whatever sauce it meets",
    prepTips: "Salt the water like the sea (1 tbsp per quart). Cook 1 minute less than the box for al dente, then finish in the pan with the sauce — the last minute of starch-release is what makes sauce cling. Save a cup of pasta water before draining.",
    storage: {
      location: "pantry",
      shelfLifeDays: 730,
      shelfLife: { fridge: null, freezer: null, pantry: 730 },
      tips: "Sealed in a dry cabinet. Dried pasta is basically immortal — 'best by' dates are conservative. An opened box keeps 1–2 years.",
      spoilageSigns: "Moth eggs or webs (pantry moths love pasta), musty smell, or oily spots indicating rancidity. Extremely rare.",
      freezable: false,
      freezeNotes: "No point — dried pasta stores indefinitely in the pantry.",
    },
    substitutions: [
      { id: "linguine", tier: "direct", note: "Flatter, similar thickness. Works in most spaghetti recipes." },
      { id: "bucatini", tier: "pro",    note: "Hollow core; heartier. Classic for amatriciana — upgrade for Roman pastas." },
    ],
    pairs: ["pecorino", "guanciale", "black_pepper", "garlic"],
    flavor: {
      primary: ["umami", "sweet"],
      intensity: "mild",
      heatChange: {
        raw: "firm, chalky, brittle",
        cooked: "tender with a slight chew (al dente); carries whatever sauce it meets",
        charred: "toasted-pasta technique (brown the dry noodles in oil before boiling) adds a nutty depth",
      },
    },
    nutrition: { per: "100g", kcal: 371, protein_g: 13, fat_g: 1.5, carb_g: 75, fiber_g: 3.2, sodium_mg: 6 },
    origin: "Wheat pasta dates to ancient Persia/China; Italian tradition codified around Naples and Genoa in the 1200s. The American diet's obsession with spaghetti specifically came post-WWII.",
    culturalNotes: "'Al dente' literally means 'to the tooth' — the pasta should have a tiny chalky core visible when you bite one in half. Mushy pasta is an American invention.",
    allergens: ["gluten"],
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "moderate", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Bronze-die (trafilato al bronzo) pasta has a rougher surface that holds sauce better. Italian imports (De Cecco, Rustichella, Setaro) are worth the markup over American mass-market brands.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Bronze-die Italian pasta is noticeably better than standard teflon-extruded. The rough surface holds sauce; the texture is chewier. Worth 2–3× for the dishes where pasta is the star.",
    },
    skillDev: { skills: ["timing", "heat"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
  },

  bread: {
    description: "Generic loaf — the thing you actually have in the kitchen when a recipe says 'a slice of bread.' Sandwich loaves, sourdough boules, multigrain, whatever the house keeps.",
    flavorProfile: "Wheaty, mildly sweet; sourdough adds tang, rye adds earth, whole wheat adds grass",
    prepTips: "Stale bread > fresh bread for nearly every cooking application: breadcrumbs, strata, panzanella, French toast. Fresh bread is for eating, not cooking.",
    storage: {
      location: "pantry",
      shelfLifeDays: 5,
      shelfLife: { fridge: 10, freezer: 90, pantry: 5 },
      tips: "Paper bag (breathable) keeps the crust crisp. Plastic bags keep the crumb soft but soften the crust. Freeze halved loaves if you're not eating them fast — toasts from frozen perfectly.",
      spoilageSigns: "Any visible mold — the rest of the loaf is also contaminated, don't 'cut off' and eat. Sour-fermented smell beyond a sourdough's natural tang.",
      freezable: true,
      freezeNotes: "Halve, wrap in foil + zip-top. Toast directly from frozen in a toaster — perfect slices, no defrost needed. 3 months.",
    },
    substitutions: [
      { id: "baguette",  tier: "direct", note: "Same family; crustier. Use for tartines and crusty-bread applications." },
      { id: "ciabatta",  tier: "direct", note: "Holier crumb, better for sandwiches." },
    ],
    pairs: ["butter", "olive_oil", "cheese", "tomato"],
    flavor: {
      primary: ["sweet", "umami"],
      intensity: "mild",
      heatChange: {
        raw: "soft, yeasty, mildly sweet",
        cooked: "toasts into Maillard-rich crisp-chewy perfection",
        charred: "burnt toast is acrid; pulled-back char adds bitter-sweet caramelization",
      },
    },
    nutrition: { per: "100g", kcal: 265, protein_g: 9, fat_g: 3.2, carb_g: 49, fiber_g: 2.7, sodium_mg: 491 },
    origin: "Leavened bread dates to at least ancient Egypt (4,000+ years ago). Almost every agricultural civilization developed some form independently.",
    allergens: ["gluten"],
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "high", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "A real bakery loaf tastes like a different food than sliced supermarket bread. If you have one nearby, worth the 10-minute detour. Frozen half-loaves from a good bakery outperform fresh from a mediocre one.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Bakery bread is transformative. Supermarket soft sliced bread has its place (school lunches, French toast) but for toast, cheese boards, and dipping — spend on the good stuff.",
    },
    skillDev: { skills: ["dough", "heat"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
  },

  baguette: {
    description: "The long, slender French loaf. Crackling golden crust, airy interior, ready for butter, cheese, or the classic ham-and-butter sandwich (jambon-beurre).",
    flavorProfile: "Wheaty, faintly sour, clean; crust carries caramelized notes from the high-heat bake",
    prepTips: "Best within 4–6 hours of baking. Day-old baguette: refresh with a 30-second splash under running water, then 5 minutes in a 350°F oven — returns the crust to shatter-crisp.",
    storage: {
      location: "pantry",
      shelfLifeDays: 2,
      shelfLife: { fridge: 5, freezer: 60, pantry: 2 },
      tips: "Stand it upright in a paper bag; this slows the crust-softening. Freeze the second half the day you buy it.",
      spoilageSigns: "Visible mold (especially in humid climates within 48h), sour-funky smell, crust gone rock-hard and crumb turned stale-gray.",
      freezable: true,
      freezeNotes: "Slice and freeze for toast-ready rounds. Whole half-baguettes freeze fine but need refresh in the oven on thaw.",
    },
    substitutions: [
      { id: "ciabatta", tier: "direct",    note: "Italian cousin; holier crumb, wider shape. Similar crust play." },
      { id: "bread",    tier: "emergency", note: "Emergency fallback — results noticeably different." },
    ],
    pairs: ["butter", "ham", "brie", "olive_oil"],
    flavor: {
      primary: ["sweet", "umami"],
      intensity: "mild",
      heatChange: {
        raw: "crackling crust, airy crumb, barely-there sweetness",
        cooked: "re-crisps beautifully at 350°F for 5 min — the day-old baguette save",
        charred: "bruschetta territory — grilled slices with olive oil are prized; past that it's toast-char",
      },
    },
    nutrition: { per: "100g", kcal: 274, protein_g: 9.8, fat_g: 2.6, carb_g: 52, fiber_g: 2.5, sodium_mg: 570 },
    origin: "Paris, early 20th century — invented as a quick-to-bake loaf after labor laws banned early-morning baker shifts. The thin shape cooks in 20 minutes instead of an hour.",
    culturalNotes: "UNESCO recognized French baguette craftsmanship as an 'intangible cultural heritage' in 2022. By law, a real Parisian baguette tradition contains only flour, water, salt, and yeast — no additives.",
    allergens: ["gluten"],
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "high", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "A real bakery baguette at ~$3 is one of the best deals in food. Supermarket baguettes are an entirely different product — same shape, different soul.",
    market: {
      priceTier: "budget",
      availability: "specialty",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "This is THE ingredient to source carefully. Supermarket baguettes are factory bread shaped like a baguette; the real thing from a bakery is a completely different food.",
    },
    skillDev: { skills: ["dough", "timing"], difficulty: "technical", proFromScratch: true, fromScratchRecipeId: null },
  },

  ciabatta: {
    description: "Italian rustic bread — holey, airy crumb; floury, crackling crust; wide flat loaf shape. The sandwich bread for when you want structure and chew.",
    flavorProfile: "Mild, yeasty, faintly sour; open crumb soaks up oil and vinegar beautifully",
    prepTips: "For panini and grilled sandwiches, ciabatta is unbeatable — the holes trap fillings, the crust crisps gorgeously under the press. For bruschetta, toast cut slices in a hot dry pan.",
    storage: {
      location: "pantry",
      shelfLifeDays: 3,
      shelfLife: { fridge: 7, freezer: 60, pantry: 3 },
      tips: "Paper bag or bread box. Reheats beautifully: 5 min in a 350°F oven wakes the crust back up. Freezes well in halves.",
      spoilageSigns: "Visible mold, rock-hard crust plus stale crumb, or sour-funky smell beyond a hint of sourdough tang.",
      freezable: true,
      freezeNotes: "Halve before freezing. Revive in a 350°F oven for 8 min straight from frozen — crust shatters back to crisp.",
    },
    substitutions: [
      { id: "baguette",  tier: "direct", note: "Finer crumb; different sandwich style (tartine vs panino)." },
      { id: "focaccia",  tier: "pro",    note: "Same region, richer with olive oil. Upgrade for sandwiches where oil-absorption is the point." },
    ],
    pairs: ["tomato", "mozzarella", "prosciutto", "olive_oil"],
    flavor: {
      primary: ["sweet", "umami"],
      intensity: "mild",
      heatChange: {
        raw: "airy, slightly chewy, faintly yeasty",
        cooked: "panini-press territory — crust goldens and the crumb soaks up the filling's juices",
        charred: "grilled-bruschetta char adds toasty-bitter edge; past that it's burnt toast",
      },
    },
    nutrition: { per: "100g", kcal: 271, protein_g: 9, fat_g: 3, carb_g: 52, fiber_g: 2.5, sodium_mg: 540 },
    origin: "Invented in 1982 in Veneto, Italy. Actually recent — an Italian baker (Arnaldo Cavallari) developed it as a response to the French baguette's popularity in sandwiches.",
    culturalNotes: "The name means 'slipper' in Italian — the wide, flat loaf shape. For all its rustic appearance, ciabatta is essentially a modern invention younger than the microwave.",
    allergens: ["gluten"],
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "high", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "A bakery ciabatta is meaningfully better than supermarket. The hydration (water in the dough) is very high — commercial bakers often cheat with less, and you can taste it.",
    market: {
      priceTier: "moderate",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "High-hydration dough is what makes the holes — commercial supermarket ciabatta often cheats and is denser. Bakery versions have the real open crumb.",
    },
    skillDev: { skills: ["dough", "timing"], difficulty: "technical", proFromScratch: true, fromScratchRecipeId: null },
  },

  flour: {
    description: "All-purpose wheat flour — the default. A ~10–12% protein content splits the difference between soft cake flour and high-gluten bread flour. Works for most baking and all thickening.",
    flavorProfile: "Clean, faintly sweet; takes on whatever flavors surround it",
    prepTips: "Weigh, don't scoop — a packed cup can vary by 40g. For gravies and roux: whisk 1 tbsp flour + 1 tbsp fat for 1 minute (blonde) or 3 minutes (caramel) to cook out the raw-flour taste before adding liquid.",
    storage: {
      location: "pantry",
      shelfLifeDays: 240,
      shelfLife: { fridge: 365, freezer: 730, pantry: 240 },
      tips: "Cool, dry cabinet in an airtight container — the original paper bag invites weevils. Whole-wheat flour goes rancid faster (oils in the germ); store in the fridge if you keep any.",
      spoilageSigns: "Musty or sour smell, visible weevils/moths, yellowed color, or rancid oil scent (especially whole-wheat). Clumping alone isn't spoilage — just humidity; sift and use.",
      freezable: true,
      freezeNotes: "Freeze in an airtight bag to kill any weevil eggs from the mill — standard practice. Thaw to room temp before baking so the flour behaves predictably in recipes.",
      prepYield: "1 cup AP flour ≈ 120g (spooned and leveled). A \"packed\" cup can be 160g+ — why weighing matters.",
    },
    substitutions: [
      { id: "bread_flour",   tier: "pro",       note: "Higher protein (~13%). For yeasted breads and pizza dough — chewier crumb." },
      { id: "cake_flour",    tier: "direct",    note: "Lower protein (~8%). For tender cakes and biscuits — different job, not a 1:1 swap." },
    ],
    pairs: ["butter", "sugar", "eggs", "salt"],
    flavor: {
      primary: ["sweet"],
      intensity: "mild",
      heatChange: {
        raw: "chalky, faintly sweet — never eat raw (food-safety) and tastes pasty anyway",
        cooked: "develops nutty, bready notes; roux goes blonde → peanut → chocolate as it browns",
        charred: "burnt flour is acrid and bitter; past dark-chocolate roux it's ruined",
      },
    },
    nutrition: { per: "100g", kcal: 364, protein_g: 10, fat_g: 1, carb_g: 76, fiber_g: 2.7, sodium_mg: 2 },
    origin: "Milled wheat dates to the dawn of agriculture (~10,000 years). Modern roller-milled white flour is a 19th-century invention; before that, all flour was stoneground and coarser.",
    allergens: ["gluten"],
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "high", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "King Arthur's AP flour has a consistent 11.7% protein content — the most reliable American AP flour. European '00' flour is finer and softer, great for pasta and pizza but not interchangeable for most baking.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "King Arthur's consistent protein spec actually matters for bread baking — cheaper bags vary batch-to-batch and your dough behaves differently. For cakes and roux, any AP flour is fine.",
    },
    skillDev: { skills: ["dough", "sauce"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  sugar: {
    description: "White granulated sugar — refined sucrose. The universal sweetener in Western baking, key to Maillard browning, structure in meringues, balance in savory sauces.",
    flavorProfile: "Clean, sweet; no flavor beyond sweetness",
    prepTips: "For caramel: dry method (sugar alone in a pan) is faster but risks burning — stay vigilant. Wet method (sugar + water) is forgiving but slower. Don't stir once it starts to color; swirl the pan.",
    storage: {
      location: "pantry",
      shelfLifeDays: 1825,
      shelfLife: { fridge: null, freezer: null, pantry: 1825 },
      tips: "Airtight container. White sugar is functionally immortal — it doesn't spoil; just hardens if exposed to humidity. A slice of bread in the container softens hardened sugar overnight.",
      spoilageSigns: "Ants, weevils, or mold (only if water got in). Hardening is not spoilage — break up and use. Yellowing suggests contamination; toss.",
      freezable: false,
      freezeNotes: "No benefit — pantry storage is essentially forever.",
      prepYield: "1 cup white sugar ≈ 200g. 1 cup packed brown sugar ≈ 220g.",
    },
    substitutions: [
      { id: "brown_sugar", tier: "direct",    note: "Molasses content adds warmth and moisture. Packed cup for cup in most recipes — different color and slight flavor." },
      { id: "honey",       tier: "dietary",   note: "Sweeter, more moisture. Reduce other liquid by 25%, reduce oven temp by 25°F." },
    ],
    pairs: ["butter", "cinnamon", "vanilla", "flour"],
    flavor: {
      primary: ["sweet"],
      intensity: "mild",
      heatChange: {
        raw: "pure sweetness, no other notes",
        cooked: "caramelizes to nutty, buttery, complex flavors as it passes through amber to mahogany",
        charred: "burnt sugar is acrid and bitter — past dark-amber it's lost; start over",
      },
    },
    nutrition: { per: "100g", kcal: 387, protein_g: 0, fat_g: 0, carb_g: 100, sodium_mg: 1 },
    origin: "Sugarcane originated in New Guinea ~10,000 years ago; sugar refining came via India to the Arab world, to Europe, and eventually to the colonial Americas — with all the dark history that implies.",
    culturalNotes: "Pre-industrial, sugar was a luxury spice stored in locked boxes. Average per-capita consumption has increased roughly 30× since 1800 — industrial processing made it the cheap default it is today.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "For baking, white granulated is the standard. Specialty sugars (muscovado, demerara, turbinado) have moisture and molasses notes that change the behavior — not 1:1 swaps.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Commodity ingredient — any brand of white granulated is indistinguishable in baking. Specialty sugars (muscovado, demerara) are where quality starts to matter.",
    },
    skillDev: { skills: ["heat", "timing"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  tortillas: {
    description: "Flatbreads from Mexican cuisine — corn (yellow or white masa) or flour (wheat), varying diameters. Tortillas are the plate, the spoon, and the context in countless dishes.",
    flavorProfile: "Corn: earthy, slightly sweet, toasty when warm. Flour: mild, wheaty, tender.",
    prepTips: "ALWAYS warm before serving — cold tortillas crack. Gas flame: 10 seconds per side directly on the burner (tongs required). No gas? Dry pan over medium-high, 20 seconds per side. Stack wrapped in foil to keep warm.",
    storage: {
      location: "fridge",
      shelfLifeDays: 14,
      shelfLife: { fridge: 14, freezer: 180, pantry: 3 },
      tips: "In their original bag in the fridge. Freeze in flat packs for longer storage. Room temp: 2–3 days max; they dry out fast.",
      spoilageSigns: "Visible mold on any one — toss the stack (spores spread fast in a stacked bag). Sour smell, stiffness past rehydration, dark spots.",
      freezable: true,
      freezeNotes: "Freeze in flat stacks with parchment between every 3–4 tortillas so you can pull what you need. Thaw at room temp 20 min or microwave wrapped in damp paper towel.",
      prepYield: "A standard 10-count pack of 6\" corn tortillas serves 4 as taco base (2–3 per person). Flour 10\" burrito-size: 1 per person.",
    },
    substitutions: [
      { id: "bread",   tier: "emergency", note: "Wrap-style sandwiches in a pinch — loses the whole Mexican context but works for hand-held." },
    ],
    pairs: ["lime", "cilantro", "avocado", "chicken_breast"],
    flavor: {
      primary: ["sweet", "umami"],
      intensity: "mild",
      heatChange: {
        raw: "packaged tortillas are pliable but flavorless cold — always warm",
        cooked: "toasted corn tortillas gain nutty, popcorn-adjacent depth; flour tortillas blister and get buttery",
        charred: "blackened char-spots (not the whole tortilla) are the goal for carne asada — adds smoky bitterness that balances the fat",
      },
    },
    nutrition: { per: "count", kcal: 96, protein_g: 2.6, fat_g: 2.3, carb_g: 16, fiber_g: 1.1, sodium_mg: 204 },
    origin: "Mesoamerica — domesticated from teosinte corn ~9,000 years ago. Corn tortillas are the older tradition; wheat tortillas came with the Spanish in the 1500s and settled in Northern Mexico.",
    culturalNotes: "Real Mexican tortillerías use nixtamalized masa (corn cooked in alkaline water) — the process releases nutrients and creates the distinctive aroma. Supermarket corn tortillas skip this step, which is why they taste different.",
    allergens: ["gluten"],  // flour tortillas; corn tortillas are gluten-free
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "moderate", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "For tacos al pastor / carne asada: handmade corn tortillas from a local tortillería (or make your own from masa harina). For burritos and quesadillas: large flour. Freshness matters more than brand.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Handmade corn tortillas from a tortillería are a different food than shelf-stable supermarket ones — nixtamalized masa, proper aroma, pliability. If there's one in your area, worth the detour.",
    },
    skillDev: { skills: ["heat", "timing"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
  },

  // ── pantry: oils + wines + stocks ────────────────────────────────
  olive_oil: {
    description: "Pressed juice of olives — extra-virgin (EVOO) is cold-pressed first-press from a single harvest, unrefined; regular 'olive oil' is refined and blended. The base of Mediterranean cooking and one of the most versatile fats in the kitchen.",
    flavorProfile: "Grassy, peppery, fruity; a good EVOO finishes with a bitter throat-tickle that means polyphenols are present",
    prepTips: "Two oils, two jobs: cheap blended olive oil for hot pans (sautéing, roasting); expensive EVOO for finishing (drizzling on burrata, dressing salads, dipping bread). Heating great EVOO over 350°F destroys the polyphenols you paid for.",
    storage: {
      location: "pantry",
      shelfLifeDays: 540,
      shelfLife: { fridge: null, freezer: null, pantry: 540 },
      tips: "Cool, dark cabinet — heat and light go after the flavor compounds. A dark glass bottle beats clear. Once opened, use within 6 months for peak flavor; rancid oil smells like crayons or putty.",
      spoilageSigns: "Crayon, putty, or \"old paint\" smell = rancid — toss. Cloudy/solid at cold temps is normal (olive oil solidifies in the fridge); warms back clear. Metallic or musty off-notes mean it's been exposed to heat/light too long.",
      freezable: false,
      freezeNotes: "Don't freeze — no benefit, and the texture breaks when thawed. Cool pantry is the right home.",
      prepYield: "1 cup = ~215g. A \"glug\" (home-cook pour) ≈ 1 tbsp.",
    },
    substitutions: [
      { id: "butter",      tier: "direct",    note: "For finishing pasta or vegetables; richer, less herbaceous. 1:1 by volume." },
      { id: "ghee",        tier: "pro",       note: "For high-heat sautés where olive oil's smoke point is the issue — clarified butter handles 450°F+ without breaking." },
    ],
    pairs: ["garlic", "basil", "lemon", "tomato", "balsamic"],
    flavor: {
      primary: ["bitter", "sour"],
      intensity: "medium",
      heatChange: {
        raw: "grassy, peppery, fruity; polyphenols bite the throat — the signature of a fresh EVOO",
        cooked: "mellows; the assertive grassy notes fade under heat — save good EVOO for finishing",
        charred: "past ~410°F (smoke point) it breaks down to acrid, burnt-rubber notes — pull the pan",
      },
    },
    nutrition: { per: "100g", kcal: 884, protein_g: 0, fat_g: 100, carb_g: 0, sodium_mg: 2 },
    origin: "Mediterranean basin — domesticated olives date to ~6,000 BCE in the Levant. Spain, Italy, and Greece account for ~70% of global production today.",
    culturalNotes: "The 'extra-virgin' label is widely abused. Italian-bottled doesn't mean Italian-grown — much of what's sold as Italian EVOO is blended from Spain, Greece, and Tunisia. The 2007 'extra-virgin olive oil scandal' (chronicled in Tom Mueller's 'Extra Virginity') showed most US-supermarket EVOO failed lab tests for purity.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true, preservedAvailable: true },
    sourcing: "Look for a harvest date on the bottle (not just 'best by') and a single country of origin. California Olive Ranch, Cobram Estate, and any oil with a recent (within 12 months) harvest date is a safer bet than the cheap big-name imports.",
    market: {
      priceTier: "mid",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "One of the most fraudulent categories in food — supermarket \"Italian EVOO\" routinely fails purity tests. A single-origin bottle with a harvest date within 12 months is night-and-day different from a cheap blended import.",
    },
    skillDev: { skills: ["heat", "sauce"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  balsamic: {
    description: "Italian vinegar from Modena and Reggio Emilia, made from cooked grape must (mosto cotto), aged in a battery of progressively smaller wooden casks. True 'tradizionale' is aged 12–25+ years; commercial 'Aceto Balsamico di Modena IGP' is younger and blended with wine vinegar.",
    flavorProfile: "Sweet-tart, syrupy, deeply fruity; aged versions taste like fig jam with bright acidity",
    prepTips: "Cheap supermarket balsamic ($5–10): reduce in a pan with a splash of honey to fake the syrupy intensity of an aged bottle. Real tradizionale ($80+ for 100ml): never cook it. Drop it onto Parmigiano shards, vanilla ice cream, or strawberries.",
    storage: {
      location: "pantry",
      shelfLifeDays: 1825,
      shelfLife: { fridge: null, freezer: null, pantry: 1825 },
      tips: "Tightly capped in a cool cabinet. Vinegar's acidity makes it essentially immortal — it'll outlive the bottle. No need to refrigerate.",
      spoilageSigns: "Essentially never spoils. A \"mother\" (gelatinous mass) can form — harmless, strain if bothered. Sediment at the bottom is fine.",
      freezable: false,
      freezeNotes: "No benefit — pantry storage outlasts most kitchens.",
    },
    substitutions: [
      { id: "vinegar",  tier: "emergency", note: "Plain vinegar lacks the sweetness; add a pinch of brown sugar or a drop of honey to mimic." },
    ],
    pairs: ["olive_oil", "tomato", "mozzarella", "basil", "parmesan"],
    flavor: {
      primary: ["sour", "sweet"],
      intensity: "strong",
      heatChange: {
        raw: "sharp vinegary punch softened by grape-must sweetness; complex in aged bottles",
        cooked: "reduces to syrup that concentrates the fruit and caramelizes the sugars — the cheap-balsamic upgrade move",
        charred: "only happens if the pan scorches — burnt sugar bitterness ruins it",
      },
    },
    nutrition: { per: "100g", kcal: 88, protein_g: 0.5, fat_g: 0, carb_g: 17, sodium_mg: 23 },
    origin: "Modena and Reggio Emilia, Emilia-Romagna, Italy. The tradition dates to the Middle Ages; the first written reference is from 1046, when Holy Roman Emperor Henry III was gifted a bottle.",
    culturalNotes: "True 'Aceto Balsamico Tradizionale di Modena DOP' must be aged at least 12 years and is graded by a panel of judges who score it from 0–400 points. The bottle, the cork, and even the shape are protected by law. 99% of supermarket 'balsamic' is the IGP version — younger, blended, and a different product.",
    allergens: ["sulfites"],
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "For everyday cooking, 'Aceto Balsamico di Modena IGP' from a brand like Giuseppe Giusti or Mussini is excellent at $15–25. For drizzling: spend $40+ on a labeled aged bottle. Avoid anything labeled just 'balsamic vinegar' with no IGP/DOP designation — usually wine vinegar with caramel coloring.",
    market: {
      priceTier: "mid",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "IGP and DOP designations are the quality tiers — without them it's wine vinegar + caramel coloring. Worth paying for a real IGP bottle; tradizionale DOP is a different beast (and budget).",
    },
    skillDev: { skills: ["sauce", "seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  dijon: {
    description: "French mustard made from brown/black mustard seeds and white wine or verjuice (tart unripe-grape juice). Sharper, smoother, and more wine-forward than American yellow mustard.",
    flavorProfile: "Sharp, tangy, sinus-tingling; creamy texture, complex finish from the wine",
    prepTips: "Whisk a teaspoon into vinaigrettes — it's a natural emulsifier and the dressing won't separate. Stir into pan sauces off the heat (boiling kills the volatile mustard oils that make it sharp). For honey-mustard glaze: 2 parts dijon, 1 part honey, brushed on chicken or salmon.",
    storage: {
      location: "fridge",
      shelfLifeDays: 365,
      shelfLife: { fridge: 365, freezer: null, pantry: 30 },
      tips: "Refrigerate after opening — keeps for a year, though the heat (the sinus burn) fades after 6 months. If a brown crust forms on top, scrape it off; the mustard underneath is fine.",
      spoilageSigns: "Sharp sinus-bite fading is the first sign (not spoilage, just age — still usable as milder mustard). Actual spoilage: mold, off smell beyond mustard's normal pungency, or separation that doesn't stir back together.",
      freezable: false,
      freezeNotes: "Freezing breaks the emulsion — it separates and the heat dulls. Fridge-only.",
    },
    substitutions: [
      { id: "vinegar",  tier: "emergency", note: "Loses the body and pungency. Add a pinch of mustard powder if you have it." },
    ],
    pairs: ["honey", "olive_oil", "balsamic", "chicken_breast"],
    flavor: {
      primary: ["sour", "bitter"],
      intensity: "strong",
      heatChange: {
        raw: "sharp sinus-tingling heat from volatile mustard oils; creamy wine body",
        cooked: "heat mellows fast (the pungent oils are heat-sensitive) — stir into sauces off the heat to keep the kick",
        charred: "mustard past a hard boil goes flat and slightly bitter — one-note",
      },
    },
    nutrition: { per: "100g", kcal: 60, protein_g: 4, fat_g: 3, carb_g: 5, fiber_g: 3, sodium_mg: 1100 },
    origin: "Dijon, Burgundy, France. The city has been a mustard-making center since the 1300s; the formula was codified in 1856 when Jean Naigeon substituted verjuice for the vinegar in the local recipe.",
    culturalNotes: "Despite the name, 'Dijon mustard' is not a protected designation — it can be made anywhere. Most 'Dijon' on US shelves is made in the United States or by Maille (now owned by Unilever) outside of Burgundy. The actual brown mustard seed used today is largely grown in Canada.",
    allergens: ["mustard"],
    diet: { vegan: true, vegetarian: true, keto: true, halal: false, kosher: "nonkosher", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Maille and Edmond Fallot are the standard-bearers. Fallot still stone-grinds the seeds and is the only major Dijon producer based in Burgundy. Grey Poupon (Kraft) is a fine cheap default.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Fallot (stone-ground, real Burgundy) is noticeably sharper and cleaner-tasting than supermarket Dijon. Maille is the reliable default. Grey Poupon is fine for a quick vinaigrette.",
    },
    skillDev: { skills: ["sauce", "seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  beef_stock: {
    description: "Long-simmered broth from roasted beef bones, mirepoix (carrot/onion/celery), and aromatics. Roasting the bones first is what gives it the deep brown color and meaty depth — unroasted bones make a much paler, less intense stock.",
    flavorProfile: "Deep, meaty, roasted; rich, gelatinous mouthfeel from the collagen",
    prepTips: "Reduce by half before using in pan sauces — boxed stock is engineered for safety, not concentration. To deepen any boxed stock: simmer with a splash of soy sauce, a halved onion, and a bay leaf for 20 minutes before using. Bone broth (longer simmer, more collagen) is the same idea taken to its logical end.",
    storage: {
      location: "pantry",
      shelfLifeDays: 365,
      shelfLife: { fridge: 5, freezer: 180, pantry: 365 },
      tips: "Boxed/canned: pantry until opened, then 4–5 days in the fridge. Homemade: 5 days in the fridge or 6 months in the freezer (ice-cube trays for measured small portions, quart bags lying flat for braises).",
      spoilageSigns: "Cloudy when it was clear, sour smell, slime on the surface, any mold on homemade — toss. Opened boxed stock past 5 fridge days is a coin flip; don't risk it.",
      freezable: true,
      freezeNotes: "Freeze in ice-cube trays (2 tbsp portions for pan sauces) then bag, or lay quart bags flat for full-braise portions. Thaws in minutes for cubes, overnight for bags.",
      prepYield: "One 32oz box = 4 cups. Better Than Bouillon: 1 tsp + 1 cup boiling water ≈ 1 cup stock.",
    },
    substitutions: [
      { id: "chicken_stock", tier: "direct",    note: "Lighter and less beefy. Add a splash of soy sauce + tomato paste to deepen." },
    ],
    pairs: ["red_wine", "tomato_paste", "yellow_onion", "carrot", "garlic"],
    flavor: {
      primary: ["umami", "sweet"],
      intensity: "medium",
      heatChange: {
        raw: "cold/room-temp stock is gelatinous (good — means real collagen); thin watery stock is a red flag",
        cooked: "simmered and reduced it concentrates to a glossy, meaty jus — pan sauce magic",
        charred: "a demi-glace reduction can catch on the pan — scorch = bitter; pull before it goes mahogany-dark",
      },
    },
    nutrition: { per: "100g", kcal: 7, protein_g: 1.3, fat_g: 0.2, carb_g: 0.1, sodium_mg: 363 },
    origin: "Stock-making is universal in cuisines that butcher whole animals. The French codified 'fond brun' (brown stock) in the 1700s; Escoffier's 'Le Guide Culinaire' (1903) made it the foundation of Western fine dining.",
    culturalNotes: "Real homemade beef stock is rare in modern home kitchens — it takes 6–8 hours and a stockpot of bones. Boxed stock is what most weeknight cooks actually use, and it's a perfectly respectable shortcut. The 'better than bouillon' style concentrated paste is often a better deal than boxed (more depth per dollar, longer shelf life).",
    allergens: [],
    diet: { vegan: false, vegetarian: false, keto: true, halal: true, kosher: "meat", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Better Than Bouillon's Roasted Beef Base is the home cook's best deal — one 8oz jar makes 9 quarts. For boxed: Kettle & Fire (more concentrated) or Swanson's organic beef stock. Avoid 'beef broth' which is weaker than stock by definition.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Better Than Bouillon concentrated paste blows most boxed stocks out of the water for depth per dollar. Homemade is the pro-tier move when you've got bones from a roast anyway.",
    },
    skillDev: { skills: ["sauce", "timing"], difficulty: "moderate", proFromScratch: true, fromScratchRecipeId: null },
  },

  chicken_stock: {
    description: "Simmered broth from chicken bones (carcasses, backs, wings), mirepoix, and aromatics. The all-purpose cooking liquid — lighter than beef stock, more savory than vegetable, the foundation of risotto, soups, braises, and pan sauces across most cuisines.",
    flavorProfile: "Clean, savory, gently sweet; silky mouthfeel when well-made (collagen from joints does the work)",
    prepTips: "For risotto, warm the stock before adding to the rice — cold stock shocks the grains and slows the starch release. Save chicken carcasses in the freezer; once you have 2–3, simmer them with carrots/celery/onion/parsley stems for 4 hours to make stock that's better than anything boxed.",
    storage: {
      location: "pantry",
      shelfLifeDays: 365,
      shelfLife: { fridge: 5, freezer: 180, pantry: 365 },
      tips: "Boxed/canned: pantry until opened, then 4–5 days in the fridge. Homemade: 5 days fridge / 6 months freezer. Frozen in ice-cube trays = perfect 2-tbsp portions for finishing pan sauces.",
      spoilageSigns: "Cloudy when it was clear, sour smell, surface slime or film, any mold — toss. Opened boxed past day 5 fridge is risky.",
      freezable: true,
      freezeNotes: "Ice-cube trays for pan-sauce portions (2 tbsp each), quart bags laid flat for risotto/braise batches. Frozen cubes melt in 60 seconds over low heat — perfect for deglazing.",
      prepYield: "One 32oz box = 4 cups. Better Than Bouillon: 1 tsp + 1 cup boiling water ≈ 1 cup stock. A standard chicken carcass + mirepoix makes ~2 quarts homemade.",
    },
    substitutions: [
      { id: "beef_stock", tier: "direct",    note: "Heavier and more assertive. Use half + half water if you only have beef stock." },
      { id: "white_wine", tier: "emergency", note: "For deglazing or risotto in a pinch — different flavor but works for the liquid role." },
    ],
    pairs: ["yellow_onion", "carrot", "garlic", "parsley", "butter"],
    flavor: {
      primary: ["umami", "sweet"],
      intensity: "mild",
      heatChange: {
        raw: "gelatinous when cold (good) — the jiggle is the collagen that silkens sauces",
        cooked: "simmered it turns silky; reduced by half it carries pan sauces that wouldn't need butter",
        charred: "stuck-to-the-pan reduction at high heat goes bitter fast — pull before it darkens past caramel",
      },
    },
    nutrition: { per: "100g", kcal: 6, protein_g: 0.9, fat_g: 0.2, carb_g: 0.5, sodium_mg: 343 },
    origin: "Universal — every cuisine that cooks chicken makes some form of chicken stock. The French 'fond blanc' (white stock, no roasting) is the version that became the Western culinary standard.",
    culturalNotes: "Chicken stock was the first 'restaurant' food — the word 'restaurant' originally referred to the restorative meat broths sold from 18th-century Parisian shops. The cuisine took its name from the soup, not the other way around.",
    allergens: [],
    diet: { vegan: false, vegetarian: false, keto: true, halal: true, kosher: "meat", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Better Than Bouillon Roasted Chicken Base is an excellent default. For boxed: Swanson's organic, Kettle & Fire bone broth, or any brand where 'chicken' (not 'chicken broth' or 'chicken flavor') is the first ingredient. Low-sodium versions give you more control.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Homemade from saved carcasses is dramatically better — and free. For shortcuts: Better Than Bouillon concentrate > most boxed stocks. Avoid generic \"chicken broth\" which is watered-down by definition.",
    },
    skillDev: { skills: ["sauce", "timing"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: "homemade-chicken-stock" },
  },

  red_wine: {
    description: "Cooking red wine — use something you'd be willing to drink. Medium-bodied dry reds (Chianti, Côtes du Rhône, Cabernet, Merlot) are most versatile. Avoid 'cooking wine' from the supermarket aisle — it's loaded with salt and tastes like jet fuel.",
    flavorProfile: "Tannic, fruity, acidic; concentrates dramatically as it reduces — what was balanced wine becomes intense fruit-and-tannin syrup",
    prepTips: "For red wine pan sauces and braises: deglaze with the wine FIRST, then reduce by half before adding stock. Cooking the alcohol off (~5 minutes of vigorous bubbling) is what removes the harsh ethanol bite and lets the fruit flavors shine. Open a bottle for braising, drink the rest with dinner.",
    storage: {
      location: "pantry",
      shelfLifeDays: 730,
      shelfLife: { fridge: 21, freezer: null, pantry: 730 },
      tips: "Sealed bottle: years in a cool, dark cabinet. Once opened: 3–5 days with a stopper, longer if you transfer to a smaller bottle (less air contact). For cooking specifically: opened wine is fine for braises for 2–3 weeks if refrigerated.",
      spoilageSigns: "Vinegar smell and sharp sourness = oxidized past the \"cookable\" point. Cloudiness, odd funky smells, or brown color in a red mean it's gone. For drinking it's done; for cooking the vinegar-tinged can still sneak into braises.",
      freezable: false,
      freezeNotes: "Skip freezing full bottles. Trick: pour leftover wine into ice-cube trays (1 cube ≈ 1 oz) for easy pan-sauce portions — lasts 6 months.",
    },
    substitutions: [
      { id: "beef_stock",       tier: "direct",    note: "Loses the acidity and fruit. Add a splash of balsamic or red wine vinegar to compensate." },
      { id: "white_wine",       tier: "emergency", note: "Different flavor profile but works for deglazing in a pinch — lighter, brighter result." },
    ],
    pairs: ["beef_stock", "tomato_paste", "yellow_onion", "garlic", "brisket"],
    flavor: {
      primary: ["sour", "bitter"],
      intensity: "strong",
      heatChange: {
        raw: "tannic, acidic, fruity — drinking wine in the glass",
        cooked: "reduced by half the alcohol burns off; fruit and tannin concentrate to glossy, syrupy pan-sauce gold",
        charred: "sticks and burns if the pan goes dry — bitter, acrid, unsalvageable; keep stirring and add stock",
      },
    },
    nutrition: { per: "100g", kcal: 85, protein_g: 0.1, fat_g: 0, carb_g: 2.6, sodium_mg: 4 },
    origin: "Wine in cooking is as old as wine itself (~6,000 BCE). The French codified its role in haute cuisine — coq au vin, boeuf bourguignon, daube provençal — using local Burgundy and Rhône wines for both the dish and the table.",
    culturalNotes: "'Cooking wine' from the supermarket aisle is salted to make it non-potable (so it can be sold in dry counties / outside of liquor licenses). Salt content is so high it'll wreck a sauce — always cook with real wine you'd drink. Two-buck Chuck (Charles Shaw) is fine for most braises.",
    allergens: ["sulfites"],
    diet: { vegan: true, vegetarian: true, keto: true, halal: false, kosher: "nonkosher", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "For braising: a $10–12 Côtes du Rhône or basic Chianti is the value sweet spot. Don't waste expensive bottles on long cooks (the nuance disappears) but don't go cheaper than something you'd actually drink — the wine is the dominant flavor in red wine braises.",
    market: {
      priceTier: "mid",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Not about bottle price — about drinkability. A $10 bottle you'd pour at the table beats a $30 fancy one (nuance disappears in the pot) but both beat \"cooking wine\" aisle salt-bombs by a mile.",
    },
    skillDev: { skills: ["sauce", "heat"], difficulty: "moderate", proFromScratch: false, fromScratchRecipeId: null },
  },

  white_wine: {
    description: "Cooking white wine — dry, crisp, unoaked. Pinot Grigio, Sauvignon Blanc, Vermentino, or dry Vermouth all work. Avoid sweet wines (Moscato, Riesling) and heavily oaked Chardonnay — both turn cloying or bitter when reduced.",
    flavorProfile: "Crisp, acidic, aromatic; brightens and lifts sauces as it reduces (where red wine deepens, white wine clarifies)",
    prepTips: "Dry vermouth (Noilly Prat, Dolin) is the secret weapon — it keeps for months opened (it's fortified), and a bottle costs about the same as one bottle of cooking wine but lasts 10× as long. Use it 1:1 anywhere a recipe calls for white wine.",
    storage: {
      location: "pantry",
      shelfLifeDays: 730,
      shelfLife: { fridge: 7, freezer: null, pantry: 730 },
      tips: "Sealed: years in a cool dark cabinet. Once opened: 2–3 days in the fridge with a stopper. Vermouth opened: 2–3 months refrigerated. For cooking, opened wine is usable for about a week.",
      spoilageSigns: "Sharp vinegar smell, brown tint (white wine should stay pale gold), or loss of all aroma = oxidized. For cooking, vermouth's longer window makes it the safer pantry bet.",
      freezable: false,
      freezeNotes: "Skip freezing bottles. Trick: ice-cube trays for leftover wine (1 cube ≈ 1 oz) for finishing pan sauces — 6 months in the freezer.",
    },
    substitutions: [
      { id: "chicken_stock",   tier: "direct",    note: "Loses brightness — add a splash of vinegar (white wine, champagne, or lemon juice) to compensate." },
      { id: "vinegar",         tier: "emergency", note: "Use ¼ the amount + ¾ water; the acidity is right but no body or aromatics." },
    ],
    pairs: ["chicken_stock", "shallot", "butter", "lemon", "garlic"],
    flavor: {
      primary: ["sour"],
      intensity: "medium",
      heatChange: {
        raw: "crisp, acidic, aromatic — the glass pour",
        cooked: "reduces to a bright, wine-forward concentrate that brightens cream and butter sauces (where red deepens, white clarifies)",
        charred: "pans that run dry scorch fast — wine sugars go from bright to bitter in seconds; add stock or water before it burns",
      },
    },
    nutrition: { per: "100g", kcal: 82, protein_g: 0.1, fat_g: 0, carb_g: 2.6, sodium_mg: 5 },
    origin: "Wine in cooking is universal in wine-producing cultures. The French use of white wine for fish and chicken sauces (beurre blanc, chicken in white wine) is the technique most Western cuisines have inherited.",
    culturalNotes: "Risotto al vino bianco — adding white wine to risotto right after the toasting step — is non-negotiable in Italian technique. The acid balances the richness of the cheese and butter at the end; without it, the dish tastes flat.",
    allergens: ["sulfites"],
    diet: { vegan: true, vegetarian: true, keto: true, halal: false, kosher: "nonkosher", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "For cooking: any dry $8–12 Pinot Grigio or Sauvignon Blanc. Better answer: keep a bottle of dry vermouth on hand. For mussels in white wine: a Muscadet from the Loire is the classic match.",
    market: {
      priceTier: "mid",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Dry vermouth is the smart buy — lasts 2-3 months opened (fortified) vs. 2-3 days for regular white wine. One bottle does the work of ten for cooking.",
    },
    skillDev: { skills: ["sauce", "heat"], difficulty: "moderate", proFromScratch: false, fromScratchRecipeId: null },
  },

  tomato_paste: {
    description: "Concentrated tomato purée, cooked and reduced until it's a brick-red paste. Adds depth, color, and umami to anything tomato-adjacent — and to plenty of things that aren't (chili, curry, French onion soup, beef stews).",
    flavorProfile: "Concentrated tomato umami; sweet-tart, slightly bitter; almost meaty when caramelized",
    prepTips: "ALWAYS bloom it in hot fat for 1–2 minutes before adding liquid — the color goes from bright red to brick red, the raw acidity mellows, and the umami compounds (glutamates) get released. This single step is what separates restaurant tomato sauces from home cooking.",
    storage: {
      location: "pantry",
      shelfLifeDays: 730,
      shelfLife: { fridge: 42, freezer: 180, pantry: 730 },
      tips: "Sealed can/tube: 2 years pantry. Once opened: tubes keep 6 weeks in the fridge; opened cans should be transferred to a jar or freezer (freeze in 1-tbsp dollops on parchment, then bag — perfect portions for any recipe).",
      spoilageSigns: "Dark discoloration (past brick-red to brown-black), mold anywhere on the surface, bulging can = botulism risk — toss without tasting. A natural dark skin on opened paste just needs scraping; deeper off-color means gone.",
      freezable: true,
      freezeNotes: "The portion-saver trick: scoop 1-tbsp dollops onto parchment, freeze solid, transfer to a zip-top bag. Pull the exact number of tbsp you need straight into a hot pan; no thaw needed.",
      prepYield: "1 standard 6oz can ≈ 12 tbsp (perfect for the dollop-freeze portioning). A good tube delivers ~1 tbsp per 2-inch squeeze.",
    },
    substitutions: [
      { id: "canned_tomatoes", tier: "emergency", note: "Use 3× the volume and reduce in the pan to drive off the water. Fresher flavor, less concentrated." },
    ],
    pairs: ["olive_oil", "garlic", "yellow_onion", "red_wine", "ground_beef"],
    flavor: {
      primary: ["umami", "sweet"],
      intensity: "strong",
      heatChange: {
        raw: "bright red, tart, slightly bitter — unpleasant straight from the can",
        cooked: "blooming in hot fat turns it brick-red; glutamates release, acidity mellows, depth blooms — the single move that separates restaurant sauce from home cooking",
        charred: "over-blooming scorches it bitter and one-note; pull before it goes past deep mahogany",
      },
    },
    nutrition: { per: "100g", kcal: 82, protein_g: 4.3, fat_g: 0.5, carb_g: 19, fiber_g: 4.1, sodium_mg: 59 },
    origin: "Italy and the United States — the canning of tomato concentrate scaled commercially in the late 1800s. Mutti (Parma, Italy, est. 1899) is generally considered the original modern producer.",
    culturalNotes: "European cooks (especially Italian and French) reach for tubed tomato paste — easier portioning, no half-can waste. American cooks default to the 6oz can, then throw out 5oz unused. The tube is one of the great kitchen upgrades for $4.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: true, allium: false },
    seasonality: { yearRound: true, preservedAvailable: true },
    sourcing: "Mutti double-concentrate (tube or can) is the gold standard — Italian-grown tomatoes, no additives, distinctly brighter flavor than American mass-market brands. Cento is a respectable American option. Avoid pastes with 'tomato puree' as the first ingredient (it's diluted) — real paste lists 'tomatoes' first.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Mutti double-concentrate in a tube is transformative — brighter, cleaner, and the tube kills the half-can-waste problem. Cento is the respectable American fallback.",
    },
    skillDev: { skills: ["sauce", "heat"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  // ── compounds with working scratch recipes (Phase 1 of the compound-
  // ingredient work). Each of these is BOTH a pantry ingredient AND a
  // thing you can make yourself — fromScratchRecipeId points at the
  // recipe; IngredientCard renders a "🔪 make from scratch" link.
  sriracha: {
    description: "Bright red, garlicky chili sauce — originally from Si Racha, Thailand, but now a global condiment. Huy Fong's rooster bottle is the iconic American version; a hundred imitators and regional takes. Heat + garlic + sugar + vinegar in one bottle.",
    flavorProfile: "Hot, garlicky, tangy, slightly sweet; more fragrant than pure heat — capsaicin plays second fiddle to the fermented-chili-and-garlic combo",
    prepTips: "Squirt into mayo (1:4) for the sriracha-mayo every sandwich should have. Whisk into honey for a wings glaze. Stir into soup noodles or scrambled eggs. Cook it briefly and the flavors marry; leave it raw and it punches.",
    storage: {
      location: "pantry",
      shelfLifeDays: 730, // unopened commercial; opened drops to ~365
      shelfLife: { fridge: 365, freezer: null, pantry: 730 },
      tips: "Unopened commercial: pantry for years. Once opened: most people leave it in the pantry and it's fine; fridge extends freshness but changes the texture (gets thicker). Homemade: always fridge, ~3 months.",
      spoilageSigns: "Color shift from bright red to brown, loss of aroma, mold at the bottle neck — toss. Vinegar separation alone is fine, just shake.",
      freezable: false,
      freezeNotes: "No benefit — the texture breaks on thaw.",
    },
    substitutions: [
      { id: "hot_sauce", tier: "direct",    note: "Any vinegar-based hot sauce works for heat, though you lose the garlic punch." },
      { id: "gochujang", tier: "pro",       note: "Korean chili paste — thicker, fermented, less sweet. Different flavor but a pro swap in marinades." },
    ],
    pairs: ["mayo", "honey", "lime", "eggs", "soy_sauce"],
    flavor: {
      primary: ["umami", "sour", "sweet"],
      intensity: "strong",
      heatChange: {
        raw: "the signature raw condiment — fragrant garlic and fermented-chili edge",
        cooked: "simmered into a sauce it mellows and the garlic rounds out; great glaze base",
        charred: "direct flame scorches the sugars and goes bitter — brush on at the end, not the start",
      },
    },
    nutrition: { per: "1 tsp", kcal: 5, protein_g: 0.1, fat_g: 0, carb_g: 1, sodium_mg: 90 },
    origin: "Si Racha, Thailand, where coastal cooks made versions for a local seafood restaurant from the 1930s onward. Huy Fong Foods (founded by David Tran, a Vietnamese refugee) launched the rooster bottle in the US in 1980 — American sriracha diverged from Thai sriracha immediately.",
    culturalNotes: "The Huy Fong rooster bottle is NOT what most Thai people think of as sriracha — their local sauces (like Sriraja Panich) are sweeter, thinner, and less garlicky. American sriracha is its own genre at this point.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "high", nightshade: true, allium: true },
    seasonality: { yearRound: true, preservedAvailable: true },
    sourcing: "Huy Fong is the default and has improved again since their 2022 supply shortage. Lee Kum Kee and Shark brand are decent alternatives. Homemade is transformative if you can get fresh red Fresno chilies.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Homemade sriracha from fresh Fresnos is a different food than the bottle — brighter, more garlic, less cloying. If you cook enough to justify the 30-min batch, do it.",
    },
    skillDev: { skills: ["sauce", "seasoning"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: "sriracha" },
  },

  pesto: {
    description: "Ligurian uncooked sauce — basil, pine nuts, Parmigiano, Pecorino, garlic, olive oil, salt. The scratch version in the fridge is a different food than the shelf-stable jar; both have their place.",
    flavorProfile: "Bright, herbaceous, nutty, salty; high-quality pesto has a grassy pepperiness from good EVOO and a buttery richness from pine nuts",
    prepTips: "Toss with hot pasta OFF the heat (direct contact with a boiling pot breaks the sauce). Loosen with pasta water, never more oil. On toast under eggs. On caprese. On roast chicken. On pizza after it's out of the oven.",
    storage: {
      location: "fridge",
      shelfLifeDays: 7, // homemade; shelf-stable jar is pantry for months
      shelfLife: { fridge: 7, freezer: 90, pantry: 180 },
      tips: "Homemade: fridge 1 week under a film of olive oil (the film blocks oxygen, keeps the surface green). Shelf-stable jar: pantry until opened, then 2–3 weeks fridge. Freezes beautifully in ice-cube trays.",
      spoilageSigns: "Dark olive-drab or brown color instead of bright green = oxidized (still edible but sad). White fuzzy mold on the surface = toss.",
      freezable: true,
      freezeNotes: "The save-my-basil-glut move. Freeze in ice-cube trays, transfer cubes to a bag. 2 cubes = enough for a pasta portion. Thaws in 30 seconds tossed into hot pasta.",
      prepYield: "One batch of the scratch recipe yields ~1 cup (240g) — enough to sauce pasta for 4 generously.",
    },
    substitutions: [
      { id: "basil",       tier: "emergency", note: "Raw basil + good olive oil + cheese is a minute-to-make rough approximation when you're out of pesto." },
    ],
    pairs: ["spaghetti", "mozzarella", "tomato", "chicken_breast", "bread"],
    flavor: {
      primary: ["umami", "bitter", "sweet"],
      intensity: "medium",
      heatChange: {
        raw: "the point of pesto — bright, herbaceous, never cooked",
        cooked: "direct heat dulls the basil instantly; toss with hot pasta OFF the heat",
        charred: "don't. Past 150°F the sauce breaks and goes bitter; brushed on pizza post-bake is the limit.",
      },
    },
    nutrition: { per: "2 tbsp", kcal: 180, protein_g: 3, fat_g: 18, carb_g: 2, sodium_mg: 210 },
    origin: "Genoa, Liguria, Italy. The tradition is mortar-and-pestle (hence the name 'pestare' = to pound) using the small-leaf Genovese basil variety. 'Pesto alla Genovese' is a DOP designation with specific requirements.",
    culturalNotes: "Real Genovese pesto is made with a marble mortar and wooden pestle at a specific rotation speed — bruising not grinding. Food processor pesto is faster but a different texture. Both are defensible; pretend otherwise at your peril.",
    allergens: ["tree_nuts", "dairy"],
    diet: { vegan: false, vegetarian: true, keto: true, halal: true, kosher: "dairy", fodmap: "moderate", nightshade: false, allium: true },
    seasonality: { yearRound: true, preservedAvailable: true },
    sourcing: "For jarred: Barilla is fine, Rana is better, anything labeled 'Genovese DOP' is the real thing (at a real price). Homemade with good basil and real Parmigiano-Reggiano beats any jar.",
    market: {
      priceTier: "mid",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Supermarket pesto is almost always stabilized with other oils and less cheese than the name implies. A scratch batch from one $3 bunch of basil is both cheaper and better.",
    },
    skillDev: { skills: ["sauce", "seasoning", "knife"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: "pesto" },
  },

  // ── condiments: American staples (batch 1) ─────────────────────────
  mayo: {
    description: "Egg-yolk emulsion of oil, acid (lemon or vinegar), mustard, salt. Hellmann's (east of the Rockies) and Best Foods (same jar, west of the Rockies) are the American benchmark. Kewpie (Japan) is eggier and sweeter. Duke's (the South) uses more yolk and no sugar. Homemade is a 90-second job with a stick blender.",
    flavorProfile: "Creamy, tangy, faintly sweet; a good mayo tastes of egg and oil first, acid second. Bad mayo tastes of plastic and sugar.",
    prepTips: "Whisk with lemon juice + pepper + a dab of dijon for the best sandwich spread there is. Mix 3:1 with sriracha for spicy mayo (every Japanese-steakhouse trick). Fold into canned tuna or chicken with mustard + relish — a salad in 2 minutes.",
    storage: {
      location: "fridge",
      shelfLifeDays: 90, // opened; sealed commercial keeps 3–4 months pantry and then fridge after opening
      shelfLife: { fridge: 90, freezer: null, pantry: 180 },
      tips: "Commercial mayo is shelf-stable sealed; refrigerate after opening. Homemade is ALWAYS fridge-only, 5–7 days tops. The jar lid and the tool you scoop with are the infection vectors — clean spoon, always.",
      spoilageSigns: "Separation that doesn't stir back in, sour/off smell, yellowing at the top surface, any pink or black spots. Opened jar past 2–3 months in the fridge is a coin flip; sniff before using.",
      freezable: false,
      freezeNotes: "Don't. Mayo freezes but the emulsion breaks irrevocably on thaw — you'll get oil-slicked water and sad egg solids.",
    },
    substitutions: [
      { id: "sour_cream", tier: "direct",    note: "For dips and dressings; tangier, less fat. 1:1 swap." },
      { id: "avocado",    tier: "dietary",   note: "Mashed avocado + lemon is a vegan sandwich spread that plays a similar role." },
    ],
    pairs: ["dijon", "sriracha", "lemon", "tuna", "bread"],
    flavor: {
      primary: ["umami", "sour"],
      intensity: "medium",
      heatChange: {
        raw: "the condiment itself — creamy, tangy, binding",
        cooked: "stirred into pan sauces off-heat it smooths; direct heat breaks the emulsion — mayo-roasted potatoes use the film as an oil carrier, not a sauce",
        charred: "brushed on grilled sandwiches (Duke's melt, Cuban press) it crisps the bread beautifully — the mayo is the frying fat",
      },
    },
    nutrition: { per: "1 tbsp", kcal: 94, protein_g: 0.1, fat_g: 10, carb_g: 0.4, sodium_mg: 88 },
    origin: "Generally credited to 18th-century French cooks; the name may come from Mahón, Menorca (1756 French siege) where chef to the Duc de Richelieu supposedly improvised an egg-oil sauce. Modern jarred mayo is a 20th-century American invention — Hellmann's launched in 1905 from a NYC deli.",
    culturalNotes: "Mayo is one of the most regionally-loved condiments on earth — Japan's Kewpie (MSG + rice vinegar + yolks-only) inspires cult devotion, Belgium puts mayo on frites as the default (ketchup is for tourists), and the US South guards Duke's like a state secret. Kraft-brand Miracle Whip is NOT mayo — it's a \"dressing\" with sugar and spices. Don't confuse.",
    allergens: ["egg"],
    diet: { vegan: false, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Hellmann's/Best Foods for the default American. Duke's for the sweet-free South style. Kewpie for the eggy/umami Japanese style — worth owning alongside regular. Avoid anything calling itself \"salad dressing\" on the label.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: true,
      qualityNote: "Kewpie vs. Hellmann's vs. Duke's is a real flavor-difference question, not a snobbery one. Pick the one that matches what you're making — Kewpie for sushi-adjacent, Duke's for pimento cheese, Hellmann's for everything else.",
    },
    skillDev: { skills: ["sauce", "seasoning"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
  },

  ketchup: {
    description: "Tomato-vinegar-sugar-spice paste, a 400-year journey from a fermented fish sauce in SE Asia (kê-tsiap) through English walnut-and-mushroom versions to Heinz's 1876 bottled tomato version — the one that every American now means. Heinz's 57 is sweet-tart-salty-umami balance that other brands chase.",
    flavorProfile: "Sweet, tart, salty, faintly spiced (clove, allspice); tomato umami undergirds everything. A great ketchup is balanced; a bad one is cloying.",
    prepTips: "Whisk with soy sauce + garlic + a splash of vinegar for a 90-second BBQ-sauce base. Fold into ground beef for meatloaf binding (1 tbsp/lb). Drizzle + sriracha for spicy ketchup. Dip. Fry. Burger. Hash browns.",
    storage: {
      location: "fridge",
      shelfLifeDays: 180, // opened fridge; sealed keeps years pantry
      shelfLife: { fridge: 180, freezer: null, pantry: 365 },
      tips: "Shelf-stable sealed for a year or more. After opening: most people shelf it at room temp and it's fine for 4–6 weeks, but fridge extends to 6 months without flavor loss. Glass bottle + dark cabinet > plastic squeeze.",
      spoilageSigns: "Brown/maroon darkening (oxidation — still safe but flavor dulls), mold around the cap threads, any fizz or gas when opened. Crystallized sugar at the neck is normal and fine.",
      freezable: false,
      freezeNotes: "No benefit — the water separates and the texture goes grainy on thaw.",
    },
    substitutions: [
      { id: "tomato_paste", tier: "emergency", note: "Tomato paste + vinegar + sugar + salt in a pinch. Closer to homemade ketchup than you'd think." },
    ],
    pairs: ["mustard", "mayo", "hot_sauce", "worcestershire", "ground_beef"],
    flavor: {
      primary: ["sweet", "umami", "sour"],
      intensity: "medium",
      heatChange: {
        raw: "the condiment — cold, sharp, tangy-sweet",
        cooked: "reduces into a sticky glaze on burgers and wings; caramelizes on meatloaf tops",
        charred: "brushed on ribs and smoked over wood it lacquers; past deep mahogany the sugars scorch bitter",
      },
    },
    nutrition: { per: "1 tbsp", kcal: 17, protein_g: 0.2, fat_g: 0, carb_g: 4.5, sodium_mg: 154 },
    origin: "Kê-tsiap — 17th-century Fujianese fermented fish sauce — traveled on merchant ships to SE Asia and England. English cooks tried walnut and mushroom versions for 150 years before tomato became the default in 1812 (James Mease, Philadelphia). Heinz bottled it in 1876; added cider vinegar to replace coal-tar preservative in 1906 — the current formula.",
    culturalNotes: "Americans put ketchup on everything (eggs, hot dogs, hash browns); much of the rest of the world finds this alarming. The Filipino banana ketchup (sweeter, brighter, WWII improvisation) is a separate, delicious thing worth knowing. \"Catsup\" is the same product with a dying spelling.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: false, halal: true, kosher: "pareve", fodmap: "moderate", nightshade: true, allium: false },
    seasonality: { yearRound: true },
    sourcing: "Heinz is the benchmark — their 57 blend is genuinely hard to beat. Sir Kensington's (organic, less sweet) is the upmarket alternative. Primal Kitchen does a sugar-free version for keto. Banana ketchup from the Philippines (Jufran, UFC) for tropical heat.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: true,
      qualityMatters: false,
      qualityNote: "Heinz is the gold standard and a nostalgia artifact — trying to \"upgrade\" ketchup often just makes it worse. Save fancy spending for mustard.",
    },
    skillDev: { skills: ["sauce"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
  },

  mustard: {
    description: "Yellow mustard — ground mustard seed + turmeric (the yellow) + vinegar + salt. French's is the American default and a 1904 St. Louis World's Fair debut. Sharper than Dijon but a one-note punch compared to the wine-forward complexity of the French version.",
    flavorProfile: "Bright yellow, sharp, vinegar-forward, mildly pungent; the sinus-tingle is milder than Dijon's because ground yellow mustard seed has less allyl isothiocyanate than brown.",
    prepTips: "The right mustard on a hot dog and the wrong one on a ham sandwich — yellow for ballpark food, Dijon for vinaigrettes and pan sauces, whole grain for pretzels and charcuterie. Mix 1:1 with mayo for a sandwich spread. Blend into deviled eggs.",
    storage: {
      location: "fridge",
      shelfLifeDays: 365,
      shelfLife: { fridge: 365, freezer: null, pantry: 60 },
      tips: "Refrigerate after opening. Keeps nearly a year in the fridge; flavor dulls after 6 months but still safe. Pantry storage is fine for a couple months unopened, but opened-at-room-temp drops to 4–6 weeks before the heat fades noticeably.",
      spoilageSigns: "Dark crust on top (scrape and use), actual mold, separation that doesn't stir, sour smell beyond mustard's normal sharpness. Darkening alone is not spoilage.",
      freezable: false,
      freezeNotes: "Freezing breaks the emulsion and the heat dulls further. Fridge only.",
    },
    substitutions: [
      { id: "dijon",   tier: "pro",       note: "Upgrade pick — wine-based, smoother, more complex. Better in vinaigrettes and sauces." },
    ],
    pairs: ["ketchup", "mayo", "honey", "sausage", "bread"],
    flavor: {
      primary: ["sour", "bitter"],
      intensity: "medium",
      heatChange: {
        raw: "sharp, vinegar-forward, mild sinus tingle",
        cooked: "heat dulls the pungency fast — add late to pan sauces, never at the start",
        charred: "mustard past a hard boil goes flat and slightly bitter; glazes on ham bake well because of the sugar, not the mustard",
      },
    },
    nutrition: { per: "1 tsp", kcal: 3, protein_g: 0.2, fat_g: 0.2, carb_g: 0.3, sodium_mg: 57 },
    origin: "St. Louis, 1904 — French's debuted at the World's Fair as \"cream salad mustard\" and rode the hot-dog boom. Turmeric was the coloring because ground yellow mustard seed alone is beige. The name \"French's\" has nothing to do with France; it's the founding family's name.",
    culturalNotes: "Yellow mustard on ballpark hot dogs is an American identity artifact. Most of Europe thinks it's too mild; Eastern Europe prefers brown Düsseldorf-style; Japan's karashi is a horseradish-fueled different thing. English mustard (Colman's) is the nuclear version.",
    allergens: ["mustard"],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false },
    seasonality: { yearRound: true },
    sourcing: "French's is the benchmark. Gulden's is a slightly spicier Brooklyn version. Plochman's (Midwest) is the underdog pick. Colman's English mustard (yellow, loose-powder) for serious heat.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: false,
      qualityNote: "Yellow mustard is commodity. If you're cooking where mustard matters, reach for Dijon or whole-grain — those brand differences are real.",
    },
    skillDev: { skills: ["seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
  },

  hot_sauce: {
    description: "Vinegar-forward cayenne-pepper sauce — the Tabasco family (fermented Louisiana), the Frank's family (Buffalo wing origin), the Crystal/Louisiana family (thin, sharp, not sweet). Distinct from sriracha (thick, garlicky, sweet) and chili oil (oil-based). Every major style has a role.",
    flavorProfile: "Sharp vinegar, cayenne heat, salt; Louisiana-style leans thin and pure, Frank's adds garlic, Tabasco adds a light wood-barrel ferment funk.",
    prepTips: "Shake into eggs, soups, beans, chili, anything braised. Mix 1:1 with melted butter for Buffalo sauce (this is literally the recipe). A dash into mayo or aioli instantly lifts a sandwich. Don't boil — the volatile heat compounds flash off at high heat.",
    storage: {
      location: "pantry",
      shelfLifeDays: 730,
      shelfLife: { fridge: 1095, freezer: null, pantry: 730 },
      tips: "Vinegar + salt + ferment = effectively immortal. Pantry unopened indefinitely; opened works fine pantry for 1–2 years (you'll use it well before it matters). Fridge extends color and heat for 3+ years but most people don't bother.",
      spoilageSigns: "Color shift from bright red to brown (oxidation, still safe), loss of kick, separation that doesn't shake back. Actual spoilage (mold, fizz) is essentially never — the vinegar and salt are intense preservatives.",
      freezable: false,
      freezeNotes: "Pointless — it's already more shelf-stable than your freezer.",
    },
    substitutions: [
      { id: "sriracha",  tier: "direct",    note: "Thicker, garlicky, sweeter; works for most applications but changes the profile meaningfully." },
      { id: "gochujang", tier: "pro",       note: "Korean fermented chili paste — thicker, umami-forward, less vinegar. Different idiom, excellent pick in marinades and stews." },
    ],
    pairs: ["butter", "eggs", "mayo", "ketchup", "chicken_wing"],
    flavor: {
      primary: ["sour", "bitter"],
      intensity: "strong",
      heatChange: {
        raw: "the point — raw vinegar heat, immediate capsaicin kick",
        cooked: "reduces into glazes and braises nicely; half the heat carries through, the other half flashes off",
        charred: "brushed on meat over direct flame and the vinegar scorches fast — brush in the last 2 minutes, not at the start",
      },
    },
    nutrition: { per: "1 tsp", kcal: 1, protein_g: 0.1, fat_g: 0, carb_g: 0.2, sodium_mg: 130 },
    origin: "Louisiana, 1860s–1870s — Tabasco (Edmund McIlhenny, Avery Island, 1868) is the oldest commercial American. Frank's RedHot (Cincinnati, 1920) invented Buffalo wings via Anchor Bar NY in 1964. Crystal (New Orleans, 1923) is the thin working-class benchmark most Southerners prefer for gumbo and eggs.",
    culturalNotes: "The \"hot sauce\" aisle has exploded from 3 bottles in 1990 to hundreds today — a lot of them are marketing, not better sauce. The Louisiana trinity (Tabasco/Frank's/Crystal) plus a good habanero bottle covers 90% of cooking. Everything else is novelty until you find one you actually love.",
    allergens: [],
    diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "moderate", nightshade: true, allium: false },
    seasonality: { yearRound: true, preservedAvailable: true },
    sourcing: "Tabasco for classic fermented vinegar-forward. Frank's for Buffalo wings (it's literally the original recipe). Crystal for Louisiana cooking. Yucateco (green habanero, yellow habanero) for heat with actual flavor. Cholula if you want a medium everyday bottle.",
    market: {
      priceTier: "budget",
      availability: "supermarket",
      organicCommon: false,
      qualityMatters: true,
      qualityNote: "Different sauces have different jobs — Tabasco is not a Buffalo sauce, Frank's is not Louisiana gumbo hot sauce. Own 2–3 styles; skip the boutique $15 bottles with death-metal labels.",
    },
    skillDev: { skills: ["seasoning"], difficulty: "easy", proFromScratch: true, fromScratchRecipeId: null },
  },
};

// Look up display info for an ingredient. Three-layer merge:
//   1. dbOverride (from Supabase ingredient_info table) — wins everything
//   2. INGREDIENT_INFO (the JS object in this file) — code-side fallback
//   3. SUBCATEGORY_INFO (cheese subcategories etc.) — last resort
//
// Pass `dbOverride` as the optional second arg when you have a row from
// useIngredientInfo(). Without it, the lookup is purely code-side and
// works offline / pre-load — so existing callers keep working as-is.
//
// Returns null-safe defaults for every schema field so the UI can safely
// read `info.storage?.location` without per-key existence checks.
export function getIngredientInfo(ingredient, dbOverride) {
  // User-created canonicals (admin-approved, not bundled) show up
  // here with ingredient=null because findIngredient only knows the
  // bundled registry. We used to early-return null, which silently
  // wiped out the admin-approved enrichment JSON on the canonical
  // card. Fall through to the merge — dbOverride still contains the
  // real enriched info; the JS fallback + subcategory just aren't
  // available, which is fine for user-created slugs.
  if (!ingredient && !dbOverride) return null;
  const sub = ingredient?.subcategory ? SUBCATEGORY_INFO[ingredient.subcategory] : null;
  const ing = ingredient ? (INGREDIENT_INFO[ingredient.id] || null) : null;
  const db  = dbOverride || null;
  return {
    // ── cooking-centric ────────────────────────────────────────────────
    description:    db?.description    || ing?.description    || sub?.description    || null,
    flavorProfile:  db?.flavorProfile  || ing?.flavorProfile  || sub?.flavorProfile  || null,
    prepTips:       db?.prepTips       || ing?.prepTips       || sub?.prepTips       || null,
    storage:        db?.storage        || ing?.storage        || sub?.storage        || null,
    substitutions:  db?.substitutions  || ing?.substitutions  || sub?.substitutions  || [],
    irreplaceable:       db?.irreplaceable ?? ing?.irreplaceable ?? sub?.irreplaceable ?? false,
    irreplaceableNote:   db?.irreplaceableNote || ing?.irreplaceableNote || sub?.irreplaceableNote || null,
    pairs:          db?.pairs          || ing?.pairs          || sub?.pairs          || [],
    clashes:        db?.clashes        || ing?.clashes        || [],
    // ── flavor (structured v2; freeform flavorProfile above) ───────────
    flavor:         db?.flavor         || ing?.flavor         || sub?.flavor         || null,
    // ── nutrition ──────────────────────────────────────────────────────
    nutrition:      db?.nutrition      || ing?.nutrition      || sub?.nutrition      || null,
    // ── social / cultural ──────────────────────────────────────────────
    origin:         db?.origin         || ing?.origin         || sub?.origin         || null,
    culturalNotes:  db?.culturalNotes  || ing?.culturalNotes  || sub?.culturalNotes  || null,
    winePairings:   db?.winePairings   || ing?.winePairings   || sub?.winePairings   || [],
    recipes:        db?.recipes        || ing?.recipes        || sub?.recipes        || [],
    // ── sourcing / allergens / seasonality ─────────────────────────────
    allergens:      db?.allergens      || ing?.allergens      || sub?.allergens      || [],
    allergenDetail: db?.allergenDetail || ing?.allergenDetail || sub?.allergenDetail || null,
    seasonality:    db?.seasonality    || ing?.seasonality    || sub?.seasonality    || null,
    sourcing:       db?.sourcing       || ing?.sourcing       || sub?.sourcing       || null,
    // ── dietary / lifestyle flags (v2) ─────────────────────────────────
    diet:           db?.diet           || ing?.diet           || sub?.diet           || null,
    // ── market intelligence (structured v2) ────────────────────────────
    market:         db?.market         || ing?.market         || sub?.market         || null,
    // ── skill + course links (v2) ──────────────────────────────────────
    skillDev:       db?.skillDev       || ing?.skillDev       || sub?.skillDev       || null,
    // ── blend composition (new for JSONB-era spice metadata) ──────────
    blendOf:        db?.blendOf        || ing?.blendOf        || null,
    // ── AI meal-planning primitives (v3; emitted by the enrich-ingredient
    // edge function). All nullable — missing on older rows, the meal
    // planner should treat absence as "no signal" rather than error. ──
    flavor_profile: db?.flavor_profile || ing?.flavor_profile || null,
    aromatic_category:
      db?.aromatic_category || ing?.aromatic_category || null,
    cooking_behaviors:
      db?.cooking_behaviors || ing?.cooking_behaviors || [],
    role_tendencies:
      db?.role_tendencies || ing?.role_tendencies || null,
    heat_stability:
      db?.heat_stability || ing?.heat_stability || null,
    // Functional vs flavor substitution split (v3). Falls back to the
    // legacy flat `substitutions` array above when absent, so the 32
    // seeded rows keep rendering correctly.
    substitutions_functional:
      db?.substitutions_functional || ing?.substitutions_functional || null,
    substitutions_flavor:
      db?.substitutions_flavor || ing?.substitutions_flavor || null,
    // Provenance block stamped by the enrichment edge function. UI can
    // show "AI-generated, pending review" badges when _meta.reviewed is
    // false; null for canonical rows authored pre-v3.
    _meta: db?._meta || ing?._meta || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// v2 metadata helpers. These operate on the shape getIngredientInfo returns,
// so callers can pass the result straight in — no re-lookup required.
// ─────────────────────────────────────────────────────────────────────────────

// Returns true if the ingredient is compatible with a user's active dietary
// preferences. `userDiet` is a partial shape mirroring INGREDIENT_INFO's
// `diet` object — only the flags the user cares about need to be set.
//
// Example:
//   isCompatibleWithDiet(getIngredientInfo(canon), { vegan: true })
//   → false for parmesan, true for olive oil
//
// Rules:
//   - vegan/vegetarian/keto/halal/nightshade/allium: user's truthy flag
//     requires ingredient's matching flag to be truthy (or falsey-absent
//     for the inverse, e.g. user says "no nightshades" ⇒ ingredient must
//     not be flagged nightshade).
//   - kosher: user passes "meat" | "dairy" | "pareve" — ingredient must
//     not be "nonkosher"; pareve is compatible with anything.
//   - fodmap: user passes "low" or "moderate" — ingredient's fodmap level
//     must be at or below the user's threshold.
//
// Missing info defaults to "compatible" (don't hide ingredients just
// because we haven't backfilled their flags yet).
export function isCompatibleWithDiet(info, userDiet) {
  if (!userDiet || !info) return true;
  const diet = info.diet;
  if (!diet) return true;

  if (userDiet.vegan      && !diet.vegan)      return false;
  if (userDiet.vegetarian && !diet.vegetarian) return false;
  if (userDiet.keto       && !diet.keto)       return false;
  if (userDiet.halal      && diet.halal === false) return false;
  if (userDiet.kosher && userDiet.kosher !== "nonkosher") {
    if (diet.kosher === "nonkosher") return false;
  }
  if (userDiet.noNightshade && diet.nightshade) return false;
  if (userDiet.noAllium     && diet.allium)     return false;

  if (userDiet.fodmap) {
    const order = { low: 0, moderate: 1, high: 2 };
    const cap = order[userDiet.fodmap] ?? 2;
    const got = order[diet.fodmap] ?? 0;
    if (got > cap) return false;
  }
  return true;
}

// Returns true if the ingredient is in season right now for the given
// hemisphere. `month` is 1..12; defaults to current month.
//
// yearRound overrides — always in season.
// No peakMonths for the hemisphere → defaults to true (don't hide produce
// we haven't tagged).
export function isInSeason(seasonality, hemisphere = "N", month = new Date().getMonth() + 1) {
  if (!seasonality) return true;
  if (seasonality.yearRound) return true;
  const peak = hemisphere === "S"
    ? (seasonality.peakMonthsS || seasonality.peakMonths)
    : (seasonality.peakMonthsN || seasonality.peakMonths);
  if (!peak || !peak.length) return true;
  return peak.includes(month);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy ingredient matching.
//
// Use cases:
//   1. Receipt scans where Claude returned `ingredientId: null` — client-side
//      second-pass fallback so obvious matches don't escape as free text.
//   2. The "Link to canonical" action on a free-text pantry row — surface
//      likely candidates so the user picks with one tap.
//   3. Autocomplete / "did you mean" in the manual-add flow (future).
//
// Algorithm: normalize both sides (lowercase, strip plurals, strip packaging
// descriptors and sizes, strip punctuation), then score.
//   100  → exact normalized match
//    80  → one fully contains the other
//   0–60 → Jaccard token overlap
//   +20  → Levenshtein closeness bonus (short edit distance)
//
// Returns [{ ingredient, score }] sorted highest first, up to `limit`.
// Callers can apply their own threshold; 30+ is a reasonable "likely match".
// ─────────────────────────────────────────────────────────────────────────────

// Words that add no signal — sizes, descriptors, packaging. Strip these so
// "Organic EVOO 500ml Extra Virgin" compares cleanly against "olive oil".
const FUZZY_NOISE_WORDS = new Set([
  "organic","grass","fed","free","range","local","fresh","raw","natural",
  "whole","reduced","fat","lowfat","nonfat","unsalted","salted","sweet",
  "large","medium","small","xl","xxl","jumbo","extra","virgin","premium",
  "select","prime","pack","packed","value","family","size","pcs","piece",
  "pieces","ea","each","ct","count","bunch","bag","jar","tin","can","tub",
  "carton","bottle","box","pouch",
]);
const FUZZY_UNIT_WORDS = new Set([
  "oz","lb","lbs","g","kg","ml","l","liter","liters","gal","gallon","gallons",
  "qt","quart","pt","pint","cup","cups","tbsp","tsp","fl",
]);

function fuzzyNormalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")     // strip parenthetical asides
    .replace(/[^a-z0-9 ]+/g, " ")   // punctuation → space
    .replace(/\b\d+(\.\d+)?\b/g, " ") // strip numbers (sizes, counts)
    .split(/\s+/)
    .filter(t => t && !FUZZY_NOISE_WORDS.has(t) && !FUZZY_UNIT_WORDS.has(t))
    // Cheap pluralization strip: "eggs" → "egg", "berries" → "berrie" (good
    // enough — fuzzy scoring tolerates the residual mismatch).
    .map(t => t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t)
    .join(" ")
    .trim();
}

// Classic iterative-DP Levenshtein — small arrays, fast enough for a
// 500-ingredient scan without memoization.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// Score one ingredient against a needle string. Picks the best match across
// the ingredient's name, shortName, and id (underscores → spaces) — so
// "parm" matches "parmesan" via shortName even if the display name is longer.
function scoreIngredientMatch(needle, ing) {
  const n = fuzzyNormalize(needle);
  if (!n) return 0;
  const candidates = [ing.name, ing.shortName, ing.id.replace(/_/g, " ")]
    .filter(Boolean)
    .map(fuzzyNormalize)
    .filter(Boolean);
  if (!candidates.length) return 0;

  let best = 0;
  for (const c of candidates) {
    if (c === n)                           best = Math.max(best, 100);
    else if (c.includes(n) || n.includes(c)) best = Math.max(best, 80);
  }
  if (best === 0) {
    const nTokens = new Set(n.split(" "));
    for (const c of candidates) {
      const cTokens = new Set(c.split(" "));
      if (!nTokens.size || !cTokens.size) continue;
      const overlap = [...nTokens].filter(t => cTokens.has(t)).length;
      const union   = new Set([...nTokens, ...cTokens]).size;
      best = Math.max(best, Math.round((overlap / union) * 60));
    }
  }
  // Levenshtein bonus — rewards near-misses on an already-matching candidate.
  if (best > 0) {
    const c = candidates[0];
    const d = levenshtein(n, c);
    const maxLen = Math.max(n.length, c.length);
    if (maxLen > 0) {
      const bonus = Math.max(0, 20 - Math.round((d / maxLen) * 20));
      best += bonus;
    }
  }
  return best;
}

// Public API: ranked matches for a free-text string. Returns at most `limit`
// candidates with a non-zero score. Caller decides the threshold for
// "confident enough to auto-link" (suggested: 70+).
export function fuzzyMatchIngredient(text, limit = 5) {
  if (!text || typeof text !== "string") return [];
  const scored = [];
  for (const ing of INGREDIENTS) {
    // Skip hubs — they're UI groupings, not real pantry items.
    if (ing.parentId === undefined && ing.id.endsWith("_hub")) continue;
    const score = scoreIngredientMatch(text, ing);
    if (score > 0) scored.push({ ingredient: ing, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// Estimates shelf life (in days) for an ingredient stored in a given
// location — used by receipt scans to compute a default expiration date
// when the receipt doesn't print one. Prefers the per-location shelfLife
// map when present; falls back to the flat shelfLifeDays if the requested
// location matches storage.location; returns null if no estimate is
// available (caller should leave expiration blank rather than guess).
export function estimateExpirationDays(storage, location) {
  if (!storage) return null;
  const loc = location || storage.location;
  if (!loc) return null;
  if (storage.shelfLife && storage.shelfLife[loc] != null) {
    return storage.shelfLife[loc];
  }
  if (storage.location === loc && storage.shelfLifeDays != null) {
    return storage.shelfLifeDays;
  }
  return null;
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

// ─── compound vs. primitive kind ───────────────────────────────────────
//
// Primitive ingredients are terminal — basil is basil, you don't build it
// from simpler things. Compound ingredients (sriracha, pesto, stocks,
// mustards) can be purchased OR produced by a scratch recipe. The same
// id covers both cases — a bottle of Huy Fong sriracha and a jar of
// homemade sriracha both live as ingredientId === "sriracha" in the
// pantry, merge by id, match the same recipes.
//
// Source of truth is skillDev.fromScratchRecipeId — if a scratch recipe
// is linked, the ingredient is a compound. This set is a sugar helper
// for UI code that wants the primitive/compound split without reaching
// into skillDev.

export const COMPOUND_INGREDIENT_IDS = new Set([
  "sriracha",
  "pesto",
  "chicken_stock",
  // future: beef_stock, mayo, ketchup, dijon, tomato_paste, ricotta,
  // hot_sauce, peanut_butter, compound butter, vanilla extract, …
  // Each gets added here when its scratch recipe ships.
]);

export function ingredientKind(id) {
  return COMPOUND_INGREDIENT_IDS.has(id) ? "compound" : "primitive";
}

// ─── ingredient states ─────────────────────────────────────────────────
//
// Physical form an ingredient lives in on the shelf. Bread is the canonical
// example — one "bread" id, three rows: loaf, slices, crumbs. Recipes that
// care about state declare it; the matcher scopes accordingly. Users can
// convert between states via the "Make X from Y" flow (e.g., turn a loaf
// into crumbs, decrementing the loaf and creating a new crumbs row).
//
// Everything here is data-only — the convert UX, the state badges on
// pantry rows, and the state-aware recipe matcher live in their own
// commits and read from these maps.
//
//   INGREDIENT_STATES       — per-ingredient-id ordered state list. Order
//                             is "most raw → most processed" so the UI can
//                             render a sensible progression.
//   STATE_LABELS            — short human strings (singular). "grated"
//                             not "gratedcheese" — the ingredient name
//                             already tells the user which item is in
//                             that state.
//   DEFAULT_STATE_FOR       — preselected state when a user manually adds
//                             a new row for an ingredient that has states.
//                             Usually the least-processed / shelf-stable
//                             form ("loaf", "block", "whole") so a naive
//                             pantry entry lands sensibly.
//
// An ingredient without an entry here has no state distinction; pantry
// rows for it carry state=null and matching ignores state entirely.

// Meat state vocabulary — shared across every meat hub (chicken, beef,
// pork, turkey) so every canonical inheriting from those hubs gets the
// same list. Organized into four axes per the product's meat-state
// spec:
//
//   1. WHOLE / INTACT CUTS (default) — minimally altered structure.
//      whole, steak_cut, chop, fillet, tenderloin, rack.
//   2. CUT / REDUCED — geometry changed, composition intact.
//      cubed, diced, chunks, strips, sliced, shaved, shredded.
//   3. GROUND / COMMINUTED — structure destroyed.
//      ground (coarse), minced (finer), paste (uniform).
//   4. FORMED / RECONSTRUCTED — ground meat reshaped.
//      patty, meatball, sausage, loaf, nuggets.
//
// Plus cross-cutting cooking-stage flags: raw, cooked. Legacy compound
// states (shredded_cooked, diced_cooked) stay in the list so existing
// pantry rows with those values continue to render + remain editable
// in the state picker — don't remove them without a migration.
const MEAT_STATES = [
  // Whole / intact cuts — default band
  "whole", "steak_cut", "chop", "fillet", "tenderloin", "rack",
  // Cut / reduced forms — geometry only
  "cubed", "diced", "chunks", "strips", "sliced", "shaved", "shredded",
  // Ground / comminuted
  "ground", "minced", "paste",
  // Formed / reconstructed
  "patty", "meatball", "sausage", "links", "loaf", "nuggets",
  // Preserved / cured — structurally a separate axis but users
  // shop for jerky as "meat in a state", not a separate canonical
  "jerky",
  // Cooking stage
  "raw", "cooked",
  // Legacy compound — retained for backward compatibility
  "shredded_cooked", "diced_cooked",
];

export const INGREDIENT_STATES = {
  bread:         ["loaf", "slices", "crumbs", "cubes", "toasted"],
  // Covers every specific cheese AND the generic cheese hub — all cheeses
  // share the same state vocabulary. The cheese-level registry entries
  // (parmesan, pecorino, mozzarella, etc.) inherit this list via their
  // parentId === "cheese_hub" link.
  cheese_hub:    ["block", "grated", "shredded", "sliced", "cubed", "crumbled"],
  // Every meat hub shares MEAT_STATES. Specific cuts (ribeye, pork_loin,
  // turkey_breast, chicken_breast, etc.) inherit via their parentId
  // link — no per-cut entry needed. Keeps the vocabulary consistent:
  // a ribeye can be "steak_cut" or "sliced" without us having to
  // enumerate every cut × state combination.
  beef_hub:      MEAT_STATES,
  chicken_hub:   MEAT_STATES,
  pork_hub:      MEAT_STATES,
  turkey_hub:    MEAT_STATES,
  // chicken (the whole-bird canonical) sits outside the hub-inherit
  // path — its parentId is null — so it needs its own entry. Same
  // list; the chicken "whole" default covers the intact bird case.
  chicken:       MEAT_STATES,
  salt:          ["fine", "coarse", "flaky"],
  kosher_salt:   ["coarse", "fine"],
  onion:         ["whole", "diced", "sliced", "minced"],
  garlic:        ["head", "cloves", "minced", "paste", "roasted"],
  lemon:         ["whole", "juiced", "zested"],
  lime:          ["whole", "juiced", "zested"],
  tomato:        ["whole", "diced", "sliced", "crushed"],
  carrot:        ["whole", "diced", "sliced", "shredded", "julienned"],
  potato:        ["whole", "diced", "sliced", "mashed", "shredded"],
};

export const STATE_LABELS = {
  loaf: "loaf",       slices: "sliced",    crumbs: "crumbs",    cubes: "cubed",    toasted: "toasted",
  block: "block",     grated: "grated",    shredded: "shredded",sliced: "sliced",  cubed: "cubed",    crumbled: "crumbled",
  raw: "raw",         cooked: "cooked",    ground: "ground",
  shredded_cooked: "shredded (cooked)", diced_cooked: "diced (cooked)",
  fine: "fine",       coarse: "coarse",    flaky: "flaky",
  whole: "whole",     diced: "diced",      minced: "minced",    julienned: "julienned",
  head: "head",       cloves: "cloves",    paste: "paste",      roasted: "roasted",
  juiced: "juiced",   zested: "zested",
  crushed: "crushed", mashed: "mashed",
  // Meat state labels — new taxonomy. Display text stays lowercase
  // to match the rest of the vocabulary; the UI uppercases at render.
  steak_cut: "steak cut", chop: "chop",       fillet: "fillet",
  tenderloin: "tenderloin", rack: "rack",
  chunks: "chunks",     strips: "strips",   shaved: "shaved",
  patty: "patty",       meatball: "meatball", sausage: "sausage",
  links: "links",       nuggets: "nuggets",  jerky: "jerky",
  // "loaf" already defined above (reused for meatloaf)
};

export const DEFAULT_STATE_FOR = {
  bread: "loaf",
  cheese_hub: "block",
  // Every meat hub defaults to "whole" — the intact, minimally-altered
  // form. A ribeye scanned from a receipt is "whole" until the user
  // tells us otherwise (sliced, cubed, ground, patty, etc.). "raw"
  // used to be the default but that conflated cooking stage with
  // form; cooking stage is a separate axis the user can flip later.
  beef_hub: "whole",
  chicken_hub: "whole",
  pork_hub: "whole",
  turkey_hub: "whole",
  chicken: "whole",
  salt: "fine",
  kosher_salt: "coarse",
  onion: "whole",
  garlic: "head",
  lemon: "whole",
  lime: "whole",
  tomato: "whole",
  carrot: "whole",
  potato: "whole",
};

// Food-type → state-vocab hub mapping. Food category IS the source
// of state vocabulary — the specific canonical doesn't get to
// override. Burrata, mozzarella, and parmesan all share the cheese
// state vocab because they're all wweia_cheese. Ribeye, ground beef,
// and brisket all share MEAT_STATES because they're all wweia_beef.
//
// This keeps the state picker from being over-fitted to the
// canonical ("burrata comes in balls"? weird). The user's mental
// model is "I have a chunk of cheese in my fridge; what shape is
// it?" — a question that belongs to the category, not the specific
// cheese.
//
// Food types without a state vocabulary (produce, pantry staples,
// canned goods) stay unmapped so the STATE field doesn't render at
// all on those items.
const FOOD_TYPE_STATE_HUB = {
  // proteins — every meat food type to the shared MEAT_STATES
  wweia_beef:     "beef_hub",
  wweia_pork:     "pork_hub",
  wweia_poultry:  "chicken_hub",
  wweia_lamb:     "beef_hub",     // no lamb_hub yet; beef_hub has
                                   // the closest shape. Replace when
                                   // a lamb_hub ships.
  wweia_hot_dogs: "pork_hub",
  wweia_sausages: "pork_hub",
  // dairy — cheese has a rich state vocabulary (block, grated,
  // shredded, sliced, cubed, crumbled) regardless of specific cheese.
  wweia_cheese:   "cheese_hub",
  // grains — bread has its own vocab (loaf, slices, crumbs, ...).
  wweia_bread:    "bread",
};

// Does this ingredient id have a meaningful state vocabulary? Walks the
// parent chain so a specific cheese (parmesan) inherits from cheese_hub
// without needing its own entry.
export function statesForIngredient(ingredientOrId) {
  const id = typeof ingredientOrId === "string" ? ingredientOrId : ingredientOrId?.id;
  if (!id) return null;
  if (INGREDIENT_STATES[id]) return INGREDIENT_STATES[id];
  const ing = typeof ingredientOrId === "object" ? ingredientOrId : findIngredient(id);
  const parentId = ing?.parentId;
  if (parentId && INGREDIENT_STATES[parentId]) return INGREDIENT_STATES[parentId];
  return null;
}

// Item-level state lookup. FOOD CATEGORY is the primary source of
// state vocabulary — the specific canonical doesn't drive it. The
// user's mental model: "it's cheese, what shape is it?" Not "it's
// burrata, what shape is it?". That means:
//
//   1. item.typeId → FOOD_TYPE_STATE_HUB → state vocab (WINS)
//   2. canonical's own states (legacy / typeId-less rows only)
//
// Rationale (user-stated): canonical-level state is "too drilled
// down." Burrata and parmesan are both wweia_cheese; both use the
// same state vocab (block/grated/shredded/sliced/cubed/crumbled).
// A ribeye, a brisket, and a pork chop are all MEAT_STATES. The
// canonical-first approach over-fit the state vocabulary to the
// specific ingredient; category-first keeps it consistent.
export function statesForItem(item) {
  if (!item) return null;
  // 1. Direct typeId → hub mapping. Food category drives state — the
  // primary path.
  const hubId = item.typeId ? FOOD_TYPE_STATE_HUB[item.typeId] : null;
  if (hubId && INGREDIENT_STATES[hubId]) return INGREDIENT_STATES[hubId];
  // 2. Canonical's own vocab via parent chain. Covers bundled
  // canonicals that inherit (hot_dog → pork_hub, ribeye → beef_hub,
  // parmesan → cheese_hub, etc.).
  const canonical = findIngredient(item.canonicalId || item.ingredientId);
  const fromCanon = statesForIngredient(canonical || item.canonicalId || item.ingredientId);
  if (fromCanon && fromCanon.length > 0) return fromCanon;
  // 3. Proxy-canonical fallback. If item.typeId is a bundled WWEIA
  // type that points at a canonical via canonicalIdForType (e.g.
  // wweia_sausages → "sausage"), walk THAT canonical's parent chain.
  // Catches cases where FOOD_TYPE_STATE_HUB is missing a mapping or
  // the item's own canonical/ingredient is unlinked but the type is
  // still set. Late-import-safe: uses the same INGREDIENTS array and
  // statesForIngredient helper we already have.
  if (item.typeId) {
    const proxyId = proxyCanonicalForFoodType(item.typeId);
    if (proxyId) {
      const proxy = findIngredient(proxyId);
      const fromProxy = statesForIngredient(proxy || proxyId);
      if (fromProxy && fromProxy.length > 0) return fromProxy;
    }
  }
  return null;
}

// Locally-resolved mirror of the FOOD_TYPES canonicalId bridge —
// avoids importing from foodTypes.js (which imports from us, circular).
// Keeps the small subset we actually need for state lookup. Expand if
// FOOD_TYPES grows new WWEIA types with canonical bridges.
function proxyCanonicalForFoodType(typeId) {
  const BRIDGE = {
    wweia_sausages:  "sausage",
    wweia_hot_dogs:  "hot_dog",
    wweia_bacon:     "bacon",
    wweia_beef:      "beef_hub",
    wweia_pork:      "pork_hub",
    wweia_poultry:   "chicken_hub",
    wweia_lamb:      "beef_hub",
    wweia_cheese:    "cheese_hub",
    wweia_bread:     "bread",
  };
  return BRIDGE[typeId] || null;
}

// Default-state counterpart to statesForItem. Same priority:
// category wins, canonical fallback. Every meat category defaults
// to "whole"; cheese to "block"; bread to "loaf".
export function defaultStateForItem(item) {
  if (!item) return null;
  const hubId = item.typeId ? FOOD_TYPE_STATE_HUB[item.typeId] : null;
  if (hubId && DEFAULT_STATE_FOR[hubId]) return DEFAULT_STATE_FOR[hubId];
  const canonical = findIngredient(item.canonicalId || item.ingredientId);
  return defaultStateFor(canonical || item.canonicalId || item.ingredientId);
}

export function defaultStateFor(ingredientOrId) {
  const id = typeof ingredientOrId === "string" ? ingredientOrId : ingredientOrId?.id;
  if (!id) return null;
  if (DEFAULT_STATE_FOR[id]) return DEFAULT_STATE_FOR[id];
  const ing = typeof ingredientOrId === "object" ? ingredientOrId : findIngredient(id);
  const parentId = ing?.parentId;
  if (parentId && DEFAULT_STATE_FOR[parentId]) return DEFAULT_STATE_FOR[parentId];
  return null;
}

export function stateLabel(state) {
  if (!state) return "";
  return STATE_LABELS[state] || state;
}

// Receipt-code → canonical-state map. Grocery POS systems abbreviate
// aggressively (SHRD MOZZ, SLCD PROV, GRT PARM). This folds the common
// shorthand plus spelled-out forms to the controlled state vocabulary
// used by INGREDIENT_STATES.
//
// Keyed lowercase. Earlier entries win over later ones if patterns
// overlap (e.g., "shredded_cooked" should NOT match "shredded" alone —
// but the list below is for RAW codes on produce/cheese and doesn't
// touch the cooked-meat vocabulary, so there's no collision today).
//
// Exported so parseIdentity (and any other caller that wants the
// same raw-text → state vocabulary) can reuse this table without
// re-duplicating the patterns. Shape is stable: array of
// { pattern: RegExp, state: stateId } entries, iterated top-down.
export const STATE_ALIASES = [
  // dairy / cheese
  { pattern: /\bshrd\b|\bshred\b|\bshredded\b/i, state: "shredded" },
  { pattern: /\bslcd\b|\bsliced?\b/i,            state: "sliced"   },
  { pattern: /\bgrt\b|\bgrated?\b/i,             state: "grated"   },
  { pattern: /\bblk\b|\bblock\b/i,               state: "block"    },
  { pattern: /\bcrmb\b|\bcrumbled?\b/i,          state: "crumbled" },
  { pattern: /\bcubed?\b/i,                      state: "cubed"    },
  // bread
  { pattern: /\bloaf\b/i,                        state: "loaf"     },
  { pattern: /\bcrumbs?\b|\bbrdcrmb\b/i,         state: "crumbs"   },
  { pattern: /\btoasted?\b/i,                    state: "toasted"  },
  // produce / aromatics
  { pattern: /\bwhl\b|\bwhole\b/i,               state: "whole"    },
  { pattern: /\bdced\b|\bdiced?\b/i,             state: "diced"    },
  { pattern: /\bmnc\b|\bminced?\b/i,             state: "minced"   },
  { pattern: /\bjulienned?\b/i,                  state: "julienned" },
  { pattern: /\bmashed\b/i,                      state: "mashed"   },
  { pattern: /\bcrushed\b/i,                     state: "crushed"  },
  { pattern: /\bjuiced?\b/i,                     state: "juiced"   },
  { pattern: /\bzested?\b/i,                     state: "zested"   },
  // meat — ordered most-specific first so compound patterns
  // ("MEATBALL") win over general ones ("BALL"/"LOAF") where
  // overlap is possible.
  { pattern: /\bmeatball(?:s)?\b|\bmtbl\b/i,     state: "meatball" },
  { pattern: /\bmeatloaf\b|\bmtlf\b/i,           state: "loaf"     },
  { pattern: /\bnuggets?\b|\bnggt\b/i,           state: "nuggets"  },
  { pattern: /\bpatt(?:y|ies)\b|\bptty\b/i,      state: "patty"    },
  { pattern: /\blinks?\b/i,                      state: "links"    },
  { pattern: /\bsausages?\b|\bssg\b/i,           state: "sausage"  },
  { pattern: /\bjerky\b|\bjrky\b/i,              state: "jerky"    },
  { pattern: /\btenderloin\b|\btndrln\b|\btndr\b/i, state: "tenderloin" },
  { pattern: /\bfil(?:l)?ets?\b|\bfil\b/i,       state: "fillet"   },
  { pattern: /\bsteak(?:s)?\b|\bstk\b/i,         state: "steak_cut" },
  { pattern: /\brack\b/i,                        state: "rack"     },
  { pattern: /\bchops?\b|\bchp\b/i,              state: "chop"     },
  { pattern: /\bshaved\b|\bshvd\b/i,             state: "shaved"   },
  { pattern: /\bstrips?\b|\bstrp\b/i,            state: "strips"   },
  { pattern: /\bchunks?\b|\bchnk\b/i,            state: "chunks"   },
  { pattern: /\bgrnd\b|\bground\b/i,             state: "ground"   },
  { pattern: /\bckd\b|\bcooked?\b/i,             state: "cooked"   },
  { pattern: /\braw\b|\bfresh\b/i,               state: "raw"      },
  // garlic
  { pattern: /\bhead\b/i,                        state: "head"     },
  { pattern: /\bcloves?\b/i,                     state: "cloves"   },
  { pattern: /\bpaste\b/i,                       state: "paste"    },
  { pattern: /\broasted\b/i,                     state: "roasted"  },
  // salt
  { pattern: /\bflaky\b|\bflaked\b/i,            state: "flaky"    },
  { pattern: /\bcoarse\b/i,                      state: "coarse"   },
  { pattern: /\bfine\b/i,                        state: "fine"     },
];

// Detect an ingredient state from free-text scan output. Returns the
// canonical state id when found AND that state exists in the
// ingredient's vocabulary. Returns null otherwise.
//
//   detectStateFromText("SHRD MOZZ", mozzarella_ingredient)
//     → "shredded"
//
//   detectStateFromText("WHL MILK", milk_ingredient)
//     → null   (milk has no state vocabulary — scan text is noise)
//
//   detectStateFromText("BREAD", bread_ingredient)
//     → null   (no state keyword matched)
export function detectStateFromText(text, ingredient) {
  if (!text) return null;
  const vocab = statesForIngredient(ingredient);
  if (!vocab || vocab.length === 0) return null;
  const vocabSet = new Set(vocab);
  for (const { pattern, state } of STATE_ALIASES) {
    if (pattern.test(text) && vocabSet.has(state)) return state;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAND axis — grocery manufacturer labels that ride along with the
// free-text name ("KERRYGOLD UNSALTED", "TYSON CHKN TNDRLN"). Pulled
// onto a separate column via migration 0061 so parseIdentity can
// strip brand tokens BEFORE running state / canonical detection —
// otherwise "KERRYGOLD" drowns out the cheese keyword match and
// "TYSON" leaks into canonical inference as noise.
//
// Shape mirrors STATE_ALIASES: array of { pattern, brand } with a
// display-cased `brand` (the receipt abbreviation gets folded back
// to the brand's canonical capitalization so "KERRYGOLD" and
// "kerrygold" both render as "Kerrygold" in the UI).
//
// Small curated list — we cover the brands that recur across our
// users' receipts rather than every SKU on the shelf. parseIdentity
// returns null on unknown brands so the rest of the pipeline falls
// back to the existing behavior unchanged. A future BRANDS registry
// can extend this from a data file the same way CANONICAL_ALIASES
// unified state-baked slugs.
// ─────────────────────────────────────────────────────────────────────────────
export const BRAND_ALIASES = [
  // dairy
  { pattern: /\bkerrygold\b/i,                 brand: "Kerrygold" },
  { pattern: /\bplugr[aá]\b/i,                 brand: "Plugrá" },
  { pattern: /\borganic\s+valley\b/i,          brand: "Organic Valley" },
  { pattern: /\bdaisy\b/i,                     brand: "Daisy" },
  { pattern: /\bchobani\b/i,                   brand: "Chobani" },
  { pattern: /\bfage\b/i,                      brand: "Fage" },
  { pattern: /\byoplait\b/i,                   brand: "Yoplait" },
  { pattern: /\bdannon\b/i,                    brand: "Dannon" },
  { pattern: /\bphiladelphia\b|\bphilly\s+crm\b/i, brand: "Philadelphia" },
  { pattern: /\bboursin\b/i,                   brand: "Boursin" },
  { pattern: /\bsilk\b/i,                      brand: "Silk" },
  { pattern: /\boatly\b/i,                     brand: "Oatly" },
  // meat / poultry
  { pattern: /\btyson\b/i,                     brand: "Tyson" },
  { pattern: /\bperdue\b/i,                    brand: "Perdue" },
  { pattern: /\bbutterball\b/i,                brand: "Butterball" },
  { pattern: /\bjimmy\s+dean\b/i,              brand: "Jimmy Dean" },
  { pattern: /\boscar\s+mayer\b/i,             brand: "Oscar Mayer" },
  { pattern: /\bhormel\b/i,                    brand: "Hormel" },
  { pattern: /\bapplegate\b/i,                 brand: "Applegate" },
  { pattern: /\bboar'?s\s+head\b/i,            brand: "Boar's Head" },
  // pantry
  { pattern: /\bheinz\b/i,                     brand: "Heinz" },
  { pattern: /\bkraft\b/i,                     brand: "Kraft" },
  { pattern: /\bhellmann'?s\b/i,               brand: "Hellmann's" },
  { pattern: /\bduke'?s\b/i,                   brand: "Duke's" },
  { pattern: /\bjif\b/i,                       brand: "Jif" },
  { pattern: /\bskippy\b/i,                    brand: "Skippy" },
  { pattern: /\bsmucker'?s\b/i,                brand: "Smucker's" },
  { pattern: /\bcampbell'?s\b/i,               brand: "Campbell's" },
  { pattern: /\bprogresso\b/i,                 brand: "Progresso" },
  { pattern: /\bmutti\b/i,                     brand: "Mutti" },
  { pattern: /\bcento\b/i,                     brand: "Cento" },
  { pattern: /\bde\s+cecco\b/i,                brand: "De Cecco" },
  { pattern: /\bbarilla\b/i,                   brand: "Barilla" },
  { pattern: /\brao'?s\b/i,                    brand: "Rao's" },
  { pattern: /\bkikkoman\b/i,                  brand: "Kikkoman" },
  { pattern: /\bhuy\s+fong\b/i,                brand: "Huy Fong" },
  { pattern: /\bcholula\b/i,                   brand: "Cholula" },
  { pattern: /\btabasco\b/i,                   brand: "Tabasco" },
  { pattern: /\bfrank'?s\s+redhot\b/i,         brand: "Frank's RedHot" },
  // store brands — catch last so "KIRKLAND OSCAR MAYER" (rare) still
  // records the more-specific brand; the longest-matching pattern
  // isn't enforced here because store brands don't overlap with name
  // brands in practice.
  { pattern: /\bkirkland\b/i,                  brand: "Kirkland" },
  { pattern: /\btrader\s+joe'?s\b/i,           brand: "Trader Joe's" },
  { pattern: /\bwhole\s+foods\b|\b365\s+(?:by|whole)\b/i, brand: "365" },
  { pattern: /\bgreat\s+value\b/i,             brand: "Great Value" },
  { pattern: /\bgood\s+&?\s*gather\b/i,        brand: "Good & Gather" },
  { pattern: /\bsignature\s+select\b/i,        brand: "Signature Select" },
];

// Strip every occurrence of `pattern` from `text`, collapse resulting
// whitespace, and return the cleaned string. Used by parseIdentity to
// subtract matched brand/state tokens before the next layer runs —
// "KERRYGOLD SHRD MOZZ" → (strip KERRYGOLD) → "SHRD MOZZ" → (strip SHRD)
// → "MOZZ" → canonical lookup finds mozzarella cleanly.
function stripPattern(text, pattern) {
  if (!text) return "";
  // Build a global version of the pattern so replaceAll-ish behavior
  // works even when the incoming pattern uses a single-match flag set.
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const global = new RegExp(pattern.source, flags);
  return text.replace(global, " ").replace(/\s+/g, " ").trim();
}

/**
 * Three-layer BRAND → STATE → CANONICAL parser. Run on any raw
 * grocery-receipt / pantry-scan / user-typed name to peel the
 * identity stack apart into its axes.
 *
 *   parseIdentity("KERRYGOLD SHRD MOZZ")
 *     → { brand: "Kerrygold", state: "shredded", canonical: "mozzarella",
 *         remainder: "mozz" }
 *
 *   parseIdentity("TYSON CHKN TNDRLN")
 *     → { brand: "Tyson", state: "tenderloin", canonical: "chicken",
 *         remainder: "chkn" }
 *
 *   parseIdentity("bananas")
 *     → { brand: null, state: null, canonical: "banana", remainder: "bananas" }
 *
 * Each layer runs against the text AFTER earlier layers have stripped
 * their matched tokens — that's what keeps brand tokens from drowning
 * out canonical matches and what prevents the state-vocabulary from
 * matching against a brand substring (no current brand collides with
 * a state keyword, but the order insulates us from future additions).
 *
 * Returns null-valued axes when no layer fires. The STATE layer here
 * is vocabulary-agnostic — it returns whatever STATE_ALIASES matches
 * since we don't know the canonical yet. Callers that need to validate
 * the state against an ingredient's state vocabulary should re-run
 * detectStateFromText with the resolved canonical, which applies the
 * per-ingredient filter.
 */
export function parseIdentity(rawText) {
  const empty = { brand: null, state: null, canonical: null, remainder: "" };
  if (!rawText || typeof rawText !== "string") return empty;
  let remainder = rawText.trim();
  if (!remainder) return empty;

  // ── 1. BRAND — peel manufacturer labels first. Name-brand receipts
  //    lead with "KERRYGOLD" / "TYSON"; stripping these up-front keeps
  //    their tokens from biasing the later state + canonical layers.
  let brand = null;
  for (const { pattern, brand: label } of BRAND_ALIASES) {
    if (pattern.test(remainder)) {
      brand = label;
      remainder = stripPattern(remainder, pattern);
      break;
    }
  }

  // ── 2. STATE — grocery POS abbreviations (SHRD/SLCD/WHL/GRND). First
  //    match wins, mirroring detectStateFromText's order. We don't
  //    gate on the ingredient's vocabulary here because the canonical
  //    isn't resolved yet — callers that need the vocab check should
  //    re-run detectStateFromText after resolving the canonical.
  let state = null;
  for (const { pattern, state: stateId } of STATE_ALIASES) {
    if (pattern.test(remainder)) {
      state = stateId;
      remainder = stripPattern(remainder, pattern);
      break;
    }
  }

  // ── 3. CANONICAL — substring-match against the bundled alias map.
  //    Longest match wins (same ordering discipline as
  //    inferCanonicalFromName). The remainder drives the lookup so
  //    brand/state tokens don't bias the match.
  const canonical = inferCanonicalFromName(remainder) || null;

  return { brand, state, canonical, remainder };
}
