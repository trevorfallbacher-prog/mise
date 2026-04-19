import { useMemo, useState } from "react";
import { FOOD_TYPES } from "../data/foodTypes";
import { useUserTypes } from "../lib/useUserTypes";
import { createUserType } from "../lib/userTypes";
import { FRIDGE_TILES } from "../lib/fridgeTiles";
import { PANTRY_TILES } from "../lib/pantryTiles";
import { FREEZER_TILES } from "../lib/freezerTiles";
import { COLOR, FONT, RADIUS } from "../lib/tokens";

// TypePicker — the CATEGORY chooser. Single-select.
//
// UX shape (the "star-first" rewrite):
//   1. If we have a ⭐ suggestion (from name inference, learned
//      scan-text memory, or the user's previous pick), it's pinned
//      at the top as the one-tap default — no scrolling, no hunting.
//      Most scans end here.
//   2. A search input filters the full catalog (bundled USDA/WWEIA
//      types + any historical user-created types). Results only
//      appear when the user types.
//   3. Categories drive state vocab + tile routing, so they're
//      LOCKED to the bundled USDA list by default (allowCreate=false).
//      Admin surfaces that want user-type creation pass
//      allowCreate={true} explicitly. This keeps meat / cheese /
//      bread state detection reliable — user-invented categories
//      don't have state vocabularies and would silently break the
//      STATE picker downstream.
//
// Props:
//   userId          — for user-types loading + creation
//   selectedTypeId  — current pick (if any)
//   suggestedTypeId — from name-inference / scan memory, gets ⭐
//   onPick(typeId, defaultTileId, defaultLocation) — type's defaults
//                     flow up so the caller can auto-suggest STORED IN
//   allowCreate     — opt-in gate for the CREATE NEW TYPE form.
//                     Default false. Kept here for admin use; every
//                     user-facing surface should LEAVE IT DEFAULT so
//                     users can't mint categories that don't match a
//                     state vocabulary.

// Bundled tile id -> emoji/label lookup for the "defaults to" hint
// under each type. Uses the already-imported tile arrays.
const TILE_LOOKUP = (() => {
  const m = new Map();
  for (const t of [...FRIDGE_TILES, ...PANTRY_TILES, ...FREEZER_TILES]) {
    m.set(t.id, t);
  }
  return m;
})();

