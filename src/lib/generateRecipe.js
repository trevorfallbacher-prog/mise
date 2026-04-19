// Client wrapper over the `generate-recipe` edge function.
//
// Keeps the components out of the supabase.functions.invoke plumbing
// and surfaces a user-readable message when the edge function errors.
// The edge function returns the recipe in the same shape as the bundled
// recipes (src/data/recipes/schema.js) so callers can pass the result
// straight into CookMode.

import { supabase } from "./supabase";

/**
 * Ask Claude to draft a recipe from the current pantry.
 *
 * Two modes:
 *   "final" (default) — full recipe with title + ingredients + steps.
 *                       Same shape as bundled recipes; CookMode-ready.
 *   "sketch"          — title + IDEAL + PANTRY ingredient lists, no
 *                       steps. Fast cheap pass for the tweak loop;
 *                       user reviews + swaps before we commit to a
 *                       full cook.
 *
 * @param {object} opts
 * @param {"sketch"|"final"} [opts.mode]     — default "final"
 * @param {Array<object>} opts.pantry        — curated pantry rows (see src/lib/aiContext.js)
 * @param {object}        [opts.prefs]       — { cuisine?, difficulty?, time?,
 *                                              mealPrompt?, mealTiming?, course?,
 *                                              starIngredientIds?, recipeFeedback? }
 * @param {Array<string>} [opts.avoidTitles] — recent drafts to steer away from on REGEN
 * @param {object}        [opts.context]     — rich context (profile slice + cook history
 *                                             summary); omit or pass null on REGEN to keep
 *                                             the model from re-anchoring on the same
 *                                             pairings as the first draft.
 * @param {Array<object>} [opts.lockedIngredients] — only meaningful in "final" mode;
 *                                             the user's tweaked ingredient list from
 *                                             the sketch phase. Claude builds steps
 *                                             around this set verbatim.
 * @returns {Promise<{ recipe?: object, sketch?: object }>}
 *          — `recipe` when mode = "final", `sketch` when mode = "sketch"
 */
export async function generateRecipe({
  mode = "final",
  pantry = [],
  prefs,
  avoidTitles,
  context,
  lockedIngredients,
} = {}) {
  const { data, error } = await supabase.functions.invoke("generate-recipe", {
    body: {
      mode,
      pantry,
      prefs: prefs || {},
      avoidTitles: Array.isArray(avoidTitles) ? avoidTitles : [],
      context: context || null,
      lockedIngredients: Array.isArray(lockedIngredients) ? lockedIngredients : [],
    },
  });

  if (error) {
    // supabase-js wraps non-2xx responses. Try to pull the underlying
    // { error, detail } JSON so the caller can surface something useful.
    let detail = "";
    if (error.context?.body) {
      try {
        const parsed = typeof error.context.body === "string"
          ? JSON.parse(error.context.body)
          : error.context.body;
        detail = parsed?.detail || parsed?.error || "";
      } catch {
        // ignore — fall through to the generic message
      }
    }
    const msg = detail
      ? `Recipe draft failed: ${detail}`
      : `Recipe draft failed: ${error.message || "unknown error"}`;
    throw new Error(msg);
  }

  // Sketch responses come back as { sketch }; final as { recipe }.
  // Caller handles the shape.
  if (mode === "sketch") {
    if (!data?.sketch) throw new Error("Sketch succeeded but response was empty");
  } else {
    if (!data?.recipe) throw new Error("Recipe draft succeeded but response was empty");
  }

  return data;
}
