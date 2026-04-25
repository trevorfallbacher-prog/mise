// DrilledTileHeader + its companion sort/category controls. These
// render at the top of a drilled-tile view (back button, tile icon,
// label, item count, warn pill, sort selector, category filter row).

import { motion } from "framer-motion";
import { withAlpha } from "./primitives";
import { useTheme, THEME_TRANSITION } from "./theme";
import { font } from "./tokens";
import { tileIconFor } from "../../lib/canonicalIcons";
import { LOCATION_DOT } from "./FloatingLocationDock";

// Drilled tile header — the prominent "you are here" block shown
// above the item grid when the user taps into a tile. Replaces
// the plain BackChip with a stronger sense of place: tile icon
// (SVG or emoji), serif-italic label, count + warn count summary,
// sort selector, and an obvious back button. Mirrors classic
// Kitchen's drill-in moment but in MCM's voice (serif, glass,
// warm accents).
export function DrilledTileHeader({ tile, location, count, warnCount, sortBy, onSortChange, onBack, categoryOptions = [], categoryFilter, onCategoryChange }) {
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
