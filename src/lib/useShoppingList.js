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
 */
export function useShoppingList(userId) {
  return useSyncedList({ table: "shopping_list_items", userId, toDb, fromDb });
}
