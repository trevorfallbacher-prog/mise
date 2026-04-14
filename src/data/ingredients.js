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
// estCentsPerGram lets the pantry estimate a $ total when the user adds
// without a receipt — a rough retail-per-lb ÷ 453.6.
function cheeseMembers(rows) {
  return rows.map(([id, name, shortName, defaultUnit, estCentsPerBase]) => ({
    id, name, shortName,
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
  ...cheeseMembers([
    // Fresh / unaged
    ["burrata",         "Burrata",         "Burrata",         "oz",   3.1],
    ["ricotta",         "Ricotta",         "Ricotta",         "cup",  0.9],
    ["mascarpone",      "Mascarpone",      "Mascarpone",      "oz",   2.2],
    ["queso_fresco",    "Queso Fresco",    "Queso Fresco",    "oz",   1.3],
    ["paneer",          "Paneer",          "Paneer",          "oz",   1.5],
    ["fromage_blanc",   "Fromage Blanc",   "Fromage Blanc",   "oz",   1.8],
    ["quark",           "Quark",           "Quark",           "oz",   1.1],
    ["stracchino",      "Stracchino",      "Stracchino",      "oz",   3.3],
    // Soft ripened
    ["camembert",       "Camembert",       "Camembert",       "oz",   2.6],
    ["coulommiers",     "Coulommiers",     "Coulommiers",     "oz",   3.5],
    ["brillat_savarin", "Brillat-Savarin", "Brillat-Savarin", "oz",   4.8],
    ["saint_andre",     "Saint-André",     "Saint-André",     "oz",   4.4],
    ["explorateur",     "Explorateur",     "Explorateur",     "oz",   5.3],
    ["humboldt_fog",    "Humboldt Fog",    "Humboldt Fog",    "oz",   6.2],
    // Semi-soft
    ["havarti",         "Havarti",         "Havarti",         "oz",   1.8],
    ["fontina",         "Fontina",         "Fontina",         "oz",   2.4],
    ["muenster",        "Muenster",        "Muenster",        "oz",   1.3],
    ["taleggio",        "Taleggio",        "Taleggio",        "oz",   4.4],
    ["port_salut",      "Port Salut",      "Port Salut",      "oz",   2.4],
    ["raclette",        "Raclette",        "Raclette",        "oz",   4.0],
    ["butterkase",      "Butterkäse",      "Butterkäse",      "oz",   2.0],
    ["tomme_savoie",    "Tomme de Savoie", "Tomme de Savoie", "oz",   3.5],
    // Washed rind
    ["limburger",       "Limburger",       "Limburger",       "oz",   2.4],
    ["epoisses",        "Époisses",        "Époisses",        "oz",   6.6],
    ["langres",         "Langres",         "Langres",         "oz",   5.7],
    ["vacherin_mdor",   "Vacherin Mont d'Or","Vacherin MdO",   "oz",   7.7],
    ["stinking_bishop", "Stinking Bishop", "Stinking Bishop", "oz",   6.2],
    // Semi-hard
    ["gouda",           "Gouda",           "Gouda",           "oz",   1.8],
    ["edam",            "Edam",            "Edam",            "oz",   2.0],
    ["comte",           "Comté",           "Comté",           "oz",   4.8],
    ["jarlsberg",       "Jarlsberg",       "Jarlsberg",       "oz",   2.6],
    ["manchego",        "Manchego",        "Manchego",        "oz",   4.0],
    ["provolone",       "Provolone",       "Provolone",       "oz",   1.8],
    ["colby",           "Colby",           "Colby",           "oz",   1.3],
    ["monterey_jack",   "Monterey Jack",   "Monterey Jack",   "oz",   1.3],
    ["emmental",        "Emmental",        "Emmental",        "oz",   2.9],
    // Hard / aged
    ["parmigiano",      "Parmigiano-Reggiano", "Parm-Reggiano","oz",  4.8],
    ["aged_cheddar",    "Aged Cheddar",    "Aged Cheddar",    "oz",   3.1],
    ["aged_gouda",      "Aged Gouda",      "Aged Gouda",      "oz",   4.4],
    ["asiago",          "Asiago",          "Asiago",          "oz",   3.1],
    ["grana_padano",    "Grana Padano",    "Grana Padano",    "oz",   4.0],
    ["mimolette",       "Mimolette",       "Mimolette",       "oz",   4.4],
    ["piave",           "Piave",           "Piave",           "oz",   4.8],
    ["sbrinz",          "Sbrinz",          "Sbrinz",          "oz",   5.3],
    // Blue
    ["gorgonzola",      "Gorgonzola",      "Gorgonzola",      "oz",   3.1],
    ["roquefort",       "Roquefort",       "Roquefort",       "oz",   5.3],
    ["stilton",         "Stilton",         "Stilton",         "oz",   4.4],
    ["maytag_blue",     "Maytag Blue",     "Maytag Blue",     "oz",   4.8],
    ["cabrales",        "Cabrales",        "Cabrales",        "oz",   6.2],
    ["bleu_dauvergne",  "Bleu d'Auvergne", "Bleu d'Auvergne", "oz",   4.0],
    ["cambozola",       "Cambozola",       "Cambozola",       "oz",   3.1],
    ["cashel_blue",     "Cashel Blue",     "Cashel Blue",     "oz",   4.4],
    // Smoked
    ["smoked_gouda",    "Smoked Gouda",    "Smoked Gouda",    "oz",   2.2],
    ["smoked_mozz",     "Smoked Mozzarella","Smoked Mozz",    "oz",   2.2],
    ["scamorza",        "Scamorza",        "Scamorza",        "oz",   2.4],
    ["smoked_cheddar",  "Smoked Cheddar",  "Smoked Cheddar",  "oz",   2.2],
    ["idiazabal",       "Idiazábal",       "Idiazábal",       "oz",   4.8],
    // Alpine
    ["appenzeller",     "Appenzeller",     "Appenzeller",     "oz",   4.4],
    ["beaufort",        "Beaufort",        "Beaufort",        "oz",   6.2],
    ["abondance",       "Abondance",       "Abondance",       "oz",   4.8],
    ["vacherin_frib",   "Vacherin Fribourgeois","Vacherin Frib","oz",  4.8],
    // American originals
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
