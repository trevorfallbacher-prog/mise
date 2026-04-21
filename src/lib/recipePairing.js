// Live re-pairing of recipe ingredients against the current pantry.
//
// The universal rule: pairings are NEVER persisted on the recipe —
// a saved recipe stores canonical refs + dietary intent only. When
// the user opens a preview or enters CookMode, we re-run this
// pairing pass so "We'll use your Great Value Chicken Breast"
// reflects TODAY's pantry, not whatever was stocked the week the
// recipe was first drafted. A month later, if the user has
// different brands or inventory, the pairing is correct without
// any schema rot.
//
// Primitives lifted out of AIRecipe so both the AI-Recipe tweak
// surface, the preview screen, and CookMode can share one
// implementation. Import what you need; everything is pure.

import {
  findIngredient,
  resolveSlug,
  resolveCanonicalIdentity,
  INGREDIENTS,
  fuzzyMatchIngredient,
  ALL_STATE_TOKENS,
  cutLabel,
} from "../data/ingredients";

// ── dietary modifiers ────────────────────────────────────────────────
// "low-carb tortilla" is a tortilla with a claim tag, not a different
// ingredient. We strip these for matching but preserve them as claim
// labels the recipe remembers. If the paired pantry row doesn't
// carry the same claim, pair() surfaces it as `lostClaims` so the
// UI can warn "NO LONGER KETO".
const DIET_MODIFIERS = [
  { re: /\blow[\s\-]?carb\b/gi,        label: "Low-Carb" },
  { re: /\blow[\s\-]?fat\b/gi,         label: "Low-Fat" },
  { re: /\blow[\s\-]?sugar\b/gi,       label: "Low-Sugar" },
  { re: /\blow[\s\-]?sodium\b/gi,      label: "Low-Sodium" },
  { re: /\bzero[\s\-]?carb\b/gi,       label: "Zero-Carb" },
  { re: /\b(?:zero|no)[\s\-]?sugar\b/gi, label: "Sugar-Free" },
  { re: /\bsugar[\s\-]?free\b/gi,      label: "Sugar-Free" },
  { re: /\bgluten[\s\-]?free\b/gi,     label: "Gluten-Free" },
  { re: /\bdairy[\s\-]?free\b/gi,      label: "Dairy-Free" },
  { re: /\bgrain[\s\-]?free\b/gi,      label: "Grain-Free" },
  { re: /\bfat[\s\-]?free\b/gi,        label: "Fat-Free" },
  { re: /\bhigh[\s\-]?protein\b/gi,    label: "High-Protein" },
  { re: /\bwhole[\s\-]?wheat\b/gi,     label: "Whole-Wheat" },
  { re: /\bwhole[\s\-]?grain\b/gi,     label: "Whole-Grain" },
  { re: /\bmulti[\s\-]?grain\b/gi,     label: "Multigrain" },
  { re: /\bketo\b/gi,                  label: "Keto" },
  { re: /\bpaleo\b/gi,                 label: "Paleo" },
  { re: /\bwhole30\b/gi,               label: "Whole30" },
  { re: /\bvegan\b/gi,                 label: "Vegan" },
  { re: /\bvegetarian\b/gi,            label: "Vegetarian" },
  { re: /\borganic\b/gi,               label: "Organic" },
];

export function extractDietaryClaims(name) {
  if (!name) return { claims: [], stripped: "" };
  let stripped = String(name);
  const found = new Set();
  for (const { re, label } of DIET_MODIFIERS) {
    re.lastIndex = 0;
    if (re.test(stripped)) {
      found.add(label);
      re.lastIndex = 0;
      stripped = stripped.replace(re, " ");
    }
  }
  return {
    claims: [...found],
    stripped: stripped.replace(/\s+/g, " ").trim(),
  };
}

