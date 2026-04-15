import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, safeChannel } from "./supabase";

// Map DB cook_log row → UI shape. Kept local so UserProfile can render
// these directly without importing the main useCookLog normalizer (and
// dragging the review / favorites hooks along for nothing).
function cookFromDb(row) {
  return {
    id:            row.id,
    userId:        row.user_id,
    recipeSlug:    row.recipe_slug,
    recipeTitle:   row.recipe_title,
    recipeEmoji:   row.recipe_emoji || "🍽️",
    recipeCuisine: row.recipe_cuisine || null,
    rating:        row.rating,
    xpEarned:      Number(row.xp_earned || 0),
    cookedAt:      row.cooked_at,
  };
}

/**
 * Loads a public(ish) snapshot of another user's cooking profile.
 *
 * RLS does the gatekeeping: `profiles SELECT` is open to connection_ids_of
 * (migration 0007), so this query succeeds only when the viewer is family
 * or friend to `userId` — or when userId === viewer (your own).
 * `cook_logs SELECT` returns what the viewer is allowed to see: family
 * gets the full log; a friend gets nothing from cook_logs (they never
 * land in the diners array of each other's cooks unless explicitly
 * added as friends-as-diners, which is a cohort concern).
 *
 * Aggregate stats (XP, cook count, favorite cuisine) are computed
 * client-side from the returned cook_logs rather than read from the
 * profiles columns (total_xp etc). The columns exist in the schema but
 * nothing currently maintains them post-cook — summing on read is a
 * cheap, honest source of truth.
 *
 * Returns:
 *   profile       — the target profile row (or null if hidden by RLS)
 *   cooks         — their cook_logs visible to the viewer, newest first
 *   stats         — { xp, cookCount, nailedCount, favCuisine, firstCookedAt }
 *   sharedCooks   — cooks where the viewer was a diner on the target's cook
 *   loading, error
 */
export function useUserProfile(targetUserId, viewerId) {
  const [profile, setProfile] = useState(null);
  const [cooks,   setCooks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    if (!targetUserId) {
      setProfile(null); setCooks([]); setLoading(false); return;
    }
    setLoading(true); setError(null);

    // Profile row. RLS makes this 0 rows for strangers, 1 for connections.
    const { data: pRow, error: pErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", targetUserId)
      .maybeSingle();
    if (pErr) {
      setError(pErr);
      setProfile(null);
    } else {
      setProfile(pRow);
    }

    // Cook logs they authored. RLS trims to what the viewer may see.
    const { data: cRows, error: cErr } = await supabase
      .from("cook_logs")
      .select("*")
      .eq("user_id", targetUserId)
      .order("cooked_at", { ascending: false });
    if (cErr) {
      console.error("[useUserProfile] cook_logs load failed:", cErr);
      setCooks([]);
    } else {
      setCooks((cRows || []).map(cookFromDb));
    }

    setLoading(false);
  }, [targetUserId]);

  useEffect(() => { load(); }, [load]);

  // Lightweight realtime: if the target saves a new cook while you're
  // looking at their profile, it appears. We don't need every CRUD event,
  // just inserts — updates to their existing logs don't meaningfully
  // change the profile summary.
  useEffect(() => {
    if (!targetUserId) return;
    const ch = safeChannel(`rt:user_profile:${targetUserId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "cook_logs", filter: `user_id=eq.${targetUserId}` },
        (payload) => {
          const row = payload.new;
          if (!row) return;
          setCooks(prev => {
            if (prev.some(c => c.id === row.id)) return prev;
            return [cookFromDb(row), ...prev];
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [targetUserId]);

  const stats = useMemo(() => {
    const xp = cooks.reduce((n, c) => n + c.xpEarned, 0);
    const nailed = cooks.filter(c => c.rating === "nailed").length;
    // Favorite cuisine = most-cooked cuisine bucket. Ties broken by
    // latest activity.
    const byCuisine = new Map();
    for (const c of cooks) {
      if (!c.recipeCuisine) continue;
      byCuisine.set(c.recipeCuisine, (byCuisine.get(c.recipeCuisine) || 0) + 1);
    }
    let favCuisine = null, favCount = 0;
    for (const [cuisine, count] of byCuisine) {
      if (count > favCount) { favCuisine = cuisine; favCount = count; }
    }
    const firstCookedAt = cooks.length ? cooks[cooks.length - 1].cookedAt : null;
    return { xp, cookCount: cooks.length, nailedCount: nailed, favCuisine, firstCookedAt };
  }, [cooks]);

  // Which of the target's cooks did the viewer eat at? Powers the
  // "our history together" block so opening a family member's profile
  // immediately reminds you what you've shared. Separate query from the
  // main cook list because most profile opens don't need it, and the
  // contains() filter is cheap on its own.
  const [sharedCooks, setSharedCooks] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!viewerId || !targetUserId || viewerId === targetUserId) {
      setSharedCooks([]); return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("cook_logs")
        .select("*")
        .eq("user_id", targetUserId)
        .contains("diners", [viewerId])
        .order("cooked_at", { ascending: false });
      if (!alive) return;
      if (error) { console.error("[useUserProfile] shared load failed:", error); setSharedCooks([]); }
      else       { setSharedCooks((data || []).map(cookFromDb)); }
    })();
    return () => { alive = false; };
  }, [viewerId, targetUserId]);

  return { profile, cooks, stats, sharedCooks, loading, error, refresh: load };
}
