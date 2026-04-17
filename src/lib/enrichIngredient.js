// Client helper for on-demand ingredient metadata enrichment.
//
// Wraps the `enrich-ingredient` edge function so components don't have to
// know about the request shape or the Supabase functions invoke plumbing.
// On success returns the freshly-written pending row (shape matches the
// pending_ingredient_info table); on failure throws with a user-readable
// message.
//
// The edge function also inserts a success/failure notification into the
// user's inbox, so even if the caller doesn't surface the result inline
// the user gets feedback via the bell.

import { supabase } from "./supabase";

/**
 * Kick off an enrichment request.
 *
 * Either `canonical_id` or `source_name` must be supplied:
 *   - canonical_id:  an existing ingredient id from src/data/ingredients.js
 *                    that has no `ingredient_info` row yet (fills the gap
 *                    for one of the ~150 un-seeded canonicals).
 *   - source_name:   user's free-text label for a custom pantry item
 *                    ("Nori from the Japanese store"). The edge function
 *                    slugifies this for the pending row's key.
 *
 * `pantry_item_id` is optional — pass it so the admin queue can link the
 * pending row back to the specific pantry row that triggered the request.
 *
 * @returns {Promise<{ pending: object }>}
 */
export async function enrichIngredient({
  canonical_id = null,
  source_name = null,
  pantry_item_id = null,
} = {}) {
  if (!canonical_id && !source_name) {
    throw new Error("enrichIngredient: one of canonical_id or source_name is required");
  }

  const body = {};
  if (canonical_id) body.canonical_id = canonical_id;
  if (source_name) body.source_name = source_name;
  if (pantry_item_id) body.pantry_item_id = pantry_item_id;

  const { data, error } = await supabase.functions.invoke("enrich-ingredient", {
    body,
  });

  if (error) {
    // supabase-js wraps non-2xx responses as FunctionsHttpError / FunctionsRelayError.
    // Try to surface the underlying JSON { error, detail } if we can.
    let detail = "";
    if (error.context?.body) {
      try {
        const parsed = typeof error.context.body === "string"
          ? JSON.parse(error.context.body)
          : error.context.body;
        detail = parsed?.reason || parsed?.error || parsed?.detail || "";
      } catch {
        // ignore — fall back to generic message
      }
    }
    const msg = detail
      ? `Enrichment failed: ${detail}`
      : `Enrichment failed: ${error.message || "unknown error"}`;
    throw new Error(msg);
  }

  if (!data?.pending) {
    throw new Error("Enrichment succeeded but response was empty");
  }

  return data;
}
