// Hand-curated SVG icons for canonical ingredients.
//
// The full flow for canonical imagery has three tiers:
//
//   1. Bundled SVG in public/icons/<canonical_id>.svg  (this file's
//      manifest). Hand-drawn, versioned with the repo. Wins over
//      everything else because it's the curated choice.
//   2. ingredient_info.info.imageUrl — admin-generated via Recraft
//      (generate-canonical-image edge fn). Overwritable until locked.
//   3. Emoji fallback — the canonical's `emoji` field from
//      ingredients.js.
//
// Add a new hand-drawn icon: drop the file at public/icons/<slug>.svg
// (lowercase canonical slug, e.g. `chicken_breast.svg`) and append
// the slug to BUNDLED_ICON_SLUGS below. The helper returns the
// absolute path if the slug is in the set, null otherwise.
//
// Keeping this as an explicit set rather than a HEAD-request existence
// check keeps it synchronous — the consumer can decide between
// <img> and emoji in one render pass without a second round trip.

const BUNDLED_ICON_SLUGS = new Set([
  "chicken",
]);

export function bundledIconFor(canonicalId) {
  if (!canonicalId || typeof canonicalId !== "string") return null;
  const slug = canonicalId.toLowerCase();
  if (!BUNDLED_ICON_SLUGS.has(slug)) return null;
  return `/icons/${slug}.svg`;
}

// Top-level resolver — bundled SVG first, then admin-generated
// imageUrl from info. Returns the URL to render or null when nothing
// beats the emoji fallback.
export function canonicalImageUrlFor(canonicalId, info) {
  const bundled = bundledIconFor(canonicalId);
  if (bundled) return bundled;
  if (info?.imageUrl) return info.imageUrl;
  return null;
}

// ── STORED IN tile icons ──────────────────────────────────────────────
// Parallel system for the location-tile headers (Fridge / Pantry /
// Freezer category tiles). Same convention: drop a file at
// public/icons/tiles/<tile_id>.svg (lowercase, snake_case matching
// the tile id from src/lib/{fridge,pantry,freezer}Tiles.js), then
// add the id to BUNDLED_TILE_SLUGS below. Tile renderers check
// tileIconFor() before falling back to the tile's emoji.
//
// Tile IDs as of latest:
//
//   FRIDGE: meat_poultry, seafood, dairy, produce, fresh_herbs,
//           condiments, drinks, bread_baked, leftovers, misc
//
//   PANTRY: pasta_grains, beans_legumes, canned_jarred, baking,
//           spices_dried_herbs, condiments_sauces, oils_fats,
//           sweeteners, nuts_seeds, cooking_alcohol, bread,
//           dried_chilies, misc
//
//   FREEZER: frozen_meat_poultry, frozen_seafood, frozen_stocks_sauces,
//            frozen_veg, frozen_fruit, frozen_bread_dough,
//            frozen_meal_prep, frozen_desserts, frozen_butter_dairy,
//            frozen_herbs, misc
//
// Naming note: `misc` collides across all three locations (each has
// its own misc tile). Use location-prefixed variants if you want
// distinct visuals — e.g. fridge_misc.svg / pantry_misc.svg /
// freezer_misc.svg — and register both the bare id and the prefixed
// id below; tileIconFor checks the prefixed form first.
const BUNDLED_TILE_SLUGS = new Set([
  // Add registered tile slugs here. Keep one slug per line with
  // a trailing comma so future additions don't break the parse
  // (missing-comma between "produce" and "dairy" is what broke
  // the build the first time this list grew past one entry).
  // Slug must match the TILE ID from src/lib/{fridge,pantry,
  // freezer}Tiles.js exactly — e.g. "meat_poultry" not
  // "meat_and_poultry" (tile labels are human; slugs are keys).
  "produce",
  "dairy",
  "meat_poultry",
  "seafood",
  "drinks",
  "fresh_herbs",
  "condiments",
  "leftovers",
  "bread_baked",
]);

export function tileIconFor(tileId, location) {
  if (!tileId || typeof tileId !== "string") return null;
  const slug = tileId.toLowerCase();
  // Try location-prefixed first so distinct misc-per-location works
  // (e.g. fridge_misc beats misc). location is the parent shelf
  // ('fridge' | 'pantry' | 'freezer'), passed through from the
  // renderer when known.
  if (location && BUNDLED_TILE_SLUGS.has(`${location}_${slug}`)) {
    return `/icons/tiles/${location}_${slug}.svg`;
  }
  if (BUNDLED_TILE_SLUGS.has(slug)) {
    return `/icons/tiles/${slug}.svg`;
  }
  return null;
}
