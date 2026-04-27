// Parse a USDA-style ingredient declaration into canonical ids.
//
// USDA's branded_food.csv has an `ingredients` column with the
// verbatim declaration printed on the package:
//
//   "ENRICHED MACARONI PRODUCT (SEMOLINA, DURUM FLOUR, NIACIN,
//    FERROUS SULFATE, THIAMIN MONONITRATE, RIBOFLAVIN, FOLIC ACID),
//    CHEESE SAUCE MIX (WHEY, MILKFAT, MILK PROTEIN CONCENTRATE,
//    SALT, SODIUM TRIPHOSPHATE, CONTAINS LESS THAN 2% OF CITRIC
//    ACID, LACTIC ACID, ...)"
//
// We tokenize that into a normalized comma-separated list, throw
// away parentheticals (the inner expansions are already covered by
// the outer noun in most cases — "CHEESE SAUCE MIX (...)" → keep
// "CHEESE SAUCE MIX", drop the inner; the cheese / milkfat / whey
// surface separately if they appear at the outer level too), then
// run each token through the canonical alias map. The IDs that
// resolve get returned.
//
// Used at scan time when correction.product_metadata.ingredients_text
// is populated by the USDA ingest. The output flows into
// row.ingredient_ids so dietary warnings (dietaryWarningsForRow)
// can walk the full compositional tree without us relabeling
// each canonical with explicit dairy / gluten / etc. flags.

import { inferCanonicalFromNameLongestMatch, findIngredient } from "../data/ingredients";

// Stop-words that should never resolve to a canonical even if they
// happen to overlap one. These are nutrient declarations, additives,
// or generic allergen-statement phrases that shouldn't drive
// ingredient_ids. They're not exhaustive — missing entries just mean
// some bonus tokens resolve to canonicals (mostly harmless).
const NUTRIENT_AND_ADDITIVE_STOPS = new Set([
  "niacin", "thiamin", "thiamine", "riboflavin", "folic acid",
  "vitamin a", "vitamin c", "vitamin d", "vitamin e", "vitamin k",
  "vitamin b12", "vitamin b6", "biotin", "pantothenic acid",
  "ferrous sulfate", "iron", "calcium", "potassium", "zinc",
  "magnesium", "phosphorus", "sodium",
  "monosodium glutamate", "msg", "disodium",
  "citric acid", "lactic acid", "ascorbic acid", "malic acid",
  "phosphoric acid", "tartaric acid", "fumaric acid",
  "carrageenan", "xanthan gum", "guar gum", "pectin",
  "lecithin", "soy lecithin", "sunflower lecithin",
  "maltodextrin", "dextrose", "modified corn starch",
  "natural flavor", "natural flavors", "artificial flavor",
  "artificial flavors", "natural and artificial flavors",
  "color", "colors", "color added", "fd&c yellow", "fd&c red",
  "fd&c blue", "annatto", "caramel color", "titanium dioxide",
  "preservative", "preservatives", "to preserve freshness",
  "potassium sorbate", "sodium benzoate", "calcium propionate",
  "bha", "bht", "tbhq",
  "enzymes", "cultures", "bacterial cultures", "yeast extract",
  "contains", "contains 2% or less of", "contains less than 2% of",
  "and/or", "may contain", "manufactured in",
  "less than", "no more than",
  "water", // present in 80% of products; meaningless as a "claim"
]);

/**
 * Parse a USDA ingredient declaration string into canonical ids.
 *
 * @param {string} text — the verbatim declaration
 * @returns {{ canonicalIds: string[], unmatchedTokens: string[] }}
 *   canonicalIds: deduped, in the order they first appeared
 *   unmatchedTokens: ingredient names that didn't resolve (useful
 *                    for telemetry — what tokens does USDA give us
 *                    that our registry doesn't cover yet?)
 */
export function parseIngredientsText(text) {
  const empty = { canonicalIds: [], unmatchedTokens: [] };
  if (!text || typeof text !== "string") return empty;

  // Strip everything inside parentheses — bracketed expansions are
  // either nutrient lists ("(niacin, thiamin, ...)") or
  // sub-component breakdowns ("WHEY (MILK)") that surface separately
  // at the outer level when they matter. Keeps our token set focused
  // on the load-bearing names. Repeats until no parens remain (handles
  // nested "WHEY [MILK (CONTAINS LACTOSE)]").
  let cleaned = String(text);
  for (let i = 0; i < 6; i += 1) {
    const next = cleaned.replace(/\([^()]*\)/g, " ").replace(/\[[^[\]]*\]/g, " ");
    if (next === cleaned) break;
    cleaned = next;
  }

  // Drop common contains-statement boilerplate (case-insensitive).
  cleaned = cleaned
    .replace(/contains\s+(less\s+than\s+)?2%\s+or\s+less\s+of\s*:?/ig, ",")
    .replace(/contains\s+less\s+than\s+2%\s+of\s*:?/ig, ",")
    .replace(/contains\s*:?/ig, ",")
    .replace(/may\s+contain\s*:?/ig, ",")
    .replace(/and\/or/ig, ",");

  // Tokenize on commas + semicolons (USDA mixes both occasionally).
  const rawTokens = cleaned.split(/[,;]+/).map(t => t.trim()).filter(Boolean);

  const canonicalIds = [];
  const unmatchedTokens = [];
  const seenIds = new Set();

  for (const raw of rawTokens) {
    const token = raw.toLowerCase().replace(/^\W+|\W+$/g, "");
    if (!token) continue;
    if (token.length < 3) continue;
    if (NUTRIENT_AND_ADDITIVE_STOPS.has(token)) continue;
    // Skip percentage / weight clauses ("less than 2%", "5g", etc.)
    if (/^\d/.test(token)) continue;

    // First try the whole token. "BAKING SODA" → baking_soda.
    let id = inferCanonicalFromNameLongestMatch(token);

    // Fallback — when the whole multi-word token doesn't match,
    // try shorter prefixes from the END of the phrase.
    // "CULTURED PASTEURIZED GRADE A NONFAT MILK" → "MILK" → milk.
    // "ENRICHED FLOUR" → "FLOUR" → flour. "WHEAT FLOUR" → "FLOUR"
    // (loses the wheat distinction, but the diet-warn machinery
    // handles dairy / gluten via the resolved canonical's flags).
    if (!id) {
      const words = token.split(/\s+/);
      // Try suffixes from longest to shortest: last 3 words, 2 words,
      // 1 word.
      for (let n = Math.min(3, words.length); n >= 1 && !id; n -= 1) {
        const tail = words.slice(-n).join(" ");
        if (tail.length < 3) continue;
        if (NUTRIENT_AND_ADDITIVE_STOPS.has(tail)) continue;
        id = inferCanonicalFromNameLongestMatch(tail);
      }
    }

    if (id && findIngredient(id)) {
      if (!seenIds.has(id)) {
        seenIds.add(id);
        canonicalIds.push(id);
      }
    } else {
      // Cap unmatched list to keep memory sane on truly verbose
      // declarations.
      if (unmatchedTokens.length < 25) unmatchedTokens.push(raw.trim());
    }
  }

  return { canonicalIds, unmatchedTokens };
}
