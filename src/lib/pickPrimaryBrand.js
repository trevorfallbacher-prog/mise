// pickPrimaryBrand — given a list of candidate brand strings + a
// resolved canonical (or just a category), rank the candidates by
// brand-expertise and return primary + secondary.
//
// The scoring follows the model laid out in
// src/data/brandExpertise.js:
//
//   score(brand, canonical, hub, category) =
//     canonicals[canonical] * 100 +
//     hubs[hub]             *  10 +
//     categories[category]  *   1
//
// Ties break by total observation count (the brand we know the most
// about overall wins).
//
// Worked examples:
//
//   pickPrimaryBrand({
//     brandCandidates: ["Slim Jim", "Buffalo Wild Wings"],
//     canonicalId: "beef_stick",
//   })
//   → primary: "Slim Jim",  secondary: ["Buffalo Wild Wings"]
//     (Slim Jim has canonicals.beef_stick=30 → 30*100 + … ≫ BWW=0)
//
//   pickPrimaryBrand({
//     brandCandidates: ["Mike's Hot Honey", "Boar's Head"],
//     canonicalId: "turkey",
//   })
//   → primary: "Boar's Head", secondary: ["Mike's Hot Honey"]
//     (Boar's Head canonicals.turkey=14 + hubs.turkey_hub=14 → 14*100+14*10+55*1
//      = 1455. Mike's has zero meat signal → 0.)
//
//   pickPrimaryBrand({
//     brandCandidates: ["Buffalo Wild Wings", "Frank's RedHot"],
//     canonicalId: "hot_sauce",
//   })
//   → primary: "Frank's RedHot", secondary: ["Buffalo Wild Wings"]
//     (both have hot_sauce, but Frank's has 12 vs BWW's 8.)
//
// Cold-start (no canonical resolved): the score collapses to
// `brandTotalObservations(brand)`, so the brand we know the most
// about wins the primary slot. Better than alphabetical or
// first-detected, since a known meat-brand still beats an unknown
// six-character-collab string.

import { findIngredient, hubForIngredient } from "../data/ingredients";
import { expertiseFor, brandTotalObservations } from "../data/brandExpertise";
import { subtypeForTypeId } from "../data/subtypeMap";
import { tagHintsToAxes } from "./tagHintsToAxes";

export function scoreBrand(brandDisplay, { canonicalId, hubId, category, subtype } = {}) {
  const xp = expertiseFor(brandDisplay);
  if (!xp) {
    return { score: 0, breakdown: { unknown: true } };
  }
  const canonScore = canonicalId && xp.canonicals?.[canonicalId] || 0;
  const hubScore   = hubId && xp.hubs?.[hubId] || 0;
  const catScore   = category && xp.categories?.[category] || 0;
  // Subtype boost — a binary +50 when the brand declares the product's
  // subtype as one of its credible co-brand subtypes. The weight sits
  // ABOVE the category-level score (typically 5-90) so a brand whose
  // subtypes match dominates over a brand that only matches the broad
  // category. Without this tier, two brands sharing a category (M&M's
  // and Chips Ahoy both pantry, no canonical bound) would tie-break
  // by raw category count — producing M&M's-as-primary on a cookie.
  // With this tier, the cookie-subtype Chips Ahoy outranks the candy-
  // subtype M&M's by 50, and the picker resolves correctly even when
  // the canonical is unknown and only OFF/USDA tags are available.
  const subBoost = (subtype && Array.isArray(xp.subtypes) && xp.subtypes.includes(subtype))
    ? 50
    : 0;
  return {
    score: canonScore * 100 + hubScore * 10 + subBoost + catScore,
    breakdown: { canon: canonScore, hub: hubScore, sub: subBoost, cat: catScore },
  };
}

