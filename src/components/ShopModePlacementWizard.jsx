// ShopModePlacementWizard — three-step "no-typing" placement for a
// barcode that came back without enough data to auto-pair (red or
// yellow scan). Walk the user through the same axes the kitchen
// organizes around using big tap targets:
//
//   1. WHERE — fridge / pantry / freezer.
//   2. WHICH SHELF — the tile list for the chosen location.
//   3. WHAT IS IT (optional) — bundled ingredients filtered to that
//      tile, with a "Show all" toggle to bypass the filter and a
//      "Skip" row at the top to commit without a canonical (the row
//      lands under the tile label).
//
// On commit:
//   * onComplete({ location, tileId, tileLabel, tileEmoji,
//                  canonicalId, canonicalName, canonicalEmoji }) fires
//     so ShopMode can stamp the scan, write a correction, and pair-
//     or-impulse the row.
//   * The wizard does not write anything itself — pure picker.
//
// Visual register: MCM tokens. Glass tiles, Pale Martini display
// for the question, Instrument Serif italic for the support copy,
// DM Mono kicker. Themed via the parent's MCMThemeProvider so the
// time-of-day palette holds.

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "../experiments/mcm-cooking/theme";
import { font, radius } from "../experiments/mcm-cooking/tokens";
import { FRIDGE_TILES, tileIdForItem as fridgeTileIdForItem } from "../lib/fridgeTiles";
import { PANTRY_TILES, pantryTileIdForItem } from "../lib/pantryTiles";
import { FREEZER_TILES, freezerTileIdForItem } from "../lib/freezerTiles";
import { INGREDIENTS, findIngredient, hubForIngredient } from "../data/ingredients";

const LOCATIONS = [
  { id: "fridge",  emoji: "❄️", label: "Fridge",  blurb: "Cold storage — dairy, produce, meat" },
  { id: "pantry",  emoji: "🥫", label: "Pantry",  blurb: "Dry shelf — cans, grains, oils, spices" },
  { id: "freezer", emoji: "🧊", label: "Freezer", blurb: "Frozen — meal prep, fruit, ice cream" },
];

const TILES_FOR_LOCATION = {
  fridge:  FRIDGE_TILES,
  pantry:  PANTRY_TILES,
  freezer: FREEZER_TILES,
};

// Classifier per location — given an item-shaped object with
// ingredientId, returns the tile id that location's tile-registry
// would route the row into. Used to filter the canonical picker to
// items that belong on the chosen tile.
const CLASSIFY_BY_LOCATION = {
  fridge:  fridgeTileIdForItem,
  pantry:  pantryTileIdForItem,
  freezer: freezerTileIdForItem,
};

