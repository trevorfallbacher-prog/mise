import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

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
 *   table   — Supabase table name
 *   userId  — the owning user
 *   toDb    — (item) => row, for camelCase → snake_case conversion
 *   fromDb  — (row)  => item, the inverse
 *
 * Returns [items, setItems, loading]
 */
export function useSyncedList({ table, userId, toDb, fromDb }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Initial load
  useEffect(() => {
    let alive = true;
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("user_id", userId);
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
  }, [table, userId, fromDb]);

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
