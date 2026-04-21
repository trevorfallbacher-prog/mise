// useConsumptionLogs — the "I ate this" write path.
//
// Complements useNutritionTally's READ surface (which merges cook_logs
// + consumption_logs into one dashboard stream). This hook owns the
// WRITE: given a pantry row + how much the user says they ate, it
//   1. resolves nutrition via the standard chain (pantry override →
//      brand → canonical → bundled),
//   2. scales it against the amount consumed to get real macro totals,
//   3. inserts a consumption_logs row stamped with those macros,
//   4. decrements the pantry row so inventory stays honest.
//
// Why snapshot the nutrition JSON at write time: future edits to the
// underlying canonical / brand / override must NOT rewrite history. If
// someone re-enriches "cream_cheese" tomorrow with a better kcal
// number, last week's snacking events keep the kcal they logged with.
// Mirrors cook_logs.nutrition semantics from migration 0068.
//
// API:
//   const { logConsumption, loading, error } = useConsumptionLogs({
//     userId,
//     brandNutrition,        // from useBrandNutrition context
//     getInfo,               // from useIngredientInfo context
//   });
//
//   await logConsumption({
//     pantryRow,             // the row being consumed (must include canonicalId)
//     amount,                // numeric, in `unit`
//     unit,                  // string, must be in canonical.units
//     mealSlot,              // "breakfast"|"lunch"|"dinner"|"snack" (inferred by default)
//     eatenAt,               // ISO string; defaults to now()
//     note,                  // optional free-text
//   });
//
// Returns { ok, consumption, error } so the caller can react. Failures
// DO NOT roll back — insertion and pantry decrement are independent:
// if the insert succeeds and the decrement fails, the user's macro
// tally is still correct and inventory drift is the smaller evil.

import { useCallback, useState } from "react";
import { supabase } from "./supabase";
import { findIngredient } from "../data/ingredients";
import { resolveNutrition, scaleFactor, validateNutrition, effectiveCountWeightG } from "./nutrition";
import { decrementRow } from "./unitConvert";

