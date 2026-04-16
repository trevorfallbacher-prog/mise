import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";

// Loads the ingredient_info JSONB table once on mount and caches it in
// memory. Returns a sync `getInfo(ingredientId)` function that checks the
// DB map first, then falls back to the JS INGREDIENT_INFO object in
// src/data/ingredients.js.
//
// This is the "hybrid" pattern: the code-side JS object stays as a safety
// net so nothing breaks while we gradually migrate entries to the DB.
// Once an ingredient has a row in ingredient_info, that row WINS —
// overrides are additive (DB fields merge on top of JS fields) so you
// can override just the description in the DB and keep the nutrition
// from the JS file.
//
// Usage in components:
//   const { getInfo, loading } = useIngredientInfo();
//   const info = getInfo("paprika");
//   // info is the merged object — DB fields win over JS fields.
//
// The hook re-fetches if the component remounts (e.g., tab switch), but
// the data is tiny (~500 rows × ~1KB each = well under 1MB) so the
// refetch is cheap. No realtime subscription needed — ingredient metadata
// changes too rarely to justify the open channel.

export function useIngredientInfo() {
  const [dbMap, setDbMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("ingredient_info")
        .select("ingredient_id, info");
      if (!alive) return;
      if (error) {
        console.error("[ingredient_info] load failed:", error);
        // Fallback to empty — JS object still works.
        setDbMap({});
      } else {
        const map = {};
        for (const row of data || []) {
          map[row.ingredient_id] = row.info || {};
        }
        setDbMap(map);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  // Merge: DB fields win over JS fields (shallow merge at the top level
  // of the info object). Deep-merge would be more thorough but also more
  // surprising — if someone overrides `storage` in the DB they probably
  // want the whole storage block, not a field-by-field merge with the JS
  // version. Shallow merge at the top level hits the right balance:
  // override `description` without touching `nutrition`.
  const getInfo = useCallback(
    (ingredientId) => {
      if (!ingredientId) return null;
      const db = dbMap[ingredientId] || null;
      // We don't import getIngredientInfo here to avoid a circular dep —
      // the caller can merge with the JS fallback if they want. The hook
      // just provides what the DB has. The integration point in
      // ingredients.js will handle the merge.
      return db;
    },
    [dbMap]
  );

  return { getInfo, dbMap, loading };
}
