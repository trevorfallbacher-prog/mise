#!/usr/bin/env node
/**
 * scripts/ingest_external_baseline.js
 *
 * One-shot (re-runnable) ingest of USDA Branded Foods + Open Food
 * Facts into barcode_identity_corrections. Both sources feed a single
 * merged baseline per UPC — brand / name / package size / image /
 * category hints pre-filled so a fresh scan of a previously-unseen
 * UPC lands with useful identity without asking the user anything.
 *
 * The resolver's existing tier-1 global read (findBarcodeCorrection)
 * picks these rows up automatically; no read-path changes needed.
 *
 * ── Input format ────────────────────────────────────────────────────
 * Auto-detected by file extension on --input:
 *   *.csv     — USDA's branded_food.csv (from the FDC CSV download
 *               bundle). Streams line-by-line, flat memory. The
 *               RECOMMENDED format for USDA — smaller, faster, and
 *               doesn't need jq preprocessing. Pass --food-csv=<path>
 *               (or place food.csv next to branded_food.csv) to
 *               also pull descriptions + ingredient declarations
 *               from the joined food.csv. Without the join, name
 *               stays null and the ingredients column is skipped.
 *   *.jsonl   — One product object per line. USDA JSON dump converted
 *               with `jq -c '.BrandedFoods[]' …` or OFF's native
 *               openfoodfacts-products.jsonl dump. Carries the
 *               description, but the 2GB USDA JSON can OOM modest
 *               laptops during conversion — prefer CSV for USDA.
 *
 * ── Merge rules (per-field provenance) ───────────────────────────────
 *   admin     — locked. Ingest NEVER overwrites a field whose
 *               source_provenance entry is "admin".
 *   usda, off — siblings. Whichever fills an empty field first wins;
 *               the other fills remaining empty fields on a later run.
 *   (unset)   — treated as empty; ingest fills + stamps provenance.
 *
 * ── CLI ─────────────────────────────────────────────────────────────
 *   node scripts/ingest_external_baseline.js \
 *     --source=usda \
 *     --input=./branded_food.csv \
 *     [--food-csv=./food.csv] \
 *     [--batch=1000] [--limit=50000] [--dry-run]
 *
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env.
 *
 * Service-role client bypasses RLS, so the ingest runs without an
 * auth'd admin session. created_by stays null on ingest-written rows
 * (migration 0130 relaxed the NOT NULL).
 */

