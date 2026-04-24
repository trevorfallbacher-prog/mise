// Icon-mapping layer for the MCM cooking-app experiment.
//
// Swap-in point for branded Jetsons / Googie / atomic-age icon
// artwork. Today every entry's `asset` is null and the ItemIcon
// primitive falls back to the emoji — that keeps screens rendering
// while artwork is in production. When the real SVGs land, drop
// them in `public/mcm-icons/` and update the matching entries:
//
//   butter: { asset: "/mcm-icons/butter.svg", emoji: "🧈" }
//
// Callers should never import this map directly; go through
// `resolveIcon(key)` so unknown keys land on a safe default.

const ICONS = {
  // Dairy & eggs ------------------------------------------------
  butter:      { asset: null, emoji: "🧈" },
  eggs:        { asset: null, emoji: "🥚" },
  milk:        { asset: null, emoji: "🥛" },
  cheese:      { asset: null, emoji: "🧀" },

  // Produce -----------------------------------------------------
  lemon:       { asset: null, emoji: "🍋" },
  garlic:      { asset: null, emoji: "🧄" },
  kale:        { asset: null, emoji: "🥬" },

  // Pantry ------------------------------------------------------
  tomato_can:  { asset: null, emoji: "🍅" },
  bread:       { asset: null, emoji: "🍞" },
  olive_oil:   { asset: null, emoji: "🫒" },

  // Meat & seafood ---------------------------------------------
  salmon:      { asset: null, emoji: "🐟" },
  chicken:     { asset: null, emoji: "🍗" },

  // Recipe / meta ----------------------------------------------
  pasta_dish:  { asset: null, emoji: "🍳" },
};

const FALLBACK = { asset: null, emoji: "·" };

export function resolveIcon(key) {
  return ICONS[key] || FALLBACK;
}
