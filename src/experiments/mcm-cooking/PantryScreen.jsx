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

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

const CLASSIFIER_HELPERS = { findIngredient, hubForIngredient };

// The three locations in top-to-bottom kitchen order. Each carries
// the tile manifest + the classifier that maps items to tiles
// within it. Order here is the order the tabs render in.
const LOCATIONS = [
  { id: "fridge",  label: "Fridge",  emoji: "🧊", tiles: FRIDGE_TILES,  classify: fridgeTileFor  },
  { id: "pantry",  label: "Pantry",  emoji: "🥫", tiles: PANTRY_TILES,  classify: pantryTileFor  },
  { id: "freezer", label: "Freezer", emoji: "❄️", tiles: FREEZER_TILES, classify: freezerTileFor },
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
    location,
    cat,
    status,
    days,
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
  onOpenItem,
  onStartCooking,
  onOpenUnitPicker,
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
  // (tile grid renders instead).
  const visible = useMemo(() => {
    if (searchHits) return searchHits;
    if (!drilledTile) return [];
    return cardsByLocTile[locationTab]?.[drilledTile.id] || [];
  }, [searchHits, drilledTile, cardsByLocTile, locationTab]);

  // Switching location while drilled = bail to the tile grid of
  // the new location. Same behavior as classic Kitchen.
  const switchLocation = (id) => {
    setLocationTab(id);
    setDrilledTile(null);
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      <WarmBackdrop variant="pantry" />

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
        padding: "28px 20px 120px",
      }}>
        {/* --- Hero — text sits DIRECTLY on the backdrop (no glass
             surface behind it), so it uses theme.color.skyInk /
             skyInkMuted instead of the regular ink. Those tokens
             flip bright on dark-sky themes (dawn/dusk/night) so
             the hero stays legible at every time of day. */}
        <FadeIn>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Kicker tone={theme.color.skyInkMuted}>Tuesday · 4:12 PM</Kicker>
            {/* Status chip sits on the bare backdrop, so it uses a
                glass-fill bg + skyInk text like the hero — not the
                low-alpha tealTint. On dawn the tint was landing at
                ~2:1 against the wine sky; this swap yields ≥6:1
                across every theme because the surface is always
                the theme's already-tuned glassFillHeavy. */}
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
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
              <StatusDot tone="ok" size={6} /> {goodCount} on hand
            </div>
          </div>

          <SerifHeader
            size={52}
            style={{
              // Fluid hero — shrinks on narrow viewports (clamped at
              // 36px so it stays expressive on phones) and caps at
              // 52px on desktop. `clamp` overrides the `size` prop's
              // fontSize since style spreads after the size rule
              // inside SerifHeader.
              marginTop: 4,
              color: theme.color.skyInk,
              fontSize: "clamp(36px, 6vw, 52px)",
            }}
          >
            The Pantry
          </SerifHeader>
          <p style={{
            marginTop: 8, fontFamily: font.sans, fontSize: 15,
            color: theme.color.skyInkMuted, lineHeight: 1.45, maxWidth: 340,
          }}>
            {pantrySubtitle(cards.length, goodCount)}
          </p>
        </FadeIn>

        {/* --- Search + filters ---------------------------------------- */}
        <FadeIn delay={0.06}>
          <GlassPanel
            tone="input"
            variant="input"
            padding={14}
            style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}
          >
            <SearchGlyph />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
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
              across all locations. */}
          {!query && (
            <div style={{
              display: "flex", gap: 8, marginTop: 14,
              overflowX: "auto", paddingBottom: 4,
            }}>
              {LOCATIONS.map((loc) => (
                <GlassPill
                  key={loc.id}
                  active={locationTab === loc.id}
                  onClick={() => switchLocation(loc.id)}
                >
                  <span style={{ marginRight: 6 }}>{loc.emoji}</span>
                  {loc.label}
                </GlassPill>
              ))}
            </div>
          )}
        </FadeIn>

        {/* --- Back chip (drilled into a tile) ------------------------- */}
        {drilledTile && !query && (
          <FadeIn>
            <div style={{ marginTop: 20 }}>
              <BackChip onClick={() => setDrilledTile(null)}>
                ← {drilledTile.emoji} {drilledTile.label}
              </BackChip>
            </div>
          </FadeIn>
        )}

        {/* --- Body: either TILE grid, ITEM grid, or SEARCH hits ------- */}
        {(() => {
          // Search mode — flat item grid, cross-location.
          if (query) {
            return <ItemGrid items={visible} onOpenItem={onOpenItem} onOpenUnitPicker={onOpenUnitPicker} />;
          }
          // Drilled tile mode — item grid filtered to that tile.
          if (drilledTile) {
            return <ItemGrid items={visible} onOpenItem={onOpenItem} onOpenUnitPicker={onOpenUnitPicker} />;
          }
          // Default — tile grid for the active location.
          return (
            <TileGrid
              location={activeLocation}
              cardsByTile={cardsByLocTile[locationTab] || {}}
              onPickTile={setDrilledTile}
            />
          );
        })()}

        {((query && visible.length === 0) || (drilledTile && visible.length === 0)) && (
          <FadeIn>
            <div style={{
              marginTop: 40, textAlign: "center",
              fontFamily: font.serif, fontStyle: "italic",
              fontSize: 20, color: theme.color.skyInkMuted,
            }}>
              {query ? "Nothing matches that search." : "This tile is empty."}
            </div>
          </FadeIn>
        )}

        {/* --- Cook CTA ------------------------------------------------- */}
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
      </div>

      {!hideDock && (
        <BottomDock
          tabs={NAV_TABS}
          activeId="pantry"
          onSelect={(id) => { if (id === "cook") onStartCooking && onStartCooking(); }}
        />
      )}
    </div>
  );
}

