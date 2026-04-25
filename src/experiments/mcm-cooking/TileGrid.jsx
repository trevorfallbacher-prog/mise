// Tile grid + tile card — the "pick a shelf" surface. TileGrid
// builds the responsive layout; TileCard renders each individual
// tile (icon + label + blurb + count + warn). Empty tiles dim
// to ~45% so populated ones pop, mirroring the classic Kitchen
// browse view.

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel, withAlpha } from "./primitives";
import { useTheme } from "./theme";
import { font } from "./tokens";
import { tileIconFor } from "../../lib/canonicalIcons";

// Tile grid — the top-level "pick a shelf" view shown when no
// tile is drilled and no search is active. Each tile card shows
// icon/emoji + label + blurb + an item count + warn dot. Empty
// tiles dim to ~45% so the populated ones pop, same visual
// pattern the classic Kitchen uses.
export function TileGrid({ location, cardsByTile, onPickTile, warnCountByTile, newCountByTile = {} }) {
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
          const fresh = newCountByTile[`${location.id}:${tile.id}`] || 0;
          return (
            <motion.div
              key={tile.id}
              layout
              // Pronounced entrance so the icons "reset home" when
              // the user clears search and the TileGrid remounts.
              // Each tile springs in from scale 0.85 + offset, with
              // a wider stagger (60ms) so the user reads it as a
              // satisfying wave rather than a flat fade.
              initial={{ opacity: 0, scale: 0.85, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92 }}
              whileTap={empty ? undefined : { scale: 0.97 }}
              whileHover={empty ? undefined : { y: -2, scale: 1.01 }}
              transition={{
                opacity: { duration: 0.28, delay: i * 0.06 },
                scale:   { type: "spring", stiffness: 320, damping: 22, delay: i * 0.06 },
                y:       { type: "spring", stiffness: 320, damping: 22, delay: i * 0.06 },
              }}
            >
              <TileCard
                tile={tile}
                location={location.id}
                count={count}
                warnCount={warn}
                newCount={fresh}
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
export function TileCard({ tile, location, count, warnCount, newCount = 0, onPick }) {
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
          {/* Fresh-arrival pill — small teal "+N new" badge that
              renders when this tile contains items added in the
              last 24h (isRecent). Sits to the left of the warn
              pill so the urgent burnt-orange "soon" still reads
              as the dominant status when both are present.
              Hidden when newCount = 0. */}
          {newCount > 0 && (
            <div
              title={`${newCount} item${newCount === 1 ? "" : "s"} added recently`}
              style={{
                minWidth: 22, height: 22,
                padding: "0 8px",
                borderRadius: 999,
                background: withAlpha(theme.color.teal, 0.14),
                color: theme.color.teal,
                fontFamily: font.mono, fontSize: 10, fontWeight: 600,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                flexShrink: 0,
                border: `1px solid ${withAlpha(theme.color.teal, 0.35)}`,
              }}
            >
              +{newCount} new
            </div>
          )}
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
