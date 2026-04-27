#!/usr/bin/env node
/**
 * scripts/derive_brand_expertise.js
 *
 * One-shot generator that aggregates USDA Branded Foods (or our
 * already-ingested barcode_identity_corrections rows) into a
 * brand-expertise histogram, then writes the result as a runtime-
 * loadable JS module (src/data/brandExpertiseDerived.js).
 *
 * The runtime brand picker (src/lib/pickPrimaryBrand.js) merges this
 * derived map with the curated seed in src/data/brandExpertise.js —
 * curated counts add to derived counts so hand-tuned tweaks always
 * win, but coverage extends to every brand the USDA dataset has
 * meaningful representation for.
 *
 * ── Two input modes ─────────────────────────────────────────────────
 *
 *   1. --input=<path-to-USDA-branded_food.csv>
 *      Reads the raw FDC CSV directly. No DB needed, no auth needed.
 *      Recommended for first-run or whenever USDA publishes a new
 *      Branded Foods export. Fields used:
 *        brand_name, brand_owner, branded_food_category, gtin_upc
 *
 *   2. --source=corrections
 *      Pulls aggregated counts from barcode_identity_corrections via
 *      the service-role Supabase client. Useful when you want the
 *      live picture (ingested USDA + ingested OFF + admin
 *      promotions). Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *      env. Output is the same shape.
 *
 * ── CLI ─────────────────────────────────────────────────────────────
 *   node scripts/derive_brand_expertise.js \
 *     --input=./branded_food.csv \
 *     [--out=./src/data/brandExpertiseDerived.js] \
 *     [--min-count=3] \
 *     [--limit=Infinity] \
 *     [--dry-run]
 *
 *   node scripts/derive_brand_expertise.js \
 *     --source=corrections \
 *     [--out=...] [--min-count=3] [--dry-run]
 *
 * ── Output shape ────────────────────────────────────────────────────
 *
 *   export const BRAND_EXPERTISE_FROM_USDA = {
 *     boars_head: {
 *       canonicals: {},                     // USDA doesn't carry canonical_id
 *       hubs:       {},                     // not derivable from USDA category alone
 *       categories: { meat: 38, dairy: 12 },
 *       subtypes:   ["deli", "cheese"],     // top-3 most-counted
 *       subtypeCounts: { deli: 38, cheese: 12 },
 *       totalObs:   50,
 *       source:     "usda",
 *     },
 *     ...
 *   };
 */

import { createReadStream, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { axesForUsdaCategory } from "../src/data/usdaCategoryMap.js";

// ── CLI parsing ─────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const INPUT     = args.input;
const SOURCE    = args.source || "csv";
const OUT       = args.out || "./src/data/brandExpertiseDerived.js";
const MIN_COUNT = Number(args["min-count"]) || 3;
const LIMIT     = args.limit ? Number(args.limit) : Infinity;
const DRY_RUN   = Boolean(args["dry-run"]);

if (SOURCE === "csv" && !INPUT) {
  console.error("Missing --input=<path-to-USDA-branded_food.csv> (or pass --source=corrections)");
  process.exit(1);
}
// Accept either canonical SUPABASE_URL or the React app's
// REACT_APP_SUPABASE_URL (which the user's .env already holds) so
// the script picks up an existing config without duplication. The
// service-role key MUST come in as SUPABASE_SERVICE_ROLE_KEY — it
// intentionally isn't in the React .env since it bypasses RLS.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (SOURCE === "corrections" && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error("--source=corrections needs (SUPABASE_URL or REACT_APP_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(1);
}

