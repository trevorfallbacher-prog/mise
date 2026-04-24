// ─────────────────────────────────────────────────────────────────────────────
// Deterministic ingredient-matching engine — used by AI recipe flows
// to turn raw text + claimed canonical IDs + UPCs into a canonical
// resolution with explicit confidence and alternatives.
//
// Priority order (short-circuit at first hit):
//   0. Blocked-alias hard stop (overrides everything; raw text wins)
//   1. Valid canonical_id (input.canonicalId already exists in registry)
//   2. UPC match (via context.findBarcodeCorrection)
//   3. Strong alias (1:1 safe mapping)
//   4. Weak alias with context priors
//   5. Fuzzy fallback (fuzzyMatchIngredient)
//   6. Hub fallback (nearest hub canonical — never null)
//
// ALWAYS returns { canonical_id, confidence, alternatives, tier, reason }.
// canonical_id is NEVER null; confidence reflects how much we trust it.
// ─────────────────────────────────────────────────────────────────────────────

import {
  INGREDIENTS,
  HUBS,
  CANONICAL_ALIASES,
  findIngredient,
  fuzzyMatchIngredient,
  resolveCanonicalIdentity,
} from "../data/ingredients.js";
import {
  STRONG_ALIASES,
  WEAK_ALIASES,
  BLOCKED_ALIASES,
  CONTEXT_PRIORS,
  REQUIRED_INGREDIENTS_BY_DISH,
} from "../data/ingredientAliases.js";

const VALID_IDS = (() => {
  const s = new Set();
  for (const ing of INGREDIENTS) s.add(ing.id);
  for (const hub of HUBS) s.add(hub.id);
  for (const legacy of Object.keys(CANONICAL_ALIASES)) s.add(legacy);
  return s;
})();

// Hub-fallback category rules. Pattern → hub id. Evaluated in order;
// first match wins. Deliberately conservative — the hub fallback is
// the resolver's last line of defense and should only fire when we're
// confident about the BROAD category.
const HUB_FALLBACK_RULES = [
  { pattern: /\b(chicken|hen|poultry)\b/, hub: "chicken_hub" },
  { pattern: /\b(beef|steak|brisket|ribeye)\b/, hub: "beef_hub" },
  { pattern: /\b(pork|bacon|ham|sausage)\b/, hub: "pork_hub" },
  { pattern: /\b(turkey)\b/, hub: "turkey_hub" },
  { pattern: /\b(fish|salmon|tuna|cod|shrimp|scallop|seafood)\b/, hub: "seafood_hub" },
  { pattern: /\b(cheese|mozzarella|cheddar|parmesan|feta|brie)\b/, hub: "cheese_hub" },
  { pattern: /\b(milk|buttermilk|half and half)\b/, hub: "milk_hub" },
  { pattern: /\b(yogurt|yoghurt)\b/, hub: "yogurt_hub" },
  { pattern: /\b(pasta|spaghetti|penne|fettuccine|linguine|ziti|rigatoni|lasagna)\b/, hub: "pasta_hub" },
  { pattern: /\b(rice|risotto|pilaf)\b/, hub: "rice_hub" },
  { pattern: /\b(bread|loaf|bagel|baguette|ciabatta|sourdough)\b/, hub: "bread_hub" },
  { pattern: /\b(flour)\b/, hub: "flour_hub" },
  { pattern: /\b(beans?|legume|chickpea|lentil)\b/, hub: "bean_hub" },
];

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True iff `id` is a real canonical in the bundled registry, hubs,
 * or legacy alias table. Used to reject LLM-invented slugs.
 */
export function validateCanonicalId(id) {
  if (!id || typeof id !== "string") return false;
  return VALID_IDS.has(id);
}

function resolveVia(tier, canonical_id, confidence, alternatives, reason) {
  return {
    canonical_id,
    confidence: Math.max(0, Math.min(1, confidence)),
    alternatives: Array.isArray(alternatives) ? alternatives.filter(a => a && a !== canonical_id) : [],
    tier,
    reason: reason || "",
  };
}

