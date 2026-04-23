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
 * JSONL — one product object per line. Convert the USDA JSON dump
 * with:
 *   jq -c '.BrandedFoods[]' brandedDownload.json > usda.jsonl
 *
 * OFF publishes JSONL natively (openfoodfacts-products.jsonl.gz).
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
 *     --input=./usda.jsonl \
 *     [--batch=1000] [--limit=50000] [--dry-run]
 *
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env.
 *
 * Service-role client bypasses RLS, so the ingest runs without an
 * auth'd admin session. created_by stays null on ingest-written rows
 * (migration 0130 relaxed the NOT NULL).
 */

import { createClient } from "@supabase/supabase-js";
import { createReadStream } from "node:fs";
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

const normalizer = SOURCE === "usda" ? normalizeUsda : normalizeOff;

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
  return { patch, prov };
}

// ── Main loop ──────────────────────────────────────────────────────
async function main() {
  console.log(`[ingest] source=${SOURCE} input=${INPUT} batch=${BATCH}${DRY_RUN ? " DRY-RUN" : ""}`);
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
        .select("id, barcode_upc, canonical_id, brand, name, package_size_amount, package_size_unit, image_url, category_hints, source_provenance")
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

  for await (const line of rl) {
    if (read >= LIMIT) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try { rec = JSON.parse(trimmed); } catch { parseErr += 1; continue; }
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
