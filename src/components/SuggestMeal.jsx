import { useMemo } from "react";
import { suggestMeals, totalTimeMin, difficultyLabel } from "../data/recipes";
import { findIngredient } from "../data/ingredients";

/**
 * SuggestMeal — bottom sheet that ranks recipes against the current pantry.
 *
 * Props:
 *   pantry         — current pantry rows (array)
 *   onPick(recipe) — user picked a suggestion
 *   onClose()      — dismiss
 */
export default function SuggestMeal({ pantry = [], onPick, onClose }) {
  const suggestions = useMemo(() => suggestMeals(pantry, { limit: 5 }), [pantry]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 310,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "20px 22px 36px",
        maxHeight: "88vh", overflowY: "auto",
      }}>
        <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 16px" }} />

        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
          WITH WHAT YOU HAVE
        </div>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 26, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", margin: "4px 0 16px" }}>
          You could make…
        </h2>

        {suggestions.length === 0 && (
          <div style={{
            padding: "20px 16px", background: "#0f0f0f",
            border: "1px solid #1e1e1e", borderRadius: 12,
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.5,
          }}>
            Your pantry is empty, so there's not much to suggest yet. Add a few ingredients and try again — or head over to <b style={{ color: "#f0ece4" }}>Cook</b> and pick something to build a shopping list from.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {suggestions.map(({ recipe, coverage, haveCount, needCount, missing }) => {
            const pct = Math.round(coverage * 100);
            const barColor =
              coverage >= 0.9 ? "#4ade80"
              : coverage >= 0.6 ? "#f5c842"
              : "#f59e0b";
            return (
              <button
                key={recipe.slug}
                onClick={() => onPick(recipe)}
                style={{
                  textAlign: "left", padding: "14px 16px",
                  background: "#161616", border: "1px solid #2a2a2a",
                  borderRadius: 14, cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ fontSize: 30, flexShrink: 0 }}>{recipe.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontFamily: "'Fraunces',serif", fontSize: 16, color: "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {recipe.title}
                      </span>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: barColor, flexShrink: 0, letterSpacing: "0.06em", fontWeight: 600 }}>
                        {pct}%
                      </span>
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.08em", marginTop: 3 }}>
                      {(recipe.cuisine || "").toUpperCase()} · {totalTimeMin(recipe)} MIN · {difficultyLabel(recipe.difficulty).toUpperCase()}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, height: 4, background: "#0f0f0f", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: barColor, transition: "width 0.3s" }} />
                </div>
                <div style={{ marginTop: 6, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#888" }}>
                  You have <b style={{ color: "#f0ece4" }}>{haveCount}</b> of <b style={{ color: "#f0ece4" }}>{needCount}</b> tracked ingredients
                </div>
                {missing.length > 0 && missing.length <= 4 && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {missing.map((m, i) => {
                      const canonical = findIngredient(m.ingredientId);
                      return (
                        <span key={i} style={{
                          padding: "3px 8px", background: "#1a0f0f",
                          border: "1px solid #3a2a2a", borderRadius: 12,
                          fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#d77777",
                        }}>
                          + {canonical?.name || m.item}
                        </span>
                      );
                    })}
                  </div>
                )}
                {missing.length > 4 && (
                  <div style={{ marginTop: 6, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#888" }}>
                    Need {missing.length} more ingredients.
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "14px", marginTop: 16,
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            color: "#888", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12,
            letterSpacing: "0.08em", cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}
