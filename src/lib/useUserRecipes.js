// Hook for user-authored recipes — custom-builder and AI-drafted.
//
// Reads every user_recipes row the viewer can SELECT (self + accepted
// family, per migration 0051 RLS). Exposes:
//
//   recipes    — array of { id, userId, slug, source, recipe, createdAt, updatedAt }
//                where `recipe` is the full schema-matching object that
//                CookMode / findRecipe / suggestMeals can consume.
//   loading    — boolean
//   error      — string | null
//   saveRecipe(recipe, source)    — write to DB. Returns the inserted row.
//                                   source is "custom" | "ai".
//   deleteRecipe(id)              — remove by id (author-only via RLS).
//   findBySlug(slug)              — local convenience lookup.
//
// Realtime: subscribes to user_recipes so a family member's addition
// shows up without a reload.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";

function fromDb(row) {
  return {
    id:        row.id,
    userId:    row.user_id,
    slug:      row.slug,
    source:    row.source,
    recipe:    row.recipe || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function useUserRecipes(userId) {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Initial load — pulls everything the viewer can see (self + family).
  useEffect(() => {
    let alive = true;
    if (!userId) {
      setRecipes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const { data, error: err } = await supabase
        .from("user_recipes")
        .select("*")
        .order("created_at", { ascending: false });
      if (!alive) return;
      if (err) {
        console.error("[user_recipes] load failed:", err);
        setError(err.message || "load failed");
        setRecipes([]);
      } else {
        setRecipes((data || []).map(fromDb));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  // Realtime — keep the list in sync with inserts/updates/deletes from
  // self OR family. Scoped by userId in the channel name so two tabs
  // don't step on each other.
  const setRecipesRef = useRef(setRecipes);
  useEffect(() => { setRecipesRef.current = setRecipes; }, []);
  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:user_recipes:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_recipes" }, (payload) => {
        const apply = setRecipesRef.current;
        if (payload.eventType === "INSERT") {
          const row = fromDb(payload.new);
          apply(prev => prev.some(r => r.id === row.id) ? prev : [row, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          const row = fromDb(payload.new);
          apply(prev => prev.map(r => r.id === row.id ? row : r));
        } else if (payload.eventType === "DELETE") {
          const id = payload.old?.id;
          if (!id) return;
          apply(prev => prev.filter(r => r.id !== id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // slugBase → unique slug for THIS user. Ensures we don't collide with
  // a bundled slug or an earlier custom recipe the same user already
  // saved ("my-stir-fry" → "my-stir-fry-2" on the next save).
  const uniqueSlugFor = useCallback((base) => {
    const cleaned = String(base || "recipe")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "recipe";
    const taken = new Set(recipes.filter(r => r.userId === userId).map(r => r.slug));
    if (!taken.has(cleaned)) return cleaned;
    let n = 2;
    while (taken.has(`${cleaned}-${n}`)) n++;
    return `${cleaned}-${n}`;
  }, [recipes, userId]);

  const saveRecipe = useCallback(async (recipe, source = "custom") => {
    if (!userId)   throw new Error("not signed in");
    if (!recipe)  throw new Error("recipe required");
    const baseSlug = recipe.slug || recipe.title || "recipe";
    const slug = uniqueSlugFor(baseSlug);
    const stampedRecipe = { ...recipe, slug };
    const { data, error: err } = await supabase
      .from("user_recipes")
      .insert({
        user_id: userId,
        slug,
        source,
        recipe: stampedRecipe,
      })
      .select()
      .single();
    if (err) {
      console.error("[user_recipes] save failed:", err);
      throw new Error(err.message || "save failed");
    }
    return fromDb(data);
  }, [userId, uniqueSlugFor]);

  const deleteRecipe = useCallback(async (id) => {
    const { error: err } = await supabase
      .from("user_recipes")
      .delete()
      .eq("id", id);
    if (err) {
      console.error("[user_recipes] delete failed:", err);
      throw new Error(err.message || "delete failed");
    }
  }, []);

  // Local lookup by slug across every row the viewer can see.
  // findRecipe() in src/data/recipes/index.js checks bundled first;
  // this is the fallback call path for user-authored recipes.
  const recipesBySlug = useMemo(() => {
    const map = new Map();
    for (const r of recipes) map.set(r.slug, r.recipe);
    return map;
  }, [recipes]);
  const findBySlug = useCallback((slug) => recipesBySlug.get(slug) || null, [recipesBySlug]);

  return { recipes, loading, error, saveRecipe, deleteRecipe, findBySlug };
}
