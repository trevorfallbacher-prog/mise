// Pantry screen — the entry point for the MCM cooking-app experiment.
// Warm parchment backdrop, glass search + filter bar, 2-column grid
// of glass item cards. Each card shows: emoji icon, name (serif),
// quantity (mono), location pill, teal status dot.
//
// Accepts either a real pantry array (from App.jsx `usePantry`) or
// falls back to the hardcoded DEMO_ITEMS when rendered standalone
// (Showcase.jsx). `items` is detected by shape — real pantry rows
// carry `.amount` / `.unit` / `.expiresAt`; demo rows pre-baked
// `.qty` / `.days` / `.status`. The adapter below normalizes both
// into the card's render shape so the visual layer doesn't care
// which source it got.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, LayoutGroup, useMotionValue, useAnimation, useTransform } from "framer-motion";
import {
  WarmBackdrop, GlassPanel, PrimaryButton,
  StatusDot, Kicker, SerifHeader, FadeIn, Starburst,
  GlassPill, TintedPill, BottomDock, BackChip,
  statusTintOverlay, withAlpha,
} from "./primitives";
import { useTheme, THEME_TRANSITION } from "./theme";
import { font, radius } from "./tokens";

// Tile system — re-using the exact same classifier the classic
// Kitchen tile view uses, so an item that lives under "Dairy & Eggs"
// in the old UI lives in the SAME tile here. Location axis (fridge
// / pantry / freezer) sits above the tile axis per CLAUDE.md.
import { FRIDGE_TILES,  tileIdForItem          as fridgeTileFor  } from "../../lib/fridgeTiles";
import { PANTRY_TILES,  pantryTileIdForItem    as pantryTileFor  } from "../../lib/pantryTiles";
import { FREEZER_TILES, freezerTileIdForItem   as freezerTileFor } from "../../lib/freezerTiles";
import {
  findIngredient, hubForIngredient, INGREDIENTS,
  inferCanonicalFromName, dbCanonicalsSnapshot,
} from "../../data/ingredients";
import { useIngredientInfo } from "../../lib/useIngredientInfo";
import { usePopularPackages } from "../../lib/usePopularPackages";
import { findFoodType, FOOD_TYPES, inferFoodTypeFromName } from "../../data/foodTypes";
import { tagHintsToAxes } from "../../lib/tagHintsToAxes";
import { lookupBarcode } from "../../lib/lookupBarcode";
import { parsePackageSize } from "../../lib/canonicalResolver";
import BarcodeScanner from "../../components/BarcodeScanner";
import { rememberBarcodeCorrection, findBarcodeCorrection } from "../../lib/barcodeCorrections";
import { useBrandNutrition } from "../../lib/useBrandNutrition";
import { canonicalImageUrlFor, tileIconFor } from "../../lib/canonicalIcons";

const CLASSIFIER_HELPERS = { findIngredient, hubForIngredient };

// The three locations in top-to-bottom kitchen order. Each carries
// the tile manifest + the classifier that maps items to tiles
// within it. Order here is the order the floating dock renders
// segments in. Emoji icons removed — the dock uses solid color
// swatch dots (LOCATION_DOT below) instead per the MCM direction:
// dark blue = fridge, orange = pantry, icy blue = freezer.
const LOCATIONS = [
  { id: "fridge",  label: "Fridge",  tiles: FRIDGE_TILES,  classify: fridgeTileFor  },
  { id: "pantry",  label: "Pantry",  tiles: PANTRY_TILES,  classify: pantryTileFor  },
  { id: "freezer", label: "Freezer", tiles: FREEZER_TILES, classify: freezerTileFor },
];

