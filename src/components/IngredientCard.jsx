import { useEffect, useMemo, useState } from "react";
import { findIngredient, getIngredientInfo, unitLabel } from "../data/ingredients";
import { RECIPES } from "../data/recipes";

// Month labels for seasonality. 1-indexed to match peakMonths convention
// in the ingredient schema.
const MONTHS = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Turn [5,6,7,8] into "May – Aug". Handles year-wrap (e.g. [11,12,1,2]
// → "Nov – Feb") for winter produce. Falls back to a comma list when
// the set isn't a single contiguous range.
function formatPeakMonths(months) {
  if (!Array.isArray(months) || months.length === 0) return "";
  const sorted = [...months].sort((a, b) => a - b);
  // Detect simple contiguous range first.
  const contiguous = sorted.every((m, i) => i === 0 || m === sorted[i - 1] + 1);
  if (contiguous) return `${MONTHS[sorted[0]]} – ${MONTHS[sorted[sorted.length - 1]]}`;
  // Year-wrap (e.g. [1,2,11,12] → Nov–Feb).
  const gaps = sorted.slice(1).map((m, i) => m - sorted[i]);
  const splitAt = gaps.findIndex(g => g > 1);
  if (splitAt >= 0) {
    const tail = sorted.slice(splitAt + 1);
    const head = sorted.slice(0, splitAt + 1);
    const wraps = tail.concat(head);
    const wrapsContiguous = wraps.every((m, i) => {
      if (i === 0) return true;
      const prev = wraps[i - 1];
      return m === prev + 1 || (prev === 12 && m === 1);
    });
    if (wrapsContiguous) return `${MONTHS[wraps[0]]} – ${MONTHS[wraps[wraps.length - 1]]}`;
  }
  return sorted.map(m => MONTHS[m]).join(", ");
}

// Shelf-life as a human string. "3 days" / "2 weeks" / "4 months".
function formatShelfLife(days) {
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return null;
  if (days < 14)        return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 90)        return `${Math.round(days / 7)} weeks`;
  if (days < 365)       return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} year${days < 730 ? "" : "s"}`;
}

const LOCATION_META = {
  fridge:  { emoji: "🧊", label: "Fridge"  },
  pantry:  { emoji: "🥫", label: "Pantry"  },
  freezer: { emoji: "❄️", label: "Freezer" },
};

/**
 * IngredientCard — tap an ingredient in Cook Mode (or the Pantry list) to
 * see a full dossier: pantry stock, description, storage, substitutions,
 * nutrition, origin, pairings, and cross-recipe references.
 *
 * Renders every info section conditionally so sparse-metadata ingredients
 * still look clean. As the INGREDIENT_INFO catalog fills in (buildout
 * plan — recipe-referenced ingredients first), the card fills with them
 * automatically — no per-ingredient UI code.
 *
 * Props:
 *   ingredientId   — canonical id (e.g. "butter")
 *   fallbackName   — what to show if the id isn't in the registry
 *   fallbackEmoji  — idem
 *   pantry         — current pantry (array of {id,ingredientId,amount,unit,...})
 *   currentRecipeSlug — recipe the user is looking at now, excluded from "also in"
 *   onPickRecipe(recipe) — optional; called when a linked recipe is tapped
 *   onClose()      — dismiss
 */
export default function IngredientCard({
  ingredientId, fallbackName, fallbackEmoji,
  pantry = [], currentRecipeSlug, onPickRecipe, onClose,
}) {
  // Internal id we actually display. Seeded from prop; substitution pill
  // taps flip it without closing the card, so "butter → clarified butter
  // → ghee" chained learning feels natural.
  const [viewingId, setViewingId] = useState(ingredientId);
  useEffect(() => { setViewingId(ingredientId); }, [ingredientId]);

  const canonical = useMemo(() => findIngredient(viewingId), [viewingId]);
  const info      = useMemo(() => getIngredientInfo(canonical), [canonical]);

  // Aggregate pantry rows for THIS ingredient (family members may each
  // have their own row). Summed in whichever unit the first row has.
  const pantryRows = useMemo(
    () => viewingId ? pantry.filter(p => p.ingredientId === viewingId) : [],
    [pantry, viewingId]
  );
  const totalAmount = pantryRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const displayUnit = pantryRows[0]?.unit;
  const unitText    = canonical ? unitLabel(canonical, displayUnit) : (displayUnit || "");

  // Other library recipes using this ingredient, excluding the current one.
  const otherRecipes = useMemo(() => {
    if (!viewingId) return [];
    return RECIPES.filter(r =>
      r.slug !== currentRecipeSlug &&
      (r.ingredients || []).some(i => i.ingredientId === viewingId)
    );
  }, [viewingId, currentRecipeSlug]);

  const name  = canonical?.name  || fallbackName  || "Ingredient";
  const emoji = canonical?.emoji || fallbackEmoji || "🥫";

  const stockLabel =
    pantryRows.length === 0 ? "Not in pantry"
    : totalAmount <= 0       ? "Out of stock"
    :                          `${Math.round(totalAmount * 10) / 10} ${unitText}`;
  const stockColor =
    pantryRows.length === 0 ? "#888"
    : totalAmount <= 0       ? "#f87171"
    :                          "#a3d977";

  // Resolve substitution names from the registry. Stale ids (ingredient
  // was renamed or removed) fall back to "(removed)" so the card never
  // dead-ends.
  const substitutions = useMemo(() => {
    return (info?.substitutions || []).map(s => {
      const sub = findIngredient(s.id);
      return {
        id: s.id,
        name: sub?.name || s.id,
        emoji: sub?.emoji || "🥫",
        note: s.note || "",
        resolved: !!sub,
      };
    });
  }, [info]);

  // Pairs — same pattern, resolve ids to names.
  const pairs = useMemo(() => {
    return (info?.pairs || []).map(id => {
      const p = findIngredient(id);
      return { id, name: p?.name || id, emoji: p?.emoji || "🥫", resolved: !!p };
    });
  }, [info]);

  const shelfLife = info?.storage?.shelfLifeDays ? formatShelfLife(info.storage.shelfLifeDays) : null;
  const peakLabel = info?.seasonality?.peakMonths ? formatPeakMonths(info.seasonality.peakMonths) : "";
  const locMeta   = info?.storage?.location ? LOCATION_META[info.storage.location] : null;

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

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 44 }}>{emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
              {(canonical?.category || "INGREDIENT").toUpperCase()}
              {canonical?.subcategory ? ` · ${canonical.subcategory.toUpperCase()}` : ""}
            </div>
            <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 26, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </h2>
            {info?.origin && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", marginTop: 3 }}>
                📍 {info.origin}
              </div>
            )}
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

        {/* Cultural notes — separate section so the origin chip up top
            stays compact and we can let the story breathe. */}
        {info?.culturalNotes && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "#161208", border: "1px solid #2a2015", borderRadius: 10 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 6 }}>
              THE STORY
            </div>
            <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 13, color: "#d9c8a0", lineHeight: 1.55 }}>
              {info.culturalNotes}
            </div>
          </div>
        )}

        {/* Storage — one compact row: location chip + shelf life + tips */}
        {info?.storage && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              STORAGE
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: info.storage.tips ? 6 : 0 }}>
              {locMeta && (
                <span style={{ padding: "4px 10px", background: "#0f1a0f", border: "1px solid #1e3a1e", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#a3d977" }}>
                  {locMeta.emoji} {locMeta.label}
                </span>
              )}
              {shelfLife && (
                <span style={{ padding: "4px 10px", background: "#0f0f0f", border: "1px solid #2a2a2a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb" }}>
                  Keeps ~{shelfLife}
                </span>
              )}
            </div>
            {info.storage.tips && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", fontStyle: "italic", lineHeight: 1.5 }}>
                {info.storage.tips}
              </div>
            )}
          </div>
        )}

        {/* Prep tips */}
        {info?.prepTips && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>
              PREP TIP
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#ccc", lineHeight: 1.5 }}>
              {info.prepTips}
            </div>
          </div>
        )}

        {/* Nutrition — compact 4-tile readout */}
        {info?.nutrition && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em" }}>
                NUTRITION
              </div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.08em" }}>
                PER {(info.nutrition.per || "100G").toUpperCase()}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {[
                { label: "kcal",    value: info.nutrition.kcal },
                { label: "protein", value: info.nutrition.protein_g, unit: "g" },
                { label: "fat",     value: info.nutrition.fat_g,     unit: "g" },
                { label: "carbs",   value: info.nutrition.carb_g,    unit: "g" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10, padding: "8px 4px", textAlign: "center" }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: "#f0ece4", fontWeight: 500 }}>
                    {s.value != null ? s.value : "—"}{s.unit && s.value != null ? s.unit : ""}
                  </div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, color: "#666", letterSpacing: "0.08em", marginTop: 2 }}>
                    {s.label.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
            {(info.nutrition.fiber_g != null || info.nutrition.sodium_mg != null) && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", marginTop: 6, letterSpacing: "0.06em" }}>
                {info.nutrition.fiber_g  != null && `Fiber ${info.nutrition.fiber_g}g`}
                {info.nutrition.fiber_g  != null && info.nutrition.sodium_mg != null && "  ·  "}
                {info.nutrition.sodium_mg != null && `Sodium ${info.nutrition.sodium_mg}mg`}
              </div>
            )}
          </div>
        )}

        {/* Substitutions — tappable pills swap the displayed ingredient. */}
        {substitutions.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              SUBSTITUTIONS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {substitutions.map(s => (
                <button
                  key={s.id}
                  onClick={s.resolved ? () => setViewingId(s.id) : undefined}
                  disabled={!s.resolved}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px", background: "#161616",
                    border: "1px solid #2a2a2a", borderRadius: 10,
                    cursor: s.resolved ? "pointer" : "default",
                    textAlign: "left", width: "100%",
                  }}
                >
                  <span style={{ fontSize: 20 }}>{s.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
                      {s.name}
                    </div>
                    {s.note && (
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#888", marginTop: 1, fontStyle: "italic" }}>
                        {s.note}
                      </div>
                    )}
                  </div>
                  {s.resolved && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#f5c842" }}>→</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pairs with */}
        {pairs.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              PAIRS WITH
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {pairs.map(p => (
                <button
                  key={p.id}
                  onClick={p.resolved ? () => setViewingId(p.id) : undefined}
                  disabled={!p.resolved}
                  style={{
                    padding: "4px 10px", background: "#0f0f0f",
                    border: "1px solid #2a2a2a", borderRadius: 14,
                    fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb",
                    cursor: p.resolved ? "pointer" : "default",
                  }}
                >
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Allergens + seasonality + sourcing — grouped as a single info
            strip at the bottom of the meta section. Each chip rendered
            only when its field is populated. */}
        {(info?.allergens?.length > 0 || peakLabel || info?.sourcing) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              GOOD TO KNOW
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: info.sourcing ? 6 : 0 }}>
              {info.allergens?.length > 0 && (
                <span style={{ padding: "4px 10px", background: "#1a0f0f", border: "1px solid #3a1a1a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#d98a8a" }}>
                  ⚠ Contains {info.allergens.join(", ")}
                </span>
              )}
              {peakLabel && (
                <span style={{ padding: "4px 10px", background: "#0f1a14", border: "1px solid #1e3a2a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#a3d9b4" }}>
                  🗓 Peak {peakLabel}
                </span>
              )}
            </div>
            {info.sourcing && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", fontStyle: "italic", lineHeight: 1.5 }}>
                💡 {info.sourcing}
              </div>
            )}
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
