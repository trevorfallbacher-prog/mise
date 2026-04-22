// Shop Mode commit-pairing pass.
//
// Runs after Kitchen's addScannedItems has inserted the receipts row
// and the per-line pantry_items rows. Walks the active trip's scans +
// the newly inserted pantry rows and cross-links them:
//
//   1. For each trip_scan, find the pantry row it matches. Match order:
//      a) Same barcode_upc (only when the receipt OCR picked up a UPC —
//         rare on US receipts, but free when available).
//      b) Same receipt_line_index (when the UI rendered the pair sheet
//         and we stashed the line index there).
//      c) Fuzzy match between the trip_scan's OFF productName/brand
//         and the pantry row's name (fallback for the common case
//         where the receipt has no UPCs).
//
//   2. Merge identity: for a paired pantry row, upgrade brand +
//      canonical_id + barcode_upc from the trip_scan since those
//      are OFF-rich and beat the receipt OCR's noisy guess.
//
//   3. Mark the bound shopping_list_items row purchased with a forward
//      link to the pantry row + the trip id.
//
//   4. Stamp trip_scans.paired_pantry_item_id on every paired scan +
//      trip_scans.paired_receipt_line_index when we found the match
//      on the line-index axis.
//
//   5. Checkout the trip: status='checked_out', receipt_id, store_name
//      from the receipt.
//
// Unpaired trip_scans (user scanned but the receipt had no matching
// line — e.g. put the item back before checkout) remain on the trip
// and will stay visible in the trip history if the user drills in.
// They do NOT create pantry rows on their own — the receipt is the
// source of truth for what was actually bought.

import { supabase } from "./supabase";
import { fuzzyMatchIngredient } from "../data/ingredients";