// Fallback unit options for the package-size picker when no
// canonical is pinned (or the canonical declares no `units`
// array). Once a canonical is picked we switch to that
// canonical's own units so butter shows sticks / tbsp / cup
// instead of generic "count".
const DEFAULT_UNIT_OPTIONS = [
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
const DEMO_CAT_MAP = {
  dairy:   { location: "fridge", tileId: "dairy"        },
  produce: { location: "fridge", tileId: "produce"      },
  meat:    { location: "fridge", tileId: "meat_poultry" },
  pantry:  { location: "pantry", tileId: "pasta_grains" },
};

// Hardcoded demo items — only used when PantryScreen is rendered
// standalone (Showcase.jsx) without an `items` prop. Kept so the
// design-reference surface keeps working untouched.
const DEMO_ITEMS = [
  { id: 1, emoji: "🧈", name: "Kerrygold Butter",    qty: "1 stick",    location: "Dairy & Eggs",    cat: "dairy",   status: "ok",      days: 12 },
  { id: 2, emoji: "🥚", name: "Pasture Eggs",         qty: "8 large",    location: "Dairy & Eggs",    cat: "dairy",   status: "ok",      days: 18 },
  { id: 3, emoji: "🥛", name: "Whole Milk",           qty: "½ gallon",   location: "Dairy & Eggs",    cat: "dairy",   status: "warn",    days: 3 },
  { id: 4, emoji: "🧀", name: "Gruyère",              qty: "6 oz",       location: "Dairy & Eggs",    cat: "dairy",   status: "ok",      days: 22 },
  { id: 5, emoji: "🍋", name: "Meyer Lemons",         qty: "4 whole",    location: "Produce",         cat: "produce", status: "ok",      days: 9 },
  { id: 6, emoji: "🧄", name: "Garlic",               qty: "1 head",     location: "Produce",         cat: "produce", status: "ok",      days: 30 },
  { id: 7, emoji: "🥬", name: "Tuscan Kale",          qty: "1 bunch",    location: "Produce",         cat: "produce", status: "warn",    days: 2 },
  { id: 8, emoji: "🍅", name: "San Marzano",          qty: "28 oz can",  location: "Pantry",          cat: "pantry",  status: "ok",      days: 180 },
  { id: 9, emoji: "🍞", name: "Sourdough Loaf",       qty: "1 loaf",     location: "Pantry",          cat: "pantry",  status: "ok",      days: 5 },
  { id:10, emoji: "🫒", name: "Olive Oil",            qty: "500 ml",     location: "Pantry",          cat: "pantry",  status: "ok",      days: 120 },
  { id:11, emoji: "🐟", name: "Wild Salmon",          qty: "0.75 lb",    location: "Meat & Seafood",  cat: "meat",    status: "warn",    days: 1 },
  { id:12, emoji: "🍗", name: "Chicken Thighs",       qty: "1.5 lb",     location: "Meat & Seafood",  cat: "meat",    status: "ok",      days: 3 },
];

// Pretty label for the STORED IN pill — maps Kitchen's category
// strings to the tile-ish names the MCM card pill expects. Real
// items carry `category` as dairy/produce/meat/pantry/etc. (see
// `usePantry.js` fromDb mapping). Demo items already have the
// human-readable string baked into `location`, so that path
// short-circuits.
const CATEGORY_LABELS = {
  dairy:     "Dairy & Eggs",
  produce:   "Produce",
  meat:      "Meat & Seafood",
  pantry:    "Pantry",
  freezer:   "Freezer",
  drinks:    "Drinks",
  condiments:"Condiments",
  baking:    "Baking",
};

// Days between `date` and today, rounded. Negative → already
// expired. Null input → null (no chip shown). Uses midnight-to-
// midnight arithmetic so a card purchased today doesn't read
// "23h left" — it reads "3d" like the user expects.
function daysUntil(date) {
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
function formatQty(amount, unit) {
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
function classifyItem(raw) {
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
function defaultLocationForCategory(category) {
  if (!category) return "pantry";
  const c = String(category).toLowerCase();
  if (["dairy", "produce", "meat", "seafood", "drinks", "condiments", "herbs", "bread", "leftovers"].includes(c)) return "fridge";
  if (c.startsWith("frozen")) return "freezer";
  return "pantry";
}

// Map a raw pantry row (from usePantry) OR a demo row into the
// card shape the PantryCard renderer expects. Detects by whether
// `.qty` is pre-baked (demo) vs. derived from `.amount` / `.unit`
// (real). Keeps the downstream card component dumb — it sees
// ONE shape regardless of source. Also stamps `_location` +
// `_tileId` so the tile-first grouping layer can bucket the card
// without re-classifying on every render.
function toCard(raw) {
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
    name:     raw.name || "Untitled",
    qty:      formatQty(raw.amount, raw.unit),
    // Raw amount + max for the fill gauge — mirrors classic
    // Kitchen's pct() helper. Cards use these to render the
    // sealed/opened bar; `qty` keeps the human-friendly
    // formatted string for the subheader row.
    amount:   raw.amount != null ? Number(raw.amount) : null,
    max:      raw.max    != null ? Number(raw.max)    : null,
    unit:     raw.unit   || null,
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

export default function PantryScreen({
  items,
  // When true, the pantry is still fetching from Supabase on cold
  // mount. Shows a skeleton state instead of the empty-shelf copy
  // so the user doesn't see "Empty shelf. Time for a grocery run."
  // flash on a pantry they know has items — just a brief ghost grid
  // while the initial query resolves.
  loading = false,
  onOpenItem,
  onStartCooking,
  onOpenUnitPicker,
  // Shopping-cart bridge. When provided, renders a cart button in
  // the hero's top-right corner that calls back to App.jsx to
  // switch pantryView → "shopping" (which falls through to the
  // classic Kitchen shopping list view). shoppingCount drives an
  // optional count badge on the cart. Both undefined = no button
  // (keeps Showcase clean).
  onGoToShopping,
  shoppingCount = 0,
// Receipts bridge — onOpenReceipts callback + current-month
  // spend in cents. When wired, the hero top-right shows a
  // spend chip + receipt button alongside the cart. Both
  // undefined in Showcase.
  onOpenReceipts,
  spendCents = 0,
  // Swipe-to-remove handler — called with the raw pantry row
  // when the user swipes a card open and confirms the Remove
  // action. App.jsx wires this to setPantry filter; Showcase
  // leaves it undefined (no remove action shown).
  onRemoveItem,
  // Manual / scan add — called when the "+" button is tapped.
  // App.jsx wires this to mount the MCMAddDraftSheet overlay.
  // Showcase leaves undefined.
  onOpenAdd,
  hideDock = false,
}) {
  const { theme } = useTheme();
  // Three-level navigation mirroring the classic Kitchen:
  //   locationTab  — fridge / pantry / freezer
  //   drilledTile  — which tile inside that location is expanded
  //                  (null = show the tile grid, set = show items)
  //   query        — when typed, bypasses the hierarchy and shows
  //                  matching items globally (cross-location) so a
  //                  search for "butter" surfaces both the fridge
  //                  stick AND the frozen cultured butter block
  //                  without the user having to guess which tab.
  const [locationTab, setLocationTab] = useState("fridge");
  const [drilledTile, setDrilledTile] = useState(null);
  const [query, setQuery] = useState("");
  // Sort order for the drilled-tile items grid. Defaults to
  // "expiring" which surfaces whichever warn items are in this
  // tile at the top — the most useful default for a triage-
  // oriented pantry. Not applied to search results (those stay
  // in the pantry row's native order so the user sees relevance,
  // not an arbitrary sort).
  const [sortBy, setSortBy] = useState("expiring");
  // Category filter inside a drilled tile. null = no filter
  // (all items in the tile shown). String value = a typeLabel
  // (e.g. "Cheese") that matches each card's `typeLabel`.
  // Resets when the user changes drilled tile, switches
  // location, or starts searching.
  const [categoryFilter, setCategoryFilter] = useState(null);
  // Single source of truth for which item card has its swipe-
  // to-remove drawer open. iOS pattern — only one card can be
  // open at a time. When user swipes another card, the previous
  // one auto-closes via the prop cascade in PantryCard. null
  // means none open.
  const [openSwipeId, setOpenSwipeId] = useState(null);
  // Tracks whether the search input has keyboard focus so the
  // surrounding GlassPanel can show a focus ring. The panel's
  // own border transitions to a warm teal accent when focused —
  // subtler than a browser default outline, stronger than
  // nothing.
  const [searchFocused, setSearchFocused] = useState(false);
  // Scroll-scrim state. True when the user has scrolled past
  // the hero enough that the sticky nav bar needs a drop shadow
  // to visually lift off the scroll body below — otherwise it
  // feels welded to the content, or worse, looks like a render
  // bug when the content scrolls "through" the bar without any
  // separation cue.
  const [scrolled, setScrolled] = useState(false);
  // Sentinel ref — an empty div right above the sticky bar.
  // IntersectionObserver watches it: when the sentinel is out
  // of view, the user has scrolled past the hero and the bar
  // should raise its shadow; when it's back in view, the bar
  // resets to flat. IO is cheap and never runs handlers on
  // animation frames, so this is scroll-lockstep but doesn't
  // block the main thread.
  const sentinelRef = useRef(null);
  // Ref to the search input so the "/" keyboard shortcut can
  // focus it without the user having to click the field.
  const searchInputRef = useRef(null);

  // Global keyboard shortcuts for the pantry screen:
  //   "/"   — focus the search input (the same shortcut Gmail,
  //           GitHub, Slack, and every search-first surface
  //           uses; users who try it find it working without
  //           a hint).
  //   Esc   — pop out one level of nav: close search first,
  //           otherwise back out of a drilled tile.
  // Ignored when the user is already typing in an input /
  // textarea / contenteditable, so the "/" key in a field
  // types a slash like it should.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { rootMargin: "-1px 0px 0px 0px", threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  // Scroll to the top on drill IN / OUT and on search start/end
  // so the user isn't disoriented by landing mid-page after the
  // body swap. Runs only on transitions (prev → curr compare),
  // not every re-render. Smooth behavior by default, respects
  // `prefers-reduced-motion` via matchMedia.
  const prevDrilledRef = useRef(null);
  const prevQueryActiveRef = useRef(false);
  useEffect(() => {
    const prev = prevDrilledRef.current;
    const curr = drilledTile?.id || null;
    const queryActive = query.length > 0;
    const queryActiveChanged = prevQueryActiveRef.current !== queryActive;
    if (prev !== curr || queryActiveChanged) {
      const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    }
    prevDrilledRef.current = curr;
    prevQueryActiveRef.current = queryActive;
  }, [drilledTile, query]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        if (query) { setQuery(""); searchInputRef.current?.blur(); return; }
        if (drilledTile) { setDrilledTile(null); return; }
      }
      // Number shortcuts 1/2/3 — jump between the three locations
      // without lifting hands off the keyboard. Maps to the same
      // LOCATIONS order rendered in the floating dock. Ignored
      // while typing so digits still enter a search field. Also
      // resets drilledTile so the user lands back at the tile
      // grid of the picked location (same behavior as tapping a
      // dock segment).
      if (!isTyping && (e.key === "1" || e.key === "2" || e.key === "3")) {
        const idx = Number(e.key) - 1;
        const loc = LOCATIONS[idx];
        if (loc) {
          e.preventDefault();
          switchLocation(loc.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, drilledTile]);

  // Normalize once — everything downstream reads from `cards`.
  const cards = useMemo(
    () => (items ?? DEMO_ITEMS).map(toCard).filter(Boolean),
    [items]
  );

  // Bucket cards by (location, tileId). Rebuilds only when the
  // pantry itself changes — not on every tab flip — so tapping
  // between Fridge / Pantry / Freezer is an instant re-read.
  const cardsByLocTile = useMemo(() => {
    const map = {};
    for (const card of cards) {
      const locKey = card._location || "pantry";
      const tileKey = card._tileId || "misc";
      if (!map[locKey]) map[locKey] = {};
      if (!map[locKey][tileKey]) map[locKey][tileKey] = [];
      map[locKey][tileKey].push(card);
    }
    return map;
  }, [cards]);

  // Active location manifest — tile array + classifier + label.
  const activeLocation = useMemo(
    () => LOCATIONS.find(l => l.id === locationTab) || LOCATIONS[0],
    [locationTab]
  );

  // Search bypasses the tile hierarchy — show matching items
  // from anywhere so the user doesn't have to remember which
  // tile their grocery-run brand ended up in.
  const searchHits = useMemo(() => {
    if (!query) return null;
    const q = query.toLowerCase();
    return cards.filter(it => it.name.toLowerCase().includes(q));
  }, [cards, query]);

  const goodCount = cards.filter((i) => i.status === "ok").length;
  // Items visible in the current tile drill-down — derived lazily
  // so the grid can reuse the same PantryCard renderer that the
  // flat version used. When no tile drilled, `visible` is unused
  // (tile grid renders instead). Drilled items run through the
  // sort selector; search hits keep the pantry's native order so
  // a user searching "butter" sees results in whatever order they
  // were added (proxy for relevance — recent scans near the top).
  const visible = useMemo(() => {
    if (searchHits) return searchHits;
    if (!drilledTile) return [];
    let items = cardsByLocTile[locationTab]?.[drilledTile.id] || [];
    // Optional category filter — when set, keep only items whose
    // typeLabel matches. Null/missing typeLabel never matches a
    // filter, so unspecified items drop out cleanly.
    if (categoryFilter) {
      items = items.filter(it => it.typeLabel === categoryFilter);
    }
    return sortItems(items, sortBy);
  }, [searchHits, drilledTile, cardsByLocTile, locationTab, sortBy, categoryFilter]);

  // Categories present in the current drilled tile, with counts.
  // Used to render the CategoryFilter pill row above the items
  // grid. Recomputed when the drilled tile or its items change.
  const categoryOptions = useMemo(() => {
    if (!drilledTile) return [];
    const items = cardsByLocTile[locationTab]?.[drilledTile.id] || [];
    const counts = new Map();
    for (const it of items) {
      if (!it.typeLabel) continue;
      counts.set(it.typeLabel, (counts.get(it.typeLabel) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
  }, [drilledTile, cardsByLocTile, locationTab]);

  // Switching location while drilled = bail to the tile grid of
  // the new location. Same behavior as classic Kitchen.
  const switchLocation = (id) => {
    setLocationTab(id);
    setDrilledTile(null);
    setCategoryFilter(null);
  };

  // Reset the category filter whenever the drilled tile changes
  // (different tile = different categories) or when search
  // activates (search bypasses the per-tile filter axis).
  useEffect(() => {
    setCategoryFilter(null);
  }, [drilledTile, query]);

  // Per-tile warn count — how many items in each tile are
  // expiring soon. Renders as a small burnt-orange dot on the
  // tile card so the user can triage at a glance without drilling
  // in. Keyed by `${location}:${tileId}` so two locations with a
  // same-id tile (fridge "misc" vs pantry "misc") don't collide.
  const warnCountByTile = useMemo(() => {
    const map = {};
    for (const loc of Object.keys(cardsByLocTile)) {
      for (const tileId of Object.keys(cardsByLocTile[loc])) {
        const n = cardsByLocTile[loc][tileId].filter(c => c.status === "warn").length;
        if (n > 0) map[`${loc}:${tileId}`] = n;
      }
    }
    return map;
  }, [cardsByLocTile]);

  // Live clock for the kicker. Ticks once a minute — no need to
  // re-render every second for a "TUESDAY · 4:12 PM" readout,
  // the minute edge is the visible resolution. Initial value is
  // `new Date()` so the first paint shows the correct time, no
  // hardcoded fallback.
  const now = useNow();
  const warnCount = cards.length - goodCount;

  return (
    <div style={{
      position: "relative",
      minHeight: "100vh",
      // NOTE: no `overflow: hidden` here even though it was the
      // original default. An overflow-clip ancestor kills
      // position:sticky inside — and we want the search + location
      // tabs to stick at the top when the user scrolls through a
      // long tile. WarmBackdrop has its own `overflow: hidden` on
      // its absolute-positioned shell, so backdrop blobs are still
      // contained; this just lets the content stack breathe.
    }}>
      {/* Global focus ring for keyboard navigation. One CSS rule
          covers every custom-styled button that opts in via
          `className="mcm-focusable"` (SortSelector pills, the
          drilled back button, location tabs). `:focus-visible`
          means it only appears for keyboard focus, not mouse
          clicks — so sighted users never see an outline they
          don't need, but keyboard users always know where they
          are. `currentColor` inherits the button's text color so
          the ring tints correctly across theme variants without
          a second token lookup. */}
      <style>{`
        .mcm-focusable { outline: none; }
        .mcm-focusable:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 2px;
          border-radius: inherit;
        }
        @keyframes mcm-skeleton-pulse {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 0.65; }
        }
        /* Dust-mote drift — three soft specks float slowly across
           the pantry backdrop in different arcs. Adds a sense of
           "this is a real room, air moves in it" without any of
           the processing cost of a canvas/particle system. Each
           mote uses a different keyframe + duration so they never
           sync up and read as an animation loop. The motes are
           parked at 12% opacity on warm tokens so they blend into
           whatever time-of-day backdrop is underneath. */
        @keyframes mcm-mote-0 {
          0%   { transform: translate(0, 0);     opacity: 0; }
          15%  { opacity: 1; }
          50%  { transform: translate(30vw, -18vh); opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translate(60vw, 4vh);  opacity: 0; }
        }
        @keyframes mcm-mote-1 {
          0%   { transform: translate(0, 0);     opacity: 0; }
          20%  { opacity: 1; }
          55%  { transform: translate(-22vw, 28vh); opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translate(-44vw, -6vh); opacity: 0; }
        }
        @keyframes mcm-mote-2 {
          0%   { transform: translate(0, 0);     opacity: 0; }
          25%  { opacity: 1; }
          60%  { transform: translate(18vw, 32vh); opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translate(-10vw, 60vh); opacity: 0; }
        }
        /* On very narrow phones (<420px) hide the tile blurb and
           tighten the card's vertical gap. The tile label + count
           carry enough information at that size; the blurb is
           secondary and eats ~16px of vertical space per card,
           which is 160+px over 10 tiles — meaningful on a short
           iPhone mini viewport. */
        @media (max-width: 420px) {
          .mcm-tile-blurb { display: none !important; }
        }
      `}</style>
      <WarmBackdrop />

      {/* Dust motes — three tiny circular dots that drift across
          the viewport on independent arc keyframes. Placed
          ABOVE WarmBackdrop but below the content wrapper so
          they float behind the glass cards. aria-hidden because
          they're purely ambient; screen readers should ignore
          them. Long durations (30–48s) so motion is subliminal,
          not distracting. */}
      <div aria-hidden style={{
        position: "absolute", inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 1,
      }}>
        <span style={{
          position: "absolute", top: "18%", left: "8%",
          width: 4, height: 4, borderRadius: "50%",
          background: withAlpha(theme.color.skyInkMuted, 0.35),
          filter: "blur(0.5px)",
          animation: "mcm-mote-0 36s linear infinite",
        }} />
        <span style={{
          position: "absolute", top: "42%", left: "72%",
          width: 3, height: 3, borderRadius: "50%",
          background: withAlpha(theme.color.skyInkMuted, 0.30),
          filter: "blur(0.5px)",
          animation: "mcm-mote-1 44s linear infinite",
          animationDelay: "-12s",
        }} />
        <span style={{
          position: "absolute", top: "65%", left: "30%",
          width: 5, height: 5, borderRadius: "50%",
          background: withAlpha(theme.color.skyInkMuted, 0.25),
          filter: "blur(0.8px)",
          animation: "mcm-mote-2 48s linear infinite",
          animationDelay: "-24s",
        }} />
      </div>

      <div style={{
        // Content column. On phones (≤640 CSS px) this is the full
        // viewport minus 40px of gutter — the original mobile
        // prototype look. On desktop the column widens up to 960px
        // so the hero + grid don't feel "phone-zoomed-in" in a
        // laptop browser (the original 480px cap read as 2 huge
        // cards on a 1200px window).
        position: "relative",
        maxWidth: "min(960px, 100%)",
        margin: "0 auto",
        // Bottom padding leaves runway so the scroll content
        // never ends up UNDER the FloatingLocationDock (dock sits
        // at bottom: 96, ~44px tall → reserves ~140px at the
        // bottom; the app-level nav below the dock adds ~80px
        // more). 180px total covers both without leaving a huge
        // dead gap when the dock is hidden (search mode).
        padding: "28px 20px 180px",
      }}
      // Tap-anywhere-closes-swipe — when any item card has its
      // swipe drawer open, the next click anywhere in the
      // content wrapper closes it. onClickCapture (NOT onClick)
      // fires during the capture phase, BEFORE any descendant
      // card's own onClick. We stopPropagation so a tap on a
      // different (closed) card doesn't open its editor — just
      // closes the open swipe. Matches iOS Mail's "any tap
      // closes an open row" behavior. The close-button inside
      // the Remove drawer stops propagation itself so its tap
      // still fires the actual delete.
      onClickCapture={(e) => {
        if (openSwipeId) {
          setOpenSwipeId(null);
          e.stopPropagation();
        }
      }}>
        {/* Top-right toolbar cluster — Receipt + Cart only.
            The Add (+) action lives inline with the search bar
            below; keeping Receipt + Cart pinned up here
            preserves the "grounded" hero anchor while freeing
            real estate from competing with the title. */}
        {(onGoToShopping || onOpenReceipts) && (
          <div style={{
            position: "absolute",
            top: 22,
            right: 20,
            zIndex: 4,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
          }}>
            {onOpenReceipts && (
              <ReceiptButton spendCents={spendCents} onClick={onOpenReceipts} />
            )}
            {onGoToShopping && (
              <CartButton count={shoppingCount} onClick={onGoToShopping} />
            )}
          </div>
        )}
        {/* --- Hero — text sits DIRECTLY on the backdrop (no glass
             surface behind it), so it uses theme.color.skyInk /
             skyInkMuted instead of the regular ink. Those tokens
             flip bright on dark-sky themes (dawn/dusk/night) so
             the hero stays legible at every time of day.

             Entrance is choreographed: meta row → header →
             flourish → subtitle, staggered 70ms apart. Reads as
             the pantry "setting up" rather than popping in all at
             once — a small moment that makes first-paint feel
             intentional. */}
        <FadeIn>
          <Kicker tone={theme.color.skyInkMuted}>
            {formatClock(now)}
          </Kicker>
        </FadeIn>

        <FadeIn delay={0.07}>
          <SerifHeader
            size={52}
            style={{
              // Fluid hero — shrinks on narrow viewports (clamped at
              // 36px so it stays expressive on phones) and caps at
              // 52px on desktop. `clamp` overrides the `size` prop's
              // fontSize since style spreads after the size rule
              // inside SerifHeader.
              //
              // Pale Martini display face — custom mid-century
              // hand-drawn typeface self-hosted via @font-face.
              // Single-weight static font (no variable axes) so
              // we use a plain fontWeight rather than fontVariationSettings.
              // SerifHeader's inherited italic + 300 weight gets
              // overridden since the hero wants Pale Martini's
              // own character at full strength.
              marginTop: 4,
              color: theme.color.skyInk,
              fontFamily: font.display,
              fontStyle: "normal",
              fontWeight: 400,
              letterSpacing: "0.035em",
              fontSize: "clamp(40px, 7vw, 64px)",
              lineHeight: 1.0,
            }}
          >
            The Kitchen
          </SerifHeader>
        </FadeIn>

        {/* Conditional hero subtitle. Only renders during loading
            ("Unpacking the shelves…") or on a genuinely empty
            pantry ("Nothing on the shelves yet…"). In the normal
            case (pantry has items, finished loading) the hero
            stays clean — meta chip + title + search — and the
            tile grid carries the information below. */}
        {loading && cards.length === 0 && (
          <FadeIn delay={0.14}>
            <p style={{
              marginTop: 10, fontFamily: font.serif, fontStyle: "italic",
              fontSize: 15, color: theme.color.skyInkMuted, lineHeight: 1.45,
            }}>
              Unpacking the shelves…
            </p>
          </FadeIn>
        )}
        {!loading && cards.length === 0 && (
          <FadeIn delay={0.14}>
            <p style={{
              marginTop: 10, fontFamily: font.serif, fontStyle: "italic",
              fontSize: 15, color: theme.color.skyInkMuted, lineHeight: 1.45,
              maxWidth: 360,
            }}>
              Nothing on the shelves yet.
            </p>
          </FadeIn>
        )}

        {/* Sentinel for the sticky bar's scroll-state detector.
            Sits right above the sticky bar; the IO in the effect
            above flips `scrolled` based on whether this element
            is in view. */}
        <div ref={sentinelRef} style={{ height: 1 }} aria-hidden />

        {/* LayoutGroup wraps the ENTIRE sticky+body region so
            shared layoutIds work across the sticky drilled
            header and the tile cards inside the scrolling body.
            Without this, the tile icon → drilled icon morph
            breaks when the drilled header is stickied — framer
            would scope layoutId matching to the inner body's
            AnimatePresence and miss the header that's now
            siblings-above rather than inline. */}
        <LayoutGroup>

        {/* --- Sticky search + location tabs --------------------------
            Wrapped in a position:sticky shell so the nav stays put
            when the user scrolls through a long tile. Pulls a
            negative margin on the horizontal axis so the blur
            extends edge-to-edge of the content column rather than
            clipping to the padding gutter. zIndex 5 keeps it above
            the tile/item grids but below app-level modals (the
            shared ItemCard overlay at App.jsx renders at a higher
            z). Top offset 0 — sticks flush to the viewport top.
            Backdrop-blur lets the underneath content peek through
            the bar as it scrolls past, signaling "more above."
            Drop shadow fades in once `scrolled` flips so the bar
            visibly lifts off the content below; resets when user
            scrolls back up and the sentinel comes into view. */}
        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          marginLeft: -20,
          marginRight: -20,
          paddingLeft: 20,
          paddingRight: 20,
          paddingBottom: 6,
          backdropFilter: "blur(12px) saturate(140%)",
          WebkitBackdropFilter: "blur(12px) saturate(140%)",
          background: withAlpha(theme.color.cream, 0.35),
          boxShadow: scrolled
            ? "0 8px 20px rgba(30,20,8,0.12), 0 1px 0 rgba(30,20,8,0.06)"
            : "0 0 0 rgba(30,20,8,0)",
          transition: "box-shadow 200ms ease",
        }}>
        <FadeIn delay={0.06}>
          <GlassPanel
            tone="input"
            variant="input"
            padding={14}
            style={{
              marginTop: 20,
              display: "flex", alignItems: "center", gap: 12,
              // Focus ring — border brightens to the theme's teal
              // accent and a subtle halo shadow expands around the
              // panel when the input takes focus. Transitions so
              // focus/blur feels continuous, not a hard toggle.
              border: searchFocused
                ? `1px solid ${theme.color.teal}`
                : undefined,
              boxShadow: searchFocused
                ? `0 0 0 3px ${withAlpha(theme.color.teal, 0.14)}, ${theme.shadow.soft}`
                : undefined,
              transition: "border-color 200ms ease, box-shadow 200ms ease",
            }}
          >
            <SearchGlyph />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search or Add to Kitchen"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: font.sans,
                fontSize: 15,
                color: theme.color.ink,
              }}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="mcm-focusable"
                style={{
                  border: "none", background: "transparent", cursor: "pointer",
                  color: theme.color.inkMuted, fontFamily: font.mono, fontSize: 12,
                }}
              >
                CLEAR
              </button>
            )}
            {/* Inline Add affordance — teal "+" pinned to the
                right edge of the search bar. Same row as the
                search input so the two primary entry points
                (find what's in the kitchen, put something new
                in it) read as one toolbar. Hidden when there's
                a live query so CLEAR has the floor. */}
            {onOpenAdd && !query && (
              <button
                onClick={onOpenAdd}
                aria-label="Add an item to the kitchen"
                title="Add an item"
                className="mcm-focusable"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36, height: 36,
                  borderRadius: 999,
                  border: `1px solid ${withAlpha(theme.color.teal, 0.35)}`,
                  background: withAlpha(theme.color.teal, 0.12),
                  color: theme.color.teal,
                  fontSize: 22, lineHeight: 1, fontWeight: 300,
                  cursor: "pointer",
                  flexShrink: 0,
                  transition: "background 160ms ease, border-color 160ms ease, transform 120ms ease",
                }}
              >
                +
              </button>
            )}
          </GlassPanel>

          {/* Location tabs — Fridge / Pantry / Freezer. Mirrors
              classic Kitchen's storageTab axis but rendered as the
              same GlassPill row the MCM demo used for category
              filters, so the visual shape of the row is preserved.
              Hidden while search is active — when a user types,
              the hierarchy gets bypassed and matching items show
              across all locations. NOTE: the location switcher
              itself moved to a FloatingLocationDock at the bottom
              of the screen (see below), so this block is just the
              search; tabs render elsewhere. */}
        </FadeIn>

        {/* Drilled-tile header lives INSIDE the sticky bar so the
            user keeps back/sort/count within reach at any scroll
            depth inside a long tile. When not drilled, this is
            null — sticky bar collapses back to just search + tabs. */}
        {drilledTile && !query && (
          <FadeIn>
            <DrilledTileHeader
              tile={drilledTile}
              location={locationTab}
              count={visible.length}
              warnCount={warnCountByTile[`${locationTab}:${drilledTile.id}`] || 0}
              sortBy={sortBy}
              onSortChange={setSortBy}
              onBack={() => setDrilledTile(null)}
              categoryOptions={categoryOptions}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
            />
          </FadeIn>
        )}
        </div>

        {/* --- Search summary (which locations did we find hits in?) --
            Drilled-tile header moved INTO the sticky bar above so
            the back button + sort stay reachable during scroll.
            Search summary stays separate (non-sticky) since searches
            don't participate in the tile layout.
            the tapped tile card. Search summary stays up here since
            search doesn't participate in the tile layout. */}
        {/* Search summary only renders when there ARE hits — the
            empty-results case is handled by EmptyState below,
            which already says "Nothing called 'x'" with warmth
            and an ornament. Both rendering at once doubled the
            copy with no extra signal. */}
        {query && visible.length > 0 && (
          <FadeIn>
            <SearchSummary hits={visible} query={query} onClear={() => setQuery("")} />
          </FadeIn>
        )}

        {/* GOOD · SOON meta chip moved from the hero to sit just
            above the tile grid, right-aligned. Keeps the hero
            clean (kicker + title + search + cart) and puts the
            health stats adjacent to the content they summarize.
            Only shows in the default tile-grid view — drilled
            and search modes have their own summary surfaces. */}
        {!query && !drilledTile && !(loading && cards.length === 0) && cards.length > 0 && (
          <FadeIn delay={0.1}>
            <div style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 8,
            }}>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 10px",
                borderRadius: 999,
                background: theme.color.glassFillHeavy,
                border: `1px solid ${theme.color.glassBorder}`,
                backdropFilter: "blur(16px) saturate(150%)",
                WebkitBackdropFilter: "blur(16px) saturate(150%)",
                fontFamily: font.mono,
                fontSize: 10,
                fontWeight: 500,
                color: theme.color.ink,
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                ...THEME_TRANSITION,
              }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <StatusDot tone="ok" size={6} /> {goodCount} good
                </span>
                {warnCount > 0 && (
                  <>
                    <span style={{ opacity: 0.35 }}>·</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: theme.color.burnt }}>
                      <StatusDot tone="warn" size={6} /> {warnCount} soon
                    </span>
                  </>
                )}
              </div>
            </div>
          </FadeIn>
        )}

        {/* --- Body: TILE grid / drilled ITEM grid / SEARCH hits ------- */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={loading && cards.length === 0 ? "skeleton" : query ? "search" : drilledTile ? `drilled-${drilledTile.id}` : `tiles-${locationTab}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {(() => {
              // Show skeleton while Supabase's initial load is in
              // flight and we have no cached items yet. Once a single
              // row arrives the skeleton steps aside — realtime
              // population feels continuous rather than strobing
              // between ghost and real.
              if (loading && cards.length === 0) return <TileGridSkeleton />;
              if (query)       return <ItemGrid items={visible} onOpenItem={onOpenItem} onOpenUnitPicker={onOpenUnitPicker} onRemoveItem={onRemoveItem} openSwipeId={openSwipeId} setOpenSwipeId={setOpenSwipeId} showTileContext />;
              if (drilledTile) return <ItemGrid items={visible} onOpenItem={onOpenItem} onOpenUnitPicker={onOpenUnitPicker} onRemoveItem={onRemoveItem} openSwipeId={openSwipeId} setOpenSwipeId={setOpenSwipeId} />;
              // Whole-location empty state — when the active
              // location has zero items, skip the wall of dimmed
              // tiles and show a warm dedicated message instead.
              // Keeps the user-experience honest ("your freezer
              // is empty") rather than abandoned-looking.
              const locationTotal = sumLocationTiles(cardsByLocTile[locationTab]);
              if (cards.length > 0 && locationTotal === 0) {
                return <LocationEmptyState location={activeLocation} />;
              }
              return (
                <TileGrid
                  location={activeLocation}
                  cardsByTile={cardsByLocTile[locationTab] || {}}
                  warnCountByTile={warnCountByTile}
                  onPickTile={setDrilledTile}
                />
              );
            })()}
          </motion.div>
        </AnimatePresence>
        </LayoutGroup>

        {!loading && ((query && visible.length === 0) || (drilledTile && visible.length === 0)) && (
          <EmptyState
            kind={query ? "no-matches" : "empty-tile"}
            query={query}
            tile={drilledTile}
          />
        )}

        {/* --- Bottom CTA -------------------------------------------
            Two modes here, picked by which props are wired:
              - Showcase / demo mode (onStartCooking provided, no
                onOpenItem): the MCM design-reference Cook CTA
                with the hardcoded "Lemon-butter pasta" preview.
              - Real mode (onOpenItem provided): a triage CTA
                that only appears when there are warn items, and
                tapping it opens the first expiring item in the
                shared ItemCard overlay. Real users care about
                "what needs using" here, not a fake recipe pitch.
            Neither CTA shows while drilled or searching — the
            active flow already has its own focus. */}
        {!drilledTile && !query && onStartCooking && !onOpenItem && (
          <FadeIn delay={0.12}>
            <GlassPanel
              tone="warm"
              padding={18}
              style={{
                marginTop: 28,
                display: "flex", alignItems: "center", gap: 14,
                position: "relative", overflow: "hidden",
              }}
            >
              <Starburst
                size={140}
                color="rgba(217,107,43,0.14)"
                style={{ position: "absolute", top: -40, right: -40 }}
              />
              <div style={{ fontSize: 36, lineHeight: 1 }}>🍳</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Kicker tone={theme.color.burnt}>Ready when you are</Kicker>
                <div style={{
                  fontFamily: font.serif, fontStyle: "italic", fontWeight: 300,
                  fontSize: 20, color: theme.color.ink, marginTop: 2, letterSpacing: "-0.01em",
                }}>
                  Lemon-butter pasta
                </div>
                <div style={{
                  fontFamily: font.sans, fontSize: 12, color: theme.color.inkMuted, marginTop: 2,
                }}>
                  6 of 7 ingredients on hand · 18 min
                </div>
              </div>
              <PrimaryButton onClick={onStartCooking} style={{ padding: "12px 18px", fontSize: 14 }}>
                Cook
              </PrimaryButton>
            </GlassPanel>
          </FadeIn>
        )}

        {!drilledTile && !query && onOpenItem && warnCount > 0 && (
          <TriageCTA
            warnCount={warnCount}
            firstExpiring={firstExpiring(cards)}
            onOpenItem={onOpenItem}
          />
        )}
      </div>

      {!hideDock && (
        <BottomDock
          tabs={NAV_TABS}
          activeId="pantry"
          onSelect={(id) => { if (id === "cook") onStartCooking && onStartCooking(); }}
        />
      )}

      {/* Floating location dock — Fridge / Pantry / Freezer pill
          anchored at the bottom of the viewport. Replaces the
          top-of-screen tabs per the "put the pill at the bottom
          floating" direction. Sits ABOVE any app-level nav bar
          (bottom: 96px gives ~80px of space for a 64-72px nav dock
          below it). Hidden while searching since search bypasses
          the location axis anyway. */}
      {/* AnimatePresence so the dock runs its exit animation
          (slide down + fade) when search activates, then runs
          its entrance (slide up + fade) when search is cleared.
          Without this wrapper the dock just pops in/out. */}
      <AnimatePresence>
        {/* Only show the location dock when MCMPantryScreen is
            embedded in the real app (hideDock=true → the
            internal BottomDock is suppressed, so the location
            dock is the only floating pill at the bottom). In
            Showcase mode the BottomDock is visible as the demo
            app nav; adding FloatingLocationDock there would
            stack two floating pills at the same bottom position. */}
        {!query && hideDock && (
          <FloatingLocationDock
            locations={LOCATIONS}
            active={locationTab}
            onSelect={switchLocation}
            totals={{
              fridge:  sumLocationTiles(cardsByLocTile.fridge),
              pantry:  sumLocationTiles(cardsByLocTile.pantry),
              freezer: sumLocationTiles(cardsByLocTile.freezer),
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Sum all items across a location's tiles. `locBuckets` is
// `{ tileId: card[] }` or undefined; returns 0 for undefined so
// empty locations drop out of the breakdown naturally.
function sumLocationTiles(locBuckets) {
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
function sortItems(items, sortBy) {
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

const NAV_TABS = [
  { id: "pantry", label: "Pantry", glyph: "🥫" },
  { id: "cook",   label: "Cook",   glyph: "🍳" },
  { id: "plan",   label: "Plan",   glyph: "📅" },
  { id: "you",    label: "You",    glyph: "🌿" },
];

// --- Sub-components ------------------------------------------------------

// Shopping-cart button — top-right floating affordance that
// carries the user from pantry-browse into the shopping-list
// view. Absolutely positioned in the PantryScreen content
// wrapper (which is position:relative) so it rides in the upper-
// right regardless of hero content below. 44x44 circular glass
// Receipt button — 60×60 glass pill in the hero top-right
// with the bundled receipt.svg. Optional `spendCents` shows up
// as a small burnt dollar-amount badge pinned to the upper-
// right corner.
function ReceiptButton({ spendCents = 0, onClick }) {
  const { theme } = useTheme();
  const dollars = Math.round(spendCents / 100);
  const formatted = dollars >= 1000
    ? `$${(dollars / 1000).toFixed(1)}k`
    : `$${dollars}`;
  const label = spendCents > 0
    ? `Receipt history · ${formatted} this month`
    : "Receipt history";
  return (
    <motion.button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="mcm-focusable"
      whileHover={{ y: -2, scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{
        position: "relative",
        width: 60, height: 60,
        borderRadius: 999,
        border: `1px solid ${theme.color.glassBorder}`,
        background: theme.color.glassFillHeavy,
        backdropFilter: "blur(14px) saturate(150%)",
        WebkitBackdropFilter: "blur(14px) saturate(150%)",
        boxShadow: theme.shadow.soft,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", padding: 0,
        ...THEME_TRANSITION,
      }}
    >
      <img
        src="/icons/receipt.svg"
        alt="" aria-hidden
        style={{
          width: 38, height: 38, objectFit: "contain",
          filter: "drop-shadow(0 1px 2px rgba(30,30,30,0.12))",
        }}
      />
      {spendCents > 0 && (
        <span style={{
          position: "absolute",
          top: -6, right: -8,
          minWidth: 22, height: 22,
          padding: "0 7px",
          borderRadius: 999,
          background: theme.color.burnt,
          color: theme.color.ctaText,
          fontFamily: font.mono, fontSize: 11, fontWeight: 600,
          letterSpacing: "-0.02em",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 6px rgba(168,73,17,0.35)",
          border: `1px solid ${theme.color.glassBorder}`,
        }}>
          {formatted}
        </span>
      )}
    </motion.button>
  );
}

// Cart button — 60×60 glass pill with the bundled
// shopping_cart.svg. Burnt count badge appears when the
// shopping list has items.
function CartButton({ count = 0, onClick }) {
  const { theme } = useTheme();
  const label = count === 0
    ? "Shopping list"
    : `Shopping list · ${count} item${count === 1 ? "" : "s"}`;
  return (
    <motion.button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="mcm-focusable"
      whileHover={{ y: -2, scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{
        position: "relative",
        width: 60, height: 60,
        borderRadius: 999,
        border: `1px solid ${theme.color.glassBorder}`,
        background: theme.color.glassFillHeavy,
        backdropFilter: "blur(14px) saturate(150%)",
        WebkitBackdropFilter: "blur(14px) saturate(150%)",
        boxShadow: theme.shadow.soft,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", padding: 0,
        ...THEME_TRANSITION,
      }}
    >
      <img
        src="/icons/shopping_cart.svg"
        alt="" aria-hidden
        style={{
          width: 38, height: 38, objectFit: "contain",
          filter: "drop-shadow(0 1px 2px rgba(30,30,30,0.12))",
        }}
      />
      {count > 0 && (
        <span style={{
          position: "absolute",
          top: -4, right: -4,
          minWidth: 22, height: 22,
          padding: "0 6px",
          borderRadius: 999,
          background: theme.color.burnt,
          color: theme.color.ctaText,
          fontFamily: font.mono, fontSize: 11, fontWeight: 600,
          letterSpacing: "-0.02em",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 6px rgba(168,73,17,0.35)",
          border: `1px solid ${theme.color.glassBorder}`,
        }}>
          {count}
        </span>
      )}
    </motion.button>
  );
}

// Triage CTA — the real-mode replacement for the design-demo
// "Cook · Lemon-butter pasta" card. Only renders in real-items
// mode (when onOpenItem is wired) AND only when there are warn
// items to triage. Copy pivots with count: singular / plural /
// "all gone today" flavor. Tap opens the single most-urgent
// item's editor via the same shared overlay the tile cards use.
// When count > 1, the button's label doubles as "see all" and
// we pre-select the FIRST-expiring row — user can close and
// re-open from the pantry to reach the next one, rather than
// the CTA itself becoming a list.
function TriageCTA({ warnCount, firstExpiring, onOpenItem }) {
  const { theme } = useTheme();
  if (!firstExpiring) return null;
  const days = firstExpiring.days;
  const daysCopy = days == null
    ? "now"
    : days < 0
      ? "already past"
      : days === 0
        ? "today"
        : `in ${days} day${days === 1 ? "" : "s"}`;
  const kicker = warnCount === 1 ? "One to use soon" : `${warnCount} to use soon`;
  const body = firstExpiring.name;
  const sub = `Expires ${daysCopy}${firstExpiring.brand ? ` · ${firstExpiring.brand}` : ""}`;
  return (
    <FadeIn delay={0.12}>
      <GlassPanel
        tone="warm"
        padding={18}
        style={{
          marginTop: 28,
          display: "flex", alignItems: "center", gap: 14,
          position: "relative", overflow: "hidden",
        }}
      >
        {/* Left accent rule — a 4px wide burnt strip running the
            full height of the card. Same magazine pull-quote
            cue that says "this side bar has something urgent to
            tell you." Positioned absolute so it hugs the card
            edge regardless of padding; rounds with the panel's
            corner via inherit so it doesn't stick out past the
            rounded-rect shape. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            width: 4,
            background: theme.color.burnt,
            borderTopLeftRadius: "inherit",
            borderBottomLeftRadius: "inherit",
          }}
        />
        <Starburst
          size={140}
          color="rgba(217,107,43,0.14)"
          style={{ position: "absolute", top: -40, right: -40 }}
        />
        {/* Icon slot — prefers the expiring item's own icon /
            emoji (bread loaf for sourdough, chicken for chicken,
            etc.) so the card reads as "THIS is the thing" rather
            than a generic hourglass. Falls back to ⏳ only when
            nothing's resolvable. Marked marginLeft:4 so it
            doesn't sit on the burnt accent rule. */}
        {(() => {
          const raw = firstExpiring?._raw || null;
          const iconUrl = canonicalImageUrlFor(raw?.canonicalId || null, null);
          const emoji = firstExpiring?.emoji || "⏳";
          if (iconUrl) {
            return (
              <img
                src={iconUrl}
                alt=""
                aria-hidden
                style={{
                  width: 44, height: 44, objectFit: "contain",
                  marginLeft: 4,
                  filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
                }}
              />
            );
          }
          return (
            <div style={{
              // 42px so the emoji fallback matches the 44×44 img
              // render visual weight (emoji glyph boxes cap at
              // ~95% of fontSize).
              fontSize: 42, lineHeight: 1, marginLeft: 4,
              filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
            }}>{emoji}</div>
          );
        })()}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Kicker tone={theme.color.burnt}>{kicker}</Kicker>
          <div style={{
            // Pale Martini display face — sits in the same
            // typographic family as the hero + drilled header
            // so the bottom CTA reads as a continuation of the
            // page, not a separate component. Single weight,
            // no variable axes.
            fontFamily: font.display,
            fontWeight: 400,
            fontSize: 20, color: theme.color.ink, marginTop: 2,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {body}
          </div>
          <div style={{
            fontFamily: font.sans, fontSize: 12, color: theme.color.inkMuted, marginTop: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {sub}
          </div>
        </div>
        <PrimaryButton
          onClick={() => onOpenItem(firstExpiring._raw)}
          style={{ padding: "12px 18px", fontSize: 14 }}
        >
          Open
        </PrimaryButton>
      </GlassPanel>
    </FadeIn>
  );
}

// Given a list of cards, pick the single most urgent warn item.
// Tie-breaker: the earliest expiry date (smallest days), then the
// first in pantry order. Null when no cards warn.
function firstExpiring(cards) {
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

// Skeleton tile grid — shown while the initial pantry query is
// in flight and nothing has loaded yet. Renders six ghost cards
// with shimmering placeholder blocks where the icon / label /
// count pill would go. Once a single real card lands the
// skeleton unmounts via the AnimatePresence body crossfade, so
// loading → real feels like a soft fade rather than a content
// flash. Shimmer is a CSS keyframe applied via the global style
// tag at the top of PantryScreen so each ghost block uses the
// same animation timeline (they all pulse together rather than
// stagger, which reads as "waiting" better than a wave of
// independent animations).
const SKELETON_COUNT = 6;
function TileGridSkeleton() {
  const { theme } = useTheme();
  const block = (w, h) => ({
    width: w, height: h,
    borderRadius: 6,
    background: withAlpha(theme.color.ink, 0.06),
    animation: "mcm-skeleton-pulse 1.6s ease-in-out infinite",
  });
  return (
    <div style={{
      display: "grid",
      // Matches TileGrid's auto-fit columns and gap so the
      // skeleton → real transition doesn't reflow widths.
      gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
      gap: 12,
      marginTop: 20,
    }}>
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <GlassPanel
          key={i}
          padding={14}
          style={{
            // Mirror the new horizontal TileCard layout so the
            // skeleton looks like the real thing is about to
            // land there — icon left, text column right.
            display: "flex", flexDirection: "row", alignItems: "center", gap: 14,
            minHeight: 96,
            opacity: 0.7,
          }}
        >
          <div style={{ ...block(56, 56), borderRadius: 10, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ ...block("60%", 16) }} />
              <div style={{ ...block(32, 12) }} />
            </div>
            <div style={block("80%", 11)} />
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}

// Empty state — shown when a drilled tile has no items OR a
// search returns zero hits. Uses a small Starburst ornament
// behind the copy (same motif the WarmBackdrop uses, just
// smaller and centered) so the "nothing here" moment still
// feels like part of the design system rather than a bare
// error screen. Copy is warmer than plain "Nothing matches"
// — pantries are a personal space, and empty states are a
// good chance to sound human.

// Whole-location empty state — shown when the active location
// (Fridge / Pantry / Freezer) has zero items in any tile. Skips
// the visual noise of a grayed-out tile wall and gives the user
// a clear "this whole shelf is bare" moment with the location's
// own swatch color tying the message to the dock segment they're
// on.
function LocationEmptyState({ location }) {
  const { theme } = useTheme();
  const dotColor = LOCATION_DOT[location.id] || theme.color.inkMuted;
  const copy = {
    fridge:  "Your fridge is empty. Time for a grocery run.",
    pantry:  "The pantry shelves are bare.",
    freezer: "Nothing in the freezer yet.",
  }[location.id] || "Nothing on these shelves yet.";
  return (
    <FadeIn>
      <div style={{
        position: "relative",
        marginTop: 48,
        padding: "60px 20px",
        textAlign: "center",
        overflow: "hidden",
      }}>
        <Starburst
          size={220}
          color={withAlpha(dotColor, 0.18)}
          style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Big colored dot — same swatch color as the active
              dock segment, so the empty-state visually ties to
              "yes, this is the location you picked." */}
          <div style={{
            display: "inline-block",
            width: 16, height: 16,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: `0 0 0 6px ${withAlpha(dotColor, 0.18)}, 0 2px 4px rgba(30,20,8,0.20)`,
            marginBottom: 18,
          }} />
          <div style={{
            fontFamily: font.serif, fontStyle: "italic",
            fontSize: 22, lineHeight: 1.2,
            color: theme.color.ink,
            letterSpacing: "-0.01em",
          }}>
            {copy}
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

function EmptyState({ kind, query, tile }) {
  const { theme } = useTheme();
  const title = kind === "no-matches"
    ? `Nothing called "${query}"`
    : tile
      ? `${tile.label} is bare`
      : "This tile is empty";
  const body = kind === "no-matches"
    ? "Try a different name, or tap a location tab to browse the shelves."
    : "Scan a grocery receipt or add items manually to stock this shelf.";
  return (
    <FadeIn>
      <div style={{
        position: "relative",
        marginTop: 48,
        padding: "48px 20px",
        textAlign: "center",
        overflow: "hidden",
      }}>
        <Starburst
          size={200}
          color={withAlpha(theme.color.warmBrown, 0.08)}
          style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{
            fontFamily: font.serif, fontStyle: "italic",
            fontSize: 22, lineHeight: 1.2,
            color: theme.color.ink,
            letterSpacing: "-0.01em",
          }}>
            {title}
          </div>
          <div style={{
            marginTop: 8,
            fontFamily: font.sans, fontSize: 13,
            color: theme.color.inkMuted,
            lineHeight: 1.5,
            maxWidth: 300,
            margin: "8px auto 0",
          }}>
            {body}
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

// Swatch colors for the floating location dock. User-specified
// MCM palette: dark cool blue for the fridge (cold slate), MCM
// orange for the pantry (warm burnt), icy pale blue for the
// freezer. Kept out of the theme tokens because these are
// semantic-fixed (fridge is ALWAYS cold-blue regardless of time-
// of-day) rather than theme-variant.
const LOCATION_DOT = {
  fridge:  "#2F5A85", // dark cool blue
  pantry:  "#D96B2B", // MCM burnt orange
  freezer: "#A8D8EA", // icy pale blue
};

// Floating location dock — Fridge / Pantry / Freezer switcher
// pinned to the bottom of the viewport instead of the old top-of-
// page segmented control. Three pill segments, each with a solid
// colored swatch dot (in place of the emoji icons it replaced)
// plus the label and a count chip. Sliding active indicator via
// framer-motion layoutId, identical to the previous segmented
// control so the tap interaction is physically familiar.
function FloatingLocationDock({ locations, active, onSelect, totals }) {
  const { theme } = useTheme();
  const [hovered, setHovered] = useState(null);
  return (
    <motion.div
      role="tablist"
      aria-label="Pantry location"
      // Slide-up entrance. Pops in from below the viewport on
      // mount and on every remount (e.g. when search is cleared
      // and the dock comes back). Quick and springy so it feels
      // like an affordance appearing, not a full screen
      // transition.
      //
      // x: "-50%" is INSIDE the framer animate object (not in
      // CSS transform) because framer-motion writes a single
      // transform property based on its motion values, and any
      // CSS `transform` on the same element gets overwritten.
      // Putting -50% here means the dock stays centered through
      // every animation frame.
      initial={{ opacity: 0, x: "-50%", y: 24 }}
      animate={{ opacity: 1, x: "-50%", y: 0 }}
      exit={{ opacity: 0, x: "-50%", y: 24 }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
      style={{
      position: "fixed",
      left: "50%",
      // Sits above the app-level bottom nav. 96px leaves a ~16px
      // visual gap above a ~80px dark nav bar; bump if the nav is
      // taller on a given device.
      bottom: 96,
      zIndex: 20,
      display: "flex",
      gap: 4,
      padding: 5,
      borderRadius: 999,
      // Theme-aware surface: glassFillHeavy reads bright-cream
      // on morning/day/evening/dawn/dusk and warm-amber at night,
      // so the dock never looks like a stark white pill on a
      // dark backdrop. The border uses the theme's glassBorder
      // so the edge highlights match whatever time-of-day ink
      // the rest of the UI is using.
      background: theme.color.glassFillHeavy,
      border: `1px solid ${theme.color.glassBorder}`,
      backdropFilter: "blur(18px) saturate(160%)",
      WebkitBackdropFilter: "blur(18px) saturate(160%)",
      boxShadow: "0 14px 34px rgba(30,20,8,0.18), 0 3px 10px rgba(30,20,8,0.10)",
      ...THEME_TRANSITION,
    }}>
      {locations.map((loc) => {
        const isActive = active === loc.id;
        const total = totals[loc.id] || 0;
        const dotColor = LOCATION_DOT[loc.id] || theme.color.inkMuted;
        return (
          <button
            key={loc.id}
            onClick={() => onSelect(loc.id)}
            onMouseEnter={() => setHovered(loc.id)}
            onMouseLeave={() => setHovered(null)}
            className="mcm-focusable"
            style={{
              position: "relative",
              minWidth: 96,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 999,
              border: "none",
              background: !isActive && hovered === loc.id
                ? withAlpha(theme.color.ink, 0.04)
                : "transparent",
              cursor: "pointer",
              fontFamily: font.sans,
              fontSize: 13,
              fontWeight: 500,
              color: isActive || hovered === loc.id
                ? theme.color.ink
                : theme.color.inkMuted,
              transition: "color 220ms ease, background 220ms ease",
              whiteSpace: "nowrap",
            }}
          >
            {isActive && (
              <motion.div
                layoutId="location-tab-indicator"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  // Active pill is tinted with the location's own
                  // swatch hue rather than pure glassFillHeavy.
                  // Fixes the "invisible active pill" problem at
                  // night — both glassFillHeavy and the dock bg
                  // were amber-translucent, so the active
                  // indicator had zero contrast. Fridge active
                  // now reads cool-blue-ish, Pantry warm-orange-
                  // ish, Freezer icy-pale-ish regardless of
                  // time-of-day, while staying subtle enough
                  // (15% alpha + glassFillHeavy mix) that it
                  // reads as "tint" not "Fill."
                  background: `linear-gradient(${withAlpha(dotColor, 0.18)}, ${withAlpha(dotColor, 0.18)}), ${theme.color.glassFillHeavy}`,
                  border: `1px solid ${withAlpha(dotColor, 0.35)}`,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 8px rgba(30,30,30,0.10)`,
                  zIndex: 0,
                }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span style={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: 8 }}>
              {/* Colored swatch dot — replaces the old emoji icon.
                  Fridge = dark cool blue, Pantry = MCM burnt orange,
                  Freezer = icy pale blue. Active dot gets a colored
                  halo + bigger inner highlight so the selected
                  segment reads as a "lit pilot light" next to the
                  other two resting dots. Non-active dots stay
                  compact and matte. 200ms transition so the
                  swap between active/inactive looks mechanical
                  rather than flipped. */}
              <span style={{
                display: "inline-block",
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: `radial-gradient(circle at 30% 25%, ${withAlpha("#FFFFFF", isActive ? 0.55 : 0.28)} 0%, ${withAlpha("#FFFFFF", 0)} 55%), ${dotColor}`,
                boxShadow: isActive
                  ? `0 0 0 3px ${withAlpha(dotColor, 0.20)}, 0 1px 3px rgba(30,20,8,0.30)`
                  : `0 1px 2px rgba(30,20,8,0.25), inset 0 1px 0 rgba(255,255,255,0.30)`,
                flexShrink: 0,
                transition: "box-shadow 200ms ease, background 200ms ease",
              }} />
              <span>{loc.label}</span>
              {total > 0 && (
                <span style={{
                  fontFamily: font.mono, fontSize: 10,
                  fontWeight: 500,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: isActive
                    ? withAlpha(theme.color.ink, 0.08)
                    : "transparent",
                  color: isActive ? theme.color.inkMuted : theme.color.inkFaint,
                  letterSpacing: "0.04em",
                }}>
                  {total}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </motion.div>
  );
}

