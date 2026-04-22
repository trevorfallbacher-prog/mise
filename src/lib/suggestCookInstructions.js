// Client wrapper over the `suggest-cook-instructions` edge function.
//
// Called from CookInstructionsSheet's SUGGEST button. Sends the pantry
// row's identity axes (name, canonical id, brand, state, cut) to the
// edge function, which returns a single cook_instructions block
// matching pantry_items.cook_instructions (migration 0125) / the
// recipes.reheat schema. The user sees the suggestion pre-filled into
// the form and can edit before saving.

import { supabase } from "./supabase";

/**
 * Ask Claude to draft cook / reheat instructions for a pantry row.
 *
 * @param {object} identity
 *   @param {string} [identity.name]         — pantry row display name
 *   @param {string} [identity.canonicalId]  — canonical slug if known
 *   @param {string} [identity.brand]        — optional brand
 *   @param {string} [identity.state]        — optional state axis
 *   @param {string} [identity.cut]          — optional cut axis
 *   @param {string} [identity.category]     — optional food category
 *
 * @returns {Promise<{ cookInstructions?: object, error?: string }>}
 *   cookInstructions is `{ primary: { method, tempF, timeMin, covered, tips } }`
 *   on success. On failure returns `{ error: "user-readable reason" }`.
 */
export async function suggestCookInstructions({
  name, canonicalId, brand, state, cut, category,
} = {}) {
  if (!name && !canonicalId) {
    return { error: "Need a name or canonical id to suggest cook instructions." };
  }
  const { data, error } = await supabase.functions.invoke("suggest-cook-instructions", {
    body: { name, canonicalId, brand, state, cut, category },
  });

  if (error) {
    // supabase-js v2 wraps the upstream Response; dig out the body so
    // the user sees the actual reason rather than "FunctionsHttpError".
    let detail = error.message || "unknown error";
    try {
      const res = error?.context;
      if (res && typeof res.json === "function") {
        const body = await res.json();
        if (body?.error) detail = body.error;
      }
    } catch { /* fall through with whatever we have */ }
    return { error: detail };
  }

  // The recipe-shape response carries steps[] as the load-bearing
  // field (ReheatMode can't render without them); reheat.primary is
  // the summary pill but optional for rendering purposes.
  if (!Array.isArray(data?.cookInstructions?.steps) || data.cookInstructions.steps.length === 0) {
    return { error: "Response missing steps — try again." };
  }
  return { cookInstructions: data.cookInstructions };
}
