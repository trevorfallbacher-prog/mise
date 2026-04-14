import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Loads the user's scheduled meals in a window.
 * Params: userId, { fromISO, toISO } — ISO timestamps for the window
 *
 * Returns:
 *   {
 *     meals:     Array<ScheduledMeal>,
 *     loading:   bool,
 *     error:     Error|null,
 *     refresh(): manual refetch,
 *     schedule({ recipeSlug, scheduledFor, notificationSettings, note }): insert,
 *     updateMeal(id, patch): update one,
 *     cancel(id): delete one,
 *   }
 *
 * Meals are kept sorted by scheduled_for ascending.
 */
export function useScheduledMeals(userId, { fromISO, toISO } = {}) {
  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!userId) {
      setMeals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let q = supabase.from("scheduled_meals").select("*").eq("user_id", userId);
    if (fromISO) q = q.gte("scheduled_for", fromISO);
    if (toISO)   q = q.lte("scheduled_for", toISO);
    const { data, error: e } = await q.order("scheduled_for", { ascending: true });
    if (e) setError(e);
    setMeals(data || []);
    setLoading(false);
  }, [userId, fromISO, toISO]);

  useEffect(() => { load(); }, [load]);

  const schedule = useCallback(
    async ({ recipeSlug, scheduledFor, notificationSettings = {}, note = null }) => {
      if (!userId) throw new Error("schedule called without a userId");
      const row = {
        user_id: userId,
        recipe_slug: recipeSlug,
        scheduled_for: scheduledFor,
        notification_settings: notificationSettings,
        note,
      };
      const { data, error: e } = await supabase
        .from("scheduled_meals")
        .insert(row)
        .select()
        .single();
      if (e) throw e;
      // Splice into local state in sorted order rather than refetching.
      setMeals(prev => {
        const next = [...prev, data];
        next.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
        return next;
      });
      return data;
    },
    [userId]
  );

  const updateMeal = useCallback(async (id, patch) => {
    const { data, error: e } = await supabase
      .from("scheduled_meals")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (e) throw e;
    setMeals(prev => prev.map(m => (m.id === id ? data : m)));
    return data;
  }, []);

  const cancel = useCallback(async (id) => {
    const { error: e } = await supabase.from("scheduled_meals").delete().eq("id", id);
    if (e) throw e;
    setMeals(prev => prev.filter(m => m.id !== id));
  }, []);

  return { meals, loading, error, refresh: load, schedule, updateMeal, cancel };
}
