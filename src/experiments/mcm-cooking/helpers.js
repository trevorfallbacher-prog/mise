// Module-scope helpers + constants shared across the MCM cooking
// pantry surface. Pulled out of KitchenScreen.jsx so the screen
// shell can stay focused on top-level wiring while the extracted
// component files (KitchenCard, ItemGrid, AddDraftSheet, …) all
// import a single canonical version of the helper.

import {
  findIngredient, hubForIngredient, getIngredientInfo,
  cutLabel, STATE_LABELS,
} from "../../data/ingredients";
import { findFoodType } from "../../data/foodTypes";
import { FRIDGE_TILES,  tileIdForItem        as fridgeTileFor  } from "../../lib/fridgeTiles";
import { PANTRY_TILES,  pantryTileIdForItem  as pantryTileFor  } from "../../lib/pantryTiles";
import { FREEZER_TILES, freezerTileIdForItem as freezerTileFor } from "../../lib/freezerTiles";

export const CLASSIFIER_HELPERS = { findIngredient, hubForIngredient };

// The three locations in top-to-bottom kitchen order. Each carries
// the tile manifest + the classifier that maps items to tiles
// within it. Order here is the order the floating dock renders
// segments in. Emoji icons removed — the dock uses solid color
// swatch dots (LOCATION_DOT below) instead per the MCM direction:
// dark blue = fridge, orange = pantry, icy blue = freezer.
export const LOCATIONS = [
  { id: "fridge",  label: "Fridge",  tiles: FRIDGE_TILES,  classify: fridgeTileFor  },
  { id: "pantry",  label: "Pantry",  tiles: PANTRY_TILES,  classify: pantryTileFor  },
  { id: "freezer", label: "Freezer", tiles: FREEZER_TILES, classify: freezerTileFor },
];

// Fallback unit options for the package-size picker when no
// canonical is pinned (or the canonical declares no `units`
// array). Once a canonical is picked we switch to that
// canonical's own units so butter shows sticks / tbsp / cup
// instead of generic "count".
export const DEFAULT_UNIT_OPTIONS = [
  { id: "count", label: "count" },
  { id: "oz",    label: "oz" },
  { id: "lb",    label: "lb" },
  { id: "g",     label: "g" },
  { id: "kg",    label: "kg" },
  { id: "fl oz", label: "fl oz" },
  { id: "ml",    label: "ml" },
  { id: "L",     label: "L" },
  { id: "cup",   label: "cup" },
  { id: "tbsp",  label: "tbsp" },
  { id: "tsp",   label: "tsp" },
  { id: "pkg",   label: "pkg" },
  { id: "can",   label: "can" },
  { id: "jar",   label: "jar" },
  { id: "bag",   label: "bag" },
  { id: "box",   label: "box" },
  { id: "loaf",  label: "loaf" },
  { id: "stick", label: "stick" },
];

// Fallback mapping for Showcase demo items (they don't carry the
// real location / tileId axes). Keeps the design-reference
// surface useful — tapping into demo "dairy" lands in the Dairy
// & Eggs tile with its four demo cards, same grouping the
// production pantry does.
export const DEMO_CAT_MAP = {
  dairy:   { location: "fridge", tileId: "dairy"        },
  produce: { location: "fridge", tileId: "produce"      },
  meat:    { location: "fridge", tileId: "meat_poultry" },
  pantry:  { location: "pantry", tileId: "pasta_grains" },
};

// Pretty label for the STORED IN pill — maps Kitchen's category
// strings to the tile-ish names the MCM card pill expects. Real
// items carry `category` as dairy/produce/meat/pantry/etc. (see
// `usePantry.js` fromDb mapping). Demo items already have the
// human-readable string baked into `location`, so that path
// short-circuits.
export const CATEGORY_LABELS = {
  dairy:     "Dairy & Eggs",
  produce:   "Produce",
  meat:      "Meat & Seafood",
  pantry:    "Pantry",
  freezer:   "Freezer",
  drinks:    "Drinks",
  condiments:"Condiments",
  baking:    "Baking",
};

export const NAV_TABS = [
  { id: "pantry", label: "Pantry", glyph: "🥫" },
  { id: "cook",   label: "Cook",   glyph: "🍳" },
  { id: "plan",   label: "Plan",   glyph: "📅" },
  { id: "you",    label: "You",    glyph: "🌿" },
];

// Width of the swipe-reveal action drawer behind each item card
// (the Remove button). 96px gives the button comfortable tap
// area without consuming so much of the card width that a
// half-open swipe looks like a glitch.
export const SWIPE_ACTION_WIDTH = 96;