export default function ShopModePlacementWizard({
  onComplete,
  onCancel,
}) {
  const { theme } = useTheme();
  const [location, setLocation] = useState(null);
  const [tile, setTile]         = useState(null);    // selected tile object
  const [showAll, setShowAll]   = useState(false);

  const tiles = location ? TILES_FOR_LOCATION[location] : null;

  // Step 3 list. Filter all bundled canonicals to the chosen tile by
  // running each through the location's classifier and keeping the
  // ones whose tile id matches. "Show all" bypasses the filter so
  // users whose item isn't classified onto the expected tile (e.g.
  // a niche import the registry doesn't tile-aware route) can still
  // pick the right canonical without typing. Sort alphabetically by
  // name; emoji is shown as a leading visual.
  const ingredientList = useMemo(() => {
    if (!location || !tile) return [];
    const classify = CLASSIFY_BY_LOCATION[location];
    const helpers = { findIngredient, hubForIngredient };
    const filtered = showAll
      ? INGREDIENTS
      : INGREDIENTS.filter(ing => {
          try {
            const itemShape = { ingredientId: ing.id, category: ing.category };
            return classify(itemShape, helpers) === tile.id;
          } catch (_e) { return false; }
        });
    return filtered
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [location, tile, showAll]);

  const overlayBg = "rgba(0,0,0,0.45)";

  // Step number for the kicker / beads. 0 = location, 1 = tile, 2 = canonical.
  const step = !location ? 0 : !tile ? 1 : 2;

  function handleBack() {
    if (tile)         { setTile(null); setShowAll(false); return; }
    if (location)     { setLocation(null); return; }
    onCancel?.();
  }

  function commitWithCanonical(ing) {
    onComplete?.({
      location,
      tileId:        tile.id,
      tileLabel:     tile.label,
      tileEmoji:     tile.emoji,
      canonicalId:    ing?.id || null,
      canonicalName:  ing?.name || null,
      canonicalEmoji: ing?.emoji || null,
    });
  }

  function commitSkipCanonical() {
    onComplete?.({
      location,
      tileId:        tile.id,
      tileLabel:     tile.label,
      tileEmoji:     tile.emoji,
      canonicalId:    null,
      canonicalName:  null,
      canonicalEmoji: null,
    });
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        background: overlayBg,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: "env(safe-area-inset-top, 0px) 0 0",
      }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          background: theme.color.cream,
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          boxShadow: theme.shadow.lift,
          padding: "20px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)",
          overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        {/* Top bar — back / kicker */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={handleBack}
            aria-label={step === 0 ? "Close" : "Back"}
            style={{
              width: 36, height: 36, borderRadius: radius.pill,
              border: `1px solid ${theme.color.hairline}`,
              background: theme.color.glassFillLite,
              color: theme.color.ink, fontSize: 18,
              cursor: "pointer",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >{step === 0 ? "✕" : "←"}</button>
          <div style={{
            fontFamily: font.mono, fontSize: 11,
            letterSpacing: "0.18em", textTransform: "uppercase",
            color: theme.color.warmBrown, flex: 1,
          }}>
            Place it · Step {step + 1} of 3
          </div>
        </div>

        {/* Step beads */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {[0, 1, 2].map(i => {
            const active = i <= step;
            return (
              <div
                key={i}
                style={{
                  width: 8, height: 8,
                  borderRadius: radius.pill,
                  background: active ? theme.color.warmBrown : "transparent",
                  border: `1px solid ${active ? theme.color.warmBrown : theme.color.hairline}`,
                }}
              />
            );
          })}
        </div>

        {/* Question */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`q-${step}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div style={{
              fontFamily: font.detail, fontStyle: "italic",
              fontSize: 28, color: theme.color.ink, lineHeight: 1.1,
              marginBottom: 6,
            }}>
              {step === 0 && "Where does it live?"}
              {step === 1 && "Which shelf?"}
              {step === 2 && "What is it?"}
            </div>
            <div style={{
              fontFamily: font.sans, fontSize: 13,
              color: theme.color.inkMuted,
              lineHeight: 1.45,
            }}>
              {step === 0 && "Three taps to place this scan. No typing — we'll remember the answer for next time."}
              {step === 1 && "Pick the closest match. We'll remember this UPC for next time."}
              {step === 2 && (showAll
                ? "Full catalog — alphabetical. Tap one or skip if nothing fits."
                : `Common items on ${tile?.label}. Skip if nothing fits, or show all.`)}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Step 1 — location grid */}
        {step === 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 10,
            marginTop: 4,
          }}>
            {LOCATIONS.map(loc => (
              <button
                key={loc.id}
                onClick={() => setLocation(loc.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "16px 16px",
                  background: theme.color.glassFillHeavy,
                  border: `1px solid ${theme.color.hairline}`,
                  borderRadius: radius.card,
                  cursor: "pointer",
                  textAlign: "left",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  boxShadow: theme.shadow.soft,
                }}
              >
                <div style={{ fontSize: 36 }}>{loc.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: font.detail, fontStyle: "italic",
                    fontSize: 22, color: theme.color.ink, lineHeight: 1.1,
                  }}>{loc.label}</div>
                  <div style={{
                    fontFamily: font.sans, fontSize: 12,
                    color: theme.color.inkMuted, marginTop: 2,
                  }}>{loc.blurb}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — tile picker for the chosen location */}
        {step === 1 && tiles && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 8,
            marginTop: 4,
          }}>
            {tiles.map(t => (
              <button
                key={t.id}
                onClick={() => setTile(t)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 12px",
                  background: theme.color.glassFillHeavy,
                  border: `1px solid ${theme.color.hairline}`,
                  borderRadius: radius.field,
                  cursor: "pointer",
                  textAlign: "left",
                  minHeight: 64,
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              >
                <div style={{ fontSize: 24, flexShrink: 0 }}>{t.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: font.detail, fontStyle: "italic",
                    fontSize: 15, color: theme.color.ink, lineHeight: 1.15,
                  }}>{t.label}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 3 — canonical picker. Skip row first, then the
            ingredient list, then a toggle to expand to the full
            catalog. The list is virtualization-friendly already
            (tap targets are ~48px) but with ≤725 rows total in the
            unfiltered case we can render naively without perf
            trouble on a modern phone. */}
        {step === 2 && tile && (
          <div style={{
            display: "flex", flexDirection: "column", gap: 6,
            marginTop: 4,
          }}>
            {/* Skip row — commit without a canonical. The scan lands
                under the tile label, which is enough placement to
                make the trip + receipt commit coherent. User can
                rename in the kitchen later. */}
            <button
              onClick={commitSkipCanonical}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px",
                background: theme.color.tealTint,
                border: `1px solid ${theme.color.teal}`,
                borderRadius: radius.field,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: 20 }}>{tile.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: font.detail, fontStyle: "italic",
                  fontSize: 15, color: theme.color.ink, lineHeight: 1.15,
                }}>Skip — just place under {tile.label}</div>
                <div style={{
                  fontFamily: font.sans, fontSize: 11,
                  color: theme.color.inkMuted, marginTop: 2,
                }}>The row commits without a canonical; you can name it later in the kitchen.</div>
              </div>
            </button>

            {/* Ingredient rows — emoji + name. Tap commits with that
                canonical. Two-column grid so the list scans faster. */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 6,
              marginTop: 4,
            }}>
              {ingredientList.map(ing => (
                <button
                  key={ing.id}
                  onClick={() => commitWithCanonical(ing)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px",
                    background: theme.color.glassFillHeavy,
                    border: `1px solid ${theme.color.hairline}`,
                    borderRadius: radius.chip,
                    cursor: "pointer",
                    textAlign: "left",
                    minHeight: 44,
                  }}
                >
                  <div style={{ fontSize: 18, flexShrink: 0 }}>{ing.emoji || "•"}</div>
                  <div style={{
                    flex: 1, minWidth: 0,
                    fontFamily: font.detail, fontStyle: "italic",
                    fontSize: 13, color: theme.color.ink, lineHeight: 1.15,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{ing.name}</div>
                </button>
              ))}
            </div>

            {/* Show-all toggle. Bypasses the tile filter so users
                whose item lives off the expected tile can still pick
                the right canonical without typing. Re-tapping
                returns to the tile-filtered list. */}
            <button
              onClick={() => setShowAll(v => !v)}
              style={{
                marginTop: 8,
                padding: "10px 12px",
                background: "transparent",
                border: `1px dashed ${theme.color.hairline}`,
                color: theme.color.inkMuted,
                borderRadius: radius.field,
                cursor: "pointer",
                fontFamily: font.mono, fontSize: 11,
                letterSpacing: "0.14em", textTransform: "uppercase",
              }}
            >
              {showAll ? `Show only ${tile.label}` : "Show all ingredients"}
            </button>

            {ingredientList.length === 0 && !showAll && (
              <div style={{
                padding: 12,
                fontFamily: font.detail, fontStyle: "italic",
                fontSize: 13, color: theme.color.inkMuted,
                textAlign: "center",
              }}>
                Nothing in the catalog routes to this shelf yet. Skip above, or show all.
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
