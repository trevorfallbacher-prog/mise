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
    // Shop Mode pairs a scan to a list item and marks it purchased
    // instead of deleting — these carry the audit trail. Null on rows
    // that haven't been checked out yet.
    purchasedAt: row.purchased_at || null,
    purchasedPantryItemId: row.purchased_pantry_item_id || null,
    purchasedTripId: row.purchased_trip_id || null,
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
    purchased_at: item.purchasedAt || null,
    purchased_pantry_item_id: item.purchasedPantryItemId || null,
    purchased_trip_id: item.purchasedTripId || null,
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
