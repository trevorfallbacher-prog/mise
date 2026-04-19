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
    // supabase-js v2 wraps the upstream Response in error.context.
    // Reading the body is async (it's a ReadableStream) so the old
    // sync parse missed it and we surfaced Supabase's generic
    // "Edge Function returned a non-2xx status code" instead of the
    // actual detail from the edge function's error payload.
    let detail = "";
    const ctx = error.context;
    if (ctx && typeof ctx.text === "function") {
      try {
        const text = await ctx.text();
        if (text) {
          try {
            const parsed = JSON.parse(text);
            detail = parsed?.detail || parsed?.error || text;
          } catch {
            detail = text;
          }
        }
      } catch {
        // stream already consumed or not readable — fall through
      }
    } else if (ctx?.body) {
      // Older shape: body is a string / object directly on context.
      try {
        const parsed = typeof ctx.body === "string" ? JSON.parse(ctx.body) : ctx.body;
        detail = parsed?.detail || parsed?.error || "";
      } catch {
        // ignore
      }
    }
    const msg = detail
      ? `Recipe draft failed: ${String(detail).slice(0, 400)}`
      : `Recipe draft failed: ${error.message || "unknown error"}`;
    // Log the full detail so it's accessible in devtools even when
    // the UI truncates it.
    // eslint-disable-next-line no-console
    console.error("[generate-recipe] edge fn failure", { error, detail });
    throw new Error(msg);
  }

  // Sketch responses come back as { sketch }; final as { recipe }.
  // If sketch mode receives a { recipe } (the pre-Phase-2 edge
  // function that ignores the mode flag), treat it as a graceful
  // fallback — the caller can land straight in preview skipping
  // the tweak phase. Signals this via data.fellBackToFinal = true.
  if (mode === "sketch") {
    if (!data?.sketch) {
      if (data?.recipe) {
        return { sketch: null, recipe: data.recipe, fellBackToFinal: true };
      }
      throw new Error("Sketch succeeded but response was empty");
    }
  } else {
    if (!data?.recipe) throw new Error("Recipe draft succeeded but response was empty");
  }

  return data;
}
