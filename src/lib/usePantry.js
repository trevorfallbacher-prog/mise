import { useSyncedList } from "./useSyncedList";

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
