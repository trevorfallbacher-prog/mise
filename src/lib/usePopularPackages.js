import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "./supabase";
import { useIngredientInfo } from "./useIngredientInfo";

// Observation-learned package-size chip source with AI-generated
// fallback, replacing the old admin-curated
// `ingredient_info.packaging.sizes` path.
//
// Three tiers of chips, stacked in priority order:
//
//   Tier 1 — brand + canonical observations. `popular_package_sizes`
//     RPC (migration 0063) aggregates `pantry_items.max + unit + brand`
//     across every household. "Kerrygold Butter" → 8oz × 4x, 1lb × 1x.
//
//   Tier 2 — canonical-wide observations. Same RPC with brand=null.
//     "butter" across every brand → 8oz, 1lb, 2lb, ...
//
//   Tier 3 — AI-generated typical sizes from `ingredient_info.info
//     .package.typicalSizes`. Claude's enrichment prompt always asks
//     for this array (supabase/functions/enrich-ingredient:131), so
//     every enriched canonical carries suggestions like
//     ["16 oz", "1 lb bag", "1 gallon jug"]. Parsed client-side into
//     {amount, unit} chip objects. Covers the cold-start case: the
//     moment a canonical is enriched (auto-fires on creation),
//     users get plausible sizes without waiting for household
//     observations to accumulate.
//
// Brand-specific results are marked with `brand`; AI-generated chips
// carry `source: "ai"` so the UI can differentiate if needed.
// Deduplicated across tiers on (amount, unit), so an 8oz from
// observations absorbs the AI's 8oz suggestion into a single chip.

const CACHE_TTL_MS = 60_000; // one-minute in-memory cache
const cache = new Map();     // key: `${brand}|${canonical}|${limit}` → { ts, data }

function cacheKey(brand, canonical, limit) {
  return `${brand || ""}|${canonical || ""}|${limit}`;
}

// Container tokens Claude sometimes appends to typical-size strings
// ("1 lb bag", "1 gallon jug"). The leading number+unit is the real
// measurement; the trailing container word is just the package shape
// — orthogonal to pantry_items.max. Stripped during parse because
// "bag" as a unit is tautological (the row IS the bag).
const CONTAINER_TOKENS = new Set([
  "bag", "bottle", "jar", "can", "jug", "box", "carton", "tub",
  "package", "pack", "packet", "pouch", "tin", "crate", "bin",
  "sleeve", "shaker", "container", "bucket",
]);

// Map Claude's natural-language unit words to our registry's
// canonical unit ids. Partial coverage — anything not in this map
// passes through verbatim (so "tbsp" stays "tbsp", which matches
// the registry).
const UNIT_NORMALIZE = {
  ounce: "oz",    ounces: "oz",
  pound: "lb",    pounds: "lb",  lbs: "lb",
  gram: "g",      grams: "g",
  kilogram: "kg", kilograms: "kg",
  gallons: "gallon",
  quarts: "quart",
  pints: "pint",
  cups: "cup",
  liters: "l",    liter: "l",    litres: "l",
  milliliters: "ml", ml: "ml",
};

// Parse one Claude typical-size string into {amount, unit}. Handles:
//   "16 oz"          → {amount: 16,  unit: "oz"}
//   "1 lb bag"       → {amount: 1,   unit: "lb"}       (drop "bag")
//   "1 gallon jug"   → {amount: 1,   unit: "gallon"}   (drop "jug")
//   "8 fl oz"        → {amount: 8,   unit: "fl_oz"}    (two-word unit)
//   "1 half gallon"  → {amount: 1,   unit: "half_gallon"}
//   "2.5 lb"         → {amount: 2.5, unit: "lb"}
// Returns null for anything that doesn't start with a number.
function parseTypicalSize(str) {
  if (typeof str !== "string") return null;
  const m = str.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const tokens = m[2].split(/\s+/).filter(t => !CONTAINER_TOKENS.has(t));
  if (tokens.length === 0) return null;
  let unit;
  if (tokens.length >= 2 && (tokens[0] === "fl" || tokens[0] === "fluid") && tokens[1].startsWith("oz")) {
    unit = "fl_oz";
  } else if (tokens.length >= 2 && tokens[0] === "half" && tokens[1] === "gallon") {
    unit = "half_gallon";
  } else {
    const raw = tokens[0];
    unit = UNIT_NORMALIZE[raw] || raw;
  }
  return { amount, unit };
}

