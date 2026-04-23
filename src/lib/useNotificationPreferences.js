import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

// Client-side mirror of the DEFAULTs in notification_preferences
// (migration 0133). A user with no row in the table inherits these;
// the DB's should_notify() function hard-codes the same shape.
export const DEFAULT_PREFERENCES = Object.freeze({
  pantry_activity:       false,
  shopping_activity:     true,
  meal_coordination:     true,
  cook_log_diners:       true,
  prep_reminders:        true,
  receipt_activity:      true,
  pantry_scan_activity:  true,
  cook_step_timers:      true,
  quiet_hours_start:     null,
  quiet_hours_end:       null,
  timezone:              typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    : "UTC",
});

/**
 * Load + update the signed-in user's notification_preferences row.
 * Returns { preferences, loading, error, setPref(key, value), reset() }.
 * `preferences` is never null — missing rows fall through to
 * DEFAULT_PREFERENCES so the UI always has something to render.
 */
export function useNotificationPreferences(userId) {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error: e } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (!alive) return;
      if (e) setError(e);
      setPreferences({ ...DEFAULT_PREFERENCES, ...(data || {}) });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  const setPref = useCallback(async (patch) => {
    if (!userId) return;
    // Optimistic merge.
    setPreferences(prev => ({ ...prev, ...patch }));
    const row = { user_id: userId, ...patch };
    const { error: e } = await supabase
      .from("notification_preferences")
      .upsert(row, { onConflict: "user_id" });
    if (e) setError(e);
  }, [userId]);

  const reset = useCallback(async () => {
    if (!userId) return;
    setPreferences(DEFAULT_PREFERENCES);
    const { error: e } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, ...DEFAULT_PREFERENCES }, { onConflict: "user_id" });
    if (e) setError(e);
  }, [userId]);

  return { preferences, loading, error, setPref, reset };
}
