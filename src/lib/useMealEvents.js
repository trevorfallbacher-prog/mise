import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

/**
 * Lightweight realtime listener for the scheduled_meals table.
 *
 * Unlike useScheduledMeals, this hook does not fetch or keep state — it just
 * fires `onChange(event, newRow, oldRow)` for every change coming from another
 * user. It exists so toasts can fire across ALL tabs (Home, Cook, Pantry…),
 * not only while the Plan tab is mounted.
 *
 * Keep `onChange` in a ref internally so identity changes don't tear down
 * the subscription — same pattern as useSyncedList.
 */
export function useMealEvents(userId, onChange) {
  const cbRef = useRef(onChange);
  useEffect(() => { cbRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`rt:scheduled_meals:evt:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_meals" }, (payload) => {
        const row    = payload.new && Object.keys(payload.new).length ? payload.new : null;
        const oldRow = payload.old && Object.keys(payload.old).length ? payload.old : null;
        const fromOther =
          (row && row.user_id && row.user_id !== userId) ||
          (oldRow && oldRow.user_id && oldRow.user_id !== userId);
        if (!fromOther) return;
        const cb = cbRef.current;
        if (cb) cb(payload.eventType, row, oldRow);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);
}
