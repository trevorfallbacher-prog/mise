// Flavor / variant token extractor — pulls flavor descriptors out of
// productName text and surfaces them as the row's `claims` array.
//
// THE GAP THIS CLOSES: the categorize-product-photo edge function
// already strips flavor tokens during canonical resolution
// ("Buffalo Beef Stick" → canonical=beef_stick + claims=["Buffalo"]).
// But the regular barcode-scan path (lookupBarcode → OFF) had no
// equivalent client-side stripper — productName came back as
// "Milk Chocolate Truffles Fudge Swirl" and "Fudge Swirl" stayed
// stuck in the display name with no `claims` array surfacing it.
//
// This file lifts the stripping logic into a shared client lib both
// paths can call. The edge function's strip step covers the photo
// path; this covers the scan path. Tokens are kept in sync between
// the two by convention (same lexicon shape, easy to grep).
//
// TWO SWEEPS:
//
//   1. LEADING_PREFIXES — common adjective prefixes that often slip
//      into a productName at the start. "Honey Mustard Pretzels" →
//      strip "Honey Mustard", remainingName="Pretzels". Stops the
//      first time a token doesn't strip cleanly. Mirrors the edge
//      function's FLAVOR_PREFIXES list — keep these in sync if you
//      add to either.
//
//   2. ANYWHERE_TOKENS — multi-word flavor descriptors that can
//      appear ANYWHERE in the productName, not just the start.
//      "Milk Chocolate Truffles Fudge Swirl" → claims=["Fudge Swirl"],
//      remainingName="Milk Chocolate Truffles". The lexicon focuses
//      on common candy / cookie / ice-cream / yogurt / snack flavors.
//
// Both sweeps return the EXTRACTED token AS A CLAIM. Whether the
// remaining name keeps its old text or gets rewritten is the
// caller's call — the function returns both `remainingName` and
// `claims` so callers can choose.
//
// USED BY:
//   - AddDraftSheet's handleScan (post-OFF lookup, sets claims
//     state and optionally rewrites the name field)
//   - Any future scan-flow consumer that wants to surface flavor
//     descriptors as claims chips per CLAUDE.md identity stack

const LEADING_PREFIXES = [
  // Order matters — longer / more specific terms first so
  // "honey mustard" beats accidental "honey" hits.
  "honey mustard", "honey bbq",
  "extra virgin", "lightly salted", "sea salt",
  "zero sugar", "sugar free", "fat free", "low fat",
  "low sodium", "low carb",
  "buffalo", "honey", "spicy", "sweet", "salted",
  "smoked", "roasted", "toasted",
  "original", "classic", "extra", "premium",
  "hot", "mild", "crispy", "crunchy", "creamy",
  "double", "triple", "mini", "jumbo", "family", "cracked",
];

// Flavor descriptors that frequently appear MID- or END-of-name.
// Multi-word entries first so "fudge swirl" beats accidental "fudge".
//
// CURATION RULE: include ONLY flavor / variant signal, NOT canonical
// identity. A token belongs here only if removing it from the name
// leaves the canonical intact:
//   ✓ "Fudge Swirl" — variant of an ice cream / chocolate
//   ✓ "Cookies and Cream" — flavor variant
//   ✓ "Honey BBQ" — sauce variant on chicken / wings
//   ✗ "Milk Chocolate" — identity (the product IS milk chocolate)
//   ✗ "Peanut Butter Cup" — that's a canonical id, not a flavor
//   ✗ "Greek Yogurt" — canonical, not a flavor variant of yogurt
//
// When in doubt, leave it out — false positives strip identity into
// claims (wrong); false negatives just leave marketing copy in the
// name (mild). Add tokens here only after seeing them genuinely act
// as variant descriptors on real scanned products.
const ANYWHERE_TOKENS = [
  // Ice cream / frozen dessert flavors
  "fudge swirl", "fudge ripple", "caramel swirl",
  "cookies and cream", "cookies & cream",
  "chocolate chip cookie dough", "cookie dough",
  "mint chocolate chip", "mint chip",
  "rocky road", "neapolitan",
  "salted caramel", "sea salt caramel",
  "butter pecan", "butter brickle",
  "french vanilla", "vanilla bean",
  "birthday cake",
  "moose tracks", "phish food",

  // Candy / chocolate flavor variants — NOT canonical-equivalents
  // ("milk chocolate" / "dark chocolate" deliberately excluded —
  // they're identity-defining for the product, not flavor variants
  // of a more specific canonical).
  "caramel filled", "caramel center",
  "almond filling", "hazelnut filling",
  "toffee crunch", "nougat center",

  // Yogurt / dairy flavors
  "key lime pie", "key lime",
  "strawberry banana", "honey vanilla",
  "blueberry", "raspberry", "strawberry",
  "peach", "mango", "cherry",

  // Cookie / cracker flavors (variants of the cookie canonical)
  "snickerdoodle", "double chocolate",
  "white chocolate macadamia",
  "oatmeal raisin",

  // Chip / snack flavors
  "sour cream and onion", "sour cream & onion",
  "salt and vinegar", "salt & vinegar",
  "nacho cheese", "spicy nacho",
  "cool ranch",
  "memphis bbq", "honey bbq", "smoky bbq",
  "spicy dill",
  "jalapeño cheddar", "jalapeno cheddar",
  "sriracha", "wasabi",

  // Sauce / condiment flavor variants
  "garlic herb", "lemon garlic",
  "smoky maple", "maple bacon",
  "mango habanero", "raspberry chipotle",
];

