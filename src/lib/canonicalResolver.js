// Canonical resolution from scanned barcode data.
//
// Barcode scans land a payload like:
//   { brand: "Ocean's Halo",
//     productName: "O'cean's Organic Sushi Nori Wasabi Style 40G",
//     categoryHints: ["sushi-nori", "seaweed-sheets", "sushi-accompaniments"],
//     nutrition: {...} }
//
// The BRAND is reliable. The productName is marketing soup and
// categoryHints are OFF taxonomy strings — the latter are the
// cleanest signal for mapping to our registry canonicals.
//
// This module resolves those inputs to a canonical id from
// src/data/ingredients.js, always with a confidence label so the UI
// can surface a "looks like X — tap to confirm" card rather than
// silently auto-applying a guess.
//
// Tier ordering (cheapest → most expensive):
//   1. Learned tag map (Phase 2; accepts injected `learnedTags` arg
//      that may be null). `exact` confidence when hit.
//   2. categoryHints → fuzzyMatchIngredient. `high` when score ≥ 70.
//   3. Cleaned productName → fuzzyMatchIngredient. `medium` when
//      score ≥ 60.
//   4. Claude fallback (Phase 3) — not wired here; separate call.
//
// Returns:
//   { canonical: INGREDIENTS-entry, confidence: "exact"|"high"|"medium",
//     reason: "tag:sushi-nori" | "name-cleaned" | "learned",
//     matchedOn: "sushi-nori"|"tortilla chips"|... }
//   or null when no tier produces a usable match.

import {
  fuzzyMatchIngredient,
  INGREDIENT_STATES,
  INGREDIENTS,
  dbCanonicalsSnapshot,
} from "../data/ingredients";

// Module-scope cache for canonical-name tokens. Rebuilt lazily on
// first access; DB canonicals may grow over a session, so we also
// invalidate whenever dbCanonicalsSnapshot returns a different size
// than what we've baked in. Size check is a cheap heuristic, not
// a strict equality — we just want to avoid rebuilding the set on
// every cleanProductName call.
let _canonicalNameTokens = null;
let _canonicalNameTokensDbSize = -1;
function canonicalNameTokens() {
  const dbRows = dbCanonicalsSnapshot();
  if (_canonicalNameTokens && _canonicalNameTokensDbSize === dbRows.length) {
    return _canonicalNameTokens;
  }
  const out = new Set();
  const addTokens = (s) => {
    if (!s) return;
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .forEach((t) => {
        if (t && t.length >= 3) out.add(t);
      });
  };
  for (const ing of INGREDIENTS) {
    if (ing.parentId === undefined && ing.id.endsWith("_hub")) continue;
    addTokens(ing.name);
    addTokens(ing.shortName);
    // Registry ids are underscore-separated and also identify the
    // canonical. "chicken_breast" → tokens {chicken, breast}. Lets
    // us protect canonical words that are more specific than the
    // display name alone.
    addTokens(String(ing.id).replace(/_/g, " "));
  }
  for (const ing of dbRows) {
    addTokens(ing.name);
  }
  _canonicalNameTokens = out;
  _canonicalNameTokensDbSize = dbRows.length;
  return out;
}

// Marketing / packaging tokens to strip before we fuzz the product
// name. Targeted list, not general English stopwords — we want the
// SUBSTANTIVE nouns (nori, chips, yogurt) to survive. Add here when
// you notice a new offender recurring in OFF product names.
const MARKETING_STOPWORDS = new Set([
  // provenance / claims
  "organic", "natural", "allnatural", "nongmo", "non-gmo", "gmofree",
  "glutenfree", "gluten-free", "dairyfree", "dairy-free", "sugarfree",
  "sugar-free", "lowsugar", "low-sugar", "lowsodium", "low-sodium",
  "lowfat", "low-fat", "reducedfat", "zerosugar", "nosugar",
  "preservativefree", "vegan", "vegetarian", "keto", "paleo",
  "whole30", "kosher", "halal", "fairtrade", "fair-trade",
  "sustainable", "sustainablesourced", "raw", "unsweetened", "pure",
  "authentic", "gourmet", "premium", "classic", "original",
  "traditional", "artisan", "artisanal", "handcrafted", "homestyle",
  "craft", "signature", "select", "choice",
  // flavor modifiers
  "salted", "unsalted", "lightlysalted", "seasalt", "sea-salt",
  "sweetened", "flavored", "flavoured", "spicy", "mild", "hot",
  "extra", "supreme", "deluxe", "style", "flavor", "flavour",
  "wasabistyle", "wasabi-style",
  // physical descriptors
  "whole", "sliced", "shredded", "chopped", "minced", "crumbled",
  "ground", "cracked", "halved", "quartered", "diced", "fresh",
  "frozen", "refrigerated", "dried", "dehydrated",
  // packaging
  "pack", "packs", "package", "packages", "bag", "bags", "box",
  "boxes", "bottle", "bottles", "can", "cans", "jar", "jars",
  "tub", "tubs", "pouch", "pouches", "carton", "cartons",
  "container", "containers", "tray", "trays", "sheet", "sheets",
  "piece", "pieces", "slice", "slices",
  // generic English noise kept separate from the curated list
  "the", "and", "or", "of", "with", "for", "in", "new",
  "our", "your", "by", "from", "to", "at",
]);