// Pantry subtitle — short warm copy that scales with the count.
// Hardcoded wording on Showcase ("Twelve good things") doesn't
// survive once real data flows in; this helper keeps it honest.
function pantrySubtitle(total, good) {
  if (total === 0) {
    return "Empty shelf. Time for a grocery run.";
  }
  if (total === good) {
    return total === 1
      ? "One good thing on the shelf."
      : `${total} good things on the shelf. Everything's fresh.`;
  }
  const warnCount = total - good;
  return `${total} on the shelf · ${warnCount} ${warnCount === 1 ? "needs" : "need"} using soon.`;
}

const NAV_TABS = [
  { id: "pantry", label: "Pantry", glyph: "🥫" },
  { id: "cook",   label: "Cook",   glyph: "🍳" },
  { id: "plan",   label: "Plan",   glyph: "📅" },
  { id: "you",    label: "You",    glyph: "🌿" },
];

// --- Sub-components ------------------------------------------------------

// Item grid — the animated 2-to-N column grid used for BOTH the
// drilled-tile view and the search-hits view. Factored out so the
// card-layout code isn't duplicated across the two render branches.
function ItemGrid({ items, onOpenItem, onOpenUnitPicker }) {
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
            transition={{ duration: 0.32, delay: i * 0.025, ease: [0.22, 1, 0.36, 1] }}
          >
            <PantryCard
              item={it}
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
// emoji + label + blurb + an item count. Empty tiles dim to
// ~45% so the populated ones pop, same visual pattern the
// classic Kitchen uses.
function TileGrid({ location, cardsByTile, onPickTile }) {
  return (
    <div style={{
      display: "grid",
      // Slightly larger minimum (220) than the item grid — tile
      // cards carry more text (label + blurb + count) and need
      // room to breathe. Still auto-fits so desktop gets 3+ cols.
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 14,
      marginTop: 20,
    }}>
      <AnimatePresence mode="popLayout">
        {location.tiles.map((tile, i) => {
          const count = (cardsByTile[tile.id] || []).length;
          return (
            <motion.div
              key={tile.id}
              layout
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.32, delay: i * 0.02, ease: [0.22, 1, 0.36, 1] }}
            >
              <TileCard tile={tile} count={count} onPick={() => onPickTile(tile)} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// Tile card — the "Dairy & Eggs · 12 items" shelf-choice card.
// Taller than an item card so the emoji has space to dominate and
// the blurb below the label has breathing room. Empty tiles
// render dimmed + non-interactive so the user doesn't drill into
// a known-empty shelf.
function TileCard({ tile, count, onPick }) {
  const { theme } = useTheme();
  const empty = count === 0;
  return (
    <GlassPanel
      interactive={!empty}
      onClick={empty ? undefined : onPick}
      padding={16}
      style={{
        display: "flex", flexDirection: "column", gap: 10,
        minHeight: 150,
        opacity: empty ? 0.45 : 1,
        cursor: empty ? "default" : "pointer",
        // Subtle desaturation on empty tiles so they read as
        // "not available" not "dimmed but tappable." Matches the
        // grayscale treatment classic Kitchen uses for its empty
        // tile cards.
        filter: empty ? "grayscale(40%)" : "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          fontSize: 38, lineHeight: 1,
          filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
        }}>
          {tile.emoji}
        </div>
        {/* Count pill — DM Mono so it reads as metadata, not a
            header. Hidden on empty tiles since "0 items" adds
            noise without signal. */}
        {!empty && (
          <div style={{
            fontFamily: font.mono, fontSize: 10,
            padding: "3px 8px",
            borderRadius: radius.pill,
            background: withAlpha(theme.color.ink, 0.06),
            color: theme.color.inkMuted,
            letterSpacing: "0.06em",
            whiteSpace: "nowrap",
            textTransform: "uppercase",
          }}>
            {count} {count === 1 ? "item" : "items"}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: font.serif, fontStyle: "italic", fontWeight: 400,
          fontSize: 20, lineHeight: 1.15, color: theme.color.ink,
          letterSpacing: "-0.01em",
        }}>
          {tile.label}
        </div>
        {tile.blurb && (
          <div style={{
            fontFamily: font.sans, fontSize: 12,
            color: theme.color.inkFaint,
            marginTop: 4, lineHeight: 1.4,
          }}>
            {tile.blurb}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

function PantryCard({ item, onPick }) {
  const { theme } = useTheme();
  const warn = item.status === "warn";
  // Warn cards pick up a gentle theme-derived burnt wash so
  // "expires soon" is noticeable at the card level without being
  // alarming. Wash follows time-of-day automatically.
  const warnOverlay = warn ? statusTintOverlay(theme, "warn") : null;

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{
          fontSize: 30, lineHeight: 1,
          filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
        }}>
          {item.emoji}
        </div>
        <StatusDot tone={warn ? "warn" : "ok"} size={warn ? 10 : 8} />
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
        <div style={{
          fontFamily: font.mono, fontSize: 11, color: theme.color.inkFaint,
          marginTop: 4, letterSpacing: "0.02em",
        }}>
          {item.qty}
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
          color: warn ? theme.color.burnt : theme.color.inkMuted,
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

function SearchGlyph() {
  const { theme } = useTheme();
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="7" fill="none" stroke={theme.color.inkMuted} strokeWidth="1.6" />
      <path d="M16.5 16.5 L21 21" stroke={theme.color.inkMuted} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