// Drilled tile header — the prominent "you are here" block shown
// above the item grid when the user taps into a tile. Replaces
// the plain BackChip with a stronger sense of place: tile icon
// (SVG or emoji), serif-italic label, count + warn count summary,
// sort selector, and an obvious back button. Mirrors classic
// Kitchen's drill-in moment but in MCM's voice (serif, glass,
// warm accents).
function DrilledTileHeader({ tile, location, count, warnCount, sortBy, onSortChange, onBack, categoryOptions = [], categoryFilter, onCategoryChange }) {
  const { theme } = useTheme();
  const iconUrl = tileIconFor(tile.id, location);
  // Active location's dot color (Fridge cool blue, Pantry burnt
  // orange, Freezer icy). Used to tint the accent rule + icon
  // halo so the drilled view visually carries the location it
  // belongs to — gives the user a "you're inside a Fridge tile"
  // cue distinct from the neutral tile-grid view above.
  const accent = LOCATION_DOT[location] || theme.color.inkMuted;
  return (
    <div style={{
      marginTop: 20,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      position: "relative",
    }}>
      {/* Top accent rule — a thin colored line spanning the
          drilled header that visually ties the view to its
          parent location's dot color. Subtle (3px tall, full
          width of the header), but enough to distinguish the
          drilled state from the neutral tile-grid view. */}
      <span
        aria-hidden
        style={{
          height: 3,
          width: 56,
          borderRadius: 999,
          background: accent,
          opacity: 0.85,
        }}
      />
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}>
        {/* Back button — circular glass chip with a chevron. More
            obvious affordance than the old text BackChip, and
            visually balanced with the tile icon on the right. */}
        <button
          onClick={onBack}
          aria-label={`Back to ${location} tiles`}
          className="mcm-focusable"
          style={{
            width: 38, height: 38, flexShrink: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${theme.color.hairline}`,
            background: theme.color.glassFillLite,
            backdropFilter: "blur(14px) saturate(150%)",
            WebkitBackdropFilter: "blur(14px) saturate(150%)",
            borderRadius: 999,
            cursor: "pointer",
            color: theme.color.ink,
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
            ...THEME_TRANSITION,
          }}
        >
          ←
        </button>
        {/* Tile icon — shared-element animation target. Same
            layoutId as the icon slot inside TileCard, so framer-
            motion morphs the icon from the tapped tile's position
            into this header slot when the user drills in. Works
            because both elements live under the same <LayoutGroup>
            and only one mounts at a time (tile grid exits → drilled
            view enters via AnimatePresence). */}
        <motion.div
          layoutId={`tile-icon-${location}-${tile.id}`}
          style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}
        >
          {iconUrl ? (
            <img
              src={iconUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "contain",
                filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))" }}
            />
          ) : (
            <div style={{
              fontSize: 38, lineHeight: 1,
              filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
            }}>
              {tile.emoji}
            </div>
          )}
          {/* Blue stock badge on the drilled icon — matches the
              TileCard corner badge so drilling in visually
              preserves the "how many here" indicator. Hidden
              when count is 0 (tile is empty — no stock signal
              to communicate). */}
          {count > 0 && (
            <div
              title={`${count} item${count === 1 ? "" : "s"}`}
              style={{
                position: "absolute",
                top: -2, right: -4,
                minWidth: 18, height: 18,
                padding: "0 5px",
                borderRadius: 999,
                background: theme.color.teal,
                color: theme.color.ctaText,
                fontFamily: font.mono, fontSize: 10, fontWeight: 600,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                letterSpacing: "-0.02em",
                boxShadow: `0 2px 6px ${withAlpha(theme.color.teal, 0.40)}`,
                border: `1px solid ${theme.color.glassBorder}`,
              }}
            >
              {count}
            </div>
          )}
        </motion.div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Label row — label left, optional warn pill right.
              Mirrors the TileCard pattern now that the icon's
              corner badge carries the stock count. No more
              "12 ITEMS · 3 SOON" separate meta line below; that
              was double-speak with the badge. */}
          <div style={{
            display: "flex", alignItems: "baseline",
            justifyContent: "space-between", gap: 8,
          }}>
            <div style={{
              fontFamily: font.display,
              fontWeight: 400,
              fontSize: "clamp(20px, 4.5vw, 32px)",
              lineHeight: 1.05, color: theme.color.ink,
              letterSpacing: "0.025em",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              flex: 1, minWidth: 0,
            }}>
              {tile.label}
            </div>
            {warnCount > 0 && (
              <motion.div
                title={`${warnCount} item${warnCount === 1 ? "" : "s"} expiring soon`}
                animate={{
                  scale: [1, 1.06, 1],
                  boxShadow: [
                    "0 2px 6px rgba(168,73,17,0.35)",
                    "0 2px 14px rgba(168,73,17,0.55)",
                    "0 2px 6px rgba(168,73,17,0.35)",
                  ],
                }}
                transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
                style={{
                  minWidth: 22, height: 22,
                  padding: "0 8px",
                  borderRadius: 999,
                  background: theme.color.burnt,
                  color: theme.color.ctaText,
                  fontFamily: font.mono, fontSize: 10, fontWeight: 600,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  flexShrink: 0,
                  border: `1px solid ${theme.color.glassBorder}`,
                }}
              >
                {warnCount} soon
              </motion.div>
            )}
          </div>
          {/* Tile blurb (when present) — inherited from the tile
              definition in fridgeTiles/pantryTiles/freezerTiles
              so it automatically stays in sync with whatever the
              authoring source says. Rendered as a small DM Sans
              line so the drilled header has a micro sense of
              place beyond just the label. Truncates on narrow
              viewports to avoid wrapping past the icon column. */}
          {tile.blurb && (
            <div
              className="mcm-tile-blurb"
              style={{
              marginTop: 4,
              fontFamily: font.sans, fontSize: 12,
              color: theme.color.inkFaint,
              lineHeight: 1.4,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {tile.blurb}
            </div>
          )}
        </div>
      </div>

      {/* Sort row — only renders when there's more than one item
          to reorder. Single-item tiles don't need sort UI. */}
      {count > 1 && (
        <SortSelector sortBy={sortBy} onSortChange={onSortChange} />
      )}
      {/* Category filter — pills for each food type present in
          the drilled tile (e.g. "All / Cheese / Yogurt / Eggs"
          inside Dairy & Eggs). Lets the user narrow to a single
          category without leaving the tile. Only renders when
          the tile actually has multiple categories — a single-
          category tile doesn't need a filter row. */}
      {categoryOptions.length > 1 && (
        <CategoryFilter
          options={categoryOptions}
          value={categoryFilter}
          onChange={onCategoryChange}
        />
      )}
    </div>
  );
}

// Sort selector — three small DM Mono pills ("EXPIRING" / "A–Z"
// / "RECENT"). Shown above the items grid when drilled into a
// tile with 2+ items.
function SortSelector({ sortBy, onSortChange }) {
  const { theme } = useTheme();
  const OPTIONS = [
    { id: "expiring", label: "Expiring" },
    { id: "name",     label: "A–Z"      },
    { id: "recent",   label: "Recent"   },
  ];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      marginLeft: 52, // indent under the icon column so the
                      // "sort by" row visually belongs to the
                      // header block above, not to the grid below
    }}>
      <span style={{
        fontFamily: font.mono, fontSize: 10,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: theme.color.inkFaint,
        marginRight: 2,
      }}>
        Sort
      </span>
      {OPTIONS.map(opt => {
        const active = sortBy === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onSortChange(opt.id)}
            className="mcm-focusable"
            style={{
              fontFamily: font.mono, fontSize: 10,
              letterSpacing: "0.08em", textTransform: "uppercase",
              padding: "3px 8px",
              borderRadius: 999,
              border: active
                ? `1px solid ${theme.color.hairline}`
                : "1px solid transparent",
              background: active ? theme.color.glassFillLite : "transparent",
              color: active ? theme.color.ink : theme.color.inkMuted,
              cursor: "pointer",
              ...THEME_TRANSITION,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// Category filter — pill row of food types present in the
// drilled tile, with counts. "All" pill at the head clears the
// filter; tapping any specific pill narrows to that category.
// Mirrors SortSelector's visual but uses burnt tinting on the
// active pill (matches the orange CATEGORY axis color the
// per-item food-type pill uses elsewhere).
function CategoryFilter({ options, value, onChange }) {
  const { theme } = useTheme();
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      marginLeft: 52, // align under the icon column for visual
                      // siblinghood with SortSelector above
      flexWrap: "wrap",
    }}>
      <span style={{
        fontFamily: font.mono, fontSize: 10,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: theme.color.inkFaint,
        marginRight: 2,
      }}>
        Category
      </span>
      <CategoryPill
        active={value === null}
        onClick={() => onChange(null)}
        label="All"
        count={null}
      />
      {options.map(opt => (
        <CategoryPill
          key={opt.label}
          active={value === opt.label}
          onClick={() => onChange(opt.label)}
          label={opt.label}
          count={opt.count}
        />
      ))}
    </div>
  );
}

function CategoryPill({ active, onClick, label, count }) {
  const { theme } = useTheme();
  return (
    <button
      onClick={onClick}
      className="mcm-focusable"
      style={{
        fontFamily: font.mono, fontSize: 10,
        letterSpacing: "0.08em", textTransform: "uppercase",
        padding: "3px 8px",
        borderRadius: 999,
        // Active = burnt tint (matches CATEGORY axis color);
        // inactive = transparent. Border darkens to hairline
        // on active so the pill reads as filled, not floating.
        border: active
          ? `1px solid ${withAlpha(theme.color.burnt, 0.4)}`
          : "1px solid transparent",
        background: active
          ? withAlpha(theme.color.burnt, 0.18)
          : "transparent",
        color: active ? theme.color.ink : theme.color.inkMuted,
        cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 4,
        ...THEME_TRANSITION,
      }}
    >
      <span>{label}</span>
      {count != null && (
        <span style={{
          fontWeight: 500,
          color: active ? theme.color.inkMuted : theme.color.inkFaint,
          opacity: 0.85,
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// Search summary — shown above the flat search-hits grid. Tells
// the user how many hits and which locations they span, so a
// query that returns matches across multiple tabs (e.g. butter
// in both fridge and freezer) surfaces that distribution without
// making them count rows by hand.
function SearchSummary({ hits, query, onClear }) {
  const { theme } = useTheme();
  const total = hits.length;
  // Per-location counts — "butter" search finds 1 in fridge + 1
  // in freezer, this line says "Found 2 · 1 fridge · 1 freezer".
  const byLoc = { fridge: 0, pantry: 0, freezer: 0 };
  for (const h of hits) {
    if (byLoc[h._location] != null) byLoc[h._location] += 1;
  }
  const parts = ["fridge", "pantry", "freezer"]
    .filter(loc => byLoc[loc] > 0)
    .map(loc => `${byLoc[loc]} ${loc}`);

  return (
    <div style={{
      marginTop: 20,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      flexWrap: "wrap",
    }}>
      <div
        // aria-live="polite" announces the result count + location
        // distribution to screen readers without interrupting the
        // user's typing. Sighted users see the same readout but
        // passively; assistive-tech users get a meaningful update
        // instead of an opaque "something changed" moment.
        aria-live="polite"
        aria-atomic="true"
        style={{
        fontFamily: font.mono, fontSize: 11,
        letterSpacing: "0.06em",
        color: theme.color.skyInkMuted,
        textTransform: "uppercase",
      }}>
        {total === 0 ? (
          <>No matches for "{query}"</>
        ) : (
          <>
            Found {total}
            {parts.length > 0 && <span style={{ opacity: 0.6 }}> · {parts.join(" · ")}</span>}
          </>
        )}
      </div>
      <button
        onClick={onClear}
        style={{
          fontFamily: font.mono, fontSize: 10,
          letterSpacing: "0.08em", textTransform: "uppercase",
          padding: "4px 10px",
          borderRadius: 999,
          border: `1px solid ${theme.color.hairline}`,
          background: theme.color.glassFillLite,
          color: theme.color.inkMuted,
          cursor: "pointer",
          ...THEME_TRANSITION,
        }}
      >
        Clear search
      </button>
    </div>
  );
}

// Item grid — the animated 2-to-N column grid used for BOTH the
// drilled-tile view and the search-hits view. Factored out so the
// card-layout code isn't duplicated across the two render branches.
function ItemGrid({ items, onOpenItem, onOpenUnitPicker, onRemoveItem, openSwipeId, setOpenSwipeId, showTileContext = false }) {
  // In search mode (showTileContext=true) each card renders a
  // small tile-context chip ("FROM DAIRY & EGGS") so users who
  // searched cross-location know where each hit lives. Resolve
  // the tile's label from LOCATIONS once per item — cheap O(N)
  // over 20 tiles so not worth memoizing.
  const tileLabelFor = (item) => {
    if (!showTileContext) return null;
    const loc = LOCATIONS.find(l => l.id === item._location);
    const tile = loc?.tiles.find(t => t.id === item._tileId);
    return tile?.label || null;
  };
  return (
    <div style={{
      display: "grid",
      // Horizontal item cards (icon left, text right) want
      // ~260px wide minimum so the name + meta row breathe
      // without truncating immediately. Auto-fit gives 1 col
      // on phones, 2 at tablet, 3 at desktop on the 960px
      // content column.
      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: 12,
      marginTop: 20,
    }}>
      <AnimatePresence mode="popLayout">
        {items.map((it, i) => (
          <motion.div
            key={it.id}
            layout
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            whileTap={{ scale: 0.97 }}
            whileHover={{ y: -2, scale: 1.01 }}
            transition={{ duration: 0.32, delay: i * 0.025, ease: [0.22, 1, 0.36, 1] }}
          >
            <PantryCard
              item={it}
              tileLabel={tileLabelFor(it)}
              onPick={() => {
                if (onOpenItem && it._raw) onOpenItem(it._raw);
                else if (onOpenUnitPicker) onOpenUnitPicker();
              }}
              onRemove={onRemoveItem && it._raw ? () => onRemoveItem(it._raw) : null}
              isSwipeOpen={openSwipeId === it.id}
              onSwipeOpen={() => setOpenSwipeId && setOpenSwipeId(it.id)}
              onSwipeClose={() => {
                if (setOpenSwipeId && openSwipeId === it.id) setOpenSwipeId(null);
              }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// Tile grid — the top-level "pick a shelf" view shown when no
// tile is drilled and no search is active. Each tile card shows
// icon/emoji + label + blurb + an item count + warn dot. Empty
// tiles dim to ~45% so the populated ones pop, same visual
// pattern the classic Kitchen uses.
function TileGrid({ location, cardsByTile, onPickTile, warnCountByTile }) {
  // Sort populated tiles first, empty tiles last. Stable sort
  // preserves the authoring order (from fridgeTiles.js etc.)
  // within each group so, e.g., within the populated group
  // Dairy still comes before Produce. Empty tiles sink but
  // stay visible (dimmed) so the user can still see what
  // shelves exist — matches the "browse ALL shelves" intent
  // without forcing empty ones to dominate the top.
  const sortedTiles = useMemo(() => {
    return location.tiles
      .map((tile, origIdx) => {
        const count = (cardsByTile[tile.id] || []).length;
        return { tile, origIdx, count, empty: count === 0 };
      })
      .sort((a, b) => {
        if (a.empty !== b.empty) return a.empty ? 1 : -1;
        return a.origIdx - b.origIdx;
      });
  }, [location, cardsByTile]);
  return (
    <div style={{
      display: "grid",
      // Horizontal tile layout means each card is short (~96px
      // tall) and wants to be ~280-320px wide for the label +
      // blurb line to breathe without wrapping. auto-fit +
      // minmax(300, 1fr) gives 1 col on phones, 2 on tablets,
      // 3 on desktop — fills the 960px content column at 3
      // cards without leaving phone-width gaps.
      gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
      gap: 12,
      marginTop: 20,
    }}>
      <AnimatePresence mode="popLayout">
        {sortedTiles.map(({ tile, count, empty }, i) => {
          const warn = warnCountByTile[`${location.id}:${tile.id}`] || 0;
          return (
            <motion.div
              key={tile.id}
              layout
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              // Press feedback — empty tiles skip the press
              // animation since they're not interactive. Small
              // 0.97 feels like a gentle tap rather than a heavy
              // slam; pairs with the 0.22s body crossfade when
              // the user commits by drilling in.
              whileTap={empty ? undefined : { scale: 0.97 }}
              // Hover lift (desktop / trackpad) — 2px rise with
              // a 1% scale nudges the card toward the viewer so
              // the glass material reads more as a solid object
              // than a flat overlay. Ignored on empty tiles.
              whileHover={empty ? undefined : { y: -2, scale: 1.01 }}
              transition={{ duration: 0.32, delay: i * 0.02, ease: [0.22, 1, 0.36, 1] }}
            >
              <TileCard
                tile={tile}
                location={location.id}
                count={count}
                warnCount={warn}
                onPick={() => onPickTile(tile)}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// Tile card — the "Dairy & Eggs · 12 items" shelf-choice card.
// Taller than an item card so the icon has space to dominate and
// the blurb below the label has breathing room. Empty tiles
// render dimmed + non-interactive so the user doesn't drill into
// a known-empty shelf. If a bundled SVG exists at
// public/icons/tiles/<id>.svg (registered in canonicalIcons.js),
// it wins over the emoji fallback — so the user can upload a
// custom tile icon and it renders instantly without any code
// change here.
function TileCard({ tile, location, count, warnCount, onPick }) {
  const { theme } = useTheme();
  const empty = count === 0;
  const iconUrl = tileIconFor(tile.id, location);
  return (
    <GlassPanel
      interactive={!empty}
      onClick={empty ? undefined : onPick}
      padding={14}
      style={{
        // Horizontal layout: icon on the left, label + blurb +
        // count stacked on the right. Replaces the previous
        // stacked layout that had a ton of dead vertical space
        // (icon at top-left, label dropped to the bottom). This
        // reads more like an entry in a kitchen ledger — bigger
        // icon, tighter card, multi-column friendly.
        display: "flex", flexDirection: "row", alignItems: "center", gap: 14,
        minHeight: 96,
        opacity: empty ? 0.45 : 1,
        cursor: empty ? "default" : "pointer",
        // Subtle desaturation on empty tiles so they read as
        // "not available" not "dimmed but tappable."
        filter: empty ? "grayscale(40%)" : "none",
      }}
    >
      {/* Icon slot — bundled SVG when available, emoji fallback
          otherwise. motion.div with layoutId so the icon morphs
          into the drilled-header's icon position when the user
          taps this tile. Bumped to 56px here (was 44) since it's
          now the primary visual element of the card. */}
      <motion.div
        layoutId={`tile-icon-${location}-${tile.id}`}
        style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}
      >
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            style={{
              width: "100%", height: "100%", objectFit: "contain",
              filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
            }}
          />
        ) : (
          <div style={{
            fontSize: 48, lineHeight: 1,
            filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
          }}>
            {tile.emoji}
          </div>
        )}
        {/* Stock-count badge on the icon — BLUE. Previously
            this slot held the warn count in burnt orange, but the
            eye-catching badge on the icon was reading as "how
            many I have" (stock indicator) while the muted right-
            of-label pill held the actual stock number. Swapped:
            the badge is now the primary stock-count indicator
            (blue reads as "inventory"), and the warn count moves
            to the right-of-label slot below in burnt orange (which
            now reads as "heads up, something's expiring"). */}
        {!empty && (
          <div
            title={`${count} item${count === 1 ? "" : "s"}`}
            style={{
              position: "absolute",
              top: -2, right: -4,
              minWidth: 18, height: 18,
              padding: "0 5px",
              borderRadius: 999,
              background: theme.color.teal,
              color: theme.color.ctaText,
              fontFamily: font.mono, fontSize: 10, fontWeight: 600,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              letterSpacing: "-0.02em",
              boxShadow: `0 2px 6px ${withAlpha(theme.color.teal, 0.40)}`,
              border: `1px solid ${theme.color.glassBorder}`,
            }}
          >
            {count}
          </div>
        )}
      </motion.div>

      {/* Text column — label + warn pill on the same row at the
          top, blurb below. Warn pill (burnt orange, breathing
          pulse) takes the slot that used to hold the stock count;
          this is the "attention, these are expiring" indicator
          now, where the semantically-warning color belongs. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{
          display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8,
        }}>
          <div style={{
            fontFamily: font.display,
            fontWeight: 400,
            fontSize: 22, lineHeight: 1.1, color: theme.color.ink,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            flex: 1, minWidth: 0,
          }}>
            {tile.label}
          </div>
          {warnCount > 0 && (
            <motion.div
              title={`${warnCount} item${warnCount === 1 ? "" : "s"} expiring soon`}
              animate={{
                scale: [1, 1.06, 1],
                boxShadow: [
                  "0 2px 6px rgba(168,73,17,0.35)",
                  "0 2px 14px rgba(168,73,17,0.55)",
                  "0 2px 6px rgba(168,73,17,0.35)",
                ],
              }}
              transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
              style={{
                minWidth: 22, height: 22,
                padding: "0 8px",
                borderRadius: 999,
                background: theme.color.burnt,
                color: theme.color.ctaText,
                fontFamily: font.mono, fontSize: 10, fontWeight: 600,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                flexShrink: 0,
                border: `1px solid ${theme.color.glassBorder}`,
              }}
            >
              {warnCount} soon
            </motion.div>
          )}
        </div>
        {tile.blurb && (
          <div
            className="mcm-tile-blurb"
            style={{
              fontFamily: font.sans, fontSize: 12,
              color: theme.color.inkFaint,
              lineHeight: 1.4,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {tile.blurb}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

// Width of the swipe-reveal action drawer behind each item card
// (the Remove button). 96px gives the button comfortable tap
// area without consuming so much of the card width that a
// half-open swipe looks like a glitch.
const SWIPE_ACTION_WIDTH = 96;
// Past this leftward offset (in px) on dragEnd, the card snaps
// fully open. Anything less snaps closed. Velocity also opens
// when fast-flicked even if displacement hasn't crossed the
// threshold yet (matches iOS Mail / Things behavior).
const SWIPE_OPEN_THRESHOLD = 36;

function PantryCard({
  item,
  onPick,
  tileLabel = null,
  onRemove = null,
  // External swipe coordination — when null these props no-op,
  // and the card manages its own swipe state in isolation.
  // When wired, the card REPORTS open/close via the callbacks
  // and SUBSCRIBES to isSwipeOpen so it auto-closes when
  // another card in the grid opens (one-card-open-at-a-time
  // iOS pattern).
  isSwipeOpen = false,
  onSwipeOpen = null,
  onSwipeClose = null,
}) {
  const { theme } = useTheme();
  const warn = item.status === "warn";
  // Warn cards pick up a gentle theme-derived burnt wash so
  // "expires soon" is noticeable at the card level without being
  // alarming. Wash follows time-of-day automatically.
  const warnOverlay = warn ? statusTintOverlay(theme, "warn") : null;
  // Bundled SVG icon for the item's canonical id if one exists
  // (public/icons/<canonical>.svg, registered in canonicalIcons
  // BUNDLED_ICON_SLUGS). Admin-generated images from
  // ingredient_info.imageUrl aren't threaded through yet — that
  // needs the IngredientInfo context, tracked as a follow-up.
  // Emoji is always the fallback.
  const canonicalId = item?._raw?.canonicalId || null;
  const iconUrl = canonicalImageUrlFor(canonicalId, null);

  // Swipe-to-reveal state. `swipeX` is the horizontal offset
  // motion value the inner card animates against. `swipeOpen`
  // is the latched two-state — closed (x:0) or open (x:-WIDTH).
  // Drag handlers set the latch on release based on offset +
  // velocity; an effect animates `swipeX` to match. Tapping
  // the open card closes it instead of firing onPick (so a
  // user who swipes accidentally and taps doesn't open the
  // editor unintentionally).
  const swipeX = useMotionValue(0);
  const swipeControls = useAnimation();
  const [swipeOpen, setSwipeOpen] = useState(false);
  const swipeEnabled = typeof onRemove === "function";
  // Action-button opacity tied to swipe progress. swipeX 0 →
  // action opacity 0 (button invisible behind a closed card so
  // it doesn't bleed through GlassPanel's translucent fill);
  // swipeX -96 → opacity 1 (fully revealed). useTransform
  // clamps to [0,1] across the range automatically.
  const actionOpacity = useTransform(swipeX, [-SWIPE_ACTION_WIDTH, 0], [1, 0]);

  const animateSwipe = (toOpen, { notify = true } = {}) => {
    setSwipeOpen(toOpen);
    swipeControls.start({
      x: toOpen ? -SWIPE_ACTION_WIDTH : 0,
      transition: { type: "spring", stiffness: 420, damping: 38 },
    });
    // Notify parent so it can close other open cards on this
    // card's open, or clear the state on this card's close.
    // notify:false skips the callback when WE'RE the one being
    // told to close by the parent (avoids a feedback loop).
    if (notify) {
      if (toOpen && onSwipeOpen) onSwipeOpen();
      if (!toOpen && onSwipeClose) onSwipeClose();
    }
  };

  // External-close listener — when another card opens (parent
  // sets a different openSwipeId), this prop flips to false
  // and we animate ourselves closed without re-notifying the
  // parent (already cleared from THEIR perspective).
  // Inverse: parent reset after we closed ourselves — no-op.
  // We don't auto-OPEN from the prop change because swipe
  // open is always user-initiated (drag), never broadcast.
  useEffect(() => {
    if (!isSwipeOpen && swipeOpen) {
      animateSwipe(false, { notify: false });
    }
  }, [isSwipeOpen]);

  const handleDragEnd = (_event, info) => {
    const offsetPastThreshold = info.offset.x < -SWIPE_OPEN_THRESHOLD;
    const fastLeftFlick = info.velocity.x < -350;
    const fastRightFlick = info.velocity.x >  350;
    if (fastRightFlick) animateSwipe(false);
    else if (offsetPastThreshold || fastLeftFlick) animateSwipe(true);
    else animateSwipe(false);
  };

  const handleClick = (e) => {
    // Tapping while open closes the swipe; tapping while
    // closed opens the editor. Both cases stopPropagation so
    // the parent ItemGrid motion.div doesn't double-handle.
    if (swipeOpen) {
      e.stopPropagation();
      animateSwipe(false);
      return;
    }
    if (onPick) onPick();
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    animateSwipe(false);
    if (onRemove) onRemove();
  };

  return (
    <div style={{
      // Swipe shell — clips the inner card so the Remove
      // action button doesn't show until the user drags.
      // Rounded to match the card's borderRadius so the clip
      // edge follows the same curve.
      position: "relative",
      borderRadius: 22,
      overflow: "hidden",
    }}>
      {/* Remove action — fixed behind the card on the right.
          Visually inert until the user swipes the card open,
          at which point it slides into view. Burnt-tinted to
          match CLAUDE.md's "destructive" register; the icon
          glyph is a trash bin emoji as a fallback (custom SVG
          could replace later). Hidden when swipe isn't wired
          (Showcase, no onRemove). */}
      {swipeEnabled && (
        <motion.button
          onClick={handleRemove}
          aria-label={`Remove ${item.name} from kitchen`}
          className="mcm-focusable"
          style={{
            position: "absolute",
            top: 0, right: 0, bottom: 0,
            width: SWIPE_ACTION_WIDTH,
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            border: "none",
            background: theme.color.burnt,
            color: theme.color.ctaText,
            cursor: "pointer",
            padding: 0,
            // Opacity scales with swipe progress (motion value
            // bound above) — invisible at rest, fully opaque
            // at full open. Avoids bleeding through the
            // translucent GlassPanel before the user swipes.
            opacity: actionOpacity,
          }}
        >
          <img
            src="/icons/trash.svg"
            alt=""
            aria-hidden
            style={{
              // Fill the action drawer's full vertical extent
              // with minimal padding — icon carries the affordance
              // without a redundant text label.
              height: "calc(100% - 8px)",
              width: "auto",
              maxWidth: "100%",
              objectFit: "contain",
              filter: "drop-shadow(0 1px 2px rgba(30,20,8,0.30))",
            }}
          />
        </motion.button>
      )}
    <motion.div
      // Drag-to-reveal swipe. drag="x" with constraints
      // clamped between 0 (closed) and -ACTION_WIDTH (open).
      // dragElastic 0.05 lets the user feel a subtle pull
      // past the limit without overshooting. animate is
      // controlled by swipeControls so dragEnd can snap to
      // either bistable position.
      drag={swipeEnabled ? "x" : false}
      dragConstraints={{ left: -SWIPE_ACTION_WIDTH, right: 0 }}
      dragElastic={0.05}
      dragMomentum={false}
      onDragEnd={swipeEnabled ? handleDragEnd : undefined}
      animate={swipeControls}
      style={{ x: swipeX }}
    >
    <motion.div
      // Spoilage aura — fixed-size green halo that lingers
      // around the card's edge when the item is warn. Shadow
      // dimensions stay constant (no growth into the
      // surrounding space); only the alpha breathes between
      // two non-zero values so the glow never disappears, just
      // pulses gently like a slow background hum. Reads as
      // "this card is in the warn state at all times" rather
      // than "every 3.6s it tries to remind me."
      //
      // initial seeds the shadow at its low-alpha baseline so
      // the aura is visible from first paint instead of fading
      // in from 0.
      initial={warn ? {
        boxShadow: "0 0 16px 3px rgba(123,156,92,0.42), 0 0 32px 6px rgba(123,156,92,0.22)",
      } : undefined}
      animate={warn ? {
        boxShadow: [
          "0 0 16px 3px rgba(123,156,92,0.42), 0 0 32px 6px rgba(123,156,92,0.22)",
          "0 0 16px 3px rgba(123,156,92,0.70), 0 0 32px 6px rgba(123,156,92,0.40)",
          "0 0 16px 3px rgba(123,156,92,0.42), 0 0 32px 6px rgba(123,156,92,0.22)",
        ],
      } : undefined}
      transition={warn ? { duration: 3.6, ease: "easeInOut", repeat: Infinity } : undefined}
      style={{
        position: "relative",
        borderRadius: 22, // match GlassPanel rounding so the
                          // glow contour follows the card edge
                          // rather than spilling square corners
      }}
    >
    <GlassPanel
      interactive
      onClick={handleClick}
      padding={10}
      style={{
        // Horizontal layout — icon on the left at 60px, text
        // column right-side stacking name + qty/brand + meta
        // row (category pill + days chip). Vertical chrome
        // tuned tight: padding 10 (was 14), minHeight 76
        // (was 92), gap 12 between icon + text (was 14). Text
        // column gap below also tightened from 4 → 2 so the
        // three lines (name / subhead / meta) feel like a
        // single label block rather than spaced-out tiers.
        //
        // Right corners squared off when swipe is wired so the
        // card's exposed right edge butts flat against the
        // Remove action behind it instead of curving inward
        // and leaving a wedge gap. At rest the wrapper's clip
        // (top-right/bottom-right rounded) hides the squared
        // edge, so the resting card still looks rounded.
        ...(swipeEnabled ? {
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
        } : null),
        position: "relative",
        display: "flex", flexDirection: "row", alignItems: "stretch",
        gap: 12, minHeight: 76,
        ...warnOverlay,
      }}
    >
      {/* Status / NEW / ok badge — absolutely positioned in the
          card's upper-right corner so it floats over both the
          icon column and the text column without taking row
          space. Same priority cascade: warn > new > ok. */}
      <div style={{ position: "absolute", top: 10, right: 12, zIndex: 1 }}>
        {warn ? (
          <StatusDot tone="warn" size={10} />
        ) : isRecent(item) ? (
          <span style={{
            fontFamily: font.mono, fontSize: 8, fontWeight: 600,
            letterSpacing: "0.10em", textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: 999,
            background: withAlpha(theme.color.teal, 0.18),
            color: theme.color.teal,
            lineHeight: 1,
          }}>
            new
          </span>
        ) : (
          <StatusDot tone="ok" size={8} />
        )}
      </div>

      {/* Icon column — bumped 36 → 60px, aligned to the vertical
          center of the card so it visually anchors the layout. */}
      <div style={{
        display: "flex", alignItems: "center",
        flexShrink: 0,
      }}>
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            style={{
              width: 60, height: 60, objectFit: "contain",
              filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
            }}
          />
        ) : (
          <div style={{
            // 56px emoji ≈ 60px SVG visual weight (Apple/Noto
            // glyphs render at ~95% of font-size).
            fontSize: 56, lineHeight: 1,
            filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
          }}>
            {item.emoji}
          </div>
        )}
      </div>

      {/* Text column — name + qty/brand + meta row. minWidth: 0
          so the inner flex children honor ellipsis truncation
          rather than overflowing the card. */}
      <div style={{
        flex: 1, minWidth: 0,
        display: "flex", flexDirection: "column",
        justifyContent: "center",
        gap: 2,
        // Right padding so the absolute status badge doesn't
        // overlap long names.
        paddingRight: 22,
      }}>
        {/* Tile-context chip when in search mode — sits above
            the name as a small kicker. */}
        {tileLabel && (
          <div style={{
            fontFamily: font.mono, fontSize: 9,
            letterSpacing: "0.10em", textTransform: "uppercase",
            color: theme.color.inkFaint,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {tileLabel}
          </div>
        )}
        <div style={{
          // Filmotype Honey (Typekit) — Adobe Fonts face on
          // item-card NAMES so items read in a different
          // typographic register than tile cards (Pale Martini)
          // and the row's own subheader (Beverly Drive Right).
          // Single weight 300, normal style.
          fontFamily: font.itemName, fontStyle: "normal", fontWeight: 300,
          fontSize: 30, lineHeight: 1, color: theme.color.ink,
          letterSpacing: "0",
          // Filmotype Honey carries extra descender space below
          // the baseline; pull the subheader up so the row
          // doesn't read as two disconnected lines.
          marginBottom: -8,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {item.name}
        </div>
        {/* Qty + brand subheader row — Beverly Drive Right
            (font.itemSub) so the metadata reads as a paired
            second beat below the Kinescope name in the same
            display family but a distinctly different shape.
            Existing CLAUDE.md "Butter · Kerrygold" pattern. */}
        <div style={{
          display: "flex", alignItems: "baseline", gap: 6,
          fontFamily: font.itemSub, fontSize: 14,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap", overflow: "hidden",
        }}>
          <span style={{ color: theme.color.inkFaint, flexShrink: 0 }}>
            {item.qty}
          </span>
          {item.brand && (
            <>
              <span style={{ color: theme.color.inkFaint, opacity: 0.4, flexShrink: 0 }}>·</span>
              <span style={{
                color: theme.color.inkMuted,
                overflow: "hidden", textOverflow: "ellipsis",
                fontWeight: 500,
              }}>
                {item.brand}
              </span>
            </>
          )}
        </div>
        {/* Meta row — category pill on left, days chip on right.
            Renders only when at least one of the two has content,
            so cards without a category and without a date fall
            back to a tighter two-line layout. */}
        {(item.typeLabel || item.days != null) && (
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 6,
            marginTop: 0,
          }}>
            {item.typeLabel ? (
              <TintedPill
                tone="burnt"
                size="sm"
                style={{ overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {item.typeLabel}
              </TintedPill>
            ) : <span />}
            <span style={{
              fontFamily: font.mono, fontSize: 10,
              color: daysChipColor(item.days, theme),
              whiteSpace: "nowrap",
              fontWeight: warn ? 500 : 400,
            }}>
              {formatDaysChip(item.days)}
            </span>
          </div>
        )}

        {/* Fill gauge — sealed/opened indicator. Only renders
            when the row carries a declared package size (max > 0)
            so we don't fabricate progress against an undefined
            container. Bar tints teal when sealed (amount == max)
            and burnt when opened (amount < max), matching the
            AddDraftSheet's slider color treatment so the same
            visual cue carries across surfaces. */}
        {(() => {
          const max = Number(item.max);
          const amt = Number(item.amount);
          if (!(max > 0) || !Number.isFinite(amt)) return null;
          const pct = Math.max(0, Math.min(100, (amt / max) * 100));
          const sealed = amt >= max - 0.0001;
          const fill = sealed ? theme.color.teal : theme.color.burnt;
          return (
            <div
              aria-label={sealed
                ? `Sealed · ${item.qty}`
                : `Opened · ${pct.toFixed(0)}% remaining`}
              title={sealed
                ? `Sealed · ${item.qty}`
                : `Opened · ${pct.toFixed(0)}% remaining`}
              style={{
                height: 4,
                borderRadius: 2,
                background: withAlpha(theme.color.ink, 0.06),
                overflow: "hidden",
                marginTop: 4,
              }}
            >
              <div style={{
                height: "100%", width: `${pct}%`,
                background: fill,
                boxShadow: `0 0 6px ${withAlpha(fill, 0.45)}`,
                transition: "width 600ms cubic-bezier(0.22, 1, 0.36, 1), background 200ms ease",
              }} />
            </div>
          );
        })()}
      </div>
    </GlassPanel>
    </motion.div>
    </motion.div>
    </div>
  );
}

// Compact chip for the days-to-expire corner. Demo items always
// carry a number; real items whose `expiresAt` is null (shelf-
// stable pantry goods like olive oil) get a `days = null` from
// the adapter and render with an empty chip so the card doesn't
// lie about a spoilage clock.
function formatDaysChip(days) {
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
function isRecent(item) {
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
function daysChipColor(days, theme) {
  if (days == null) return theme.color.inkMuted;
  if (days < 0 || days <= 3) return theme.color.burnt;     // warn
  if (days <= 7) return theme.color.mustard;               // plan-ahead
  return theme.color.inkMuted;                             // plenty
}

// Live clock — `now` state updates once a minute. Not every
// second: the kicker only renders "TUESDAY · 4:12 PM" precision
// so a second-tick would re-render the whole screen for nothing.
// Scheduled at each minute BOUNDARY (not every 60s from mount)
// so when the minute rolls the display flips immediately rather
// than drifting up to 59s behind the wall clock.
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let alive = true;
    const schedule = () => {
      const msUntilNextMinute = 60000 - (Date.now() % 60000);
      return setTimeout(() => {
        if (!alive) return;
        setNow(new Date());
        timer = schedule();
      }, msUntilNextMinute);
    };
    let timer = schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return now;
}

// "TUESDAY · 4:12 PM" — uppercase day + 12-hour local time.
// Kicker component already uppercases via letter-spacing /
// fontFeatureSettings but we send it uppercase to avoid a
// rendering pop when the style hasn't loaded yet.
function formatClock(now) {
  const day = now.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase();
  const time = now.toLocaleTimeString(undefined, {
    hour: "numeric", minute: "2-digit", hour12: true,
  }).toUpperCase();
  return `${day} · ${time}`;
}

function SearchGlyph() {
  const { theme } = useTheme();
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="7" fill="none" stroke={theme.color.inkMuted} strokeWidth="1.6" />
      <path d="M16.5 16.5 L21 21" stroke={theme.color.inkMuted} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// MCMAddDraftSheet — manual-add (and, in a follow-up commit,
// scan-prefilled) entry surface. Mounted at App level when
// onOpenAdd fires; calls onSubmit(row) with a partial pantry-
// row shape that App.jsx wraps with id + purchasedAt before
// pushing into setPantry.
//
// Seed: { mode: "blank" } today; { mode: "scan", name, brand,
// amount, unit, ... } once scan is wired in commit 2.
// ─────────────────────────────────────────────────────────────
export function MCMAddDraftSheet({ seed = { mode: "blank" }, userId, isAdmin, onClose, onSubmit }) {
  const { theme } = useTheme();
  // Form state — seeded from `seed` so the same component
  // works for empty (manual) and pre-filled (scan) entry. The
  // useState initializer runs once per mount; keying the sheet
  // on seed identity from the parent re-mounts when a fresh
  // scan lands (see App.jsx wiring).
  const [name,   setName]   = useState(seed.name   || "");
  const [brand,  setBrand]  = useState(seed.brand  || "");
  // Package size is the FULL container's amount (becomes
  // pantry_items.max). The remaining slider scales down from
  // there to express how much is actually left. amount === max
  // → SEALED; amount < max → OPENED.
  const [packageSize, setPackageSize] = useState(seed.amount != null ? String(seed.amount) : "");
  const [unit,        setUnit]        = useState(seed.unit   || "");
  // Slider state — fraction of the package still in the
  // container. Defaults to 1 (sealed) since most adds are
  // fresh-from-the-store; the user can drag it down to log
  // an item that's already been opened (e.g. a half-finished
  // jar of mustard moved over from another household).
  const [remaining,   setRemaining]   = useState(1);
  const [location, setLocation] = useState(seed.location || "fridge");
  // Food category (CLAUDE.md "CATEGORIES" axis). Resolved
  // from name inference when no manual pick has been made;
  // the override flag locks the value once the user has tapped
  // a different option in the picker so further name typing
  // doesn't clobber their choice.
  const [typeId, setTypeId] = useState(seed.typeId || null);
  const [typeOverridden, setTypeOverridden] = useState(!!seed.typeId);
  // Canonical (CLAUDE.md axis 2 — tan). Same auto-resolve +
  // override pattern as the category axis so the user types
  // "cheddar" and the picker pre-selects the cheese canonical
  // without them digging.
  const [canonicalId, setCanonicalId] = useState(seed.canonicalId || null);
  const [canonicalOverridden, setCanonicalOverridden] = useState(!!seed.canonicalId);
  // Stored In (CLAUDE.md axis 5 — blue #7eb8d4). Resolved from
  // the location's tile classifier on every relevant input
  // change so the user sees where the row will land before
  // submitting. Override flag locks the value once the user
  // has picked from the tile picker.
  const [tileId, setTileId] = useState(seed.tileId || null);
  const [tileOverridden, setTileOverridden] = useState(!!seed.tileId);
  const [pickerOpen, setPickerOpen] = useState(null); // null | "category" | "canonical" | "tile" | "unit"
  // Typeahead — suggestions floated under the Name input as
  // the user types. Tapping a suggestion locks the canonical
  // axis AND swaps the typed text for the canonical's display
  // name in one move (so "cheddar" → canonical: cheese, name:
  // "Cheese"). suppressUntilBlur lets us hide suggestions
  // immediately after a pick without fighting the input's
  // continued focus.
  const [nameFocused, setNameFocused]           = useState(false);
  const [suppressTypeahead, setSuppressTypeahead] = useState(false);
  // Barcode lookup retains the UPC string when the user
  // scanned (vs typed manually) so the submit row carries it
  // — future scans of the same UPC pick up corrections via
  // findBarcodeCorrection. Null on manual entry.
  const [barcodeUpc, setBarcodeUpc] = useState(seed.barcodeUpc || null);
  // Scanner overlay state. When `scanning` is true, the
  // BarcodeScanner mounts full-screen over the sheet. Lookup
  // status surfaces in `scanStatus` so the user sees
  // "Looking up…" → "Got it" / "Couldn't find that one."
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null); // null | "looking" | "found" | "miss" | "error"
  // Household-curated brand nutrition rows. Passed into
  // lookupBarcode so a UPC matched only by the family's saved
  // brand entries (no OFF / no USDA hit) still resolves —
  // matches classic Kitchen's scanner behavior.
  const { rows: brandNutritionRows } = useBrandNutrition();
  // Hook into the IngredientInfoProvider so the canonical
  // typeahead and picker can see admin-approved + user-created
  // DB canonicals alongside the 400 bundled ones. dbMap is the
  // raw fetched table; dbCanonicalsSnapshot() reads the
  // synthetic-canonical Map that registerCanonicalsFromDb
  // populates from dbMap on every refresh, so we depend on the
  // map identity to invalidate the merged search list.
  const { dbMap } = useIngredientInfo();
  // dbMap identity is the invalidation signal — when the
  // provider refreshes (initial fetch / admin approval /
  // realtime update), dbMap swaps reference and the snapshot
  // re-runs against the freshly-registered Map.
  const allCanonicals = useMemo(
    () => [...INGREDIENTS, ...dbCanonicalsSnapshot()],
    [dbMap]
  );
  // Top popular package sizes for the picked canonical. The
  // hook is brand-aware: when the user has typed a brand we
  // get brand-specific hits ranked first, with canonical-wide
  // observations filling the remainder. Idle (returns []) until
  // a canonical is set, which matches the cascade gate above.
  const { rows: popularPackages } = usePopularPackages(
    brand.trim() || null,
    canonicalId || null,
    3,
  );
  // Brand observations for the canonical-wide tier — same RPC,
  // null brand so we get every observation regardless of who
  // bought it. We dedupe + rank by count so the typeahead can
  // surface "Marketside" first when the household has bought a
  // watermelon under that brand before. Idle until the
  // canonical is pinned.
  const { rows: canonicalBrandObservations } = usePopularPackages(
    null,
    canonicalId || null,
    20,
  );
  const brandSuggestions = useMemo(() => {
    if (!canonicalId) return [];
    const counts = new Map();
    for (const r of canonicalBrandObservations) {
      const b = (r.brand || "").trim();
      if (!b) continue;
      counts.set(b, (counts.get(b) || 0) + (r.n || 1));
    }
    return Array.from(counts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([brand]) => brand);
  }, [canonicalId, canonicalBrandObservations]);
  const [brandFocused, setBrandFocused] = useState(false);
  const [suppressBrandTypeahead, setSuppressBrandTypeahead] = useState(false);
  const filteredBrandSuggestions = useMemo(() => {
    const q = brand.trim().toLowerCase();
    const list = q
      ? brandSuggestions.filter(b => b.toLowerCase().includes(q))
      : brandSuggestions;
    return list.slice(0, 6);
  }, [brand, brandSuggestions]);
  const nameSuggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (q.length < 2) return [];
    const exact = [];
    const starts = [];
    const includes = [];
    for (const ing of allCanonicals) {
      const lc = (ing.name || "").toLowerCase();
      if (!lc) continue;
      if (lc === q) exact.push(ing);
      else if (lc.startsWith(q)) starts.push(ing);
      else if (lc.includes(q))   includes.push(ing);
      if (exact.length + starts.length + includes.length >= 32) break;
    }
    return [...exact, ...starts, ...includes].slice(0, 6);
  }, [name, allCanonicals]);

  // Live name-inference for the category chip — runs only when
  // the user hasn't manually overridden. When the canonical is
  // pinned we infer against the canonical's display name first
  // (more authoritative than whatever the user typed) and fall
  // back to the typed name otherwise.
  useEffect(() => {
    if (typeOverridden) return;
    const ing = canonicalId ? findIngredient(canonicalId) : null;
    const sourceName = ing?.name || name;
    // inferFoodTypeFromName returns the matching food-type ID
    // string (or null), not an object — the previous read of
    // `.id` on the string left typeId perpetually null and
    // killed the cascade.
    const inferredId = inferFoodTypeFromName(sourceName);
    setTypeId(inferredId || null);
  }, [name, canonicalId, typeOverridden]);

  // Same pattern for the canonical chip — typing "cheddar"
  // resolves to the cheese / cheddar canonical so the chip
  // can pre-select. Override flag locks the picked value
  // against further typing.
  useEffect(() => {
    if (canonicalOverridden) return;
    const id = inferCanonicalFromName(name);
    setCanonicalId(id || null);
  }, [name, canonicalOverridden]);

  // Resolve the Stored In tile via the location's classifier.
  // Synthesizes a draft item from the current axis state and
  // hands it to fridgeTileFor / pantryTileFor / freezerTileFor
  // (whichever matches the active location). The classifier
  // expects `ingredientId` (legacy field name, predates the
  // canonical-axis rename) so we pass the canonical there.
  // Without that mapping every row would short-circuit to the
  // location's category fallback ("dairy" for fridge), which
  // is exactly what was happening before this fix.
  useEffect(() => {
    if (tileOverridden) return;
    const loc = LOCATIONS.find(l => l.id === location);
    if (!loc) return;
    const ing = canonicalId ? findIngredient(canonicalId) : null;
    const draft = {
      name: name.trim(),
      ingredientId: canonicalId || null,
      typeId: typeId || null,
      // Use the canonical's own category when we have one, so
      // the classifier's category-routing path (meat → meat_poultry,
      // produce → produce, etc.) fires for canonicals we know
      // about. Falls back to the location default only when no
      // canonical is set — at which point the pills are hidden
      // anyway per the canonical-pin gate above.
      category: ing?.category || defaultCategoryForLocation(location),
    };
    const id = loc.classify(draft, { findIngredient, hubForIngredient });
    setTileId(id || null);
  }, [name, canonicalId, typeId, location, tileOverridden]);

  const canSubmit = name.trim().length > 0;

  const handleScan = async (upc) => {
    setBarcodeUpc(upc);
    setScanning(false);
    setScanStatus("looking");
    try {
      // Run the OFF/USDA lookup and the prior-correction lookup
      // in parallel — they're independent reads. The correction
      // is the higher tier per CLAUDE.md's resolution cascade
      // (family + global corrections beat raw OFF data), so its
      // values win when both surface a hint for the same axis.
      const [res, correction] = await Promise.all([
        lookupBarcode(upc, { brandNutritionRows }),
        findBarcodeCorrection(upc).catch(err => {
          console.warn("[mcm-add] correction read failed:", err?.message || err);
          return null;
        }),
      ]);
      // Apply the correction's location whenever one was taught.
      // The user is initiating the scan, so they expect prior
      // teachings to win over the form's default seed. They can
      // still re-pick after, and that re-pick writes back via
      // rememberBarcodeCorrection on submit.
      if (correction?.location) setLocation(correction.location);
      // Tile correction beats the live classifier. Lock the
      // override so subsequent name/canonical edits don't
      // re-run the classifier and stomp the user's prior pick.
      if (correction?.tileId) {
        setTileId(correction.tileId);
        setTileOverridden(true);
      }

      if (!res || !res.found) {
        // Soft miss — but if a correction surfaced, that's still
        // useful (we filled in location). Otherwise it's a true
        // dead-end and the user types it in by hand.
        setScanStatus(correction ? "found" : "miss");
        return;
      }
      // Pre-fill fields. Don't overwrite user-typed name/brand
      // if they exist — scanning into a partially-filled form
      // shouldn't clobber what the user already entered.
      if (!name.trim() && res.productName) setName(res.productName);
      if (!brand.trim() && res.brand)      setBrand(res.brand);
      const pkg = res.quantity ? parsePackageSize(res.quantity) : null;
      if (!packageSize && pkg?.amount != null) setPackageSize(String(pkg.amount));
      if (!unit        && pkg?.unit)           setUnit(pkg.unit);
      // Fresh scan = brand-new package. Snap the slider back to
      // sealed/full so the user starts from the natural state.
      setRemaining(1);
      // Seed the category from OFF tag hints if the user hasn't
      // already overridden. tagHintsToAxes maps the OFF
      // category vocabulary into our internal typeId.
      if (Array.isArray(res.categoryHints) && res.categoryHints.length > 0) {
        const axes = tagHintsToAxes(res.categoryHints);
        if (!typeOverridden && axes.typeId) setTypeId(axes.typeId);
        if (!tileOverridden && axes.tileId) setTileId(axes.tileId);
      }
      // Seed the canonical from a direct lookupBarcode hit when
      // present. Same don't-clobber-override rule.
      if (!canonicalOverridden && res.canonicalId) {
        setCanonicalId(res.canonicalId);
      }
      setScanStatus("found");
    } catch (e) {
      console.warn("[mcm-add] scan lookup failed:", e?.message || e);
      setScanStatus("error");
    }
  };

  // Esc closes — same keyboard pattern PantryScreen uses for
  // its sticky surfaces.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const cat = defaultCategoryForLocation(location);
    // Self-teaching write — when the user scanned a barcode and
    // landed in this sheet, whatever LOCATION they confirm here
    // becomes the household-scoped (or global, for admins) answer
    // for that UPC. Next scan of the same product picks the
    // location up via findBarcodeCorrection without asking again.
    // Fire-and-forget per CLAUDE.md: a correction-write failure
    // must never block the add flow.
    if (barcodeUpc && userId) {
      rememberBarcodeCorrection({
        userId,
        isAdmin: !!isAdmin,
        barcodeUpc,
        location,
        tileId: tileId || null,
        typeId: typeId || null,
        canonicalId: canonicalId || null,
      }).catch(err => console.warn("[mcm-add] correction write failed:", err?.message || err));
    }
    // Convert package size + remaining fraction into the
    // amount/max pair the rest of the app reads. amount === max
    // means SEALED; amount < max means OPENED with that fraction
    // left. Empty package size leaves both null so the row falls
    // back to a quantity-less entry (the gauge hides itself in
    // that mode — see PantryCard).
    const pkgN  = packageSize ? Number(packageSize) : null;
    const maxN  = Number.isFinite(pkgN) && pkgN > 0 ? pkgN : null;
    const amtN  = maxN != null ? Math.max(0, Math.min(1, remaining)) * maxN : null;
    onSubmit && onSubmit({
      name: name.trim(),
      brand: brand.trim() || null,
      amount: amtN,
      max:    maxN,
      unit: unit.trim() || null,
      category: cat,
      typeId: typeId || null,
      canonicalId: canonicalId || null,
      location,
      // Resolved tile from the live classifier (or user
      // override). Falls back to null when the classifier
      // can't pick a tile for this location; the parent
      // setPantry path lets the existing classify logic fill
      // the gap if so.
      tileId: tileId || null,
      // No expiration set on manual add by default (user can
      // edit after). Days-chip will be empty.
      expiresAt: null,
      // Carry the scanned UPC (when present) so future scans
      // of the same barcode pick up corrections via
      // findBarcodeCorrection.
      barcodeUpc: barcodeUpc || null,
    });
  };

  const inputBase = {
    width: "100%",
    border: `1px solid ${theme.color.hairline}`,
    background: theme.color.glassFillHeavy,
    color: theme.color.ink,
    borderRadius: 12,
    padding: "12px 14px",
    fontFamily: font.sans,
    fontSize: 15,
    outline: "none",
    boxShadow: theme.shadow.inputInset,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add an item to the kitchen"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(20,12,4,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={(e) => {
        // Backdrop click closes — only when the click target
        // is the backdrop itself, not the sheet content.
        if (e.target === e.currentTarget) onClose && onClose();
      }}
    >
      <motion.div
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 32, opacity: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        style={{
          width: "100%",
          maxWidth: 520,
          margin: "0 12px 24px",
          padding: 22,
          borderRadius: 20,
          background: theme.color.glassFillHeavy,
          border: `1px solid ${theme.color.glassBorder}`,
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          boxShadow: "0 24px 60px rgba(20,12,4,0.40), 0 4px 16px rgba(20,12,4,0.20)",
          ...THEME_TRANSITION,
        }}
      >
        {/* Header — kicker + title with the live Category pill
            pinned to the top-right. The pill renders as a
            status indicator: orange (theme.color.burnt) when
            our auto-resolve / scan landed on a category,
            dashed muted when nothing has resolved yet. Tap
            opens the full picker so the user can override.
            Sits inside the header row so it never collides
            with the form below. */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Kicker tone={theme.color.inkFaint}>Add to kitchen</Kicker>
            <div style={{
              fontFamily: font.display,
              fontSize: 28,
              fontWeight: 400,
              letterSpacing: "0.025em",
              color: theme.color.ink,
              marginTop: 4,
              marginBottom: 18,
              lineHeight: 1.05,
            }}>
              What's new on the shelf?
            </div>
          </div>
          {/* Right-rail status pills — Category (orange) and
              Stored In (blue) per CLAUDE.md reserved colors.
              Hidden until the canonical is pinned: with no
              canonical the inferred values are noisy guesses
              (or empty) and showing the pills implies a
              decision the user hasn't made yet. Once a
              canonical lands the cascade fills both pills with
              real metadata, so they appear together. */}
          {canonicalId && (
          <motion.div
            // Fade + slide-in when the pills appear so the cascade
            // feels alive rather than popping in. Subtle enough to
            // not pull focus from the Name input the user is
            // probably still hovering near.
            initial={{ opacity: 0, x: 8, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "flex-end",
              gap: 6, flexShrink: 0, marginTop: 2,
            }}
          >
            {(() => {
              const t = typeId ? findFoodType(typeId) : null;
              const tone = theme.color.burnt;
              // Reuse the tile-icon SVG fallback chain for the
              // food type by walking through its defaultTileId
              // (e.g. wweia_cheese.defaultTileId === "dairy" →
              // /icons/tiles/dairy.svg). Falls back to the
              // type's own emoji when no SVG exists.
              const svg = t?.defaultTileId
                ? tileIconFor(t.defaultTileId, t.defaultTileId === "frozen" ? "freezer" : null)
                : null;
              return (
                <button
                  type="button"
                  className="mcm-focusable"
                  onClick={() => setPickerOpen("category")}
                  aria-label={t ? `Category: ${t.label}` : "Pick a category"}
                  title={t ? `Category · ${t.label}` : "Pick a category"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40, height: 40,
                    padding: 0,
                    borderRadius: 999,
                    border: t
                      ? `1px solid ${withAlpha(tone, 0.45)}`
                      : `1px dashed ${theme.color.hairline}`,
                    background: t
                      ? `linear-gradient(${withAlpha(tone, 0.18)}, ${withAlpha(tone, 0.18)}), ${theme.color.glassFillHeavy}`
                      : "transparent",
                    color: t ? theme.color.ink : theme.color.inkMuted,
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "background 200ms ease, border-color 200ms ease",
                  }}
                >
                  {t ? (
                    svg ? (
                      <img
                        src={svg}
                        alt=""
                        aria-hidden
                        style={{
                          width: 26, height: 26, objectFit: "contain",
                          filter: "drop-shadow(0 1px 2px rgba(30,20,8,0.18))",
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: 20, lineHeight: 1 }}>{t.emoji}</span>
                    )
                  ) : (
                    <span style={{
                      fontFamily: font.detail, fontStyle: "italic",
                      fontSize: 13,
                    }}>+</span>
                  )}
                </button>
              );
            })()}
            {(() => {
              const loc = LOCATIONS.find(l => l.id === location);
              const tile = loc && tileId ? loc.tiles.find(x => x.id === tileId) : null;
              const tone = "#7eb8d4"; // blue — reserved STORED IN color
              // tileIconFor handles the location-prefixed lookup
              // for distinct misc-per-location icons.
              const svg = tile ? tileIconFor(tile.id, location) : null;
              return (
                <button
                  type="button"
                  className="mcm-focusable"
                  onClick={() => setPickerOpen("tile")}
                  aria-label={tile ? `Stored in: ${tile.label}` : "Pick a shelf"}
                  title={tile ? `Stored in · ${tile.label}` : "Pick a shelf"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40, height: 40,
                    padding: 0,
                    borderRadius: 999,
                    border: tile
                      ? `1px solid ${withAlpha(tone, 0.45)}`
                      : `1px dashed ${theme.color.hairline}`,
                    background: tile
                      ? `linear-gradient(${withAlpha(tone, 0.18)}, ${withAlpha(tone, 0.18)}), ${theme.color.glassFillHeavy}`
                      : "transparent",
                    color: tile ? theme.color.ink : theme.color.inkMuted,
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "background 200ms ease, border-color 200ms ease",
                  }}
                >
                  {tile ? (
                    svg ? (
                      <img
                        src={svg}
                        alt=""
                        aria-hidden
                        style={{
                          width: 26, height: 26, objectFit: "contain",
                          filter: "drop-shadow(0 1px 2px rgba(30,20,8,0.18))",
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: 20, lineHeight: 1 }}>{tile.emoji}</span>
                    )
                  ) : (
                    <span style={{
                      fontFamily: font.detail, fontStyle: "italic",
                      fontSize: 13,
                    }}>+</span>
                  )}
                </button>
              );
            })()}
          </motion.div>
          )}
        </div>

        {scanStatus && (
          <div
            role="status"
            aria-live="polite"
            style={{
              fontFamily: font.sans,
              fontSize: 12,
              letterSpacing: "0.02em",
              color: scanStatus === "found"
                ? theme.color.teal
                : scanStatus === "looking"
                  ? theme.color.inkMuted
                  : theme.color.burnt,
              marginTop: -8,
              marginBottom: 14,
              paddingLeft: 4,
            }}
          >
            {scanStatus === "looking" && "Looking that one up…"}
            {scanStatus === "found"   && "Got it — fields filled below."}
            {scanStatus === "miss"    && "Couldn't find that barcode. Fill it in by hand."}
            {scanStatus === "error"   && "Lookup hit a snag. Try again or fill it in by hand."}
          </div>
        )}

        {/* Name + canonical typeahead — as the user types we
            float a dropdown of matching canonical ingredients
            below the input. Picking a row swaps the text for
            the canonical's display name AND locks the
            canonicalId axis in one tap (same self-teaching
            cascade as classic Kitchen, just folded into the
            primary entry control). The scan button sits pinned
            to the right edge of the same input so the second
            entry path (scan a barcode) lives in the same
            visual row. */}
        <FieldLabel theme={theme}>Name</FieldLabel>
        <div style={{ position: "relative" }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setSuppressTypeahead(false); }}
            onFocus={() => setNameFocused(true)}
            onBlur={() => {
              // Defer the close so a click on a suggestion
              // row lands before this blur unmounts it. 120ms
              // tracks the suggestion list's animation budget.
              setTimeout(() => setNameFocused(false), 120);
            }}
            placeholder="e.g. Sourdough Loaf"
            style={{
              ...inputBase,
              // Filmotype Honey matches item-card name face so
              // the user sees a typographic preview of how the
              // row will read on the shelf. Honey reads small for
              // its em-box, so we run it ~2x the body size with
              // tight line-height — same rule applied to the
              // shelf row (PantryCard) below.
              fontFamily: font.itemName,
              fontWeight: 300,
              fontSize: 32,
              lineHeight: 1,
              // Right padding clears the pinned scan button
              // (40px circle + 12px margin) so long typed
              // names don't collide with the icon.
              paddingRight: 56,
            }}
          />
          <button
            type="button"
            className="mcm-focusable"
            onClick={() => { setScanStatus(null); setScanning(true); }}
            aria-label="Scan a barcode"
            title="Scan a barcode"
            style={{
              position: "absolute",
              top: "50%",
              right: 8,
              transform: "translateY(-50%)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40, height: 40,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              transition: "transform 120ms ease, opacity 120ms ease",
            }}
          >
            <img
              src="/icons/upc_scanner.svg"
              alt=""
              aria-hidden
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                display: "block",
                filter: "drop-shadow(0 1px 2px rgba(30,30,30,0.18))",
              }}
            />
          </button>
          {nameFocused && !suppressTypeahead && (nameSuggestions.length > 0 || name.trim().length >= 2) && (
            <div
              role="listbox"
              aria-label="Canonical suggestions"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0, right: 0,
                zIndex: 5,
                padding: 6,
                borderRadius: 14,
                background: theme.color.glassFillHeavy,
                border: `1px solid ${theme.color.glassBorder}`,
                backdropFilter: "blur(20px) saturate(150%)",
                WebkitBackdropFilter: "blur(20px) saturate(150%)",
                boxShadow: "0 18px 36px rgba(20,12,4,0.28), 0 4px 12px rgba(20,12,4,0.16)",
                ...THEME_TRANSITION,
              }}
            >
              {nameSuggestions.map(ing => (
                <button
                  key={ing.id}
                  type="button"
                  role="option"
                  aria-selected={ing.id === canonicalId}
                  className="mcm-focusable"
                  // onMouseDown fires before onBlur on the input,
                  // so the pick lands without a click being lost.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setName(ing.name);
                    setCanonicalId(ing.id);
                    setCanonicalOverridden(true);
                    // Unlock the downstream axes so the
                    // category + tile re-derive against the
                    // freshly-picked canonical's metadata. The
                    // user picking a canonical means they
                    // trust our cascade — any prior manual
                    // category / tile override should release
                    // so the new canonical drives those values.
                    setTypeOverridden(false);
                    setTileOverridden(false);
                    setSuppressTypeahead(true);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    width: "100%",
                    padding: "8px 10px",
                    margin: "1px 0",
                    borderRadius: 10,
                    border: "1px solid transparent",
                    background: ing.id === canonicalId
                      ? `linear-gradient(${withAlpha("#b8a878", 0.18)}, ${withAlpha("#b8a878", 0.18)}), transparent`
                      : "transparent",
                    cursor: "pointer", textAlign: "left",
                    color: theme.color.ink,
                    transition: "background 140ms ease",
                  }}
                  onMouseEnter={(e) => { if (ing.id !== canonicalId) e.currentTarget.style.background = withAlpha(theme.color.ink, 0.05); }}
                  onMouseLeave={(e) => { if (ing.id !== canonicalId) e.currentTarget.style.background = "transparent"; }}
                >
                  {ing.emoji && <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{ing.emoji}</span>}
                  <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 500 }}>
                      {ing.name}
                    </span>
                    {ing.category && (
                      <span style={{
                        fontFamily: font.detail, fontStyle: "italic", fontWeight: 400,
                        fontSize: 12, color: theme.color.inkMuted, marginTop: 1,
                      }}>
                        {ing.category}
                      </span>
                    )}
                  </span>
                  {ing.id === canonicalId && (
                    <span style={{ color: "#b8a878", fontSize: 14 }}>✓</span>
                  )}
                </button>
              ))}
              {/* No-results escape hatch — when the typed name
                  doesn't match any bundled canonical, surface a
                  "+ Add canonical" row that creates a new
                  user-scoped canonical from the typed text.
                  Slug-cases the input so the underlying
                  pantry_items.canonical_id stays URL-safe; the
                  CLAUDE.md self-teaching cascade picks it up
                  the same as a bundled slug. */}
              {nameSuggestions.length === 0 && name.trim().length >= 2 && (
                <button
                  type="button"
                  role="option"
                  className="mcm-focusable"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const slug = name.trim().toLowerCase()
                      .replace(/[^a-z0-9]+/g, "_")
                      .replace(/^_+|_+$/g, "");
                    if (!slug) return;
                    setCanonicalId(slug);
                    setCanonicalOverridden(true);
                    setTypeOverridden(false);
                    setTileOverridden(false);
                    setSuppressTypeahead(true);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    width: "100%",
                    padding: "10px 10px",
                    margin: "1px 0",
                    borderRadius: 10,
                    border: `1px dashed ${withAlpha("#b8a878", 0.45)}`,
                    background: "transparent",
                    cursor: "pointer", textAlign: "left",
                    color: theme.color.ink,
                    transition: "background 140ms ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha("#b8a878", 0.10); }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{
                    fontSize: 18, lineHeight: 1, flexShrink: 0,
                    color: "#b8a878",
                  }}>+</span>
                  <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 500 }}>
                      Add "{name.trim()}" as a new canonical
                    </span>
                    <span style={{
                      fontFamily: font.detail, fontStyle: "italic", fontWeight: 400,
                      fontSize: 12, color: theme.color.inkMuted, marginTop: 1,
                    }}>
                      Saved to your kitchen — admin can promote later.
                    </span>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Package size — single bar with a typeable amount on
            the left and a unit dropdown pinned right. Unit
            options are derived from the active canonical's
            `units` array (so "butter" gets stick / tbsp / cup /
            oz / lb / block / tub / g), with a sane default
            list as fallback when no canonical is set. The
            dropdown is a chip → ModalSheet picker per the
            CLAUDE.md "no <select> for axes" rule. */}
        <FieldLabel theme={theme} style={{ marginTop: 14 }}>Package size</FieldLabel>
        <div style={{
          display: "flex", alignItems: "stretch", gap: 0,
          border: `1px solid ${theme.color.hairline}`,
          background: theme.color.glassFillHeavy,
          borderRadius: 12,
          boxShadow: theme.shadow.inputInset,
          overflow: "hidden",
        }}>
          <input
            type="number"
            inputMode="decimal"
            value={packageSize}
            onChange={(e) => setPackageSize(e.target.value)}
            placeholder="16"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              color: theme.color.ink,
              padding: "12px 14px",
              fontFamily: font.itemSub,
              fontSize: 16,
              outline: "none",
            }}
          />
          {(() => {
            const ing = canonicalId ? findIngredient(canonicalId) : null;
            const units = ing?.units && ing.units.length > 0
              ? ing.units
              : DEFAULT_UNIT_OPTIONS;
            const active = units.find(u => u.id === unit) || null;
            return (
              <button
                type="button"
                className="mcm-focusable"
                onClick={() => setPickerOpen("unit")}
                aria-label={active ? `Unit: ${active.label}` : "Pick a unit"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: "none",
                  borderLeft: `1px solid ${theme.color.hairline}`,
                  background: "transparent",
                  color: unit ? theme.color.ink : theme.color.inkMuted,
                  padding: "0 14px",
                  fontFamily: font.itemSub,
                  fontSize: 16,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  minWidth: 96,
                  justifyContent: "space-between",
                }}
              >
                <span>{active ? active.label : (unit || "unit")}</span>
                <span aria-hidden style={{ fontSize: 11, color: theme.color.inkFaint }}>▾</span>
              </button>
            );
          })()}
        </div>

        {/* Popular-package quick-picks — surfaced once a canonical
            is pinned. Reads from popular_package_sizes (RPC),
            ranked brand-first then canonical-wide. Tap a chip to
            slam both Package size and Unit at once; the chip
            highlights when its values match the current pair so
            the user sees what's currently selected. */}
        {canonicalId && popularPackages.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{
              fontFamily: font.mono, fontSize: 10,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: theme.color.inkFaint,
              marginBottom: 6,
            }}>
              Popular sizes
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {popularPackages.map((p, i) => {
                const active = Number(packageSize) === p.amount && (unit || "").toLowerCase() === (p.unit || "").toLowerCase();
                const fmt = (n) => Number.isInteger(n) ? String(n) : Number(n).toFixed(1);
                return (
                  <button
                    key={`${p.amount}-${p.unit}-${i}`}
                    type="button"
                    className="mcm-focusable"
                    onClick={() => {
                      setPackageSize(String(p.amount));
                      setUnit(p.unit || "");
                      setRemaining(1);
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: active
                        ? `1px solid ${withAlpha(theme.color.teal, 0.55)}`
                        : `1px solid ${theme.color.hairline}`,
                      background: active
                        ? `linear-gradient(${withAlpha(theme.color.teal, 0.18)}, ${withAlpha(theme.color.teal, 0.18)}), ${theme.color.glassFillHeavy}`
                        : "transparent",
                      color: active ? theme.color.ink : theme.color.inkMuted,
                      fontFamily: font.detail,
                      fontStyle: "italic",
                      fontWeight: 400,
                      fontSize: 13,
                      cursor: "pointer",
                      transition: "background 160ms ease, border-color 160ms ease",
                    }}
                  >
                    <span>{fmt(p.amount)} {p.unit}</span>
                    {p.brand && (
                      <span style={{
                        fontFamily: font.mono, fontSize: 9,
                        color: theme.color.inkFaint,
                        letterSpacing: "0.04em",
                      }}>
                        · {p.brand}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Remaining slider — only renders once the package size
            is set (you can't visualize "what's left" without
            knowing the full container). Defaults to sealed/full
            so a fresh-from-the-store add reads as 100%. Drag to
            log an item that's already been opened (e.g. moving
            a half-finished jar over from another household).
            Mirrors classic Kitchen's amount/max model: amount
            === max → SEALED, amount < max → OPENED. */}
        {(() => {
          const pkgN = Number(packageSize);
          if (!Number.isFinite(pkgN) || pkgN <= 0) return null;
          const remainingAmount = pkgN * Math.max(0, Math.min(1, remaining));
          const isSealed = remaining >= 0.999;
          const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1);
          const sliderColor = isSealed ? theme.color.teal : theme.color.burnt;
          return (
            <div style={{ marginTop: 14 }}>
              <div style={{
                display: "flex", alignItems: "baseline", justifyContent: "space-between",
                marginBottom: 6,
              }}>
                <span style={{
                  fontFamily: font.mono, fontSize: 11,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: isSealed ? theme.color.teal : theme.color.burnt,
                  fontWeight: 600,
                }}>
                  {isSealed ? "Sealed" : "Opened"}
                </span>
                <span style={{
                  fontFamily: font.mono, fontSize: 12,
                  color: theme.color.inkMuted,
                }}>
                  {fmt(remainingAmount)} / {fmt(pkgN)} {unit || ""}
                </span>
              </div>
              <input
                type="range"
                min="0" max="1" step="0.01"
                value={remaining}
                onChange={(e) => setRemaining(Number(e.target.value))}
                aria-label="How much is left in the package"
                style={{
                  width: "100%",
                  accentColor: sliderColor,
                  // Tap targets — bigger thumb on touch devices
                  // via accentColor + the input's native min height
                  // already provides this on iOS / Android.
                }}
              />
            </div>
          );
        })()}

        {/* Brand — typeahead surfaces the household's previously-
            seen brands for the active canonical (sourced from
            popular_package_sizes, ranked by observation count).
            "Marketside" surfaces first for watermelon if the
            household has bought a Marketside watermelon before.
            Free-text still works — the input is the source of
            truth, suggestions just shortcut the common cases. */}
        <FieldLabel theme={theme} style={{ marginTop: 14 }}>Brand <span style={{ opacity: 0.5 }}>(optional)</span></FieldLabel>
        <div style={{ position: "relative" }}>
          <input
            value={brand}
            onChange={(e) => { setBrand(e.target.value); setSuppressBrandTypeahead(false); }}
            onFocus={() => setBrandFocused(true)}
            onBlur={() => { setTimeout(() => setBrandFocused(false), 120); }}
            placeholder="e.g. Kerrygold"
            style={inputBase}
          />
          {brandFocused && !suppressBrandTypeahead && filteredBrandSuggestions.length > 0 && (
            <div
              role="listbox"
              aria-label="Brand suggestions"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0, right: 0,
                zIndex: 5,
                padding: 6,
                borderRadius: 14,
                background: theme.color.glassFillHeavy,
                border: `1px solid ${theme.color.glassBorder}`,
                backdropFilter: "blur(20px) saturate(150%)",
                WebkitBackdropFilter: "blur(20px) saturate(150%)",
                boxShadow: "0 18px 36px rgba(20,12,4,0.28), 0 4px 12px rgba(20,12,4,0.16)",
                ...THEME_TRANSITION,
              }}
            >
              {filteredBrandSuggestions.map(b => {
                const active = b.toLowerCase() === brand.trim().toLowerCase();
                return (
                  <button
                    key={b}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="mcm-focusable"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setBrand(b);
                      setSuppressBrandTypeahead(true);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      width: "100%",
                      padding: "8px 10px",
                      margin: "1px 0",
                      borderRadius: 10,
                      border: "1px solid transparent",
                      background: active
                        ? `linear-gradient(${withAlpha(theme.color.teal, 0.16)}, ${withAlpha(theme.color.teal, 0.16)}), transparent`
                        : "transparent",
                      cursor: "pointer", textAlign: "left",
                      color: theme.color.ink,
                      transition: "background 140ms ease",
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = withAlpha(theme.color.ink, 0.05); }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 500, flex: 1 }}>
                      {b}
                    </span>
                    {active && <span style={{ color: theme.color.teal, fontSize: 14 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Location segmented row — matches FloatingLocationDock
            color treatment so users see the same swatch system
            here as on the dock. */}
        <FieldLabel theme={theme} style={{ marginTop: 14 }}>Where does it go?</FieldLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 4 }}>
          {LOCATIONS.map((loc) => {
            const active = location === loc.id;
            const dotColor = LOCATION_DOT[loc.id];
            return (
              <button
                key={loc.id}
                type="button"
                className="mcm-focusable"
                onClick={() => setLocation(loc.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "10px 8px",
                  borderRadius: 12,
                  border: active
                    ? `1px solid ${withAlpha(dotColor, 0.45)}`
                    : `1px solid ${theme.color.hairline}`,
                  background: active
                    ? `linear-gradient(${withAlpha(dotColor, 0.18)}, ${withAlpha(dotColor, 0.18)}), ${theme.color.glassFillHeavy}`
                    : "transparent",
                  color: active ? theme.color.ink : theme.color.inkMuted,
                  fontFamily: font.sans,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "background 200ms ease, color 200ms ease, border-color 200ms ease",
                }}
              >
                <span style={{
                  display: "inline-block",
                  width: 8, height: 8,
                  borderRadius: "50%",
                  background: dotColor,
                  boxShadow: `0 1px 2px rgba(30,20,8,0.20)`,
                }} />
                {loc.label}
              </button>
            );
          })}
        </div>

        {/* Action row */}
        <div style={{
          display: "flex", gap: 10, marginTop: 22,
          justifyContent: "flex-end",
        }}>
          <button
            type="button"
            className="mcm-focusable"
            onClick={onClose}
            style={{
              padding: "12px 18px",
              borderRadius: 999,
              border: `1px solid ${theme.color.hairline}`,
              background: "transparent",
              color: theme.color.inkMuted,
              fontFamily: font.sans, fontSize: 14, fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <PrimaryButton
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: "12px 22px",
              fontSize: 14,
              opacity: canSubmit ? 1 : 0.45,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            Add to kitchen
          </PrimaryButton>
        </div>
      </motion.div>

      {/* Barcode scanner overlay — mounts full-screen above the
          sheet when the user taps "Scan a barcode". Owns its own
          camera stream; tearing down on close is the scanner's
          responsibility. handleScan also flips `scanning` off so
          the overlay unmounts cleanly after a successful read. */}
      {scanning && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "#000",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <BarcodeScanner
            onDetected={handleScan}
            onCancel={() => setScanning(false)}
          />
        </div>
      )}

      {pickerOpen === "category" && (
        <MCMPickerSheet
          kicker="Category"
          title="What category does this fit?"
          accent={theme.color.burnt}
          options={FOOD_TYPES.map(t => ({
            id: t.id, label: t.label, emoji: t.emoji, sub: t.blurb,
          }))}
          value={typeId}
          onPick={(id) => {
            setTypeId(id);
            setTypeOverridden(true);
            setPickerOpen(null);
          }}
          onClose={() => setPickerOpen(null)}
        />
      )}
      {pickerOpen === "unit" && (() => {
        const ing = canonicalId ? findIngredient(canonicalId) : null;
        const units = ing?.units && ing.units.length > 0
          ? ing.units
          : DEFAULT_UNIT_OPTIONS;
        return (
          <MCMPickerSheet
            kicker="Unit"
            title={ing ? `Pick a unit for ${ing.name}` : "Pick a unit"}
            accent={theme.color.teal}
            options={units.map(u => ({
              id: u.id,
              label: u.label || u.id,
              // Sub line shows the canonical's default if any —
              // helps users see which unit is the "natural" one
              // for that ingredient (e.g. butter → sticks).
              sub: ing?.defaultUnit === u.id ? "default" : null,
            }))}
            value={unit}
            onPick={(id) => { setUnit(id); setPickerOpen(null); }}
            onClose={() => setPickerOpen(null)}
          />
        );
      })()}
      {pickerOpen === "tile" && (() => {
        const loc = LOCATIONS.find(l => l.id === location);
        const tiles = loc?.tiles || [];
        return (
          <MCMPickerSheet
            kicker="Stored in"
            title={`Which ${loc?.label.toLowerCase() || "shelf"} tile?`}
            accent="#7eb8d4"
            options={tiles.map(t => ({
              id: t.id, label: t.label, emoji: t.emoji, sub: t.blurb,
            }))}
            value={tileId}
            onPick={(id) => {
              setTileId(id);
              setTileOverridden(true);
              setPickerOpen(null);
            }}
            onClose={() => setPickerOpen(null)}
          />
        );
      })()}
      {pickerOpen === "canonical" && (
        <MCMPickerSheet
          kicker="Canonical"
          title="Which ingredient is this?"
          accent="#b8a878"
          options={allCanonicals.map(ing => ({
            id: ing.id,
            label: ing.name,
            emoji: ing.emoji,
            // Sub line uses the category as a quick scope
            // signal so two similarly-named canonicals
            // (e.g. "milk" dairy vs "coconut milk" pantry)
            // are distinguishable mid-list.
            sub: ing.category ? ing.category : null,
          }))}
          value={canonicalId}
          onPick={(id) => {
            setCanonicalId(id);
            setCanonicalOverridden(true);
            setPickerOpen(null);
          }}
          onClose={() => setPickerOpen(null)}
        />
      )}
    </div>
  );
}

// MCMPickerSheet — chip → modal-sheet picker per the CLAUDE.md
// item-reference visual pattern. Bottom-anchored sheet, kicker
// + title, searchable list, tap-to-select with active-row tint
// in the axis accent color. Used by the AddDraftSheet's category
// chip; reused by upcoming Stored In + State pickers.
function MCMPickerSheet({ kicker, title, options = [], value, onPick, onClose, accent }) {
  const { theme } = useTheme();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => {
      if ((o.label || "").toLowerCase().includes(q)) return true;
      if ((o.sub   || "").toLowerCase().includes(q)) return true;
      // Optional `keywords` array — callers attach extra search
      // tokens (canonical aliases, common alternate names) so
      // typing "cheddar" finds the broader cheese canonical even
      // when the canonical's label is just "Cheese".
      if (Array.isArray(o.keywords) && o.keywords.some(k => (k || "").toLowerCase().includes(q))) return true;
      return false;
    });
  }, [options, query]);

  // Esc closes — same keyboard pattern as the AddDraftSheet
  // itself.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(20,12,4,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
    >
      <motion.div
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "78vh",
          margin: "0 12px 24px",
          padding: "20px 18px 14px",
          borderRadius: 20,
          background: theme.color.glassFillHeavy,
          border: `1px solid ${theme.color.glassBorder}`,
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          boxShadow: "0 24px 60px rgba(20,12,4,0.40), 0 4px 16px rgba(20,12,4,0.20)",
          display: "flex", flexDirection: "column",
          ...THEME_TRANSITION,
        }}
      >
        <div style={{
          fontFamily: font.mono, fontSize: 11,
          letterSpacing: "0.16em", textTransform: "uppercase",
          color: accent || theme.color.inkMuted,
          fontWeight: 600,
        }}>
          {kicker}
        </div>
        <div style={{
          fontFamily: font.serif, fontStyle: "italic", fontWeight: 300,
          fontSize: 22, color: theme.color.ink,
          marginTop: 4, marginBottom: 14, letterSpacing: "-0.01em",
        }}>
          {title}
        </div>
        {options.length > 8 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            style={{
              width: "100%",
              border: `1px solid ${theme.color.hairline}`,
              background: theme.color.glassFillHeavy,
              color: theme.color.ink,
              borderRadius: 10,
              padding: "10px 12px",
              fontFamily: font.sans, fontSize: 14,
              outline: "none",
              boxShadow: theme.shadow.inputInset,
              marginBottom: 10,
            }}
          />
        )}
        <div style={{ overflowY: "auto", margin: "0 -4px" }}>
          {filtered.map(o => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                className="mcm-focusable"
                onClick={() => onPick && onPick(o.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  width: "100%",
                  padding: "10px 12px",
                  margin: "2px 0",
                  borderRadius: 12,
                  border: active
                    ? `1px solid ${withAlpha(accent || theme.color.ink, 0.45)}`
                    : "1px solid transparent",
                  background: active
                    ? `linear-gradient(${withAlpha(accent || theme.color.ink, 0.16)}, ${withAlpha(accent || theme.color.ink, 0.16)}), transparent`
                    : "transparent",
                  cursor: "pointer", textAlign: "left",
                  color: theme.color.ink,
                  transition: "background 160ms ease, border-color 160ms ease",
                }}
              >
                {o.emoji && (
                  <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{o.emoji}</span>
                )}
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontFamily: font.sans, fontSize: 15, fontWeight: 500,
                    color: theme.color.ink,
                  }}>
                    {o.label}
                  </span>
                  {o.sub && (
                    <span style={{
                      fontFamily: font.detail, fontStyle: "italic", fontWeight: 400,
                      fontSize: 13, color: theme.color.inkMuted, marginTop: 1,
                    }}>
                      {o.sub}
                    </span>
                  )}
                </span>
                {active && (
                  <span style={{ color: accent || theme.color.ink, fontSize: 16 }}>✓</span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{
              padding: "16px 12px",
              fontFamily: font.sans, fontSize: 13,
              color: theme.color.inkMuted, textAlign: "center",
            }}>
              Nothing matches "{query}".
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// Field label primitive — small DM Mono uppercase kicker
// above each input. Pulled into a helper so the label voice
// stays consistent across the form's six fields.
function FieldLabel({ theme, children, style }) {
  return (
    <div style={{
      fontFamily: font.mono,
      fontSize: 10,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: theme.color.inkFaint,
      marginBottom: 6,
      ...style,
    }}>
      {children}
    </div>
  );
}

// Coarse default — when the user picks Fridge / Pantry /
// Freezer in the add form, infer a category bucket so the
// classifier can tile the row. Mirrors defaultLocationForCategory
// in reverse (the inverse mapping). User can re-tile after the
// row lands via the existing edit flow.
function defaultCategoryForLocation(location) {
  if (location === "freezer") return "frozen";
  if (location === "pantry")  return "pantry";
  return "dairy"; // most-likely fridge default; user re-tiles via edit
}

