import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, safeChannel } from "./supabase";

// Per-user nutrition rollup for the NutritionDashboard.
//
// Pulls every cook_logs row where the user is EITHER the chef
// (user_id = me) OR a diner (diners @> [me]). Two queries merged
// client-side because Supabase's .or() helper doesn't compose
// cleanly with .contains() on an array column — simpler to fan out
// and de-dupe by row id.
//
// Each row contributes `nutrition × servings_per_eater` to the
// eater's tally. `nutrition` is the per-recipe-serving blob written
// by CookComplete (migration 0068); `servings_per_eater` is how many
// servings each eater actually consumed (default 1, adjustable on
// the rating screen for leftovers / second helpings / splits).
//
// Returns:
//   loading              — initial fetch in flight
//   logs                 — raw de-duped rows (for debugging, rarely needed)
//   today / weekTotals / monthTotals — summed macros over each window
//   dailySeriesWeek      — [{date:'YYYY-MM-DD', kcal, protein_g, fat_g, carb_g, meals}] (7 entries, oldest → today)
//   dailySeriesMonth     — same shape, 30 entries
//   coverage             — { withNutrition, total } across the 30-day window
//                          so the dashboard can surface gaps honestly
//
// Windows are computed in the user's LOCAL timezone so "today" /
// "this week" mean what the user's calendar says, not what UTC
// thinks. Pattern mirrors useMonthlySpend.

const MACRO_KEYS = ["kcal", "protein_g", "fat_g", "carb_g", "fiber_g", "sodium_mg", "sugar_g"];

function zeroMacros() {
  return { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sodium_mg: 0, sugar_g: 0 };
}

