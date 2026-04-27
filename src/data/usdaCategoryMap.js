// USDA `branded_food_category` → brand-expertise axes bridge.
//
// USDA's FoodData Central tags every Branded Foods entry with a
// `branded_food_category` string ("Lunch & Deli Meats", "Cookies &
// Biscuits", "Hot Dogs, Sausages & Lunch Meats", …). The ingest
// script (scripts/ingest_external_baseline.js) slugifies these into
// `category_hints` on `barcode_identity_corrections` — so a single
// global table holds (UPC, brand, category_hint, …) tuples
// derivable from USDA at scale.
//
// This map turns USDA's ~80 grocery category buckets into our
// brand-expertise axes (subtype + category). Each entry resolves to:
//
//   subtype  — one of the brand-expertise subtypes
//              (cookie / candy / sauce / deli / cheese / …)
//   category — registry category ("dairy" / "meat" / "pantry" /
//              "produce" / "frozen" / "beverage")
//
// The map covers BOTH the raw USDA label form ("Lunch & Deli Meats")
// AND the slugified form ("lunch-and-deli-meats") that the ingest
// script writes into category_hints — `axesForUsdaCategory(s)`
// normalizes the input so callers don't need to care.
//
// Used by:
//   1. scripts/derive_brand_expertise.js — aggregates USDA rows
//      into a brand → { subtype: count, category: count } histogram.
//   2. Future: pickPrimaryBrand could fall back to this map when
//      OFF/USDA hints contain a USDA-slug pattern.

