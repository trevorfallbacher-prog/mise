import { supabase } from "./supabase";

// User-created IDENTIFIED-AS tiles (migration 0037). Parallels
// userTemplates.js: family-shared, strict-per-family dedup by
// normalized label, RLS-scoped reads, application-level dedup on
// writes. Distinct from bundled tiles (fridgeTiles.js / pantryTiles.js
// / freezerTiles.js) — those have classifier functions for heuristic
// routing; user tiles are opt-in tag-only (items land there only when
// explicitly tagged with their tile_id).

export function normalizeTileLabel(label) {
  return (label || "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Lookup an existing family tile by normalized label + location.
 * Family scope enforced by RLS (SELECT returns self-or-family rows).
 * Returns the first matching tile or null.
 */
export async function findTileByLabel(label, location) {
  const normalized = normalizeTileLabel(label);
  if (!normalized || !location) return null;
  const { data, error } = await supabase
    .from("user_tiles")
    .select("*")
    .eq("label_normalized", normalized)
    .eq("location", location)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[user_tiles] lookup failed:", error);
    return null;
  }
  return data ? fromDb(data) : null;
}

/**
 * Create a new user tile, or return the existing one if a family
 * member already made one with the same normalized label in the same
 * location.
 *
 * Returns { id, error, existed }. `existed` tells the caller whether
 * the tile was newly created (false) or matched an existing family
 * tile (true) — useful for UX messaging like "Your family already
 * has a 'Kids Snacks' tile — using that one."
 */
export async function createUserTile({ userId, label, emoji, location }) {
  if (!userId) return { id: null, error: new Error("userId required") };
  if (!label || !label.trim()) return { id: null, error: new Error("label required") };
  if (!location) return { id: null, error: new Error("location required") };

  const normalized = normalizeTileLabel(label);
  const existing = await findTileByLabel(label, location);
  if (existing) {
    // Bump use_count + refresh last_used_at on the existing tile —
    // same idempotent-re-use semantics as templates. Preserves the
    // original creator's emoji / casing.
    const { error } = await supabase
      .from("user_tiles")
      .update({
        use_count: (existing.useCount || 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) {
      console.error("[user_tiles] bump failed:", error);
      return { id: existing.id, error };
    }
    return { id: existing.id, error: null, existed: true };
  }

  const { data, error } = await supabase
    .from("user_tiles")
    .insert({
      user_id: userId,
      label: label.trim(),
      label_normalized: normalized,
      emoji: emoji || "🗂️",
      location,
      use_count: 1,
      last_used_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("[user_tiles] insert failed:", error);
    return { id: null, error };
  }
  return { id: data?.id || null, error: null, existed: false };
}

/**
 * Bump use_count + last_used_at on a tile. Fire-and-forget.
 * Called whenever a template or item is saved with this tile_id —
 * even when the tile already existed (user picked it from the list
 * rather than creating).
 */
export async function bumpTileUse(tileId) {
  if (!tileId) return;
  const { data, error: selErr } = await supabase
    .from("user_tiles")
    .select("use_count")
    .eq("id", tileId)
    .maybeSingle();
  if (selErr || !data) {
    if (selErr) console.error("[user_tiles] bump select failed:", selErr);
    return;
  }
  const { error: updErr } = await supabase
    .from("user_tiles")
    .update({
      use_count: (data.use_count || 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", tileId);
  if (updErr) console.error("[user_tiles] bump update failed:", updErr);
}

export function fromDb(row) {
  if (!row) return null;
  return {
    id:              row.id,
    userId:          row.user_id,
    label:           row.label,
    labelNormalized: row.label_normalized,
    emoji:           row.emoji || "🗂️",
    location:        row.location,
    useCount:        Number(row.use_count || 0),
    lastUsedAt:      row.last_used_at ? new Date(row.last_used_at) : null,
    promotedAt:      row.promoted_at ? new Date(row.promoted_at) : null,
    createdAt:       row.created_at ? new Date(row.created_at) : null,
    updatedAt:       row.updated_at ? new Date(row.updated_at) : null,
  };
}
