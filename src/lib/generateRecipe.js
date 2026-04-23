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
/**
 * Classify a user's mealPrompt into a dish contract. Called once per
 * AIRecipe session (and re-called when mealPrompt changes) so sketch
 * and final both enforce against the same contract. Caching is the
 * caller's responsibility — the edge function does a ~300ms Haiku
 * call and doesn't cache server-side.
 *
 * @param {string} mealPrompt — the user's typed ask (may be "")
 * @returns {Promise<{
 *   tier: "SPECIFIC" | "FAMILY" | "OPEN" | "FREEFORM",
 *   dishName?: string, aliases?: string[], rules?: string,
 *   familyName?: string, familyExamples?: string[], rawPrompt?: string,
 * }>}
 */
export async function classifyDishPrompt(mealPrompt) {
  const { data, error } = await supabase.functions.invoke("generate-recipe", {
    body: {
      mode: "classify",
      prefs: { mealPrompt: typeof mealPrompt === "string" ? mealPrompt : "" },
    },
  });
  if (error || !data?.contract) {
    // Classifier failure is non-fatal — fall through to FREEFORM so
    // the draft still runs (just without deterministic post-check).
    return { tier: mealPrompt?.trim() ? "FREEFORM" : "OPEN", rawPrompt: mealPrompt || "" };
  }
  return data.contract;
}

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
    let rawFromModel = "";
    const ctx = error.context;
    const consumeBody = async () => {
      if (ctx && typeof ctx.text === "function") {
        try { return await ctx.text(); } catch { return ""; }
      }
      if (ctx?.body) {
        return typeof ctx.body === "string" ? ctx.body : JSON.stringify(ctx.body);
      }
      return "";
    };
    const text = await consumeBody();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.detail || parsed?.error || text;
        // When the edge fn 502s because the model returned non-JSON,
        // the raw model output rides in parsed.raw — surface a snippet
        // so the user can tell it was a model hiccup vs an infra
        // issue without opening devtools.
        if (parsed?.raw) {
          rawFromModel = String(parsed.raw).slice(0, 200);
        }
      } catch {
        detail = text;
      }
    }
    const msgBase = detail
      ? `Recipe draft failed: ${String(detail).slice(0, 400)}`
      : `Recipe draft failed: ${error.message || "unknown error"}`;
    const msg = rawFromModel
      ? `${msgBase}\n\nModel said: ${rawFromModel}${rawFromModel.length >= 200 ? "…" : ""}`
      : msgBase;
    // Log the full detail so it's accessible in devtools even when
    // the UI truncates it.
    // eslint-disable-next-line no-console
    console.error("[generate-recipe] edge fn failure", { error, detail, rawFromModel });
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
