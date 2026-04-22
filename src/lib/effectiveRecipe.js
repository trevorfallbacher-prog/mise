// Project a cook-session's overrides into a "live" view of the recipe
// so the Cook-screen renderers see swaps and skips everywhere they
// surface ingredients — not just in the top-of-screen overview.
//
// Problem this solves: useCookSession holds the user's cook-time swaps
// (session.overrides[i].pantryItemId, .skipped) as ephemeral state
// layered on top of the persisted recipe (see useCookSession.js:29-34).
// That layer was honored by the pairing pass in CookMode and by
// CookComplete's "what did you use?" screen, but NOT by the step
// renderer at CookMode.jsx:855-890, which read recipe.ingredients /
// step.uses raw. Swap crepes → tortillas on cook-prep, advance to the
// crepe step, and the step still announced "crepes" — the swap was
// invisible at the moment it mattered most.
//
// Design principle carried forward from useCookSession's docstring:
// this helper is a PURE DERIVATION from (recipe, session, pantry).
// Never store the result. The only write path that materializes the
// derivation is the explicit "save changes as new recipe" action in
// CookComplete — which forks a new user_recipes row and leaves the
// original recipe untouched. Everywhere else, the effective recipe
// is re-derived per render so the source of truth stays the tuple
// (persisted recipe, ephemeral session), not a cached blob that
// drifts.

import { findIngredient } from "../data/ingredients";
import { normalizeForMatch } from "./recipePairing";

// Apply session overrides to a recipe and return the effective view.
// Shape-preserving: effective.ingredients has the same length as
// recipe.ingredients, one-to-one by index, so callers that zip status
// / pairing results by index (CookMode's ingredientStatus at :317,
// pairRecipeIngredients at :336) keep working without changes.
// Swapped ingredients carry `_swappedFrom: { item, ingredientId }` and
// a fresh `pantryItemId`. Skipped ingredients carry `_skipped: true`
// but stay in the array — dropping them would break step.uses rows
// ("Add the — to the pan" is useless to a cook) and pairing indices.
//
// step.uses entries are rewritten the same way: if a use matches a
// swapped slot by ingredientId or normalized name, it inherits the
// replacement's name/id while keeping the step-level amount/state.
// Intermediate products referenced in step.uses ("reserved pasta
// water", "the roux from step 2") have no match in recipe.ingredients
// and pass through untouched.
//
// session.extras (user-added ingredients) are NOT inlined into
// effective.ingredients — they'd change the array length and break
// the by-index invariant. Callers that want them can read
// session.extras directly; CookComplete already does.
export function applyCookSessionToRecipe(recipe, session, pantry = []) {
  if (!recipe) return recipe;
  const overrides = session?.overrides || {};
  const pantryById = new Map((pantry || []).map(p => [p.id, p]));

  // Sanitize residual UI markers off the input. Fork-to-new-recipe
  // calls canonicalizeEffectiveRecipe on save, but v1 forks (before
  // that path shipped) persisted _swappedFrom / _skipped into
  // user_recipes — and without this guard, cooking one of those
  // recipes re-renders the old strikethroughs even though the session
  // is empty. Sanitizing on entry means every effectiveRecipe marker
  // downstream originated from the CURRENT session, nothing inherited.
  const stripMarkers = (obj) => {
    if (!obj) return obj;
    const { _swappedFrom, _skipped, _extra, ...rest } = obj;
    return rest;
  };
  const origIngredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map(stripMarkers);

  // Keyed map from (ingredientId | normalized name) → replacement
  // metadata, so rewriting step.uses doesn't re-run the swap logic
  // per step. ingredientId first (stable), normalized name as
  // fallback (AI drafts don't always carry stable ids).
  const swappedKeys = new Map();

  const effectiveIngredients = origIngredients.map((ing, i) => {
    const ov = overrides[i] || {};
    if (ov.skipped) {
      const marked = { ...ing, _skipped: true };
      if (ing.ingredientId) swappedKeys.set(`id:${ing.ingredientId}`, marked);
      const nm = normalizeForMatch(ing.item || "");
      if (nm) swappedKeys.set(`nm:${nm}`, marked);
      return marked;
    }
    if (ov.pantryItemId) {
      const row = pantryById.get(ov.pantryItemId);
      if (!row) return ing; // pantry row vanished mid-session; leave as-is
      const canonical = row.ingredientId ? findIngredient(row.ingredientId) : null;
      const swapped = {
        ...ing,
        item:          row.name || canonical?.name || ing.item,
        ingredientId:  row.ingredientId || ing.ingredientId || null,
        pantryItemId:  row.id,
        _swappedFrom:  { item: ing.item, ingredientId: ing.ingredientId || null },
      };
      if (ing.ingredientId) swappedKeys.set(`id:${ing.ingredientId}`, swapped);
      const nm = normalizeForMatch(ing.item || "");
      if (nm) swappedKeys.set(`nm:${nm}`, swapped);
      return swapped;
    }
    return ing;
  });

  const origSteps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const effectiveSteps = origSteps.map(step => {
    if (!Array.isArray(step.uses) || step.uses.length === 0) return step;
    const cleanedUses = step.uses.map(stripMarkers);
    const newUses = cleanedUses.map(use => {
      let hit = null;
      if (use.ingredientId) hit = swappedKeys.get(`id:${use.ingredientId}`);
      if (!hit) {
        const nm = normalizeForMatch(use.item || "");
        if (nm) hit = swappedKeys.get(`nm:${nm}`);
      }
      if (!hit) return use;
      if (hit._skipped) {
        return {
          ...use,
          _skipped: true,
          _swappedFrom: { item: use.item, ingredientId: use.ingredientId || null },
        };
      }
      return {
        ...use,
        item:         hit.item,
        ingredientId: hit.ingredientId,
        pantryItemId: hit.pantryItemId,
        _swappedFrom: { item: use.item, ingredientId: use.ingredientId || null },
      };
    });
    return { ...step, uses: newUses };
  });

  return { ...recipe, ingredients: effectiveIngredients, steps: effectiveSteps };
}