// ── name normalization ───────────────────────────────────────────────
// State terms are a separate identity axis per CLAUDE.md (SET STATE
// row, purple). "chicken breast, cubed" and "chicken breast" are the
// same canonical ingredient — only the prep differs. Strip state
// tokens in ANY position (prefix "sliced chicken", comma-suffix
// "chicken breast, cubed", paren-suffix "chicken breast (cubed)",
// inline "ground fresh pork") so the head noun survives for
// identity matching.
//
// Token list is DERIVED from the registry's INGREDIENT_STATES +
// STATE_LABELS via ALL_STATE_TOKENS, so adding a new state in one
// place propagates here automatically — no parallel hardcoded list.
// Regex is built once at module-init by escaping and joining every
// known state token. Word-boundary anchoring catches any position.
const STATE_TOKEN_RE = (() => {
  const escaped = [...ALL_STATE_TOKENS]
    .filter(t => t && /^[a-z]+$/i.test(t))
    .sort((a, b) => b.length - a.length)
    .join("|");
  return escaped ? new RegExp(`\\b(?:${escaped})\\b`, "gi") : /(?!)/;
})();
const BRAND_TOKEN_RE = /\b(gv|great\s*value|kroger|kro|organic|simple\s*truth|365|trader\s*joe'?s?|tj)\b/gi;
const SIZE_TOKEN_RE  = /\b\d+(\.\d+)?\s*(oz|lb|lbs|g|kg|ml|l|ct|count|pack|pk|bag|jar|can|box|tub)\b/gi;

export function normalizeForMatch(name) {
  if (!name) return "";
  const { stripped } = extractDietaryClaims(name);
  return String(stripped)
    .toLowerCase()
    .replace(BRAND_TOKEN_RE, " ")
    .replace(SIZE_TOKEN_RE, " ")
    .replace(STATE_TOKEN_RE, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/s\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Token-level match. Naked `.includes()` was too loose: "tortilla"
// substring-hits "tortilla chip" and "spice mix" overlaps with
// "mexican spice mix", so the AI-sketch auto-pairer was happily
// swapping four tortillas for tortilla chips and a Mexican spice
// blend for a jar of jalapeños. English food names carry identity
// in the HEAD NOUN (the last token) — "corn tortilla", "flour
// tortilla", "whole wheat tortilla" all share head=tortilla and
// are legitimate subs; "tortilla chip" has head=chip, a different
// ingredient entirely. We require (a) heads match AND (b) the
// shorter side's token set is fully contained in the longer's.
export function namesMatch(a, b) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(/\s+/).filter(Boolean);
  const tb = nb.split(/\s+/).filter(Boolean);
  if (!ta.length || !tb.length) return false;
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const sa = new Set(ta);
  const sb = new Set(tb);
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

// True when two canonical slugs belong to the same ingredient family —
// either the exact same slug, or both children of the same _hub parent.
// "chicken" and "chicken_breast" both hang off chicken_hub, so a recipe
// asking for generic Chicken should pair with the user's Chicken
// Breast even though the leaf slugs differ. Hub-level equivalence is
// the identity-stable way to match across cuts without falling back
// to fragile name-string tricks (which tightened namesMatch no longer
// allows — "chicken" and "chicken breast" have different head nouns).
//
// Use sameCanonicalFamily for PAIRING questions ("does the user have
// something that can cover this recipe slot?"). Do NOT use it for
// DEDUCTION questions ("which pantry rows come out when the user
// cooks this?") — hub siblings like heavy_cream + milk are the same
// family but different canonicals, and you don't drain milk to cook
// with heavy cream. resolvesToSameCanonical below is the helper for
// the deduction path.
export function sameCanonicalFamily(slugA, slugB) {
  if (!slugA || !slugB) return false;
  if (slugA === slugB) return true;
  const a = findIngredient(slugA);
  const b = findIngredient(slugB);
  const pa = a?.parentId || a?.id || null;
  const pb = b?.parentId || b?.id || null;
  if (!pa || !pb) return false;
  return pa === pb;
}

// Narrow companion to sameCanonicalFamily: true iff two slugs resolve
// to the SAME canonical after alias redirect. Catches the legacy-
// compound-slug case (chicken_breast alias → chicken matches a
// pantry row tagged chicken + cut=breast) without widening to hub
// siblings. Use this for deduction paths where spending one
// ingredient on another's row would be wrong (heavy_cream recipe
// must NOT drain milk rows, even though they share milk_hub).
export function resolvesToSameCanonical(slugA, slugB) {
  if (!slugA || !slugB) return false;
  if (slugA === slugB) return true;
  const a = resolveCanonicalIdentity(slugA);
  const b = resolveCanonicalIdentity(slugB);
  return !!a.canonical && !!b.canonical && a.canonical === b.canonical;
}

// Resolve a free-text name to a canonical slug via best-score fuzzy
// match. Score-based rather than first-match-wins so "flour
// tortilla" doesn't land on `flour` (listed before `tortillas`).
export function resolveNameToCanonicalId(name) {
  if (!name) return null;
  const { stripped } = extractDietaryClaims(name);
  const needle = (stripped || name).trim();
  if (!needle) return null;
  const hits = fuzzyMatchIngredient(needle, 1);
  const top = Array.isArray(hits) && hits.length > 0 ? hits[0] : null;
  if (top && top.ingredient && typeof top.score === "number" && top.score >= 60) {
    return top.ingredient.id;
  }
  return null;
}

// ── row identity ─────────────────────────────────────────────────────
// HEADER per CLAUDE.md: [Brand] [Canonical] — the big italic title.
// Cut rides along on a SEPARATE row (deriveRowCut) in the rust-
// colored CUT axis below the canonical.
//
// Legacy compound slugs (chicken_breast, ribeye, ...) redirect
// through CANONICAL_ALIASES to the base canonical + a cut hint, so
// a row written before migration 0122 still renders "Chicken · Breast"
// instead of fossilizing as "Chicken Breast" in the header.
export function deriveRowHeader(row) {
  if (!row) return "";
  const canonId = row.ingredientId || row.canonicalId || null;
  const { ingredient } = resolveSlug(canonId);
  if (ingredient) {
    const brand = row.brand ? String(row.brand).trim() : "";
    return brand ? `${brand} ${ingredient.name}` : ingredient.name;
  }
  return row.name || "";
}

// The CUT axis row. Sources in priority order:
//   1. row.cut — new explicit column (migration 0122), authoritative
//   2. alias.cut — legacy compound slug still in ingredient_id /
//                  canonical_id, decoded via resolveSlug
// Returns null when the row has no cut AND the canonical has no
// CUTS_FOR entry (produce, pantry staples — no cut axis rendering).
export function deriveRowCut(row) {
  if (!row) return null;
  if (row.cut) return cutLabel(row.cut);
  const canonId = row.ingredientId || row.canonicalId || null;
  const { cut } = resolveSlug(canonId);
  return cut ? cutLabel(cut) : null;
}

// ── claim diff ───────────────────────────────────────────────────────
// Collect everything claim-shaped off a pantry row: free-text claims
// the user or a scan attached, plus the label of any formal
// certification. Certifications count as claims for diet-loss
// purposes: USDA Organic IS Organic, Gluten-Free cert IS Gluten-Free.
function pantryRowClaimSet(row) {
  if (!row || !row.attributes) return new Set();
  const raw = [
    ...(Array.isArray(row.attributes.claims) ? row.attributes.claims : []),
    ...(Array.isArray(row.attributes.certifications)
      ? row.attributes.certifications.map(c => c?.label).filter(Boolean)
      : []),
  ];
  return new Set(raw.map(c => String(c).toLowerCase()));
}

function lostClaimsFor(requiredClaims, row) {
  if (!Array.isArray(requiredClaims) || requiredClaims.length === 0) return [];
  if (!row) return [];
  const have = pantryRowClaimSet(row);
  return requiredClaims.filter(c => !have.has(String(c).toLowerCase()));
}

// ── pairing ──────────────────────────────────────────────────────────
// Per-ingredient pairing against the current pantry.
//
// Output shape:
//   {
//     ingredient,         // the recipe row as-is
//     paired,             // canonical-match pantry row, or null
//     closestMatch,       // same-family fallback, or null
//     lostClaims,         // recipe claims the chosen row doesn't carry
//     status,             // "paired" | "substitute" | "missing"
//   }
//
// "paired"      — ingredient's canonical id is present in pantry on
//                 an unclaimed row. Exact identity match.
// "substitute"  — no canonical hit, but something in the same
//                 category is on hand (flour tortilla for a
//                 low-carb tortilla ask, feta for cotija). Shown
//                 with a "closest match" banner.
// "missing"     — nothing close on hand. Shopping-list territory.
export function pairRecipeIngredients(ingredients, pantry) {
  const used = new Set();
  const out = [];
  for (const ing of ingredients || []) {
    const ingName = ing.item || ing.name || "";
    const ingCanonId = ing.ingredientId || resolveNameToCanonicalId(ingName) || null;
    const ingCanon = ingCanonId ? findIngredient(ingCanonId) : null;

    // Tier 0 — explicit pantryItemId from an upstream swap/bind.
    // When the user swaps "Mozzarella" for their Great Value string
    // cheese on the AI draft, buildLockedIngredients writes
    // pantryItemId onto the committed recipe row. That binding is
    // authoritative — re-matching by name at cook time would throw
    // it away and (as seen in practice) fall through to a category
    // fallback that pairs the string cheese with powdered sugar.
    // Honoring pantryItemId here means every downstream render
    // (cook prep, preview, schedule) shows the exact row the user
    // picked, not whatever a fresh name-matcher lands on.
    let paired = null;
    if (ing.pantryItemId) {
      paired = (pantry || []).find(p =>
        p && !used.has(p.id) && p.id === ing.pantryItemId,
      ) || null;
    }

    // Tier 1 — exact canonical match (or hub/sibling equivalence).
    // A recipe asking for `chicken_breast` pairs with a pantry row
    // carrying chicken_breast directly. Hub equivalence (asking for
    // `chicken_hub` but having `chicken_thigh`) also paired — same
    // parent means same ingredient family.
    if (!paired && ingCanonId) {
      paired = (pantry || []).find(p => {
        if (!p || used.has(p.id)) return false;
        const pCanonId = p.ingredientId || p.canonicalId || null;
        if (!pCanonId) return false;
        if (pCanonId === ingCanonId) return true;
        const pCanon = findIngredient(pCanonId);
        // hub/sibling match: same hub parent counts as paired for
        // identity purposes (user can pick the cut at cook time).
        const pParent = pCanon?.parentId || pCanon?.id;
        const iParent = ingCanon?.parentId || ingCanon?.id;
        if (pParent && iParent && pParent === iParent) return true;
        return false;
      }) || null;
    }

    // Tier 2 — name-fuzzy match, scoped to genuinely-ambiguous rows.
    // Fires only when AT LEAST ONE side lacks a resolvable canonical
    // — e.g. a pre-canonical free-text pantry row, or a recipe
    // ingredient the AI left untagged. When BOTH sides carry valid
    // canonicals and Tier 1 didn't match, the canonicals are
    // authoritative: they're saying "these are different ingredients"
    // and a name-based match here is a false positive waiting to
    // happen. (Historical source of the powdered-sugar-vs-string-
    // cheese class of bug when display names collided on a token.)
    if (!paired && ingName) {
      const ingCanonValid = !!(ingCanonId && ingCanon);
      paired = (pantry || []).find(p => {
        if (!p || used.has(p.id)) return false;
        const pCanonId = p.ingredientId || p.canonicalId || null;
        const pCanon   = pCanonId ? findIngredient(pCanonId) : null;
        const pCanonValid = !!(pCanonId && pCanon);
        if (ingCanonValid && pCanonValid) return false;
        return namesMatch(p.name, ingName);
      }) || null;
    }

    // Tier 3 — closest-match (substitute band). Substitute is a real
    // thing: recipe wants cotija, user has feta, both cheese_hub —
    // legit swap. But "same category" alone was too broad: "pantry"
    // bucket holds flour + sugar + salt + crackers + cheese; the
    // first one in that bucket would become the "closest match" for
    // string cheese, yielding nonsense like "Closest match in pantry:
    // Powdered Sugar." Require EITHER same hub (true sibling) OR
    // same category WITH at least one shared token — kills the
    // cross-category false positive while still catching dairy-↔-
    // dairy subs like cream cheese ↔ sour cream via "cream".
    let closestMatch = null;
    if (!paired && ingCanon) {
      const ingHub = ingCanon.parentId || ingCanon.id;
      const ingTokens = new Set(
        normalizeForMatch(ingName).split(/\s+/).filter(Boolean),
      );
      closestMatch = (pantry || []).find(p => {
        if (!p || used.has(p.id)) return false;
        const pCanonId = p.ingredientId || p.canonicalId || null;
        if (!pCanonId) return false;
        const pCanon = findIngredient(pCanonId);
        if (!pCanon) return false;
        const pHub = pCanon.parentId || pCanon.id;
        if (pHub && ingHub && pHub === ingHub) return true;
        if (!pCanon.category || pCanon.category !== ingCanon.category) return false;
        const pTokens = new Set(
          normalizeForMatch(p.name || "").split(/\s+/).filter(Boolean),
        );
        for (const t of ingTokens) if (pTokens.has(t)) return true;
        return false;
      }) || null;
    }

    const chosen = paired || closestMatch;
    if (chosen) used.add(chosen.id);

    // Diet-loss diff. Required claims come from the recipe row's
    // stored dietaryClaims (persisted intent) OR re-extracted from
    // the display name as a fallback for older recipes without the
    // field. If the chosen row doesn't cover every required claim,
    // the deltas go into lostClaims for the UI to surface.
    const requiredClaims = Array.isArray(ing.dietaryClaims) && ing.dietaryClaims.length > 0
      ? ing.dietaryClaims
      : extractDietaryClaims(ingName).claims;
    const lostClaims = lostClaimsFor(requiredClaims, chosen);

    const status = paired ? "paired" : closestMatch ? "substitute" : "missing";
    out.push({ ingredient: ing, paired, closestMatch, lostClaims, status });
  }
  return out;
}

// Render-ready description for a single pairing row. Returns
//   { tone: "gray" | "amber" | "red", text: "...", lostClaims: [...] }
// or null when the ingredient shouldn't show a pairing banner
// (e.g. decorative rows with no ingredientId and no name signal).
//
// tone colors (match AIRecipe's existing pill palette):
//   gray   — clean pair, in-kitchen confirmation
//   amber  — substitute or missing, no dietary conflict
//   red    — dietary conflict (keto/vegan/etc. lost on this sub)
export function describePairing(pairing) {
  if (!pairing) return null;
  const { ingredient, paired, closestMatch, lostClaims, status } = pairing;
  // Skip rows without any identity signal — nothing useful to say.
  if (!ingredient?.ingredientId && !ingredient?.item && !ingredient?.name) return null;

  if (status === "paired") {
    const loc = paired.location ? ` from your ${paired.location}` : "";
    const header = deriveRowHeader(paired) || paired.name || "pantry item";
    return {
      tone: lostClaims.length > 0 ? "red" : "gray",
      text: `We'll use your ${header}${loc}`,
      lostClaims,
    };
  }
  if (status === "substitute") {
    const header = deriveRowHeader(closestMatch) || closestMatch.name || "pantry item";
    return {
      tone: lostClaims.length > 0 ? "red" : "amber",
      text: `Closest match in pantry: ${header}`,
      lostClaims,
    };
  }
  return {
    tone: "amber",
    text: "Not in pantry — add to shopping list",
    lostClaims: [],
  };
}

// Intentionally unused by the consumer API but exported for tests /
// adjacent modules that want the raw claim-set view.
export { pantryRowClaimSet };

// Keep ESLint from flagging INGREDIENTS as unused — imported for
// future extensions (hub scans) and to guarantee the registry is
// warm before consumers call resolve/pair.
export const _REGISTRY = INGREDIENTS;
