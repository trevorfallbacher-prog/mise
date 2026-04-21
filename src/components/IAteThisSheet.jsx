import { useEffect, useMemo, useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { findIngredient, unitLabel } from "../data/ingredients";
import { findRecipe } from "../data/recipes";
import { formatReheatSummary } from "../data/recipes/schema";
import { resolveNutrition, scaleFactor, formatMacros } from "../lib/nutrition";
import { useConsumptionLogs, inferMealSlot } from "../lib/useConsumptionLogs";
import { useBrandNutrition } from "../lib/useBrandNutrition";
import { useIngredientInfo } from "../lib/useIngredientInfo";
import { useUserRecipes } from "../lib/useUserRecipes";

/**
 * IAteThisSheet — "I just ate this" declaration flow.
 *
 * Opens from any pantry ItemCard (and later, leftover meal tiles in
 * Kitchen). User picks: how much, what meal slot, optional note. Sheet
 * shows a live macro preview computed through the standard resolver
 * chain so the number they'll see on the dashboard matches the number
 * on the sheet at confirm-time.
 *
 * On confirm: inserts a consumption_logs row stamped with scaled macros
 * and decrements the pantry row amount in place. Nutrition dashboard
 * picks it up via useNutritionTally's realtime subscription — no
 * imperative refresh needed.
 *
 * Props:
 *   pantryRow   — the pantry_items row being consumed. Must include
 *                 { id, ingredientId|canonicalId, amount, unit, brand? }.
 *                 When ingredientId is missing (orphan / free-text row)
 *                 the sheet still logs the event but nutrition is null.
 *   userId      — chef's id, for the consumption_logs.user_id column.
 *                 Pantry decrement goes through a direct pantry_items
 *                 UPDATE; useSyncedList's realtime subscription
 *                 reconciles the UI, so we don't need setPantry here.
 *   onClose()   — called on dismissal (any path). Parent owns open state.
 *   onDone(row) — optional success callback; fires after insert lands.
 */
const MEAL_SLOTS = [
  { id: "breakfast", label: "Breakfast", emoji: "🥞" },
  { id: "lunch",     label: "Lunch",     emoji: "🥪" },
  { id: "dinner",    label: "Dinner",    emoji: "🍽️" },
  { id: "snack",     label: "Snack",     emoji: "🍎" },
];

export default function IAteThisSheet({ pantryRow, userId, onClose, onDone }) {
  const ingredientInfo = useIngredientInfo();
  const brandNutrition = useBrandNutrition();
  const { logConsumption, loading } = useConsumptionLogs({
    userId,
    brandNutrition,
    getInfo: ingredientInfo?.getInfo,
  });

  const canonicalId = pantryRow?.ingredientId || pantryRow?.canonicalId || null;
  const canonical = canonicalId ? findIngredient(canonicalId) : null;
  const isMealRow = pantryRow?.kind === "meal";
  const sourceCookLogId = pantryRow?.sourceCookLogId || null;
  const sourceRecipeSlug = pantryRow?.sourceRecipeSlug || null;

  // Look up the source recipe for reheat instructions. Meal rows
  // carry sourceRecipeSlug from CookComplete, which resolves against
  // either bundled recipes or user_recipes. Null when the row is an
  // ingredient, the slug is missing, or the recipe has no reheat
  // block authored yet — all of which render as "no reheat tip".
  const { findBySlug: findUserRecipe } = useUserRecipes(userId);
  const sourceRecipe = (isMealRow && sourceRecipeSlug)
    ? findRecipe(sourceRecipeSlug, findUserRecipe)
    : null;
  const reheat = sourceRecipe?.reheat || null;

  // Meal-kind leftovers don't have a canonical; their nutrition lives
  // on cook_logs.nutrition (per-serving blob stamped at cook-time).
  // Fetch it once when the sheet opens so the preview updates in real
  // time as the user dials servings up and down.
  const [mealCookNutrition, setMealCookNutrition] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!isMealRow || !sourceCookLogId) { setMealCookNutrition(null); return; }
    (async () => {
      const { data, error } = await supabase
        .from("cook_logs")
        .select("nutrition")
        .eq("id", sourceCookLogId)
        .maybeSingle();
      if (!alive) return;
      if (error) {
        console.warn("[IAteThisSheet] cook_log fetch failed:", error.message);
        return;
      }
      setMealCookNutrition(data?.nutrition || null);
    })();
    return () => { alive = false; };
  }, [isMealRow, sourceCookLogId]);

  // Unit axis depends on what the row is:
  //   - Meal rows: always "serving" — the leftover row tracks portions,
  //     not grams. Enforced; picking anything else would fall through
  //     the hook's meal-kind nutrition path.
  //   - Ingredient rows: every unit in the canonical's ladder.
  //   - Orphan rows (no canonical, not a meal): fall back to the row's
  //     own unit so we can at least log the event for inventory history.
  const availableUnits = isMealRow
    ? [{ id: "serving", label: "serving" }]
    : (canonical?.units || [{ id: pantryRow?.unit || "unit", label: pantryRow?.unit || "unit" }]);

  // Default serving depends on the row type. Meal leftovers always
  // start at 1 serving. Count-based items (eggs, apples) default to 1
  // count; mass-based items default to the smallest convenient unit
  // in the ladder (tsp > tbsp > g > oz > cup). Falls back to the
  // pantry row's own unit when nothing else fits.
  const defaultUnit = useMemo(() => {
    if (isMealRow) return "serving";
    if (!canonical) return pantryRow?.unit || "unit";
    const ids = (canonical.units || []).map(u => u.id);
    if (ids.includes("count")) return "count";
    for (const pref of ["serving", "slice", "clove", "piece", "tbsp", "oz", "cup", "g"]) {
      if (ids.includes(pref)) return pref;
    }
    return ids[0] || pantryRow?.unit || "unit";
  }, [isMealRow, canonical, pantryRow?.unit]);

  const [amount,   setAmount]   = useState(1);
  const [unit,     setUnit]     = useState(defaultUnit);
  const [mealSlot, setMealSlot] = useState(() => inferMealSlot());
  const [note,     setNote]     = useState("");
  const [error,    setError]    = useState(null);

  // Live macro preview. Re-resolves on every amount/unit tick so the
  // number on the confirm button matches exactly what the tally will
  // receive. Null when we can't compute (no canonical / cook_log
  // nutrition, no nutrition, or unit not in the ladder) — in that
  // case we still let them log for inventory purposes but tell them
  // up front the macros are skipped.
  const preview = useMemo(() => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return { macros: null, source: null };
    // Meal-kind leftover: cook_logs.nutrition is already per-serving.
    // Scaling is just linear multiplication by the number of servings.
    if (isMealRow) {
      if (!mealCookNutrition) return { macros: null, source: "cook" };
      const macros = {};
      for (const k of ["kcal", "protein_g", "fat_g", "carb_g", "fiber_g", "sodium_mg", "sugar_g"]) {
        if (typeof mealCookNutrition[k] === "number") macros[k] = mealCookNutrition[k] * amt;
      }
      return { macros, source: "cook" };
    }
    if (!canonical) return null;
    const { nutrition, source, brand } = resolveNutrition(pantryRow, {
      brandNutrition,
      getInfo: ingredientInfo?.getInfo,
    });
    if (!nutrition) return { macros: null, source: null };
    const f = scaleFactor({ amount: amt, unit }, canonical, nutrition);
    if (f == null || !Number.isFinite(f)) return { macros: null, source };
    const macros = {};
    for (const k of ["kcal", "protein_g", "fat_g", "carb_g", "fiber_g", "sodium_mg", "sugar_g"]) {
      if (typeof nutrition[k] === "number") macros[k] = nutrition[k] * f;
    }
    return { macros, source, brand };
  }, [amount, unit, isMealRow, mealCookNutrition, canonical, pantryRow, brandNutrition, ingredientInfo]);

  const pantryAmountDisplay = (() => {
    if (isMealRow) {
      const s = Number(pantryRow?.servingsRemaining);
      if (!Number.isFinite(s)) return "—";
      return `${s % 1 ? s.toFixed(2) : s} serving${s === 1 ? "" : "s"}`;
    }
    const n = Number(pantryRow?.amount);
    if (!Number.isFinite(n)) return "—";
    return `${n % 1 ? n.toFixed(2) : n} ${unitLabel(canonical, pantryRow?.unit) || pantryRow?.unit}`;
  })();

  const confirm = async () => {
    setError(null);
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      setError("Amount must be positive.");
      return;
    }
    const result = await logConsumption({
      pantryRow,
      amount: Number(amount),
      unit,
      mealSlot,
      note,
    });
    if (!result.ok) {
      setError(result.error || "Couldn't log that — try again.");
      return;
    }
    onDone?.(result.consumption);
    onClose?.();
  };

  return (
    <ModalSheet onClose={onClose} zIndex={Z.picker} label="I ATE THIS">
      <div style={{ padding: "4px 22px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div style={{ fontSize: 44, flexShrink: 0 }}>{pantryRow?.emoji || canonical?.emoji || "🍽️"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 22, color: "#f0ece4", lineHeight: 1.15 }}>
              {pantryRow?.name || canonical?.name || "Ingredient"}
            </div>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", marginTop: 4, letterSpacing: "0.08em" }}>
              IN PANTRY: {pantryAmountDisplay}
            </div>
          </div>
        </div>

        {/* Reheat guidance — leftover-only, shown when the source
            recipe authored a reheat block. Pantry-shelf ingredients
            don't have reheat info; this surface is strictly for the
            "kitchen → grab leftovers" flow. Primary method is the
            headline; alternatives collapse below; quality/safety
            note renders in amber so it reads as a caveat. */}
        {isMealRow && reheat && (
          <div style={{
            padding: "12px 14px",
            background: "#1a1608",
            border: "1px solid #3a2f10",
            borderRadius: 10,
            marginBottom: 14,
          }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 6 }}>
              ♨ REHEAT
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#f0ece4", marginBottom: 4 }}>
              {formatReheatSummary(reheat)}
            </div>
            {reheat.primary?.tips && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb", lineHeight: 1.45 }}>
                {reheat.primary.tips}
              </div>
            )}
            {Array.isArray(reheat.alt) && reheat.alt.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #3a2f10" }}>
                {reheat.alt.map((a, i) => (
                  <div key={i} style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#a99870", marginBottom: i === reheat.alt.length - 1 ? 0 : 4, lineHeight: 1.5 }}>
                    OR · {formatReheatSummary({ primary: a })}
                    {a.tips ? <div style={{ color: "#666", marginTop: 2 }}>{a.tips}</div> : null}
                  </div>
                ))}
              </div>
            )}
            {reheat.note && (
              <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#e0a868", fontStyle: "italic", lineHeight: 1.45 }}>
                ⚠ {reheat.note}
              </div>
            )}
          </div>
        )}

        {/* Amount stepper */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 8 }}>
            HOW MUCH DID YOU EAT
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <button
              type="button"
              onClick={() => setAmount(a => Math.max(0.25, Number((Number(a) - 0.25).toFixed(2))))}
              style={stepperBtnStyle}
            >−</button>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              value={amount}
              onChange={e => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
              style={{
                flex: 1, minWidth: 0, padding: "12px 14px",
                background: "#141414", border: "1px solid #2a2a2a", borderRadius: 10,
                fontFamily: "'DM Mono',monospace", fontSize: 16, color: "#f0ece4",
                outline: "none", textAlign: "center",
              }}
            />
            <button
              type="button"
              onClick={() => setAmount(a => Number((Number(a || 0) + 0.25).toFixed(2)))}
              style={stepperBtnStyle}
            >+</button>
          </div>
          {/* Unit chooser */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {availableUnits.map(u => {
              const active = u.id === unit;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setUnit(u.id)}
                  style={{
                    padding: "6px 12px",
                    background: active ? "#f5c842" : "#1a1a1a",
                    border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                    color: active ? "#111" : "#bbb",
                    borderRadius: 8,
                    fontFamily: "'DM Mono',monospace", fontSize: 11,
                    fontWeight: active ? 700 : 400,
                    cursor: "pointer", letterSpacing: "0.06em",
                  }}
                >
                  {u.label || u.id}
                </button>
              );
            })}
          </div>
        </div>

        {/* Meal slot */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 8 }}>
            MEAL
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {MEAL_SLOTS.map(s => {
              const active = s.id === mealSlot;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setMealSlot(s.id)}
                  style={{
                    flex: 1, padding: "10px 0",
                    background: active ? "#f5c842" : "#141414",
                    border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                    color: active ? "#111" : "#bbb",
                    borderRadius: 10,
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    fontWeight: active ? 700 : 400,
                    cursor: "pointer", letterSpacing: "0.06em",
                  }}
                >
                  <div style={{ fontSize: 16, marginBottom: 2 }}>{s.emoji}</div>
                  {s.label.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Macro preview */}
        <div style={{
          padding: "12px 14px",
          background: preview?.macros ? "#0f1a0f" : "#141414",
          border: `1px solid ${preview?.macros ? "#1e3a1e" : "#2a2a2a"}`,
          borderRadius: 10,
          marginBottom: 14,
        }}>
          {preview?.macros ? (
            <>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#f0ece4" }}>
                ~ {formatMacros(preview.macros, { verbose: true })}
              </div>
              <div style={{ marginTop: 4, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.08em" }}>
                {preview.source === "brand" && preview.brand
                  ? `FROM BRAND · ${String(preview.brand).toUpperCase()}`
                  : `FROM ${String(preview.source || "").toUpperCase()}`}
              </div>
            </>
          ) : (
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#888", lineHeight: 1.5 }}>
              No nutrition on file yet — this event will still log for inventory, but won't contribute to today's macro tally. You can add nutrition on the item card.
            </div>
          )}
        </div>

        {/* Optional note */}
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Note (optional)…"
          rows={2}
          style={{
            width: "100%", padding: "10px 12px", marginBottom: 12,
            background: "#141414", border: "1px solid #2a2a2a", borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4",
            outline: "none", resize: "none", boxSizing: "border-box",
          }}
        />

        {error && (
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "#1a0f0f", border: "1px solid #3a1a1a", borderRadius: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#f87171" }}>
            {error}
          </div>
        )}

        <button
          onClick={confirm}
          disabled={loading || !(Number(amount) > 0)}
          style={{
            width: "100%", padding: "14px",
            background: loading || !(Number(amount) > 0) ? "#1a1a1a" : "#f5c842",
            border: "none", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
            color: loading || !(Number(amount) > 0) ? "#444" : "#111",
            cursor: loading || !(Number(amount) > 0) ? "not-allowed" : "pointer",
            letterSpacing: "0.08em",
          }}
        >
          {loading ? "LOGGING…" : "LOG IT"}
        </button>
      </div>
    </ModalSheet>
  );
}

const stepperBtnStyle = {
  width: 44, padding: "0 14px",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  borderRadius: 10,
  fontFamily: "'DM Mono',monospace", fontSize: 18, fontWeight: 600,
  color: "#f5c842", cursor: "pointer",
};
