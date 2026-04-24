// Hook for user-authored recipes — custom-builder and AI-drafted.
//
// Reads every user_recipes row the viewer can SELECT under migration
// 0052's private-by-default RLS — that's the viewer's own rows, plus
// any family recipe with shared=true, plus (for admins) anything in
// the review queue. Exposes:
//
//   recipes        — array of { id, userId, slug, source, recipe,
//                    shared, submittedForReview, reviewStatus,
//                    createdAt, updatedAt } where `recipe` is the
//                    full schema-matching object that CookMode /
//                    findRecipe / suggestMeals can consume.
//   loading        — boolean
//   error          — string | null
//   saveRecipe(recipe, source, opts?) — write a new row. opts is
//                    { shared?, submitForReview? }. submitForReview
//                    also stamps review_status='pending'.
//                    Returns the inserted row.
//   setSharing(id, opts)              — UPDATE an existing row's
//                    { shared?, submitForReview? } — used when the
//                    user schedules a private recipe (scheduling
//                    implies sharing) or from a future library edit
//                    surface.
//   deleteRecipe(id)                  — remove by id (author-only).
//   findBySlug(slug)                  — local lookup for findRecipe().
//   adminList()                       — refresh and return every row
//                    currently in the review queue. Admin-only via
//                    RLS; non-admins get an empty array back.
//   adminDecide(id, { status })       — set review_status +
//                    submitted_for_review=false. Admin-only via RLS.
//
// Realtime: subscribes to user_recipes so a family member's addition
// or an admin's approval shows up without a reload.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";

