import { useMemo, useState } from "react";
import { FRIDGE_TILES } from "../lib/fridgeTiles";
import { PANTRY_TILES } from "../lib/pantryTiles";
import { FREEZER_TILES } from "../lib/freezerTiles";
import { useUserTiles } from "../lib/useUserTiles";
import { createUserTile } from "../lib/userTiles";
import { COLOR, FONT, RADIUS } from "../lib/tokens";

// STORED IN (tile) picker — "where does this live" chooser.
//
// UX shape (the "star-first" rewrite, mirroring TypePicker):
//   1. ⭐ suggested tile pinned at top — the one-tap default.
//   2. + CREATE NEW STORAGE AREA right below the star.
//   3. Search input filters the full catalog (built-in tiles for
//      the hinted location + family user tiles). Results only
//      render when the user types.
//
// Props:
//   userId         — for creating new tiles + family-scoping user tiles
//   locationHint   — fridge | pantry | freezer | null. Biases the
//                    search so tiles in that location come first.
//   selectedTileId — currently picked tile id
//   suggestedTileId— keyword / memory-inferred suggestion. Gets ⭐
//   onPick(tileId, location) — called when user picks a tile
//   allowClear     — if true, render a "CLEAR · route by components"
//                    affordance so existing items can fall back to
//                    the heuristic classifier

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
  allowClear = false,
}) {
  // When no locationHint, fetch all; when hinted, still fetch all so
  // search can find user tiles across locations.
  const [userTiles] = useUserTiles(userId);

  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newEmoji, setNewEmoji] = useState("🗂️");
  const [newLocation, setNewLocation] = useState(locationHint || "pantry");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Flat searchable catalog: family user tiles first, then built-ins
  // for the hinted location, then built-ins for the other locations.
  const catalog = useMemo(() => {
    const custom = userTiles.map(t => ({
      source: "custom",
      id:     t.id,
      emoji:  t.emoji,
      label:  t.label,
      blurb:  t.useCount > 0 ? `YOURS · USED ${t.useCount}×` : "YOURS",
      location: t.location,
    }));
    const mkBuiltIns = (loc) =>
      (BUILTIN_BY_LOCATION[loc] || []).map(t => ({
        source: "builtin",
        id:     t.id,
        emoji:  t.emoji,
        label:  t.label,
        blurb:  t.blurb,
        location: loc,
      }));

    const primary   = locationHint ? mkBuiltIns(locationHint) : [];
    const others    = LOCATION_META
      .map(l => l.id)
      .filter(id => id !== locationHint)
      .flatMap(mkBuiltIns);
    const allBuiltIns = locationHint ? [...primary, ...others] : [...mkBuiltIns("fridge"), ...mkBuiltIns("pantry"), ...mkBuiltIns("freezer")];
    return [...custom, ...allBuiltIns];
  }, [userTiles, locationHint]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const t of catalog) m.set(t.id, t);
    return m;
  }, [catalog]);

  const star = suggestedTileId ? byId.get(suggestedTileId) : null;
  const current = selectedTileId ? byId.get(selectedTileId) : null;

  const needle = search.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!needle) return [];
    return catalog
      .filter(t => t.label.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [catalog, needle]);

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    setCreateError(null);
    const { id, error } = await createUserTile({
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
      onPick?.(id, newLocation);
      setCreating(false);
      setNewLabel("");
      setNewEmoji("🗂️");
    }
  };

  const renderTile = (t, variant) => {
    const active = selectedTileId === t.id;
    const suggested = variant === "star";
    return (
      <button
        key={`${variant}-${t.source}-${t.id}`}
        onClick={() => onPick?.(t.id, t.location)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: suggested ? "14px 14px" : "10px 12px",
          width: "100%",
          background: active
            ? COLOR.goldDeep
            : suggested
              ? "#1e1a0e"
              : t.source === "custom" ? "#0f1620" : COLOR.soil,
          border: `1px solid ${
            active ? COLOR.gold
            : suggested ? COLOR.gold
            : t.source === "custom" ? COLOR.skyBorder : COLOR.border
          }`,
          borderRadius: RADIUS.lg,
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: suggested ? 26 : 20, flexShrink: 0 }}>
          {suggested ? "⭐" : t.emoji}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.sans, fontSize: suggested ? 15 : 13,
            color: active ? COLOR.gold : COLOR.ink,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {suggested && <span style={{ fontSize: 18 }}>{t.emoji}</span>}
            <span>{t.label}</span>
          </div>
          <div style={{
            fontFamily: FONT.mono, fontSize: 9,
            color: suggested ? COLOR.gold
              : t.source === "custom" ? COLOR.sky : COLOR.muted,
            letterSpacing: "0.06em", marginTop: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {suggested && "⭐ BEST GUESS · TAP TO USE"}
            {!suggested && (t.blurb || "TAP TO PICK")}
            {!suggested && t.location && (
              <span style={{ color: COLOR.muted }}>
                {" · "}{t.location.toUpperCase()}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* ⭐ Star — the one-tap default. */}
      {star && renderTile(star, "star")}

      {/* Current pick (if different from star). */}
      {current && (!star || current.id !== star.id) &&
        renderTile(current, "current")}

      {/* + CREATE NEW — right below the star. */}
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

      {/* Search — catalog on demand. */}
      <div style={{ marginTop: 2 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={star
            ? "Not that? Search for another spot…"
            : "Search storage areas (fridge door, spice rack…)"}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "10px 12px",
            background: COLOR.deep, border: `1px solid ${COLOR.border}`,
            color: COLOR.ink, borderRadius: RADIUS.md,
            fontFamily: FONT.sans, fontSize: 14, outline: "none",
          }}
        />
      </div>

      {needle && searchMatches.length === 0 && (
        <div style={{
          padding: "12px 14px",
          background: COLOR.deep, border: `1px dashed ${COLOR.border}`,
          borderRadius: RADIUS.md,
          fontFamily: FONT.sans, fontSize: 12, color: COLOR.muted,
          fontStyle: "italic", lineHeight: 1.5,
        }}>
          Nothing matched "{search.trim()}". Try a shorter term, or
          tap CREATE NEW STORAGE AREA above.
        </div>
      )}
      {searchMatches.map(t => renderTile(t, "search"))}

      {/* Clear affordance — only on existing items (ItemCard).
          Resets the tile so the heuristic classifier routes by
          components / canonical on next render. */}
      {allowClear && selectedTileId && (
        <button
          onClick={() => onPick?.(null, null)}
          style={{
            marginTop: 4,
            padding: "10px 12px",
            background: "transparent", border: `1px solid ${COLOR.border}`,
            color: COLOR.muted, borderRadius: RADIUS.lg,
            fontFamily: FONT.mono, fontSize: 11,
            letterSpacing: "0.08em", cursor: "pointer",
            textAlign: "center",
          }}
        >
          CLEAR · AUTO-ROUTE BY INGREDIENT
        </button>
      )}
    </div>
  );
}