// Raw-label keyed map. Order matches USDA_GROCERY_CATEGORIES in the
// ingest script — keep in sync if either side adds/removes a bucket.
export const USDA_CATEGORY_TO_AXES = {
  // ── Breakfast / cereals ────────────────────────────────────
  "Breakfast Cereals":                            { subtype: "cereal",     category: "pantry" },
  "Breakfast Foods":                              { subtype: "boxed_meal", category: "pantry" },

  // ── Dairy ──────────────────────────────────────────────────
  "Cheese":                                        { subtype: "cheese", category: "dairy" },
  "Yogurt":                                        { subtype: "yogurt", category: "dairy" },
  "Milk":                                          { subtype: "milk",   category: "dairy" },
  "Cream":                                         { subtype: "milk",   category: "dairy" },
  "Butter":                                        { subtype: "butter", category: "dairy" },
  "Ice Cream & Frozen Yogurt":                     { subtype: "ice_cream", category: "frozen" },
  "Eggs & Egg Substitutes":                        { subtype: null,     category: "dairy" },

  // ── Bread / baking ─────────────────────────────────────────
  "Bread & Buns":                                  { subtype: "bread",  category: "pantry" },
  "Breads & Buns":                                 { subtype: "bread",  category: "pantry" },
  "Rolls & Buns":                                  { subtype: "bread",  category: "pantry" },
  "Baking Accessories":                            { subtype: "baking", category: "pantry" },
  "Baking Additives & Extracts":                   { subtype: "baking", category: "pantry" },
  "Flours & Corn Meal":                            { subtype: "baking", category: "pantry" },
  "Sugars":                                        { subtype: "sweetener", category: "pantry" },
  "Baking/Cooking Mixes (Perishable)":             { subtype: "baking", category: "pantry" },
  "Baking/Cooking Mixes (Shelf Stable)":           { subtype: "baking", category: "pantry" },

  // ── Meat — fresh / frozen / packaged ───────────────────────
  "Fresh Meat":                                    { subtype: null,        category: "meat" },
  "Frozen Meat":                                   { subtype: null,        category: "frozen" },
  "Lunch & Deli Meats":                            { subtype: "deli",      category: "meat" },
  "Hot Dogs, Sausages & Lunch Meats":              { subtype: "sausage",   category: "meat" },
  "Bacon, Sausages & Ribs":                        { subtype: "sausage",   category: "meat" },
  "Deli Salads":                                   { subtype: "boxed_meal",category: "meat" },

  // ── Seafood ────────────────────────────────────────────────
  "Seafood":                                       { subtype: null, category: "meat" },
  "Canned Tuna, Salmon & Seafood":                 { subtype: null, category: "pantry" },

  // ── Produce — fresh / frozen / canned ──────────────────────
  "Pre-Packaged Fruit & Vegetables":               { subtype: null, category: "produce" },
  "Vegetables - Unprepared/Unprocessed (Frozen)":  { subtype: null, category: "frozen" },
  "Vegetables - Prepared/Processed":               { subtype: null, category: "pantry" },
  "Fruit - Unprepared/Unprocessed (Frozen)":       { subtype: null, category: "frozen" },
  "Fruit - Prepared/Processed":                    { subtype: null, category: "pantry" },
  "Pickles, Olives, Peppers & Relishes":           { subtype: null, category: "pantry" },
  "Canned Fruit":                                  { subtype: null, category: "pantry" },
  "Canned Vegetables":                             { subtype: null, category: "pantry" },
  "Pickled Fruits, Vegetables & Other Foods":      { subtype: null, category: "pantry" },

  // ── Sweets / spreads / honey ───────────────────────────────
  "Jam, Jelly & Fruit Spreads":                    { subtype: "spread",    category: "pantry" },
  "Honey":                                         { subtype: "sweetener", category: "pantry" },
  "Peanut & Other Nut Butters":                    { subtype: "spread",    category: "pantry" },

  // ── Spices / oils / vinegars ───────────────────────────────
  "Herbs & Spices":                                { subtype: null, category: "pantry" },
  "Salt":                                          { subtype: null, category: "pantry" },
  "Seasoning Mixes, Salts, Marinades & Tenderizers": { subtype: "sauce", category: "pantry" },
  "Oil":                                           { subtype: null, category: "pantry" },
  "Vinegars":                                      { subtype: null, category: "pantry" },

  // ── Sauces / dressings / condiments ────────────────────────
  "Salad Dressing & Mayonnaise":                   { subtype: "dressing",  category: "pantry" },
  "Condiments":                                    { subtype: "condiment", category: "pantry" },
  "Sauces":                                        { subtype: "sauce",     category: "pantry" },
  "Soy Sauce":                                     { subtype: "sauce",     category: "pantry" },
  "Tomato Based Sauces":                           { subtype: "sauce",     category: "pantry" },
  "Gravy":                                         { subtype: "sauce",     category: "pantry" },

  // ── Pasta / rice / grains / beans ──────────────────────────
  "Pasta":                                         { subtype: null,        category: "pantry" },
  "Pasta Dinners (Shelf Stable)":                  { subtype: "boxed_meal",category: "pantry" },
  "Pasta by Shape & Type":                         { subtype: null,        category: "pantry" },
  "Rice":                                          { subtype: null,        category: "pantry" },
  "Grains":                                        { subtype: null,        category: "pantry" },
  "Beans":                                         { subtype: null,        category: "pantry" },
  "Canned Beans":                                  { subtype: null,        category: "pantry" },
  "Canned Soup":                                   { subtype: "boxed_meal",category: "pantry" },
  "Soups - Prepared":                              { subtype: "boxed_meal",category: "pantry" },

  // ── Snacks / cookies / crackers / candy ────────────────────
  "Nuts & Seeds - Prepared/Processed":             { subtype: null,      category: "pantry" },
  "Chips, Pretzels & Snacks":                      { subtype: null,      category: "pantry" },
  "Snack, Energy & Granola Bars":                  { subtype: null,      category: "pantry" },
  "Cookies & Biscuits":                            { subtype: "cookie",  category: "pantry" },
  "Crackers":                                      { subtype: "cracker", category: "pantry" },
  "Candy":                                         { subtype: "candy",   category: "pantry" },
  "Chocolate":                                     { subtype: "chocolate", category: "pantry" },

  // ── Frozen meals / pizza / desserts ────────────────────────
  "Frozen Dinners & Entrees":                      { subtype: "boxed_meal", category: "frozen" },
  "Frozen Appetizers & Hors D'oeuvres":            { subtype: "boxed_meal", category: "frozen" },
  "Frozen Pizza":                                  { subtype: "boxed_meal", category: "frozen" },
  "Pizza - Frozen":                                { subtype: "boxed_meal", category: "frozen" },
  "Frozen Breakfast Foods":                        { subtype: "boxed_meal", category: "frozen" },
  "Frozen Bread & Dough":                          { subtype: "bread",      category: "frozen" },
  "Frozen Vegetables":                             { subtype: null,         category: "frozen" },
  "Frozen Fruit":                                  { subtype: null,         category: "frozen" },
  "Frozen Desserts":                               { subtype: "ice_cream",  category: "frozen" },
  "Pre-Packaged Fruit & Vegetables (Frozen)":      { subtype: null,         category: "frozen" },

  // ── Beverages ──────────────────────────────────────────────
  "Soft Drinks":                                   { subtype: "beverage", category: "beverage" },
  "Fruit & Vegetable Juice, Nectars & Fruit Drinks": { subtype: "beverage", category: "beverage" },
  "Tea Bags & Loose Tea":                          { subtype: "beverage", category: "pantry"   },
  "Coffee":                                        { subtype: "beverage", category: "pantry"   },
  "Water":                                         { subtype: "beverage", category: "beverage" },
  "Sports Drinks":                                 { subtype: "beverage", category: "beverage" },
  "Energy Drinks":                                 { subtype: "beverage", category: "beverage" },
  "Plant Based Water":                             { subtype: "beverage", category: "beverage" },

  // ── Plant-based / soy / tofu / milk substitutes ────────────
  "Milk Substitutes (Perishable)":                 { subtype: "milk", category: "dairy"  },
  "Milk Substitutes (Shelf Stable)":               { subtype: "milk", category: "pantry" },
  "Tofu & Soy Products":                           { subtype: null,   category: "produce" },
};

// Slug-keyed mirror (matches the slug form ingest writes into
// barcode_identity_corrections.category_hints). Built once at module
// load. Same slug rule the ingest uses: lowercase, "&" → "and", non-
// alphanumeric → "-", trim leading/trailing dashes.
function slugifyUsdaCategory(s) {
  return String(s).toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
export const USDA_CATEGORY_SLUG_TO_AXES = Object.fromEntries(
  Object.entries(USDA_CATEGORY_TO_AXES).map(([label, axes]) => [
    slugifyUsdaCategory(label),
    axes,
  ])
);

// Tolerant lookup. Accepts either form — raw label ("Cookies &
// Biscuits") or pre-slugified ("cookies-and-biscuits"). Returns
// null when the input doesn't match any known USDA bucket.
export function axesForUsdaCategory(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (USDA_CATEGORY_TO_AXES[s])      return USDA_CATEGORY_TO_AXES[s];
  const slug = slugifyUsdaCategory(s);
  return USDA_CATEGORY_SLUG_TO_AXES[slug] || null;
}