// Count how many recipe ingredients are actively swapped or skipped in
// the session. Drives the "N SWAPS · originals preserved" chip in the
// CookMode overview so the user knows the golden recipe is intact.
// Only counts pantryItemId and skipped — used-amount edits aren't
// swaps, they're refinements.
export function countActiveSwaps(session) {
  const overrides = session?.overrides || {};
  let n = 0;
  for (const k of Object.keys(overrides)) {
    const o = overrides[k];
    if (o?.pantryItemId || o?.skipped) n++;
  }
  return n;
}

// Build the per-step swap summary — swaps that specifically rewrote a
// step.uses entry. Returns { from, to, skipped } per uses row. Used
// to label the "FOR THIS STEP" tile; on its own it's too narrow for
// the prose banner + tokenizer because step.uses is a CURATED subset
// of the recipe (bundled recipes only list what the step needs RIGHT
// NOW, so "milk, pesto, capers" in the prose may be absent from
// uses). Use recipeSwapSummary below for prose-reach.
export function stepSwapSummary(step) {
  const uses = Array.isArray(step?.uses) ? step.uses : [];
  const out = [];
  for (const u of uses) {
    if (!u?._swappedFrom) continue;
    out.push({
      from:    u._swappedFrom.item || "(ingredient)",
      to:      u._skipped ? null : (u.item || "(ingredient)"),
      skipped: !!u._skipped,
    });
  }
  return out;
}

// Build a recipe-wide swap summary by walking every ingredient in the
// effective recipe that carries _swappedFrom. This is the right input
// for the prose tokenizer: a step's instruction ("Add the 2% milk,
// pesto, and capers") may mention ingredients the step.uses tile
// doesn't list, so step-scoped summaries miss them. Tokenizer is a
// no-op on entries that don't appear in the prose, so passing the
// full recipe list is safe — deduping happens naturally.
export function recipeSwapSummary(effectiveRecipe) {
  const ingredients = Array.isArray(effectiveRecipe?.ingredients) ? effectiveRecipe.ingredients : [];
  const out = [];
  const seen = new Set();
  for (const ing of ingredients) {
    if (!ing?._swappedFrom) continue;
    const from = ing._swappedFrom.item || "(ingredient)";
    const key = from.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from,
      to:      ing._skipped ? null : (ing.item || "(ingredient)"),
      skipped: !!ing._skipped,
    });
  }
  return out;
}

// Filter a recipe-wide swap list down to the ones relevant for a
// specific step. A swap is "relevant" when either (a) the original
// ingredient name appears in step.instruction prose with a word
// boundary, or (b) the step.uses tile already had _swappedFrom
// stamped on it by applyCookSessionToRecipe. Drives the yellow
// per-step banner — we don't want to blast every swap across every
// step when only one actually applies to what the cook is doing
// right now.
export function relevantSwapsForStep(step, allSwaps) {
  if (!Array.isArray(allSwaps) || allSwaps.length === 0) return [];
  const prose = String(step?.instruction || "");
  const usesHits = new Set();
  const uses = Array.isArray(step?.uses) ? step.uses : [];
  for (const u of uses) {
    if (u?._swappedFrom?.item) usesHits.add(u._swappedFrom.item.toLowerCase());
  }
  const out = [];
  for (const s of allSwaps) {
    const name = (s.from || "").toLowerCase();
    if (!name) continue;
    if (usesHits.has(name)) { out.push(s); continue; }
    if (prose) {
      const escaped = s.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(prose)) {
        out.push(s);
      }
    }
  }
  return out;
}

