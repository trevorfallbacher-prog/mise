// Slug strategy helper for AI-suggested canonicals.
//
// The MemoryBookCapture flow lands on a Haiku-suggested canonical
// name like "Soda" or "Greek Yogurt". Before we let the user create
// a brand-new synthetic canonical for it, we try to BIND to an
// existing canonical the registry already knows about. This avoids
// slug proliferation: ten different Pepsi UPCs shouldn't each
// spawn `pepsi_zero_sugar_cola`, `diet_pepsi`, `pepsi_max` synthetics
// when the bundled `soda` canonical covers all three.
//
// Decision tiers, by fuzzy score against the registry:
//   score >= 80   → `bind` — silently land on the existing canonical
//   score 60-79   → `suggest` — surface as "Looks like {existing}?"
//                   the user can confirm or reject
//   score < 60    → `create` — fall through to canonical-create with
//                   the AI suggestion pre-filled
//
// Decision tiers were calibrated empirically: at 80, the registry's
// fuzzyMatchIngredient produces unambiguous hits (the cleanProductName
// path treats 75 as the auto-apply threshold); 60-79 is "plausible
// but worth confirming"; <60 is genuinely novel.

import { fuzzyMatchIngredient, findIngredient } from "../data/ingredients";

/**
 * Resolve an AI-suggested canonical name against the registry.
 *
 * Returns one of:
 *   { decision: "bind",    canonicalId, ingredient, score }
 *   { decision: "suggest", canonicalId, ingredient, score, suggestedName }
 *   { decision: "create",  suggestedName, suggestedSlug, score? }
 */
export function bindOrCreateCanonical(suggestedName) {
  const name = String(suggestedName || "").trim();
  if (!name) {
    return { decision: "create", suggestedName: "", suggestedSlug: "" };
  }

  const matches = fuzzyMatchIngredient(name, 1) || [];
  const top = matches[0];

  if (top && top.ingredient && typeof top.score === "number") {
    if (top.score >= 80) {
      return {
        decision:    "bind",
        canonicalId: top.ingredient.id,
        ingredient:  top.ingredient,
        score:       top.score,
      };
    }
    if (top.score >= 60) {
      return {
        decision:      "suggest",
        canonicalId:   top.ingredient.id,
        ingredient:    top.ingredient,
        score:         top.score,
        suggestedName: name,
      };
    }
  }

  // No match worth surfacing — let the canonical-create path handle
  // it with the AI suggestion as a prefill.
  return {
    decision:      "create",
    suggestedName: name,
    suggestedSlug: nameToSlug(name),
    score:         top?.score ?? 0,
  };
}

/**
 * Resolve a canonical id directly by string lookup. Mirrors the
 * registry's findIngredient but boxed so call sites that take a
 * possibly-falsy id don't have to guard separately.
 */
export function lookupCanonical(canonicalId) {
  if (!canonicalId) return null;
  return findIngredient(canonicalId) || null;
}

// Lower-snake-case slug from a display name. "Greek Yogurt" → "greek_yogurt".
// Trims to 80 chars so a malformed AI response can't write a 4KB slug into
// the canonical_id column.
function nameToSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}
