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
import chickenFajitas      from "./chicken-fajitas";
import steakTacos          from "./steak-tacos";
import sriracha            from "./sriracha";
import pesto               from "./pesto";
import homemadeChickenStock from "./homemade-chicken-stock";

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
  chickenFajitas,
  steakTacos,
  // Compound-ingredient scratch recipes — produce a pantry ingredient
  // rather than a plated meal. See schema.js `produces` docs.
  sriracha,
  pesto,
  homemadeChickenStock,
];

// findRecipe checks the bundled library by default. Callers that want
// user-authored recipes included (CookMode opened from UserProfile,
// Cookbook deep-links to a custom cook) pass a resolver — typically
// useUserRecipes().findBySlug — as the second arg. Bundled slugs win
// on exact collision, matching the "bundled is the stable canon"
// contract we document in the migration 0051 header.
export const findRecipe = (slug, userResolver) => {
  const bundled = RECIPES.find(r => r.slug === slug);
  if (bundled) return bundled;
  if (typeof userResolver === "function") return userResolver(slug) || null;
  return null;
};
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

// ─────────────────────────────────────────────────────────────────────────────
// Suggest-a-meal: score recipes against the current pantry and return a sorted
// list of { recipe, coverage, haveCount, needCount, missing[] }.
//
// We only consider "tracked" ingredients (those with an `ingredientId`).
// Non-tracked ingredients — salt to taste, decorative herbs, pasta water —
// are ignored, because they'd pollute the score with things nobody stocks.
// ─────────────────────────────────────────────────────────────────────────────
export function suggestMeals(pantry = [], { limit = 5, minCoverage = 0 } = {}) {
  const pantryByIng = new Map();
  for (const p of pantry) {
    if (!p.ingredientId) continue;
    const prev = pantryByIng.get(p.ingredientId) || 0;
    pantryByIng.set(p.ingredientId, prev + Number(p.amount || 0));
  }

  const scored = RECIPES.map(recipe => {
    const tracked = (recipe.ingredients || []).filter(i => i.ingredientId);
    const need = tracked.length;
    let have = 0;
    const missing = [];
    for (const ing of tracked) {
      const amount = pantryByIng.get(ing.ingredientId) || 0;
      if (amount > 0) have += 1;
      else missing.push(ing);
    }
    // Coverage is 0..1; recipes with no tracked ingredients get 0 so they
    // don't crowd the top. Those mostly don't exist in our library.
    const coverage = need > 0 ? have / need : 0;
    return { recipe, coverage, haveCount: have, needCount: need, missing };
  });

  return scored
    .filter(s => s.needCount > 0 && s.coverage >= minCoverage)
    .sort((a, b) => {
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      return a.recipe.difficulty - b.recipe.difficulty;
    })
    .slice(0, limit);
}
