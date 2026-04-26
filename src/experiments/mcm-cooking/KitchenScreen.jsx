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
  WarmBackdrop, GlassPanel,
  StatusDot, Kicker, SerifHeader, FadeIn,
  BottomDock,
  withAlpha,
} from "./primitives";
import { useTheme, THEME_TRANSITION } from "./theme";
import { font } from "./tokens";

// Tile system — re-using the exact same classifier the classic
// Kitchen tile view uses, so an item that lives under "Dairy & Eggs"
// in the old UI lives in the SAME tile here. Location axis (fridge
// / pantry / freezer) sits above the tile axis per CLAUDE.md.
import {
  LOCATIONS, NAV_TABS,
  toCard,
  sumLocationTiles, firstExpiring, sortItems, isRecent,
} from "./helpers";
import { ReceiptButton, CartButton } from "./HeroToolbar";
import { FloatingLocationDock } from "./FloatingLocationDock";
import { TileGrid } from "./TileGrid";
import { ItemGrid } from "./ItemGrid";
import { DrilledTileHeader } from "./DrilledTileHeader";
import { TriageCTA, FreshCTA, ShowcaseDemoCTA } from "./BottomCTA";
import { TileGridSkeleton } from "./TileGridSkeleton";
import { EmptyState, LocationEmptyState } from "./EmptyStates";
import { SearchSummary, SearchGlyph } from "./SearchSummary";
import { useNow, formatClock } from "./useNow";

// Hardcoded demo items — only used when KitchenScreen is rendered
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

export default function KitchenScreen({
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
  // Inline-update handler — called from KitchenCard when the
  // user adjusts a row in place (currently the tappable fill
  // gauge; future inline editors land here too). Receives
  // (rawRow, partialPatch) and the parent merges. Showcase
  // leaves undefined so the gauge stays read-only there.
  onUpdateItem,
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
  // one auto-closes via the prop cascade in KitchenCard. null
  // means none open.
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
  // tile their grocery-run brand ended up in. Matches against
  // name, brand, food-type label, and broad category label so a
  // user typing "kerrygold", "cheese", or "dairy" all surface
  // useful hits — not just exact name substrings.
  const searchHits = useMemo(() => {
    if (!query) return null;
    const q = query.toLowerCase();
    return cards.filter(it => {
      if (it.name && it.name.toLowerCase().includes(q)) return true;
      if (it.brand && it.brand.toLowerCase().includes(q)) return true;
      if (it.typeLabel && it.typeLabel.toLowerCase().includes(q)) return true;
      if (it.location && it.location.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [cards, query]);

  const goodCount = cards.filter((i) => i.status === "ok").length;
  // Items visible in the current tile drill-down — derived lazily
  // so the grid can reuse the same KitchenCard renderer that the
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

  // Distinct brands across the whole pantry — surfaced as
  // suggestions when the user taps "+ ADD BRAND" on a card whose
  // brand is unset. Computed once over `cards` so a 200-row
  // pantry doesn't re-walk on every keystroke inside the picker.
  const brandSuggestions = useMemo(() => {
    const set = new Set();
    for (const c of cards) {
      if (c.brand) set.add(c.brand);
    }
    return [...set];
  }, [cards]);

  // Per-tile recently-added count — how many items landed in this
  // tile in the last 24h (isRecent threshold). Surfaces a small
  // teal "+N new" hint on the tile card so a fresh grocery run is
  // visible at the browse layer without having to drill in. Same
  // key shape as warnCountByTile.
  const newCountByTile = useMemo(() => {
    const map = {};
    for (const loc of Object.keys(cardsByLocTile)) {
      for (const tileId of Object.keys(cardsByLocTile[loc])) {
        const n = cardsByLocTile[loc][tileId].filter(isRecent).length;
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
      minHeight: "100dvh",
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
          /* Hide the desktop "esc" hint on narrow phones — there's
             no physical keyboard there, so the chip is just visual
             noise crowding the search bar's right edge. */
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
      }}
      >
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
                title="Clear search (Esc)"
                className="mcm-focusable"
                style={{
                  border: "none", background: "transparent", cursor: "pointer",
                  color: theme.color.inkMuted, fontFamily: font.mono, fontSize: 12,
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: 0,
                }}
              >
                {/* Tiny kbd-style cap for the Esc shortcut. Hidden
                    on narrow phones (no physical keyboard) via a
                    media-query class so it doesn't crowd the row;
                    desktop users get the shortcut surfaced inline
                    next to the click affordance. */}
                <span
                  className="mcm-kbd-hint"
                  aria-hidden
                  style={{
                    fontFamily: font.mono, fontSize: 9,
                    fontWeight: 500,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "1px 5px",
                    borderRadius: 4,
                    border: `1px solid ${theme.color.hairline}`,
                    background: theme.color.glassFillLite,
                    color: theme.color.inkFaint,
                    lineHeight: 1.4,
                  }}
                >
                  esc
                </span>
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
              if (query)       return <ItemGrid items={visible} onOpenItem={onOpenItem} onOpenUnitPicker={onOpenUnitPicker} onUpdateItem={onUpdateItem} brandSuggestions={brandSuggestions} showTileContext />;
              if (drilledTile) return <ItemGrid items={visible} onOpenItem={onOpenItem} onOpenUnitPicker={onOpenUnitPicker} onUpdateItem={onUpdateItem} brandSuggestions={brandSuggestions} />;
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
                  newCountByTile={newCountByTile}
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
          <ShowcaseDemoCTA onStartCooking={onStartCooking} />
        )}

        {!drilledTile && !query && onOpenItem && warnCount > 0 && (
          <TriageCTA
            warnCount={warnCount}
            firstExpiring={firstExpiring(cards)}
            onOpenItem={onOpenItem}
          />
        )}

        {/* Positive CTA — shows in real mode when the pantry is
            healthy (no warn items, but stocked). Gives the user a
            forward path into the cook/plan flow instead of an
            empty surface below the tile grid. Only renders when
            `onStartCooking` is wired (App.jsx → setTab("plan"));
            falls silent in Showcase mode (onOpenItem null) or
            when there's nothing on the shelves. */}
        {!drilledTile && !query && onOpenItem && warnCount === 0 && cards.length > 0 && onStartCooking && (
          <FreshCTA
            cards={cards}
            cardsByLocTile={cardsByLocTile}
            onStartCooking={onStartCooking}
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
        {/* Only show the location dock when MCMKitchenScreen is
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


// MCMAddDraftSheet lives in its own file but App.jsx imports it
// alongside the default export, so re-export here for back-compat.
export { MCMAddDraftSheet } from "./AddDraftSheet";