// Resolve hub + category + subtype for a canonical, cascading through
// every signal we can find when the canonical itself isn't in our
// bundled registry. The cascade is the bridge into OFF/USDA data:
//
//   1. Registry hit       — findIngredient(canonicalId).{subtype, category}
//   2. WWEIA typeId        — subtypeForTypeId(typeId)
//   3. OFF categoryHints   — tagHintsToAxes(offCategoryHints).{subtype, category}
//
// Each tier fills in WHATEVER axes it can; later tiers only fill
// gaps left by earlier tiers. A scan with an unknown UPC + a USDA-
// derived typeId of "wweia_baked_sweets" still resolves
// subtype="cookie" — enough for the picker to demote M&M's as an
// inclusion-licensor on a product whose canonical we've never
// registered.
function axesForCanonical(canonicalId, { typeId, offCategoryHints } = {}) {
  let hubId    = null;
  let category = null;
  let subtype  = null;

  // Tier 1 — bundled registry. Most reliable when present.
  if (canonicalId) {
    const ing = findIngredient(canonicalId);
    if (ing) {
      const hub = hubForIngredient(ing);
      hubId    = hub?.id || null;
      category = ing.category || null;
      subtype  = ing.subtype || null;
      // typeId fallback: the ingredient may carry its own typeId
      // (admin-approved synthetics from useIngredientInfo set this)
      // which feeds the next tier when subtype is still missing.
      if (!typeId && ing.typeId) typeId = ing.typeId;
    }
  }

  // Tier 2 — WWEIA typeId → subtype map. Caller may pass typeId
  // explicitly (typical when canonicalId is null and the resolver
  // got typeId from inferFoodTypeFromName or USDA ingest), or it
  // came from the registry hit above.
  if (!subtype && typeId) {
    subtype = subtypeForTypeId(typeId) || null;
  }

  // Tier 3 — OFF categoryHints. The most permissive bridge —
  // tagHintsToAxes pattern-matches OFF's free-form taxonomy strings
  // and emits category/tileId/typeId/subtype. Use to fill any gap
  // the prior tiers left open.
  if ((!subtype || !category) && Array.isArray(offCategoryHints) && offCategoryHints.length > 0) {
    const hint = tagHintsToAxes(offCategoryHints);
    if (!subtype  && hint.subtype)  subtype  = hint.subtype;
    if (!category && hint.category) category = hint.category;
    // tagHintsToAxes also surfaces typeId for some branches; if we
    // got one and still lack subtype, run the WWEIA bridge once more.
    if (!subtype && hint.typeId)    subtype  = subtypeForTypeId(hint.typeId) || null;
  }

  return { hubId, category, subtype };
}

// Classify each detected brand mention into one of three buckets:
//
//   primary    — the manufacturer (highest-scoring brand for this canonical)
//   secondary  — a co-brand collaborator (other brands that ALSO score
//                meaningfully for this canonical's hub/category)
//   ingredients — inclusion-licensors. A brand whose expertise is
//                concentrated in a DIFFERENT category from this product.
//                "M&M's on a cookie" — M&M's is a candy brand, the
//                cookie isn't part of M&M's expertise, so it's an
//                inclusion claim, not a co-brand.
//
// The decision rule for ingredient demotion:
//   1. The brand has nonzero expertise in our table (i.e. we know it).
//   2. Its score for the product's canonical/hub/category is zero.
//   3. The brand's primary categories don't overlap the product's
//      category at all.
// If all three hold, the brand is a known mention from a foreign
// category — surface it as an inclusion claim, not a brand.
//
// Worked examples (post-seed):
//
//   classifyBrandMentions({
//     brandCandidates: ["Chips Ahoy", "M&M's"],
//     canonicalId: "cookie",
//   })
//   → primary: "Chips Ahoy",
//     secondary: [],
//     ingredients: ["M&M's"]
//     (M&M's expertise is candy/chocolate; cookie isn't theirs.)
//
//   classifyBrandMentions({
//     brandCandidates: ["Ben & Jerry's", "Oreo"],
//     canonicalId: "ice_cream",
//   })
//   → primary: "Ben & Jerry's",
//     secondary: [],
//     ingredients: ["Oreo"]
//     (Oreo IS a real cookie brand, but ice_cream is dairy and not
//      Oreo's home category — so on an ice cream SKU, Oreo is an
//      inclusion claim, not the manufacturer.)
//
//   classifyBrandMentions({
//     brandCandidates: ["Slim Jim", "Buffalo Wild Wings"],
//     canonicalId: "beef_stick",
//   })
//   → primary: "Slim Jim",
//     secondary: ["Buffalo Wild Wings"],
//     ingredients: []
//     (BWW has chicken expertise — meat-adjacent. Same category.
//      Stays a co-brand collaborator, not an inclusion.)
export function classifyBrandMentions({ brandCandidates, canonicalId, hubId: explicitHub, category: explicitCategory, typeId, offCategoryHints }) {
  const ranked = pickPrimaryBrand({
    brandCandidates,
    canonicalId,
    hubId:    explicitHub,
    category: explicitCategory,
    typeId,
    offCategoryHints,
  });
  if (!ranked) return null;

  // Cascade through canonical → typeId → offCategoryHints to derive
  // axes. The bridge means we can still classify (and demote) even
  // when canonicalId is null, as long as USDA typeId or OFF tags
  // give us a subtype/category signal.
  const derived = axesForCanonical(canonicalId, { typeId, offCategoryHints });
  const productCategory = explicitCategory ?? derived.category;
  // If after the full cascade we have NO axis info at all, skip the
  // demotion logic — there's nothing to compare brand expertise
  // against. This used to be `!canonicalId` which was too strict.
  if (!productCategory && !derived.subtype && !derived.hubId) {
    return {
      primary:     ranked.primary,
      secondary:   ranked.secondary,
      ingredients: [],
      scores:      ranked.scores,
    };
  }
  // Subtype is the load-bearing finer-grained axis. "Pantry" is too
  // coarse to distinguish cookies from candy from sauces — the
  // subtype lookup cascades through registry → typeId → OFF tags
  // (axesForCanonical above) so this works even when the canonical
  // isn't in our registry but USDA / OFF can still tell us the
  // product is a cookie. When BOTH the resolved canonical and the
  // candidate brand have subtypes defined, mismatch is the strongest
  // signal that this brand is an inclusion-licensor on this product
  // (M&M's subtypes=["candy"] on a cookie subtype → M&M's is in the
  // cookie, not the brand of the cookie). Brands that credibly co-
  // brand outside their primary subtypes (BWW collaborating on snack
  // meats) opt-in by listing the foreign subtype in their `subtypes`
  // array.
  const productSubtype = derived.subtype || null;

  // Demote candidates that fail the subtype gate (when defined) OR
  // that scored zero AND have expertise concentrated in foreign
  // categories. The primary is never demoted (it's still the best
  // match we have, even if weak); only the runner-ups can turn into
  // ingredients.
  const ingredients = [];
  const secondary   = [];
  for (const display of ranked.secondary) {
    const xp = expertiseFor(display);
    const score = ranked.scores[display] || 0;
    // No expertise record → can't tell, leave as secondary.
    if (!xp) { secondary.push(display); continue; }

    // SUBTYPE GATE — strongest signal when both sides have it. Brand
    // declares the subtypes it credibly co-brands on; canonical
    // declares its subtype. Mismatch → ingredient, regardless of
    // whether category overlaps. This is the cookie-and-M&M's case:
    // both share "pantry" category but M&M's subtypes=["candy"]
    // doesn't include cookie's subtype="cookie" → M&M's demotes.
    const brandSubtypes = Array.isArray(xp.subtypes) ? xp.subtypes : null;
    if (productSubtype && brandSubtypes && brandSubtypes.length > 0) {
      if (!brandSubtypes.includes(productSubtype)) {
        ingredients.push(display);
        continue;
      }
      // Subtype matches → real co-brand. Keep as secondary even if
      // the numeric score happens to be zero (e.g. a brand with no
      // direct canonical/hub overlap but a credible subtype claim).
      secondary.push(display);
      continue;
    }

    // FALL-THROUGH (one or both subtypes missing) — original
    // category-overlap rule. Has expertise here (score > 0) → real
    // co-brand. Score zero AND foreign-category-only → ingredient.
    if (score > 0) { secondary.push(display); continue; }
    const brandCategories = Object.keys(xp.categories || {});
    const overlapsProduct = productCategory
      && brandCategories.includes(productCategory);
    if (!overlapsProduct && brandCategories.length > 0) {
      ingredients.push(display);
    } else {
      secondary.push(display);
    }
  }

  return {
    primary:     ranked.primary,
    secondary,
    ingredients,
    scores:      ranked.scores,
  };
}

