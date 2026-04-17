import { useEffect, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";
import { fromDb } from "./userTypes";

/**
 * Realtime-synced hook for the family's custom IDENTIFIED-AS types.
 * Parallels useUserTiles — same shape, same stale-guard pattern.
 *
 * Returns [types, loading]. Sorted by last_used_at DESC (nulls
 * last) — most-recently-used types float to the top of the picker.
 * RLS scopes to self + family.
 */
export function useUserTypes(userId) {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const currentUserRef = useRef(userId);
  useEffect(() => { currentUserRef.current = userId; }, [userId]);

  useEffect(() => {
    if (!userId) {
      setTypes([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("user_types")
        .select("*")
        .order("last_used_at", { ascending: false, nullsFirst: false });
      if (!alive) return;
      if (error) {
        console.error("[user_types] load failed:", error);
        setTypes([]);
      } else {
        setTypes((data || []).map(fromDb));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:user_types:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_types" },
        (payload) => {
          if (currentUserRef.current !== userId) return;
          const newRow = payload.new && Object.keys(payload.new).length
            ? fromDb(payload.new)
            : null;
          const oldId = payload.old?.id;
          setTypes(prev => {
            if (payload.eventType === "INSERT") {
              if (prev.some(t => t.id === newRow.id)) return prev;
              return sortTypes([...prev, newRow]);
            }
            if (payload.eventType === "UPDATE") {
              if (!prev.some(t => t.id === newRow.id)) {
                return sortTypes([...prev, newRow]);
              }
              return sortTypes(prev.map(t => t.id === newRow.id ? newRow : t));
            }
            if (payload.eventType === "DELETE") {
              if (!oldId) return prev;
              return prev.filter(t => t.id !== oldId);
            }
            return prev;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  return [types, loading];
}

function sortTypes(list) {
  return [...list].sort((a, b) => {
    const ax = a.lastUsedAt ? a.lastUsedAt.getTime() : 0;
    const bx = b.lastUsedAt ? b.lastUsedAt.getTime() : 0;
    return bx - ax;
  });
}