function checkBlocked(rawNorm, claimedId) {
  if (!rawNorm) return null;
  const rule = BLOCKED_ALIASES[rawNorm];
  if (!rule) return null;
  const forbidden = new Set(rule.forbid || []);
  if (claimedId && forbidden.has(claimedId)) {
    return resolveVia(
      "blocked-safe",
      rule.redirectTo,
      0.98,
      [],
      `claimed canonical "${claimedId}" is blocked for raw text "${rawNorm}"; redirected to ${rule.redirectTo}`,
    );
  }
  // Blocked phrase with no wrong-claim to override — still short-circuit
  // so fuzzy never gets a chance to mis-match "peanut butter" → butter.
  return resolveVia(
    "blocked-safe",
    rule.redirectTo,
    0.95,
    [],
    `raw text "${rawNorm}" redirected via blocked-alias rule`,
  );
}

function tokensOf(s) {
  return normalize(s).split(/\s+/).filter(Boolean);
}

function anyTokenMatch(haystack, needles) {
  if (!haystack || !needles || !needles.length) return false;
  const h = normalize(haystack);
  return needles.some(n => h.includes(normalize(n)));
}

function anyListMatch(list, needles) {
  if (!Array.isArray(list) || !list.length) return false;
  return list.some(item => anyTokenMatch(item, needles));
}

function scoreWeakCandidates(key, entry, context) {
  const votes = new Map();
  for (const c of entry.candidates) votes.set(c, 0);

  const priors = CONTEXT_PRIORS[key] || [];
  const dishName = context?.dishContract?.dishName || "";
  const familyName = context?.dishContract?.familyName || "";
  const title = context?.recipeTitle || "";
  const cos = context?.coIngredients || [];

  // Signal weights:
  //   titleTokens / dishFamily = 2 (specific, authoritative)
  //   cooccurs                 = 1 (can be a generic staple like
  //                                  "flour, sugar" which fits many dishes)
  for (const rule of priors) {
    let weight = 0;
    if (rule.when.titleTokens && anyTokenMatch(title, rule.when.titleTokens)) weight += 2;
    if (rule.when.dishFamily && (anyTokenMatch(dishName, rule.when.dishFamily) || anyTokenMatch(familyName, rule.when.dishFamily))) weight += 2;
    if (rule.when.cooccurs && anyListMatch(cos, rule.when.cooccurs)) weight += 1;
    if (weight === 0) continue;
    if (!votes.has(rule.prefer)) votes.set(rule.prefer, 0);
    votes.set(rule.prefer, votes.get(rule.prefer) + weight);
  }

  // Historical match = 2 votes (a taught answer beats a heuristic).
  const hist = context?.historicalMatches?.[key];
  if (hist && votes.has(hist)) votes.set(hist, votes.get(hist) + 2);
  else if (hist) votes.set(hist, (votes.get(hist) || 0) + 2);

  // Pantry bias — a candidate the user already has in pantry gets +1.
  const pantry = new Set(context?.pantryCanonicals || []);
  for (const c of entry.candidates) {
    if (pantry.has(c)) votes.set(c, (votes.get(c) || 0) + 1);
  }

  const ranked = [...votes.entries()]
    .filter(([id]) => validateCanonicalId(id))
    .sort((a, b) => b[1] - a[1]);
  const topVotes = ranked.length ? ranked[0][1] : 0;
  return { ranked, topVotes };
}

function hubFallback(rawNorm) {
  for (const rule of HUB_FALLBACK_RULES) {
    if (rule.pattern.test(rawNorm)) {
      return resolveVia(
        "hub-fallback",
        rule.hub,
        0.15,
        [],
        `raw text "${rawNorm}" matched hub category ${rule.hub}`,
      );
    }
  }
  // Last resort — pantry hub doesn't exist, so pick flour_hub which is
  // the generic dry-goods placeholder. Callers should treat confidence
  // < 0.2 as "unknown" and prompt the user.
  return resolveVia(
    "hub-fallback",
    "flour_hub",
    0.10,
    [],
    `no hub category matched raw text "${rawNorm}" — fell back to flour_hub`,
  );
}

