import { useMemo, useState } from "react";
import { findIngredient, fuzzyMatchIngredient } from "../data/ingredients";
import { BLEND_PRESETS } from "../data/blendPresets";

// Confidence bucketing for the match list — the raw 0–120 score reads as
// noise; these labels give the user something to decide on. Thresholds
// picked by eyeballing real scan misidentifications.
function confidenceTone(score) {
  if (score >= 90) return { label: "Exact",  color: "#4ade80" };
  if (score >= 60) return { label: "Likely", color: "#a3d977" };
  if (score >= 40) return { label: "Maybe",  color: "#f59e0b" };
  return { label: "Weak", color: "#666" };
}

/**
 * LinkIngredient — bottom-sheet picker that tags a pantry row with one or
 * more canonical ingredient ids.
 *
 * Multi-select accumulator flow (6a):
 *   Tapping a match or preset APPENDS to the selection instead of
 *   committing + closing. The SELECTED chip row at the top shows every
 *   tag currently on deck; individual tags can be removed by tapping
 *   their ✕. DONE commits the full array via onLink() and closes.
 *
 *   Rationale: one item can legitimately carry an arbitrary number of
 *   canonical tags (a frozen burrito is 8+ ingredients; a "loaded
 *   nachos" kit item is 10+). Forcing the user to pick a preset that
 *   happens to match, or go one-at-a-time via re-opening the sheet,
 *   was the root cause of the "only 2 tags, both cheese" bug — the
 *   shortest preset that matched the user's typed name was Pizza Blend
 *   (mozzarella + provolone), and that's what they got stuck with.
 *
 *   No hard cap on tag count — users can add as many as they need. The
 *   ItemCard display is what applies the 5-tag show-more collapse so
 *   the editor isn't artificially limited.
 *
 * Initial selection: pre-populates from item.ingredientIds / item.ingredientId
 * so re-opening the sheet on an already-tagged item shows the current
 * tags, which can then be tweaked (append, remove, rearrange) before
 * re-committing.
 *
 * Props:
 *   item           — the pantry row being linked ({ name, emoji, ingredientIds, … })
 *   onLink(ids)    — called with an ARRAY of canonical ids when the user
 *                    taps DONE. Always an array; pass [] to clear tagging
 *                    entirely and return to free-text (same as the old
 *                    "KEEP AS FREE TEXT" escape hatch).
 *   onClose()      — dismiss without committing.
 */