// Hour → default meal slot. Lets the sheet pre-select the most likely
// slot for the user's time of day without forcing them into it.
export function inferMealSlot(dateLike = new Date()) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const h = d.getHours();
  if (h < 10) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export function useConsumptionLogs({ userId, brandNutrition, getInfo }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const logConsumption = useCallback(async ({ pantryRow, amount, unit, mealSlot, eatenAt, note } = {}) => {
    setError(null);
    if (!userId) return { ok: false, error: "not signed in" };
    if (!pantryRow?.id) return { ok: false, error: "missing pantry row" };
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "amount must be positive" };
    if (!unit) return { ok: false, error: "unit required" };

    setLoading(true);
    try {
      const canonicalId = pantryRow.ingredientId || pantryRow.canonicalId || null;
      const canon = canonicalId ? findIngredient(canonicalId) : null;
      const isMealRow = pantryRow.kind === "meal";
      const sourceCookLogId = pantryRow.sourceCookLogId || null;

      // Resolve nutrition through whichever path applies to this row:
      //   - meal-kind leftovers: pull cook_logs.nutrition (per-serving
      //     blob stamped by CookComplete), scale by servings eaten.
      //   - ingredient rows: the standard resolver chain (pantry
      //     override → brand → canonical → bundled), scaled by
      //     scaleFactor against the consumed amount + unit.
      //
      // Either path returning null is non-fatal — the event still
      // logs for inventory; the tally just skips macro contribution
      // and coverage reports the gap honestly.
      let nutritionSnapshot = null;
      if (isMealRow && sourceCookLogId) {
        const { data: cookLog, error: clErr } = await supabase
          .from("cook_logs")
          .select("nutrition")
          .eq("id", sourceCookLogId)
          .maybeSingle();
        if (clErr) {
          console.warn("[consumption_logs] cook_log fetch failed:", clErr.message);
        } else if (cookLog?.nutrition) {
          const perServing = cookLog.nutrition;
          // Meal rows use unit="serving" by convention (enforced by
          // the sheet). Anything else would imply the caller is
          // bypassing the sheet with a unit we don't know how to
          // scale — guard and log rather than writing bad macros.
          if (unit === "serving" || unit === "servings") {
            const macros = {};
            for (const k of ["kcal", "protein_g", "fat_g", "carb_g", "fiber_g", "sodium_mg", "sugar_g"]) {
              if (typeof perServing[k] === "number") macros[k] = perServing[k] * amt;
            }
            if (Object.keys(macros).length) nutritionSnapshot = macros;
          } else {
            console.warn(`[consumption_logs] meal row eaten in unit=${unit}; only "serving" is supported`);
          }
        }
      } else if (canon) {
        const { nutrition } = resolveNutrition(pantryRow, { brandNutrition, getInfo });
        if (nutrition) {
          const countWeightG = effectiveCountWeightG(pantryRow, canon);
          const factor = scaleFactor({ amount: amt, unit }, canon, nutrition, { countWeightG });
          if (factor != null && Number.isFinite(factor)) {
            const macros = {};
            for (const k of ["kcal", "protein_g", "fat_g", "carb_g", "fiber_g", "sodium_mg", "sugar_g"]) {
              if (typeof nutrition[k] === "number") macros[k] = nutrition[k] * factor;
            }
            if (Object.keys(macros).length) nutritionSnapshot = macros;
          }
        }
      }

      // Pre-write sanity gate on the snapshot so a pathological scale
      // (absurd amount, broken resolver) can't land junk in the tally.
      // If validation fails we DROP the nutrition field rather than
      // aborting the log — the event is still worth recording for
      // inventory / history, just without a macro contribution.
      if (nutritionSnapshot) {
        // Snapshot is already scaled — treat it as per="count" with a
        // single event for the validator's shape check. Any obviously
        // bogus kcal / macro value fails the ceiling and gets dropped.
        const asTestBlock = { ...nutritionSnapshot, per: "count" };
        const ok = validateNutrition(asTestBlock);
        if (!ok.ok) {
          console.warn(`[consumption_logs] dropping malformed nutrition snapshot: ${ok.reason}`);
          nutritionSnapshot = null;
        }
      }

      const payload = {
        user_id:            userId,
        pantry_row_id:      pantryRow.id,
        ingredient_id:      canonicalId,
        amount:             amt,
        unit,
        meal_slot:          mealSlot || inferMealSlot(eatenAt),
        nutrition:          nutritionSnapshot,
        // Provenance: eating a leftover meal row points back at the
        // cook that produced it. Lets later analytics ("how much of
        // Sunday's lasagna did I actually eat?") join through a
        // single fk rather than guessing via pantry_row_id.
        source_cook_log_id: isMealRow ? sourceCookLogId : null,
        eaten_at:           eatenAt || new Date().toISOString(),
        note:               (note || "").trim() || null,
      };

      const { data: row, error: insErr } = await supabase
        .from("consumption_logs")
        .insert(payload)
        .select()
        .single();
      if (insErr) {
        console.error("[consumption_logs] insert failed:", insErr);
        setError(insErr.message || "insert failed");
        return { ok: false, error: insErr.message || "insert failed" };
      }

      // Decrement the pantry row directly. useSyncedList's realtime
      // subscription picks up the UPDATE and every open tab's pantry
      // state reconciles — no need to thread setPantry through the
      // caller. Meal-kind rows track remaining portions on
      // servings_remaining (migration 0026) rather than amount, so we
      // route to the right column. Ingredient rows go through
      // decrementRow (which consults the canonical's unit ladder to
      // translate the consumed unit into the row's own unit).
      // Clamped at 0 either way — never drive inventory negative.
      if (isMealRow) {
        const currentServings = Number(pantryRow.servingsRemaining);
        if (Number.isFinite(currentServings)) {
          const nextServings = Math.max(0, Number((currentServings - amt).toFixed(4)));
          if (nextServings <= 0) {
            // All servings consumed — delete the pantry row outright
            // so the Kitchen tile disappears. The consumption_logs
            // row we just inserted preserves the history (and keeps
            // source_cook_log_id so analytics don't lose the trail).
            // ON DELETE SET NULL on consumption_logs.pantry_row_id
            // nulls the fk cleanly when the row goes.
            const { error: delErr } = await supabase
              .from("pantry_items")
              .delete()
              .eq("id", pantryRow.id);
            if (delErr) {
              console.warn("[consumption_logs] meal delete (fully consumed) failed:", delErr.message);
            }
          } else if (nextServings !== currentServings) {
            const { error: updErr } = await supabase
              .from("pantry_items")
              .update({ servings_remaining: nextServings })
              .eq("id", pantryRow.id);
            if (updErr) {
              console.warn("[consumption_logs] meal decrement failed:", updErr.message);
            }
          }
        }
      } else if (canon) {
        const next = decrementRow(pantryRow, { amount: amt, unit }, canon);
        if (next != null && next !== Number(pantryRow.amount)) {
          const { error: updErr } = await supabase
            .from("pantry_items")
            .update({ amount: next })
            .eq("id", pantryRow.id);
          if (updErr) {
            // Non-fatal. The consumption_logs row already landed, so
            // the dashboard tally is correct; inventory just didn't
            // decrement. Warn so we see drift in logs rather than
            // ignoring it silently.
            console.warn("[consumption_logs] pantry decrement failed:", updErr.message);
          }
        }
      }

      return { ok: true, consumption: row };
    } catch (err) {
      console.error("[consumption_logs] unexpected error:", err);
      setError(err?.message || "unexpected error");
      return { ok: false, error: err?.message || "unexpected error" };
    } finally {
      setLoading(false);
    }
  }, [userId, setPantry, brandNutrition, getInfo]);

  return { logConsumption, loading, error };
}
