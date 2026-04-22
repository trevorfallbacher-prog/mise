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
import { convertWithBridge } from "./unitConvert";

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
        let mealWarning = null;
        const currentServings = Number(pantryRow.servingsRemaining);
        if (Number.isFinite(currentServings)) {
          const nextServings = Math.max(0, Number((currentServings - amt).toFixed(4)));
          if (nextServings <= 0) {
            // All servings consumed — delete the pantry row outright
            // so the Kitchen tile disappears. consumption_logs
            // preserves history via source_cook_log_id; ON DELETE SET
            // NULL on pantry_row_id nulls the fk cleanly.
            const { error: delErr } = await supabase
              .from("pantry_items")
              .delete()
              .eq("id", pantryRow.id)
              .select();
            if (delErr) {
              mealWarning = `meal delete failed: ${delErr.message}`;
              console.warn(`[consumption_logs] ${mealWarning}`);
            }
          } else if (nextServings !== currentServings) {
            const { data: updated, error: updErr } = await supabase
              .from("pantry_items")
              .update({ servings_remaining: nextServings })
              .eq("id", pantryRow.id)
              .select();
            if (updErr) {
              mealWarning = `meal decrement failed: ${updErr.message}`;
              console.warn(`[consumption_logs] ${mealWarning}`);
            } else if (!updated || updated.length === 0) {
              mealWarning = "meal decrement matched no rows (RLS or row deleted)";
              console.warn(`[consumption_logs] ${mealWarning}`);
            }
          }
        }
        if (mealWarning) {
          return { ok: true, consumption: row, inventoryWarning: mealWarning };
        }
      } else {
        // Ingredient-row decrement. Runs for both canonical-linked rows
        // and orphan rows. Three-tier resolution:
        //   1. convertWithBridge — preferred. Handles same-ladder AND
        //      cross-family bridges via row.countWeightG /
        //      packageAmount/packageUnit (migration 0121 / 0054). This
        //      unlocks cases the old raw convert() couldn't reach:
        //      chicken breast row calibrated to 225g/count, or Pepsi
        //      packaged in fl oz eaten by "can" where the canonical's
        //      ladder doesn't carry both.
        //   2. Same-unit subtraction — fallback for orphan rows (no
        //      canonical) or rows tagged to a canonical whose ladder
        //      can't reach the eaten unit even with a bridge.
        //   3. Report failure back to the caller as inventoryWarning
        //      so the sheet can surface it instead of silently leaving
        //      the row at its original amount.
        let next = null;
        let decrementReason = null;
        if (canon) {
          const conv = convertWithBridge(
            { amount: amt, unit },
            pantryRow.unit,
            canon,
            pantryRow,
          );
          if (conv.ok && Number.isFinite(conv.value)) {
            next = Math.max(0, Number((Number(pantryRow.amount) - conv.value).toFixed(4)));
          } else {
            decrementReason = conv.reason || "conversion-failed";
          }
        }
        if (next == null && unit === pantryRow.unit) {
          next = Math.max(0, Number((Number(pantryRow.amount) - amt).toFixed(4)));
          decrementReason = null;
        }

        let inventoryWarning = null;
        if (next == null) {
          inventoryWarning = `couldn't reduce inventory — no conversion from ${unit} to ${pantryRow.unit}${decrementReason ? ` (${decrementReason})` : ""}`;
          console.warn(`[consumption_logs] ${inventoryWarning}`);
        } else if (next === Number(pantryRow.amount)) {
          // Guard against no-op updates: if the computed next equals
          // current amount (rounding hit zero, amt was too small to
          // register at the configured precision) we still want to
          // flag it — the user pressed LOG IT expecting a decrement.
          if (amt > 0) {
            inventoryWarning = `amount too small to register (ate ${amt} ${unit}, row is ${pantryRow.amount} ${pantryRow.unit})`;
            console.warn(`[consumption_logs] ${inventoryWarning}`);
          }
        } else if (next <= 0) {
          // Zero-amount cleanup. Mirrors CookComplete's post-cook
          // pop-or-delete behavior: pop the next sealed pack if one
          // exists, else drop the row so the Kitchen tile doesn't
          // linger as an empty ghost. consumption_logs.pantry_row_id
          // is ON DELETE SET NULL, so the just-inserted log stays.
          const reserves = Number(pantryRow.reserveCount);
          const packAmt  = Number(pantryRow.packageAmount);
          if (Number.isFinite(reserves) && reserves > 0 &&
              Number.isFinite(packAmt)  && packAmt  > 0) {
            const { data: popped, error: popErr } = await supabase
              .from("pantry_items")
              .update({ amount: packAmt, reserve_count: reserves - 1 })
              .eq("id", pantryRow.id)
              .select();
            if (popErr) {
              inventoryWarning = `reserve-pop failed: ${popErr.message}`;
              console.warn(`[consumption_logs] ${inventoryWarning}`);
            } else if (!popped || popped.length === 0) {
              inventoryWarning = "reserve-pop matched no rows (RLS or race)";
              console.warn(`[consumption_logs] ${inventoryWarning}`);
            }
          } else {
            const { error: delErr } = await supabase
              .from("pantry_items")
              .delete()
              .eq("id", pantryRow.id)
              .select();
            if (delErr) {
              inventoryWarning = `empty-row delete failed: ${delErr.message}`;
              console.warn(`[consumption_logs] ${inventoryWarning}`);
            }
          }
        } else {
          const { data: updated, error: updErr } = await supabase
            .from("pantry_items")
            .update({ amount: next })
            .eq("id", pantryRow.id)
            .select();
          if (updErr) {
            inventoryWarning = `decrement failed: ${updErr.message}`;
            console.warn(`[consumption_logs] ${inventoryWarning}`);
          } else if (!updated || updated.length === 0) {
            // Surface silent-no-op cases: UPDATE with no matched rows
            // means RLS blocked it, the row was just deleted, or the
            // id mismatches. Previously this was invisible — the
            // event logged but inventory stayed put with no feedback.
            inventoryWarning = "decrement matched no rows (RLS or row deleted)";
            console.warn(`[consumption_logs] ${inventoryWarning}`);
          }
        }

        if (inventoryWarning) {
          return { ok: true, consumption: row, inventoryWarning };
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
  }, [userId, brandNutrition, getInfo]);

  return { logConsumption, loading, error };
}