// Common unit suffixes we strip alongside their numeric prefix.
// "40g", "1 oz", "12oz", "1.5 lbs" → removed. Captured via regex
// rather than the stopword set because we want to drop the NUMBER
// too (the set only matches word tokens).
const UNIT_WITH_NUMBER_RE =
  /\b\d+(?:\.\d+)?\s*(?:g|gram|grams|kg|kilogram|kilograms|oz|ounce|ounces|lb|lbs|pound|pounds|ml|milliliter|milliliters|l|liter|liters|ct|count|pk|pack|packs|fl\s*oz)\b/gi;

// Normalize a brand string for token-based comparison. "Ocean's Halo"
// → ["oceans", "halo"]. Used by stripBrand to know which tokens to
// strip from the productName.
function brandTokens(brand) {
  if (!brand) return new Set();
  return new Set(
    String(brand)
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 2),
  );
}

// Produce a cleaned version of a productName with brand, marketing,
// and size tokens stripped. Preserves the substantive food nouns.
// "Ocean's Halo O'cean's Organic Sushi Nori Wasabi Style 40G"
//   with brand "Ocean's Halo"
//   → "sushi nori"
//
// Crucially: brand tokens that are ALSO canonical names are
// preserved. "Ramen Bae Protein Ramen" with brand "Ramen Bae"
// would otherwise strip both 'ramen's and leave "protein" — we'd
// never resolve to the ramen canonical. Same problem for "Chicken
// of the Sea Tuna", "Chicken Land's Chicken", any brand where the
// marketer baked the food category into their name. Guard by
// checking each brand token against the registry's name tokens
// before removing it.
export function cleanProductName(productName, brand) {
  if (!productName || typeof productName !== "string") return "";
  let out = productName.toLowerCase();
  // Strip numbered units first so we don't leave orphan digits.
  out = out.replace(UNIT_WITH_NUMBER_RE, " ");
  // Strip punctuation to whitespace. Leaves us space-separated tokens.
  out = out.replace(/[^a-z0-9 ]+/g, " ");
  const tokens = out
    .split(/\s+/)
    .filter(t => t.length >= 2);
  const bTokens = brandTokens(brand);
  const canonTokens = canonicalNameTokens();
  // Narrow the brand-strip set to tokens the registry doesn't also
  // claim as a canonical identifier. Preserves food nouns that
  // happen to be part of the brand.
  const strippableBrandTokens = new Set();
  for (const t of bTokens) {
    if (!canonTokens.has(t)) strippableBrandTokens.add(t);
  }
  const kept = tokens.filter(t => {
    if (strippableBrandTokens.has(t)) return false;
    if (MARKETING_STOPWORDS.has(t)) return false;
    // Drop pure-numeric residue (after unit strip, sometimes stray
    // digits survive).
    if (/^\d+$/.test(t)) return false;
    return true;
  });
  // Dedupe repeated tokens — "Ramen Bae Protein Ramen" with brand
  // "Ramen Bae" + protected 'ramen' leaves "ramen protein ramen"
  // (two 'ramen's, non-adjacent). Collapse to one 'ramen protein'
  // as a stronger fuzz match target. Preserves first-occurrence
  // order so the canonical noun reads first.
  const seen = new Set();
  const deduped = [];
  for (const t of kept) {
    if (seen.has(t)) continue;
    seen.add(t);
    deduped.push(t);
  }
  return deduped.join(" ").trim();
}

