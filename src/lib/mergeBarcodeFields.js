// Field-aware OFF/USDA/correction merger.
//
// Before this helper, scan-time merging was "OFF wins, correction
// fills gaps":
//
//   brand: off.brand || correction.brand
//   name:  off.productName || correction.name
//
// That's wrong for some fields. USDA's `branded_food_category` is a
// structured taxonomy ("Cookies & Biscuits") that maps cleanly into
// our subtype/category axes; OFF's `categories_tags` is free-form
// ("en:biscuits-and-cakes, en:chocolate-biscuits"). For categoryHints,
// USDA usually beats OFF. For productName, OFF's marketing copy beats
// USDA's clinical "BISCUITS, CHOCOLATE COATED, WAFER FILLED" all-caps
// description.
//
// The fix is per-field source priorities. Each field has a default
// priority order; admin overrides always win; otherwise we pick the
// highest-scoring non-empty value.
//
// PROVENANCE SOURCE: barcode_identity_corrections.source_provenance
// (jsonb, migration 0130) holds per-column source tags written by the
// ingest pipeline. Lookup goes:
//
//   correction.brand       — actual value
//   prov.brand             — "usda" | "off" | "admin" (from ingest)
//   off.brand              — fresh OFF call value (always source="off")
//
// This helper picks the highest-priority non-empty value per field
// and returns the merged shape.
//
// USED BY:
//   - AddDraftSheet's scan handler (post-OFF lookup)
//   - ShopMode's handleDetected (when brand_nutrition cache missed
//     and we're hitting both correction + fresh OFF)
//   - Any future scan consumer that has both an OFF result and a
//     correction row in scope

// Default priority — higher wins. Admin always wins. For most fields
// USDA edges out OFF because USDA's data is structured and regulated;
// OFF is community-contributed marketing copy.
const DEFAULT_PRIORITIES = {
  admin: 100,
  usda:   50,
  off:    30,
  // Fresh OFF call (no provenance yet) gets the same weight as
  // ingested OFF. The "scan" key is what we tag a fresh res from
  // lookupBarcode with — see callers below.
  scan:   30,
};

// Per-field overrides. When an entry is present here, it FULLY
// REPLACES the default priorities for that field — list every
// source you want considered.
const FIELD_PRIORITIES = {
  // OFF's productName carries human-readable marketing copy USDA's
  // ALL-CAPS technical description never matches. Even an admin
  // pick has to be EXPLICITLY admin to win — otherwise OFF.
  name: { admin: 100, off: 60, usda: 30, scan: 50 },

  // OFF often fills brand_name with a display-cased consumer string;
  // USDA's brand_owner is the legal entity ("Boar's Head Brand,
  // LLC"). Default to OFF preferred — the consumer-facing display
  // is closer to what the user expects to see on a chip.
  brand: { admin: 100, off: 50, usda: 40, scan: 50 },

  // Package size — USDA's serving-size data is regulated; OFF
  // normalization is inconsistent (varies by user-contributed
  // tagging). USDA wins.
  packageSizeAmount: { admin: 100, usda: 60, off: 30, scan: 30 },
  packageSizeUnit:   { admin: 100, usda: 60, off: 30, scan: 30 },

  // Image — only OFF has these in practice. USDA never carries
  // images; admin uploads land here too.
  imageUrl: { admin: 100, off: 60, usda: 0, scan: 60 },

  // Canonical id — admin promotion is sacred; OFF/USDA-derived
  // canonical_id is rare (mostly from learned tag mappings). Default
  // OFF/scan over USDA since the resolver does its own canonical
  // resolution from text.
  canonicalId: { admin: 100, off: 50, usda: 40, scan: 50 },
};

function priorityFor(field, source) {
  const table = FIELD_PRIORITIES[field] || DEFAULT_PRIORITIES;
  if (source && table[source] != null) return table[source];
  // Unknown source → 0. Skip rather than crash.
  return 0;
}

