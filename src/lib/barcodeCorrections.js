import { supabase } from "./supabase";

// UPC → identity correction memory (migration 0067).
//
// Two-tier architecture:
//   * barcode_identity_corrections — GLOBAL. Admin-written.
//     First-class crowd-verified mappings (UPC → canonical).
//   * user_scan_corrections.barcode_upc — family-scoped.
//     Regular users' corrections land here; admins later promote.
//
// Read path tries global first; falls back to the family-scoped
// row if the user has taught something admins haven't curated yet.
// Result: admin-curated scans apply to everyone; a family still
// sees their own teaching even before promotion.

function fromGlobal(row) {
  if (!row) return null;
  return {
    source:          "global",
    barcodeUpc:      row.barcode_upc,
    canonicalId:     row.canonical_id || null,
    typeId:          row.type_id || null,
    emoji:           row.emoji || null,
    ingredientIds:   Array.isArray(row.ingredient_ids) ? row.ingredient_ids : [],
    correctionCount: row.correction_count || 1,
  };
}

function fromFamily(row) {
  if (!row) return null;
  return {
    source:          "family",
    barcodeUpc:      row.barcode_upc,
    canonicalId:     row.canonical_id || null,
    typeId:          row.type_id || null,
    emoji:           row.emoji || null,
    ingredientIds:   Array.isArray(row.ingredient_ids) ? row.ingredient_ids : [],
    correctionCount: row.correction_count || 1,
  };
}

/**
 * Resolve a UPC to a prior correction, tiered global-first.
 *
 * Returns { source, canonicalId, typeId, emoji, ingredientIds,
 * correctionCount } or null if no correction has been taught for
 * this UPC yet.
 */
export async function findBarcodeCorrection(barcodeUpc) {
  if (!barcodeUpc) return null;
  const upc = String(barcodeUpc).trim();
  if (!upc) return null;

  // Tier 1 — global. One row per UPC (unique constraint). Any
  // auth'd user reads (public-read RLS).
  {
    const { data, error } = await supabase
      .from("barcode_identity_corrections")
      .select("*")
      .eq("barcode_upc", upc)
      .maybeSingle();
    if (error) {
      console.warn("[barcode_identity_corrections] select failed:", error.message);
    } else if (data) {
      return fromGlobal(data);
    }
  }

  // Tier 2 — family-scoped. RLS from 0046 limits to self+family.
  // May return multiple rows (one per family member who corrected
  // the same UPC); pick the most recently used.
  {
    const { data, error } = await supabase
      .from("user_scan_corrections")
      .select("*")
      .eq("barcode_upc", upc)
      .order("last_used_at", { ascending: false })
      .limit(1);
    if (error) {
      console.warn("[user_scan_corrections:upc] select failed:", error.message);
      return null;
    }
    if (data && data.length > 0) return fromFamily(data[0]);
  }

  return null;
}

/**
 * Record a UPC correction. Admins write to the global table so all
 * users benefit; regular users write to the family-scoped table.
 *
 * Best-effort: errors log and return { error } but never throw.
 */
export async function rememberBarcodeCorrection({
  userId,
  isAdmin,
  barcodeUpc,
  canonicalId,
  typeId,
  emoji,
  ingredientIds,
}) {
  if (!userId || !barcodeUpc) return { error: new Error("userId + barcodeUpc required") };
  const upc = String(barcodeUpc).trim();
  if (!upc) return { error: new Error("empty upc") };

  // Build patch — only include supplied fields so a narrow update
  // (e.g. canonical-only) doesn't wipe prior type/emoji.
  const patch = {};
  if (canonicalId) patch.canonical_id = canonicalId;
  if (typeId)      patch.type_id      = typeId;
  if (emoji)       patch.emoji        = emoji;
  if (Array.isArray(ingredientIds) && ingredientIds.length > 0) {
    patch.ingredient_ids = ingredientIds;
  }
  if (Object.keys(patch).length === 0) return { error: null };

  if (isAdmin) {
    // Global path — upsert by barcode_upc (unique index).
    const { data: existing, error: selErr } = await supabase
      .from("barcode_identity_corrections")
      .select("id, correction_count")
      .eq("barcode_upc", upc)
      .maybeSingle();
    if (selErr) {
      console.warn("[barcode_identity_corrections] select failed:", selErr.message);
      return { error: selErr };
    }
    if (existing) {
      const { error } = await supabase
        .from("barcode_identity_corrections")
        .update({
          ...patch,
          correction_count: (existing.correction_count || 1) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) {
        console.warn("[barcode_identity_corrections] update failed:", error.message);
        return { error };
      }
      return { error: null, source: "global", existed: true };
    }
    const { error } = await supabase
      .from("barcode_identity_corrections")
      .insert({
        barcode_upc: upc,
        ...patch,
        correction_count: 1,
        last_used_at: new Date().toISOString(),
        created_by: userId,
      });
    if (error) {
      console.warn("[barcode_identity_corrections] insert failed:", error.message);
      return { error };
    }
    return { error: null, source: "global", existed: false };
  }

  // Family path — upsert into user_scan_corrections keyed on
  // (user_id, barcode_upc). raw_text mirrors the UPC so the text-
  // keyed index from 0046 stays populated (defensive — a user who
  // later types the barcode digits still hits memory).
  const { data: existingRows, error: selErr } = await supabase
    .from("user_scan_corrections")
    .select("*")
    .eq("user_id", userId)
    .eq("barcode_upc", upc)
    .limit(1);
  if (selErr) {
    console.warn("[user_scan_corrections:upc] select failed:", selErr.message);
    return { error: selErr };
  }
  const existing = existingRows && existingRows[0];
  if (existing) {
    const { error } = await supabase
      .from("user_scan_corrections")
      .update({
        ...patch,
        correction_count: (existing.correction_count || 1) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) {
      console.warn("[user_scan_corrections:upc] update failed:", error.message);
      return { error };
    }
    return { error: null, source: "family", existed: true };
  }
  const { error } = await supabase
    .from("user_scan_corrections")
    .insert({
      user_id: userId,
      raw_text: upc,
      raw_text_normalized: upc,
      barcode_upc: upc,
      ...patch,
      correction_count: 1,
      last_used_at: new Date().toISOString(),
    });
  if (error) {
    console.warn("[user_scan_corrections:upc] insert failed:", error.message);
    return { error };
  }
  return { error: null, source: "family", existed: false };
}
