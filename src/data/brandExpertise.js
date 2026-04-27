// Brand expertise — canonical-count-based brand weighting.
//
// THE PROBLEM: a single product can carry multiple brand names. Both
// "Slim Jim" and "Buffalo Wild Wings" appear on a "Slim Jim Buffalo
// Wild Wings Buffalo Cheddar Cheese Beef Stick" — but Slim Jim is
// the manufacturer (they make beef sticks); BWW is the licensing
// collaborator (they make chicken wings). A naive
// "first-brand-detected wins" loses this.
//
// THE MODEL: each brand has an EXPERTISE histogram — a count of
// canonicals (and hubs / categories) we've seen them produce.
//   * Slim Jim — heavily weighted on `beef_stick` / `beef_jerky` /
//     `snack_stick` (their entire SKU line). On a beef-stick scan,
//     Slim Jim's canonical-match score dominates.
//   * Buffalo Wild Wings — heavily weighted on `chicken_wings` /
//     `hot_sauce` / `ranch_dressing` (their actual product line).
//     On a beef-stick scan, BWW's score is ~zero.
//   * Boar's Head — heavily weighted on deli meats: `turkey`, `ham`,
//     `salami`, `pastrami`, `roast_beef`, `prosciutto`. On a turkey
//     scan with Mike's Hot Honey co-branding, Boar's Head's
//     canonical-match for `turkey` overpowers Mike's empty meat
//     score.
//   * Mike's Hot Honey — weighted only on `honey` /
//     pantry-sweeteners. Their meat-canonical score is zero.
//
// THE SCORING LAYERS (strongest → weakest):
//   1. canonicals[canonicalId] — exact canonical match. The brand
//      directly produces this SKU. Multiplier ×100.
//   2. hubs[hubId]              — same-hub match. The brand makes
//      something else in this hub (Boar's Head does turkey AND ham,
//      both pork_hub-adjacent / meat). Multiplier ×10.
//   3. categories[category]     — same-registry-category match. The
//      brand makes something else in "meat" or "dairy" or "pantry".
//      Multiplier ×1.
// Sum all three for the brand's score against this product. Highest
// score = primary brand. Ties break by total observation count
// (the brand we know the most about overall).
//
// PHASE 1 — TODAY: this file is a curated seed. The counts are
// estimates of each brand's SKU breadth in each canonical/hub/
// category, NOT real measurements. Seeded for the top ~30 brands
// where multi-brand collisions are common.
//
// PHASE 2 — DB-TIER LEARNING (planned): a future migration adds
// `brand_canonical_observations(brand_slug, canonical_id, count,
// last_seen_at)` populated from every (brand, canonical_id) write
// in `barcode_identity_corrections` and `pantry_items`. The picker
// merges seed counts + DB counts; over time the seed becomes a
// fallback for cold-start while measured data takes over.
//
// MAINTENANCE PRINCIPLE: only seed brands that:
//   1. Have a recognizable product LINE (not a one-SKU brand).
//   2. Are likely to co-brand (collab / licensing / private label).
// One-SKU brands don't need expertise weighting; the single brand
// is always primary.

