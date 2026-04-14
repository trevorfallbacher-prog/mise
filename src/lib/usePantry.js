import { useSyncedList } from "./useSyncedList";

// Database row ↔ app item shape. The only camelCase field we convert is
// lowThreshold ↔ low_threshold.
function fromDb(row) {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    amount: Number(row.amount),
    unit: row.unit,
    max: Number(row.max),
    category: row.category,
    lowThreshold: Number(row.low_threshold),
  };
}

function toDb(item) {
  return {
    name: item.name,
    emoji: item.emoji,
    amount: item.amount,
    unit: item.unit,
    max: item.max,
    category: item.category,
    low_threshold: item.lowThreshold,
  };
}

/**
 * Returns [pantry, setPantry, loading]. `setPantry` has the same signature as
 * `useState`'s setter — all changes are persisted to Supabase behind the scenes.
 */
export function usePantry(userId) {
  return useSyncedList({ table: "pantry_items", userId, toDb, fromDb });
}
