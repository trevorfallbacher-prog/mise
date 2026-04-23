import { useEffect, useMemo, useState } from "react";
import { FRIDGE_TILES } from "../lib/fridgeTiles";
import { PANTRY_TILES } from "../lib/pantryTiles";
import { FREEZER_TILES } from "../lib/freezerTiles";
import { useUserTiles } from "../lib/useUserTiles";
import { createUserTile } from "../lib/userTiles";
import { COLOR, FONT, RADIUS } from "../lib/tokens";

// STORED IN (tile) picker — "where does this live" chooser.
//
// UX shape (star-first + location-pills):
//   1. 🧊 FRIDGE / 🥫 PANTRY / ❄️ FREEZER pills at the very top.
//      The current location is highlighted. Tapping a different
//      pill switches the active location — star re-evaluates,
//      catalog filters, a "JUST USE ❄️ FREEZER" one-tap shortcut
//      surfaces for users who just want to move the row without
//      picking a specific shelf. Supports the strawberries-go-
//      freezer case: one tap on the freezer pill, one tap on the
//      JUST USE shortcut, done.
//   2. ⭐ suggested tile pinned — the named-shelf default when
//      keyword inference matches a tile IN the active location.
//      Hidden when the suggestion's location doesn't match
//      (avoids misleading the user after a pill switch).
//   3. + CREATE NEW STORAGE AREA right below.
//   4. Search input filters the active-location catalog + family
//      user tiles. Empty state is a gentle nudge.
//
// Props:
//   userId         — for creating new tiles + family-scoping user tiles
//   locationHint   — fridge | pantry | freezer | null. Initial
//                    active location; user can switch via pills.
//   selectedTileId — currently picked tile id
//   suggestedTileId— keyword / memory-inferred suggestion. Gets ⭐
//                    when its location matches active location.
//   onPick(tileId, location) — called when user picks a tile OR
//                    commits a location-only change (tileId=null).
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
  // Family-scope user tiles — no location filter so search can find
  // tiles the user owns in any location.
  const [userTiles] = useUserTiles(userId);

  // Active location — the top-of-sheet pills drive this. Defaults to
  // the hint (the caller's current location) but the user can flip
  // it mid-session. A null hint falls through to "pantry" so we
  // always have SOMETHING to filter on; first-time adds on an
  // un-placed row just start there.
  const [activeLocation, setActiveLocation] = useState(locationHint || "pantry");

  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newEmoji, setNewEmoji] = useState("🗂️");
  const [newLocation, setNewLocation] = useState(locationHint || "pantry");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Flat searchable catalog — filtered to the ACTIVE location. User
  // tiles are included for that location only; switching locations
  // reshuffles everything.
  const catalog = useMemo(() => {
    const custom = userTiles
      .filter(t => t.location === activeLocation)
      .map(t => ({
        source: "custom",
        id:     t.id,
        emoji:  t.emoji,
        label:  t.label,
        blurb:  t.useCount > 0 ? `YOURS · USED ${t.useCount}×` : "YOURS",
        location: t.location,
      }));
    const builtIns = (BUILTIN_BY_LOCATION[activeLocation] || []).map(t => ({
      source: "builtin",
      id:     t.id,
      emoji:  t.emoji,
      label:  t.label,
      blurb:  t.blurb,
      location: activeLocation,
    }));
    return [...custom, ...builtIns];
  }, [userTiles, activeLocation]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const t of catalog) m.set(t.id, t);
    return m;
  }, [catalog]);

  // Star is only shown when the caller's suggestion lives in the
  // ACTIVE location. After a pill switch (e.g. user flipped from
  // Pantry → Freezer for strawberries), a suggestion like
  // "Produce · pantry" is no longer relevant — hide it so the user
  // isn't encouraged to re-commit the thing they just overrode.
  const star = (() => {
    if (!suggestedTileId) return null;
    const t = byId.get(suggestedTileId);
    return t && t.location === activeLocation ? t : null;
  })();
  // Current pick: show ONLY if it's in the active location (same
  // reasoning — selecting a fridge tile then flipping to Freezer
  // means the active intent has moved).
  const current = (() => {
    if (!selectedTileId) return null;
    const t = byId.get(selectedTileId);
    return t && t.location === activeLocation ? t : null;
  })();

  const needle = search.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!needle) return [];
    return catalog
      .filter(t => t.label.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [catalog, needle]);

  const activeMeta = LOCATION_META.find(l => l.id === activeLocation) || LOCATION_META[1];

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

  // One-shot pick celebration — mirrors the TypePicker pattern so
  // every sheet-picker in the app feels the same when you tap an
  // option. See TypePicker for rationale.
  const [justPickedId, setJustPickedId] = useState(null);
  useEffect(() => {
    if (!justPickedId) return;
    const t = setTimeout(() => setJustPickedId(null), 480);
    return () => clearTimeout(t);
  }, [justPickedId]);

  const renderTile = (t, variant, idx = 0) => {
    const active = selectedTileId === t.id;
    const suggested = variant === "star";
    const picked = justPickedId === t.id;
    return (
      <button
        key={`${variant}-${t.source}-${t.id}`}
        className={`mise-fade-in${picked ? " mise-picked" : ""}`}
        onClick={() => {
          setJustPickedId(t.id);
          setTimeout(() => onPick?.(t.id, t.location), 120);
        }}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: suggested ? "16px 16px" : "12px 14px",
          minHeight: 48,
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
          ["--mise-delay"]: `${Math.min(idx * 32, 320)}ms`,
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
      {/* Location pills — one-tap storage-area switcher. Drives
          the star / catalog / JUST-USE shortcut below. Paired with
          the JUST-USE button, this is the "strawberries go to the
          freezer, don't make me find a freezer tile" path. */}
      <div>
        <div style={{
          fontFamily: FONT.mono, fontSize: 9, color: COLOR.muted,
          letterSpacing: "0.12em", marginBottom: 6,
        }}>
          LOCATION
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {LOCATION_META.map(l => {
            const active = activeLocation === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setActiveLocation(l.id)}
                style={{
                  flex: 1, padding: "10px 6px",
                  background: active ? COLOR.goldDeep : COLOR.deep,
                  color: active ? COLOR.gold : COLOR.ink,
                  border: `1px solid ${active ? COLOR.gold : COLOR.border}`,
                  borderRadius: RADIUS.md,
                  fontFamily: FONT.mono, fontSize: 11,
                  letterSpacing: "0.08em", cursor: "pointer",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {l.emoji} {l.label.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {/* JUST-USE shortcut — commit the active location without
          picking a specific shelf. Sets tile_id=null so the heuristic
          classifier routes at render time; the location column is
          what pantry_items actually uses for grouping. Appears only
          when the user has CHANGED location from the hint and hasn't
          picked a specific tile yet — otherwise it's noise. */}
      {activeLocation !== (locationHint || "pantry") && (
        <button
          onClick={() => onPick?.(null, activeLocation)}
          style={{
            padding: "12px 14px",
            background: "#1e1a0e",
            border: `1px solid ${COLOR.gold}`,
            borderRadius: RADIUS.lg,
            fontFamily: FONT.mono, fontSize: 12, fontWeight: 600,
            color: COLOR.gold, letterSpacing: "0.08em",
            cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          <span style={{ fontSize: 20 }}>{activeMeta.emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>JUST USE {activeMeta.label.toUpperCase()}</div>
            <div style={{
              fontFamily: FONT.mono, fontSize: 9, color: COLOR.muted,
              letterSpacing: "0.06em", marginTop: 2, fontWeight: 400,
            }}>
              I'LL PICK A SHELF LATER
            </div>
          </div>
          <span style={{ fontSize: 14, color: COLOR.gold }}>→</span>
        </button>
      )}

      {/* ⭐ Star — one-tap default when the keyword/memory
          suggestion lives in the active location. */}
      {star && renderTile(star, "star")}

      {/* Current pick (if different from star and still in active
          location). */}
      {current && (!star || current.id !== star.id) &&
        renderTile(current, "current")}

      {/* + CREATE NEW — right below the star. */}
      {!creating ? (
        <button
          onClick={() => {
            // Pre-select the active location in the form — matches
            // the user's just-expressed intent.
            setNewLocation(activeLocation);
            setCreating(true);
          }}
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
          placeholder={`Search ${activeMeta.label.toLowerCase()} shelves…`}
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
      {searchMatches.map((t, i) => renderTile(t, "search", i))}

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
