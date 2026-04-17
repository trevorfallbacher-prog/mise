import { useMemo, useState } from "react";
import { FRIDGE_TILES } from "../lib/fridgeTiles";
import { PANTRY_TILES } from "../lib/pantryTiles";
import { FREEZER_TILES } from "../lib/freezerTiles";
import { useUserTiles } from "../lib/useUserTiles";
import { createUserTile } from "../lib/userTiles";
import { COLOR, FONT, RADIUS } from "../lib/tokens";

// IDENTIFIED AS (tile) picker — the "what kind of thing is this"
// chooser. Used inline in AddItemModal (part of the add form) and
// triggerable from ItemCard's IDENTIFIED AS line for re-pick.
//
// What shows:
//   * Built-in tiles for the current location (or all locations when
//     locationHint is null — modal opened from the generic + button
//     with no tile context)
//   * Family's user-created tiles for the same location
//   * "+ CREATE NEW IDENTIFIED AS" at the bottom — inline form
//     (label + emoji) that creates and auto-selects the new tile
//
// Location semantics:
//   * Picking a built-in tile sets BOTH tileId and location (built-ins
//     are inherently scoped to one location)
//   * Picking a user tile same (user tiles carry a location column)
//   * Creating new: user picks location first (fridge/pantry/freezer
//     chips), then label + emoji, then save
//
// Props:
//   userId         — for creating new tiles + family-scoping user tiles
//   locationHint   — fridge | pantry | freezer | null. When set,
//                    built-in + user tiles for that location are shown
//                    first; others are collapsed under "OTHER
//                    LOCATIONS". When null, all locations visible at
//                    equal weight.
//   selectedTileId — currently picked tile id (string). Renders with
//                    highlight.
//   suggestedTileId— optional: an id from 16e's name-inference. Gets
//                    a "Suggested" pill treatment.
//   onPick(tileId, location) — called when user picks a tile
//   compact        — true to render as a vertical list (picker modal);
//                    false (default) to render as a grid (inline form)

const BUILTIN_BY_LOCATION = {
  fridge:  FRIDGE_TILES,
  pantry:  PANTRY_TILES,
  freezer: FREEZER_TILES,
};

const LOCATION_META = [
  { id: "fridge",  emoji: "🧊", label: "Fridge"  },
  { id: "pantry",  emoji: "🥫", label: "Pantry"  },
  { id: "freezer", emoji: "❄️", label: "Freezer" },
];

// Emoji options surfaced in the CREATE NEW inline form. Small
// curated set covering the common "what kind of shelf is this"
// gestures. The 🗂️ default is always available via no-pick.
const EMOJI_OPTIONS = [
  "🗂️", "🍝", "🍞", "🧀", "🥛", "🥩", "🐟", "🥦", "🍎",
  "🧂", "🌿", "🌶️", "🍯", "🍫", "🥫", "🫙", "🍷", "🧈",
  "🌾", "🫘", "🥜", "🍪", "🍕", "🧊", "❄️", "🥡",
];

