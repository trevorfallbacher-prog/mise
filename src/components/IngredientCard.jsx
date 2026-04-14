import { useMemo } from "react";
import { findIngredient, getIngredientInfo, unitLabel } from "../data/ingredients";
import { RECIPES } from "../data/recipes";

/**
 * IngredientCard — tap an ingredient in Cook Mode to see:
 *   • current pantry stock (if any)
 *   • description + flavor profile
 *   • wine pairings
 *   • other recipes in the library that use this ingredient
 *
 * Props:
 *   ingredientId   — canonical id (e.g. "butter")
 *   fallbackName   — what to show if the id isn't in the registry
 *   fallbackEmoji  — idem
 *   pantry         — current pantry (array of {id,ingredientId,amount,unit,...})
 *   currentRecipeSlug — recipe the user is looking at now, so we exclude it
 *                       from the "also in" list
 *   onPickRecipe(recipe) — optional; called when a linked recipe is tapped
 *   onClose()      — dismiss
 */
export default function IngredientCard({
  ingredientId, fallbackName, fallbackEmoji,
  pantry = [], currentRecipeSlug, onPickRecipe, onClose,
}) {
  const canonical = useMemo(() => findIngredient(ingredientId), [ingredientId]);
  const info      = useMemo(() => getIngredientInfo(canonical), [canonical]);

  // Aggregate pantry rows for this ingredient (family members may each have
  // their own row). We display the sum in the canonical default unit when we
  // can — otherwise fall back to whichever unit the user has.
  const pantryRows = useMemo(
    () => ingredientId ? pantry.filter(p => p.ingredientId === ingredientId) : [],
    [pantry, ingredientId]
  );
  const totalAmount = pantryRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const displayUnit = pantryRows[0]?.unit;
  const unitText    = canonical ? unitLabel(canonical, displayUnit) : (displayUnit || "");

  // Other recipes in the library that reference this ingredient. We exclude
  // the recipe the user came from so the list is useful.
  const otherRecipes = useMemo(() => {
    if (!ingredientId) return [];
    return RECIPES.filter(r =>
      r.slug !== currentRecipeSlug &&
      (r.ingredients || []).some(i => i.ingredientId === ingredientId)
    );
  }, [ingredientId, currentRecipeSlug]);

  const name  = canonical?.name  || fallbackName  || "Ingredient";
  const emoji = canonical?.emoji || fallbackEmoji || "🥫";

  // Coarse stock label. We don't try to be precise — threshold data lives on
  // a per-row basis and this is a summary card, not the pantry.
  const stockLabel =
    pantryRows.length === 0 ? "Not in pantry"
    : totalAmount <= 0       ? "Out of stock"
    :                          `${Math.round(totalAmount * 10) / 10} ${unitText}`;
  const stockColor =
    pantryRows.length === 0 ? "#888"
    : totalAmount <= 0       ? "#f87171"
    :                          "#a3d977";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 320,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "20px 22px 36px",
        maxHeight: "88vh", overflowY: "auto",
      }}>
        <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 16px" }} />

        {/* Header: emoji + name + category */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 44 }}>{emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
              {(canonical?.category || "INGREDIENT").toUpperCase()}
            </div>
            <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 26, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </h2>
          </div>
        </div>

        {/* Pantry stock */}
        <div style={{
          padding: "12px 14px", background: "#0f0f0f",
          border: "1px solid #1e1e1e", borderRadius: 12,
          display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
        }}>
          <span style={{ fontSize: 20 }}>🥫</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.1em" }}>
              IN YOUR PANTRY
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: stockColor, marginTop: 2 }}>
              {stockLabel}
            </div>
          </div>
          {pantryRows.length > 1 && (
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#888", letterSpacing: "0.08em" }}>
              {pantryRows.length} ROWS
            </span>
          )}
        </div>

        {/* Description */}
        {info?.description && (
          <p style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 14, lineHeight: 1.55,
            color: "#ccc", margin: "0 0 14px",
          }}>
            {info.description}
          </p>
        )}

        {/* Flavor profile */}
        {info?.flavorProfile && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>
              FLAVOR PROFILE
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#bbb", fontStyle: "italic", lineHeight: 1.5 }}>
              {info.flavorProfile}
            </div>
          </div>
        )}

        {/* Wine pairings */}
        {info?.winePairings?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              GOES WITH
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {info.winePairings.map(w => (
                <span key={w} style={{
                  padding: "4px 10px", background: "#1a1408",
                  border: "1px solid #3a2a15", borderRadius: 14,
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#d9b877",
                }}>
                  🍷 {w}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Other library recipes that use this ingredient */}
        {otherRecipes.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              ALSO IN
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {otherRecipes.map(r => (
                <button
                  key={r.slug}
                  onClick={() => onPickRecipe?.(r)}
                  disabled={!onPickRecipe}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px", background: "#161616",
                    border: "1px solid #2a2a2a", borderRadius: 10,
                    cursor: onPickRecipe ? "pointer" : "default",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 22 }}>{r.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Fraunces',serif", fontSize: 14, color: "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.title}
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.08em", marginTop: 2 }}>
                      {(r.cuisine || "").toUpperCase()} · {(r.category || "").toUpperCase()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Suggested ideas from the info dictionary (subcategory fallback). */}
        {info?.recipes?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              GOOD FOR
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
              {info.recipes.slice(0, 5).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "14px", marginTop: 6,
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