// Tidy an OFF taxonomy tag like "sushi-nori" / "seaweed-sheets" into
// a space-delimited phrase fuzzyMatchIngredient accepts.
function tagToPhrase(tag) {
  if (!tag || typeof tag !== "string") return "";
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Best hit from running fuzzyMatchIngredient with a minimum score
// floor. Returns { ingredient, score } or null.
function bestMatchAboveFloor(phrase, floor) {
  if (!phrase) return null;
  const matches = fuzzyMatchIngredient(phrase, 3) || [];
  if (matches.length === 0) return null;
  const top = matches[0];
  if (!top || typeof top.score !== "number") return null;
  return top.score >= floor ? top : null;
}

// Public resolver. Layers tiers 1→3 and returns the first confident
// hit. Tier 1 (learned tags) is a separate lookup function passed as
// `learnedTagLookup(tag) → canonicalId | null`; caller wires it to
// Phase 2's useCanonicalOffTags hook when available, else passes null.
//
// categoryHints order matters: OFF lists the most specific tag first
// ("sushi-nori") followed by broader parents ("seaweed-sheets",
// "sushi-accompaniments"). We walk them in order so the tightest match
// wins; a specific tag like "sushi-nori" decisively picks nori even
// when a broader tag would fuzz toward sushi-as-a-category.
export function resolveCanonicalFromScan({
  brand          = null,
  productName    = null,
  categoryHints  = [],
  learnedTagLookup = null,   // (offTag) => canonicalId|null, or null
  findIngredient   = null,   // (id) => ingredient, or null — pulled from ingredients.js
}) {
  // Tier 1 — learned tag map. Always auto-apply: the mapping was
  // explicitly confirmed by a prior user (or seeded by admin), no
  // value in re-confirming the same answer.
  if (typeof learnedTagLookup === "function") {
    for (const tag of (categoryHints || [])) {
      const canonicalId = learnedTagLookup(tag);
      if (canonicalId && typeof findIngredient === "function") {
        const ing = findIngredient(canonicalId);
        if (ing) {
          return {
            canonical: ing,
            confidence: "exact",
            reason: "learned",
            matchedOn: tag,
            autoApply: true,
          };
        }
      }
    }
  }

  // Tier 2 — fuzzy match each categoryHint against the registry.
  // Score floor of 70 matches the "confident enough to auto-link"
  // threshold suggested in fuzzyMatchIngredient's own comment.
  //
  // autoApply requires DOUBLE confidence: score >= 95 (exact name
  // match after normalization) AND the matched tag was the
  // most-specific one OFF gave us (index 0). OFF orders category
  // tags specific → broad, so a protein-ramen scan produces
  // ["ramen-noodles", "noodles", ..., "pastas"] — matching on
  // "pastas" (a fallback parent three hops deep) is NOT a direct
  // match, even though it normalizes to a 100-score hit on the
  // "pasta" canonical. Previously auto-applied; now surfaces the
  // suggestion card so the user can confirm or pick the correct
  // specific canonical.
  const tagList = Array.isArray(categoryHints) ? categoryHints : [];
  for (let i = 0; i < tagList.length; i++) {
    const tag = tagList[i];
    const phrase = tagToPhrase(tag);
    if (!phrase) continue;
    const hit = bestMatchAboveFloor(phrase, 70);
    if (hit) {
      return {
        canonical: hit.ingredient,
        confidence: "high",
        reason: `tag:${tag}`,
        matchedOn: phrase,
        score: hit.score,
        autoApply: hit.score >= 95 && i === 0,
      };
    }
  }

  const cleaned = cleanProductName(productName, brand);
  console.log("[resolver-debug] cleaned:", cleaned, "productName:", productName, "brand:", brand);

  // Tier 2.5 — exact-token match against productName first, then
  // brand if productName failed or was empty. Brand-token fallback
  // catches the case where OFF returned only `brand: "Ramen Bae"`
  // (productName null, categoryHints empty) but "ramen" is sitting
  // right there in the brand itself AND is a bundled canonical.
  // The 95+ floor keeps this safe: a brand like "Kerrygold" doesn't
  // match any canonical at 95+, so no false positive — we just fall
  // through to the prompt.
  const tokenSources = [];
  if (cleaned) tokenSources.push({ label: "cleaned", text: cleaned });
  if (brand) tokenSources.push({ label: "brand", text: String(brand).toLowerCase() });
  for (const { label, text } of tokenSources) {
    const tokens = text.split(/\s+/).filter(t => t && t.length >= 3);
    // 2-word phrases first so compound canonical names ('tortilla
    // chips', 'soy sauce', 'olive oil') beat their single-word
    // roots. Single-token mode would match 'tortilla' to 'tortillas'
    // (wraps) before ever considering the compound 'tortilla chips'
    // as a candidate.
    const phrases = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
    for (const phrase of phrases) {
      const hit = bestMatchAboveFloor(phrase, 95);
      if (hit) {
        return {
          canonical: hit.ingredient,
          confidence: "high",
          reason: `phrase-${label}:${phrase}`,
          matchedOn: phrase,
          score: hit.score,
          autoApply: true,
        };
      }
    }
    for (const token of tokens) {
      const hit = bestMatchAboveFloor(token, 95);
      if (hit) {
        return {
          canonical: hit.ingredient,
          confidence: "high",
          reason: `token-${label}:${token}`,
          matchedOn: token,
          score: hit.score,
          autoApply: true,
        };
      }
    }
  }

  // Tier 3 — fuzzy match the cleaned productName. Lower floor (60)
  // because we're matching against a denser, messier phrase.
  // autoApply trips at 95+: a scan where cleanProductName returns
  // the exact canonical name ("Heavy Cream" → "heavy cream" →
  // Heavy Cream canonical norm'd "heavy cream") — no tap needed.
  if (cleaned) {
    const hit = bestMatchAboveFloor(cleaned, 60);
    if (hit) {
      return {
        canonical: hit.ingredient,
        confidence: "medium",
        reason: "name-cleaned",
        matchedOn: cleaned,
        score: hit.score,
        autoApply: hit.score >= 95,
      };
    }
  }

  // No confident tier produced a match. Before giving up, surface the
  // single best low-confidence candidate so the UI can render "We
  // THINK it might be X — tap to confirm or pick something else"
  // rather than silently showing nothing. Confidence "low" — the card
  // styles this more tentatively than high/medium.
  //
  // Reuses the `cleaned` variable from Tier 3 above so we don't run
  // cleanProductName twice. If Tier 3 was skipped (cleaned was
  // falsy) the cleaned-name branch below silently skips.
  const weakCandidates = [];
  for (const tag of (categoryHints || [])) {
    const phrase = tagToPhrase(tag);
    if (!phrase) continue;
    const hit = bestMatchAboveFloor(phrase, 30);   // very permissive floor
    if (hit) weakCandidates.push({ hit, reason: `tag:${tag}`, matchedOn: phrase });
  }
  if (cleaned) {
    const hit = bestMatchAboveFloor(cleaned, 30);
    if (hit) weakCandidates.push({ hit, reason: "name-cleaned", matchedOn: cleaned });
  }
  if (weakCandidates.length > 0) {
    weakCandidates.sort((a, b) => b.hit.score - a.hit.score);
    const best = weakCandidates[0];
    return {
      canonical:  best.hit.ingredient,
      confidence: "low",
      reason:     best.reason,
      matchedOn:  best.matchedOn,
      score:      best.hit.score,
    };
  }

  // Nothing at all — registry has zero signal for this product. Caller
  // renders a "no registry match" state with productName as a search
  // seed for the manual canonical picker.
  return null;
}

// ── Package size extraction ─────────────────────────────────────────
//
// OFF's `quantity` field is free-text label copy: "40g", "1 lb",
// "250 ml", "12 × 50 g" (multipacks), "8 ct". Parse into
// { amount, unit } where `unit` uses our registry's short ids
// (g, kg, oz, lb, ml, l, count). Falls back to null when we can't
// confidently extract — the user fills in manually as they would
// without the scan.
//
// Multipack handling: "12 × 50 g" → { amount: 600, unit: "g" }
// (total pack weight). Users filling pantry usually care about total
// amount in the container, not per-unit serving.

const UNIT_ALIASES = {
  g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  mg: "mg", milligram: "mg", milligrams: "mg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml",
  cl: "ml",  // centiliter → ml conversion factor 10x
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  ct: "count", count: "count", pieces: "count", piece: "count",
};

const UNIT_MULTIPLIERS = {
  cl: 10,  // 1 cl = 10 ml → when we see cl we multiply amount and store as ml
};

export function parsePackageSize(raw) {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.toLowerCase().trim();
  if (!text) return null;

  // Multipack pattern: "<N> × <amount><unit>" or "<N> x <amount> <unit>"
  const multipack = text.match(
    /^(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*([a-z]+)/,
  );
  if (multipack) {
    const count = Number(multipack[1]);
    const per   = Number(multipack[2]);
    const unit  = canonicalizeUnit(multipack[3]);
    if (unit && Number.isFinite(count) && Number.isFinite(per) && count > 0 && per > 0) {
      const mult = UNIT_MULTIPLIERS[multipack[3]] || 1;
      return { amount: round1(count * per * mult), unit };
    }
  }

  // Single quantity: "<amount><unit>" or "<amount> <unit>"
  const single = text.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (single) {
    const amount = Number(single[1]);
    const unit   = canonicalizeUnit(single[2]);
    if (unit && Number.isFinite(amount) && amount > 0) {
      const mult = UNIT_MULTIPLIERS[single[2]] || 1;
      return { amount: round1(amount * mult), unit };
    }
  }

  return null;
}

function canonicalizeUnit(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().replace(/[.,]/g, "");
  return UNIT_ALIASES[key] || null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ── State inference from productName + categoryHints ────────────────
//
// OFF product names and taxonomy tags often carry state information
// that users would otherwise hand-pick from the STATE picker:
//   - "Sliced Turkey Breast"           → state: "sliced"
//   - "Ground Beef 80/20"               → state: "ground"
//   - "Tortilla Chips"                  → no state (already canonical form)
//   - "Shredded Mozzarella"             → state: "shredded"
//   - "Italian Sausage Links"           → state: "links" (or "sausage"; prefer specific)
//   - tags: "en:sliced-hams"            → state: "sliced"
//
// Returns a state value that matches our STATE_LABELS vocabulary or
// null when nothing detected. Does NOT return per-ingredient state
// values that aren't in the global vocabulary — caller filters by
// checking INGREDIENT_STATES[canonical.id] contains the result before
// applying.

// Lowercased detection phrases mapped to their canonical state value.
// Longer phrases listed first so "italian sausage" matches before "sausage".
const STATE_DETECTORS = [
  ["hot italian sausage", "sausage"],
  ["sweet italian sausage", "sausage"],
  ["italian sausage",      "sausage"],
  ["breakfast sausage",    "sausage"],
  ["sausage links",        "links"],
  ["sliced deli",          "sliced"],
  ["sliced ham",           "sliced"],
  ["sliced turkey",        "sliced"],
  ["sliced cheese",        "sliced"],
  ["shredded cheese",      "shredded"],
  ["grated cheese",        "grated"],
  ["crumbled cheese",      "crumbled"],
  ["ground beef",          "ground"],
  ["ground turkey",        "ground"],
  ["ground pork",          "ground"],
  ["ground chicken",       "ground"],
  ["minced garlic",        "minced"],
  ["diced tomato",         "diced"],
  ["diced onion",          "diced"],
  ["crushed tomato",       "crushed"],
  // Single-word fallbacks — less specific, so they run after phrases.
  ["sausage",  "sausage"],
  ["links",    "links"],
  ["sliced",   "sliced"],
  ["slices",   "sliced"],
  ["shredded", "shredded"],
  ["grated",   "grated"],
  ["crumbled", "crumbled"],
  ["crumbles", "crumbled"],
  ["ground",   "ground"],
  ["minced",   "minced"],
  ["chopped",  "diced"],       // "chopped" maps to our "diced" value
  ["diced",    "diced"],
  ["cubed",    "cubed"],
  ["cubes",    "cubed"],
  ["chunks",   "chunks"],
  ["strips",   "strips"],
  ["shaved",   "shaved"],
  ["patty",    "patty"],
  ["patties",  "patty"],
  ["meatball", "meatball"],
  ["meatballs","meatball"],
  ["nuggets",  "nuggets"],
  ["jerky",    "jerky"],
  ["fillet",   "fillet"],
  ["fillets",  "fillet"],
  ["whole",    "whole"],
  ["crushed",  "crushed"],
  ["mashed",   "mashed"],
  ["crumbs",   "crumbs"],
  ["toasted",  "toasted"],
  ["loaf",     "loaf"],
];

// Parse state words out of a free-text source. Accepts either a
// single string (productName) or an array of tag strings
// (categoryHints). Returns the first state phrase match in order.
export function parseStateFromText(productName, categoryHints = []) {
  const haystack = [
    productName ? String(productName).toLowerCase() : "",
    ...(Array.isArray(categoryHints)
      ? categoryHints.map(t => String(t || "").toLowerCase().replace(/-/g, " "))
      : []),
  ].filter(Boolean).join(" | ");
  if (!haystack) return null;
  for (const [phrase, state] of STATE_DETECTORS) {
    // Word-boundary match so "ground" doesn't fire on "background".
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(haystack)) return state;
  }
  return null;
}

// Filter an inferred state down to what a specific canonical actually
// supports. "ground" is valid for beef but not for bread; apply only
// when the ingredient's state vocabulary includes it. Returns the
// state when applicable, else null.
export function stateForCanonical(state, canonical) {
  if (!state || !canonical) return null;
  const allowed = INGREDIENT_STATES[canonical.id] || (
    canonical.parentId ? INGREDIENT_STATES[canonical.parentId] : null
  );
  if (!allowed || !Array.isArray(allowed)) return null;
  return allowed.includes(state) ? state : null;
}

// ── Origin extraction ────────────────────────────────────────────────
//
// OFF returns two overlapping tag arrays — `origins_tags` (where the
// ingredients came from) and `countries_tags` (where the finished
// product is sold). Origin is the stronger signal for a pantry row —
// "Parma, Italy" matters more than "Sold in United States" — so
// origins wins when both are present. Deduped + title-cased.

const COMMON_COUNTRY_SLUG_FIXUPS = {
  // OFF uses lowercase-slug country names; titleCase() handles most
  // cases, but a handful need special capitalization.
  "usa": "USA",
  "uk": "UK",
  "eu": "EU",
  "united-states": "United States",
  "united-kingdom": "United Kingdom",
};

function titleCaseSlug(slug) {
  if (!slug) return "";
  const s = String(slug).toLowerCase();
  if (COMMON_COUNTRY_SLUG_FIXUPS[s]) return COMMON_COUNTRY_SLUG_FIXUPS[s];
  return s
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Parse OFF's origins + countries tag arrays into a clean, deduped
// list of human-readable origin strings. Origins first (more specific),
// countries only when origins is empty (less specific fallback).
export function parseOrigins(originTags = [], countryTags = []) {
  const out = [];
  const seen = new Set();
  const sources = (originTags && originTags.length > 0) ? originTags : (countryTags || []);
  for (const raw of sources) {
    if (!raw || typeof raw !== "string") continue;
    const pretty = titleCaseSlug(raw.trim());
    if (!pretty) continue;
    const key = pretty.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pretty);
    if (out.length >= 4) break;  // cap — we only pill the top ones
  }
  return out;
}

// ── Certification extraction ────────────────────────────────────────
//
// OFF's `labels_tags` is the clean source — stable slugs like
// "usda-organic", "kosher", "non-gmo-project-verified". We maintain a
// curated map for the common ones so we can render a recognizable
// display label + badge color. Unknown tags fall through to a
// humanized slug.
//
// Each entry returns { id, label, kind } where kind is one of:
//   - "cert"    — formal third-party certification (USDA Organic, Kosher)
//   - "dietary" — derived claim (gluten-free, vegan)
// The UI uses kind to color-tint the pill (green for cert, cream for
// dietary).

const CERT_LABEL_MAP = {
  // Organic / agricultural
  "organic":                       { label: "Organic",             kind: "cert" },
  "usda-organic":                  { label: "USDA Organic",        kind: "cert" },
  "eu-organic":                    { label: "EU Organic",          kind: "cert" },
  "certified-organic":             { label: "Certified Organic",   kind: "cert" },
  // Religious
  "kosher":                        { label: "Kosher",              kind: "cert" },
  "ou-kosher":                     { label: "OU Kosher",           kind: "cert" },
  "halal":                         { label: "Halal",               kind: "cert" },
  // GMO / sourcing
  "non-gmo-project-verified":      { label: "Non-GMO Verified",    kind: "cert" },
  "no-gmos":                       { label: "No GMOs",             kind: "cert" },
  "fair-trade":                    { label: "Fair Trade",          kind: "cert" },
  "rainforest-alliance":           { label: "Rainforest Alliance", kind: "cert" },
  "msc-certified":                 { label: "MSC Certified",       kind: "cert" },
  // Regional origin
  "pdo":                           { label: "PDO",                 kind: "cert" },
  "pgi":                           { label: "PGI",                 kind: "cert" },
  "tsg":                           { label: "TSG",                 kind: "cert" },
  // Dietary claims
  "gluten-free":                   { label: "Gluten-Free",         kind: "dietary" },
  "dairy-free":                    { label: "Dairy-Free",          kind: "dietary" },
  "vegan":                         { label: "Vegan",               kind: "dietary" },
  "vegetarian":                    { label: "Vegetarian",          kind: "dietary" },
  "keto":                          { label: "Keto",                kind: "dietary" },
  "paleo":                         { label: "Paleo",               kind: "dietary" },
  "no-added-sugar":                { label: "No Added Sugar",      kind: "dietary" },
  "low-sodium":                    { label: "Low Sodium",          kind: "dietary" },
  "low-fat":                       { label: "Low Fat",             kind: "dietary" },
  "sugar-free":                    { label: "Sugar-Free",          kind: "dietary" },
  // Production method
  "grass-fed":                     { label: "Grass-Fed",           kind: "cert" },
  "pasture-raised":                { label: "Pasture-Raised",      kind: "cert" },
  "free-range":                    { label: "Free-Range",          kind: "cert" },
  "cage-free":                     { label: "Cage-Free",           kind: "cert" },
  "wild-caught":                   { label: "Wild-Caught",         kind: "cert" },
  "sustainably-sourced":           { label: "Sustainably Sourced", kind: "cert" },
};

// OFF's labels_tags sometimes contain low-value noise — marketing
// boilerplate tags that don't translate into useful attribute pills
// (e.g. "fr-triman" is a French recycling mark; "green-dot" is packaging
// disposal symbol). Drop these.
const LABEL_NOISE = new Set([
  "fr-triman", "green-dot", "point-vert", "tidyman", "der-gruene-punkt",
  "eu-green-dot", "recyclable", "recycle-me",
]);

export function parseCertifications(labelTags = []) {
  if (!Array.isArray(labelTags)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of labelTags) {
    if (!raw || typeof raw !== "string") continue;
    const id = raw.trim().toLowerCase();
    if (!id || seen.has(id) || LABEL_NOISE.has(id)) continue;
    seen.add(id);
    const known = CERT_LABEL_MAP[id];
    if (known) {
      out.push({ id, label: known.label, kind: known.kind });
    } else {
      // Unknown tag — keep it as a generic cert pill so user can
      // still see it; labeling it via titleCase. Phase 2 can log
      // frequent unknowns to grow the curated map.
      out.push({ id, label: titleCaseSlug(id), kind: "cert" });
    }
    if (out.length >= 6) break;  // cap — don't flood the card with pills
  }
  return out;
}

// ── Flavor / variant extraction ─────────────────────────────────────
//
// Pulls flavor modifier words from productName that sit on top of the
// canonical identity — "Wasabi" on nori, "Salted" on caramel, "Maple"
// on bacon, "Smoked" on salmon. Distinct from canonical (WHAT it is)
// and state (physical form). Scanned text is matched against a
// curated vocabulary — Phase 1 keeps it small and food-agnostic; can
// grow as we observe common OFF productName patterns.
//
// Returns an array of flavor strings (title-cased) rather than a
// single value because a product can carry multiple modifiers
// ("Honey Smoked Turkey" -> ["Honey", "Smoked"]).

const FLAVOR_KEYWORDS = [
  // Sweetness / salt profile
  "salted", "unsalted", "lightly-salted", "sea-salt", "sweetened",
  "unsweetened", "honey", "maple", "agave", "vanilla", "caramel",
  "chocolate", "cocoa", "mocha",
  // Heat / spice
  "spicy", "hot", "mild", "jalapeno", "habanero", "sriracha", "chipotle",
  "wasabi", "horseradish", "ginger", "peppercorn", "black-pepper",
  // Smoke / char
  "smoked", "cold-smoked", "hot-smoked", "mesquite", "hickory", "applewood",
  "charred", "fire-roasted",
  // Herb / aromatic
  "garlic", "rosemary", "basil", "thyme", "oregano", "dill", "cilantro",
  "lemon", "lime", "citrus", "orange", "mint",
  // Vinegar / pickle
  "pickled", "brined", "vinegar", "balsamic", "teriyaki", "soy", "miso",
  // Sweet flavor add
  "strawberry", "blueberry", "raspberry", "peach", "apple", "cherry",
  "banana", "coconut",
  // Cheese variants often carried as flavor
  "cheddar", "ranch", "bbq", "buffalo", "sour-cream",
];

// Normalize FLAVOR_KEYWORDS into a lookup set + ordered phrase array.
// Phrases with hyphens (multi-word keywords like "cold-smoked") need
// to be matched as multi-word in productName (whitespace form).
const FLAVOR_PHRASES = FLAVOR_KEYWORDS.map((k) => ({
  slug: k,
  phrase: k.replace(/-/g, " "),
  display: titleCaseSlug(k),
}));

export function parseFlavorVariant(productName, categoryHints = []) {
  if (!productName && (!categoryHints || categoryHints.length === 0)) return [];
  const hay = [
    productName ? String(productName).toLowerCase() : "",
    ...(Array.isArray(categoryHints)
      ? categoryHints.map((t) => String(t || "").toLowerCase().replace(/-/g, " "))
      : []),
  ].filter(Boolean).join(" | ");
  if (!hay) return [];
  const out = [];
  const seen = new Set();
  // Match longer phrases first so "cold smoked" wins over "smoked".
  const byLen = [...FLAVOR_PHRASES].sort((a, b) => b.phrase.length - a.phrase.length);
  for (const { phrase, display } of byLen) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(hay) && !seen.has(display)) {
      seen.add(display);
      out.push(display);
    }
    if (out.length >= 3) break;
  }
  return out;
}