// Local-timezone date key "YYYY-MM-DD" for a timestamp. Built from
// getFullYear / getMonth / getDate so we stay in the browser's
// wall-clock calendar — toISOString would cross midnight for any
// user east of UTC and bucket the same cook into the wrong day.
function localDayKey(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Start-of-day (local) for a given Date. Used to stamp consistent
// timestamps on the dailySeries entries so consumers can sort /
// render without normalizing each one.
function startOfLocalDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addMacros(target, src, scale) {
  for (const k of MACRO_KEYS) {
    const v = Number(src?.[k]);
    if (Number.isFinite(v)) target[k] += v * scale;
  }
}

// Strip coverage + other non-macro keys off the stored blob so only
// macro numbers flow into the summer.
function macrosOnly(blob) {
  if (!blob || typeof blob !== "object") return null;
  const out = {};
  for (const k of MACRO_KEYS) {
    if (typeof blob[k] === "number") out[k] = blob[k];
  }
  return out;
}

export function useNutritionTally(userId, familyKey) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setLogs([]); setLoading(false); return; }
    setLoading(true);
    // Three parallel queries now:
    //   1. cook_logs where I'm the chef
    //   2. cook_logs where I'm in the diners array
    //   3. consumption_logs (the "I ate this" stream) — my own rows
    // Supabase can't express user_id=me OR diners @> [me] in a single
    // filter chain cleanly (the .or() helper doesn't support the @>
    // operator against array columns as of the current client version),
    // so we fan out cook_logs across two queries and merge by id.
    // consumption_logs has a simpler scope: only the eater writes;
    // family visibility is handled by RLS but every row we care about
    // for the tally has user_id = me.
    //
    // Shape normalization: cook_logs.nutrition is PER SERVING and
    // needs servings_per_eater as the scale; consumption_logs.nutrition
    // is ALREADY SCALED at write-time to the exact amount eaten, so
    // scale=1. Both get a common `ts` (cooked_at / eaten_at) and
    // `kind` tag so downstream bucketing is source-agnostic.
    const [mine, dined, ate] = await Promise.all([
      supabase
        .from("cook_logs")
        .select("id, user_id, cooked_at, nutrition, servings_per_eater, diners")
        .eq("user_id", userId),
      supabase
        .from("cook_logs")
        .select("id, user_id, cooked_at, nutrition, servings_per_eater, diners")
        .contains("diners", [userId]),
      supabase
        .from("consumption_logs")
        .select("id, user_id, eaten_at, nutrition, meal_slot, pantry_row_id, ingredient_id")
        .eq("user_id", userId),
    ]);
    if (mine.error)  console.error("[nutrition_tally:mine] load failed:",  mine.error);
    if (dined.error) console.error("[nutrition_tally:dined] load failed:", dined.error);
    if (ate.error)   console.error("[nutrition_tally:ate] load failed:",   ate.error);

    const normalized = [];
    const seen = new Set();
    for (const row of [...(mine.data || []), ...(dined.data || [])]) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      normalized.push({
        id:        row.id,
        kind:      "cook",
        ts:        row.cooked_at,
        nutrition: row.nutrition,
        scale:     Number(row.servings_per_eater) || 1,
      });
    }
    for (const row of ate.data || []) {
      if (!row?.id) continue;
      normalized.push({
        id:        row.id,
        kind:      "snack",
        ts:        row.eaten_at,
        nutrition: row.nutrition,
        scale:     1,        // consumption rows are pre-scaled
        mealSlot:  row.meal_slot || null,
      });
    }
    setLogs(normalized);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load, familyKey]);

  // Realtime — any INSERT/UPDATE/DELETE on cook_logs where we're
  // either the chef or in the diners array should refresh the tally.
  // Cheap refresh (re-runs both queries); cook_logs INSERTs are rare
  // enough that a focused re-fetch beats hand-rolling a merge.
  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:cook_logs:tally:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cook_logs" }, (payload) => {
        const row = payload.new || payload.old;
        const chefMe = row?.user_id === userId;
        const dinerMe = Array.isArray(row?.diners) && row.diners.includes(userId);
        if (chefMe || dinerMe) load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  // Second realtime channel for consumption_logs. Separate from the
  // cook_logs one because the tables have different RLS / filter
  // semantics and batching them into one subscription would force a
  // reload on unrelated events. Tapping "I ATE THIS" on any device
  // should bump today's kcal without a manual refresh.
  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:consumption_logs:tally:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "consumption_logs" }, (payload) => {
        const row = payload.new || payload.old;
        if (row?.user_id === userId) load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  const derived = useMemo(() => {
    const todayKey = localDayKey(new Date());
    const now = new Date();
    // 7-day window ending today (inclusive). Seed the buckets so
    // zero-activity days still render as empty bars instead of
    // disappearing from the chart.
    const weekKeys = [];
    const weekStart = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      weekKeys.push(localDayKey(d));
    }
    const weekStartKey = weekKeys[0];
    // 30-day window.
    const monthKeys = [];
    const monthStart = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
    for (let i = 0; i < 30; i++) {
      const d = new Date(monthStart);
      d.setDate(monthStart.getDate() + i);
      monthKeys.push(localDayKey(d));
    }
    const monthStartKey = monthKeys[0];

    // Per-day buckets (seeded).
    const byDay = new Map();
    for (const k of monthKeys) byDay.set(k, { ...zeroMacros(), meals: 0 });

    // Aggregates.
    const today = { ...zeroMacros(), meals: 0, tracked: 0 };
    const weekTotals = { ...zeroMacros() };
    const monthTotals = { ...zeroMacros() };
    let coverageWith = 0;
    let coverageTotal = 0;

    for (const row of logs) {
      // `ts` and `scale` are normalized at load-time: cook_logs use
      // cooked_at + servings_per_eater, consumption_logs use eaten_at
      // + 1 (the nutrition blob is already scaled at write time). The
      // bucketing below is source-agnostic.
      const key = localDayKey(row.ts);
      const inMonth = key >= monthStartKey && key <= todayKey;
      const inWeek  = key >= weekStartKey  && key <= todayKey;
      const isToday = key === todayKey;
      const scale = Number(row.scale) || 1;
      const macros = macrosOnly(row.nutrition);

      if (inMonth) {
        coverageTotal++;
        if (macros) coverageWith++;
        const bucket = byDay.get(key);
        if (bucket) {
          bucket.meals++;
          if (macros) addMacros(bucket, macros, scale);
        }
      }
      if (macros) {
        if (isToday) addMacros(today, macros, scale);
        if (inWeek)  addMacros(weekTotals, macros, scale);
        if (inMonth) addMacros(monthTotals, macros, scale);
      }
      if (isToday) {
        today.meals++;
        if (macros) today.tracked++;
      }
    }

    const dailySeriesWeek = weekKeys.map(k => ({
      date: k,
      ...byDay.get(k),
    }));
    const dailySeriesMonth = monthKeys.map(k => ({
      date: k,
      ...byDay.get(k),
    }));

    return {
      today,
      weekTotals,
      monthTotals,
      dailySeriesWeek,
      dailySeriesMonth,
      coverage: { withNutrition: coverageWith, total: coverageTotal },
    };
  }, [logs]);

  return {
    loading,
    logs,
    ...derived,
    refresh: load,
  };
}
