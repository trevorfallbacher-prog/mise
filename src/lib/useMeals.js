// Hook for composed MEALs — bundles of recipes cooked together.
//
// A MEAL is a pure pointer-set (see migration 0064_meals.sql): the
// meal row carries identity (name, emoji, cuisine, mealTiming,
// anchor_slug) and the meal_recipes join table pins recipes into
// the meal with a course role. Recipes themselves stay atomic in
// user_recipes — deleting a meal never cascades to its pieces.
//
// Exposes:
//   meals        — hydrated array of { id, name, emoji, cuisine,
//                  mealTiming, anchorSlug, createdAt, pieces: [{
//                    course, recipeSlug, sortOrder, recipe?, source?
//                  }] } sorted newest-first. `recipe` is the resolved
//                  schema-matching object (from user_recipes or bundled
//                  RECIPES); `source` is "user" | "bundled" | null when
//                  the slug resolves nowhere.
//   loading      — boolean
//   error        — string | null
//   createMeal({ name, emoji, cuisine, mealTiming, anchorSlug, pieces })
//                  — inserts a meal row + N meal_recipes rows. Returns
//                  the hydrated meal.
//   deleteMeal(id) — removes the meal (cascades to meal_recipes via
//                  the FK). Pieces stay in user_recipes.
//   findById(id) / findByAnchor(slug) — local helpers.
//
// Realtime: subscribes to both tables so a family member's new meal or
// an updated piece list shows up without a reload.
//
// Resolution: the caller passes in `userRecipes` (from useUserRecipes)
// and bundled `RECIPES` so pieces hydrate to full recipe objects. The
// hook doesn't fetch those itself — that keeps a single source of
// truth and avoids a duplicate subscription.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";

