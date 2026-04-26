// Curated brand vocabulary for scan-time identity resolution.
//
// Two jobs the table does at once:
//
//   1. ISOLATE BRAND from a productName when OFF returned no `brands`
//      field. Tokenize the productName (and OFF brands string when
//      present), find a known brand hit, surface its canonical
//      shelf-display capitalization. Today's bug — a Pepsi UPC that
//      OFF returned `brand: null` for shows up as "Cola" with no
//      brand pill on the ItemCard, even though "Pepsi" is sitting
//      right there in the productName. detectBrand() closes that gap.
//
//   2. CARRY A CANONICAL HINT. When a brand has a single, obvious
//      canonical mapping (Pepsi → soda, Chobani → greek_yogurt,
//      Kerrygold → butter), the entry's canonicalHint feeds into the
//      resolver as a Tier 0.5 hit at "exact" confidence. Same UPC
//      now gets BOTH brand isolation and canonical pairing from a
//      single tokenization pass — no fuzzy guessing required.
//
// Sister to src/data/ingredientAliases.js (STRONG_ALIASES etc.):
// that table keys raw INGREDIENT phrases to canonicals; this one keys
// BRAND phrases to brand display + optional canonical. Both layered
// into the same resolver.
//
// Maintenance principle:
//   - Only add a brand when it's both common AND single-canonical.
//     Multi-line brands (Kraft makes cheese, mayo, dressing,
//     mac-and-cheese, etc.) get included for BRAND ISOLATION only
//     (canonicalHint omitted) so the brand pill renders but the
//     resolver falls through to its fuzzy tiers for the canonical.
//   - Be conservative with single-word tokens that overlap common
//     English. "Crush" / "Mug" / "Polar" are real soda brands but
//     would false-match on countless productNames — include them
//     only as multi-word phrases ("orange crush", "polar seltzer").
//   - Tokens are lowercased and matched against word-boundaries on
//     the haystack. Multi-word tokens match as phrases; single-word
//     tokens match per-word. Longer phrases run first so "dr pepper"
//     beats accidental "pepper" hits.

export const KNOWN_BRANDS = [
  // ── Sodas (cola family + variants) ──────────────────────────────
  // canonicalHint=soda: bundled `soda` canonical added alongside this
  // file. covers the cola/lemon-lime/root-beer family — recipes that
  // call for "cola" don't need to fight a Pepsi-only pantry.
  { tokens: ["pepsi", "pepsi-cola", "pepsi cola"],            display: "Pepsi",        canonicalHint: "soda" },
  { tokens: ["coca-cola", "coca cola", "coke"],               display: "Coca-Cola",    canonicalHint: "soda" },
  { tokens: ["sprite"],                                       display: "Sprite",       canonicalHint: "soda" },
  { tokens: ["fanta"],                                        display: "Fanta",        canonicalHint: "soda" },
  { tokens: ["dr pepper", "dr. pepper", "dr-pepper"],         display: "Dr Pepper",    canonicalHint: "soda" },
  { tokens: ["mountain dew", "mtn dew"],                      display: "Mountain Dew", canonicalHint: "soda" },
  { tokens: ["7up", "7-up", "7 up"],                          display: "7UP",          canonicalHint: "soda" },
  { tokens: ["sunkist"],                                      display: "Sunkist",      canonicalHint: "soda" },
  { tokens: ["jarritos"],                                     display: "Jarritos",     canonicalHint: "soda" },
  { tokens: ["sierra mist"],                                  display: "Sierra Mist",  canonicalHint: "soda" },
  { tokens: ["a&w root beer", "a&w"],                         display: "A&W",          canonicalHint: "soda" },
  { tokens: ["barq's", "barqs"],                              display: "Barq's",       canonicalHint: "soda" },
  { tokens: ["orange crush", "grape crush"],                  display: "Crush",        canonicalHint: "soda" },
  { tokens: ["mug root beer"],                                display: "Mug",          canonicalHint: "soda" },

  // ── Sparkling water / seltzer (no canonical hint yet — needs a
  //    bundled `sparkling_water` slug. Brand isolation still works.)
  { tokens: ["la croix", "lacroix"],                          display: "La Croix" },
  { tokens: ["bubly"],                                        display: "Bubly" },
  { tokens: ["spindrift"],                                    display: "Spindrift" },
  { tokens: ["polar seltzer", "polar spring water"],          display: "Polar" },
  { tokens: ["topo chico"],                                   display: "Topo Chico" },
  { tokens: ["perrier"],                                      display: "Perrier" },
  { tokens: ["san pellegrino", "s.pellegrino"],               display: "San Pellegrino" },

  // ── Yogurts ────────────────────────────────────────────────────
  { tokens: ["chobani"],                                      display: "Chobani",      canonicalHint: "greek_yogurt" },
  { tokens: ["fage"],                                         display: "Fage",         canonicalHint: "greek_yogurt" },
  { tokens: ["oikos"],                                        display: "Oikos",        canonicalHint: "greek_yogurt" },
  { tokens: ["yoplait"],                                      display: "Yoplait",      canonicalHint: "yogurt" },
  { tokens: ["dannon"],                                       display: "Dannon",       canonicalHint: "yogurt" },
  { tokens: ["siggi's", "siggis"],                            display: "Siggi's",      canonicalHint: "yogurt" },
  { tokens: ["stonyfield"],                                   display: "Stonyfield",   canonicalHint: "yogurt" },

  // ── Dairy / butter / cheese ────────────────────────────────────
  { tokens: ["kerrygold"],                                    display: "Kerrygold",    canonicalHint: "butter" },
  // Multi-line brands — brand-isolation only.
  { tokens: ["land o'lakes", "land o lakes"],                 display: "Land O'Lakes" },
  { tokens: ["organic valley"],                               display: "Organic Valley" },
  { tokens: ["horizon organic", "horizon"],                   display: "Horizon Organic" },
  { tokens: ["philadelphia cream cheese", "philadelphia"],    display: "Philadelphia", canonicalHint: "cream_cheese" },
  { tokens: ["sargento"],                                     display: "Sargento" },
  { tokens: ["tillamook"],                                    display: "Tillamook" },

  // ── Chips / snacks (canonicals still missing — most stay
  //    brand-isolation-only until tortilla_chips/potato_chips ship
  //    in the bundled registry. A few canonicals already exist:
  //    tortillas (which isn't chips) is the closest — keep no hints
  //    on chip brands for now.)
  { tokens: ["tostitos"],                                     display: "Tostitos" },
  { tokens: ["doritos"],                                      display: "Doritos" },
  { tokens: ["lay's", "lays"],                                display: "Lay's" },
  { tokens: ["ruffles"],                                      display: "Ruffles" },
  { tokens: ["pringles"],                                     display: "Pringles" },
  { tokens: ["cheetos"],                                      display: "Cheetos" },
  { tokens: ["fritos"],                                       display: "Fritos" },
  { tokens: ["sun chips", "sunchips"],                        display: "SunChips" },

  // ── Multi-line conglomerate brands (no canonical hint) ─────────
  // Brand-isolation pass only. Resolver falls through to fuzzy.
  { tokens: ["kraft"],                                        display: "Kraft" },
  { tokens: ["heinz"],                                        display: "Heinz" },
  { tokens: ["hellmann's", "hellmanns"],                      display: "Hellmann's" },
  { tokens: ["nestlé", "nestle"],                             display: "Nestlé" },
  { tokens: ["frito-lay", "frito lay"],                       display: "Frito-Lay" },
  { tokens: ["pepsico"],                                      display: "PepsiCo" },
  { tokens: ["unilever"],                                     display: "Unilever" },
  { tokens: ["general mills"],                                display: "General Mills" },
];

