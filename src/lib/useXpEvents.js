import { useEffect, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";

/**
 * Realtime subscription on xp_events for the signed-in user.
 *
 * Returns:
 *   {
 *     queue:   [eventRow, ...]  — earns since mount, oldest first
 *     consume: (id) => void     — drop a row from the queue once
 *                                 the toast has displayed
 *     mute:    (bool) => void   — suppress new entries (used while
 *                                 the CookComplete summary is playing
 *                                 so beats and toasts don't compete)
 *   }
 *
 * Filters at the DB level via filter='user_id=eq.<id>' so the channel
 * never delivers other users' rows. Skips streak_revival (the debit
 * path is part of its own UX flow, not a celebration). Skips events
 * with final_xp == 0 unless gate_adjustment is non-zero — a user
 * earning 0 from a cap-trimmed scan doesn't need a toast, but a
 * gate-blocked event IS noteworthy ("you would've earned X").
 *
 * Important: the realtime sub starts AFTER mount. Events fired
 * before the channel subscribes are missed by design — toasts are
 * only for the user's currently-engaged session.
 */
export function useXpEvents(userId) {
  const [queue, setQueue] = useState([]);
  const mutedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:xp_events:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "xp_events",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload?.new;
          if (!row) return;
          if (mutedRef.current) return;
          if (row.source === "streak_revival") return;
          // Cap-trimmed events with no real effect: skip the toast.
          if ((row.final_xp || 0) === 0 && (row.gate_adjustment || 0) === 0) {
            return;
          }
          setQueue((prev) => [...prev, row]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  const consume = (id) => {
    setQueue((prev) => prev.filter((r) => r.id !== id));
  };

  const mute = (next) => {
    mutedRef.current = !!next;
  };

  return { queue, consume, mute };
}
