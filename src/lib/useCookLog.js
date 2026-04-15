import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

// Row shape we render in the UI. Keeps the DB column names out of components.
function fromDb(row) {
  return {
    id:            row.id,
    userId:        row.user_id,
    recipeSlug:    row.recipe_slug,
    recipeTitle:   row.recipe_title,
    recipeEmoji:   row.recipe_emoji || "🍽️",
    recipeCuisine: row.recipe_cuisine || null,
    recipeCategory: row.recipe_category || null,
    rating:        row.rating,
    notes:         row.notes || "",
    xpEarned:      Number(row.xp_earned || 0),
    diners:        Array.isArray(row.diners) ? row.diners : [],
    isFavorite:    !!row.is_favorite,
    cookedAt:      row.cooked_at,
    createdAt:     row.created_at,
  };
}

/**
 * Loads the signed-in user's own cook log (rows where user_id = userId),
 * sorted by cooked_at desc. Family/friends' cooks live in the
 * notifications inbox for now — chunk 3 adds a "meals I ate" tab that
 * surfaces rows where the current user is listed in `diners`.
 *
 * Subscribes to realtime so a fresh save from CookComplete lands in the
 * cookbook without a manual refresh.
 *
 * Returns:
 *   logs             — sorted [{ ... }]
 *   loading          — initial load in flight
 *   toggleFavorite   — (id) => void, flips is_favorite locally + in DB
 *   remove           — (id) => void, deletes the row (with optimistic UI)
 *   refresh          — () => void, manual re-fetch (rarely needed)
 */
export function useCookLog(userId, familyKey) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setLogs([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("cook_logs")
      .select("*")
      .eq("user_id", userId)
      .order("cooked_at", { ascending: false });
    if (error) {
      console.error("[cook_logs] load failed:", error);
      setLogs([]);
    } else {
      setLogs((data || []).map(fromDb));
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load, familyKey]);

  // Realtime — only react to rows we own (RLS would filter anyway, but the
  // channel could deliver family rows we don't want in this list).
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`rt:cook_logs:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cook_logs" }, (payload) => {
        const rowUser = payload.new?.user_id || payload.old?.user_id;
        if (rowUser !== userId) return;
        setLogs(prev => {
          if (payload.eventType === "INSERT") {
            const row = fromDb(payload.new);
            if (prev.some(l => l.id === row.id)) return prev;
            return [row, ...prev];
          }
          if (payload.eventType === "UPDATE") {
            const row = fromDb(payload.new);
            return prev.map(l => l.id === row.id ? row : l);
          }
          if (payload.eventType === "DELETE") {
            const id = payload.old?.id;
            return id ? prev.filter(l => l.id !== id) : prev;
          }
          return prev;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const toggleFavorite = useCallback((id) => {
    setLogs(prev => {
      const target = prev.find(l => l.id === id);
      if (!target) return prev;
      const next = !target.isFavorite;
      // Fire-and-forget; realtime UPDATE will reconcile on success.
      supabase.from("cook_logs").update({ is_favorite: next }).eq("id", id).then(({ error }) => {
        if (error) console.error("[cook_logs] toggleFavorite failed:", error);
      });
      return prev.map(l => l.id === id ? { ...l, isFavorite: next } : l);
    });
  }, []);

  const remove = useCallback((id) => {
    setLogs(prev => prev.filter(l => l.id !== id));
    supabase.from("cook_logs").delete().eq("id", id).then(({ error }) => {
      if (error) console.error("[cook_logs] delete failed:", error);
    });
  }, []);

  return { logs, loading, toggleFavorite, remove, refresh: load };
}