// Freeze an effective recipe into a persistence-ready canonical shape.
// applyCookSessionToRecipe stamps `_swappedFrom`, `_skipped`, and
// `_extra` markers so the cook UI can render swap indicators,
// strikethroughs, and "↔ was: <original>" annotations. Those markers
// are UI state, NOT persistent data — if we write them through to
// user_recipes, the next cook of the fork re-renders those old swaps
// as if they were fresh session overrides ("Using tortillas instead
// of crepes for this step" on a recipe where tortillas is already
// the canon). Fork-to-new-recipe drops them, and also drops any
// ingredient the user skipped this cook — the fork represents "this
// is how I'm making it now," so skipped ingredients simply aren't
// part of the new canon.
//
// ALSO rewrites step prose (step.title, step.instruction, step.tip,
// step.doneCue) and recipe title/subtitle using the swap map BEFORE
// the markers are stripped. Without this, forking butter → Hiland
// Heavy Whipping Cream saves an ingredient list that says "Hiland
// HWC" but step prose that still reads "Pour into the buttered dish"
// — the word "butter" stranded in the prose after _swappedFrom is
// gone has no way to be struck through on the next cook because the
// tokenizer can no longer see a mapping.
export function canonicalizeEffectiveRecipe(recipe) {
  if (!recipe) return recipe;
  const strip = (obj) => {
    if (!obj) return obj;
    const { _swappedFrom, _skipped, _extra, ...rest } = obj;
    return rest;
  };

  // Collect the swap map while markers are still present. Skipped
  // ingredients don't generate a mapping — they're dropped, not
  // renamed, so prose mentions are left intact for the cook to read
  // around ("Season with salt and pepper to taste" stays legible
  // when pepper is skipped; turning that into a replacement would
  // paper over the choice the user made).
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const swaps = [];
  const seen = new Set();
  for (const ing of ingredients) {
    if (!ing?._swappedFrom || ing._skipped) continue;
    const from = ing._swappedFrom.item;
    const to   = ing.item;
    if (!from || !to) continue;
    const key = from.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    swaps.push({ from, to });
  }

  // Longest-first so "heavy cream" rewrites before "cream" — avoids
  // "heavy <new>" double-rewrites.
  const ordered = [...swaps].sort((a, b) => b.from.length - a.from.length);
  const rewriteProse = (text) => {
    if (typeof text !== "string" || !text || ordered.length === 0) return text;
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `\\b(${ordered.map(s => escape(s.from)).join("|")})\\b`,
      "gi",
    );
    return text.replace(pattern, (match) => {
      const swap = ordered.find(s => s.from.toLowerCase() === match.toLowerCase());
      return swap ? swap.to : match;
    });
  };

  const cleanIngredients = ingredients
    .filter(ing => !ing?._skipped)
    .map(strip);
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const cleanSteps = steps.map(step => {
    const uses = Array.isArray(step.uses) ? step.uses : [];
    const cleanUses = uses.filter(u => !u?._skipped).map(strip);
    return {
      ...step,
      uses:        cleanUses,
      title:       rewriteProse(step.title),
      instruction: rewriteProse(step.instruction),
      tip:         rewriteProse(step.tip),
      doneCue:     rewriteProse(step.doneCue),
    };
  });

  return {
    ...recipe,
    title:    rewriteProse(recipe.title),
    subtitle: rewriteProse(recipe.subtitle),
    ingredients: cleanIngredients,
    steps:       cleanSteps,
  };
}

// Render step.instruction prose with strikethrough+replacement applied
// for each swap. Deterministic regex substitution — no AI call.
// Word-boundary match, case-insensitive, longest-name-first so
// "tortilla" inside "flour tortilla" doesn't match before the longer
// name. Returns an array of React-renderable nodes (strings + {type}
// markers); callers map it into JSX. Plain-text-only by design —
// doesn't attempt grammatical declension (plural / possessive). The
// banner above the prose is the backstop for cases where regex can't
// reach.
//
// The shape returned is a flat array of:
//   { text: "..." }                    — unchanged prose
//   { strike: "crepes", after: "tortillas" }  — swap pair
//   { strike: "crepes", after: null }         — skip
export function tokenizeSwappedInstruction(instruction, swaps) {
  const base = String(instruction || "");
  if (!base || !Array.isArray(swaps) || swaps.length === 0) {
    return [{ text: base }];
  }
  // Longest-first so "flour tortilla" matches before "tortilla".
  const ordered = [...swaps]
    .filter(s => s.from && s.from.trim())
    .sort((a, b) => b.from.length - a.from.length);
  if (ordered.length === 0) return [{ text: base }];

  // Build a single combined regex with named alternation, case-insensitive.
  // Escape regex meta-chars in the source names.
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\b(${ordered.map(s => escape(s.from)).join("|")})\\b`,
    "gi",
  );

  const out = [];
  let lastIdx = 0;
  let m;
  while ((m = pattern.exec(base)) !== null) {
    const matchStart = m.index;
    const matched    = m[0];
    if (matchStart > lastIdx) {
      out.push({ text: base.slice(lastIdx, matchStart) });
    }
    // Find which swap this match belongs to (case-insensitive).
    const lc = matched.toLowerCase();
    const swap = ordered.find(s => s.from.toLowerCase() === lc);
    out.push({
      strike: matched,                           // preserve original casing
      after:  swap && !swap.skipped ? swap.to : null,
    });
    lastIdx = matchStart + matched.length;
  }
  if (lastIdx < base.length) out.push({ text: base.slice(lastIdx) });
  return out;
}