// Normalize a brand display name to a stable lookup slug. Lowercase,
// alphanumeric, underscore-separated. Three pre-passes before the
// alphanumeric collapse:
//
//   1. Diacritic strip (NFD + combining-mark removal) — "Häagen-Dazs"
//      → "haagen_dazs" instead of "h_agen_dazs".
//   2. Apostrophe strip — "Mike's Hot Honey" → "mikes_hot_honey"
//      instead of "mike_s_hot_honey".
//   3. Ampersand strip — "M&M's" → "mms", "Ben & Jerry's" →
//      "ben_jerrys". Treating "&" as a word separator would leave
//      "m_ms" / "ben_jerrys" — only the latter is desirable.
//
// Without these pre-passes the slugs miss the expertise lookup.
export function brandSlugify(display) {
  return String(display || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")  // strip combining diacritics
    .replace(/[‘’'`&]/g, "")                  // strip apostrophes + ampersands
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Curated expertise table. brand_slug → { canonicals, hubs,
// categories, primaryHubsOrdered }. The numbers are estimated
// SKU-line counts: "Slim Jim has ~30 beef_stick variants in their
// product catalog" → canonicals.beef_stick = 30. They are guesses
// today; Phase 2 replaces them with measured counts.
//
// `primaryHubsOrdered` is a quick-lookup ordering of the brand's
// strongest hubs from most-known to least-known. Useful for
// surfacing "what is this brand best known for" queries without
// re-sorting the histogram.
export const BRAND_EXPERTISE = {
  // ── Snack meats / jerky ─────────────────────────────────────────
  slim_jim: {
    canonicals: {
      beef_stick:    30,
      beef_jerky:    18,
      snack_stick:   12,
      pork_stick:     4,
    },
    hubs:       { beef_hub: 50, pork_hub: 4 },
    categories: { meat: 64 },
    subtypes:   ["snack_meat"],
    primaryHubsOrdered: ["beef_hub"],
  },
  jack_links: {
    canonicals: {
      beef_jerky:    25,
      beef_stick:     8,
      turkey_jerky:   6,
      pork_jerky:     3,
    },
    hubs:       { beef_hub: 33, turkey_hub: 6, pork_hub: 3 },
    categories: { meat: 42 },
    subtypes:   ["snack_meat"],
    primaryHubsOrdered: ["beef_hub", "turkey_hub", "pork_hub"],
  },

  // ── Wings / chicken-forward ─────────────────────────────────────
  buffalo_wild_wings: {
    // BWW's actual product line is wings + sauces + dressings; the
    // beef-stick collab is a licensing exception encoded in subtypes
    // so the picker treats them as a credible co-brand on snack
    // meats even though they don't manufacture there.
    canonicals: {
      chicken_wings:        24,
      hot_sauce:             8,
      ranch_dressing:        4,
      blue_cheese_dressing:  3,
      bbq_sauce:             3,
    },
    hubs:       { chicken_hub: 24 },
    categories: { meat: 24, pantry: 18 },
    subtypes:   ["wing", "sauce", "dressing", "snack_meat"],
    primaryHubsOrdered: ["chicken_hub"],
  },
  perdue: {
    canonicals: {
      chicken:           18,
      chicken_breast:    14,
      chicken_thighs:    10,
      ground_chicken:     6,
      chicken_wings:      8,
      turkey:             4,
    },
    hubs:       { chicken_hub: 56, turkey_hub: 4 },
    categories: { meat: 60 },
    subtypes:   ["chicken_cut", "wing", "deli"],
    primaryHubsOrdered: ["chicken_hub", "turkey_hub"],
  },
  tyson: {
    canonicals: {
      chicken:           24,
      chicken_breast:    18,
      chicken_thighs:    14,
      ground_chicken:    10,
      chicken_nuggets:    8,
      chicken_wings:     12,
      bacon:              4,
    },
    hubs:       { chicken_hub: 86, pork_hub: 4 },
    categories: { meat: 90 },
    subtypes:   ["chicken_cut", "wing", "nugget", "sausage"],
    primaryHubsOrdered: ["chicken_hub"],
  },

  // ── Deli meats ──────────────────────────────────────────────────
  boars_head: {
    canonicals: {
      turkey:           14,
      ham:              12,
      salami:            8,
      prosciutto:        4,
      pastrami:          6,
      roast_beef:        5,
      mortadella:        3,
      bologna:           3,
      capicola:          3,
      cheddar:           8,
      swiss:             6,
      american_cheese:   5,
      provolone:         5,
      muenster:          3,
    },
    hubs:       { turkey_hub: 14, beef_hub: 11, pork_hub: 30, cheese_hub: 27 },
    categories: { meat: 55, dairy: 27 },
    subtypes:   ["deli", "cheese"],
    primaryHubsOrdered: ["pork_hub", "cheese_hub", "turkey_hub", "beef_hub"],
  },
  applegate: {
    canonicals: {
      turkey:        8,
      ham:           5,
      bacon:         6,
      hot_dogs:      8,
      bologna:       3,
      salami:        4,
      sausage:       6,
      chicken:       5,
    },
    hubs:       { turkey_hub: 8, pork_hub: 28, chicken_hub: 5 },
    categories: { meat: 45 },
    subtypes:   ["deli", "sausage"],
    primaryHubsOrdered: ["pork_hub", "turkey_hub"],
  },
  oscar_mayer: {
    canonicals: {
      hot_dogs:        12,
      bacon:            8,
      bologna:          6,
      ham:              6,
      turkey:           6,
      salami:           3,
      lunchables:       8,
    },
    hubs:       { pork_hub: 35, turkey_hub: 6 },
    categories: { meat: 49 },
    subtypes:   ["deli", "sausage", "boxed_meal"],
    primaryHubsOrdered: ["pork_hub", "turkey_hub"],
  },
  hillshire_farm: {
    canonicals: {
      sausage:         15,
      kielbasa:         5,
      smoked_sausage:   6,
      turkey:           4,
      ham:              4,
    },
    hubs:       { pork_hub: 30, turkey_hub: 4 },
    categories: { meat: 34 },
    subtypes:   ["sausage", "deli"],
    primaryHubsOrdered: ["pork_hub"],
  },

  // ── Sauces / condiments / sweeteners ────────────────────────────
  mikes_hot_honey: {
    canonicals: {
      honey:           8,
      hot_honey:       4,
    },
    hubs:       {},  // no honey hub in the registry
    categories: { pantry: 12 },
    subtypes:   ["sauce", "sweetener"],
    primaryHubsOrdered: [],
  },
  franks_redhot: {
    canonicals: {
      hot_sauce:       12,
      buffalo_sauce:    4,
      wing_sauce:       4,
    },
    hubs:       {},
    categories: { pantry: 20 },
    subtypes:   ["sauce"],
    primaryHubsOrdered: [],
  },
  cholula: {
    canonicals: {
      hot_sauce:       10,
    },
    hubs:       {},
    categories: { pantry: 10 },
    subtypes:   ["sauce"],
    primaryHubsOrdered: [],
  },
  heinz: {
    canonicals: {
      ketchup:         12,
      mayonnaise:       8,
      bbq_sauce:        6,
      yellow_mustard:   4,
      relish:           4,
      worcestershire:   3,
    },
    hubs:       {},
    categories: { pantry: 37 },
    subtypes:   ["sauce", "condiment"],
    primaryHubsOrdered: [],
  },
  hellmanns: {
    canonicals: {
      mayonnaise:      14,
      ranch_dressing:   3,
    },
    hubs:       {},
    categories: { pantry: 17 },
    subtypes:   ["condiment", "dressing"],
    primaryHubsOrdered: [],
  },
  kraft: {
    canonicals: {
      mac_and_cheese:    12,
      mayonnaise:         8,
      bbq_sauce:          6,
      cheese_singles:    10,
      shredded_cheese:   12,
      ranch_dressing:     5,
      italian_dressing:   3,
    },
    hubs:       { cheese_hub: 22 },
    categories: { dairy: 22, pantry: 34 },
    subtypes:   ["cheese", "boxed_meal", "dressing", "sauce", "condiment"],
    primaryHubsOrdered: ["cheese_hub"],
  },

  // ── Cheese / butter / dairy ─────────────────────────────────────
  kerrygold: {
    canonicals: {
      butter:          14,
      irish_cheese:     6,
      cheddar:          5,
    },
    hubs:       { cheese_hub: 11 },
    categories: { dairy: 25 },
    subtypes:   ["butter", "cheese"],
    primaryHubsOrdered: ["cheese_hub"],
  },
  tillamook: {
    canonicals: {
      cheddar:         16,
      ice_cream:       12,
      yogurt:           8,
      sour_cream:       4,
      butter:           4,
    },
    hubs:       { cheese_hub: 16, yogurt_hub: 8, milk_hub: 4 },
    categories: { dairy: 44 },
    subtypes:   ["cheese", "ice_cream", "yogurt", "butter"],
    primaryHubsOrdered: ["cheese_hub", "yogurt_hub"],
  },
  sargento: {
    canonicals: {
      shredded_cheese:  18,
      sliced_cheese:    14,
      string_cheese:     8,
      mozzarella:        8,
      cheddar:           8,
      provolone:         5,
      parmesan:          4,
    },
    hubs:       { cheese_hub: 65 },
    categories: { dairy: 65 },
    subtypes:   ["cheese"],
    primaryHubsOrdered: ["cheese_hub"],
  },
  philadelphia: {
    canonicals: {
      cream_cheese:    16,
    },
    hubs:       { cheese_hub: 16 },
    categories: { dairy: 16 },
    subtypes:   ["cheese"],
    primaryHubsOrdered: ["cheese_hub"],
  },

  // ── Yogurt ──────────────────────────────────────────────────────
  chobani: {
    canonicals: {
      greek_yogurt:    24,
      yogurt:          12,
      yogurt_drink:     6,
    },
    hubs:       { yogurt_hub: 42 },
    categories: { dairy: 42 },
    subtypes:   ["yogurt"],
    primaryHubsOrdered: ["yogurt_hub"],
  },
  fage: {
    canonicals: {
      greek_yogurt:    14,
    },
    hubs:       { yogurt_hub: 14 },
    categories: { dairy: 14 },
    subtypes:   ["yogurt"],
    primaryHubsOrdered: ["yogurt_hub"],
  },
  oikos: {
    canonicals: {
      greek_yogurt:    16,
    },
    hubs:       { yogurt_hub: 16 },
    categories: { dairy: 16 },
    subtypes:   ["yogurt"],
    primaryHubsOrdered: ["yogurt_hub"],
  },

  // ── Candy / chocolate / inclusions ──────────────────────────────
  // These brands are heavy candy/chocolate manufacturers. When their
  // name appears on a product whose canonical lives OUTSIDE their
  // expertise (e.g. M&M's on a cookie, Reese's on an ice cream),
  // classifyBrandMentions demotes them to "ingredient mention" — the
  // brand is licensed as an INCLUSION, not the actual manufacturer.
  mms: {
    canonicals: {
      candy:               12,
      chocolate_candy:     14,
      peanut_butter_candy:  4,
    },
    hubs:       {},
    categories: { pantry: 30 },
    subtypes:   ["candy"],
    primaryHubsOrdered: [],
  },
  reeses: {
    canonicals: {
      peanut_butter_cup:   12,
      chocolate_candy:      6,
      candy:                4,
    },
    hubs:       {},
    categories: { pantry: 22 },
    subtypes:   ["candy"],
    primaryHubsOrdered: [],
  },
  hersheys: {
    canonicals: {
      chocolate:           18,
      chocolate_candy:     14,
      cocoa_powder:         4,
      chocolate_chips:      5,
    },
    hubs:       {},
    categories: { pantry: 41 },
    subtypes:   ["candy", "chocolate"],
    primaryHubsOrdered: [],
  },
  snickers: {
    canonicals: {
      candy_bar:           8,
      chocolate_candy:     4,
    },
    hubs:       {},
    categories: { pantry: 12 },
    subtypes:   ["candy"],
    primaryHubsOrdered: [],
  },
  oreo: {
    // Oreo IS a real cookie brand (Mondelez) — subtypes=["cookie"]
    // means on a non-cookie SKU (Klondike Oreo, Breyers Oreo) it
    // demotes correctly: subtype mismatch to "ice_cream".
    canonicals: {
      cookie:              10,
      cookies_and_cream:    4,
      sandwich_cookie:      8,
    },
    hubs:       {},
    categories: { pantry: 22 },
    subtypes:   ["cookie"],
    primaryHubsOrdered: [],
  },
  kit_kat: {
    canonicals: {
      candy_bar:           6,
      chocolate_candy:     4,
    },
    hubs:       {},
    categories: { pantry: 10 },
    subtypes:   ["candy"],
    primaryHubsOrdered: [],
  },
  nutella: {
    canonicals: {
      hazelnut_spread:     5,
      chocolate_spread:    3,
    },
    hubs:       {},
    categories: { pantry: 8 },
    subtypes:   ["spread"],
    primaryHubsOrdered: [],
  },

  // ── Cookies / baked snacks ──────────────────────────────────────
  // Real cookie/cracker brands — primary on cookie canonicals.
  chips_ahoy: {
    canonicals: {
      cookie:              16,
      chocolate_chip_cookie: 12,
    },
    hubs:       {},
    categories: { pantry: 28 },
    subtypes:   ["cookie"],
    primaryHubsOrdered: [],
  },
  famous_amos: {
    canonicals: {
      cookie:               6,
      chocolate_chip_cookie: 5,
    },
    hubs:       {},
    categories: { pantry: 11 },
    subtypes:   ["cookie"],
    primaryHubsOrdered: [],
  },
  pepperidge_farm: {
    canonicals: {
      cookie:               8,
      cracker:              6,
      bread:                6,
      goldfish:             4,
    },
    hubs:       { bread_hub: 6 },
    categories: { pantry: 24 },
    subtypes:   ["cookie", "cracker", "bread"],
    primaryHubsOrdered: ["bread_hub"],
  },
  keebler: {
    canonicals: {
      cookie:               8,
      cracker:              6,
    },
    hubs:       {},
    categories: { pantry: 14 },
    subtypes:   ["cookie", "cracker"],
    primaryHubsOrdered: [],
  },

  // ── Ice cream ───────────────────────────────────────────────────
  // Real ice-cream manufacturers — primary on ice_cream canonicals
  // even when M&M's or Oreo licensing surfaces in the productName.
  ben_jerrys: {
    canonicals: {
      ice_cream:           24,
      frozen_yogurt:        4,
    },
    hubs:       {},
    categories: { dairy: 28 },
    subtypes:   ["ice_cream"],
    primaryHubsOrdered: [],
  },
  haagen_dazs: {
    canonicals: {
      ice_cream:           20,
    },
    hubs:       {},
    categories: { dairy: 20 },
    subtypes:   ["ice_cream"],
    primaryHubsOrdered: [],
  },
  breyers: {
    canonicals: {
      ice_cream:           18,
    },
    hubs:       {},
    categories: { dairy: 18 },
    subtypes:   ["ice_cream"],
    primaryHubsOrdered: [],
  },
  klondike: {
    canonicals: {
      ice_cream:           10,
      ice_cream_bar:        8,
    },
    hubs:       {},
    categories: { dairy: 18 },
    subtypes:   ["ice_cream"],
    primaryHubsOrdered: [],
  },

  // ── Multi-line conglomerate / shelf-stable ──────────────────────
  // These brands span so many categories that picking a primary hub
  // is meaningless; their value here is BRAND-KNOWNNESS as a
  // tie-breaker. Empty primaryHubsOrdered signals "no specialty —
  // resolve by canonical match alone."
  general_mills: {
    canonicals: {
      cereal:          12,
      flour:            6,
      yogurt:           8,
    },
    hubs:       { flour_hub: 6, yogurt_hub: 8 },
    categories: { pantry: 18, dairy: 8 },
    primaryHubsOrdered: [],
  },
  nestle: {
    canonicals: {
      chocolate:       10,
      ice_cream:        8,
      coffee:           6,
      water:            5,
    },
    hubs:       { milk_hub: 8 },
    categories: { pantry: 21, dairy: 8 },
    primaryHubsOrdered: [],
  },
};

// USDA-derived expertise — auto-generated by
// scripts/derive_brand_expertise.js from the USDA Branded Foods
// dataset. The committed stub at brandExpertiseDerived.js exports
// an empty object until the script is run; once generated, this
// import surfaces a histogram covering hundreds-to-thousands of
// brands the curated seed below doesn't reach.
//
// Curated entries in BRAND_EXPERTISE add ON TOP of derived counts
// (see mergeRecords + expertiseFor below) so hand-tuned tweaks
// always win on conflict, but coverage extends to whatever USDA
// has cataloged.
import { BRAND_EXPERTISE_FROM_USDA as DERIVED } from "./brandExpertiseDerived";

// Merge derived + curated counts for a brand slug. Curated wins on
// every key that's present in BRAND_EXPERTISE; derived fills in
// canonicals/hubs/categories the curated entry doesn't cover.
//
// SUBTYPE MERGE RULE — curated subtypes are AUTHORITATIVE INTENT,
// not observation. When a brand has explicit curated subtypes, use
// that list VERBATIM and ignore USDA-derived subtypes. Reason:
// USDA's observational data correctly shows that M&M's appears on
// some cookie SKUs (real licensed inclusion products) — but the
// curated entry encodes "M&M's IS a candy brand" as intent. Unioning
// would dilute the demotion gate: M&M's-on-cookie would stop being
// classified as an inclusion-licensor because USDA observed 3 cookie-
// branded M&M's SKUs.
//
// USDA-only brands (no curated entry) keep their derived subtypes
// — that's the whole point of the derivation pipeline.
function mergeRecords(curated, derived) {
  if (!curated && !derived) return null;
  if (!derived) return curated;
  if (!curated) return derived;
  // Subtype rule: prefer curated when present, else fall back to
  // derived. Don't union — see comment above.
  const subtypes =
    (Array.isArray(curated.subtypes) && curated.subtypes.length > 0)
      ? curated.subtypes
      : (Array.isArray(derived.subtypes) ? derived.subtypes : []);
  return {
    canonicals: { ...derived.canonicals, ...curated.canonicals },
    hubs:       { ...derived.hubs,       ...curated.hubs       },
    categories: { ...derived.categories, ...curated.categories },
    subtypes,
    primaryHubsOrdered:
      curated.primaryHubsOrdered || derived.primaryHubsOrdered || [],
  };
}

// Look up the expertise record for a brand display string. Slugifies
// internally so callers can pass "Slim Jim" or "slim jim" — both
// resolve to the same record. Merges curated + USDA-derived data so
// brands not in the curated seed still get classification weights
// from the broader USDA Branded Foods dataset.
export function expertiseFor(brandDisplay) {
  const slug = brandSlugify(brandDisplay);
  if (!slug) return null;
  return mergeRecords(BRAND_EXPERTISE[slug] || null, DERIVED[slug] || null);
}

// Sum the brand's total observation count across all canonicals AND
// USDA-derived category observations. Used as a tie-breaker when two
// candidates have equal canonical/hub scores ("how much do we know
// about this brand AT ALL?"). A brand with broad SKU breadth wins
// over a brand we barely know.
export function brandTotalObservations(brandDisplay) {
  const slug = brandSlugify(brandDisplay);
  if (!slug) return 0;
  let n = 0;
  const curated = BRAND_EXPERTISE[slug];
  if (curated) for (const v of Object.values(curated.canonicals || {})) n += Number(v) || 0;
  const derived = DERIVED[slug];
  if (derived) n += Number(derived.totalObs) || 0;
  return n;
}