// Convenience — combine origin + certification + flavor into a single
// attributes object suitable for the pantry_items.attributes JSONB
// column. Only includes non-empty keys so we don't write empty
// arrays / objects into the DB.
// Marketing / health-claim keywords that ride alongside the product
// name — things like "Protein", "Keto", "Lite", "Organic". These
// aren't CERTIFICATIONS (which come from OFF labels_tags and are
// formally regulated) and they aren't FLAVOR (the taste axis).
// They're closer to USDA grade / farm-fresh / ABF tags: promises
// a brand makes about the product's positioning. Surfaces as small
// gray pills next to the brand on ItemCard.
const PRODUCT_CLAIM_KEYWORDS = [
  // Protein / macro positioning
  "protein", "high protein", "high-protein", "low fat", "low-fat",
  "fat free", "fat-free", "low carb", "low-carb", "zero carb",
  "zero sugar", "no sugar added", "sugar free", "sugar-free",
  "low sodium", "low-sodium", "no salt added",
  // Diet tiers
  "keto", "paleo", "whole30", "plant based", "plant-based",
  "vegan", "vegetarian", "pescatarian",
  // Processing / quality
  "organic", "all natural", "natural", "non gmo", "non-gmo",
  "grass fed", "grass-fed", "pasture raised", "pasture-raised",
  "free range", "free-range", "cage free", "cage-free",
  "antibiotic free", "antibiotic-free", "abf", "hormone free", "hormone-free",
  "no preservatives", "preservative free", "preservative-free",
  "gluten free", "gluten-free",
  // Volume / concentration / product-line tier
  "lite", "light", "extra", "original", "classic",
  "premium", "extra virgin",
  // Common branded sub-line names — chips/snacks. These read as
  // tags ('SCOOPS', 'CANTINA') alongside the canonical, mirroring
  // how the package itself differentiates the line.
  "scoops", "cantina", "hint of lime", "salsa verde",
  "thins", "rounds", "twists", "minis", "bites",
  "kettle", "kettle cooked", "wavy", "ridged",
  "thick cut", "thin cut", "crispy",
];

