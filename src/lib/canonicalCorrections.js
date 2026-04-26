import { supabase } from "./supabase";

// Canonical-level identity corrections — teach the system that a
// canonical (regardless of UPC) belongs to a particular food type,
// independent of any specific scanned product.
//
// Complements rememberBarcodeCorrection: that one is keyed by UPC,
// so picking a category for one bottle of "Heinz Ketchup" only
// pre-fills the next scan of THAT exact UPC. A different ketchup
// brand sharing the same `ketchup` canonical wouldn't benefit. This
// lib closes that gap by writing to the canonical metadata layer,
// so EVERY future item bound to that canonical gets the answer.
//
// Two-tier storage matches the rest of the self-teaching memory:
//   * ingredient_info       — admin-only writes, global. Picked up
//                             by every user via dbMap.
//   * pending_ingredient_info — per-user staging, admin-readable.
//                               Promoted to ingredient_info by an
//                               admin in the AdminPanel ENRICHMENTS
//                               queue. Family-scoped until then.
//
// JSONB is schema-flexible (migration 0028); type_id is just a new
// key alongside the existing category / emoji / packaging routing
// fields. No ALTER TABLE needed.

/**
 * Teach the system that a canonical belongs to a particular FOOD_TYPES
 * id (a.k.a. typeId — e.g. "wweia_yogurt", "wweia_pizza").
 *
 * Admins write to the global tier; non-admins write to their own
 * pending row, which an admin can later promote.
 *
 * Fire-and-forget at call sites — failure to teach should never
 * block the user's main flow. The function rejects so callers can
 * .catch(console.warn) but the rejection itself is informational.
 *
 * @param {object} params
 * @param {string} params.userId       — caller's auth uid (required for non-admin path)
 * @param {boolean} params.isAdmin     — routes to global tier when true
 * @param {string} params.canonicalId  — the canonical / ingredient_id to teach against
 * @param {string} params.typeId       — FOOD_TYPES id to associate
 * @param {string} [params.emoji]      — optional, carries with the typeId pick in some flows
 */
export async function rememberCanonicalTypeCorrection({
  userId,
  isAdmin,
  canonicalId,
  typeId,
  emoji,
}) {
  if (!canonicalId || !typeId) return;

  if (isAdmin) {
    // Global tier — merge into ingredient_info.info so the existing
    // description / packaging / nutrition keys aren't clobbered.
    const { data: existing, error: readErr } = await supabase
      .from("ingredient_info")
      .select("info")
      .eq("ingredient_id", canonicalId)
      .maybeSingle();
    if (readErr) throw readErr;
    const merged = { ...(existing?.info || {}), type_id: typeId };
    if (emoji) merged.emoji = emoji;
    const { error } = await supabase
      .from("ingredient_info")
      .upsert(
        { ingredient_id: canonicalId, info: merged },
        { onConflict: "ingredient_id" },
      );
    if (error) throw error;
    return;
  }

  // Family tier — per-user pending row keyed on (user_id, slug).
  // Slug = canonicalId for this teach path; pending_ingredient_info
  // accepts canonical ids as slugs (per migration 0047 comment).
  if (!userId) return;
  const { data: existing, error: readErr } = await supabase
    .from("pending_ingredient_info")
    .select("info")
    .eq("user_id", userId)
    .eq("slug", canonicalId)
    .maybeSingle();
  if (readErr) throw readErr;
  const merged = { ...(existing?.info || {}), type_id: typeId };
  if (emoji) merged.emoji = emoji;
  const { error } = await supabase
    .from("pending_ingredient_info")
    .upsert(
      {
        user_id:     userId,
        slug:        canonicalId,
        source_name: canonicalId,
        info:        merged,
        status:      "pending",
      },
      { onConflict: "user_id,slug" },
    );
  if (error) throw error;
}

/**
 * Crowd-vote read for a canonical's type_id. Asks the SECURITY
 * DEFINER RPC for per-typeId vote counts across all users (RLS would
 * otherwise scope this to the caller's own row, which makes the
 * "is the crowd disagreeing with me?" question impossible).
 *
 * Threshold-gated: returns null until at least `minVotes` users have
 * agreed on a single typeId. Below threshold, the cascade falls
 * through to bundled inference, which is deterministic and right for
 * known canonicals after the head-noun fix in foodTypes.js. Above
 * threshold, the crowd's pick wins over bundled — that's the whole
 * point of the safety net.
 *
 * Tie handling: if the top two typeIds are tied on count, return null
 * (no consensus) rather than picking arbitrarily. The cascade falls
 * through to whatever the next tier suggests.
 *
 * @param {string} canonicalId
 * @param {object} [opts]
 * @param {number} [opts.minVotes=3] — threshold to return a winner
 * @returns {Promise<string|null>} winning typeId or null
 */
export async function fetchCanonicalTypeVote(canonicalId, { minVotes = 3 } = {}) {
  if (!canonicalId) return null;
  const { data, error } = await supabase.rpc("canonical_type_vote_tally", {
    p_canonical_id: canonicalId,
  });
  if (error) {
    console.warn("[canonical-corrections] vote tally failed:", error?.message || error);
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  const top = data[0];
  if (!top || (top.vote_count ?? 0) < minVotes) return null;
  // Tie at the top — no consensus. Don't impose one arbitrarily;
  // let the cascade fall through to bundled inference.
  if (data.length > 1 && data[1].vote_count === top.vote_count) return null;
  return top.type_id || null;
}
