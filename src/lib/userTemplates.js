import { supabase } from "./supabase";

// User-item-template helpers (migration 0035). A template is the
// blueprint for a recurring custom item — name + emoji + category +
// default unit/amount/location + composition. pantry_items rows are
// instances cloned from templates.
//
// Dedup is strict per family: when a family member saves a custom
// item whose normalized name matches an existing family template,
// we UPSERT onto the existing template (bumping use_count +
// last_used_at) instead of creating a duplicate. This is the
// "I don't want home run inn pizza AND home run inn pizza cheese
// next to each other because someone didn't notice the suggestion"
// rule enforced at write time.

/**
 * Normalize a name for dedup lookups. Lowercases, trims, collapses
 * internal whitespace. "Home Run Inn Pizza" and "home run   inn
 * pizza" land on the same normalized string and therefore the same
 * template row. The original user-typed name stays preserved in the
 * `name` column for display.
 */
export function normalizeTemplateName(name) {
  return (name || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Scan-side template matcher (chunk 17b). Given a scanner-emitted
 * name (raw OCR or vision-API-cleaned string) and a list of the
 * family's templates, return the best match or null.
 *
 * Match priority:
 *   1. Exact normalized name match ("home run inn pizza" matches
 *      a template with the same normalized label)
 *   2. Substring match either direction. Receipt OCR commonly
 *      shortens / truncates ("HOME RUN INN PIZZA CHSE" vs template
 *      "Home Run Inn Pizza"); both should match. Scanner OCR can
 *      also be NOISIER than the template ("Cavatappi Pasta Box"
 *      vs "Cavatappi Pasta"); still match.
 *   3. Null when nothing fits.
 *
 * Family scope is already enforced by the caller's useUserTemplates
 * hook (RLS scopes reads to self + family); this function is a pure
 * string match over the list it's given.
 *
 * When there's a match, the scan pipeline should:
 *   * Override the item's name/emoji/category/tile_id/ingredient_ids
 *     with the template's fields (brand names + tile memory survive)
 *   * Stamp _templateId on the item so we can bump use_count after
 *     the scan is confirmed + committed to pantry_items
 *
 * Returns the template object (camelCase shape from fromDb) or null.
 */
export function findTemplateMatch(scanName, templates) {
  const normalized = normalizeTemplateName(scanName);
  if (!normalized || !Array.isArray(templates) || templates.length === 0) {
    return null;
  }
  // 1. Exact normalized match
  const exact = templates.find(t => t.nameNormalized === normalized);
  if (exact) return exact;
  // 2. Bidirectional substring — prefer the LONGEST template label
  //    that's a substring of the scan (more specific wins); fall back
  //    to the longest scan-as-substring-of-template.
  let best = null;
  let bestLen = 0;
  for (const t of templates) {
    const tnorm = t.nameNormalized || "";
    if (!tnorm) continue;
    if (normalized.includes(tnorm) && tnorm.length > bestLen) {
      best = t;
      bestLen = tnorm.length;
    }
  }
  if (best) return best;
  for (const t of templates) {
    const tnorm = t.nameNormalized || "";
    if (!tnorm) continue;
    if (tnorm.includes(normalized) && normalized.length > bestLen) {
      best = t;
      bestLen = normalized.length;
    }
  }
  return best;
}

/**
 * Find a template in family scope by normalized name. Uses the
 * RLS-aware SELECT (family members' rows are visible), so a single
 * query covers the strict-family-dedup intent:
 *
 *   client: "is 'Home Run Inn Pizza' a template anyone in my family
 *            has already saved?"
 *   server: returns that template if yes (any user_id in family),
 *           null otherwise
 *
 * Called before every save — if a match exists, the save path
 * upserts onto it; otherwise a fresh template is created.
 *
 * Returns the template row (camelCase-mapped) or null.
 */
export async function findTemplateByName(name) {
  const normalized = normalizeTemplateName(name);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("user_item_templates")
    .select("*")
    .eq("name_normalized", normalized)
    .limit(1)
    .maybeSingle();
  if (error) {
    // PGRST116 = no row; maybeSingle already returns null + no error.
    // Other errors (RLS, network) log but don't fail the caller —
    // the worst case is we create a dup the family can merge later.
    console.error("[user_item_templates] lookup failed:", error);
    return null;
  }
  return data ? fromDb(data) : null;
}

/**
 * Save (or upsert) a template from a user's custom-add. Idempotent by
 * normalized name in the family scope:
 *
 *   * No existing template  -> INSERT a new row, use_count=1
 *   * Existing template     -> UPDATE (bump use_count, refresh
 *                              last_used_at, optionally overwrite
 *                              mutable fields if the user supplied
 *                              richer values than what's stored)
 *
 * Components are written via componentsForTemplate (see below) —
 * typically delete-and-replace when the composition changed, skipped
 * entirely when the user is just re-using the same template.
 *
 * Returns the template id (caller may want it for components-write
 * or for bumping use_count on a later instantiation).
 */
export async function saveTemplateFromCustomAdd({
  userId,
  name,
  emoji,
  category,
  unit,
  amount,
  location,
  tileId,
  typeId,
  ingredientIds,
}) {
  if (!userId) return { id: null, error: new Error("userId required") };
  if (!name || !name.trim()) return { id: null, error: new Error("name required") };

  const normalized = normalizeTemplateName(name);

  // 1) Look for an existing family template under the same normalized
  //    name. RLS filters to family scope so we find siblings', too.
  const existing = await findTemplateByName(name);

  if (existing) {
    // UPDATE path — refresh recency + bump use_count. Overwrite
    // the mutable identity fields (emoji/category/default_*) with
    // whatever the user just typed, since their intent is "save
    // this AS the blueprint"; but do NOT clobber the existing
    // ingredient_ids unless the caller supplied non-empty new
    // ones (avoids a user saving "pizza" without components
    // wiping out the family's curated components).
    const patch = {
      name,                            // preserve user's casing
      use_count: (existing.useCount || 1) + 1,
      last_used_at: new Date().toISOString(),
    };
    if (emoji)    patch.emoji            = emoji;
    if (category) patch.category         = category;
    if (unit)     patch.default_unit     = unit;
    if (amount != null) patch.default_amount   = amount;
    if (location) patch.default_location = location;
    if (tileId)   patch.tile_id          = tileId;
    if (typeId)   patch.type_id          = typeId;
    if (Array.isArray(ingredientIds) && ingredientIds.length > 0) {
      patch.ingredient_ids = ingredientIds;
    }
    const { error } = await supabase
      .from("user_item_templates")
      .update(patch)
      .eq("id", existing.id);
    if (error) {
      console.error("[user_item_templates] update failed:", error);
      return { id: existing.id, error };
    }
    return { id: existing.id, error: null, existed: true };
  }

  // 2) INSERT path — fresh template, use_count starts at 1.
  const { data, error } = await supabase
    .from("user_item_templates")
    .insert({
      user_id: userId,
      name,
      name_normalized: normalized,
      emoji:            emoji          || null,
      category:         category       || null,
      default_unit:     unit           || null,
      default_amount:   amount ?? null,
      default_location: location       || null,
      tile_id:          tileId         || null,
      type_id:          typeId         || null,
      ingredient_ids: Array.isArray(ingredientIds) ? ingredientIds : [],
      // use_count defaults to 1 in SQL; explicit here for clarity
      use_count: 1,
      last_used_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("[user_item_templates] insert failed:", error);
    return { id: null, error };
  }
  return { id: data?.id || null, error: null, existed: false };
}

/**
 * Write the composition tree for a template. Delete-and-replace
 * semantics — same as pantry_item_components (6c/6d) with FK-retry
 * on 23503 for race safety. Only call when the composition has
 * actually changed; no-op if components is empty and the template
 * has no existing children.
 *
 * components: [{
 *   kind: 'ingredient' | 'template',
 *   ingredientId?, templateId?,
 *   amount?, unit?, proportion?,
 *   nameSnapshot, ingredientIdsSnapshot?, position?
 * }]
 */
export async function setComponentsForTemplate(parentTemplateId, components) {
  if (!parentTemplateId) {
    return { error: new Error("parentTemplateId required") };
  }

  const { error: delErr } = await supabase
    .from("user_item_template_components")
    .delete()
    .eq("parent_template_id", parentTemplateId);
  if (delErr) {
    console.error("[user_item_template_components] delete failed:", delErr);
    return { error: delErr };
  }

  if (!components || components.length === 0) {
    return { error: null };
  }

  const rows = components.map((c, idx) => ({
    parent_template_id: parentTemplateId,
    child_kind: c.kind,
    child_ingredient_id: c.kind === "ingredient" ? (c.ingredientId || null) : null,
    child_template_id:   c.kind === "template"   ? (c.templateId   || null) : null,
    amount:     c.amount     ?? null,
    unit:       c.unit       ?? null,
    proportion: c.proportion ?? null,
    name_snapshot: c.nameSnapshot || "",
    ingredient_ids_snapshot: Array.isArray(c.ingredientIdsSnapshot)
      ? c.ingredientIdsSnapshot
      : [],
    position: c.position ?? idx,
  }));

  // Same FK-retry pattern as pantry_item_components. The parent
  // template insert is fired through useSyncedList-style persistence;
  // the child components insert can beat it to the server and fail
  // on the FK. Retry exponentially up to 4 times.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error: insErr } = await supabase
      .from("user_item_template_components")
      .insert(rows);
    if (!insErr) return { error: null };
    const isFkRace = insErr.code === "23503";
    if (!isFkRace || attempt === 3) {
      console.error("[user_item_template_components] insert failed:", insErr);
      return { error: insErr };
    }
    await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
  }
  return { error: null };
}

/**
 * Bump use_count + last_used_at on a template. Fire-and-forget —
 * caller doesn't await. Used when the user picks a template from
 * the recents/suggest list and the form auto-fills (no new custom
 * add, just a re-use of an existing blueprint).
 */
export async function bumpTemplateUse(templateId) {
  if (!templateId) return;
  // RPC-style update — fetch-and-update keeps client logic simple
  // at the cost of one extra roundtrip. For recents that's fine;
  // if use_count becomes hot we can move to an atomic increment.
  const { data, error: selErr } = await supabase
    .from("user_item_templates")
    .select("use_count")
    .eq("id", templateId)
    .maybeSingle();
  if (selErr || !data) {
    if (selErr) console.error("[user_item_templates] bump select failed:", selErr);
    return;
  }
  const { error: updErr } = await supabase
    .from("user_item_templates")
    .update({
      use_count: (data.use_count || 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", templateId);
  if (updErr) console.error("[user_item_templates] bump update failed:", updErr);
}

// ── Row <-> item conversion ─────────────────────────────────────────
// camelCase client shape, matches the pattern in usePantry/fromDb.

export function fromDb(row) {
  if (!row) return null;
  return {
    id:              row.id,
    userId:          row.user_id,
    name:            row.name,
    nameNormalized:  row.name_normalized,
    emoji:           row.emoji || null,
    category:        row.category || null,
    defaultUnit:     row.default_unit || null,
    defaultAmount:   row.default_amount != null ? Number(row.default_amount) : null,
    defaultLocation: row.default_location || null,
    tileId:          row.tile_id || null,
    typeId:          row.type_id || null,
    ingredientIds:   Array.isArray(row.ingredient_ids) ? row.ingredient_ids : [],
    useCount:        Number(row.use_count || 0),
    lastUsedAt:      row.last_used_at ? new Date(row.last_used_at) : null,
    promotedAt:      row.promoted_at ? new Date(row.promoted_at) : null,
    createdAt:       row.created_at ? new Date(row.created_at) : null,
    updatedAt:       row.updated_at ? new Date(row.updated_at) : null,
  };
}
