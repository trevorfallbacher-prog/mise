import { useMemo, useState } from "react";
import { fuzzyMatchIngredient } from "../data/ingredients";

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
 * LinkIngredient — bottom-sheet picker that resolves a free-text pantry row
 * to a canonical ingredient id. Runs fuzzyMatchIngredient against either the
 * row's original name or the user's live search query, shows the top
 * candidates as tap-to-pick rows, and always keeps "KEEP AS FREE TEXT" as
 * an escape hatch.
 *
 * Props:
 *   item       — the pantry row being relinked ({ name, emoji, … })
 *   onLink(id) — called when the user taps a canonical candidate
 *   onClose()  — dismiss without linking
 */
export default function LinkIngredient({ item, onLink, onClose }) {
  const [search, setSearch] = useState("");
  const needle = search.trim() || item.name;
  const matches = useMemo(() => fuzzyMatchIngredient(needle, 8), [needle]);

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
          Free-text rows don't match recipes or get auto-expiration. Tap the best match below — the row stays, it just gets connected.
        </p>

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

        {matches.length === 0 ? (
          <div style={{ padding: "24px 8px", textAlign: "center", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#666" }}>
            No matches. Try a different search term, or keep this as free text.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            {matches.map(({ ingredient, score }) => {
              const tone = confidenceTone(score);
              return (
                <button
                  key={ingredient.id}
                  onClick={() => onLink(ingredient.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 12px", background: "#161616",
                    border: `1px solid ${tone.color}33`, borderRadius: 10,
                    cursor: "pointer", textAlign: "left", width: "100%",
                  }}
                >
                  <span style={{ fontSize: 22 }}>{ingredient.emoji || "🥫"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ingredient.name}
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.08em", marginTop: 2 }}>
                      {(ingredient.category || "").toUpperCase()}
                      {ingredient.subcategory ? ` · ${ingredient.subcategory.toUpperCase()}` : ""}
                    </div>
                  </div>
                  <span style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.08em",
                    color: tone.color, background: `${tone.color}18`,
                    border: `1px solid ${tone.color}44`,
                    padding: "2px 7px", borderRadius: 4,
                  }}>
                    {tone.label.toUpperCase()}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "12px",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            color: "#888", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12,
            letterSpacing: "0.08em", cursor: "pointer",
          }}
        >
          KEEP AS FREE TEXT
        </button>
      </div>
    </div>
  );
}
