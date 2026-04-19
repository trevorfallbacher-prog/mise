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

import { fuzzyMatchIngredient, INGREDIENT_STATES } from "../data/ingredients";

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
  const kept = tokens.filter(t => {
    if (bTokens.has(t)) return false;
    if (MARKETING_STOPWORDS.has(t)) return false;
    // Drop pure-numeric residue (after unit strip, sometimes stray
    // digits survive).
    if (/^\d+$/.test(t)) return false;
    return true;
  });
  return kept.join(" ").trim();
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
  // Tier 1 — learned tag map.
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
          };
        }
      }
    }
  }

  // Tier 2 — fuzzy match each categoryHint against the registry.
  // Score floor of 70 matches the "confident enough to auto-link"
  // threshold suggested in fuzzyMatchIngredient's own comment.
  for (const tag of (categoryHints || [])) {
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
      };
    }
  }

  // Tier 3 — fuzzy match the cleaned productName. Lower floor (60)
  // because we're matching against a denser, messier phrase.
  const cleaned = cleanProductName(productName, brand);
  if (cleaned) {
    const hit = bestMatchAboveFloor(cleaned, 60);
    if (hit) {
      return {
        canonical: hit.ingredient,
        confidence: "medium",
        reason: "name-cleaned",
        matchedOn: cleaned,
        score: hit.score,
      };
    }
  }

  // No tier produced a match. Caller renders picker with productName
  // as a search hint instead.
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