export default function LinkIngredient({ item, onLink, onClose }) {
  const [search, setSearch] = useState("");
  const needle = search.trim() || item.name;
  const matches = useMemo(() => fuzzyMatchIngredient(needle, 8), [needle]);

  // Seed the selection from the item's current tags so re-opening the
  // sheet on an already-tagged item lets the user incrementally adjust
  // instead of starting from zero. Prefers ingredientIds (plural, 0033)
  // and falls back to the legacy scalar.
  const [selected, setSelected] = useState(() => {
    const seed = Array.isArray(item?.ingredientIds) && item.ingredientIds.length
      ? item.ingredientIds
      : (item?.ingredientId ? [item.ingredientId] : []);
    return seed
      .map(id => ({ id, canonical: findIngredient(id) }))
      .filter(s => s.canonical);
  });
  const selectedIds = useMemo(() => new Set(selected.map(s => s.id)), [selected]);

  const addTag = (id) => {
    const canonical = findIngredient(id);
    if (!canonical) return;
    setSelected(prev => prev.some(s => s.id === id) ? prev : [...prev, { id, canonical }]);
  };
  // Append a preset's component ids in order, skipping any already on deck.
  // Users who tap Italian Blend then Mexican Blend end up with the union
  // of both sets without duplicates — useful for custom "extra cheesy"
  // blends that cross preset boundaries.
  const addPreset = (ids) => {
    setSelected(prev => {
      const have = new Set(prev.map(s => s.id));
      const next = [...prev];
      for (const id of ids) {
        if (have.has(id)) continue;
        const canonical = findIngredient(id);
        if (!canonical) continue;
        next.push({ id, canonical });
        have.add(id);
      }
      return next;
    });
  };
  const removeTag = (id) => setSelected(prev => prev.filter(s => s.id !== id));
  const clearAll  = () => setSelected([]);

  // Surface a preset whenever the item name / search matches a blend
  // label or any of its component names. Filters out presets whose
  // component ids don't all resolve.
  const presetMatches = useMemo(() => {
    const n = (needle || "").toLowerCase();
    if (!n) return [];
    return BLEND_PRESETS.filter(preset => {
      // All component ingredients must exist — broken presets don't render.
      const resolved = preset.ingredientIds.every(id => !!findIngredient(id));
      if (!resolved) return false;
      // Label match, description match, or any component name match.
      if (preset.label.toLowerCase().includes(n)) return true;
      if (preset.description.toLowerCase().includes(n)) return true;
      return preset.ingredientIds.some(id => {
        const ing = findIngredient(id);
        return ing?.name.toLowerCase().includes(n);
      });
    }).slice(0, 4);
  }, [needle]);

  const commit = () => {
    onLink(selected.map(s => s.id));
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 340,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "20px 22px 28px",
        maxHeight: "85vh", overflowY: "auto",
      }}>
        <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 16px" }} />

        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
          LINK TO CANONICAL
        </div>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 24, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", margin: "4px 0 6px" }}>
          <span style={{ fontSize: 20, marginRight: 6 }}>{item.emoji || "🥫"}</span>
          "{item.name}"
        </h2>
        <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.5, margin: "0 0 14px" }}>
          Tap ingredients to add them. Tap a blend to add several at once. The same item can carry as many tags as it actually contains — burritos, pizzas, shredded blends.
        </p>

        {/* SELECTED — the accumulator. Shown at the top so the user always
            sees what's on deck before committing. Empty state reads as an
            invitation rather than an error — linking nothing is a valid
            outcome (equivalent to the old KEEP AS FREE TEXT button). */}
        <div style={{
          padding: "10px 12px", marginBottom: 14,
          background: selected.length ? "#1a1608" : "#0f0f0f",
          border: `1px solid ${selected.length ? "#3a2f10" : "#1e1e1e"}`,
          borderRadius: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: selected.length ? 8 : 0 }}>
            <div style={{ flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 9, color: selected.length ? "#f5c842" : "#666", letterSpacing: "0.12em" }}>
              SELECTED ({selected.length})
            </div>
            {selected.length > 0 && (
              <button
                onClick={clearAll}
                style={{
                  background: "transparent", border: "none",
                  color: "#888", cursor: "pointer",
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  letterSpacing: "0.1em",
                }}
              >
                CLEAR ALL
              </button>
            )}
          </div>
          {selected.length === 0 ? (
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#666", fontStyle: "italic" }}>
              No tags yet — tap matches below, or commit empty to keep as free text.
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {selected.map(s => (
                <button
                  key={s.id}
                  onClick={() => removeTag(s.id)}
                  aria-label={`Remove ${s.canonical.name}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 8px 5px 8px",
                    background: "#0a0a0a", border: "1px solid #3a2f10",
                    borderRadius: 16, cursor: "pointer",
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#f5c842", letterSpacing: "0.04em",
                  }}
                >
                  <span style={{ fontSize: 13 }}>{s.canonical.emoji || "🥣"}</span>
                  <span>{s.canonical.name}</span>
                  <span style={{ color: "#888", marginLeft: 2, fontSize: 11 }}>✕</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search… (default: "${item.name}")`}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "10px 12px", marginBottom: 10,
            background: "#0f0f0f", border: "1px solid #2a2a2a",
            borderRadius: 10, color: "#f0ece4",
            fontFamily: "'DM Sans',sans-serif", fontSize: 14, outline: "none",
          }}
        />

        {/* Blend presets — composite tags applied in one tap. Appends the
            preset's component ids to the selection (deduped against
            anything already on deck). Shown above the fuzzy-match list
            when the item name / search query matches a preset label or
            any of its component names. */}
        {presetMatches.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7eb8d4", letterSpacing: "0.12em", marginBottom: 2 }}>
              BLENDS & COMPOSITES — TAP TO ADD ALL
            </div>
            {presetMatches.map(preset => {
              // Count how many of the preset's components are already on
              // deck. When all are present we dim the preset so the user
              // sees at a glance there's nothing new to add.
              const already = preset.ingredientIds.filter(id => selectedIds.has(id)).length;
              const allAlready = already === preset.ingredientIds.length;
              return (
                <button
                  key={preset.id}
                  onClick={() => addPreset(preset.ingredientIds)}
                  disabled={allAlready}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 12px",
                    background: allAlready ? "#0a0f14" : "#0f1620",
                    border: `1px solid ${allAlready ? "#162330" : "#1f3040"}`,
                    borderRadius: 10,
                    cursor: allAlready ? "default" : "pointer",
                    textAlign: "left", width: "100%",
                    opacity: allAlready ? 0.45 : 1,
                  }}
                >
                  <span style={{ fontSize: 22 }}>{preset.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {preset.label}
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7eb8d4", letterSpacing: "0.05em", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {preset.description}
                    </div>
                  </div>
                  <span style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.08em",
                    color: "#7eb8d4", background: "#1a2430",
                    border: "1px solid #2a3a4a",
                    padding: "2px 7px", borderRadius: 4,
                  }}>
                    {allAlready ? "ADDED" : `+${preset.ingredientIds.length - already}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {matches.length === 0 ? (
          <div style={{ padding: "24px 8px", textAlign: "center", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#666" }}>
            No matches. Try a different search term, or commit empty to keep as free text.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            {matches.map(({ ingredient, score }) => {
              const tone = confidenceTone(score);
              const already = selectedIds.has(ingredient.id);
              return (
                <button
                  key={ingredient.id}
                  onClick={() => (already ? removeTag(ingredient.id) : addTag(ingredient.id))}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 12px",
                    background: already ? "#1a1608" : "#161616",
                    border: `1px solid ${already ? "#f5c842" : `${tone.color}33`}`,
                    borderRadius: 10,
                    cursor: "pointer", textAlign: "left", width: "100%",
                  }}
                >
                  <span style={{ fontSize: 22 }}>{ingredient.emoji || "🥫"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: already ? "#f5c842" : "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ingredient.name}
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.08em", marginTop: 2 }}>
                      {(ingredient.category || "").toUpperCase()}
                      {ingredient.subcategory ? ` · ${ingredient.subcategory.toUpperCase()}` : ""}
                    </div>
                  </div>
                  <span style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.08em",
                    color: already ? "#f5c842" : tone.color,
                    background: already ? "#2a2110" : `${tone.color}18`,
                    border: `1px solid ${already ? "#3a2f10" : `${tone.color}44`}`,
                    padding: "2px 7px", borderRadius: 4,
                  }}>
                    {already ? "✓ ADDED" : tone.label.toUpperCase()}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Primary action bar. DONE is always available — empty selection
            is a valid commit (returns row to free-text). Cancel just
            closes the sheet without committing. */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "12px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              color: "#888", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={commit}
            style={{
              flex: 2, padding: "12px",
              background: "#f5c842", border: "none",
              color: "#111", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            {selected.length === 0
              ? "KEEP AS FREE TEXT"
              : `DONE · ${selected.length} TAG${selected.length === 1 ? "" : "S"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
