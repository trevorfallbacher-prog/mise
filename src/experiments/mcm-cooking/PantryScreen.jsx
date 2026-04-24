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
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
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
import { findIngredient, hubForIngredient } from "../../data/ingredients";
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
  return {
    id:       raw.id,
    emoji:    raw.emoji || "🍽️",
    name:     raw.name || "Untitled",
    qty:      formatQty(raw.amount, raw.unit),
    brand:    raw.brand || null,
    location,
    cat,
    status,
    days,
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
    const items = cardsByLocTile[locationTab]?.[drilledTile.id] || [];
    return sortItems(items, sortBy);
  }, [searchHits, drilledTile, cardsByLocTile, locationTab, sortBy]);

  // Switching location while drilled = bail to the tile grid of
  // the new location. Same behavior as classic Kitchen.
  const switchLocation = (id) => {
    setLocationTab(id);
    setDrilledTile(null);
  };

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
        /* Hide the keyboard shortcut hint on devices that can't
           hover (touch phones/tablets) — a kbd glyph showing a
           shortcut that user can't physically trigger is just
           noise. Keyboard-attached tablets (iPads in a stand)
           report hover:hover and keep the hint. */
        @media (hover: none) {
          .mcm-kbd-hint { display: none !important; }
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
      }}>
        {/* Shopping cart — top-right of the content column,
            absolutely-positioned so it sits above the hero's own
            flow without pushing anything. Renders the bundled
            shopping_cart.svg at 26x26 inside a 44x44 glass pill
            (accessibility tap target). Count badge appears when
            shoppingCount > 0. Tap bridges to the classic Kitchen
            shopping list view via the onGoToShopping callback
            (App.jsx flips pantryView → "shopping"). Hidden when
            the prop isn't wired (Showcase mode, design demo). */}
        {/* Top-right toolbar cluster. Holds (L→R):
              - Spend chip: this-month receipt total, DM Mono
                style. Tapping it also opens receipts (same as
                the receipt button), so users who read the
                dollar amount can drill into what they spent.
              - Receipt button: bundled receipt.svg icon,
                opens ReceiptHistoryModal.
              - Cart button: shopping list.
            All three are siblings in a flex row so they align
            cleanly without position:absolute math-matching. */}
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
            {onOpenReceipts && spendCents > 0 && (
              <SpendChip cents={spendCents} onClick={onOpenReceipts} />
            )}
            {onOpenReceipts && (
              <ReceiptButton onClick={onOpenReceipts} />
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
              // MCM swap: Truculenta is a variable-axis display face
              // built for condensed monumental headlines — reads as
              // a mid-century magazine cover rather than a book
              // title. fontVariationSettings dials in a medium-wide
              // (wdth 108) semibold (wght 620) at the large optical
              // size (opsz 72) for the hero; override the inherited
              // italic + 300 weight from SerifHeader since Truculenta
              // has no true italic (synthesized skew reads bad at
              // this size).
              marginTop: 4,
              color: theme.color.skyInk,
              fontFamily: font.display,
              fontStyle: "normal",
              fontWeight: 620,
              fontVariationSettings: "'wdth' 108, 'wght' 620, 'opsz' 72",
              letterSpacing: "-0.02em",
              fontSize: "clamp(40px, 7vw, 64px)",
              lineHeight: 1.0,
            }}
          >
            The Pantry
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
              placeholder="Search the pantry…"
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
            {/* Keyboard hint badge — shows the "/" shortcut in a kbd-
                style pill at the right edge of the input. Fades out
                when the input has focus OR has any text typed so it
                doesn't compete with the search content. Hidden on
                touch devices via the CSS rule below (@media hover:
                none) — a kbd badge is useless on a phone. */}
            {!searchFocused && !query && (
              <kbd
                aria-hidden="true"
                className="mcm-kbd-hint"
                style={{
                  fontFamily: font.mono,
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: `1px solid ${theme.color.hairline}`,
                  background: withAlpha(theme.color.ink, 0.04),
                  color: theme.color.inkFaint,
                  lineHeight: 1,
                }}
              >
                /
              </kbd>
            )}
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
              if (query)       return <ItemGrid items={visible} onOpenItem={onOpenItem} onOpenUnitPicker={onOpenUnitPicker} showTileContext />;
              if (drilledTile) return <ItemGrid items={visible} onOpenItem={onOpenItem} onOpenUnitPicker={onOpenUnitPicker} />;
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
// pill with the bundled shopping_cart.svg inside; when the
// shopping list has items a small burnt count badge rides on
// the upper-right corner of the icon.
// Receipt button — 60×60 glass pill with the bundled
// receipt.svg. Sits to the left of CartButton in the top-right
// cluster. Same interaction style as CartButton (spring entry,
// hover lift, tap scale, focus ring) so the cluster reads as
// one toolbar rather than three disparate buttons.
function ReceiptButton({ onClick }) {
  const { theme } = useTheme();
  return (
    <motion.button
      onClick={onClick}
      aria-label="Receipt history"
      title="Receipt history"
      className="mcm-focusable"
      whileHover={{ y: -2, scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{
        position: "relative",
        width: 60,
        height: 60,
        borderRadius: 999,
        border: `1px solid ${theme.color.glassBorder}`,
        background: theme.color.glassFillHeavy,
        backdropFilter: "blur(14px) saturate(150%)",
        WebkitBackdropFilter: "blur(14px) saturate(150%)",
        boxShadow: theme.shadow.soft,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: 0,
        ...THEME_TRANSITION,
      }}
    >
      <img
        src="/icons/receipt.svg"
        alt=""
        aria-hidden
        style={{
          width: 38, height: 38, objectFit: "contain",
          filter: "drop-shadow(0 1px 2px rgba(30,30,30,0.12))",
        }}
      />
    </motion.button>
  );
}

// Spend chip — current-month receipt spend in a compact pill
// that sits to the left of the receipt + cart buttons. Tappable:
// routes to the same onOpenReceipts handler as the receipt
// button so a user looking at the dollar amount can drill into
// what they spent in one tap. Formats cents → short dollars
// (e.g. $127.50 → "$128" when rounded, $12.35 → "$12"). No
// cents shown since the precision isn't useful in a hero chip.
function SpendChip({ cents, onClick }) {
  const { theme } = useTheme();
  const dollars = Math.round(cents / 100);
  const formatted = dollars >= 1000
    ? `$${(dollars / 1000).toFixed(1)}k`
    : `$${dollars}`;
  return (
    <motion.button
      onClick={onClick}
      aria-label={`Spent ${formatted} this month — tap to view receipts`}
      title={`Spent ${formatted} this month`}
      className="mcm-focusable"
      whileHover={{ y: -1, scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "8px 14px",
        borderRadius: 999,
        border: `1px solid ${theme.color.glassBorder}`,
        background: theme.color.glassFillHeavy,
        backdropFilter: "blur(14px) saturate(150%)",
        WebkitBackdropFilter: "blur(14px) saturate(150%)",
        boxShadow: theme.shadow.soft,
        cursor: "pointer",
        color: theme.color.ink,
        ...THEME_TRANSITION,
      }}
    >
      <span style={{
        fontFamily: font.mono,
        fontSize: 9,
        fontWeight: 500,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: theme.color.inkFaint,
        lineHeight: 1,
        marginBottom: 2,
      }}>
        This month
      </span>
      <span style={{
        fontFamily: font.display,
        fontSize: 20,
        fontWeight: 580,
        fontVariationSettings: "'wdth' 100, 'wght' 580, 'opsz' 22",
        letterSpacing: "-0.02em",
        lineHeight: 1,
      }}>
        {formatted}
      </span>
    </motion.button>
  );
}

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
        width: 60,
        height: 60,
        borderRadius: 999,
        border: `1px solid ${theme.color.glassBorder}`,
        background: theme.color.glassFillHeavy,
        backdropFilter: "blur(14px) saturate(150%)",
        WebkitBackdropFilter: "blur(14px) saturate(150%)",
        boxShadow: theme.shadow.soft,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: 0,
        ...THEME_TRANSITION,
      }}
    >
      <img
        src="/icons/shopping_cart.svg"
        alt=""
        aria-hidden
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
          fontFamily: font.mono,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
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
            // Truculenta so the triage headline sits in the same
            // typographic family as the hero + drilled header —
            // the bottom CTA now reads as a continuation of the
            // page, not a separate component. Slightly more bold
            // (wght 560) than tile cards so the CTA's item name
            // grabs focus among the surrounding meta.
            fontFamily: font.display,
            fontWeight: 560,
            fontVariationSettings: "'wdth' 104, 'wght' 560, 'opsz' 20",
            fontSize: 20, color: theme.color.ink, marginTop: 2,
            letterSpacing: "-0.015em",
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
function DrilledTileHeader({ tile, location, count, warnCount, sortBy, onSortChange, onBack }) {
  const { theme } = useTheme();
  const iconUrl = tileIconFor(tile.id, location);
  return (
    <div style={{
      marginTop: 20,
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
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
              fontWeight: 580,
              fontVariationSettings: "'wdth' 104, 'wght' 580, 'opsz' 32",
              fontSize: "clamp(20px, 4.5vw, 32px)",
              lineHeight: 1.05, color: theme.color.ink,
              letterSpacing: "-0.015em",
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
function ItemGrid({ items, onOpenItem, onOpenUnitPicker, showTileContext = false }) {
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
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
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
            fontWeight: 560,
            fontVariationSettings: "'wdth' 100, 'wght' 560, 'opsz' 22",
            fontSize: 22, lineHeight: 1.1, color: theme.color.ink,
            letterSpacing: "-0.015em",
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

function PantryCard({ item, onPick, tileLabel = null }) {
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

  return (
    <GlassPanel
      interactive
      onClick={onPick}
      padding={14}
      style={{
        // Slimmer cards (was 148) so 3–4 columns don't dominate
        // the viewport at desktop widths; phones still show a
        // comfortable-height tap target because minHeight is a
        // floor, not a cap.
        display: "flex", flexDirection: "column",
        gap: 10, minHeight: 132,
        ...warnOverlay,
      }}
    >
      {/* Tile-context chip — rendered only when ItemGrid is in
          search mode (showTileContext=true). Tells the user which
          tile this hit lives in so cross-location searches don't
          lose the orientation of each result. Small DM Mono,
          aligned with the card's metadata voice. */}
      {tileLabel && (
        <div style={{
          fontFamily: font.mono, fontSize: 9,
          letterSpacing: "0.10em", textTransform: "uppercase",
          color: theme.color.inkFaint,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          marginTop: -2,
        }}>
          {tileLabel}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            style={{
              width: 36, height: 36, objectFit: "contain",
              filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
            }}
          />
        ) : (
          <div style={{
            // Emoji at 34px to roughly match the 36×36 SVG visual
            // weight above — Apple/Noto emoji glyphs render at
            // ~95% of their font-size box, so 34 ≈ 36 rendered
            // square. Keeps icon vs emoji items visually consistent.
            fontSize: 34, lineHeight: 1,
            filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
          }}>
            {item.emoji}
          </div>
        )}
        {/* Single-slot badge. Priority: warn > new > ok. A warn
            item takes precedence because it's more actionable —
            "expiring" beats "just added" for signalling, and
            showing both at once made the status corner visually
            busy. Items that are fresh AND recent get the NEW chip;
            fresh-but-older items just get the small ok dot. */}
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

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: font.serif, fontStyle: "italic", fontWeight: 400,
          fontSize: 18, lineHeight: 1.15, color: theme.color.ink,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {item.name}
        </div>
        {/* Qty + brand row. Brand follows the CLAUDE.md browse
            pattern ("Butter · Kerrygold") — grey DM Mono sitting
            as a subtle identity label without competing with the
            serif name above. Middle-dot separator only renders
            when brand exists; no brand = just the qty line. */}
        <div style={{
          display: "flex", alignItems: "baseline", gap: 6,
          marginTop: 4,
          fontFamily: font.mono, fontSize: 11,
          letterSpacing: "0.02em",
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
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <TintedPill
          tone="teal"
          size="sm"
          style={{ overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {item.location}
        </TintedPill>
        <span style={{
          fontFamily: font.mono, fontSize: 10,
          // Three-tier urgency color. Eye-scan tells the user
          // which items deserve attention without reading the
          // number: plenty of time (muted ink) / plan ahead
          // (mustard) / use soon (burnt). Matches the classic
          // "fuel gauge" pattern without needing a literal bar.
          color: daysChipColor(item.days, theme),
          whiteSpace: "nowrap",
          fontWeight: warn ? 500 : 400,
        }}>
          {formatDaysChip(item.days)}
        </span>
      </div>
    </GlassPanel>
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