const PRODUCT_CLAIM_PHRASES = PRODUCT_CLAIM_KEYWORDS.map((k) => ({
  phrase: k.replace(/[-_]/g, " "),
  display: titleCaseSlug(k),
}));

export function parseProductClaims(productName) {
  if (!productName || typeof productName !== "string") return [];
  const hay = productName.toLowerCase();
  const out = [];
  const seen = new Set();
  // Longest-first so 'high protein' wins over 'protein'.
  const byLen = [...PRODUCT_CLAIM_PHRASES].sort((a, b) => b.phrase.length - a.phrase.length);
  for (const { phrase, display } of byLen) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(hay) && !seen.has(display)) {
      seen.add(display);
      out.push(display);
    }
    if (out.length >= 3) break;
  }
  return out;
}

// Union a fresh attribute blob onto whatever the row already carries.
// Origins / flavor / claims union by case-insensitive value;
// certifications union by id. Used both at scan-row build time and
// on merge into an existing pantry row (so claims like 'ORIGINAL' /
// 'SCOOPS' survive a re-scan of the same UPC instead of getting
// wiped by the merge path).
export function mergeAttributes(existing, incoming) {
  if (!incoming) return existing || null;
  if (!existing) return incoming;
  const out = { ...existing };
  for (const key of ["origins", "flavor", "claims"]) {
    const merged = [...(existing[key] || []), ...(incoming[key] || [])];
    const seen = new Set();
    const deduped = [];
    for (const v of merged) {
      const k = String(v || "").toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      deduped.push(v);
    }
    if (deduped.length > 0) out[key] = deduped;
  }
  if (existing.certifications || incoming.certifications) {
    const seen = new Set();
    const merged = [];
    for (const cert of [...(existing.certifications || []), ...(incoming.certifications || [])]) {
      if (!cert || !cert.id || seen.has(cert.id)) continue;
      seen.add(cert.id);
      merged.push(cert);
    }
    if (merged.length > 0) out.certifications = merged;
  }
  return out;
}