import { createClient } from "@supabase/supabase-js";
import { createReadStream, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

// Deliberately does NOT import the scan-time canonical resolver. The
// app's canonicalResolver / ingredients modules use extensionless
// imports that webpack resolves for the browser but node ESM can't.
// Rather than reshape those modules (cascading change across 20+
// files) or re-bundle for node, the ingest writes baseline rows with
// canonical_id=null — scan-time in the browser runs the full
// resolver against the pre-filled brand / name / category_hints and
// proposes a canonical when a user actually hits the UPC. That keeps
// the ingest lean and matches the "conservative auto-link" mandate.

// ── CLI parsing ────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const SOURCE  = args.source;
const INPUT   = args.input;
const BATCH   = Number(args.batch) || 1000;
const LIMIT   = args.limit ? Number(args.limit) : Infinity;
const DRY_RUN = Boolean(args["dry-run"]);
// Optional path to USDA's food.csv — joined to branded_food.csv on
// fdc_id to pull the `description` field (USDA's product name).
// Without this, USDA CSV ingest leaves `name` null and we have no
// product identity for store-brand SKUs that OFF doesn't carry.
// Auto-detected as `food.csv` in the same directory as the
// branded_food.csv when not explicitly passed.
const FOOD_CSV = args["food-csv"] || null;

if (!SOURCE || !["usda", "off"].includes(SOURCE)) {
  console.error("Missing or invalid --source (usda|off)"); process.exit(1);
}
if (!INPUT) {
  console.error("Missing --input=<path to JSONL>"); process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(1);
}
const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Source-specific normalization ──────────────────────────────────
//
// Each source's raw record gets flattened into one ExternalRow shape
// so the merge / upsert code below stays source-agnostic:
//
//   { upc, brand, name, packageSizeAmount, packageSizeUnit,
//     imageUrl, categoryHints }
//
// Any field may be null when the source didn't carry it.

// USDA's brandedFoodCategory buckets we DO ingest. Everything outside
// this set (pet food, cosmetics, supplements, single-ingredient bulk
// commodities, etc.) is long-tail for a kitchen scan and would pollute
// the corrections table with rows we'll never read. Lean > exhaustive.
const USDA_GROCERY_CATEGORIES = new Set([
  "Breakfast Cereals",
  "Breakfast Foods",
  "Cheese",
  "Yogurt",
  "Milk",
  "Cream",
  "Butter",
  "Ice Cream & Frozen Yogurt",
  "Eggs & Egg Substitutes",
  "Bread & Buns",
  "Breads & Buns",
  "Rolls & Buns",
  "Baking Accessories",
  "Baking Additives & Extracts",
  "Flours & Corn Meal",
  "Sugars",
  "Baking/Cooking Mixes (Perishable)",
  "Baking/Cooking Mixes (Shelf Stable)",
  "Fresh Meat",
  "Frozen Meat",
  "Pre-Packaged Fruit & Vegetables",
  "Vegetables - Unprepared/Unprocessed (Frozen)",
  "Vegetables - Prepared/Processed",
  "Fruit - Unprepared/Unprocessed (Frozen)",
  "Fruit - Prepared/Processed",
  "Pickles, Olives, Peppers & Relishes",
  "Canned Fruit",
  "Canned Vegetables",
  "Jam, Jelly & Fruit Spreads",
  "Honey",
  "Herbs & Spices",
  "Salt",
  "Seasoning Mixes, Salts, Marinades & Tenderizers",
  "Oil",
  "Vinegars",
  "Salad Dressing & Mayonnaise",
  "Condiments",
  "Pickled Fruits, Vegetables & Other Foods",
  "Pasta",
  "Pasta Dinners (Shelf Stable)",
  "Pasta by Shape & Type",
  "Rice",
  "Grains",
  "Beans",
  "Canned Beans",
  "Canned Soup",
  "Soups - Prepared",
  "Sauces",
  "Soy Sauce",
  "Tomato Based Sauces",
  "Gravy",
  "Peanut & Other Nut Butters",
  "Nuts & Seeds - Prepared/Processed",
  "Chips, Pretzels & Snacks",
  "Snack, Energy & Granola Bars",
  "Cookies & Biscuits",
  "Crackers",
  "Candy",
  "Chocolate",
  "Frozen Dinners & Entrees",
  "Frozen Appetizers & Hors D'oeuvres",
  "Frozen Pizza",
  "Frozen Breakfast Foods",
  "Frozen Bread & Dough",
  "Frozen Vegetables",
  "Frozen Fruit",
  "Frozen Desserts",
  "Pizza - Frozen",
  "Pre-Packaged Fruit & Vegetables (Frozen)",
  "Soft Drinks",
  "Fruit & Vegetable Juice, Nectars & Fruit Drinks",
  "Tea Bags & Loose Tea",
  "Coffee",
  "Water",
  "Sports Drinks",
  "Energy Drinks",
  "Plant Based Water",
  "Milk Substitutes (Perishable)",
  "Milk Substitutes (Shelf Stable)",
  "Tofu & Soy Products",
  "Deli Salads",
  "Lunch & Deli Meats",
  "Hot Dogs, Sausages & Lunch Meats",
  "Bacon, Sausages & Ribs",
  "Seafood",
  "Canned Tuna, Salmon & Seafood",
]);

function normalizeUsda(rec) {
  const upc = cleanUpc(rec.gtinUpc);
  if (!upc) return null;
  const cat = rec.brandedFoodCategory || "";
  if (!USDA_GROCERY_CATEGORIES.has(cat)) return null;
  const brand = stringOrNull(rec.brandName) || stringOrNull(rec.brandOwner);
  const name = stringOrNull(rec.description) || stringOrNull(rec.shortDescription);
  const sizeRaw = rec.householdServingFullText || rec.packageWeight || null;
  const size = sizeRaw ? parseSize(String(sizeRaw)) : null;
  return {
    upc,
    brand: brand ? normalizeBrand(brand) : null,
    name,
    packageSizeAmount: size?.amount ?? null,
    packageSizeUnit:   size?.unit || null,
    imageUrl: null,                               // USDA has none
    categoryHints: cat ? [slugify(cat)] : [],
  };
}

// fdc_id → description map, populated from USDA's food.csv before
// the main pass starts. Module-scoped so normalizeUsdaCsv can read
// without prop-threading. Populated only when --food-csv is passed
// or food.csv is auto-detected next to branded_food.csv. Keeping
// it an empty Map by default means the original "name stays null"
// behavior holds when food.csv isn't available — no regression.
const fdcDescriptionMap = new Map();

// Stream USDA's food.csv (~2GB) once into a Map<fdc_id, description>.
// Only the two columns we need are kept; everything else gets
// discarded as we read, so memory peaks at ~150MB for ~1.5M USDA
// branded foods. Single hash-table pass; no joins after this.
async function loadFoodCsv(path) {
  if (!path || !existsSync(path)) {
    console.log("[ingest] no food.csv at " + (path || "(none)") + " — names will stay null");
    return;
  }
  console.log("[ingest] loading USDA food.csv → fdc_id → description map: " + path);
  const t0 = Date.now();
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let headers = null;
  let count = 0;
  for await (const line of rl) {
    if (!line) continue;
    const fields = splitCsvLine(line);
    if (!fields) continue;
    if (!headers) {
      headers = fields.map(h => h.trim());
      continue;
    }
    // Two columns only: fdc_id + description. Everything else
    // gets dropped on the floor for memory.
    const idIdx   = headers.indexOf("fdc_id");
    const descIdx = headers.indexOf("description");
    if (idIdx < 0 || descIdx < 0) {
      console.warn("[ingest] food.csv missing fdc_id/description columns; skipping");
      return;
    }
    const id   = fields[idIdx];
    const desc = fields[descIdx];
    if (id && desc) fdcDescriptionMap.set(String(id), desc);
    count += 1;
    if (count % 200000 === 0) console.log("  " + count.toLocaleString() + " food.csv rows read…");
  }
  console.log(
    "[ingest] food.csv loaded " + fdcDescriptionMap.size.toLocaleString()
    + " descriptions in " + ((Date.now() - t0) / 1000).toFixed(1) + "s",
  );
}

// CSV variant of USDA — pulls every useful column USDA carries:
//   - fdc_id → joined to food.csv for description (the product name)
//   - brand_name + brand_owner (we already used) + subbrand_name (NEW)
//   - ingredients (NEW — full ingredient declaration string)
//   - serving_size + serving_size_unit (NEW — granular nutrition info)
//   - household_serving_fulltext + package_weight (already used)
//   - branded_food_category (already used)
//
// Returns the same shape as normalizeUsda PLUS productMetadata for
// USDA-specific extras that don't have first-class columns:
//   { subbrand_name, ingredients_text, serving_size_g, serving_size_unit }
function normalizeUsdaCsv(rec) {
  const upc = cleanUpc(rec.gtin_upc);
  if (!upc) return null;
  const cat = rec.branded_food_category || "";
  if (!USDA_GROCERY_CATEGORIES.has(cat)) return null;
  const brand = stringOrNull(rec.brand_name) || stringOrNull(rec.brand_owner);

  // Description from food.csv via fdc_id join. Fallback null when
  // food.csv wasn't provided/loaded — original behavior preserved.
  const fdcId = stringOrNull(rec.fdc_id);
  const name  = fdcId ? (fdcDescriptionMap.get(String(fdcId)) || null) : null;

  // Ingredients declaration — the load-bearing new field. Drives
  // dietary warnings + claim extraction at scan time. Stored verbatim
  // in product_metadata.ingredients_text; tokenization happens at
  // read time so we can re-parse without a re-ingest.
  const ingredientsText = stringOrNull(rec.ingredients);

  // Subbrand (e.g. "Vlasic" + "Farmer's Garden" line). Useful for
  // brand-classification on collab / line products. Stashed in
  // product_metadata.subbrand_name.
  const subbrand = stringOrNull(rec.subbrand_name);

  // Serving size — USDA's regulated per-serving weight. Independent
  // from package_weight (the whole container). Stashed in
  // product_metadata for diet / nutrition lookups.
  const servingSize     = stringOrNull(rec.serving_size);
  const servingSizeUnit = stringOrNull(rec.serving_size_unit);

  // Package size — same as before.
  const sizeRaw = rec.household_serving_fulltext || rec.package_weight || null;
  const size = sizeRaw ? parseSize(String(sizeRaw)) : null;

  // product_metadata jsonb for everything that doesn't have a
  // first-class column. Only included when we have at least one
  // value; empty objects skipped to keep diffs clean.
  const meta = {};
  if (ingredientsText) meta.ingredients_text = ingredientsText;
  if (subbrand)        meta.subbrand_name    = subbrand;
  if (servingSize && servingSizeUnit) {
    meta.serving_size      = Number(servingSize) || servingSize;
    meta.serving_size_unit = servingSizeUnit;
  }

  return {
    upc,
    brand: brand ? normalizeBrand(brand) : null,
    name,
    packageSizeAmount: size?.amount ?? null,
    packageSizeUnit:   size?.unit || null,
    imageUrl: null,
    categoryHints: cat ? [slugify(cat)] : [],
    productMetadata: Object.keys(meta).length > 0 ? meta : null,
  };
}

function normalizeOff(rec) {
  const upc = cleanUpc(rec.code || rec._id);
  if (!upc) return null;
  const brand = stringOrNull(rec.brands);
  const name  = stringOrNull(rec.product_name) || stringOrNull(rec.generic_name);
  const size  = rec.quantity ? parseSize(String(rec.quantity)) : null;
  const hints = Array.isArray(rec.categories_tags)
    ? rec.categories_tags
        .filter(t => typeof t === "string" && t.startsWith("en:"))
        .map(t => t.slice(3))
    : [];
  return {
    upc,
    brand: brand ? normalizeBrand(brand) : null,
    name,
    packageSizeAmount: size?.amount ?? null,
    packageSizeUnit:   size?.unit || null,
    imageUrl: stringOrNull(rec.image_front_url) || stringOrNull(rec.image_url),
    categoryHints: hints,
  };
}

// Minimal package-size parser — covers the 80% "16 oz" / "500 g" /
// "1.5 L" / "12 ct" case that both USDA and OFF use. Browser-side
// scan flow runs the full canonicalResolver.parsePackageSize with
// multipack + counterpart support; the ingest just needs primary
// amount+unit for the dashboard. Anything it can't parse stays null,
// and the user's next edit teaches the family tier as usual.
const UNIT_ALIASES = {
  g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  mg: "mg", milligram: "mg", milligrams: "mg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml",
  l: "l", liter: "l", liters: "l",
  ct: "count", count: "count", pieces: "count", piece: "count",
};
function parseSize(raw) {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.toLowerCase().match(/(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (!m) return null;
  const amount = Number(m[1]);
  const unit = UNIT_ALIASES[m[2]];
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  return { amount: Math.round(amount * 10) / 10, unit };
}

// Admin-tier normalization: strip corporate suffixes, collapse case/
// whitespace, preserve the user-visible brand spelling as the first
// non-empty token run. "KERRYGOLD USA INC" → "Kerrygold"; "Hain
// Celestial Group Inc." → "Hain Celestial Group". Not perfect — a
// proper dictionary lives in a later phase — but enough to dedupe
// 80% of the string-variant tax at read time.
const BRAND_SUFFIX_RE =
  /\b(inc|inc\.|llc|l\.l\.c|co|co\.|corp|corp\.|corporation|company|limited|ltd|ltd\.|usa|intl|international|group|foods|brands)\b\.?/gi;
function normalizeBrand(raw) {
  let s = String(raw).replace(/\s+/g, " ").trim();
  s = s.replace(BRAND_SUFFIX_RE, "").replace(/[,;]+$/g, "").trim();
  // Title-case: lowercase + uppercase first letter of each word.
  return s.split(/\s+/).filter(Boolean).map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(" ");
}

function cleanUpc(raw) {
  if (raw == null) return null;
  const d = String(raw).replace(/\D+/g, "");
  if (d.length < 8 || d.length > 14) return null;
  return d;
}
function stringOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
function slugify(s) {
  return String(s).toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const IS_CSV = /\.csv$/i.test(String(INPUT));
const normalizer = SOURCE === "off"
  ? normalizeOff
  : (IS_CSV ? normalizeUsdaCsv : normalizeUsda);

// ── CSV line splitter (RFC 4180) ───────────────────────────────────
// Handles quoted fields, escaped double-quotes (""), and unquoted
// numeric/text fields. Assumes no fields span lines — branded_food.csv
// columns we consume (gtin_upc, brand_*, branded_food_category,
// household_serving_fulltext, package_weight) are all single-line in
// the USDA dataset; a multi-line ingredients field (if present)
// wouldn't match and we'd skip the row with a parseErr bump.
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let i = 0;
  const len = line.length;
  while (i < len) {
    const ch = line[i];
    if (ch === '"') {
      // Quoted field. Consume until the closing quote, honoring
      // double-quote escapes.
      i += 1;
      while (i < len) {
        const c = line[i];
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        cur += c;
        i += 1;
      }
      // After the closing quote we expect a comma or end-of-line.
      if (i < len && line[i] === ',') { out.push(cur); cur = ""; i += 1; }
      else if (i >= len) { out.push(cur); cur = ""; }
      else { return null; }   // malformed (text after closing quote)
    } else if (ch === ',') {
      out.push(cur); cur = ""; i += 1;
    } else {
      cur += ch; i += 1;
    }
  }
  out.push(cur);
  return out;
}

// ── Merge — admin fields locked, external siblings fill empties ────
function mergeFields(existing, incoming) {
  const FIELDS = [
    ["brand",               "brand"],
    ["name",                "name"],
    ["package_size_amount", "packageSizeAmount"],
    ["package_size_unit",   "packageSizeUnit"],
    ["image_url",           "imageUrl"],
    ["canonical_id",        "canonicalId"],
  ];
  const patch = {};
  const prov  = { ...(existing?.source_provenance || {}) };
  for (const [col, key] of FIELDS) {
    const nextValue = incoming[key];
    if (nextValue == null) continue;
    const currentSource = prov[col];
    if (currentSource === "admin") continue;        // locked
    const currentValue = existing?.[col];
    const isEmpty = currentValue == null || currentValue === "";
    if (!isEmpty && currentSource && currentSource !== SOURCE) continue;
    // Fill when empty, or refresh when re-running same source.
    if (isEmpty || currentSource === SOURCE) {
      patch[col] = nextValue;
      prov[col]  = SOURCE;
    }
  }
  // category_hints — array union (dedup, preserve order, cap to
  // avoid unbounded growth on popular UPCs that OFF has re-tagged
  // dozens of times).
  const incomingHints = Array.isArray(incoming.categoryHints) ? incoming.categoryHints : [];
  if (incomingHints.length > 0) {
    const existingHints = Array.isArray(existing?.category_hints) ? existing.category_hints : [];
    const seen = new Set(existingHints);
    const merged = [...existingHints];
    for (const h of incomingHints) {
      if (!h || seen.has(h)) continue;
      seen.add(h);
      merged.push(h);
      if (merged.length >= 20) break;
    }
    if (merged.length !== existingHints.length) patch.category_hints = merged;
  }

  // product_metadata — JSONB merge. USDA fills in fields the AI /
  // photo flow doesn't touch (ingredients_text, subbrand_name,
  // serving_size, etc.). We MERGE rather than replace so an admin
  // edit to one key doesn't get clobbered by an USDA re-ingest.
  // Per-key provenance isn't tracked inside the JSONB today; if the
  // same key lands from two sources, last-writer wins. That's fine
  // for the fields we currently push (USDA is the only writer
  // outside of the photo flow today, and the photo flow's fields
  // don't overlap).
  if (incoming.productMetadata && typeof incoming.productMetadata === "object") {
    const existingMeta = (existing?.product_metadata && typeof existing.product_metadata === "object")
      ? existing.product_metadata
      : {};
    const merged = { ...existingMeta };
    let changed = false;
    for (const [k, v] of Object.entries(incoming.productMetadata)) {
      if (v == null || v === "") continue;
      if (existingMeta[k] !== v) {
        merged[k] = v;
        changed = true;
      }
    }
    if (changed) patch.product_metadata = merged;
  }

  return { patch, prov };
}

// ── Main loop ──────────────────────────────────────────────────────
async function main() {
  console.log(`[ingest] source=${SOURCE} input=${INPUT} batch=${BATCH}${DRY_RUN ? " DRY-RUN" : ""}`);

  // USDA CSV mode — preload food.csv if available so the
  // normalizer can pull `description` for each branded_food.csv row.
  // Auto-detects food.csv next to the input when --food-csv isn't
  // explicitly passed. Silently no-ops when food.csv isn't found —
  // the ingest still completes, just with name=null on every row
  // (the original behavior).
  if (SOURCE === "usda" && IS_CSV) {
    const explicitFood = FOOD_CSV;
    const autoFood     = explicitFood
      ? null
      : join(dirname(INPUT), "food.csv");
    const foodPath = explicitFood || (autoFood && existsSync(autoFood) ? autoFood : null);
    if (foodPath) await loadFoodCsv(foodPath);
    else console.log("[ingest] no food.csv found — pass --food-csv=<path> to enable name + ingredients pull");
  }

  const rl = createInterface({
    input: createReadStream(INPUT, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let read = 0, skipped = 0, queued = 0, upserted = 0, parseErr = 0;
  let buffer = [];

  async function flush() {
    if (buffer.length === 0) return;
    const byUpc = new Map();
    for (const row of buffer) byUpc.set(row.upc, row);   // dedupe within batch
    const upcs = [...byUpc.keys()];
    let existing = new Map();
    if (!DRY_RUN) {
      const { data, error } = await supabase
        .from("barcode_identity_corrections")
        .select("id, barcode_upc, canonical_id, brand, name, package_size_amount, package_size_unit, image_url, category_hints, source_provenance, product_metadata")
        .in("barcode_upc", upcs);
      if (error) {
        console.warn("[ingest] batch select failed:", error.message);
        buffer = [];
        return;
      }
      for (const r of data || []) existing.set(r.barcode_upc, r);
    }
    const toInsert = [];
    const toUpdate = [];
    const now = new Date().toISOString();
    for (const row of byUpc.values()) {
      const prior = existing.get(row.upc);
      // V1 deliberately does not auto-link canonicals. All baseline
      // rows land with canonical_id=null; the browser-side resolver
      // proposes a canonical at scan time using the pre-filled brand
      // / name / category_hints. Admin can link via the normal scan
      // path; BASELINE tab surfaces the review queue.
      const { patch, prov } = mergeFields(prior, row);
      const hasPatch = Object.keys(patch).length > 0;
      if (prior) {
        if (!hasPatch) continue;
        toUpdate.push({
          id: prior.id,
          ...patch,
          source_provenance:   prov,
          last_external_sync:  now,
        });
      } else {
        toInsert.push({
          barcode_upc:        row.upc,
          ...patch,
          category_hints:     patch.category_hints || row.categoryHints || [],
          source_provenance:  prov,
          last_external_sync: now,
          correction_count:   0,      // not a user correction
        });
      }
    }
    if (DRY_RUN) {
      console.log(`[dry-run] batch: ${toInsert.length} inserts, ${toUpdate.length} updates`);
    } else {
      if (toInsert.length > 0) {
        const { error } = await supabase
          .from("barcode_identity_corrections")
          .insert(toInsert);
        if (error) console.warn("[ingest] insert failed:", error.message);
      }
      // Updates go one-at-a-time because Supabase JS has no bulk
      // per-row update. Cheap (indexed on id) and keeps the merge
      // logic per-row correct. If this becomes a bottleneck we move
      // to an RPC that takes the batch as JSONB.
      for (const upd of toUpdate) {
        const { id, ...patchFields } = upd;
        const { error } = await supabase
          .from("barcode_identity_corrections")
          .update(patchFields)
          .eq("id", id);
        if (error) console.warn("[ingest] update failed:", error.message, "upc:", upd.barcode_upc);
      }
    }
    upserted += toInsert.length + toUpdate.length;
    buffer = [];
  }

  let csvHeaders = null;     // populated on first CSV line
  for await (const line of rl) {
    if (read >= LIMIT) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    if (IS_CSV) {
      const fields = splitCsvLine(line);
      if (!fields) { parseErr += 1; continue; }
      if (!csvHeaders) { csvHeaders = fields.map(h => h.trim()); continue; }
      rec = Object.fromEntries(csvHeaders.map((h, i) => [h, fields[i] ?? null]));
    } else {
      try { rec = JSON.parse(trimmed); } catch { parseErr += 1; continue; }
    }
    read += 1;
    const normalized = normalizer(rec);
    if (!normalized) { skipped += 1; continue; }
    buffer.push(normalized);
    queued += 1;
    if (buffer.length >= BATCH) {
      await flush();
      if (read % (BATCH * 10) === 0) {
        console.log(`[progress] read=${read} queued=${queued} upserted=${upserted} skipped=${skipped}`);
      }
    }
  }
  await flush();
  console.log(`[done] read=${read} queued=${queued} upserted=${upserted} skipped=${skipped} parseErr=${parseErr}`);
}

main().catch(err => { console.error(err); process.exit(1); });
