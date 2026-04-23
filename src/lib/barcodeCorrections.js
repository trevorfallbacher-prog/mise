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
    tileId:          row.tile_id || null,
    location:        row.location || null,
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
    tileId:          row.tile_id || null,
    location:        row.location || null,
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

  // Build a list of equivalent UPC forms to query against. Different
  // scanners / migrations / vendors stored the same physical code
  // in a few different digit-counts (11-short, 12-UPC-A, 13-EAN-13).
  // Querying with .in() against all variants finds the row no matter
  // which form it was originally written under, so users don't have
  // to re-teach corrections after the canonicalize-at-capture
  // change.
  const variants = (() => {
    const d = upc.replace(/\D+/g, "");
    if (d.length < 8 || d.length > 14) return [upc];
    if (d.length === 8) return [d];                 // EAN-8 separate family
    const stripped = d.replace(/^0+/, "") || d;
    const padded12 = stripped.padStart(12, "0");
    const padded13 = stripped.padStart(13, "0");
    // De-dup with a Set in case the input was already canonical.
    return Array.from(new Set([upc, d, stripped, padded12, padded13]));
  })();

  // Tier 1 — global. One row per UPC (unique constraint). Any
  // auth'd user reads (public-read RLS).
  {
    const { data, error } = await supabase
      .from("barcode_identity_corrections")
      .select("*")
      .in("barcode_upc", variants)
      .limit(1);
    if (error) {
      console.warn("[barcode_identity_corrections] select failed:", error.message);
    } else if (data && data.length > 0) {
      return fromGlobal(data[0]);
    }
  }

  // Tier 2 — family-scoped. RLS from 0046 limits to self+family.
  // May return multiple rows (one per family member who corrected
  // the same UPC); pick the most recently used across any variant.
  {
    const { data, error } = await supabase
      .from("user_scan_corrections")
      .select("*")
      .in("barcode_upc", variants)
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
// OFF category hints that are too generic to map to a canonical at
// Tier-1 exact confidence. "beverages" matches every soda / juice /
// water equally, so teaching "beverages → soft_drink" would mistag
// every scanned juice box as a soda. These get filtered OUT of the
// tag-map seeding — the narrower siblings (colas, sodas, sparkling-
// waters) carry the actual discriminating signal.
const GENERIC_OFF_TAGS = new Set([
  "beverages", "drinks", "foods", "snacks", "meals", "dishes",
  "plant-based-foods", "plant-based-beverages",
  "ultra-processed-foods", "processed-foods", "fresh-foods",
  "frozen-foods", "canned-foods",
  "dairies", "dairy-products",
  "meats", "fishes", "seafoods",
  "fruits", "vegetables",
  "sauces", "condiments", "seasonings",
  "sweet-snacks", "salty-snacks", "savory-snacks",
  "sugary-drinks", "sugary-snacks", "sugary-foods",
  "fatty-foods",
  "breakfasts",
]);

export async function rememberBarcodeCorrection({
  userId,
  isAdmin,
  barcodeUpc,
  canonicalId,
  typeId,
  tileId,     // migration 0129 — STORED IN shelf override
  location,   // migration 0129 — fridge/pantry/freezer override
  emoji,
  ingredientIds,
  categoryHints = null,   // optional — admin path seeds the tag map when present
}) {
  if (!userId || !barcodeUpc) return { error: new Error("userId + barcodeUpc required") };
  const upc = String(barcodeUpc).trim();
  if (!upc) return { error: new Error("empty upc") };

  // Build patch — only include supplied fields so a narrow update
  // (e.g. canonical-only) doesn't wipe prior type/emoji/tile.
  const patch = {};
  if (canonicalId) patch.canonical_id = canonicalId;
  if (typeId)      patch.type_id      = typeId;
  if (tileId)      patch.tile_id      = tileId;
  if (location)    patch.location     = location;
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
      await seedTagMap({ userId, canonicalId, categoryHints });
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
    await seedTagMap({ userId, canonicalId, categoryHints });
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

// Seed the Tier-1 learned tag map. For each OFF categoryHint that
// was on the corrected scan's row, upsert a (tag → canonical_id)
// mapping into off_category_tag_canonicals. Next fresh scan of a
// different UPC that carries any of the same hints hits Tier 1 at
// "exact" confidence and auto-lands on this canonical — no more
// per-product rewire for the same semantic class (sodas, yogurts,
// chicken soups, etc.).
//
// Guards:
//   - Admin-gated at the RLS layer; non-admin callers just eat the
//     error silently (we warn on the first row and move on).
//   - GENERIC_OFF_TAGS filtered out so "beverages" doesn't become
//     a catch-all pointing at whichever beverage was last
//     corrected.
//   - Silent noop when migration 0123 hasn't been applied yet —
//     PostgREST returns 42P01 (undefined_table) which we swallow so
//     old envs keep working.
async function seedTagMap({ userId, canonicalId, categoryHints }) {
  if (!canonicalId || !userId) return;
  if (!Array.isArray(categoryHints) || categoryHints.length === 0) return;
  const now = new Date().toISOString();
  const tags = Array.from(new Set(
    categoryHints
      .map(t => String(t || "").trim().toLowerCase())
      .filter(t => t && !GENERIC_OFF_TAGS.has(t))
  ));
  if (tags.length === 0) return;
  for (const tag of tags) {
    // Read-then-write so correction_count bumps rather than
    // resetting to 1 every time the mapping re-lands on the same
    // canonical. Cheap — tags is small (usually < 10 per scan).
    const { data: existing, error: selErr } = await supabase
      .from("off_category_tag_canonicals")
      .select("off_tag, canonical_id, correction_count")
      .eq("off_tag", tag)
      .maybeSingle();
    if (selErr) {
      if (selErr.code === "42P01") return;    // migration not applied — silent noop
      console.warn("[off_tag_map] select failed:", selErr.message);
      continue;
    }
    if (existing && existing.canonical_id === canonicalId) {
      await supabase
        .from("off_category_tag_canonicals")
        .update({
          correction_count: (existing.correction_count || 1) + 1,
          last_used_at: now,
        })
        .eq("off_tag", tag);
    } else if (existing) {
      // Mapping conflict — latest correction wins, count resets.
      // The admin just told us this tag means `canonicalId`; trust
      // the most recent signal. Future: could keep per-canonical
      // counts instead of one row per tag, but v1 keeps shape
      // simple.
      await supabase
        .from("off_category_tag_canonicals")
        .update({
          canonical_id: canonicalId,
          correction_count: 1,
          last_used_at: now,
        })
        .eq("off_tag", tag);
    } else {
      await supabase
        .from("off_category_tag_canonicals")
        .insert({
          off_tag: tag,
          canonical_id: canonicalId,
          correction_count: 1,
          last_used_at: now,
          created_by: userId,
        });
    }
  }
}