function fromMealRow(row) {
  return {
    id:          row.id,
    userId:      row.user_id,
    name:        row.name,
    emoji:       row.emoji || null,
    cuisine:     row.cuisine || null,
    mealTiming:  row.meal_timing || null,
    anchorSlug:  row.anchor_slug || null,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}
function fromPieceRow(row) {
  return {
    mealId:      row.meal_id,
    recipeSlug:  row.recipe_slug,
    course:      row.course,
    sortOrder:   row.sort_order ?? 0,
  };
}

export function useMeals(userId, { userRecipes = [], bundledRecipes = [] } = {}) {
  const [mealRows,  setMealRows]  = useState([]);   // meals table rows
  const [pieceRows, setPieceRows] = useState([]);   // meal_recipes rows
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  // Initial load — pulls every meal + every piece the viewer can SELECT
  // under the migration's RLS (self + accepted family). Two queries is
  // fine; the hydration step happens client-side in useMemo below.
  useEffect(() => {
    let alive = true;
    if (!userId) {
      setMealRows([]);
      setPieceRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const [mealsRes, piecesRes] = await Promise.all([
        supabase.from("meals").select("*").order("created_at", { ascending: false }),
        supabase.from("meal_recipes").select("*").order("sort_order", { ascending: true }),
      ]);
      if (!alive) return;
      const err = mealsRes.error || piecesRes.error;
      if (err) {
        console.error("[meals] load failed:", err);
        setError(err.message || "load failed");
        setMealRows([]);
        setPieceRows([]);
      } else {
        setMealRows((mealsRes.data  || []).map(fromMealRow));
        setPieceRows((piecesRes.data || []).map(fromPieceRow));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  // Realtime — mirror the useUserRecipes pattern. Two channels so an
  // INSERT on meal_recipes doesn't wait for the meals subscription to
  // process. The refs avoid stale-closure setState in the handlers.
  const setMealRowsRef  = useRef(setMealRows);
  const setPieceRowsRef = useRef(setPieceRows);
  useEffect(() => { setMealRowsRef.current  = setMealRows;  }, []);
  useEffect(() => { setPieceRowsRef.current = setPieceRows; }, []);
  useEffect(() => {
    if (!userId) return;
    const mealsCh = safeChannel(`rt:meals:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "meals" }, (payload) => {
        const apply = setMealRowsRef.current;
        if (payload.eventType === "INSERT") {
          const row = fromMealRow(payload.new);
          apply(prev => prev.some(r => r.id === row.id) ? prev : [row, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          const row = fromMealRow(payload.new);
          apply(prev => prev.map(r => r.id === row.id ? row : r));
        } else if (payload.eventType === "DELETE") {
          const id = payload.old?.id;
          if (!id) return;
          apply(prev => prev.filter(r => r.id !== id));
        }
      })
      .subscribe();
    const piecesCh = safeChannel(`rt:meal_recipes:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "meal_recipes" }, (payload) => {
        const apply = setPieceRowsRef.current;
        if (payload.eventType === "INSERT") {
          const row = fromPieceRow(payload.new);
          apply(prev => {
            // Composite key is (meal_id, recipe_slug) — dedupe on both.
            if (prev.some(p => p.mealId === row.mealId && p.recipeSlug === row.recipeSlug)) return prev;
            return [...prev, row];
          });
        } else if (payload.eventType === "UPDATE") {
          const row = fromPieceRow(payload.new);
          apply(prev => prev.map(p => (
            p.mealId === row.mealId && p.recipeSlug === row.recipeSlug ? row : p
          )));
        } else if (payload.eventType === "DELETE") {
          const o = payload.old;
          if (!o) return;
          apply(prev => prev.filter(p => !(p.mealId === o.meal_id && p.recipeSlug === o.recipe_slug)));
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(mealsCh);
      supabase.removeChannel(piecesCh);
    };
  }, [userId]);

  // Slug → recipe resolver. Built once per userRecipes / bundledRecipes
  // change and reused for every meal's hydration. User recipes take
  // precedence over bundled when slugs collide (shouldn't happen
  // today — uniqueSlugFor in useUserRecipes dedupes — but safer).
  const resolver = useMemo(() => {
    const map = new Map();
    (bundledRecipes || []).forEach((r) => {
      if (r?.slug) map.set(r.slug, { recipe: r, source: "bundled" });
    });
    (userRecipes || []).forEach((ur) => {
      if (ur?.recipe?.slug) map.set(ur.recipe.slug, { recipe: ur.recipe, source: ur.source || "user" });
    });
    return map;
  }, [userRecipes, bundledRecipes]);

  // Hydrated meal objects — piece list attached, each piece's recipe
  // resolved from the resolver. Pieces with no matching slug keep
  // recipe=null so the UI can render a "missing" state rather than
  // crashing on a deleted upstream recipe.
  const meals = useMemo(() => {
    const piecesByMealId = new Map();
    pieceRows.forEach((p) => {
      if (!piecesByMealId.has(p.mealId)) piecesByMealId.set(p.mealId, []);
      piecesByMealId.get(p.mealId).push(p);
    });
    return mealRows.map((m) => {
      const rawPieces = (piecesByMealId.get(m.id) || [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const pieces = rawPieces.map((p) => {
        const resolved = resolver.get(p.recipeSlug);
        return {
          course:     p.course,
          recipeSlug: p.recipeSlug,
          sortOrder:  p.sortOrder,
          recipe:     resolved?.recipe || null,
          source:     resolved?.source || null,
        };
      });
      return { ...m, pieces };
    });
  }, [mealRows, pieceRows, resolver]);

  // createMeal — atomic-ish: insert the meal row first, grab its id,
  // then insert every meal_recipes row in one shot. If the pieces
  // insert fails we delete the orphaned meal row so the user doesn't
  // see an empty meal in the library.
  const createMeal = useCallback(async ({
    name,
    emoji       = null,
    cuisine     = null,
    mealTiming  = null,
    anchorSlug  = null,
    pieces      = [],
  }) => {
    if (!userId) throw new Error("not signed in");
    if (!name?.trim()) throw new Error("meal name required");
    if (!Array.isArray(pieces) || pieces.length === 0) {
      throw new Error("meal needs at least one piece");
    }
    const { data: mealRow, error: mealErr } = await supabase
      .from("meals")
      .insert({
        user_id:     userId,
        name:        name.trim(),
        emoji:       emoji || null,
        cuisine:     cuisine || null,
        meal_timing: mealTiming || null,
        anchor_slug: anchorSlug || null,
      })
      .select()
      .single();
    if (mealErr) {
      console.error("[meals] createMeal meal insert failed:", mealErr);
      throw new Error(mealErr.message || "create failed");
    }
    // Build piece rows. Dedupe on slug since the composite PK would
    // reject a duplicate anyway — better to drop the dupe client-side
    // with a clear log than to let the batch 409.
    const seen = new Set();
    const pieceRowsToInsert = pieces
      .filter((p) => {
        if (!p?.recipeSlug) return false;
        if (seen.has(p.recipeSlug)) {
          console.warn("[meals] createMeal dropping duplicate piece slug:", p.recipeSlug);
          return false;
        }
        seen.add(p.recipeSlug);
        return true;
      })
      .map((p, i) => ({
        meal_id:     mealRow.id,
        recipe_slug: p.recipeSlug,
        course:      p.course || "main",
        sort_order:  typeof p.sortOrder === "number" ? p.sortOrder : i,
      }));
    const { error: piecesErr } = await supabase
      .from("meal_recipes")
      .insert(pieceRowsToInsert);
    if (piecesErr) {
      console.error("[meals] createMeal pieces insert failed — rolling back meal row:", piecesErr);
      await supabase.from("meals").delete().eq("id", mealRow.id);
      throw new Error(piecesErr.message || "create pieces failed");
    }
    return fromMealRow(mealRow);
  }, [userId]);

  const deleteMeal = useCallback(async (id) => {
    const { error: err } = await supabase
      .from("meals")
      .delete()
      .eq("id", id);
    if (err) {
      console.error("[meals] deleteMeal failed:", err);
      throw new Error(err.message || "delete failed");
    }
  }, []);

  const mealsById = useMemo(() => {
    const m = new Map();
    meals.forEach((mm) => m.set(mm.id, mm));
    return m;
  }, [meals]);

  const findById       = useCallback((id)   => mealsById.get(id) || null, [mealsById]);
  const findByAnchor   = useCallback((slug) => meals.find(m => m.anchorSlug === slug) || null, [meals]);

  return {
    meals,
    loading,
    error,
    createMeal,
    deleteMeal,
    findById,
    findByAnchor,
  };
}
