import { useEffect, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";
import { fromDb } from "./userTemplates";

// Read-only hook for loading + realtime-syncing the user's (+ family's)
// item templates. Writes go through the helpers in userTemplates.js
// directly — the save-from-custom-add path does its own dedup-aware
// upsert that doesn't fit useSyncedList's diff/insert pattern.
//
// Returns [templates, loading] sorted by last_used_at DESC. Family
// scope is enforced by RLS, not by this hook — the SELECT returns
// self-or-family rows by policy.

/**
 * useUserTemplates(userId, { limit })
 *
 * Realtime-synced list of the user's (+ family's) item templates,
 * most-recently-used first. Feed this into AddItemModal's "YOUR
 * RECENTS" section and the custom-name typeahead.
 *
 * limit caps the row count fetched on initial load — default 50 is
 * plenty for a recents list and keeps the payload small. Realtime
 * updates bypass the limit (they're deltas, not re-fetches).
 */
export function useUserTemplates(userId, { limit = 50 } = {}) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);

  // Guard realtime updates against stale userId — dev hot reloads and
  // fast sign-in / sign-out flips can deliver events for a previous
  // user's template set after the component has moved on.
  const currentUserRef = useRef(userId);
  useEffect(() => { currentUserRef.current = userId; }, [userId]);

  // Initial load
  useEffect(() => {
    if (!userId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("user_item_templates")
        .select("*")
        .order("last_used_at", { ascending: false })
        .limit(limit);
      if (!alive) return;
      if (error) {
        console.error("[user_item_templates] load failed:", error);
        setTemplates([]);
      } else {
        setTemplates((data || []).map(fromDb));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId, limit]);

  // Realtime subscription — family members adding/editing templates
  // update the local list live. No filter needed; RLS already scopes
  // deliveries to rows the user can see.
  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:user_item_templates:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_item_templates" },
        (payload) => {
          if (currentUserRef.current !== userId) return;
          const newRow = payload.new && Object.keys(payload.new).length
            ? fromDb(payload.new)
            : null;
          const oldId = payload.old?.id;
          setTemplates(prev => {
            if (payload.eventType === "INSERT") {
              if (prev.some(t => t.id === newRow.id)) return prev;
              return sortByRecency([...prev, newRow]);
            }
            if (payload.eventType === "UPDATE") {
              if (!prev.some(t => t.id === newRow.id)) {
                return sortByRecency([...prev, newRow]);
              }
              return sortByRecency(prev.map(t => t.id === newRow.id ? newRow : t));
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

  return [templates, loading];
}

function sortByRecency(list) {
  return [...list].sort((a, b) => {
    const ax = a.lastUsedAt ? a.lastUsedAt.getTime() : 0;
    const bx = b.lastUsedAt ? b.lastUsedAt.getTime() : 0;
    return bx - ax;
  });
}
