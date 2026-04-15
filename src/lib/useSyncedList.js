import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";

/**
 * Generic "row list synced to a Supabase table" hook.
 *
 * Exposes the same API as `useState([])` — the caller can write:
 *   setList(prev => [...prev, newItem])
 * …and this hook will diff prev vs next and fire INSERT / UPDATE / DELETE
 * against Supabase in the background. That means components (Pantry, CookMode)
 * don't need to know about the database at all.
 *
 * Required shape of each item:
 *   - `id` — client-generated uuid (use `crypto.randomUUID()` on new items)
 *
 * Params:
 *   table       — Supabase table name
 *   userId      — the owning user (used to tag new inserts; reads rely on RLS)
 *   toDb        — (item) => row, for camelCase → snake_case conversion
 *   fromDb      — (row)  => item, the inverse
 *   refreshKey  — optional value; changing it triggers a reload (used to pick
 *                 up newly-shared family rows after a connection is accepted)
 *   selfOnly    — when true, filter loads to the current user's rows only.
 *   onRealtime  — optional callback fired for each realtime event from *other*
 *                 users. Shape: (eventType, row, oldRow) — row is already
 *                 mapped through fromDb. Use this to raise toasts.
 *
 * Returns [items, setItems, loading]
 */
export function useSyncedList({ table, userId, toDb, fromDb, refreshKey, selfOnly = false, onRealtime }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Initial load (re-fires whenever refreshKey changes)
  useEffect(() => {
    let alive = true;
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      let q = supabase.from(table).select("*");
      if (selfOnly) q = q.eq("user_id", userId);
      const { data, error } = await q;
      if (!alive) return;
      if (error) {
        console.error(`[${table}] load failed:`, error);
        setItems([]);
      } else {
        setItems((data || []).map(fromDb));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [table, userId, fromDb, refreshKey, selfOnly]);

  // Keep the latest onRealtime / fromDb in refs so we don't tear down the
  // subscription on every render. (onRealtime typically closes over
  // relationships.family which gets a new array reference on reload.)
  const onRealtimeRef = useRef(onRealtime);
  const fromDbRef = useRef(fromDb);
  useEffect(() => { onRealtimeRef.current = onRealtime; }, [onRealtime]);
  useEffect(() => { fromDbRef.current = fromDb; }, [fromDb]);

  // Realtime subscription — merges in changes from other users, and
  // reconciles our own changes against what the DB ultimately stored.
  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:${table}:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        const mapRow = fromDbRef.current;
        const newRow = payload.new && Object.keys(payload.new).length ? mapRow(payload.new) : null;
        const oldRow = payload.old && Object.keys(payload.old).length ? payload.old : null;
        const fromOther =
          (payload.new && payload.new.user_id && payload.new.user_id !== userId) ||
          (payload.old && payload.old.user_id && payload.old.user_id !== userId);

        setItems(prev => {
          if (payload.eventType === "INSERT") {
            if (prev.some(i => i.id === newRow.id)) return prev;
            return [...prev, newRow];
          }
          if (payload.eventType === "UPDATE") {
            if (!prev.some(i => i.id === newRow.id)) return [...prev, newRow];
            return prev.map(i => (i.id === newRow.id ? newRow : i));
          }
          if (payload.eventType === "DELETE") {
            const id = oldRow?.id;
            if (!id) return prev;
            return prev.filter(i => i.id !== id);
          }
          return prev;
        });

        const cb = onRealtimeRef.current;
        if (fromOther && cb) cb(payload.eventType, newRow, oldRow);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [table, userId]);

  // Diff-based setter. Accepts a value or functional updater, just like useState.
  const setList = useCallback(
    (updater) => {
      setItems(prev => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (userId) persistDiff({ table, userId, toDb, prev, next });
        return next;
      });
    },
    [table, userId, toDb]
  );

  return [items, setList, loading];
}

// Fire-and-forget: diff prev vs next by id, then issue INSERTs / UPDATEs / DELETEs.
// Errors are logged; the local state is considered the source of truth.
function persistDiff({ table, userId, toDb, prev, next }) {
  const prevById = new Map(prev.map(i => [i.id, i]));
  const nextById = new Map(next.map(i => [i.id, i]));

  const toInsert = [];
  const toUpdate = [];
  const toDelete = [];

  for (const [id, item] of nextById) {
    const old = prevById.get(id);
    if (!old) {
      toInsert.push({ ...toDb(item), id, user_id: userId });
    } else if (!shallowEqual(old, item)) {
      toUpdate.push({ id, row: toDb(item) });
    }
  }
  for (const [id] of prevById) {
    if (!nextById.has(id)) toDelete.push(id);
  }

  if (toInsert.length) {
    supabase.from(table).insert(toInsert).then(({ error }) => {
      if (error) console.error(`[${table}] insert failed:`, error);
    });
  }
  toUpdate.forEach(({ id, row }) => {
    supabase.from(table).update(row).eq("id", id).then(({ error }) => {
      if (error) console.error(`[${table}] update ${id} failed:`, error);
    });
  });
  if (toDelete.length) {
    supabase.from(table).delete().in("id", toDelete).then(({ error }) => {
      if (error) console.error(`[${table}] delete failed:`, error);
    });
  }
}

function shallowEqual(a, b) {
  if (a === b) return true;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}
