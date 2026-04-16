import { useSyncedList } from "./useSyncedList";

// Heuristic for "where would I expect this to live by default?" — used for
// rows from older clients that don't yet carry a location, and for inserts
// the UI didn't bother to tag (manual adds usually). Mirrors the SQL
// backfill in migration 0008.
export function defaultLocationForCategory(category) {
  if (category === "frozen") return "freezer";
  if (category === "dairy" || category === "produce" || category === "meat") return "fridge";
  return "pantry";
}

// Database row ↔ app item shape. The only camelCase field we convert is
// lowThreshold ↔ low_threshold.
function fromDb(row) {
  return {
    id: row.id,
    ingredientId: row.ingredient_id || null,
    name: row.name,
    emoji: row.emoji,
    amount: Number(row.amount),
    unit: row.unit,
    max: Number(row.max),
    category: row.category,
    lowThreshold: Number(row.low_threshold),
    // Last-paid unit price, integer cents. Nullable — manual adds have none.
    priceCents: row.price_cents ?? null,
    // Where this physically lives in the kitchen: fridge | pantry | freezer.
    // Older rows pre-migration come back as 'pantry' (the column default).
    location: row.location || defaultLocationForCategory(row.category),
    // Earliest-wins expiration across whatever has been merged into this row.
    // Nullable — rows without storage metadata (free-text, unknown ingredient)
    // carry no date rather than a fabricated one.
    expiresAt:   row.expires_at   ? new Date(row.expires_at)   : null,
    purchasedAt: row.purchased_at ? new Date(row.purchased_at) : null,
    // Phase-2 compound-ingredient / leftovers support (migration 0026).
    // 'ingredient' rows track amount+unit as always; 'meal' rows track
    // servings_remaining instead. source_* columns link a row back to
    // the cook that produced it so the UI can show provenance.
    kind:              row.kind || "ingredient",
    servingsRemaining: row.servings_remaining != null ? Number(row.servings_remaining) : null,
    sourceRecipeSlug:  row.source_recipe_slug || null,
    sourceCookLogId:   row.source_cook_log_id || null,
    // Physical form. Null for ingredients that have no meaningful state
    // distinction (milk, oil). When set, it scopes recipe-to-pantry
    // matching so "crumbs" only satisfies a recipe asking for crumbs.
    // Migration 0027.
    state: row.state || null,
    // Which user owns this row. When you share a pantry with family, their
    // rows come through via the family-select RLS policy; ownerId lets the
    // UI tag them ("+added by Alice") so it's clear who stocked what.
    ownerId: row.user_id,
  };
}

function toDb(item) {
  return {
    ingredient_id: item.ingredientId || null,
    name: item.name,
    emoji: item.emoji,
    amount: item.amount,
    unit: item.unit,
    max: item.max,
    category: item.category,
    low_threshold: item.lowThreshold,
    price_cents: item.priceCents ?? null,
    location: item.location || defaultLocationForCategory(item.category),
    expires_at:   item.expiresAt   ? toIso(item.expiresAt)   : null,
    purchased_at: item.purchasedAt ? toIso(item.purchasedAt) : null,
    // Phase-2 columns — only serialized when present so untouched old
    // callers keep writing exactly the payload they always did.
    ...(item.kind              !== undefined ? { kind: item.kind || "ingredient" } : {}),
    ...(item.servingsRemaining !== undefined ? { servings_remaining: item.servingsRemaining } : {}),
    ...(item.sourceRecipeSlug  !== undefined ? { source_recipe_slug: item.sourceRecipeSlug } : {}),
    ...(item.sourceCookLogId   !== undefined ? { source_cook_log_id: item.sourceCookLogId } : {}),
    ...(item.state             !== undefined ? { state: item.state || null } : {}),
  };
}

// Accept both Date objects and ISO strings — UI merges can produce either.
function toIso(d) {
  if (d instanceof Date) return d.toISOString();
  return d;
}

/**
 * Returns [pantry, setPantry, loading]. `setPantry` has the same signature as
 * `useState`'s setter — all changes are persisted to Supabase behind the scenes.
 *
 * Pass `familyKey` (from useRelationships) so the hook re-queries whenever a
 * family connection is added or removed. `onRealtime(evt, row, old)` fires
 * for every change coming from another user (used to surface toasts).
 */
export function usePantry(userId, familyKey, onRealtime) {
  return useSyncedList({ table: "pantry_items", userId, toDb, fromDb, refreshKey: familyKey, onRealtime });
}
