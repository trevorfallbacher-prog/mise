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
