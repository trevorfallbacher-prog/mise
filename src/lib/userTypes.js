import { supabase } from "./supabase";

// User-created IDENTIFIED-AS food types (migration 0038). Mirrors
// userTiles.js exactly — family-shared, strict-per-family dedup by
// normalized label, RLS-scoped reads, application-level dedup on
// writes.
//
// Distinct from bundled WWEIA food types (src/data/foodTypes.js):
//   * Bundled types have ids like 'wweia_pizza' (stable slugs)
//     sourced from USDA classifications — ~48 of them shipped with
//     the app
//   * User types have uuid ids, come from this table, live only
//     within the family that created them
//   * The pantry_items.type_id column and user_item_templates.type_id
//     column hold EITHER shape; callers discriminate by uuid-regex
//     when they need to route reads to the right data source.

export function normalizeTypeLabel(label) {
  return (label || "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Lookup an existing family type by normalized label. RLS returns
 * self+family rows so this naturally implements strict family dedup.
 */
export async function findUserTypeByLabel(label) {
  const normalized = normalizeTypeLabel(label);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("user_types")
    .select("*")
    .eq("label_normalized", normalized)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[user_types] lookup failed:", error);
    return null;
  }
  return data ? fromDb(data) : null;
}

/**
 * Create a new user type, or return the existing one if a family
 * member already made one with the same normalized label. Same
 * idempotent-upsert semantics as createUserTile.
 *
 * Returns { id, error, existed }.
 */
export async function createUserType({
  userId,
  label,
  emoji,
  defaultTileId,
  defaultLocation,
}) {
  if (!userId) return { id: null, error: new Error("userId required") };
  if (!label || !label.trim()) return { id: null, error: new Error("label required") };

  const normalized = normalizeTypeLabel(label);
  const existing = await findUserTypeByLabel(label);
  if (existing) {
    const { error } = await supabase
      .from("user_types")
      .update({
        use_count: (existing.useCount || 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) {
      console.error("[user_types] bump failed:", error);
      return { id: existing.id, error };
    }
    return { id: existing.id, error: null, existed: true };
  }

  const { data, error } = await supabase
    .from("user_types")
    .insert({
      user_id: userId,
      label: label.trim(),
      label_normalized: normalized,
      emoji: emoji || "🏷️",
      default_tile_id: defaultTileId || null,
      default_location: defaultLocation || null,
      use_count: 1,
      last_used_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("[user_types] insert failed:", error);
    return { id: null, error };
  }
  return { id: data?.id || null, error: null, existed: false };
}

/**
 * Bump use_count + last_used_at on a user type. Fire-and-forget.
 * Called when a template or item is saved with this type_id even
 * when the type already existed (user picked from list rather than
 * creating). Matches bumpTileUse / bumpTemplateUse semantics.
 */
export async function bumpTypeUse(typeId) {
  if (!typeId) return;
  // Only bump user types (uuid ids). Bundled WWEIA types have no
  // DB row; their use_count lives client-side in local analytics
  // (future chunk).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(typeId)) return;
  const { data, error: selErr } = await supabase
    .from("user_types")
    .select("use_count")
    .eq("id", typeId)
    .maybeSingle();
  if (selErr || !data) {
    if (selErr) console.error("[user_types] bump select failed:", selErr);
    return;
  }
  const { error: updErr } = await supabase
    .from("user_types")
    .update({
      use_count: (data.use_count || 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", typeId);
  if (updErr) console.error("[user_types] bump update failed:", updErr);
}

export function fromDb(row) {
  if (!row) return null;
  return {
    id:               row.id,
    userId:           row.user_id,
    label:            row.label,
    labelNormalized:  row.label_normalized,
    emoji:            row.emoji || "🏷️",
    defaultTileId:    row.default_tile_id || null,
    defaultLocation:  row.default_location || null,
    useCount:         Number(row.use_count || 0),
    lastUsedAt:       row.last_used_at ? new Date(row.last_used_at) : null,
    promotedAt:       row.promoted_at ? new Date(row.promoted_at) : null,
    createdAt:        row.created_at ? new Date(row.created_at) : null,
    updatedAt:        row.updated_at ? new Date(row.updated_at) : null,
  };
}
