import { useSyncedList } from "./useSyncedList";

function fromDb(row) {
  return {
    id: row.id,
    ingredientId: row.ingredient_id || null,
    name: row.name,
    emoji: row.emoji,
    amount: Number(row.amount),
    unit: row.unit,
    category: row.category,
    source: row.source,
    // Last-paid unit price, integer cents. Nullable.
    priceCents: row.price_cents ?? null,
    // user_id of the family member who added this row (or the current user).
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
    category: item.category,
    source: item.source || "manual",
    price_cents: item.priceCents ?? null,
  };
}

/**
 * Returns [shoppingList, setShoppingList, loading]. Persists to Supabase
 * transparently; components write to it with the usual useState setter API.
 *
 * `familyKey` triggers re-queries when a family connection is added/removed.
 * `onRealtime(evt, row, old)` fires for every change from another user.
 */
export function useShoppingList(userId, familyKey, onRealtime) {
  return useSyncedList({ table: "shopping_list_items", userId, toDb, fromDb, refreshKey: familyKey, onRealtime });
}
