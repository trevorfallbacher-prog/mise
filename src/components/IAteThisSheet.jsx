import { useEffect, useMemo, useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { findIngredient, unitLabel } from "../data/ingredients";
import { findRecipe } from "../data/recipes";
import { formatReheatSummary } from "../data/recipes/schema";
import { resolveNutrition, scaleFactor, formatMacros, effectiveCountWeightG } from "../lib/nutrition";
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

  // Two-phase walkthrough for meal leftovers with reheat data:
  //   phase="reheat" — cook-style walkthrough with method + optional
  //                    countdown + "READY" CTA. Gives the user a
  //                    moment to actually heat the food before
  //                    logging, rather than treating the sheet as a
  //                    data-entry form.
  //   phase="amount" — existing stepper + meal slot + confirm.
  // Ingredient rows (no canonical reheat) skip straight to amount.
  const [phase, setPhase] = useState(
    (isMealRow && reheat) ? "reheat" : "amount"
  );

  // Unified method list: primary first, then any alternatives the
  // recipe author supplied. User picks which one they're actually
  // using (pizza is phenomenal stovetop but a microwave works in a
  // pinch; lasagna wants the oven but a midnight slab can go
  // stovetop). Selected method drives the hero copy AND the timer's
  // target duration so the countdown reflects the device actually in
  // use, not the nominal "primary" one.
  const reheatMethods = useMemo(() => {
    if (!reheat?.primary) return [];
    const primary = { ...reheat.primary, _isPrimary: true };
    const alts = Array.isArray(reheat.alt) ? reheat.alt.filter(Boolean) : [];
    return [primary, ...alts];
  }, [reheat]);
  const [activeMethodIdx, setActiveMethodIdx] = useState(0);
  const activeMethod = reheatMethods[activeMethodIdx] || null;

  // Reheat countdown state — opt-in: user taps I'M HEATING to start,
  // tapping again (or READY) advances to the amount phase. Timer is
  // informational only; nothing in the data layer depends on it. The
  // countdown is tied to whichever method is currently selected, so
  // switching methods mid-walkthrough resets the timer to that
  // method's duration.
  const [heatingSince, setHeatingSince] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!heatingSince) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [heatingSince]);
  // Reset the timer when the active method changes — otherwise the
  // countdown shows stale elapsed time from the previous method.
  useEffect(() => { setHeatingSince(null); }, [activeMethodIdx]);
  const elapsedSec = heatingSince ? Math.floor((Date.now() - heatingSince) / 1000) : 0;
  const targetSec = Number(activeMethod?.timeMin) > 0 ? Number(activeMethod.timeMin) * 60 : 0;
  const remainingSec = Math.max(0, targetSec - elapsedSec);
  const fmtTimer = (s) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  };
  // Silence "unused" complaints on tick without an explicit reference.
  void tick;

  // Method label for chips + mini-summary when we need a short name.
  const METHOD_EMOJI = {
    oven: "♨",
    microwave: "📡",
    stovetop: "🔥",
    air_fryer: "🌀",
    toaster_oven: "🥯",
    cold: "🧊",
  };
  const METHOD_LABEL = {
    oven: "Oven",
    microwave: "Microwave",
    stovetop: "Stovetop",
    air_fryer: "Air fryer",
    toaster_oven: "Toaster oven",
    cold: "Cold",
  };

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
    const countWeightG = effectiveCountWeightG(pantryRow, canonical);
    const f = scaleFactor({ amount: amt, unit }, canonical, nutrition, { countWeightG });
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

  const sheetLabel = phase === "reheat" ? "REHEAT" : "I ATE THIS";

  return (
    <ModalSheet onClose={onClose} zIndex={Z.picker} label={sheetLabel}>
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

        {phase === "reheat" && reheat && activeMethod && (
          <div>
            {/* Method switcher — every authored path (primary + alts)
                is a pickable chip. Tap to make active; hero, tips, and
                timer all retarget to that method. The recipe's
                "best" method carries a small ★ so the original intent
                is still legible, but the user's kitchen reality wins.
                Only rendered when there's more than one method to
                pick from — single-method recipes stay visually clean. */}
            {reheatMethods.length > 1 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {reheatMethods.map((m, i) => {
                  const active = i === activeMethodIdx;
                  return (
                    <button
                      key={`${m.method}-${i}`}
                      type="button"
                      onClick={() => setActiveMethodIdx(i)}
                      style={{
                        flex: "1 1 auto", minWidth: 0,
                        padding: "10px 12px",
                        background: active ? "#f5c842" : "#141414",
                        border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                        color: active ? "#111" : "#bbb",
                        borderRadius: 10,
                        fontFamily: "'DM Mono',monospace", fontSize: 11,
                        fontWeight: active ? 700 : 500,
                        letterSpacing: "0.05em",
                        cursor: "pointer",
                        display: "flex", alignItems: "center",
                        justifyContent: "center", gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{METHOD_EMOJI[m.method] || "♨"}</span>
                      <span>{(METHOD_LABEL[m.method] || m.method).toUpperCase()}</span>
                      {m._isPrimary && (
                        <span style={{ fontSize: 9, color: active ? "#111" : "#f5c842" }}>★</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Method hero — big, cook-style. Retargets on chip change.
                The `primary` flag surfaces as a small subtext so the
                user knows when they've picked the non-default option
                (useful signal: "I'm using the alt — expect a different
                result than the recipe nails"). */}
            <div style={{
              padding: "16px 18px", marginBottom: 12,
              background: "#1a1608", border: "1px solid #3a2f10",
              borderRadius: 12,
            }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.14em", marginBottom: 8 }}>
                ♨ REHEAT · STEP 1 OF 2
                {!activeMethod._isPrimary && reheatMethods.length > 1 && (
                  <span style={{ marginLeft: 8, color: "#a99870" }}>· ALTERNATIVE METHOD</span>
                )}
              </div>
              <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 26, fontWeight: 300, color: "#f0ece4", lineHeight: 1.15, marginBottom: 8 }}>
                {formatReheatSummary({ primary: activeMethod })}
              </div>
              {activeMethod.tips && (
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#ddd", lineHeight: 1.45 }}>
                  {activeMethod.tips}
                </div>
              )}
              {reheat.note && (
                <div style={{ marginTop: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#e0a868", fontStyle: "italic", lineHeight: 1.45 }}>
                  ⚠ {reheat.note}
                </div>
              )}
            </div>

            {/* Timer band. Countdown duration tied to the currently
                selected method — switching chips resets and retargets.
                Opt-in; nothing persists. */}
            {targetSec > 0 && (
              <div style={{
                padding: "14px 16px", marginBottom: 12,
                background: "#0f0f0f", border: "1px solid #2a2a2a",
                borderRadius: 12, textAlign: "center",
              }}>
                {heatingSince ? (
                  <>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.14em", marginBottom: 6 }}>
                      {remainingSec > 0 ? "HEATING" : "READY WHEN YOU ARE"}
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 36, color: remainingSec > 0 ? "#f5c842" : "#7ec87e", letterSpacing: "0.05em" }}>
                      {fmtTimer(remainingSec)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setHeatingSince(null)}
                      style={{
                        marginTop: 10, padding: "6px 14px",
                        background: "transparent", border: "1px solid #2a2a2a",
                        color: "#888", borderRadius: 8,
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        letterSpacing: "0.08em", cursor: "pointer",
                      }}
                    >
                      STOP TIMER
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setHeatingSince(Date.now())}
                    style={{
                      width: "100%", padding: "12px",
                      background: "#141414", border: "1px solid #3a2f10",
                      color: "#f5c842", borderRadius: 10,
                      fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600,
                      letterSpacing: "0.1em", cursor: "pointer",
                    }}
                  >
                    ▶ I'M HEATING · {activeMethod.timeMin} MIN
                  </button>
                )}
              </div>
            )}

            {/* Phase advance. READY jumps straight to how-much logging;
                SKIP is semantically the same advance but named softer
                for the "I don't need the walkthrough" case. */}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setPhase("amount")}
                style={{
                  flex: 1, padding: "14px",
                  background: "#1a1a1a", border: "1px solid #2a2a2a",
                  color: "#888", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 11,
                  letterSpacing: "0.1em", cursor: "pointer",
                }}
              >
                SKIP
              </button>
              <button
                type="button"
                onClick={() => setPhase("amount")}
                style={{
                  flex: 2, padding: "14px",
                  background: "#f5c842", border: "none",
                  color: "#111", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.1em", cursor: "pointer",
                }}
              >
                READY · HOW MUCH? →
              </button>
            </div>
          </div>
        )}

        {phase === "amount" && (
          <>
        {/* Compact reheat summary still surfaces on the amount phase
            for quick reference — collapsed version of step 1 so the
            user doesn't lose the context while dialing servings. */}
        {isMealRow && reheat && (
          <div style={{
            padding: "8px 12px",
            background: "#1a1608",
            border: "1px solid #3a2f10",
            borderRadius: 8,
            marginBottom: 12,
          }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.08em" }}>
              ♨ {formatReheatSummary(reheat)}
            </div>
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

        <div style={{ display: "flex", gap: 8 }}>
          {/* Back to reheat phase — only visible when we started there. */}
          {isMealRow && reheat && (
            <button
              type="button"
              onClick={() => setPhase("reheat")}
              disabled={loading}
              style={{
                flex: 1, padding: "14px",
                background: "#1a1a1a", border: "1px solid #2a2a2a",
                color: "#888", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 11,
                letterSpacing: "0.1em", cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              ← REHEAT
            </button>
          )}
          <button
            onClick={confirm}
            disabled={loading || !(Number(amount) > 0)}
            style={{
              flex: isMealRow && reheat ? 2 : 1,
              padding: "14px",
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
          </>
        )}
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