// Special-case capitalization for tokens that don't title-case
// cleanly. "Honey Bbq" reads as an OCR error; "Honey BBQ" reads
// like the product copy. Add entries here for any token in
// ANYWHERE_TOKENS or LEADING_PREFIXES whose default title case
// looks broken.
const CAPITALIZATION_OVERRIDES = {
  "memphis bbq":     "Memphis BBQ",
  "honey bbq":       "Honey BBQ",
  "smoky bbq":       "Smoky BBQ",
  "sour cream and onion": "Sour Cream & Onion",
  "sour cream & onion":   "Sour Cream & Onion",
  "salt and vinegar":     "Salt & Vinegar",
  "salt & vinegar":       "Salt & Vinegar",
  "cookies and cream":    "Cookies & Cream",
  "cookies & cream":      "Cookies & Cream",
};

// Display-case a token. "fudge swirl" → "Fudge Swirl". Honors the
// CAPITALIZATION_OVERRIDES table for tokens that don't title-case
// cleanly ("honey bbq" → "Honey BBQ" instead of "Honey Bbq").
function titleCase(token) {
  const lower = String(token).toLowerCase();
  if (CAPITALIZATION_OVERRIDES[lower]) return CAPITALIZATION_OVERRIDES[lower];
  return lower
    .split(/\s+/)
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : "")
    .join(" ");
}

/**
 * Extract flavor / variant tokens from a productName.
 *
 * @param {string} productName  — the OFF / Haiku / scan-derived name
 * @param {object} [opts]
 * @param {string} [opts.brand] — strip this brand string from the
 *                                start before scanning (so "Vlasic
 *                                Kosher Dill Pickles" → "Kosher Dill
 *                                Pickles" before flavor extraction)
 * @param {boolean} [opts.removeFromName=true] — when true, ANYWHERE
 *                                tokens are removed from the
 *                                returned remainingName. Set to
 *                                false to keep the full marketing
 *                                copy in the display while still
 *                                surfacing claims.
 * @returns { remainingName, claims }
 */
export function stripFlavors(productName, { brand = null, removeFromName = true } = {}) {
  const empty = { remainingName: "", claims: [] };
  if (!productName) return empty;

  let working = String(productName).trim();
  if (!working) return empty;

  // Optional brand-prefix strip (caller's responsibility to pass it,
  // but we offer the convenience). Avoids "Vlasic" being treated as
  // a flavor when it's just the brand name.
  if (brand) {
    const brandLower = String(brand).toLowerCase();
    if (working.toLowerCase().startsWith(brandLower)) {
      working = working.substring(brand.length).replace(/^[\s,'\-:]+/, "").trim();
    }
  }

  const claims = [];

  // SWEEP 1 — leading-prefix strips. Bounded loop so a malformed
  // input can't loop forever.
  for (let i = 0; i < 4; i += 1) {
    const lower = working.toLowerCase();
    let stripped = false;
    for (const prefix of LEADING_PREFIXES) {
      if (lower.startsWith(prefix + " ")) {
        claims.push(titleCase(prefix));
        working = working.slice(prefix.length).trim();
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }

  // SWEEP 2 — anywhere-token sweep. Match each multi-word token via
  // word-boundaries so "chip" inside "Chips Ahoy" doesn't fire a
  // bare "chocolate chip" match. Longer tokens first (already
  // ordered in the lexicon).
  let remaining = working;
  for (const token of ANYWHERE_TOKENS) {
    // Build a word-boundary regex. Escape regex metacharacters in
    // the token (& and parens are common in flavor names).
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    const match = remaining.match(re);
    if (match) {
      claims.push(titleCase(token));
      if (removeFromName) {
        remaining = (remaining.slice(0, match.index) + remaining.slice(match.index + match[0].length))
          .replace(/\s+/g, " ")
          .replace(/^[\s,\-:]+|[\s,\-:]+$/g, "")
          .trim();
      }
    }
  }

  // De-dupe claims case-insensitively while preserving first-seen
  // capitalization.
  const seen = new Set();
  const dedupedClaims = [];
  for (const c of claims) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedClaims.push(c);
  }

  return {
    remainingName: remaining || working,
    claims:        dedupedClaims,
  };
}
