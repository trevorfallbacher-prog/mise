import { useEffect, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";

/**
 * Read the Components tree of a single pantry item.
 *
 * Returns [components, loading] where components is an array of
 * component objects (camelCase, client-side shape):
 *
 *   {
 *     id: uuid,
 *     parentItemId: uuid,
 *     childKind: 'ingredient' | 'item',
 *     childIngredientId?: string,
 *     childItemId?: uuid,
 *     amount?: number,
 *     unit?: string,
 *     proportion?: number,
 *     nameSnapshot: string,
 *     ingredientIdsSnapshot: string[],
 *     position: number,
 *     createdAt: Date,
 *   }
 *
 * Sorted by position ASC, createdAt ASC as tiebreaker.
 *
 * Realtime: subscribes to pantry_item_components changes filtered by
 * parent_item_id so the tree updates live when a family member
 * re-links or re-composes the Meal. Unsubscribes on id change or
 * unmount; no leaks on fast drill-down between cards.
 *
 * itemId: pass null / undefined to short-circuit (returns [] / false).
 * Useful for conditionally rendering the section on Meal items only
 * without wrapping every call site in a ternary.
 */
export function useItemComponents(itemId) {
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(false);

  // Keep the current itemId in a ref so the realtime handler can
  // safely early-return if the user drilled away before the event
  // arrived. Avoids a race where a stale event populates the new
  // card with the wrong tree.
  const currentIdRef = useRef(itemId);
  useEffect(() => { currentIdRef.current = itemId; }, [itemId]);

  useEffect(() => {
    if (!itemId) {
      setComponents([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("pantry_item_components")
        .select("*")
        .eq("parent_item_id", itemId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (!alive) return;
      if (error) {
        console.error("[pantry_item_components] load failed:", error);
        setComponents([]);
      } else {
        setComponents((data || []).map(fromDb));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [itemId]);

  useEffect(() => {
    if (!itemId) return;
    const ch = safeChannel(`rt:pantry_item_components:${itemId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pantry_item_components",
          filter: `parent_item_id=eq.${itemId}`,
        },
        (payload) => {
          if (currentIdRef.current !== itemId) return;
          const newRow = payload.new && Object.keys(payload.new).length ? fromDb(payload.new) : null;
          const oldId  = payload.old?.id;
          setComponents(prev => {
            if (payload.eventType === "INSERT") {
              if (prev.some(c => c.id === newRow.id)) return prev;
              return [...prev, newRow].sort(sortComponents);
            }
            if (payload.eventType === "UPDATE") {
              if (!prev.some(c => c.id === newRow.id)) {
                return [...prev, newRow].sort(sortComponents);
              }
              return prev.map(c => c.id === newRow.id ? newRow : c).sort(sortComponents);
            }
            if (payload.eventType === "DELETE") {
              if (!oldId) return prev;
              return prev.filter(c => c.id !== oldId);
            }
            return prev;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [itemId]);

  return [components, loading];
}

function fromDb(row) {
  return {
    id: row.id,
    parentItemId: row.parent_item_id,
    childKind: row.child_kind,
    childIngredientId: row.child_ingredient_id || null,
    childItemId: row.child_item_id || null,
    amount: row.amount != null ? Number(row.amount) : null,
    unit: row.unit || null,
    proportion: row.proportion != null ? Number(row.proportion) : null,
    nameSnapshot: row.name_snapshot || "",
    ingredientIdsSnapshot: Array.isArray(row.ingredient_ids_snapshot)
      ? row.ingredient_ids_snapshot
      : [],
    position: row.position ?? 0,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  };
}

function sortComponents(a, b) {
  if (a.position !== b.position) return a.position - b.position;
  const at = a.createdAt ? a.createdAt.getTime() : 0;
  const bt = b.createdAt ? b.createdAt.getTime() : 0;
  return at - bt;
}
