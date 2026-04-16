import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, safeChannel } from "./supabase";

/**
 * Unified activity feed for the Home screen. Merges cook_logs + badge
 * earns across the viewer's cohort (self + accepted family) into a
 * single time-ordered stream.
 *
 * RLS handles visibility: family sees each other's cook_logs (migration
 * 0007) and user_badges (migration 0019). Friends stay out of this
 * feed by design — friend-tier sharing is prefs-only, not activity.
 *
 * Shape of an item:
 *   { kind: 'cook' | 'badge', ts, actorId, payload }
 *
 * payload for 'cook':
 *   { cookLogId, recipeSlug, recipeTitle, recipeEmoji, rating, xp }
 * payload for 'badge':
 *   { badgeId, earnReason, cookLogId }
 */
export function useActivityFeed(userId, familyIds = [], limit = 20) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Stabilize the cohort array for the effect dep list. Using a
  // comma-joined sorted string so two re-renders with the same ids
  // don't re-fire the fetch.
  const cohortKey = useMemo(() => {
    const ids = new Set();
    if (userId) ids.add(userId);
    for (const id of familyIds) if (id) ids.add(id);
    return Array.from(ids).sort().join(",");
  }, [userId, familyIds]);

  const cohort = useMemo(
    () => (cohortKey ? cohortKey.split(",") : []),
    [cohortKey]
  );

  const load = useCallback(async () => {
    if (cohort.length === 0) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const [cooksRes, badgesRes] = await Promise.all([
      supabase
        .from("cook_logs")
        .select("id,user_id,recipe_slug,recipe_title,recipe_emoji,rating,xp_earned,cooked_at")
        .in("user_id", cohort)
        .order("cooked_at", { ascending: false })
        .limit(limit),
      supabase
        .from("user_badges")
        .select("user_id,badge_id,earn_reason,cook_log_id,earned_at")
        .in("user_id", cohort)
        .order("earned_at", { ascending: false })
        .limit(limit),
    ]);
    if (cooksRes.error) console.error("[activity] cooks load failed:", cooksRes.error);
    if (badgesRes.error) console.error("[activity] badges load failed:", badgesRes.error);

    const cookItems = (cooksRes.data || []).map(c => ({
      kind: "cook",
      ts: c.cooked_at,
      actorId: c.user_id,
      payload: {
        cookLogId:   c.id,
        recipeSlug:  c.recipe_slug,
        recipeTitle: c.recipe_title,
        recipeEmoji: c.recipe_emoji || "🍽️",
        rating:      c.rating,
        xp:          Number(c.xp_earned || 0),
      },
    }));
    const badgeItems = (badgesRes.data || []).map(b => ({
      kind: "badge",
      ts: b.earned_at,
      actorId: b.user_id,
      payload: {
        badgeId:    b.badge_id,
        earnReason: b.earn_reason,
        cookLogId:  b.cook_log_id,
      },
    }));
    const merged = [...cookItems, ...badgeItems]
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, limit);
    setItems(merged);
    setLoading(false);
  }, [cohort, limit]);

  useEffect(() => { load(); }, [load]);

  // Lightweight realtime — prepend on INSERTs from any cohort member on
  // either source table. Updates/deletes would rarely matter here (the
  // feed is a tail of latest), so we keep the handler simple.
  useEffect(() => {
    if (cohort.length === 0) return;
    const ch = safeChannel(`rt:activity:${cohortKey}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "cook_logs" },
        (payload) => {
          const row = payload.new;
          if (!row || !cohort.includes(row.user_id)) return;
          setItems(prev => [{
            kind: "cook",
            ts: row.cooked_at,
            actorId: row.user_id,
            payload: {
              cookLogId:   row.id,
              recipeSlug:  row.recipe_slug,
              recipeTitle: row.recipe_title,
              recipeEmoji: row.recipe_emoji || "🍽️",
              rating:      row.rating,
              xp:          Number(row.xp_earned || 0),
            },
          }, ...prev].slice(0, limit));
        })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "user_badges" },
        (payload) => {
          const row = payload.new;
          if (!row || !cohort.includes(row.user_id)) return;
          setItems(prev => [{
            kind: "badge",
            ts: row.earned_at,
            actorId: row.user_id,
            payload: {
              badgeId:    row.badge_id,
              earnReason: row.earn_reason,
              cookLogId:  row.cook_log_id,
            },
          }, ...prev].slice(0, limit));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [cohort, cohortKey, limit]);

  return { items, loading, refresh: load };
}