/**
 * Resolve a raw ingredient string (with optional claimed canonical_id
 * and UPC) into a canonical id. NEVER returns null — falls back to a
 * hub when nothing else matches.
 *
 * @param {string | {rawText?: string, canonicalId?: string|null, upc?: string|null}} input
 * @param {object} [context]
 * @param {string} [context.recipeTitle]
 * @param {object} [context.dishContract]
 * @param {string[]} [context.coIngredients]
 * @param {string[]} [context.pantryCanonicals]
 * @param {Record<string,string>} [context.historicalMatches]
 * @param {(upc: string) => object|null} [context.findBarcodeCorrection]
 * @returns {{canonical_id: string, confidence: number, alternatives: string[], tier: string, reason: string}}
 */
export function resolveIngredient(input, context = {}) {
  const rawText = typeof input === "string" ? input : (input?.rawText || "");
  const claimedId = typeof input === "object" && input ? (input.canonicalId || null) : null;
  const upc = typeof input === "object" && input ? (input.upc || null) : null;
  const rawNorm = normalize(rawText);

  // Step 0 — blocked-alias hard stop. Runs BEFORE trusting the
  // claimed canonicalId so "peanut butter" with claimedId "butter"
  // gets redirected to peanut_butter.
  const blocked = checkBlocked(rawNorm, claimedId);
  if (blocked) return blocked;

  // Step 1 — trust a valid claimed canonical id. This is the common
  // case: Claude echoed a real pantry id verbatim, or the client
  // already resolved the item on a prior pass.
  if (claimedId && validateCanonicalId(claimedId)) {
    return resolveVia(
      "canonical",
      claimedId,
      1.0,
      [],
      `input.canonicalId "${claimedId}" is a valid canonical`,
    );
  }

  // Step 2 — UPC resolution via the three-layer correction cascade.
  if (upc && typeof context.findBarcodeCorrection === "function") {
    try {
      const correction = context.findBarcodeCorrection(upc);
      const cid = correction?.canonicalId || correction?.canonical_id;
      if (cid && validateCanonicalId(cid)) {
        return resolveVia(
          "upc",
          cid,
          0.95,
          [],
          `upc ${upc} resolved via barcode correction`,
        );
      }
    } catch {
      // Swallow; treat as cache miss and continue.
    }
  }

  // Step 3 — strong alias exact match.
  if (rawNorm && STRONG_ALIASES[rawNorm]) {
    const sid = STRONG_ALIASES[rawNorm];
    if (validateCanonicalId(sid)) {
      return resolveVia(
        "strong",
        sid,
        0.90,
        [],
        `strong alias "${rawNorm}" → ${sid}`,
      );
    }
  }

  // Step 4 — weak alias with context priors.
  if (rawNorm && WEAK_ALIASES[rawNorm]) {
    const entry = WEAK_ALIASES[rawNorm];
    const { ranked, topVotes } = scoreWeakCandidates(rawNorm, entry, context);
    const winner = ranked.length ? ranked[0][0] : entry.defaultCanonical;
    const alternatives = ranked.slice(1).map(([id]) => id);
    if (alternatives.length === 0) {
      for (const c of entry.candidates) {
        if (c !== winner && validateCanonicalId(c)) alternatives.push(c);
      }
    }
    const confidence =
      topVotes >= 3 ? 0.85
      : topVotes === 2 ? 0.75
      : topVotes === 1 ? 0.65
      : 0.45;
    return resolveVia(
      "weak",
      winner,
      confidence,
      alternatives,
      `weak alias "${rawNorm}" resolved via ${topVotes} context vote(s)`,
    );
  }

  // Step 5 — fuzzy fallback. Wraps fuzzyMatchIngredient; top result
  // becomes the answer, next 2 become alternatives.
  if (rawNorm) {
    const shopping = (context.pantryCanonicals || []).map(id => ({ ingredientId: id }));
    const matches = fuzzyMatchIngredient(rawText, 5, shopping);
    if (matches.length > 0) {
      const top = matches[0];
      const alternatives = matches.slice(1).map(m => m.ingredient.id);
      const confidence = Math.max(0.30, Math.min(0.75, top.score / 100));
      return resolveVia(
        "fuzzy",
        top.ingredient.id,
        confidence,
        alternatives,
        `fuzzy match "${rawText}" → ${top.ingredient.id} (score ${top.score})`,
      );
    }
  }

  // Step 6 — hub fallback. Never null.
  return hubFallback(rawNorm);
}

