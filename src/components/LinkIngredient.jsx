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
 * UX shape (star-first rewrite, mirroring TypePicker):
 *
 *   1. SELECTED accumulator at the top — every tag currently on deck.
 *      Tap a ✕ on any chip to remove. CLEAR ALL drops everything.
 *   2. ⭐ STAR — the single highest-scoring canonical for the needle.
 *      Rendered bigger so it reads as the default one-tap add.
 *   3. TOP 3 LIKELY — the next three fuzzy matches, sorted strictly
 *      high-to-low by score. No more random ordering; no more
 *      "EXACT below WEAK" confusion. Each still carries its
 *      Exact/Likely/Maybe/Weak confidence chip.
 *   4. BLEND PRESETS — composite tags applied in one tap (Italian
 *      Blend → mozzarella + provolone). Unchanged from before.
 *   5. SEARCH bar + on-demand results. The full canonical catalog
 *      stays behind the search — no whole-registry dump.
 *
 * Multi-select accumulator flow (6a, unchanged):
 *   Tapping a match or preset APPENDS to the selection instead of
 *   committing + closing. DONE commits the full array via onLink().
 *
 * Initial selection: pre-populates from item.ingredientIds /
 * item.ingredientId so re-opening the sheet on an already-tagged
 * item shows the current tags.
 *
 * Props:
 *   item           — the pantry row being linked ({ name, emoji, ingredientIds, … })
 *   onLink(ids)    — called with an ARRAY of canonical ids when the user
 *                    taps DONE. Always an array; pass [] to clear tagging.
 *   onClose()      — dismiss without committing.
 */