function fromDb(row) {
  return {
    id:                  row.id,
    userId:              row.user_id,
    slug:                row.slug,
    source:              row.source,
    recipe:              row.recipe || {},
    shared:              row.shared === true,
    submittedForReview:  row.submitted_for_review === true,
    reviewStatus:        row.review_status || null,
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
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
          // MERGE — don't wholesale-replace. Supabase's UPDATE payloads
          // CAN land with a missing `recipe` column (TOAST-ed jsonb not
          // replicated, or partial-column replication under some
          // configs), and we previously rebuilt state from payload.new
          // alone — which wiped title, ingredients, steps, emoji,
          // everything on any setSharing flip. Keep incoming scalars
          // where they're defined (shared, submitted_for_review, etc.)
          // but preserve the existing `recipe` JSON when the incoming
          // one is falsy or empty. Same defensive principle for slug
          // and source — scalar columns that shouldn't blank under
          // any realistic update but are cheap to guard.
          const incoming = fromDb(payload.new);
          apply(prev => prev.map(r => {
            if (r.id !== incoming.id) return r;
            const mergedRecipe =
              incoming.recipe && Object.keys(incoming.recipe).length > 0
                ? incoming.recipe
                : r.recipe;
            return {
              ...r,
              ...incoming,
              recipe: mergedRecipe,
              slug:   incoming.slug   || r.slug,
              source: incoming.source || r.source,
              userId: incoming.userId || r.userId,
            };
          }));
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

  const saveRecipe = useCallback(async (recipe, source = "custom", opts = {}) => {
    if (!userId)  throw new Error("not signed in");
    if (!recipe)  throw new Error("recipe required");
    const baseSlug = recipe.slug || recipe.title || "recipe";
    const slug = uniqueSlugFor(baseSlug);
    const stampedRecipe = { ...recipe, slug };
    // submitForReview is offered for CUSTOM recipes only (the UI gates
    // this) but the hook stays permissive — the DB check constraint
    // enforces the source vocabulary and RLS takes care of visibility.
    const submitForReview = !!opts.submitForReview;
    const row = {
      user_id: userId,
      slug,
      source,
      recipe: stampedRecipe,
      shared: !!opts.shared,
      submitted_for_review: submitForReview,
      review_status: submitForReview ? "pending" : null,
    };
    const { data, error: err } = await supabase
      .from("user_recipes")
      .insert(row)
      .select()
      .single();
    if (err) {
      console.error("[user_recipes] save failed:", err);
      throw new Error(err.message || "save failed");
    }

    // XP: +50 for a substantive user-authored recipe. Anti-spam gate:
    // ≥3 steps AND ≥3 ingredients. AI-generated saves ('ai' source)
    // are excluded — the user didn't author those. Fires only on the
    // first save of a given slug (insert already hit conflict on
    // unique(user_id,slug) if re-saved — insert path guarantees
    // first-time here).
    const stepCount = Array.isArray(stampedRecipe.steps) ? stampedRecipe.steps.length : 0;
    const ingCount  = Array.isArray(stampedRecipe.ingredients) ? stampedRecipe.ingredients.length : 0;
    if (source === "custom" && stepCount >= 3 && ingCount >= 3 && data?.id) {
      supabase
        .rpc("award_xp", {
          p_user_id:   userId,
          p_source:    "authored_recipe",
          p_ref_table: "user_recipes",
          p_ref_id:    data.id,
        })
        .then(({ error: xpErr }) => {
          if (xpErr) console.error("[award_xp] authored_recipe failed:", xpErr);
        });
    }

    return fromDb(data);
  }, [userId, uniqueSlugFor]);

  // Toggle sharing / submission flags on an already-saved row. Used by
  // the schedule flow (scheduling implies shared=true) and — later —
  // by a library-edit surface. Scoped to the viewer's own rows via
  // RLS; the optimistic update is safe because a rejected write just
  // gets overwritten by the realtime UPDATE event.
  const setSharing = useCallback(async (id, { shared, submitForReview } = {}) => {
    const patch = {};
    if (typeof shared === "boolean") patch.shared = shared;
    if (typeof submitForReview === "boolean") {
      patch.submitted_for_review = submitForReview;
      if (submitForReview) patch.review_status = "pending";
    }
    if (Object.keys(patch).length === 0) return;
    // Optimistic local update BEFORE the round-trip. Two reasons:
    //   1. The UI pill flips immediately — no waiting for realtime.
    //   2. If realtime ever drops a partial UPDATE payload (see the
    //      merge guard in the subscribe handler), the local state
    //      already carries the right value for this specific flip,
    //      so a buggy realtime replay can't roll us back.
    const prevSnapshot = { shared: undefined, submitted_for_review: undefined, review_status: undefined };
    setRecipes(prev => prev.map(r => {
      if (r.id !== id) return r;
      prevSnapshot.shared = r.shared;
      prevSnapshot.submitted_for_review = r.submittedForReview;
      prevSnapshot.review_status = r.reviewStatus;
      const next = { ...r };
      if (typeof shared === "boolean") next.shared = shared;
      if (typeof submitForReview === "boolean") {
        next.submittedForReview = submitForReview;
        if (submitForReview) next.reviewStatus = "pending";
      }
      return next;
    }));
    const { error: err } = await supabase
      .from("user_recipes")
      .update(patch)
      .eq("id", id);
    if (err) {
      // Roll back the optimistic update so the UI doesn't lie about
      // a share that the server rejected.
      setRecipes(prev => prev.map(r => r.id === id ? {
        ...r,
        shared: prevSnapshot.shared,
        submittedForReview: prevSnapshot.submitted_for_review,
        reviewStatus: prevSnapshot.review_status,
      } : r));
      console.error("[user_recipes] setSharing failed:", err);
      throw new Error(err.message || "update failed");
    }
  }, []);

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

  // Admin-only queue reader. Non-admins get an empty list back — RLS
  // filters the select, so the client doesn't need to know whether
  // the caller is an admin.
  const adminList = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("user_recipes")
      .select("*")
      .eq("submitted_for_review", true)
      .is("review_status", "pending")
      .order("created_at", { ascending: false });
    if (err) {
      console.error("[user_recipes] adminList failed:", err);
      throw new Error(err.message || "admin list failed");
    }
    return (data || []).map(fromDb);
  }, []);

  // Approve / reject a pending submission. Flipping submitted_for_review
  // to false drops the row out of admin SELECT scope — follow-up edits
  // would need a fresh submission from the author.
  const adminDecide = useCallback(async (id, { status }) => {
    if (!["approved", "rejected"].includes(status)) {
      throw new Error(`invalid review status: ${status}`);
    }
    const { error: err } = await supabase
      .from("user_recipes")
      .update({ review_status: status, submitted_for_review: false })
      .eq("id", id);
    if (err) {
      console.error("[user_recipes] adminDecide failed:", err);
      throw new Error(err.message || "review update failed");
    }
  }, []);

  // Local lookup by slug across every row the viewer can see.
  // findRecipe() in src/data/recipes/index.js checks bundled first;
  // this is the fallback call path for user-authored recipes.
  //
  // Two family members can each author a recipe with the same slug —
  // useUserRecipes loads self + family rows (migration 0052 RLS), so a
  // naive slug→recipe Map collapsed to whichever row landed last and
  // silently swapped one person's recipe for another's at cook time
  // (migration 0139 header has the full writeup). Index by a
  // composite (ownerUserId, slug) key instead, and resolve with an
  // explicit owner hint when the caller knows whose recipe was
  // picked. When the hint is absent, prefer the viewer's own row
  // (the legacy behavior that keeps pre-0139 scheduled meals pointing
  // at self), then fall back to any visible row with that slug.
  const recipesIndex = useMemo(() => {
    const byOwner = new Map();  // `${ownerId}:${slug}` → recipe
    const bySlug  = new Map();  // slug → recipe (first-seen wins; only used when no owner hint)
    const selfBySlug = new Map();
    for (const r of recipes) {
      byOwner.set(`${r.userId}:${r.slug}`, r.recipe);
      if (r.userId === userId) selfBySlug.set(r.slug, r.recipe);
      else if (!bySlug.has(r.slug)) bySlug.set(r.slug, r.recipe);
    }
    return { byOwner, bySlug, selfBySlug };
  }, [recipes, userId]);
  const findBySlug = useCallback((slug, ownerUserId) => {
    if (ownerUserId) {
      return recipesIndex.byOwner.get(`${ownerUserId}:${slug}`) || null;
    }
    return recipesIndex.selfBySlug.get(slug)
        || recipesIndex.bySlug.get(slug)
        || null;
  }, [recipesIndex]);

  return {
    recipes, loading, error,
    saveRecipe, setSharing, deleteRecipe,
    findBySlug,
    adminList, adminDecide,
  };
}