// Emoji options surfaced in the CREATE NEW form.
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
  allowCreate = false,
}) {
  const [userTypes] = useUserTypes(userId);

  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newEmoji, setNewEmoji] = useState("🏷️");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Flatten bundled + custom into one searchable catalog. User types
  // bubble to the top of the search results (personal > generic).
  const catalog = useMemo(() => {
    const bundled = FOOD_TYPES.map(t => ({
      source: "bundled",
      id:     t.id,
      emoji:  t.emoji,
      label:  t.label,
      blurb:  t.blurb,
      aliases: t.aliases || [],
      defaultTileId:   t.defaultTileId,
      defaultLocation: t.defaultLocation,
    }));
    const custom = userTypes.map(t => ({
      source: "custom",
      id:     t.id,
      emoji:  t.emoji,
      label:  t.label,
      blurb:  t.useCount > 0 ? `YOURS · USED ${t.useCount}×` : "YOURS",
      aliases: [],
      defaultTileId:   t.defaultTileId,
      defaultLocation: t.defaultLocation,
    }));
    return [...custom, ...bundled];
  }, [userTypes]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const t of catalog) m.set(t.id, t);
    return m;
  }, [catalog]);

  const star = suggestedTypeId ? byId.get(suggestedTypeId) : null;
  const current = selectedTypeId ? byId.get(selectedTypeId) : null;

  const needle = search.trim().toLowerCase();
  // Rows the user will see below the starred + current picks.
  //
  // No search typed → the full catalog minus whatever's already
  // pinned as the star or current pick (those render in dedicated
  // rows above; no duplicates here). Always-on browse list so the
  // user can see alternatives without needing to guess the right
  // search term.
  //
  // Search typed → filter the same baseline list by label /
  // aliases. If zero match, we DON'T collapse to a dead "Nothing
  // matched" state — we keep the unfiltered list visible + render
  // a small info chip above so the user still has options in view.
  // (User: "don't collapse to zero recommendations… I want to see
  // recommendations outside of the chosen one or starred.")
  const excludeIds = useMemo(() => {
    const s = new Set();
    if (suggestedTypeId) s.add(suggestedTypeId);
    if (selectedTypeId)  s.add(selectedTypeId);
    return s;
  }, [suggestedTypeId, selectedTypeId]);

  const baselineList = useMemo(() => (
    catalog.filter(t => !excludeIds.has(t.id))
  ), [catalog, excludeIds]);

  const searchMatches = useMemo(() => {
    if (!needle) return [];
    return baselineList
      .filter(t => {
        if (t.label.toLowerCase().includes(needle)) return true;
        if (t.aliases.some(a => a.toLowerCase().includes(needle))) return true;
        return false;
      })
      // Keep user types first in results (catalog is already ordered
      // custom → bundled), and cap so the modal doesn't explode.
      .slice(0, 20);
  }, [baselineList, needle]);
  const hasSearchHits = needle.length > 0 && searchMatches.length > 0;
  const hasSearchMiss = needle.length > 0 && searchMatches.length === 0;

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    setCreateError(null);
    const { id, error } = await createUserType({
      userId,
      label: newLabel.trim(),
      emoji: newEmoji,
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

  // Shared row render — used by the starred row, the current-pick
  // row (if different from star), and search results.
  const renderTypeRow = (t, variant) => {
    const active = selectedTypeId === t.id;
    const suggested = variant === "star";
    const tileHint = t.defaultTileId ? TILE_LOOKUP.get(t.defaultTileId) : null;
    return (
      <button
        key={`${variant}-${t.source}-${t.id}`}
        onClick={() => onPick?.(t.id, t.defaultTileId || null, t.defaultLocation || null)}
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
            {!suggested && tileHint && (
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* ── ⭐ STAR · the one-tap default ─────────────────────────── */}
      {star && renderTypeRow(star, "star")}

      {/* Current pick (only if different from star and not already
          shown). Keeps the user's existing choice visible so they
          can re-confirm without re-finding it in search. */}
      {current && (!star || current.id !== star.id) &&
        renderTypeRow(current, "current")}

      {/* ── + CREATE NEW · admin/opt-in only. USDA categories drive
          state vocab + tile routing, so letting users mint their own
          category silently breaks the STATE picker for that item.
          Gate lives on the `allowCreate` prop; the default is false,
          so every user-facing surface just sees the bundled USDA
          list without a "add your own" escape hatch. ────── */}
      {allowCreate && !creating ? (
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
          <span>CREATE NEW TYPE</span>
        </button>
      ) : allowCreate && creating ? (
        <div style={{
          padding: 12, border: `1px solid ${COLOR.goldDim}`,
          borderRadius: RADIUS.lg, background: COLOR.goldDeep,
          display: "flex", flexDirection: "column", gap: 10,
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
      ) : null}

      {/* ── Search · filters the full catalog on demand ────────── */}
      <div style={{ marginTop: 2 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={star
            ? "Not that? Search for another type…"
            : "Search types (pizza, cheese, sausages…)"}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "10px 12px",
            background: COLOR.deep, border: `1px solid ${COLOR.border}`,
            color: COLOR.ink, borderRadius: RADIUS.md,
            fontFamily: FONT.sans, fontSize: 14, outline: "none",
          }}
        />
      </div>

      {/* Result list area — ALWAYS shows recommendations. Three
          modes, stacked in this order so the user is never staring
          at a blank sheet:
            1. Search has hits → render just those matches (filtered)
            2. Search typed but zero hits → render a small "nothing
               matched" note, then the baseline list below so the
               user can still browse
            3. No search typed → render the full baseline list
          Baseline = full catalog minus whatever's already pinned
          as ⭐ star or current pick (those sit above; no duplicates
          down here). Cap at 20 so the sheet stays a one-thumb scroll. */}
      {hasSearchMiss && (
        <div style={{
          padding: "10px 12px",
          background: COLOR.deep, border: `1px dashed ${COLOR.border}`,
          borderRadius: RADIUS.md,
          fontFamily: FONT.sans, fontSize: 11, color: COLOR.muted,
          fontStyle: "italic", lineHeight: 1.5,
        }}>
          Nothing matched "{search.trim()}" — browsing the full list below.
        </div>
      )}
      {hasSearchHits
        ? searchMatches.map(t => renderTypeRow(t, "search"))
        : baselineList.slice(0, 20).map(t => renderTypeRow(t, "recommendation"))}
    </div>
  );
}
