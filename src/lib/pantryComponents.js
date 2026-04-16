import { supabase } from "./supabase";
import { findIngredient } from "../data/ingredients";

/**
 * Component-tree helpers for the Meal/Ingredient tier model (migration
 * 0034). A Meal-kind pantry item has one or more Components; each
 * Component is a row in pantry_item_components pointing to either a
 * canonical Ingredient (child_kind='ingredient') or another pantry
 * item (child_kind='item' — recursive).
 *
 * The client owns three responsibilities around this table:
 *
 *   1. Delete-and-replace the component list when the user re-commits
 *      LinkIngredient's DONE. Diffing would be fractionally faster but
 *      components are small (typically <10, never >30) and the user
 *      has already waited on a modal transition; the simpler write path
 *      is worth the few extra DB roundtrips.
 *
 *   2. Keep pantry_items.ingredient_ids[] in sync as the flattened
 *      union of leaf canonical ids. That array is the recipe matcher's
 *      hot path (GIN-indexed from 0033) so it has to stay correct as
 *      components change. For ingredient-only children this is just
 *      ids.slice(); once sub-meal pointers land we'll walk the tree.
 *
 *   3. Refuse cycle-creating inserts. A Meal can't contain itself as
 *      a component, directly or transitively. Enforced here, not in
 *      SQL — keeps insert latency flat and cycle detection is linear
 *      in tree depth (practically always <5 levels).
 */

/**
 * Wipe all components on a parent, then insert the supplied set.
 * Returns { error } matching Supabase's shape so callers can surface
 * write failures. Non-fatal: the parent item row still gets its
 * kind / ingredient_ids update independently, and a retry on the
 * components table later recovers the structured truth.
 *
 *   components: [{
 *     kind: 'ingredient' | 'item',
 *     ingredientId?:   string,   // set when kind='ingredient'
 *     itemId?:         uuid,     // set when kind='item'
 *     amount?:         number,
 *     unit?:           string,
 *     proportion?:     number,   // 0..1 fraction of source consumed
 *     nameSnapshot:    string,
 *     ingredientIdsSnapshot?: string[],
 *     position?:       number,
 *   }]
 */
export async function setComponentsForParent(parentItemId, components) {
  if (!parentItemId) {
    return { error: new Error("parentItemId is required") };
  }

  // 1) Wipe the existing component set. ON DELETE SET NULL on any
  //    grand-parent rows that pointed to these is fine — the snapshot
  //    columns on their rows preserve history either way.
  const { error: delErr } = await supabase
    .from("pantry_item_components")
    .delete()
    .eq("parent_item_id", parentItemId);
  if (delErr) {
    console.error("[pantry_item_components] delete failed:", delErr);
    return { error: delErr };
  }

  if (!components || components.length === 0) {
    return { error: null };
  }

  // 2) Serialize + insert. Position defaults to array index so callers
  //    that don't care about ordering get stable insertion order.
  const rows = components.map((c, idx) => ({
    parent_item_id: parentItemId,
    child_kind: c.kind,
    child_ingredient_id: c.kind === "ingredient" ? (c.ingredientId || null) : null,
    child_item_id:       c.kind === "item"       ? (c.itemId       || null) : null,
    amount:     c.amount     ?? null,
    unit:       c.unit       ?? null,
    proportion: c.proportion ?? null,
    name_snapshot: c.nameSnapshot || "",
    ingredient_ids_snapshot: Array.isArray(c.ingredientIdsSnapshot)
      ? c.ingredientIdsSnapshot
      : [],
    position: c.position ?? idx,
  }));

  // Retry loop for the foreign-key race. useSyncedList's persistDiff
  // fires pantry_items INSERTs fire-and-forget, so when a caller
  // creates a new parent item and *immediately* writes its components
  // (CookComplete's leftover-Meal path, scan-confirm in a future
  // chunk), the component INSERT can beat the parent INSERT to the
  // server and fail with a 23503 FK violation. Back off and retry a
  // few times — the parent row lands within tens of ms in practice.
  //
  // Non-FK errors fail immediately. Any caller that wrote a component
  // to a truly nonexistent parent is a logic bug; we want the error
  // loud, not swallowed behind silent retries.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error: insErr } = await supabase
      .from("pantry_item_components")
      .insert(rows);
    if (!insErr) return { error: null };
    const isFkRace = insErr.code === "23503";
    if (!isFkRace || attempt === 3) {
      console.error("[pantry_item_components] insert failed:", insErr);
      return { error: insErr };
    }
    // Exponential-ish backoff: 150, 300, 450ms. Total worst case <1s.
    await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
  }
  return { error: null };
}

