import { useEffect, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";
import { fromDb } from "./userTiles";

/**
 * Read-only + realtime-synced hook for the family's custom tiles.
 * Feed into the IDENTIFIED AS picker in AddItemModal and into the
 * pantry-grid renderer (the pantry tabs render built-in tiles +
 * user tiles for the current location).
 *
 * Returns [tiles, loading]. Sorted by location then last_used_at DESC
 * (nulls last) so active tiles float to the top within each location.
 * RLS scopes to self + family; no client-side filter needed.
 *
 * location: optional — when passed, only tiles for that location are
 * returned. Callers that render all locations at once (future admin
 * view) pass nothing.
 */
export function useUserTiles(userId, { location } = {}) {
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(false);

  const currentUserRef = useRef(userId);
  useEffect(() => { currentUserRef.current = userId; }, [userId]);

  useEffect(() => {
    if (!userId) {
      setTiles([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      let q = supabase
        .from("user_tiles")
        .select("*")
        .order("location", { ascending: true })
        .order("last_used_at", { ascending: false, nullsFirst: false });
      if (location) q = q.eq("location", location);
      const { data, error } = await q;
      if (!alive) return;
      if (error) {
        console.error("[user_tiles] load failed:", error);
        setTiles([]);
      } else {
        setTiles((data || []).map(fromDb));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId, location]);

  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:user_tiles:${userId}:${location || "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_tiles" },
        (payload) => {
          if (currentUserRef.current !== userId) return;
          const newRow = payload.new && Object.keys(payload.new).length
            ? fromDb(payload.new)
            : null;
          const oldId = payload.old?.id;
          // Location filter on realtime events — ignore events for
          // other locations when we're scoped to one.
          if (location && newRow && newRow.location !== location) {
            // May still need to handle DELETE of a row we already
            // have locally; fall through to the handler below.
            if (payload.eventType !== "DELETE") return;
          }
          setTiles(prev => {
            if (payload.eventType === "INSERT") {
              if (prev.some(t => t.id === newRow.id)) return prev;
              return sortTiles([...prev, newRow]);
            }
            if (payload.eventType === "UPDATE") {
              if (!prev.some(t => t.id === newRow.id)) {
                return sortTiles([...prev, newRow]);
              }
              return sortTiles(prev.map(t => t.id === newRow.id ? newRow : t));
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
  }, [userId, location]);

  return [tiles, loading];
}

function sortTiles(list) {
  return [...list].sort((a, b) => {
    if (a.location !== b.location) return a.location.localeCompare(b.location);
    const ax = a.lastUsedAt ? a.lastUsedAt.getTime() : 0;
    const bx = b.lastUsedAt ? b.lastUsedAt.getTime() : 0;
    return bx - ax;
  });
}
