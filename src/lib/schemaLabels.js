// Schema axis labels — the SINGLE source of truth for the words the
// UI uses to refer to each field on a pantry item. Rename a concept
// here and the whole UI catches up with one edit, no need to hunt
// through JSX strings for every "CANONICAL" occurrence.
//
// Why this matters: "Canonical" is developer jargon. If we decide
// tomorrow that users read "Common Name" better, we should be able
// to flip it from one place — not do a 40-file find-and-replace that
// will inevitably miss strings inside template literals or comments.
//
// Usage pattern:
//
//   import { LABELS } from "../lib/schemaLabels";
//
//   <div>{LABELS.canonical.full}:</div>      // "Canonical"
//   <div>{LABELS.canonical.short}:</div>     // "Canon"
//   <div>{LABELS.canonical.plural}:</div>    // "Canonicals"
//   <div>{LABELS.canonical.help}</div>       // one-line explainer
//
// Each axis carries four strings:
//   full    — the user-facing name in title case ("Category")
//   short   — compact form for chip labels where space is tight
//   plural  — for list headers ("Canonicals", "Categories")
//   help    — one-line explainer used in validation + exit warnings
//
// All values are plain strings — no i18n layer yet. When we add one,
// it plugs in here.

export const LABELS = {
  name: {
    full:   "Name",
    short:  "Name",
    plural: "Names",
    help:   "The display name you type — what you call this item in your kitchen.",
  },

  canonical: {
    full:   "Canonical",
    short:  "Canonical",
    plural: "Canonicals",
    // The "internal identity" concept — what the item IS vs what you
    // call it. Brand-safe (same canonical across Kraft Butter and
    // Kerrygold Butter) so recipes + substitutions hit.
    help:   "The internal \"what is this thing\" name. Pork Loin, Ribeye, 2% Milk. Used to match recipes and substitutions.",
  },

  category: {
    full:   "Category",
    short:  "Category",
    plural: "Categories",
    help:   "The USDA bucket — Pork, Cheese, Bread. Drives the state picker (sliced / ground / whole / …) and the default tile.",
  },

  storedIn: {
    full:   "Stored In",
    short:  "Stored",
    plural: "Tiles",
    help:   "Which tile inside your fridge / pantry / freezer — Dairy, Meat & Poultry, Oils & Fats, etc. You can make your own if none fit.",
  },

  location: {
    full:   "Location",
    short:  "Location",
    plural: "Locations",
    help:   "Fridge, pantry, or freezer. Which tab the item lives under.",
  },

  state: {
    full:   "State",
    short:  "State",
    plural: "States",
    help:   "The physical form — sliced, ground, whole, crumbled. Options depend on the category.",
  },

  ingredients: {
    full:   "Ingredients",
    short:  "Ingredients",
    plural: "Ingredients",
    // Composition tags for multi-part items (pizza = dough + sauce +
    // mozzarella + pepperoni). Distinct from the item's own identity.
    help:   "Composition tags. Pizza, burrito, blend — what's inside the thing.",
  },

  quantity: {
    full:   "Quantity",
    short:  "Qty",
    plural: "Quantities",
    help:   "How much of it. The number part (2 lb, 1 gallon, 18 count).",
  },

  unit: {
    full:   "Unit",
    short:  "Unit",
    plural: "Units",
    help:   "Gallon, stick, lb, count — the way the item is sold. Needed so amounts add up correctly when you restock.",
  },

  expires: {
    full:   "Expires",
    short:  "Expires",
    plural: "Expirations",
    help:   "When does this go bad? Auto-estimated from category when you leave it blank.",
  },
};

// Uppercase helper — mono-font kicker labels (ITEM NAME, STORED IN)
// render in caps everywhere. Calling .toUpperCase() at the render
// site every time is noise; this keeps it tidy.
export function LABEL_KICKER(key) {
  const v = LABELS[key];
  if (!v) return (key || "").toUpperCase();
  return v.full.toUpperCase();
}