// Build a token → entry index lazily. Multi-word and single-word
// tokens share the index; the lookup loop differentiates by checking
// for whitespace.
let _tokenIndex = null;
let _multiwordTokens = null;
function buildIndex() {
  if (_tokenIndex) return;
  const m = new Map();
  const phrases = [];
  for (const entry of KNOWN_BRANDS) {
    for (const raw of entry.tokens) {
      const t = String(raw).toLowerCase().trim();
      if (!t) continue;
      m.set(t, entry);
      if (/\s/.test(t)) phrases.push(t);
    }
  }
  // Longer phrases first so "dr pepper" beats accidental "pepper" hits
  // on the single-token loop, and "mountain dew" beats "dew".
  phrases.sort((a, b) => b.length - a.length);
  _tokenIndex = m;
  _multiwordTokens = phrases;
}

// Escape a phrase for use inside a RegExp literal. The phrase set is
// curated so this is mostly defensive against future entries that
// contain regex metacharacters (apostrophes, dots, ampersands).
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the first known brand mentioned in a free-text haystack
 * (productName, or productName + " " + OFF brands when both present).
 * Returns
 *   { display, canonicalHint, matchedToken }
 * or null when no token in the haystack matches a known brand entry.
 *
 * Phrase pass runs first (longest-first) so multi-word brands beat
 * accidental single-word matches. Single-word pass is per-token and
 * boundaried via word-tokens of the haystack — no substring matches,
 * so "polar bear" doesn't fire the (now-removed) "polar" entry.
 */
export function detectBrand(haystack) {
  if (!haystack) return null;
  const text = String(haystack).toLowerCase();
  buildIndex();
  for (const phrase of _multiwordTokens) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i");
    if (re.test(text)) {
      const entry = _tokenIndex.get(phrase);
      return {
        display:        entry.display,
        canonicalHint:  entry.canonicalHint || null,
        matchedToken:   phrase,
      };
    }
  }
  const tokens = text
    .replace(/[^a-z0-9 '&.-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const token of tokens) {
    const entry = _tokenIndex.get(token);
    if (entry) {
      return {
        display:        entry.display,
        canonicalHint:  entry.canonicalHint || null,
        matchedToken:   token,
      };
    }
  }
  return null;
}