export default function IdentifiedAsPicker({
  userId,
  locationHint,
  selectedTileId,
  suggestedTileId,
  onPick,
  compact = false,
}) {
  // Load family user tiles. When a locationHint is provided we fetch
  // only that location's tiles; when null we fetch all.
  const [userTiles] = useUserTiles(userId, { location: locationHint || undefined });

  // Inline CREATE NEW form state. Starts collapsed (just the button);
  // expands when the user taps + CREATE NEW.
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newEmoji, setNewEmoji] = useState("🗂️");
  const [newLocation, setNewLocation] = useState(locationHint || "pantry");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Compose the display list: built-in tiles for the hinted location
  // first, then user tiles for that location, then (if locationHint
  // is set) the other locations' tiles collapsed under an expander.
  const { primary, secondary } = useMemo(() => {
    const buildGroup = (loc) => {
      const builtIns = (BUILTIN_BY_LOCATION[loc] || []).map(t => ({
        source: "builtin",
        id:     t.id,
        emoji:  t.emoji,
        label:  t.label,
        blurb:  t.blurb,
        location: loc,
      }));
      const custom = userTiles
        .filter(t => t.location === loc)
        .map(t => ({
          source: "custom",
          id:     t.id,
          emoji:  t.emoji,
          label:  t.label,
          blurb:  `YOURS · USED ${t.useCount}×`,
          location: loc,
        }));
      return [...builtIns, ...custom];
    };

    if (locationHint) {
      return {
        primary:   buildGroup(locationHint),
        secondary: LOCATION_META
          .filter(l => l.id !== locationHint)
          .flatMap(l => buildGroup(l.id)),
      };
    }
    return {
      primary:   LOCATION_META.flatMap(l => buildGroup(l.id)),
      secondary: [],
    };
  }, [locationHint, userTiles]);

  const [secondaryOpen, setSecondaryOpen] = useState(false);

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    setCreateError(null);
    const { id, error, existed } = await createUserTile({
      userId,
      label: newLabel.trim(),
      emoji: newEmoji,
      location: newLocation,
    });
    setSaving(false);
    if (error) {
      setCreateError(error.message || "Couldn't create");
      return;
    }
    if (id) {
      // Auto-select the freshly-created (or matched-existing) tile.
      onPick?.(id, newLocation);
      setCreating(false);
      setNewLabel("");
      setNewEmoji("🗂️");
    }
    // existed=true is silent — the picker auto-selects the existing
    // one, which is the intent. If we want to show a "your family
    // already has this tile" toast we can wire it later.
  };

  const renderTile = (t) => {
    const active = selectedTileId === t.id;
    const suggested = !active && suggestedTileId === t.id;
    return (
      <button
        key={`${t.source}-${t.id}`}
        onClick={() => onPick?.(t.id, t.location)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: compact ? "10px 12px" : "10px 12px",
          width: "100%",
          background: active
            ? COLOR.goldDeep
            : suggested
              ? "#1e1a0e"
              : t.source === "custom" ? "#0f1620" : COLOR.soil,
          border: `1px solid ${
            active ? COLOR.gold
            : suggested ? COLOR.goldDim
            : t.source === "custom" ? COLOR.skyBorder : COLOR.border
          }`,
          borderRadius: RADIUS.lg,
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 20, flexShrink: 0 }}>{t.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.sans, fontSize: 13,
            color: active ? COLOR.gold : COLOR.ink,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {t.label}
          </div>
          <div style={{
            fontFamily: FONT.mono, fontSize: 9,
            color: t.source === "custom" ? COLOR.sky : COLOR.muted,
            letterSpacing: "0.06em", marginTop: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {suggested && "⭐ SUGGESTED · "}{t.blurb || "TAP TO PICK"}
          </div>
        </div>
        {active && (
          <span style={{
            fontFamily: FONT.mono, fontSize: 10,
            color: COLOR.gold, letterSpacing: "0.08em", flexShrink: 0,
          }}>
            ✓
          </span>
        )}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Primary group — tiles in the hinted location (or all when no
          hint). Always visible. */}
      {primary.map(renderTile)}

      {/* Secondary group — other locations' tiles, collapsed by default.
          Only appears when locationHint is set. */}
      {secondary.length > 0 && (
        <>
          <button
            onClick={() => setSecondaryOpen(v => !v)}
            style={{
              padding: "8px 12px",
              background: "transparent", border: `1px dashed ${COLOR.border}`,
              borderRadius: RADIUS.md,
              fontFamily: FONT.mono, fontSize: 10, color: COLOR.muted,
              letterSpacing: "0.1em", cursor: "pointer",
              textAlign: "left",
            }}
          >
            {secondaryOpen ? "▾" : "▸"} OTHER LOCATIONS · {secondary.length}
          </button>
          {secondaryOpen && secondary.map(renderTile)}
        </>
      )}

      {/* + CREATE NEW — inline expandable form. */}
      {!creating ? (
        <button
          onClick={() => setCreating(true)}
          style={{
            padding: "10px 12px",
            background: "transparent", border: `1px dashed ${COLOR.goldDim}`,
            color: COLOR.gold, borderRadius: RADIUS.lg,
            fontFamily: FONT.mono, fontSize: 11,
            letterSpacing: "0.1em", cursor: "pointer", fontWeight: 600,
            textAlign: "left",
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>➕</span>
          <span>CREATE NEW STORAGE AREA</span>
        </button>
      ) : (
        <div style={{
          padding: 12, border: `1px solid ${COLOR.goldDim}`,
          borderRadius: RADIUS.lg, background: COLOR.goldDeep,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLOR.gold, letterSpacing: "0.12em" }}>
            NEW STORAGE AREA
          </div>
          <input
            autoFocus
            type="text"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder='e.g. "Kids Snacks", "Protein Powders"'
            maxLength={48}
            style={{
              padding: "10px 12px",
              background: COLOR.deep, border: `1px solid ${COLOR.border}`,
              color: COLOR.ink, borderRadius: RADIUS.md,
              fontFamily: FONT.sans, fontSize: 14, outline: "none",
            }}
          />

          {/* Location picker (required — user tiles carry a location).
              Pre-selected from locationHint. */}
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: 9, color: COLOR.muted, letterSpacing: "0.1em", marginBottom: 6 }}>
              LIVES IN
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {LOCATION_META.map(l => {
                const active = newLocation === l.id;
                return (
                  <button
                    key={l.id}
                    onClick={() => setNewLocation(l.id)}
                    style={{
                      flex: 1, padding: "8px 6px",
                      background: active ? COLOR.goldDeep : COLOR.deep,
                      color: active ? COLOR.gold : COLOR.ink,
                      border: `1px solid ${active ? COLOR.gold : COLOR.border}`,
                      borderRadius: RADIUS.md,
                      fontFamily: FONT.mono, fontSize: 10,
                      letterSpacing: "0.06em", cursor: "pointer",
                    }}
                  >
                    {l.emoji} {l.label.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Emoji chooser — small curated grid. */}
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: 9, color: COLOR.muted, letterSpacing: "0.1em", marginBottom: 6 }}>
              EMOJI · {newEmoji}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4 }}>
              {EMOJI_OPTIONS.map(em => (
                <button
                  key={em}
                  onClick={() => setNewEmoji(em)}
                  style={{
                    padding: "6px 0", fontSize: 18,
                    background: newEmoji === em ? COLOR.goldDeep : COLOR.deep,
                    border: `1px solid ${newEmoji === em ? COLOR.gold : COLOR.edge}`,
                    borderRadius: RADIUS.sm, cursor: "pointer",
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          {createError && (
            <div style={{
              fontFamily: FONT.sans, fontSize: 11, color: COLOR.rose,
              padding: 6, background: COLOR.roseDeep, borderRadius: RADIUS.sm,
            }}>
              {createError}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setCreating(false); setNewLabel(""); setCreateError(null); }}
              disabled={saving}
              style={{
                flex: 1, padding: "10px",
                background: COLOR.ground, border: `1px solid ${COLOR.border}`,
                color: COLOR.muted, borderRadius: RADIUS.md,
                fontFamily: FONT.mono, fontSize: 11,
                letterSpacing: "0.08em", cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              CANCEL
            </button>
            <button
              onClick={handleCreate}
              disabled={!newLabel.trim() || saving}
              style={{
                flex: 2, padding: "10px",
                background: !newLabel.trim() || saving ? COLOR.ground : COLOR.gold,
                border: "none",
                color: !newLabel.trim() || saving ? COLOR.muted : "#111",
                borderRadius: RADIUS.md,
                fontFamily: FONT.mono, fontSize: 12, fontWeight: 600,
                letterSpacing: "0.08em",
                cursor: !newLabel.trim() || saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "CREATING…" : "CREATE & PICK"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
