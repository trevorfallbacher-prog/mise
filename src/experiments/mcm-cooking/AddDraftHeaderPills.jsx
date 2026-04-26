// AddDraftHeaderPills — orange CATEGORY chip + blue STORED IN tile
// chip pinned top-right of the AddDraftSheet header. Gated on
// canonicalId so the cascade has real metadata before we show a
// "decision" the user hasn't made. Each chip springs in when the
// cascade resolves, swaps via AnimatePresence keyed on the resolved
// id so a category/tile change animates rather than cross-fades.
//
// Extracted from AddDraftSheet.jsx (was 180 lines of duplicated
// IIFE blocks for the same chip pattern). Now expressed as one
// shared UnsetChip / SetChip pair driven by the two axes.

import { motion, AnimatePresence } from "framer-motion";
import { font, axis } from "./tokens";
import { withAlpha } from "./primitives";
import { LOCATIONS } from "./helpers";
import { findFoodType } from "../../data/foodTypes";
import { tileIconFor } from "../../lib/canonicalIcons";

export function AddDraftHeaderPills({
  theme,
  canonicalId,
  typeId,
  tileId,
  location,
  onPickCategory,
  onPickTile,
}) {
  if (!canonicalId) return null;
  return (
    <motion.div
      // Whole-rail entrance so both pills slide in together when the
      // canonical lands. Spring tuned to land before the user's eye
      // re-settles on the header.
      initial={{ opacity: 0, x: 8, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      style={{
        display: "flex", flexDirection: "row", alignItems: "center",
        gap: 6, flexShrink: 0, marginTop: 2,
      }}
    >
      <CategoryPill theme={theme} typeId={typeId} onClick={onPickCategory} />
      <TilePill
        theme={theme}
        location={location}
        tileId={tileId}
        onClick={onPickTile}
      />
    </motion.div>
  );
}

function CategoryPill({ theme, typeId, onClick }) {
  const t = typeId ? findFoodType(typeId) : null;
  const tone = theme.color.burnt;
  return (
    <AnimatePresence mode="wait" initial={false}>
      {t ? (
        <SetChip
          key={`category-${t.id}`}
          tone={tone}
          theme={theme}
          ariaLabel={`Category: ${t.label}`}
          title={`Category · ${t.label}`}
          onClick={onClick}
        >
          {t.label}
        </SetChip>
      ) : (
        <UnsetChip
          key="unset-category"
          tone={tone}
          theme={theme}
          ariaLabel="Pick a category"
          onClick={onClick}
        />
      )}
    </AnimatePresence>
  );
}

function TilePill({ theme, location, tileId, onClick }) {
  const loc = LOCATIONS.find(l => l.id === location);
  const tile = loc && tileId ? loc.tiles.find(x => x.id === tileId) : null;
  const tone = axis.storedIn;
  const svg = tile ? tileIconFor(tile.id, location) : null;
  const resolved = !!tile && tile.id !== "misc" && !!svg;
  return (
    <AnimatePresence mode="wait" initial={false}>
      {resolved ? (
        <motion.button
          key={`tile-${tile.id}`}
          type="button"
          className="mcm-focusable"
          onClick={onClick}
          aria-label={`Stored in: ${tile.label}`}
          title={`Stored in · ${tile.label}`}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ type: "spring", stiffness: 460, damping: 24 }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44, height: 44,
            padding: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <img
            src={svg}
            alt=""
            aria-hidden
            style={{
              width: "100%", height: "100%", objectFit: "contain",
              display: "block",
              filter: "drop-shadow(0 1px 2px rgba(30,20,8,0.22))",
            }}
          />
        </motion.button>
      ) : (
        <UnsetChip
          key="unset-tile"
          tone={tone}
          theme={theme}
          ariaLabel="Pick a shelf"
          onClick={onClick}
        />
      )}
    </AnimatePresence>
  );
}

// Shared "unset" chip — dashed circle with a centered "+". Only the
// tone (orange for category, blue for storedIn) and the aria copy
// change between the two pill columns.
function UnsetChip({ tone, theme, ariaLabel, onClick }) {
  return (
    <motion.button
      type="button"
      className="mcm-focusable"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 44, height: 44,
        padding: 0,
        borderRadius: 999,
        border: `1px dashed ${withAlpha(tone, 0.55)}`,
        background: `linear-gradient(${withAlpha(tone, 0.08)}, ${withAlpha(tone, 0.08)}), ${theme.color.glassFillHeavy}`,
        color: tone,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <span style={{
        fontSize: 22, lineHeight: 1, fontWeight: 300,
        color: tone,
      }}>+</span>
    </motion.button>
  );
}

// Shared "set" chip — name + tone-tinted pill. Used for the resolved
// category state (the resolved tile state has its own SVG icon path).
function SetChip({ tone, theme, ariaLabel, title, onClick, children }) {
  return (
    <motion.button
      type="button"
      className="mcm-focusable"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ type: "spring", stiffness: 460, damping: 24 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 44,
        padding: "0 14px",
        borderRadius: 999,
        border: `1px solid ${withAlpha(tone, 0.55)}`,
        background: `linear-gradient(${withAlpha(tone, 0.22)}, ${withAlpha(tone, 0.22)}), ${theme.color.glassFillHeavy}`,
        color: theme.color.ink,
        fontFamily: font.detail,
        fontStyle: "italic",
        fontWeight: 400,
        fontSize: 14,
        cursor: "pointer",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </motion.button>
  );
}
