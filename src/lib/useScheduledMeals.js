import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";
import { syncPrepNotifications } from "./prepScheduler";

/**
 * Loads the user's (and family's) scheduled meals in a window.
 * Params: userId, { fromISO, toISO, familyKey, onRealtime } — fromISO/toISO
 * are ISO timestamps for the window; familyKey bumps re-queries when the
 * family set changes; onRealtime(event, meal, oldMeal) fires for events
 * originating from another user (so callers can raise toasts).
 *
 * Returns:
 *   {
 *     meals, loading, error, refresh,
 *     schedule({ recipeSlug, scheduledFor, notificationSettings, note, cookId, isRequest }),
 *     updateMeal(id, patch),
 *     claim(id),     -- set cook_id = me (accept a request)
 *     unclaim(id),   -- set cook_id = null (back into request state)
 *     cancel(id),
 *   }
 *
 * Meals are kept sorted by scheduled_for ascending.
 *
 * Attribution columns (all nullable for backward-compat):
 *   user_id       — creator (always set)
 *   cook_id       — who's going to cook. null = unclaimed request.
 *   requested_by  — only set for request-a-meal rows (normally = user_id)
 *
 * Prep reminder sync:
 *   Pass a `recipeResolver` option — a function from slug → recipe
 *   object — and schedule()/updateMeal() will automatically upsert
 *   prep_notifications rows for the meal's recipe.prepSteps. The
 *   reminders fire for the cook (cook_id, falling back to user_id).
 *   See src/lib/prepScheduler.js.
 */
export function useScheduledMeals(userId, { fromISO, toISO, familyKey, onRealtime, recipeResolver } = {}) {
  const recipeResolverRef = useRef(recipeResolver);
  useEffect(() => { recipeResolverRef.current = recipeResolver; }, [recipeResolver]);
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
    let q = supabase.from("scheduled_meals").select("*");
    if (fromISO) q = q.gte("scheduled_for", fromISO);
    if (toISO)   q = q.lte("scheduled_for", toISO);
    const { data, error: e } = await q.order("scheduled_for", { ascending: true });
    if (e) setError(e);
    setMeals(data || []);
    setLoading(false);
  }, [userId, fromISO, toISO]);

  useEffect(() => { load(); }, [load, familyKey]);

  // Keep onRealtime in a ref so identity changes don't tear down the channel.
  const onRealtimeRef = useRef(onRealtime);
  useEffect(() => { onRealtimeRef.current = onRealtime; }, [onRealtime]);

  // Realtime. Same approach as useSyncedList — merge other-user events and
  // reconcile our own writes.
  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:scheduled_meals:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_meals" }, (payload) => {
        const row    = payload.new && Object.keys(payload.new).length ? payload.new : null;
        const oldRow = payload.old && Object.keys(payload.old).length ? payload.old : null;
        const fromOther =
          (row && row.user_id && row.user_id !== userId) ||
          (oldRow && oldRow.user_id && oldRow.user_id !== userId);

        setMeals(prev => {
          if (payload.eventType === "INSERT") {
            if (prev.some(m => m.id === row.id)) return prev;
            const next = [...prev, row];
            next.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
            return next;
          }
          if (payload.eventType === "UPDATE") {
            if (!prev.some(m => m.id === row.id)) return prev;
            return prev.map(m => (m.id === row.id ? row : m));
          }
          if (payload.eventType === "DELETE") {
            const id = oldRow?.id;
            return id ? prev.filter(m => m.id !== id) : prev;
          }
          return prev;
        });

        const cb = onRealtimeRef.current;
        if (fromOther && cb) cb(payload.eventType, row, oldRow);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const schedule = useCallback(
    async ({ recipeSlug, scheduledFor, notificationSettings = {}, note = null, cookId, isRequest = false, servings, mealSlot, fromPantryRowId }) => {
      if (!userId) throw new Error("schedule called without a userId");
      // If caller didn't specify, default to self-cooking unless it's a request.
      const effectiveCookId = cookId !== undefined ? cookId : (isRequest ? null : userId);
      const row = {
        user_id: userId,
        recipe_slug: recipeSlug,
        scheduled_for: scheduledFor,
        notification_settings: notificationSettings,
        note,
        cook_id: effectiveCookId,
        requested_by: isRequest ? userId : null,
        // Conditional spreads so older DBs (pre-0069 / pre-0120) don't
        // 400 on unknown columns — if the migration hasn't been
        // applied, just don't include the field.
        ...(servings != null ? { servings } : {}),
        ...(mealSlot ? { meal_slot: mealSlot } : {}),
        // When the slot references a specific leftover pantry row,
        // stamp it so the day-of UI can open the I-ate-this sheet
        // directly rather than CookMode. Migration 0120.
        ...(fromPantryRowId ? { from_pantry_row_id: fromPantryRowId } : {}),
      };
      const { data, error: e } = await supabase
        .from("scheduled_meals")
        .insert(row)
        .select()
        .single();
      if (e) throw e;
      setMeals(prev => {
        if (prev.some(m => m.id === data.id)) return prev;
        const next = [...prev, data];
        next.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
        return next;
      });
      // Queue prep reminders for the cook. Fire-and-forget — failures
      // are already warned from inside syncPrepNotifications and must
      // never block the schedule flow.
      const resolver = recipeResolverRef.current;
      const cookUserId = data.cook_id || data.user_id;
      if (resolver && cookUserId) {
        const recipe = resolver(data.recipe_slug);
        if (recipe) {
          syncPrepNotifications({ scheduledMeal: data, recipe, userId: cookUserId });
        }
      }
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
    // Reschedule / cook-change / toggle-flip — all want the prep queue
    // rebuilt. syncPrepNotifications deletes and re-inserts, so running
    // it on unrelated patches (e.g. `note`) is harmless.
    const resolver = recipeResolverRef.current;
    const cookUserId = data.cook_id || data.user_id;
    if (resolver && cookUserId) {
      const recipe = resolver(data.recipe_slug);
      if (recipe) {
        syncPrepNotifications({ scheduledMeal: data, recipe, userId: cookUserId });
      }
    }
    return data;
  }, []);

  const claim = useCallback(async (id) => {
    return updateMeal(id, { cook_id: userId });
  }, [updateMeal, userId]);

  const unclaim = useCallback(async (id) => {
    return updateMeal(id, { cook_id: null });
  }, [updateMeal]);

  const cancel = useCallback(async (id) => {
    const { error: e } = await supabase.from("scheduled_meals").delete().eq("id", id);
    if (e) throw e;
    setMeals(prev => prev.filter(m => m.id !== id));
  }, []);

  return { meals, loading, error, refresh: load, schedule, updateMeal, claim, unclaim, cancel };
}
