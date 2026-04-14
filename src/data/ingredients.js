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

export const INGREDIENTS = [
  // ── dairy / eggs ────────────────────────────────────────────────────────
  {
    id: "eggs", name: "Eggs", emoji: "🥚", category: "dairy",
    units: [{ id: "count", label: "eggs", toBase: 1 }],
    defaultUnit: "count",
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
  },
  {
    id: "milk", name: "Milk", emoji: "🥛", category: "dairy",
    units: [
      { id: "cup",    label: "cups",    toBase: 240 },
      { id: "pint",   label: "pints",   toBase: 473 },
      { id: "quart",  label: "quarts",  toBase: 946 },
      { id: "gallon", label: "gallons", toBase: 3785 },
      { id: "ml",     label: "ml",      toBase: 1 },
      { id: "tbsp",   label: "tbsp",    toBase: 15 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "heavy_cream", name: "Heavy Cream", emoji: "🥛", category: "dairy",
    units: [
      { id: "cup",  label: "cups",  toBase: 240 },
      { id: "pint", label: "pints", toBase: 473 },
      { id: "tbsp", label: "tbsp",  toBase: 15 },
      { id: "ml",   label: "ml",    toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "parmesan", name: "Parmesan", emoji: "🧀", category: "dairy",
    units: [
      { id: "cup", label: "cups grated", toBase: 90 },
      { id: "oz",  label: "oz",          toBase: 28.35 },
      { id: "g",   label: "g",           toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "pecorino", name: "Pecorino Romano", emoji: "🧀", category: "dairy",
    units: [
      { id: "cup", label: "cups grated", toBase: 90 },
      { id: "oz",  label: "oz",          toBase: 28.35 },
      { id: "g",   label: "g",           toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "gruyere", name: "Gruyère", emoji: "🧀", category: "dairy",
    units: [
      { id: "cup", label: "cups grated", toBase: 90 },
      { id: "oz",  label: "oz",          toBase: 28.35 },
      { id: "g",   label: "g",           toBase: 1 },
    ],
    defaultUnit: "cup",
  },
  {
    id: "mozzarella", name: "Fresh Mozzarella", emoji: "🧀", category: "dairy",
    units: [
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "g",  label: "g",  toBase: 1 },
      { id: "lb", label: "lb", toBase: 453.6 },
    ],
    defaultUnit: "oz",
  },

  // ── meat / pork ─────────────────────────────────────────────────────────
  {
    id: "chicken", name: "Chicken", emoji: "🍗", category: "meat",
    units: [
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "kg", label: "kg", toBase: 1000 },
    ],
    defaultUnit: "lb",
  },
  {
    id: "bacon", name: "Bacon / Pancetta", emoji: "🥓", category: "meat",
    units: [
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "slice", label: "slices", toBase: 14 },
      { id: "lb",    label: "lb",     toBase: 453.6 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "guanciale", name: "Guanciale", emoji: "🥓", category: "meat",
    units: [
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "g",  label: "g",  toBase: 1 },
      { id: "lb", label: "lb", toBase: 453.6 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "ham", name: "Ham", emoji: "🥩", category: "meat",
    units: [
      { id: "oz",    label: "oz",     toBase: 28.35 },
      { id: "slice", label: "slices", toBase: 15 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "steak", name: "Steak", emoji: "🥩", category: "meat",
    units: [
      { id: "lb",    label: "lb",       toBase: 453.6 },
      { id: "oz",    label: "oz",       toBase: 28.35 },
      { id: "count", label: "steaks",   toBase: 340 },  // ~12oz per steak
    ],
    defaultUnit: "lb",
  },
  {
    id: "ground_beef", name: "Ground Beef", emoji: "🥩", category: "meat",
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
  {
    id: "spaghetti", name: "Spaghetti", emoji: "🍝", category: "pantry",
    units: [
      { id: "oz", label: "oz", toBase: 28.35 },
      { id: "lb", label: "lb", toBase: 453.6 },
      { id: "g",  label: "g",  toBase: 1 },
    ],
    defaultUnit: "oz",
  },
  {
    id: "bread", name: "Bread (pain de mie)", emoji: "🍞", category: "pantry",
    units: [
      { id: "slice", label: "slices", toBase: 1 },
      { id: "loaf",  label: "loaves", toBase: 20 },
    ],
    defaultUnit: "slice",
  },
  {
    id: "baguette", name: "Baguette", emoji: "🥖", category: "pantry",
    units: [
      { id: "slice", label: "slices", toBase: 1 },
      { id: "count", label: "whole",  toBase: 20 },
    ],
    defaultUnit: "count",
  },
  {
    id: "ciabatta", name: "Ciabatta / Focaccia", emoji: "🍞", category: "pantry",
    units: [
      { id: "count", label: "rolls",   toBase: 1 },
      { id: "loaf",  label: "loaves",  toBase: 6 },
    ],
    defaultUnit: "count",
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
];

// ─────────────────────────────────────────────────────────────────────────────
// Lookups & helpers
// ─────────────────────────────────────────────────────────────────────────────

const byId = new Map(INGREDIENTS.map(i => [i.id, i]));

export function findIngredient(id) {
  return id ? byId.get(id) || null : null;
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

// Compare pantry "have" vs recipe "need". Both are { amount, unit }.
// Returns one of "ok" | "low" | "missing" | "unknown" (if conversion fails).
//   - missing: no pantry item OR have < need after conversion
//   - low:     have ≥ need, but leftover would be below the pantry item's
//              lowThreshold (also converted to base units)
//   - ok:      plenty
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