// Days between `date` and today, rounded. Negative → already
// expired. Null input → null (no chip shown). Uses midnight-to-
// midnight arithmetic so a card purchased today doesn't read
// "23h left" — it reads "3d" like the user expects.
export function daysUntil(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Format `amount + unit` into the same compact mono string the
// MCM demo items use ("1 stick", "8 large", "½ gallon"). The
// real pantry stores amount as a number; rendering 1.0 as "1"
// and 0.5 as "½" matches the intent without an extra dependency.
export function formatQty(amount, unit) {
  if (amount == null || Number.isNaN(amount)) return unit || "";
  const round = (n) => Math.round(n * 100) / 100;
  const a = round(amount);
  // Common fractional sugar — keep ½/¼/¾ as glyphs for the
  // recipe-book feel that matches the serif-italic name above.
  const FRAC = { 0.5: "½", 0.25: "¼", 0.75: "¾", 0.33: "⅓", 0.67: "⅔" };
  const frac = FRAC[a] || FRAC[round(a - Math.trunc(a))];
  const whole = Math.trunc(a);
  const display = frac
    ? (whole ? `${whole}${frac}` : frac)
    : a.toString();
  return unit ? `${display} ${unit}` : display;
}

// Classify a raw pantry row into a (location, tileId) pair. Tries
// the item's explicit placement first (row.location + row.tileId,
// set by Kitchen when the user dragged the card into a specific
// tile), falls back to the location-specific classifier that
// Kitchen itself uses so items without explicit placement land in
// the same tile the classic UI would put them in. Returns
// `{ location, tileId }` with sensible defaults when both paths
// give up ("pantry" / "misc").
export function classifyItem(raw) {
  if (!raw) return { location: "pantry", tileId: "misc" };
  // Explicit user placement wins.
  const location = raw.location || defaultLocationForCategory(raw.category);
  if (raw.tileId) return { location, tileId: raw.tileId };
  // Otherwise re-run the classic Kitchen classifier for this location.
  const loc = LOCATIONS.find(l => l.id === location);
  if (!loc) return { location: "pantry", tileId: "misc" };
  const tileId = loc.classify(raw, CLASSIFIER_HELPERS) || "misc";
  return { location, tileId };
}

// Coarse default — the app has a full `defaultLocationForCategory`
// helper elsewhere, but for the purposes of the tile grid we only
// need a best-guess when the row doesn't carry an explicit
// location. Matches the reserved-word defaults in CLAUDE.md.
// Looks up the canonical's freshness window for the given
// location, distinguishing sealed vs. opened state. The data
// lives in INGREDIENT_INFO (a separate map from the bundled
// INGREDIENTS array), so we go through getIngredientInfo()
// which merges the JS map, subcategory fallback, and any
// dbOverride from useIngredientInfo. Without this indirection
// findIngredient(id).storage is undefined for every bundled
// canonical and the auto-expiration silently dies.
//
// Pass an optional dbOverride (from useIngredientInfo's
// getInfo) so DB-approved enrichment overrides bundled.
export function shelfLifeFor(canonicalId, location, { opened = false, dbOverride = null } = {}) {
  if (!canonicalId) return null;
  const ing = findIngredient(canonicalId);
  const info = getIngredientInfo(ing, dbOverride);
  const storage = info?.storage;
  if (!storage) return null;
  if (opened) {
    const op = storage.shelfLifeOpened;
    const days = op?.[location];
    return Number.isFinite(days) ? days : null;
  }
  const sealed = storage.shelfLife?.[location];
  if (Number.isFinite(sealed)) return sealed;
  const flat = storage.shelfLifeDays;
  return Number.isFinite(flat) ? flat : null;
}

export function defaultLocationForCategory(category) {
  if (!category) return "pantry";
  const c = String(category).toLowerCase();
  if (["dairy", "produce", "meat", "seafood", "drinks", "condiments", "herbs", "bread", "leftovers"].includes(c)) return "fridge";
  if (c.startsWith("frozen")) return "freezer";
  return "pantry";
}

// Coarse default — when the user picks Fridge / Pantry /
// Freezer in the add form, infer a category bucket so the
// classifier can tile the row. Mirrors defaultLocationForCategory
// in reverse (the inverse mapping). User can re-tile after the
// row lands via the existing edit flow.
export function defaultCategoryForLocation(location) {
  if (location === "freezer") return "frozen";
  if (location === "pantry")  return "pantry";
  return "dairy"; // most-likely fridge default; user re-tiles via edit
}

// Build the displayed item title from its identity components.
// CLAUDE.md identity-hierarchy rule: the HEADER is DERIVED, not
// free-text — `[Brand] [State] [Canonical] [Cut]` when those are
// set, falling back to canonical alone, falling back to
// raw.name only for free-text / pre-canonical rows. Including
// state and cut here so a row like (state="ground", canonical=
// beef, cut=chuck) reads as "Ground Beef Chuck" instead of
// whatever the user happened to type into the scan flow.
//
// Empty pieces are skipped, so a brand-less ground-chuck row
// reads "Ground Beef Chuck" without leading whitespace, and a
// row that's only a canonical reads as just the canonical name.
export function buildDisplayName(raw) {
  if (!raw) return "Untitled";
  const ing = raw.canonicalId ? findIngredient(raw.canonicalId) : null;
  // Free-text fallback: nothing canonical to derive against, so
  // honor the row's typed name (or "Untitled" if even that's empty).
  if (!ing) return raw.name?.trim() || "Untitled";
  const stateText = raw.state ? (STATE_LABELS[raw.state] || raw.state) : null;
  const cutText   = raw.cut   ? cutLabel(raw.cut)                       : null;
  const parts = [
    raw.brand?.trim()  || null,
    stateText          || null,
    ing.name           || null,
    cutText            || null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : (raw.name?.trim() || "Untitled");
}

// Pull display claims off a raw pantry row. Source order:
//   1. raw.attributes.claims  (legacy ItemCard write path —
//      the curated user-facing claim list)
//   2. raw.claims             (newer scan-write shape)
//   3. raw.scanDebug.memoryBook.claims (AI-photo passthrough)
// Returns a deduped string array; empty when nothing surfaces.
export function getItemClaims(raw) {
  if (!raw) return [];
  const candidates = [];
  if (Array.isArray(raw.attributes?.claims)) candidates.push(...raw.attributes.claims);
  if (Array.isArray(raw.claims)) candidates.push(...raw.claims);
  const mb = raw.scanDebug?.memoryBook?.claims;
  if (Array.isArray(mb)) candidates.push(...mb);
  // Dedupe while preserving order.
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const t = typeof c === "string" ? c.trim() : "";
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// Map a raw pantry row (from usePantry) OR a demo row into the
// card shape the KitchenCard renderer expects. Detects by whether
// `.qty` is pre-baked (demo) vs. derived from `.amount` / `.unit`
// (real). Keeps the downstream card component dumb — it sees
// ONE shape regardless of source. Also stamps `_location` +
// `_tileId` so the tile-first grouping layer can bucket the card
// without re-classifying on every render.
export function toCard(raw) {
  if (raw == null) return null;
  // Demo row — already in card shape. Stamp a synthetic
  // (location, tileId) so Showcase's tile view looks populated.
  if (typeof raw.qty === "string" && typeof raw.cat === "string") {
    const fallback = DEMO_CAT_MAP[raw.cat] || { location: "pantry", tileId: "misc" };
    return { ...raw, _location: fallback.location, _tileId: fallback.tileId };
  }
  // Real pantry row — derive card fields + classify into tile.
  const { location: _location, tileId: _tileId } = classifyItem(raw);
  const days = daysUntil(raw.expiresAt);
  const status = days != null && days <= 3 ? "warn" : "ok";
  const cat = raw.category || "pantry";
  const location = CATEGORY_LABELS[cat] || (cat[0]?.toUpperCase() + cat.slice(1)) || "Pantry";
  // Food-type label for the per-item category pill. Resolves the
  // typeId (WWEIA wweia_cheese / wweia_yogurt / etc.) to its
  // human label ("Cheese", "Yogurt"). Falls back to the broad
  // category ("Dairy") when the item has no typeId set; null
  // when even that's missing so the pill simply hides.
  const foodTypeLabel = findFoodType(raw.typeId)?.label
    || (raw.category ? raw.category[0].toUpperCase() + raw.category.slice(1) : null);
  return {
    id:       raw.id,
    emoji:    raw.emoji || "🍽️",
    // Display name is derived from identity components per the
    // CLAUDE.md hierarchy rule, so a typo'd raw.name doesn't
    // fossilize as the visible title once the canonical lands.
    name:     buildDisplayName(raw),
    rawName:  raw.name || null,
    cut:      raw.cut || null,
    state:    raw.state || null,
    claims:   getItemClaims(raw),
    qty:      formatQty(raw.amount, raw.unit),
    // Raw amount + max for the fill gauge — mirrors classic
    // Kitchen's pct() helper. Cards use these to render the
    // sealed/opened bar; `qty` keeps the human-friendly
    // formatted string for the subheader row.
    amount:   raw.amount != null ? Number(raw.amount) : null,
    max:      raw.max    != null ? Number(raw.max)    : null,
    unit:     raw.unit   || null,
    // Canonical id flows through so KitchenCard can read the
    // canonical's nutrition data via useIngredientInfo / the
    // bundled INGREDIENTS registry. Lets the card surface
    // calories without re-running classification.
    canonicalId: raw.canonicalId || null,
    brand:    raw.brand || null,
    location,
    cat,
    status,
    days,
    typeLabel: foodTypeLabel,
    // Timestamps used for sort orderings in the drilled view.
    // `purchasedAt` may be null for manual-add rows that never
    // went through the scan flow; sort falls back to createdAt
    // semantics when present.
    purchasedAt: raw.purchasedAt || null,
    // Keep the raw row around so onOpenItem can hand it back to
    // the caller (App.jsx wants to open ItemCard with the full
    // pantry row, not the trimmed card shape).
    _raw: raw,
    _location,
    _tileId,
  };
}

// Sum all items across a location's tiles. `locBuckets` is
// `{ tileId: card[] }` or undefined; returns 0 for undefined so
// empty locations drop out of the breakdown naturally.
export function sumLocationTiles(locBuckets) {
  if (!locBuckets) return 0;
  let n = 0;
  for (const tileId of Object.keys(locBuckets)) n += locBuckets[tileId].length;
  return n;
}

// Sort a list of card-shape items by one of three orderings.
// "expiring"  — ascending days-to-expire, with null-days (shelf
//               stable) and missing dates bucketed at the end.
//               Warn items cluster at the top of the view.
// "name"      — case-insensitive alpha by display name.
// "recent"    — descending purchasedAt; rows without a stamp
//               (manual-add legacy) bucket at the end.
export function sortItems(items, sortBy) {
  const arr = items.slice();
  if (sortBy === "name") {
    arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return arr;
  }
  if (sortBy === "recent") {
    arr.sort((a, b) => {
      const ta = a.purchasedAt ? +new Date(a.purchasedAt) : 0;
      const tb = b.purchasedAt ? +new Date(b.purchasedAt) : 0;
      return tb - ta;
    });
    return arr;
  }
  // Default — "expiring" — days ascending, nulls last.
  arr.sort((a, b) => {
    const da = a.days == null ? Number.POSITIVE_INFINITY : a.days;
    const db = b.days == null ? Number.POSITIVE_INFINITY : b.days;
    return da - db;
  });
  return arr;
}

// Given a list of cards, pick the single most urgent warn item.
// Tie-breaker: the earliest expiry date (smallest days), then the
// first in pantry order. Null when no cards warn.
export function firstExpiring(cards) {
  let best = null;
  for (const c of cards) {
    if (c.status !== "warn") continue;
    if (best == null) { best = c; continue; }
    const bd = best.days == null ? Number.POSITIVE_INFINITY : best.days;
    const cd = c.days    == null ? Number.POSITIVE_INFINITY : c.days;
    if (cd < bd) best = c;
  }
  return best;
}

// Compact chip for the days-to-expire corner. Demo items always
// carry a number; real items whose `expiresAt` is null (shelf-
// stable pantry goods like olive oil) get a `days = null` from
// the adapter and render with an empty chip so the card doesn't
// lie about a spoilage clock.
export function formatDaysChip(days) {
  if (days == null) return "";
  if (days < 0) return "gone";
  if (days === 0) return "today";
  return `${days}d`;
}

// True when the item was purchased in the last 24 hours — used
// to flag rows with a small "NEW" chip on the card so recent
// grocery runs are visible at a glance. Demo rows and manual
// adds without a purchasedAt stamp return false (the chip
// wouldn't be meaningful for them).
export function isRecent(item) {
  const p = item?.purchasedAt;
  if (!p) return false;
  const d = p instanceof Date ? p : new Date(p);
  if (Number.isNaN(d.getTime())) return false;
  return (Date.now() - d.getTime()) < 24 * 3600 * 1000;
}

// Urgency-tiered color for the days chip. Thresholds match the
// warn-card threshold (≤3) so the chip color and the card's
// warn wash flip on the same row. Plan-ahead window is 4–7 days;
// past that the chip fades back to the normal muted ink so
// long-life items don't perpetually draw attention. Null days
// (shelf-stable) use the muted default — no date, no urgency.
export function daysChipColor(days, theme) {
  if (days == null) return theme.color.inkMuted;
  if (days < 0 || days <= 3) return theme.color.burnt;     // warn
  if (days <= 7) return theme.color.mustard;               // plan-ahead
  return theme.color.inkMuted;                             // plenty
}