/**
 * Build a component array from a flat list of canonical ingredient ids.
 * Used by LinkIngredient when the user commits 2+ tags — each tag
 * becomes one ingredient-kind component row.
 *
 * Name + id snapshots are filled from the bundled INGREDIENTS registry
 * so a later registry rename doesn't orphan the component's display.
 * Ids that don't resolve are skipped (defensive; shouldn't happen in
 * practice since LinkIngredient only surfaces registered canonicals).
 */
export function componentsFromIngredientIds(ids) {
  const out = [];
  (ids || []).forEach((id, idx) => {
    if (!id) return;
    const canon = findIngredient(id);
    if (!canon) return;
    out.push({
      kind: "ingredient",
      ingredientId: id,
      nameSnapshot: canon.name || id,
      ingredientIdsSnapshot: [id],
      position: idx,
    });
  });
  return out;
}

/**
 * Promote-or-demote heuristic used everywhere linking happens. Two or
 * more canonical tags = the item is a composed Meal; one or zero tags
 * = an atomic Ingredient (or un-linked free-text when zero). Keeps
 * every caller's promotion logic identical without each one
 * re-implementing the rule.
 */
export function kindForTagCount(count) {
  return count >= 2 ? "meal" : "ingredient";
}

/**
 * Translate a CookComplete removal-plan entry into the component shape
 * used by setComponentsForParent. The entry describes one consumed
 * pantry row; the component it generates describes how that row fed
 * into the leftover Meal that's being created.
 *
 * Component kind derivation:
 *   * Consumed row is kind='meal'       -> child_kind='item'
 *                                          (sub-meal pointer; nested tree)
 *   * Consumed row is kind='ingredient' -> child_kind='ingredient'
 *     AND has a canonical id              (canonical ref, more stable
 *                                          than the item id which may
 *                                          clear from the pantry)
 *   * Consumed row is free-text          -> null (skipped)
 *     (no ingredientId, kind='ingredient'   The components table's check
 *      OR undefined kind)                  constraint requires a non-null
 *                                          child identifier for its kind,
 *                                          and free-text rows can't
 *                                          satisfy either. Name snapshot
 *                                          alone isn't enough; we lose
 *                                          tree-walking integrity. These
 *                                          consumed items still show up
 *                                          in the cook log's "used these"
 *                                          history, just not as tree
 *                                          components on the leftover.
 *
 * Proportion: derived from the row's pre-cook / post-cook amount when
 * both are known. Falls back to null when the decrement is non-convertible
 * (unit mismatch) or when the pre-cook amount is zero.
 *
 * Returns one component-shape object, or null when the entry can't
 * be represented as a component.
 */
