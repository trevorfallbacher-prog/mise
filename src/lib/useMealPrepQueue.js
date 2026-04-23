import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, safeChannel } from "./supabase";

/**
 * Load the queued prep_notifications rows for a set of scheduled
 * meals. Exposes them grouped by scheduled_meal_id so the UI can
 * render a "what's coming" timeline inline on a meal tile.
 *
 * The rows include delivered, pending, and dismissed alike — the
 * caller filters for its own display needs (e.g. hide dismissed
 * unless the user opens a history toggle).
 *
 * Realtime: subscribes to the prep_notifications table filtered by
 * the current userId so the drain RPC flipping a row from pending
 * → delivered reflects immediately in the UI (the dispatched chip
 * dims).
 *
 *   useMealPrepQueue(userId, mealIds)
 *     → { byMeal, loading, dismiss(rowId), refresh() }
 *
 * `byMeal` is a Map of scheduled_meal_id → array of rows sorted by
 * deliver_at ascending.
 */
export function useMealPrepQueue(userId, mealIds) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // Stabilize the id list so the effect doesn't re-fire on every parent
  // render. Caller usually passes a fresh array literal.
  const idsKey = useMemo(
    () => (mealIds && mealIds.length ? [...mealIds].sort().join(",") : ""),
    [mealIds],
  );

  const refresh = useCallback(async () => {
    if (!userId || !idsKey) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ids = idsKey.split(",");
    const { data, error } = await supabase
      .from("prep_notifications")
      .select("*")
      .in("scheduled_meal_id", ids)
      .order("deliver_at", { ascending: true });
    if (error) {
      console.warn("[mealPrepQueue] load failed:", error);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, [userId, idsKey]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:prep_notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row    = payload.new && Object.keys(payload.new).length ? payload.new : null;
          const oldRow = payload.old && Object.keys(payload.old).length ? payload.old : null;
          setRows(prev => {
            if (payload.eventType === "INSERT" && row) {
              if (prev.some(r => r.id === row.id)) return prev;
              return [...prev, row].sort((a, b) => a.deliver_at.localeCompare(b.deliver_at));
            }
            if (payload.eventType === "UPDATE" && row) {
              return prev.map(r => (r.id === row.id ? row : r));
            }
            if (payload.eventType === "DELETE" && oldRow?.id) {
              return prev.filter(r => r.id !== oldRow.id);
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const byMeal = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.scheduled_meal_id;
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  }, [rows]);

  const dismiss = useCallback(async (rowId) => {
    if (!rowId) return;
    // Optimistic stamp so the chip dims instantly.
    const now = new Date().toISOString();
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, dismissed_at: now } : r)));
    const { error } = await supabase
      .from("prep_notifications")
      .update({ dismissed_at: now })
      .eq("id", rowId);
    if (error) {
      console.warn("[mealPrepQueue] dismiss failed:", error);
      refresh();
    }
  }, [refresh]);

  const undismiss = useCallback(async (rowId) => {
    if (!rowId) return;
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, dismissed_at: null } : r)));
    const { error } = await supabase
      .from("prep_notifications")
      .update({ dismissed_at: null })
      .eq("id", rowId);
    if (error) {
      console.warn("[mealPrepQueue] undismiss failed:", error);
      refresh();
    }
  }, [refresh]);

  return { rows, byMeal, loading, dismiss, undismiss, refresh };
}
