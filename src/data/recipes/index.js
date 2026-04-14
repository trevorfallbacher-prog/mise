// Central registry of all recipes in the library. New recipes go here.
//
// Exports:
//   RECIPES          — array of every recipe
//   findRecipe(slug) — lookup by slug
//   recipesByCuisine(cuisine)
//   recipesByCategory(category)
//   recipesOnRoute(route) — "plan" | "learn"

import aglioEOlio          from "./aglio-e-olio";
import cacioEPepe          from "./cacio-e-pepe";
import carbonara           from "./carbonara";
import spinachFrittata     from "./spinach-frittata";
import capreseSandwich     from "./caprese-sandwich";
import omeletteFinesHerbes from "./omelette-fines-herbes";
import croqueMonsieur      from "./croque-monsieur";
import soupeALoignon       from "./soupe-a-loignon";
import coqAuVin            from "./coq-au-vin";

export const RECIPES = [
  aglioEOlio,
  capreseSandwich,
  spinachFrittata,
  omeletteFinesHerbes,
  cacioEPepe,
  croqueMonsieur,
  soupeALoignon,
  carbonara,
  coqAuVin,
];

export const findRecipe = (slug) => RECIPES.find(r => r.slug === slug) || null;
export const recipesByCuisine  = (c) => RECIPES.filter(r => r.cuisine === c);
export const recipesByCategory = (c) => RECIPES.filter(r => r.category === c);
export const recipesOnRoute    = (r) => RECIPES.filter(x => x.routes.includes(r));

// Convenience lists
export const CUISINES   = [...new Set(RECIPES.map(r => r.cuisine))].sort();
export const CATEGORIES = [...new Set(RECIPES.map(r => r.category))].sort();

// Display helpers
export function difficultyLabel(n) {
  if (n <= 3) return "Beginner";
  if (n <= 6) return "Intermediate";
  return "Advanced";
}
export function totalTimeMin(recipe) {
  return (recipe.time?.prep || 0) + (recipe.time?.cook || 0);
}