export function componentFromRemovalEntry(entry, position = 0) {
  if (!entry || !entry.pantryRow) return null;
  const row = entry.pantryRow;
  const rowKind = row.kind || "ingredient";

  const preCook  = Number(row.amount);
  const postCook = Number(entry.newAmount);
  const proportion = (
    Number.isFinite(preCook) && Number.isFinite(postCook)
    && preCook > 0 && postCook <= preCook
  )
    ? Math.min(1, Math.max(0, (preCook - postCook) / preCook))
    : null;

  const rowIngredientIds = Array.isArray(row.ingredientIds) && row.ingredientIds.length
    ? row.ingredientIds
    : (row.ingredientId ? [row.ingredientId] : []);

  const shared = {
    amount: entry.used?.amount ?? null,
    unit:   entry.used?.unit   ?? null,
    proportion,
    nameSnapshot: row.name || "",
    ingredientIdsSnapshot: rowIngredientIds,
    position,
  };

  if (rowKind === "meal") {
    return { ...shared, kind: "item", itemId: row.id };
  }
  if (row.ingredientId) {
    return { ...shared, kind: "ingredient", ingredientId: row.ingredientId };
  }
  return null; // free-text, un-representable in the tree
}

/**
 * Build the component list AND the flattened ingredient_ids[] union for
 * a leftover Meal from a CookComplete removal plan.
 *
 * The flattened array is what pantry_items.ingredient_ids[] needs to be
 * set to so the recipe matcher's GIN index still finds this leftover
 * for any recipe calling for any of its component ingredients. Union
 * is computed by expanding each removal entry's pantryRow.ingredientIds
 * (or falling back to ingredientId) — for sub-meal components this
 * already contains the deep flatten from when *that* meal was created,
 * so we get transitive coverage for free.
 *
 * Returns { components: [...], flatIngredientIds: [...] }.
 */
export function leftoverCompositionFromPlan(plan) {
  const components = [];
  const flatSet = new Set();
  (plan || []).forEach((entry) => {
    const comp = componentFromRemovalEntry(entry, components.length);
    if (comp) components.push(comp);
    // Flat-ids union uses the full snapshot regardless of whether the
    // component could be represented, so free-text rows still
    // contribute their canonical tag if they had one at some point.
    const row = entry?.pantryRow;
    if (!row) return;
    const rowIngredientIds = Array.isArray(row.ingredientIds) && row.ingredientIds.length
      ? row.ingredientIds
      : (row.ingredientId ? [row.ingredientId] : []);
    for (const id of rowIngredientIds) {
      if (id) flatSet.add(id);
    }
  });
  return { components, flatIngredientIds: [...flatSet] };
}

/**
 * Check whether inserting `candidateChildId` as a component of
 * `parentId` would create a cycle. Walks downward from the candidate:
 * if we ever reach the parent, a loop exists.
 *
 * Implemented as a depth-first walk over pantry_item_components rows
 * with child_kind='item'. Cheap in practice — a Meal's own tree is
 * rarely deeper than 5 levels — and runs only at user-intent moments
 * (Link modal DONE, component re-order), not on every render.
 *
 * Returns true when inserting is SAFE (no cycle), false when it would
 * create one.
 */
export async function canAddItemComponent(parentId, candidateChildId) {
  if (!parentId || !candidateChildId) return false;
  if (parentId === candidateChildId) return false;

  // BFS downward from the candidate. Stop if we hit the parent.
  const seen = new Set([candidateChildId]);
  let frontier = [candidateChildId];
  // Hard safety cap — pathological tree would hit this, but realistic
  // trees are <5 deep. Bails loudly so we notice if it ever matters.
  for (let depth = 0; depth < 20 && frontier.length > 0; depth++) {
    const { data, error } = await supabase
      .from("pantry_item_components")
      .select("child_item_id")
      .in("parent_item_id", frontier)
      .eq("child_kind", "item")
      .not("child_item_id", "is", null);
    if (error) {
      console.error("[pantry_item_components] cycle check failed:", error);
      // Fail closed: better to reject a legitimate insert than to
      // permit a loop that will lock up the tree-walker later.
      return false;
    }
    const nextFrontier = [];
    for (const row of data || []) {
      const id = row.child_item_id;
      if (!id || seen.has(id)) continue;
      if (id === parentId) return false; // cycle
      seen.add(id);
      nextFrontier.push(id);
    }
    frontier = nextFrontier;
  }
  return true;
}
