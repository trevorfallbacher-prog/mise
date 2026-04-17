// Tile-aware pantry matching for recipes.
//
// The existing recipe matcher in CookMode (rowHasIngredient in
// CookMode.jsx) does strict canonical-ingredient matching: a recipe
// calling for `spaghetti` matches a pantry row tagged with
// `spaghetti` or an item whose ingredient_ids[] contains it. That's
// correct but unhelpful when:
//
//   * Registry has a gap — user's "Cavatappi Pasta" (from before 16a
//     added the cavatappi canonical) has ingredient_ids=['flour'],
//     so a recipe calling for `spaghetti` misses it entirely. The
//     user HAS pasta, just not the exact shape.
//   * User has a Meal that could sub — "Leftover Bolognese" with
//     ingredient_ids=[beef, tomato, onion] can't satisfy a recipe
//     calling for `beef` literally because the Meal kind='meal'
//     filter (per CookComplete's "only kind=ingredient matches
//     ingredient slots") excludes Meals.
//
// This module adds the TILE-FALLBACK matcher. If a pantry row has a
// tile_id that matches where the recipe-ingredient would classify,
// count it as a weaker match. The consumer decides whether to
// surface these as first-class suggestions or to hide them behind
// a "show close matches" toggle.
//
// Quality hierarchy (strongest first):
//
//   'exact' — row.ingredient_ids includes the recipe ingredientId
//             (current behavior — unchanged, always wins)
//   'tile'  — row.tileId equals what the recipe ingredient's
//             canonical hub would classify into
//   null    — no match; skip this row
//
// Not wired into the existing CookMode filter path. Callers opt in
// explicitly by using matchRowToRecipeIngredient() instead of
// rowHasIngredient(). Future UX chunks will surface tile-matches
// distinctly ("You have Cavatappi Pasta — swap for the spaghetti?").

import { findIngredient, findHub, hubForIngredient } from "../data/ingredients";
import { FRIDGE_TILES, tileIdForItem as fridgeTileIdForItem } from "./fridgeTiles";
import { PANTRY_TILES, pantryTileIdForItem } from "./pantryTiles";
import { FREEZER_TILES, freezerTileIdForItem } from "./freezerTiles";

const CLASSIFIER_HELPERS = { findIngredient, hubForIngredient };

// Run all three location classifiers and return the first tile that
// any of them assigns to a fake item carrying the given ingredient
// id. We don't know the recipe ingredient's "natural" location
// upfront (flour lives in Pantry, butter lives in Fridge), so we
// try all three and accept the first hit — location is a downstream
// concern for the pantry ROW, not for the recipe ingredient.
function tilesForIngredient(ingredientId) {
  if (!ingredientId) return [];
  const fake = {
    ingredientId,
    category: findIngredient(ingredientId)?.category || null,
  };
  const tiles = new Set();
  const fridge = fridgeTileIdForItem(fake, CLASSIFIER_HELPERS);
  const pantry = pantryTileIdForItem(fake, CLASSIFIER_HELPERS);
  const freezer = freezerTileIdForItem(fake, CLASSIFIER_HELPERS);
  if (fridge)  tiles.add(fridge);
  if (pantry)  tiles.add(pantry);
  if (freezer) tiles.add(freezer);
  return [...tiles];
}

/**
 * matchRowToRecipeIngredient(row, recipeIngredientId)
 *   -> { quality: 'exact' | 'tile' | null, reason?: string }
 *
 * Strongest-match-wins. Exact always beats tile; tile only fires
 * when exact misses.
 *
 * 'exact' quality fires when:
 *   * row.ingredientIds includes the recipeIngredientId, OR
 *   * row.ingredientId === recipeIngredientId (legacy singular)
 *
 * 'tile' quality fires when:
 *   * exact missed, AND
 *   * row.tileId is set, AND
 *   * the recipe ingredient's classifier output includes row.tileId
 *   * -> example: recipe calls for 'spaghetti' (pasta_hub), your
 *      Cavatappi Pasta has tile_id='pasta_grains'. Match quality
 *      = 'tile', reason = 'same tile (pasta_grains)'.
 */
export function matchRowToRecipeIngredient(row, recipeIngredientId) {
  if (!row || !recipeIngredientId) return { quality: null };

  // Exact check — preserves today's behavior
  const rowIds = Array.isArray(row.ingredientIds) && row.ingredientIds.length
    ? row.ingredientIds
    : (row.ingredientId ? [row.ingredientId] : []);
  if (rowIds.includes(recipeIngredientId)) {
    return { quality: "exact" };
  }

  // Canonical identity check (0039). "Franks Best Cheese Dogs" has
  // canonical_id='hot_dog'; a recipe calling for 'hot_dog' matches
  // exactly via this path even though the user's composition
  // ingredient_ids are [cheddar, ground_pork] (no hot_dog tag).
  // Identity is the USDA-defensible "what the thing IS" — recipes
  // rightly ask for things by identity, not composition.
  if (row.canonicalId && row.canonicalId === recipeIngredientId) {
    return { quality: "exact", reason: "canonical identity" };
  }

  // Tile fallback — only when the row has explicit placement
  if (row.tileId) {
    const candidateTiles = tilesForIngredient(recipeIngredientId);
    if (candidateTiles.includes(row.tileId)) {
      return { quality: "tile", reason: `same tile (${row.tileId})` };
    }
  }

  return { quality: null };
}

/**
 * Convenience — returns the row(s) that match a given recipe
 * ingredient, grouped by quality:
 *
 *   { exact: [...rows...], tile: [...rows...] }
 *
 * Consumers render exact matches as primary suggestions and tile
 * matches as "close — tap to confirm" substitutions. Empty arrays
 * when nothing matches (same semantics as an empty filter result).
 */
export function matchPantryRows(pantry, recipeIngredientId) {
  const out = { exact: [], tile: [] };
  if (!Array.isArray(pantry) || !recipeIngredientId) return out;
  for (const row of pantry) {
    const { quality } = matchRowToRecipeIngredient(row, recipeIngredientId);
    if (quality === "exact") out.exact.push(row);
    else if (quality === "tile") out.tile.push(row);
  }
  return out;
}

export { tilesForIngredient };
