import { supabase } from "./supabase";

// user_scan_corrections helpers (migration 0046).
//
// Remembers "this raw OCR text → that identity" so repeat-scans
// of the same text string auto-suggest the user's previous
// correction. "AQUAMARINE SL" → Imitation Crab. "CHZ SLCD" →
// Sliced Cheese. "BURR BALLS" → Burrata. One-and-done teaching.
//
// Keying: raw_text_normalized (lowercased, trimmed, whitespace-
// collapsed). Same normalization as templates.js — consistency keeps
// surprising misses out of the lookup path.
//
// Scope: family-shared by RLS. If one spouse teaches the system
// "BURR BALLS → Burrata," the other sees the ⭐ suggestion on their
// next scan automatically.

/**
 * Normalize raw OCR text for lookup. Lowercase, trim, collapse
 * internal whitespace. The client maintains the column on every
 * write; the SQL side is just a dumb index on the normalized column.
 */
export function normalizeScanText(text) {
  return (text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Map a DB row (snake_case) to client camelCase shape.
 */
export function fromDb(row) {
  if (!row) return null;
  return {
    id:                row.id,
    userId:            row.user_id,
    rawText:           row.raw_text,
    rawTextNormalized: row.raw_text_normalized,
    correctedName:     row.corrected_name,
    emoji:             row.emoji,
    typeId:            row.type_id,
    canonicalId:       row.canonical_id,
    ingredientIds:     row.ingredient_ids || [],
    // Brand payload (migration 0062). Household-learned
    // abbreviation → brand mapping. Null until a family member taps
    // to correct the brand chip on a scan row.
    brand:             row.brand || null,
    correctionCount:   row.correction_count || 0,
    lastUsedAt:        row.last_used_at,
    createdAt:         row.created_at,
    updatedAt:         row.updated_at,
  };
}

/**
 * Look up all family corrections for a set of raw text strings in
 * one round-trip. Returns a Map<normalized, correction>.
 *
 * Callers pass every raw_name they saw in a scan; we resolve them
 * all at once and overlay ⭐ suggestions on whichever rows got a
 * hit. Rows without a hit fall back to the usual name-inference
 * path (inferFoodTypeFromName / findIngredient).
 *
 * RLS scopes the SELECT to self + family automatically.
 */
export async function findScanCorrections(rawTexts) {
  if (!Array.isArray(rawTexts) || rawTexts.length === 0) return new Map();
  const normalized = [...new Set(
    rawTexts.map(normalizeScanText).filter(Boolean)
  )];
  if (normalized.length === 0) return new Map();

  const { data, error } = await supabase
    .from("user_scan_corrections")
    .select("*")
    .in("raw_text_normalized", normalized);

  if (error) {
    // Non-fatal — the scan still works, it just doesn't benefit from
    // memory. A 406 / RLS misconfigure shouldn't break the receipt.
    console.error("[user_scan_corrections] lookup failed:", error);
    return new Map();
  }

  // Prefer the most-recent correction per normalized key. If the
  // household disagrees (one spouse linked to Burrata, the other to
  // Fresh Mozzarella), newest wins — people change their minds and
  // we reflect current intent.
  const byKey = new Map();
  for (const row of data || []) {
    const key = row.raw_text_normalized;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    // Compare ISO timestamps lexicographically — valid for same
    // format strings and avoids a Date parse per comparison.
    if ((row.last_used_at || "") > (existing.last_used_at || "")) {
      byKey.set(key, row);
    }
  }
  const out = new Map();
  for (const [k, v] of byKey) out.set(k, fromDb(v));
  return out;
}

/**
 * Upsert a correction. Called whenever a user changes an identity
 * field (name, type, canonical, ingredient_ids, emoji) on a scan row.
 *
 *   * No prior correction for this text → INSERT, correction_count = 1
 *   * Prior correction exists            → UPDATE, bump count + recency
 *
 * Upsert is per-user (the unique index is on user_id +
 * raw_text_normalized). A second family member correcting the same
 * text creates their own row; the family-scoped SELECT at read time
 * finds any of them.
 *
 * All identity fields are optional. Whatever the caller supplies
 * gets stored; null/empty values DON'T overwrite previously-saved
 * fields (so a user correcting just the type doesn't wipe out the
 * canonical_id a prior correction set).
 *
 * Best-effort: errors are logged but NOT thrown. A failed memory
 * write must never block the real scan-confirm save.
 */
export async function rememberScanCorrection({
  userId,
  rawText,
  correctedName,
  emoji,
  typeId,
  canonicalId,
  ingredientIds,
  brand,
}) {
  if (!userId) return { error: new Error("userId required") };
  const normalized = normalizeScanText(rawText);
  if (!normalized) return { error: null }; // nothing to key on, silently skip

  // Look up existing correction for this user + text
  const { data: existingRows, error: selErr } = await supabase
    .from("user_scan_corrections")
    .select("*")
    .eq("user_id", userId)
    .eq("raw_text_normalized", normalized)
    .limit(1);
  if (selErr) {
    console.error("[user_scan_corrections] select failed:", selErr);
    return { error: selErr };
  }
  const existing = existingRows && existingRows[0];

  const patch = {};
  if (correctedName) patch.corrected_name = correctedName;
  if (emoji)         patch.emoji          = emoji;
  if (typeId)        patch.type_id        = typeId;
  if (canonicalId)   patch.canonical_id   = canonicalId;
  if (Array.isArray(ingredientIds) && ingredientIds.length > 0) {
    patch.ingredient_ids = ingredientIds;
  }
  // Brand (migration 0062). Same discipline as the other fields:
  // only overwrites when the caller supplied a value, so a brand-
  // only correction doesn't wipe the canonical_id a prior
  // correction set.
  if (brand)         patch.brand          = brand;

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
      console.error("[user_scan_corrections] update failed:", error);
      return { error };
    }
    return { error: null, existed: true };
  }

  const { error } = await supabase
    .from("user_scan_corrections")
    .insert({
      user_id: userId,
      raw_text: rawText,
      raw_text_normalized: normalized,
      ...patch,
      correction_count: 1,
      last_used_at: new Date().toISOString(),
    });
  if (error) {
    console.error("[user_scan_corrections] insert failed:", error);
    return { error };
  }
  return { error: null, existed: false };
}
