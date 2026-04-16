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
//
// Newer columns (kind, servings_remaining, source_*, state) are mapped
// CONDITIONALLY: only set on the app item when the DB row actually carries
// the column. That way a client running a newer build against a DB whose
// migrations haven't been applied yet won't blow up — the column-aware
// conditional spread in toDb skips the field entirely, so UPDATEs only
// touch columns that exist server-side.
function fromDb(row) {
  // Multi-canonical tagging (migration 0033). `ingredient_ids` is the
  // authoritative array; singular `ingredient_id` stays around as the
  // "primary / display" tag and as a back-compat for pre-0033 rows.
  // Read priority: the array if non-empty, else fall back to the
  // single id wrapped in an array so the UI only ever deals with one
  // shape. Empty array = truly un-tagged (free-text row).
  const rawArr = Array.isArray(row.ingredient_ids) ? row.ingredient_ids.filter(Boolean) : null;
  const singleId = row.ingredient_id || null;
  const ingredientIds = rawArr && rawArr.length
    ? rawArr
    : (singleId ? [singleId] : []);
  const primaryId = ingredientIds[0] || null;

  const item = {
    id: row.id,
    // Legacy scalar — kept as the "primary" tag for components that
    // still read ingredientId directly (every existing call site).
    ingredientId: primaryId,
    // New plural — source of truth for the recipe matcher + ItemCard
    // tabbed deep-dive + dietary filter. Always an array (possibly
    // empty), never null, so consumers can iterate without guards.
    ingredientIds,
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
    // Which user owns this row. When you share a pantry with family, their
    // rows come through via the family-select RLS policy; ownerId lets the
    // UI tag them ("+added by Alice") so it's clear who stocked what.
    ownerId: row.user_id,
  };
  // Phase-2 compound-ingredient / leftovers support (migration 0026).
  // Only mapped if the DB has the columns. 'undefined' means "DB hasn't
  // migrated yet" — toDb skips these fields so UPDATEs don't 400.
  if (row.kind               !== undefined) item.kind              = row.kind || "ingredient";
  if (row.servings_remaining !== undefined) item.servingsRemaining = row.servings_remaining != null ? Number(row.servings_remaining) : null;
  if (row.source_recipe_slug !== undefined) item.sourceRecipeSlug  = row.source_recipe_slug || null;
  if (row.source_cook_log_id !== undefined) item.sourceCookLogId   = row.source_cook_log_id || null;
  // Physical form (migration 0027). Same defensive mapping.
  if (row.state              !== undefined) item.state             = row.state || null;
  // Source provenance (migration 0029). Deep-links the row back to the
  // receipt / scan / cook that created it. Same defensive mapping.
  if (row.source_kind        !== undefined) item.sourceKind        = row.source_kind || null;
  if (row.source_receipt_id  !== undefined) item.sourceReceiptId   = row.source_receipt_id || null;
  if (row.source_scan_id     !== undefined) item.sourceScanId      = row.source_scan_id || null;
  // Raw scanner output (migration 0031). JSONB on the row that preserves
  // what Claude actually read before the canonical substitution. Lets
  // the ItemCard show "raw scan: SHRD MOZZ" for debugging and trust.
  if (row.scan_raw           !== undefined) item.scanRaw           = row.scan_raw || null;
  // tile_id memory (migration 0036). Explicit tile placement set by
  // the user at add-time or inherited from a template. Short-circuits
  // the heuristic classifier when present.
  if (row.tile_id            !== undefined) item.tileId            = row.tile_id || null;
  return item;
}

function toDb(item) {
  // Multi-canonical tagging. If the caller explicitly set ingredientIds
  // (the new plural), that's the source of truth — send it to the
  // ingredient_ids array AND mirror the first element into the
  // legacy ingredient_id scalar so any lingering SQL / RLS that keys
  // on the scalar still works.
  //
  // If the caller only set ingredientId (singular), we do NOT synthesize
  // an array on the wire — pre-0033 DBs don't have the ingredient_ids
  // column and sending an unknown column 400s the whole UPDATE. Callers
  // that want array semantics opt in explicitly by setting
  // ingredientIds.
  const hasArray = Array.isArray(item.ingredientIds);
  const primaryId = hasArray && item.ingredientIds.length
    ? (item.ingredientIds[0] || null)
    : (item.ingredientId || null);
  return {
    ingredient_id: primaryId,
    ...(hasArray ? { ingredient_ids: item.ingredientIds.filter(Boolean) } : {}),
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
    ...(item.sourceKind        !== undefined ? { source_kind: item.sourceKind || null } : {}),
    ...(item.sourceReceiptId   !== undefined ? { source_receipt_id: item.sourceReceiptId || null } : {}),
    ...(item.sourceScanId      !== undefined ? { source_scan_id: item.sourceScanId || null } : {}),
    ...(item.scanRaw           !== undefined ? { scan_raw: item.scanRaw || null } : {}),
    ...(item.tileId            !== undefined ? { tile_id: item.tileId || null } : {}),
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