// ── Brand normalization ─────────────────────────────────────────────
// Mirror the slugify rule used by src/data/brandExpertise.js so
// derived rows hash to the same key the curated seed uses. Strip
// diacritics, apostrophes, ampersands, then collapse non-alpha to
// underscore. "Boar's Head Brand, LLC" → "boars_head_brand_llc"; we
// also strip common corporate suffixes to land on the consumer-
// facing brand "boars_head".
const CORPORATE_SUFFIXES = /\s*(,?\s*(brand|brands|inc|inc\.|llc|llc\.|corp|corp\.|company|co|co\.|ltd|ltd\.|incorporated|corporation|the\s+))/gi;
function brandSlugify(display) {
  return String(display || "")
    .replace(CORPORATE_SUFFIXES, " ")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[‘’'`&]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ── Aggregation core ────────────────────────────────────────────────
// histogram: brand_slug → {
//   displayName: <preserved capitalization>,
//   subtypeCounts: { subtype: count },
//   categoryCounts: { category: count },
//   totalObs: count,
// }
const histogram = new Map();

function bumpRow(brandRaw, usdaCategory) {
  if (!brandRaw || !usdaCategory) return;
  const slug = brandSlugify(brandRaw);
  if (!slug) return;
  const axes = axesForUsdaCategory(usdaCategory);
  if (!axes) return;     // category outside our grocery scope — skip
  let row = histogram.get(slug);
  if (!row) {
    row = {
      displayName:    String(brandRaw).trim(),
      subtypeCounts:  {},
      categoryCounts: {},
      totalObs:       0,
    };
    histogram.set(slug, row);
  }
  // Preserve the capitalization of the longest brand string seen for
  // this slug (Title-Case usually wins). USDA inputs vary — "BOAR'S
  // HEAD" vs "Boar's Head Brand, LLC" vs "Boar's Head" — we want a
  // human-readable display that matches the curated seed.
  const candidate = String(brandRaw).trim();
  if (
    candidate.length > 0 && (
      // prefer mixed-case over ALL CAPS
      (/[a-z]/.test(candidate) && !/[a-z]/.test(row.displayName))
      // prefer shorter, cleaner names (drop the "Brand, LLC" tail)
      || (candidate.length < row.displayName.length && /[a-z]/.test(candidate))
    )
  ) {
    row.displayName = candidate.replace(CORPORATE_SUFFIXES, "").trim();
  }
  if (axes.subtype) {
    row.subtypeCounts[axes.subtype]   = (row.subtypeCounts[axes.subtype]   || 0) + 1;
  }
  if (axes.category) {
    row.categoryCounts[axes.category] = (row.categoryCounts[axes.category] || 0) + 1;
  }
  row.totalObs += 1;
}

// ── Mode A: USDA CSV reader ─────────────────────────────────────────
async function ingestCsv(inputPath) {
  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`); process.exit(1);
  }
  const stream = createReadStream(inputPath, "utf8");
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let rows = 0;
  for await (const line of rl) {
    if (rows >= LIMIT) break;
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (!header) { header = fields.map(s => s.trim()); continue; }
    const rec = Object.fromEntries(header.map((h, i) => [h, fields[i] ?? ""]));
    const brand = rec.brand_name || rec.brand_owner;
    const cat   = rec.branded_food_category;
    bumpRow(brand, cat);
    rows += 1;
    if (rows % 50000 === 0) console.log(`  ${rows.toLocaleString()} rows scanned…`);
  }
  console.log(`CSV scan complete: ${rows.toLocaleString()} rows, ${histogram.size.toLocaleString()} unique brands.`);
}

// Minimal CSV-line parser that handles quoted fields with embedded
// commas + escaped quotes. USDA's branded_food.csv is well-formed
// (RFC 4180-ish), so we don't need a full RFC 4180 parser — just
// enough to split fields without losing commas inside quotes.
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
      if (c === '"') { inQuote = false; continue; }
      cur += c;
    } else {
      if (c === '"') { inQuote = true; continue; }
      if (c === ",") { out.push(cur); cur = ""; continue; }
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ── Mode B: Supabase corrections aggregator ─────────────────────────
async function ingestCorrections() {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    SUPABASE_URL, SERVICE_KEY,
    { auth: { persistSession: false } },
  );
  // Page through the table — RLS-bypassing service role reads all
  // rows with brand + category_hints. The table is at most a few
  // hundred MB; pulling 500-row pages keeps memory flat.
  const PAGE_SIZE = 500;
  let from = 0;
  let total = 0;
  while (true) {
    if (total >= LIMIT) break;
    const { data, error } = await supabase
      .from("barcode_identity_corrections")
      .select("brand, category_hints")
      .not("brand", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const brand = row.brand;
      // category_hints is a text[] in PG. The first hint is the
      // USDA-derived one (ingest writes it as the only hint); take it.
      const hint = Array.isArray(row.category_hints) && row.category_hints.length > 0
        ? row.category_hints[0]
        : null;
      bumpRow(brand, hint);
      total += 1;
    }
    from += PAGE_SIZE;
    if (total % 10000 === 0) console.log(`  ${total.toLocaleString()} correction rows scanned…`);
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`Corrections scan complete: ${total.toLocaleString()} rows, ${histogram.size.toLocaleString()} unique brands.`);
}

// ── Output shaping ──────────────────────────────────────────────────
function shapeForOutput() {
  const out = {};
  for (const [slug, row] of histogram.entries()) {
    if (row.totalObs < MIN_COUNT) continue;     // skip noise
    // Top subtypes (count ≥ 1, sorted by count desc)
    const subtypes = Object.entries(row.subtypeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
    out[slug] = {
      displayName:    row.displayName,
      canonicals:     {},
      hubs:           {},
      categories:     row.categoryCounts,
      subtypeCounts:  row.subtypeCounts,
      subtypes,
      totalObs:       row.totalObs,
      source:         "usda",
    };
  }
  return out;
}

// ── Main ────────────────────────────────────────────────────────────
const t0 = Date.now();

if (SOURCE === "csv") {
  console.log(`Reading USDA CSV: ${INPUT}`);
  await ingestCsv(INPUT);
} else if (SOURCE === "corrections") {
  console.log(`Pulling from barcode_identity_corrections via Supabase…`);
  await ingestCorrections();
} else {
  console.error(`Unknown --source=${SOURCE}. Use "csv" or "corrections".`);
  process.exit(1);
}

const shaped = shapeForOutput();
const kept = Object.keys(shaped).length;
console.log(`Kept ${kept.toLocaleString()} brands with ≥${MIN_COUNT} observations.`);

if (DRY_RUN) {
  // Print a small preview
  const preview = Object.entries(shaped)
    .sort((a, b) => b[1].totalObs - a[1].totalObs)
    .slice(0, 10);
  console.log("\nTop 10 by observation count:");
  for (const [slug, row] of preview) {
    console.log(`  ${slug.padEnd(28)} obs=${String(row.totalObs).padStart(5)}  subtypes=${row.subtypes.slice(0, 3).join(",")}`);
  }
  console.log("\n--dry-run: skipping write");
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  process.exit(0);
}

// Serialize. Sorted by total obs desc so the file is readable + diffs
// stay sensible across re-runs.
const ordered = Object.fromEntries(
  Object.entries(shaped).sort((a, b) => b[1].totalObs - a[1].totalObs)
);
const fileBody =
  `// AUTO-GENERATED by scripts/derive_brand_expertise.js — do not hand-edit.\n` +
  `// Source: ${SOURCE === "csv" ? `USDA CSV (${path.basename(INPUT)})` : "barcode_identity_corrections"}\n` +
  `// Generated: ${new Date().toISOString()}\n` +
  `// Brands kept: ${kept} (min observations: ${MIN_COUNT})\n` +
  `\n` +
  `// Hand-tuned counts in src/data/brandExpertise.js add ON TOP of\n` +
  `// these derived counts at runtime — see expertiseFor() in that\n` +
  `// file for the merge.\n` +
  `\n` +
  `export const BRAND_EXPERTISE_FROM_USDA = ` +
  JSON.stringify(ordered, null, 2) +
  `;\n`;

writeFileSync(OUT, fileBody);
console.log(`\nWrote ${OUT}  (${(fileBody.length / 1024).toFixed(1)} KB)`);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