/**
 * Resolve a list of raw ingredient inputs iteratively, seeding each
 * subsequent call's coIngredients with the resolved canonicals from
 * earlier entries. Lets "butter" in a list alongside already-resolved
 * "peanut_butter_cookies_flour" pick up the peanut-butter prior.
 *
 * @param {Array<string | object>} items
 * @param {object} [context]
 */
export function resolveIngredientList(items, context = {}) {
  const out = [];
  const resolvedCanonicals = [];
  const coIngredients = [...(context.coIngredients || [])];
  // Seed co-ingredients with every raw name up front so each row has
  // full list visibility on the first pass.
  for (const item of items || []) {
    const raw = typeof item === "string" ? item : (item?.rawText || "");
    if (raw) coIngredients.push(raw);
  }
  for (const item of items || []) {
    const r = resolveIngredient(item, { ...context, coIngredients, pantryCanonicals: [...(context.pantryCanonicals || []), ...resolvedCanonicals] });
    out.push(r);
    resolvedCanonicals.push(r.canonical_id);
  }
  return out;
}

/**
 * Look up required-ingredient seeds for a named dish. Case-insensitive
 * substring match. Returns an array of canonical ids the dish MUST
 * contain (empty array when the dish isn't seeded — the classifier
 * result is then authoritative).
 */
export function seedRequiredIngredientsForDish(dishName) {
  const n = normalize(dishName);
  if (!n) return [];
  for (const [seedKey, ids] of Object.entries(REQUIRED_INGREDIENTS_BY_DISH)) {
    if (n.includes(seedKey)) {
      return ids.filter(validateCanonicalId);
    }
  }
  return [];
}

/**
 * Check whether a set of ingredient ids (from a drafted recipe)
 * contains each canonical id in `required`. Required ids are matched
 * via resolveCanonicalIdentity so "chicken_breast" satisfies a
 * "chicken" requirement (axis hint — breast is still chicken).
 *
 * Returns { ok: boolean, missing: string[] }.
 */
export function checkRequiredIngredientsPresent(required, presentIds) {
  const missing = [];
  const presentBases = new Set();
  for (const id of presentIds || []) {
    if (!id) continue;
    const { canonical } = resolveCanonicalIdentity(id);
    if (canonical) presentBases.add(canonical);
    presentBases.add(id);
    // Also add hub ancestor so "chicken_breast" satisfies "chicken_hub".
    const ing = findIngredient(id);
    if (ing?.parentId) presentBases.add(ing.parentId);
  }
  for (const req of required || []) {
    if (!req) continue;
    if (presentBases.has(req)) continue;
    // Allow a required hub to be satisfied by any child member.
    if (req.endsWith("_hub")) {
      let satisfied = false;
      for (const id of presentIds || []) {
        const ing = findIngredient(id);
        if (ing?.parentId === req) { satisfied = true; break; }
      }
      if (satisfied) continue;
    }
    missing.push(req);
  }
  return { ok: missing.length === 0, missing };
}
