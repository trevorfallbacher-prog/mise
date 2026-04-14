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
  };
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