// Pick the best value from a list of { value, source } pairs.
// Empty / null values are ignored. Ties resolve to the first entry
// (caller's first-listed source wins) so caller order is meaningful.
function pickBest(field, candidates) {
  let best = null;
  for (const c of candidates) {
    if (c.value == null || c.value === "") continue;
    const score = priorityFor(field, c.source);
    if (best == null || score > best.score) {
      best = { ...c, score };
    }
  }
  return best?.value ?? null;
}

/**
 * Merge a correction row + a fresh OFF lookup result into one
 * authoritative shape, using per-field source priorities.
 *
 * @param {object} args
 * @param {object} [args.correction]   — output of findBarcodeCorrection()
 *                                       (already includes sourceProvenance)
 * @param {object} [args.off]          — output of lookupBarcode() (always
 *                                       treated as source="scan")
 * @returns {object} merged fields:
 *   { brand, productName, packageSizeAmount, packageSizeUnit,
 *     imageUrl, canonicalId, categoryHints, providers }
 *
 *   `providers` is a {field: source} map describing which source
 *   actually provided each merged value, useful for logging /
 *   debugging "where did this brand come from?"
 */
export function mergeBarcodeFields({ correction = null, off = null } = {}) {
  const prov = correction?.sourceProvenance || {};
  const providers = {};

  function pick(field, candidates) {
    const value = pickBest(field, candidates);
    if (value != null && value !== "") {
      // Track which source we picked from
      for (const c of candidates) {
        if (c.value === value && c.source) {
          providers[field] = c.source;
          break;
        }
      }
    }
    return value;
  }

  const brand = pick("brand", [
    { value: correction?.brand,           source: prov.brand           || "usda" },
    { value: off?.brand,                  source: "scan" },
  ]);
  const productName = pick("name", [
    { value: correction?.name,            source: prov.name            || "usda" },
    { value: off?.productName,            source: "scan" },
  ]);
  const packageSizeAmount = pick("packageSizeAmount", [
    { value: correction?.packageSizeAmount, source: prov.package_size_amount || "usda" },
    { value: off?.packageSize?.amount,      source: "scan" },
  ]);
  const packageSizeUnit = pick("packageSizeUnit", [
    { value: correction?.packageSizeUnit,   source: prov.package_size_unit   || "usda" },
    { value: off?.packageSize?.unit,        source: "scan" },
  ]);
  const imageUrl = pick("imageUrl", [
    { value: correction?.imageUrl,          source: prov.image_url || "off" },
    { value: off?.imageUrl,                 source: "scan" },
  ]);
  const canonicalId = pick("canonicalId", [
    { value: correction?.canonicalId,       source: prov.canonical_id || "off" },
    { value: off?.canonicalId,              source: "scan" },
  ]);

  // categoryHints — array union. No source_provenance entry on
  // the corrections row (arrays are unioned, not overwritten on
  // ingest). The merged array preserves correction-tier hints
  // first (those came from USDA's structured taxonomy via the
  // ingest pipeline) and appends any fresh OFF hints not already
  // covered. Capped at 20 to avoid runaway growth.
  const corrHints = Array.isArray(correction?.categoryHints) ? correction.categoryHints : [];
  const offHints  = Array.isArray(off?.categoryHints)        ? off.categoryHints        : [];
  const seenHint = new Set();
  const categoryHints = [];
  for (const h of [...corrHints, ...offHints]) {
    if (!h || seenHint.has(h)) continue;
    seenHint.add(h);
    categoryHints.push(h);
    if (categoryHints.length >= 20) break;
  }
  if (corrHints.length > 0 || offHints.length > 0) {
    providers.categoryHints =
      corrHints.length >= offHints.length ? "usda" : "off";
  }

  return {
    brand,
    productName,
    packageSizeAmount,
    packageSizeUnit,
    imageUrl,
    canonicalId,
    categoryHints,
    providers,
  };
}