async function fetchPopular(brand, canonical, limit) {
  if (!canonical) return [];
  const key = cacheKey(brand, canonical, limit);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;

  const { data, error } = await supabase.rpc("popular_package_sizes", {
    p_brand: brand || null,
    p_canonical: canonical,
    p_limit: limit,
  });
  if (error) {
    // Function missing (migration 0063 not applied) or RLS misconfigure.
    // Non-fatal — the UI falls back to "no chips, user types their size"
    // which is still the happy path for the first user of any canonical.
    console.warn("[popular_package_sizes] rpc failed:", error.message);
    return [];
  }
  const rows = (data || []).map(r => ({
    amount: Number(r.amount),
    unit: r.unit,
    brand: r.brand || null,
    n: Number(r.n || 0),
  }));
  cache.set(key, { ts: Date.now(), data: rows });
  return rows;
}

// Async imperative variant of the hook for non-React callers — the
// Scanner's barcode onDetected needs to auto-apply a learned package
// size BEFORE building the scan row, so the normal hook (runs during
// render) is too late. Same fetch/cache path; returns the raw rows
// so the caller can pick the top non-count entry.
export async function fetchPopularPackages(brand, canonicalId, limit = 5) {
  if (!canonicalId) return [];
  const [specific, generic] = await Promise.all([
    brand ? fetchPopular(brand, canonicalId, limit) : Promise.resolve([]),
    fetchPopular(null, canonicalId, limit),
  ]);
  const seen = new Set();
  const out = [];
  const push = (entry) => {
    if (out.length >= limit) return;
    const sig = `${entry.amount}|${entry.unit}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(entry);
  };
  specific.forEach(push);
  generic.forEach(push);
  return out;
}

/**
 * Returns an array of up to `limit` popular package sizes for the
 * (brand, canonical) pair. Each entry:
 *
 *   { amount, unit, brand, n }
 *
 *   amount — the package size (becomes pantry_items.max)
 *   unit   — the canonical unit
 *   brand  — the brand the observations came from (null for
 *            canonical-wide fallback hits)
 *   n      — observation count, for sorting / optional display
 *
 * Brand-specific results appear first; canonical-wide fills the
 * remainder. De-duplicated across the two tiers so a 16oz Barilla
 * hit doesn't also surface as a 16oz canonical-wide hit.
 *
 * Accepts null brand (returns canonical-wide only) and null canonical
 * (returns empty — we don't recommend without a canonical anchor).
 */
export function usePopularPackages(brand, canonicalId, limit = 5) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const latestKey = useRef("");
  // Pull ingredient_info from context so Tier 3 (AI-generated typical
  // sizes) has data without a second round-trip. The IngredientInfo
  // provider is already mounted at the app root, so getInfo() is
  // cached and synchronous.
  const { getInfo } = useIngredientInfo();

  useEffect(() => {
    const key = cacheKey(brand, canonicalId, limit);
    latestKey.current = key;
    if (!canonicalId) { setRows([]); return; }
    setLoading(true);
    let alive = true;
    (async () => {
      // Tiers 1 + 2 fetched in parallel. Brand-specific first;
      // canonical-wide fills what remains. If brand is null, skip
      // the specific tier — the generic fetch already covers it.
      const [specific, generic] = await Promise.all([
        brand ? fetchPopular(brand, canonicalId, limit) : Promise.resolve([]),
        fetchPopular(null, canonicalId, limit),
      ]);
      // A stale request (user switched brand mid-flight) shouldn't
      // clobber the current view — guard on the key we captured at
      // effect start.
      if (!alive || latestKey.current !== key) return;

      // Merge all three tiers. De-dup across them on (amount, unit)
      // so "16oz Barilla" from tier 1 absorbs "16oz null" from tier 2
      // or "16 oz" from tier 3 into one chip.
      const seen = new Set();
      const out = [];
      const push = (entry) => {
        if (out.length >= limit) return;
        const sig = `${entry.amount}|${entry.unit}`;
        if (seen.has(sig)) return;
        seen.add(sig);
        out.push(entry);
      };
      for (const r of specific) push(r);
      for (const r of generic)  push(r);

      // Tier 3 — AI-generated typicalSizes from the ingredient_info
      // enrichment. Parsed client-side, marked source:"ai" so the UI
      // can style them differently if desired. Only fills remaining
      // slots after observation tiers.
      if (out.length < limit) {
        const info = getInfo(canonicalId);
        const typical = Array.isArray(info?.package?.typicalSizes)
          ? info.package.typicalSizes
          : [];
        for (const str of typical) {
          const parsed = parseTypicalSize(str);
          if (!parsed) continue;
          push({
            amount: parsed.amount,
            unit: parsed.unit,
            brand: null,
            n: 0,
            source: "ai",
          });
          if (out.length >= limit) break;
        }
      }

      setRows(out);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [brand, canonicalId, limit, getInfo]);

  return useMemo(() => ({ rows, loading }), [rows, loading]);
}
