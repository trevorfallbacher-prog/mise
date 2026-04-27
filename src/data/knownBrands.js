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

  // ── Snack meats / jerky ────────────────────────────────────────
  // Multi-canonical (beef stick, jerky, snack stick) — brand-isolation
  // only. The brandExpertise table picks the right canonical when a
  // collab string carries two brands at once.
  { tokens: ["slim jim"],                                     display: "Slim Jim" },
  { tokens: ["jack link's", "jack links", "jack link"],       display: "Jack Link's" },

  // ── Wings / chicken-forward ────────────────────────────────────
  // Buffalo Wild Wings is the most common collab co-brand on
  // wing-adjacent SKUs (sticks, sauces, frozen wings).
  { tokens: ["buffalo wild wings", "bww"],                    display: "Buffalo Wild Wings" },
  { tokens: ["perdue"],                                       display: "Perdue" },
  { tokens: ["tyson"],                                        display: "Tyson" },

  // ── Deli meats ─────────────────────────────────────────────────
  // Boar's Head, Applegate, Oscar Mayer, Hillshire Farm — collab co-
  // brand with sauce/honey makers on flavored deli lines.
  { tokens: ["boar's head", "boars head"],                    display: "Boar's Head" },
  { tokens: ["applegate"],                                    display: "Applegate" },
  { tokens: ["oscar mayer"],                                  display: "Oscar Mayer" },
  { tokens: ["hillshire farm", "hillshire"],                  display: "Hillshire Farm" },

  // ── Sauces / hot honey / hot sauce ─────────────────────────────
  // Mike's Hot Honey, Frank's RedHot, Cholula — common collaborators
  // on flavored meat / wing SKUs ("Boar's Head × Mike's Hot Honey
  // Turkey", "Slim Jim × Frank's RedHot Beef Stick").
  { tokens: ["mike's hot honey", "mikes hot honey"],          display: "Mike's Hot Honey" },
  { tokens: ["frank's redhot", "franks redhot", "frank's red hot"], display: "Frank's RedHot" },
  { tokens: ["cholula"],                                      display: "Cholula" },

  // ── Candy / chocolate (frequent inclusion-licensors) ───────────
  // These brands appear on cookies / ice cream / cereal as licensed
  // INCLUSIONS, not as the manufacturer. classifyBrandMentions
  // demotes them to ingredient claims when the canonical's category
  // is outside their candy expertise.
  { tokens: ["m&m's", "m&ms", "m and m's", "m and ms"],       display: "M&M's" },
  { tokens: ["reese's", "reeses"],                            display: "Reese's" },
  { tokens: ["hershey's", "hersheys"],                        display: "Hershey's" },
  { tokens: ["snickers"],                                     display: "Snickers" },
  { tokens: ["oreo"],                                         display: "Oreo" },
  { tokens: ["kit kat", "kitkat", "kit-kat"],                 display: "Kit Kat" },
  { tokens: ["nutella"],                                      display: "Nutella" },

  // ── Cookies / baked snacks ─────────────────────────────────────
  { tokens: ["chips ahoy", "chips ahoy!"],                    display: "Chips Ahoy" },
  { tokens: ["famous amos"],                                  display: "Famous Amos" },
  { tokens: ["pepperidge farm"],                              display: "Pepperidge Farm" },
  { tokens: ["keebler"],                                      display: "Keebler" },

  // ── Ice cream ──────────────────────────────────────────────────
  { tokens: ["ben & jerry's", "ben and jerry's", "ben & jerrys", "ben and jerrys"], display: "Ben & Jerry's" },
  { tokens: ["häagen-dazs", "haagen-dazs", "haagen dazs", "häagen dazs"], display: "Häagen-Dazs" },
  { tokens: ["breyers"],                                      display: "Breyers" },
  { tokens: ["klondike"],                                     display: "Klondike" },
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
  const all = detectAllBrands(haystack);
  return all[0] || null;
}

/**
 * Find ALL known brand mentions in a free-text haystack — covers the
 * collab / co-brand case where a productName carries both brands at
 * once ("Slim Jim Buffalo Wild Wings Buffalo Cheddar Cheese Beef
 * Stick" surfaces both Slim Jim and Buffalo Wild Wings).
 *
 * Returns an array of { display, canonicalHint, matchedToken }
 * deduped by display, preserving order of first appearance in the
 * haystack. Caller can feed the array into pickPrimaryBrand to
 * weight which one is the manufacturer vs. the licensing collab.
 *
 * Phrase pass runs first (longest-first) so multi-word brands are
 * captured before the single-word pass walks any token they shadow
 * (e.g. "buffalo wild wings" matches as a phrase, then the loop
 * skips the bare "buffalo" token that would otherwise mis-fire).
 */
export function detectAllBrands(haystack) {
  if (!haystack) return [];
  const text = String(haystack).toLowerCase();
  buildIndex();
  const seen = new Set();           // entry display, case-folded
  const consumed = new Set();       // character ranges already matched, "start-end"
  const hits = [];

  function addHit(entry, matchedToken, range) {
    const key = entry.display.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      display:       entry.display,
      canonicalHint: entry.canonicalHint || null,
      matchedToken,
      offset:        range ? range[0] : -1,
    });
    if (range) consumed.add(`${range[0]}-${range[1]}`);
  }

  function rangeOverlapsConsumed(start, end) {
    for (const r of consumed) {
      const [s, e] = r.split("-").map(Number);
      if (start < e && end > s) return true;
    }
    return false;
  }

  // Phrase pass — longest first. Walk all matches in the haystack,
  // not just the first, so two co-branded phrases both register.
  for (const phrase of _multiwordTokens) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end   = start + m[0].length;
      if (rangeOverlapsConsumed(start, end)) continue;
      const entry = _tokenIndex.get(phrase);
      addHit(entry, phrase, [start, end]);
    }
  }

  // Single-word pass — boundaried, skips ranges already consumed
  // by the phrase pass so "buffalo wild wings" doesn't also fire a
  // bare "buffalo" hit.
  const wordRe = /[a-z0-9'&.-]+/g;
  let m;
  while ((m = wordRe.exec(text)) !== null) {
    const start = m.index;
    const end   = start + m[0].length;
    if (rangeOverlapsConsumed(start, end)) continue;
    const entry = _tokenIndex.get(m[0]);
    if (entry) addHit(entry, m[0], [start, end]);
  }

  // Sort by appearance order in the haystack so the caller's
  // "first detected" intuition still holds when scores are equal.
  hits.sort((a, b) => a.offset - b.offset);
  return hits.map(({ offset, ...rest }) => rest);
}