export function pickPrimaryBrand({ brandCandidates, canonicalId, hubId: explicitHub, category: explicitCategory, typeId, offCategoryHints }) {
  if (!Array.isArray(brandCandidates)) return null;
  // Dedupe candidates by case-insensitive display, preserving the
  // first-seen capitalization. Multi-pass detectors can otherwise
  // surface the same brand twice ("slim jim" + "Slim Jim").
  const seen = new Set();
  const candidates = [];
  for (const raw of brandCandidates) {
    const display = String(raw || "").trim();
    if (!display) continue;
    const key = display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(display);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { primary: candidates[0], secondary: [], scores: { [candidates[0]]: null } };
  }

  // Resolve hub/category/subtype from canonical if the caller didn't
  // pass them explicitly. Caller can override (e.g. wizard knows the
  // hub from a tile pick even when canonical is null). When the
  // canonical isn't in our registry, axesForCanonical cascades
  // through typeId → offCategoryHints to fill axes — this is the
  // bridge into USDA/OFF data for unknown SKUs.
  const derived = axesForCanonical(canonicalId, { typeId, offCategoryHints });
  const hubId        = explicitHub     ?? derived.hubId;
  const category     = explicitCategory ?? derived.category;
  const subtype      = derived.subtype;

  const scored = candidates.map(display => {
    const s = scoreBrand(display, { canonicalId, hubId, category, subtype });
    return {
      display,
      score:    s.score,
      breakdown: s.breakdown,
      total:    brandTotalObservations(display),
    };
  });

  // Primary sort by score, tie-break by total observation count.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.total - a.total;
  });

  return {
    primary:   scored[0].display,
    secondary: scored.slice(1).map(s => s.display),
    scores:    Object.fromEntries(scored.map(s => [s.display, s.score])),
    breakdown: Object.fromEntries(scored.map(s => [s.display, s.breakdown])),
  };
}
