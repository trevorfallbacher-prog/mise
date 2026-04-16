import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, safeChannel } from "./supabase";

// Catalog row → UI shape.
//
// maxAwards / isHidden / priority come from migration 0020 — we map
// them consistently so pre-migration columns (NULL / absent) don't
// break rendering. isHidden especially matters: locked rendering uses
// it to decide whether to surface a silhouette on the wall at all.
function badgeFromDb(row) {
  return {
    id:          row.id,
    slug:        row.slug,
    name:        row.name,
    description: row.description,
    iconPath:    row.icon_path,
    recipeSlug:  row.recipe_slug,
    earnRule:    row.earn_rule,
    tier:        row.tier,
    color:       row.color,
    maxAwards:   row.max_awards ?? null,
    isHidden:    !!row.is_hidden,
    priority:    Number(row.priority ?? 0),
  };
}

// Load the badges catalog. Fresh fetch per hook mount — we used to
// memoize at module level but that cached an empty result across hot-
// reloads when the badges table hadn't been created yet; after running
// the migration the user still saw zero badges until a hard refresh.
// The query is cheap enough (N=handful of rows) that paying it per
// profile open is not a concern.
async function loadCatalog() {
  const { data, error } = await supabase
    .from("badges")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    console.error("[badges] catalog load failed:", error);
    return [];
  }
  return (data || []).map(badgeFromDb);
}

/**
 * Badges earned by a target user + the full catalog so consumers can
 * render a "locked" state for badges the target hasn't earned yet.
 *
 * RLS on user_badges lets you read a target's earned set when the
 * target is you OR an accepted family/friend — same cohort as the
 * profile view. Strangers get an empty `earned` array.
 *
 * Returns:
 *   catalog    — every badge the app knows about (sorted by name)
 *   earned     — Map<badgeId, { earnedAt, cookLogId }> for this user
 *   earnedList — catalog entries the target HAS earned (with earnedAt merged in)
 *   lockedList — catalog entries they haven't earned
 *   loading
 */
export function useBadges(targetUserId) {
  const [catalog, setCatalog] = useState([]);
  const [earned,  setEarned]  = useState(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      // Catalog first; earnings alongside (both cheap queries).
      const [cat, ownedRes] = await Promise.all([
        loadCatalog(),
        targetUserId
          ? supabase.from("user_badges").select("*").eq("user_id", targetUserId)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!alive) return;
      setCatalog(cat);
      if (ownedRes.error) {
        console.error("[user_badges] load failed:", ownedRes.error);
        setEarned(new Map());
      } else {
        const map = new Map();
        for (const row of ownedRes.data || []) {
          map.set(row.badge_id, {
            earnedAt:   row.earned_at,
            cookLogId:  row.cook_log_id,
            earnReason: row.earn_reason || null,
          });
        }
        setEarned(map);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [targetUserId]);

  // Realtime: a fresh earn from this user (self-view) or from a family
  // member shows up instantly. Scoped to target user_id so we don't pay
  // for family members' earn events that the viewer shouldn't see.
  useEffect(() => {
    if (!targetUserId) return;
    const ch = safeChannel(`rt:user_badges:${targetUserId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "user_badges", filter: `user_id=eq.${targetUserId}` },
        (payload) => {
          setEarned(prev => {
            const next = new Map(prev);
            if (payload.eventType === "INSERT" && payload.new) {
              next.set(payload.new.badge_id, {
                earnedAt:   payload.new.earned_at,
                cookLogId:  payload.new.cook_log_id,
                earnReason: payload.new.earn_reason || null,
              });
            } else if (payload.eventType === "DELETE" && payload.old) {
              next.delete(payload.old.badge_id);
            }
            return next;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [targetUserId]);

  const earnedList = useMemo(
    () => catalog
      .filter(b => earned.has(b.id))
      .map(b => ({ ...b, ...(earned.get(b.id) || {}) }))
      // Newest earn first on the wall — a fresh badge lives up top.
      .sort((a, b) => (b.earnedAt || "").localeCompare(a.earnedAt || "")),
    [catalog, earned],
  );

  // Hidden badges deliberately don't surface as locked silhouettes —
  // the surprise is the reveal. Once earned they appear (the earnedList
  // pass above already respects that).
  const lockedList = useMemo(
    () => catalog.filter(b => !earned.has(b.id) && !b.isHidden),
    [catalog, earned],
  );

  // Convenience lookup for the cookbook detail ("this cook earned the
  // Cacio e Pepe badge"): given a recipe slug, return the badge row
  // from the catalog or null.
  const badgeForRecipe = useCallback(
    (recipeSlug) => catalog.find(b => b.recipeSlug === recipeSlug) || null,
    [catalog],
  );

  return {
    catalog, earned, earnedList, lockedList, loading, badgeForRecipe,
  };
}