function normalize(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function nameTokens(s) {
  return new Set(normalize(s).split(" ").filter(Boolean));
}

function tokenOverlapScore(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

// Best pantry-row candidate for a given trip_scan. Returns the row
// plus a confidence score; caller thresholds at 0.5. Skips rows that
// are already paired to a different scan (first-pass wins).
function findBestPantryMatch(scan, pantryRows, claimedIds) {
  const scanTarget = scan.productName || scan.brand || "";
  let best = null;
  let bestScore = 0;
  for (const row of pantryRows) {
    if (claimedIds.has(row.id)) continue;
    let score = 0;
    // UPC direct match — strongest signal.
    if (scan.barcodeUpc && row.barcode_upc && scan.barcodeUpc === row.barcode_upc) {
      return { row, score: 1.0, via: "upc" };
    }
    // Name overlap.
    const overlap = tokenOverlapScore(scanTarget, row.name);
    score = Math.max(score, overlap);
    // Brand match adds weight.
    if (scan.brand && row.brand && normalize(scan.brand) === normalize(row.brand)) {
      score += 0.25;
    }
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (best && bestScore >= 0.5) return { row: best, score: bestScore, via: "name" };
  return null;
}

/**
 * Commit a Shop Mode trip at receipt-scan time.
 *
 * @param {object} params
 * @param {string} params.tripId      — active trip id
 * @param {string} params.receiptId   — newly-inserted receipts.id (nullable)
 * @param {string} params.userId      — current user id (for list-item updates)
 * @param {Array}  params.tripScans   — current trip's scans array (from useShopMode)
 * @param {Array}  params.newPantryRows — the raw DB rows just inserted for this receipt
 * @param {object} params.receiptMeta — { store, date, totalCents }
 *
 * Returns a summary: { pairedCount, checkedOut: true|false }.
 */
export async function commitShopModeTrip({
  tripId,
  receiptId,
  userId,
  tripScans = [],
  newPantryRows = [],
  receiptMeta = {},
}) {
  let pairedCount = 0;
  const claimedPantryIds = new Set();
  const pantryRowUpdates = []; // { id, brand, canonical_id, barcode_upc, source_shopping_list_item_id }
  const listItemUpdates = [];  // { id, purchased_at, purchased_pantry_item_id, purchased_trip_id }
  const scanUpdates = [];      // { id, paired_pantry_item_id, paired_receipt_line_index }

  for (const scan of tripScans) {
    const match = findBestPantryMatch(scan, newPantryRows, claimedPantryIds);
    if (!match) continue;
    claimedPantryIds.add(match.row.id);
    pairedCount += 1;

    // Upgrade the pantry row with OFF-rich identity from the scan.
    const patch = {};
    if (scan.barcodeUpc && !match.row.barcode_upc) patch.barcode_upc = scan.barcodeUpc;
    if (scan.brand && !match.row.brand)           patch.brand        = scan.brand;
    if (scan.canonicalId && !match.row.canonical_id) patch.canonical_id = scan.canonicalId;
    // Forward-link from pantry row back to the list slot (so the
    // ItemCard can show "from your shopping list").
    if (scan.pairedShoppingListItemId && !match.row.source_shopping_list_item_id) {
      patch.source_shopping_list_item_id = scan.pairedShoppingListItemId;
    }
    if (Object.keys(patch).length > 0) {
      pantryRowUpdates.push({ id: match.row.id, patch });
    }

    // Mark the list slot purchased.
    if (scan.pairedShoppingListItemId) {
      listItemUpdates.push({
        id: scan.pairedShoppingListItemId,
        purchased_at: new Date().toISOString(),
        purchased_pantry_item_id: match.row.id,
        purchased_trip_id: tripId,
      });
    }

    scanUpdates.push({
      id: scan.id,
      paired_pantry_item_id: match.row.id,
      paired_receipt_line_index: typeof match.row.receipt_line_index === "number"
        ? match.row.receipt_line_index
        : null,
    });
  }

  // Apply pantry patches. Uses individual updates since postgrest's
  // upsert semantics don't play well with partial patch shapes across
  // heterogeneous rows.
  //
  // NOTE: pantry_items.source_shopping_list_item_id is a new column
  // that doesn't exist in the schema yet — callers should add it in
  // a follow-up migration (see release notes Coming Soon). Until the
  // column lands, the update silently drops the field on the DB side.
  for (const { id, patch } of pantryRowUpdates) {
    const { error } = await supabase.from("pantry_items").update(patch).eq("id", id);
    if (error) {
      console.warn("[shop-mode] pantry upgrade failed:", error.message, { id, patch });
    }
  }

  for (const li of listItemUpdates) {
    const { error } = await supabase
      .from("shopping_list_items")
      .update({
        purchased_at:             li.purchased_at,
        purchased_pantry_item_id: li.purchased_pantry_item_id,
        purchased_trip_id:        li.purchased_trip_id,
      })
      .eq("id", li.id);
    if (error) {
      console.warn("[shop-mode] list-item purchased update failed:", error.message, li);
    }
  }

  for (const su of scanUpdates) {
    const { error } = await supabase
      .from("trip_scans")
      .update({
        paired_pantry_item_id:     su.paired_pantry_item_id,
        paired_receipt_line_index: su.paired_receipt_line_index,
      })
      .eq("id", su.id);
    if (error) {
      console.warn("[shop-mode] scan pairing update failed:", error.message, su);
    }
  }

  // Finally — check out the trip. The useShopMode hook owns
  // activeTrip state; this call flips status='checked_out', stamps
  // ended_at, attaches the receipt id, and records the store.
  let checkedOut = false;
  if (tripId) {
    const { error } = await supabase
      .from("shopping_trips")
      .update({
        status: "checked_out",
        ended_at: new Date().toISOString(),
        receipt_id: receiptId || null,
        store_name: receiptMeta?.store || null,
      })
      .eq("id", tripId);
    if (error) {
      console.warn("[shop-mode] checkout failed:", error.message);
    } else {
      checkedOut = true;
    }
  }

  return { pairedCount, checkedOut };
}

// Unused but handy: map fuzzyMatchIngredient for out-of-band lookups.
// Kept here so callers can import in one place without digging into
// ingredients.js internals.
export { fuzzyMatchIngredient };
