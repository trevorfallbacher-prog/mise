import { useSyncedList } from "./useSyncedList";

// Heuristic for "where would I expect this to live by default?" — used for
// rows from older clients that don't yet carry a location, and for inserts
// the UI didn't bother to tag (manual adds usually). Mirrors the SQL
// backfill in migration 0008.
export function defaultLocationForCategory(category) {
  if (category === "frozen") return "freezer";
  // "beverage" added alongside dairy/produce/meat so a scanned soda
  // / juice / carton of milk-alternative lands in the fridge by
  // default — otherwise OFF-tagged beverages whose canonical doesn't
  // resolve (or whose category is the new "beverage" bucket from
  // tagHintsToAxes) would fall through to pantry.
  if (category === "dairy" || category === "produce" || category === "meat" || category === "beverage") return "fridge";
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
  // Composition axis — renamed from ingredient_ids → components in
  // migration 0056. During the rename window (pre- vs. post-migration
  // clients), the DB row might still carry the old column; the
  // coalesce below reads from either source. Empty array = no
  // composition info (canonical_id alone carries identity).
  const rawArr = Array.isArray(row.components)
    ? row.components.filter(Boolean)
    : (Array.isArray(row.ingredient_ids) ? row.ingredient_ids.filter(Boolean) : null);
  const singleId = row.ingredient_id || null;
  const components = rawArr && rawArr.length
    ? rawArr
    : (singleId ? [singleId] : []);
  const primaryId = components[0] || null;

  const item = {
    id: row.id,
    // Legacy scalar — kept as the "primary" tag for components that
    // still read ingredientId directly (every existing call site).
    ingredientId: primaryId,
    // Composition array (migration 0056: renamed from ingredient_ids).
    // Source of truth for multi-ingredient items. Always an array
    // (possibly empty), never null, so consumers can iterate without
    // guards. `ingredientIds` kept as a deprecated alias below for
    // the transition window.
    components,
    // Deprecated alias — kept so legacy readers don't break mid-ship.
    // Scheduled for removal once every call site migrates to
    // `components`. Behaves identically.
    ingredientIds: components,
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
  // Cut axis (migration 0122) — anatomical slot, orthogonal to state.
  // "breast" / "thigh" / "ribeye" / "brisket" etc. Only populated for
  // meats where CUTS_FOR has an entry; null everywhere else.
  if (row.cut                !== undefined) item.cut               = row.cut || null;
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
  // type_id (migration 0038) — IDENTIFIED AS layer. Holds either a
  // bundled WWEIA id ('wweia_pizza') or a user_types.id uuid.
  if (row.type_id            !== undefined) item.typeId            = row.type_id || null;
  // canonical_id (migration 0039) — the canonical-identity bridge.
  // Singular id from src/data/ingredients.js ('hot_dog', 'mayo',
  // 'green_onion'). Identity, NOT composition — user-composed
  // ingredient_ids[] stays free-form.
  if (row.canonical_id       !== undefined) item.canonicalId       = row.canonical_id || null;
  // brand (migration 0061) — manufacturer label parsed off the raw
  // name by parseIdentity. Orthogonal to the six-row identity stack
  // (CLAUDE.md); surfaced in UI parenthetically next to the name.
  if (row.brand              !== undefined) item.brand             = row.brand || null;
  if (row.barcode_upc        !== undefined) item.barcodeUpc        = row.barcode_upc || null;
  // Scan-derived attributes JSONB (migration 0066) — origins,
  // certifications, flavor keywords, product claims like 'ORIGINAL'
  // / 'PROTEIN'. Rendered as pills by AttributePillsRow. Without
  // the mapping these vanish on persist and the pills go blank.
  if (row.attributes         !== undefined) item.attributes        = row.attributes || null;
  // nutrition_override (migration 0065) — tier-1 of the nutrition
  // resolver. When populated, wins over brand/canonical/bundled so
  // the user can hand-correct macros for a specific jar when AI
  // enrichment fails or a brand's label doesn't match the generic
  // canonical. Defensively mapped like attributes — `undefined`
  // from the DB = column not present = toDb skips the field so
  // pre-0065 environments don't 400.
  if (row.nutrition_override !== undefined) item.nutritionOverride = row.nutrition_override || null;
  // protected (migration 0044) — sentimental / keepsake rows that
  // shouldn't be ✕-deletable. DB enforces via the delete policy;
  // this mapping just lets the UI know so it can hide the delete
  // control.
  if (row.protected          !== undefined) item.protected         = !!row.protected;
  // Packaging + reserves (migration 0054). package_amount is the size
  // of ONE sealed unit; reserve_count is the number of SEALED units
  // on hand (the currently-open one lives in amount/unit). Null
  // package_amount means the row is in legacy "liquid mode" where
  // amount/max is the whole story.
  if (row.package_amount !== undefined) item.packageAmount = row.package_amount != null ? Number(row.package_amount) : null;
  if (row.package_unit   !== undefined) item.packageUnit   = row.package_unit || null;
  if (row.reserve_count  !== undefined) item.reserveCount  = Number(row.reserve_count || 0);
  // Per-row count→grams override (migration 0121). Non-null value
  // wins over the canonical's count-unit toBase for scaleFactor math
  // ("1 breast" = 170g here, not the canonical's generic 200g). Null
  // means fall back to canonical default (or a derive-on-write path
  // from packageAmount). Gated on column presence the same way
  // package_amount is so pre-0121 DBs keep working.
  if (row.count_weight_g !== undefined) item.countWeightG = row.count_weight_g != null ? Number(row.count_weight_g) : null;
  // Receipt-line dedupe position (migration 0057). Set on rows born
  // from a receipt scan — the flattened post-fan-out index. Unused
  // for manual / cook / conversion / pantry-scan entries.
  if (row.receipt_line_index !== undefined) item.receiptLineIndex = row.receipt_line_index != null ? Number(row.receipt_line_index) : null;
  // fill_level (migration 0043) is dormant — we rolled the whole
  // proportional-inventory concept back into plain amount+max sliders
  // in 0.7.9. Column stays in the DB for forward compat but the
  // client doesn't read or write it. A future migration can DROP
  // COLUMN if it stays dead long enough.
  return item;
}

function toDb(item) {
  if (item?.brand || item?.canonicalId === "ramen") {
    console.log("[ramen-debug] 7/toDb-input", {
      name: item.name,
      brand: item.brand,
      brandType: typeof item.brand,
      canonicalId: item.canonicalId,
    });
  }
  // Multi-canonical tagging. If the caller explicitly set ingredientIds
  // Composition write path (migration 0056: components is the new
  // column; ingredient_ids stays as an alias until v0.14 drops it).
  //
  // Callers can set `components` (canonical, v0.13+) or
  // `ingredientIds` (legacy alias). Either becomes the source of truth;
  // mirror the first element into the `ingredient_id` scalar so any
  // lingering SQL / RLS keyed on the scalar still resolves.
  //
  // If the caller only set ingredientId (singular), we do NOT synthesize
  // an array on the wire — pre-0033 DBs don't have the components /
  // ingredient_ids column and sending an unknown column 400s the
  // whole UPDATE. Callers that want array semantics opt in explicitly.
  const arr = Array.isArray(item.components)
    ? item.components
    : (Array.isArray(item.ingredientIds) ? item.ingredientIds : null);
  const hasArray = Array.isArray(arr);
  const primaryId = hasArray && arr.length
    ? (arr[0] || null)
    : (item.ingredientId || null);
  return {
    ingredient_id: primaryId,
    ...(hasArray ? { components: arr.filter(Boolean) } : {}),
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
    ...(item.cut               !== undefined ? { cut: item.cut || null } : {}),
    ...(item.sourceKind        !== undefined ? { source_kind: item.sourceKind || null } : {}),
    ...(item.sourceReceiptId   !== undefined ? { source_receipt_id: item.sourceReceiptId || null } : {}),
    ...(item.sourceScanId      !== undefined ? { source_scan_id: item.sourceScanId || null } : {}),
    ...(item.scanRaw           !== undefined ? { scan_raw: item.scanRaw || null } : {}),
    ...(item.tileId            !== undefined ? { tile_id: item.tileId || null } : {}),
    ...(item.typeId            !== undefined ? { type_id: item.typeId || null } : {}),
    ...(item.canonicalId       !== undefined ? { canonical_id: item.canonicalId || null } : {}),
    ...(item.brand             !== undefined ? { brand: item.brand || null } : {}),
    ...(item.barcodeUpc        !== undefined ? { barcode_upc: item.barcodeUpc || null } : {}),
    ...(item.attributes        !== undefined ? { attributes: item.attributes || null } : {}),
    ...(item.nutritionOverride !== undefined ? { nutrition_override: item.nutritionOverride || null } : {}),
    ...(item.protected         !== undefined ? { protected: !!item.protected } : {}),
    // Packaging + reserves (migration 0054). Passthrough only when the
    // caller set them — older code paths that don't know about
    // packaging keep writing the exact payload they always did.
    ...(item.packageAmount !== undefined ? { package_amount: item.packageAmount } : {}),
    ...(item.packageUnit   !== undefined ? { package_unit: item.packageUnit || null } : {}),
    ...(item.reserveCount  !== undefined ? { reserve_count: Math.max(0, Number(item.reserveCount) || 0) } : {}),
    ...(item.countWeightG  !== undefined ? { count_weight_g: item.countWeightG == null ? null : Number(item.countWeightG) } : {}),
    ...(item.receiptLineIndex !== undefined ? { receipt_line_index: item.receiptLineIndex == null ? null : Number(item.receiptLineIndex) } : {}),
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
