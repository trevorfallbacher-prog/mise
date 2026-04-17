import { useMemo, useState } from "react";
import { FOOD_TYPES } from "../data/foodTypes";
import { useUserTypes } from "../lib/useUserTypes";
import { createUserType } from "../lib/userTypes";
import { FRIDGE_TILES } from "../lib/fridgeTiles";
import { PANTRY_TILES } from "../lib/pantryTiles";
import { FREEZER_TILES } from "../lib/freezerTiles";
import { COLOR, FONT, RADIUS } from "../lib/tokens";

// TypePicker — the IDENTIFIED AS chooser. Single-select (one type
// per item, same as WWEIA's own single-classification discipline).
//
// Shows:
//   * Bundled WWEIA food types (src/data/foodTypes.js)
//   * Family's user-created types (from useUserTypes)
//   * "+ CREATE NEW TYPE" with inline form
//
// Visually parallel to IdentifiedAsPicker (the STORED IN chooser) —
// same row shape, same + CREATE NEW pattern. Consistency beats
// cleverness.
//
// Props:
//   userId          — for user-types loading + creation
//   selectedTypeId  — current pick
//   suggestedTypeId — from name-inference, gets ⭐ SUGGESTED
//   onPick(typeId, defaultTileId, defaultLocation) — type's defaults
//                     flow up so the caller can auto-suggest STORED IN
//   compact         — optional denser layout (for modal contexts)
//
// defaultTileId / defaultLocation flow:
//   * Bundled types: pulled from FOOD_TYPES entry
//   * User types:   pulled from user_types row (set by user at
//                   creation time)
//   * onPick gets both — caller decides whether to auto-apply or
//     just surface as a suggestion

// Bundled tile id -> emoji/label lookup for rendering "defaults to"
// hint under each type. Uses the already-imported tile arrays.
const TILE_LOOKUP = (() => {
  const m = new Map();
  for (const t of [...FRIDGE_TILES, ...PANTRY_TILES, ...FREEZER_TILES]) {
    m.set(t.id, t);
  }
  return m;
})();

// Emoji options surfaced in the CREATE NEW form — food-first,
// curated. The 🏷️ default is always available.
const EMOJI_OPTIONS = [
  "🏷️", "🍕", "🥪", "🧀", "🥛", "🥩", "🍗", "🐟", "🦐",
  "🥚", "🍞", "🍝", "🍚", "🥗", "🌮", "🥟", "🍲", "🥡",
  "🍎", "🥕", "🌶️", "🌿", "🧂", "🍯", "🍫", "🍰", "🍦",
];

export default function TypePicker({
  userId,
  selectedTypeId,
  suggestedTypeId,
  onPick,
}) {
  const [userTypes] = useUserTypes(userId);

  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newEmoji, setNewEmoji] = useState("🏷️");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Compose the display list: bundled WWEIA types first, then
  // family's user types. Bundled stay in curated order; user types
  // sort by recency (already handled by useUserTypes).
  const { bundled, custom } = useMemo(() => ({
    bundled: FOOD_TYPES.map(t => ({
      source: "bundled",
      id:     t.id,
      emoji:  t.emoji,
      label:  t.label,
      blurb:  t.blurb,
      defaultTileId:   t.defaultTileId,
      defaultLocation: t.defaultLocation,
    })),
    custom: userTypes.map(t => ({
      source: "custom",
      id:     t.id,
      emoji:  t.emoji,
      label:  t.label,
      blurb:  t.useCount > 0 ? `YOURS · USED ${t.useCount}×` : "YOURS",
      defaultTileId:   t.defaultTileId,
      defaultLocation: t.defaultLocation,
    })),
  }), [userTypes]);

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    setCreateError(null);
    const { id, error } = await createUserType({
      userId,
      label: newLabel.trim(),
      emoji: newEmoji,
      // New user types don't pre-suggest a tile until user picks one
      // via the type-edit flow (future polish) or from drilling into
      // an item that uses this type and moving it.
      defaultTileId: null,
      defaultLocation: null,
    });
    setSaving(false);
    if (error) {
      setCreateError(error.message || "Couldn't create");
      return;
    }
    if (id) {
      onPick?.(id, null, null);
      setCreating(false);
      setNewLabel("");
      setNewEmoji("🏷️");
    }
  };

  const renderTypeRow = (t) => {
    const active = selectedTypeId === t.id;
    const suggested = !active && suggestedTypeId === t.id;
    const tileHint = t.defaultTileId ? TILE_LOOKUP.get(t.defaultTileId) : null;
    return (
      <button
        key={`${t.source}-${t.id}`}
        onClick={() => onPick?.(t.id, t.defaultTileId || null, t.defaultLocation || null)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px",
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
            {suggested && "⭐ SUGGESTED · "}
            {t.blurb || "TAP TO PICK"}
            {tileHint && (
              <span style={{ color: COLOR.muted }}>
                {" · "}→ {tileHint.emoji} {tileHint.label.toUpperCase()}
              </span>
            )}
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
      {/* Custom types first when present (family-personal signal
          beats generic taxonomy — you care about YOUR types more
          than USDA's categorization in routine use) */}
      {custom.length > 0 && (
        <>
          <div style={{
            fontFamily: FONT.mono, fontSize: 9, color: COLOR.sky,
            letterSpacing: "0.12em", marginTop: 2, marginBottom: 2,
          }}>
            👤 YOUR FAMILY
          </div>
          {custom.map(renderTypeRow)}
          <div style={{
            fontFamily: FONT.mono, fontSize: 9, color: COLOR.muted,
            letterSpacing: "0.12em", marginTop: 6, marginBottom: 2,
          }}>
            📖 STANDARD (USDA)
          </div>
        </>
      )}
      {bundled.map(renderTypeRow)}

      {/* + CREATE NEW inline expander */}
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
            marginTop: 6,
          }}
        >
          <span style={{ fontSize: 16 }}>➕</span>
          <span>CREATE NEW TYPE</span>
        </button>
      ) : (
        <div style={{
          padding: 12, border: `1px solid ${COLOR.goldDim}`,
          borderRadius: RADIUS.lg, background: COLOR.goldDeep,
          display: "flex", flexDirection: "column", gap: 10, marginTop: 6,
        }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLOR.gold, letterSpacing: "0.12em" }}>
            NEW TYPE
          </div>
          <input
            autoFocus
            type="text"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder='e.g. "Kids Snacks", "Gua Bao", "Hot Sauces"'
            maxLength={48}
            style={{
              padding: "10px 12px",
              background: COLOR.deep, border: `1px solid ${COLOR.border}`,
              color: COLOR.ink, borderRadius: RADIUS.md,
              fontFamily: FONT.sans, fontSize: 14, outline: "none",
            }}
          />

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