// Generic English connectives and articles that are never a product
// claim. Kept tight — anything substantive (even noisy marketing
// words like 'original' / 'classic' / 'scoops') survives into claims
// because the whole point of residual extraction is to catch
// sub-line names the keyword whitelist can't predict.
const RESIDUAL_NOISE = new Set([
  "the", "and", "or", "of", "with", "for", "in", "on", "by",
  "from", "to", "at", "a", "an", "our", "your", "new",
]);

// Pull product-line claims out of whatever text remains after the
// brand and canonical name are stripped from the raw OFF productName.
// Rule: brand = Tostitos, canonical = Tortilla Chips → residual from
// "Tostitos Original Scoops Tortilla Chips" is ["Original", "Scoops"].
// Complements the keyword-whitelist path (parseProductClaims) so we
// don't miss sub-line names nobody's hand-curated yet.
export function residualClaimsFromName(productName, brand, canonicalName) {
  if (!productName || typeof productName !== "string") return [];
  let out = productName.toLowerCase();
  out = out.replace(UNIT_WITH_NUMBER_RE, " ");
  out = out.replace(/[^a-z0-9 ]+/g, " ");
  const tokens = out.split(/\s+/).filter(t => t.length >= 2);
  const strip = new Set();
  for (const t of brandTokens(brand)) strip.add(t);
  if (canonicalName) {
    String(canonicalName)
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .forEach(t => { if (t.length >= 2) strip.add(t); });
  }
  const seen = new Set();
  const kept = [];
  for (const t of tokens) {
    if (strip.has(t)) continue;
    if (RESIDUAL_NOISE.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    // Title-case for display: "scoops" → "Scoops"
    kept.push(t.charAt(0).toUpperCase() + t.slice(1));
  }
  return kept;
}

export function buildAttributesFromScan({
  productName   = null,
  genericName   = null,
  brand         = null,
  canonicalName = null,
  categoryHints = [],
  originTags    = [],
  countryTags   = [],
  labelTags     = [],
}) {
  const origins         = parseOrigins(originTags, countryTags);
  const certifications  = parseCertifications(labelTags);
  const flavor          = parseFlavorVariant(productName, categoryHints);
  // Sub-line names like 'Scoops' and 'Original' often appear in
  // generic_name, labels_tags, or brands rather than product_name —
  // OFF's product_name for a Tostitos Scoops Original UPC can come
  // back as bare "Tostitos Tortilla Chips" while the sub-brand lives
  // in brands ("Tostitos Scoops!") and the variant in labels_tags.
  // Concatenate every text source into one haystack so
  // parseProductClaims picks them up regardless of which OFF field
  // carries the signal.
  const claimHay = [
    productName,
    genericName,
    brand,
    ...(Array.isArray(labelTags) ? labelTags : []),
    ...(Array.isArray(categoryHints) ? categoryHints : []),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/[-_]/g, " ");
  const whitelist = parseProductClaims(claimHay);
  // Residual path: anything in the raw productName (or genericName
  // fallback) that ISN'T the brand or the canonical name is almost
  // certainly a product-line claim. Catches SCOOPS / ORIGINAL /
  // CANTINA-style sub-lines without needing them on a whitelist.
  // Union with the whitelist; dedupe case-insensitive, preserve the
  // first display casing seen.
  const residual = residualClaimsFromName(productName || genericName, brand, canonicalName);
  const seen = new Set();
  const claims = [];
  for (const c of [...residual, ...whitelist]) {
    const k = String(c || "").toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    claims.push(c);
  }
  const out = {};
  if (origins.length > 0)        out.origins        = origins;
  if (certifications.length > 0) out.certifications = certifications;
  if (flavor.length > 0)         out.flavor         = flavor;
  if (claims.length > 0)         out.claims         = claims;
  return Object.keys(out).length > 0 ? out : null;
}