export default function LinkIngredient({ item, onLink, onClose }) {
  const [search, setSearch] = useState("");
  const needle = search.trim() || item.name;

  // fuzzyMatchIngredient returns matches sorted descending by score.
  // We slice to 4 = 1 star + 3 likely. Search mode pulls more.
  const topMatches = useMemo(() => fuzzyMatchIngredient(needle, 4), [needle]);
  const searchNeedle = search.trim();
  const searchMatches = useMemo(() => {
    if (!searchNeedle) return [];
    // Up to 20 for search mode — catalog-on-demand, capped so the
    // sheet doesn't explode on generic terms like "cheese".
    return fuzzyMatchIngredient(searchNeedle, 20);
  }, [searchNeedle]);

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

  const toggleTag = (id) => {
    const canonical = findIngredient(id);
    if (!canonical) return;
    setSelected(prev =>
      prev.some(s => s.id === id)
        ? prev.filter(s => s.id !== id)
        : [...prev, { id, canonical }]
    );
  };
  // Append a preset's component ids in order, skipping any already on deck.
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
  // label or any of its component names.
  const presetMatches = useMemo(() => {
    const n = (needle || "").toLowerCase();
    if (!n) return [];
    return BLEND_PRESETS.filter(preset => {
      const resolved = preset.ingredientIds.every(id => !!findIngredient(id));
      if (!resolved) return false;
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

  // Split into star + likely. Star is the highest-scoring match;
  // the next 3 are "likely." Both come from the SAME sort so we can
  // guarantee top-down descending order.
  const star = topMatches[0] || null;
  const likely = topMatches.slice(1, 4);

  // Shared row renderer for star / likely / search rows. `variant`
  // controls size + border treatment.
  const renderMatchRow = (match, variant) => {
    const { ingredient, score } = match;
    const tone = confidenceTone(score);
    const already = selectedIds.has(ingredient.id);
    const isStar = variant === "star";
    return (
      <button
        key={`${variant}-${ingredient.id}`}
        onClick={() => toggleTag(ingredient.id)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: isStar ? "14px 14px" : "10px 12px",
          background: already
            ? "#1a1608"
            : isStar ? "#1e1a0e" : "#161616",
          border: `1px solid ${
            already ? "#f5c842"
            : isStar ? "#f5c842"
            : `${tone.color}33`
          }`,
          borderRadius: 10,
          cursor: "pointer", textAlign: "left", width: "100%",
        }}
      >
        <span style={{ fontSize: isStar ? 26 : 22, flexShrink: 0 }}>
          {isStar ? "⭐" : (ingredient.emoji || "🥫")}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'DM Sans',sans-serif",
            fontSize: isStar ? 15 : 14,
            color: already ? "#f5c842" : "#f0ece4",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {isStar && (
              <span style={{ fontSize: 18 }}>{ingredient.emoji || "🥫"}</span>
            )}
            <span>{ingredient.name}</span>
          </div>
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            color: isStar ? "#f5c842" : "#555",
            letterSpacing: "0.08em", marginTop: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {isStar
              ? "⭐ BEST MATCH · TAP TO ADD"
              : <>
                  {(ingredient.category || "").toUpperCase()}
                  {ingredient.subcategory ? ` · ${ingredient.subcategory.toUpperCase()}` : ""}
                </>}
          </div>
        </div>
        <span style={{
          fontFamily: "'DM Mono',monospace", fontSize: 9,
          letterSpacing: "0.08em",
          color: already ? "#f5c842" : tone.color,
          background: already ? "#2a2110" : `${tone.color}18`,
          border: `1px solid ${already ? "#3a2f10" : `${tone.color}44`}`,
          padding: "2px 7px", borderRadius: 4, flexShrink: 0,
        }}>
          {already ? "✓ ADDED" : tone.label.toUpperCase()}
        </span>
      </button>
    );
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
          Tap to add ingredients to this row. Multi-tag for composed
          items — burritos, pizzas, shredded blends.
        </p>

        {/* SELECTED — the accumulator. Shown at the very top so the
            user always sees what's on deck before committing. */}
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
              No tags yet — tap ⭐ below, or commit empty to keep as free text.
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

        {/* ⭐ STAR — the top-scoring canonical for the needle. */}
        {star && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {renderMatchRow(star, "star")}
          </div>
        )}

        {/* LIKELY — next 3 matches, strictly descending by score. */}
        {likely.length > 0 && (
          <>
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 9,
              color: "#888", letterSpacing: "0.12em",
              margin: "4px 0 6px",
            }}>
              OR PICK FROM THESE
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {likely.map(m => renderMatchRow(m, "likely"))}
            </div>
          </>
        )}

        {/* BLEND PRESETS — composite tags applied in one tap. */}
        {presetMatches.length > 0 && (
          <>
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 9,
              color: "#7eb8d4", letterSpacing: "0.12em",
              margin: "4px 0 6px",
            }}>
              OR A BLEND · TAP TO ADD ALL
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {presetMatches.map(preset => {
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
          </>
        )}

        {/* SEARCH — catalog on demand. Star/likely keep their top-of-
            fuzzy rank; search lets the user widen when none of those
            are right. */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={star
            ? "Not one of these? Search the registry…"
            : "Search ingredients…"}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "10px 12px", marginBottom: 10,
            background: "#0f0f0f", border: "1px solid #2a2a2a",
            borderRadius: 10, color: "#f0ece4",
            fontFamily: "'DM Sans',sans-serif", fontSize: 14, outline: "none",
          }}
        />

        {/* Search results — only when the user typed something AND
            what they typed reached past the top 4 already shown. The
            guard (slicing from index 4) skips star + 3 likely so
            we don't duplicate rows in the list. */}
        {searchNeedle && (() => {
          const shownIds = new Set([
            ...(star ? [star.ingredient.id] : []),
            ...likely.map(m => m.ingredient.id),
          ]);
          const extras = searchMatches.filter(m => !shownIds.has(m.ingredient.id));
          if (extras.length === 0 && searchMatches.length > 0) {
            // Everything matching is already shown as star/likely —
            // gently tell the user rather than render an empty block.
            return (
              <div style={{
                padding: "12px 8px", textAlign: "center",
                fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                color: "#666", fontStyle: "italic", marginBottom: 10,
              }}>
                All close matches are already shown above.
              </div>
            );
          }
          if (extras.length === 0) {
            return (
              <div style={{
                padding: "16px 8px", textAlign: "center",
                fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                color: "#666", marginBottom: 10,
              }}>
                No matches for "{searchNeedle}". Commit empty to keep as free text.
              </div>
            );
          }
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {extras.map(m => renderMatchRow(m, "search"))}
            </div>
          );
        })()}

        {/* Primary action bar. DONE is always available — empty selection
            is a valid commit (returns row to free-text). */}
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
