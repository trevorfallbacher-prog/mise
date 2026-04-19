import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "./supabase";

// Observation-learned package-size chip source, replacing the
// admin-curated `ingredient_info.packaging.sizes` path. Queries
// the `popular_package_sizes` RPC (migration 0063) which aggregates
// `pantry_items.max + unit + brand` across every household's rows —
// the most common declared sizes bubble to the top, no admin
// queue in the loop.
//
// Fetch strategy: two parallel RPC calls per (brand, canonical) key:
//
//   1. brand-specific — "Kerrygold Butter" → 8oz × 4x, 1lb × 1x
//   2. canonical-wide — "butter" across every brand → 8oz, 1lb, 2lb, ...
//
// Brand-specific wins when present; canonical-wide fills out the
// remaining slots (up to `limit` total chips). Brand-specific
// results are marked with `brand` so the UI can render a small tag
// ("8oz · Kerrygold") when the suggestion came from brand history.
//
// Empty first user experience: a canonical with zero pantry_items
// rows yet returns an empty list — the user types their size and
// future users benefit. No bundled seed to fall back to (by design
// — this is the "annihilate the admin curation" rewrite). First
// typing cost is one input; subsequent users get chips for free.

const CACHE_TTL_MS = 60_000; // one-minute in-memory cache
const cache = new Map();     // key: `${brand}|${canonical}|${limit}` → { ts, data }

function cacheKey(brand, canonical, limit) {
  return `${brand || ""}|${canonical || ""}|${limit}`;
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

  useEffect(() => {
    const key = cacheKey(brand, canonicalId, limit);
    latestKey.current = key;
    if (!canonicalId) { setRows([]); return; }
    setLoading(true);
    let alive = true;
    (async () => {
      // Two-tier fetch in parallel. Brand-specific first; canonical-
      // wide fills what remains. If brand is null, skip the specific
      // tier entirely — the generic fetch already covers it.
      const [specific, generic] = await Promise.all([
        brand ? fetchPopular(brand, canonicalId, limit) : Promise.resolve([]),
        fetchPopular(null, canonicalId, limit),
      ]);
      // A stale request (user switched brand mid-flight) shouldn't
      // clobber the current view — guard on the key we captured at
      // effect start.
      if (!alive || latestKey.current !== key) return;

      // Merge: specific first (keeps brand label), generic after,
      // de-dup on (amount, unit) signature so "16oz Barilla" from
      // tier 1 absorbs "16oz null" from tier 2 into one chip.
      const seen = new Set();
      const out = [];
      for (const r of specific) {
        const sig = `${r.amount}|${r.unit}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(r);
        if (out.length >= limit) break;
      }
      for (const r of generic) {
        if (out.length >= limit) break;
        const sig = `${r.amount}|${r.unit}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(r);
      }
      setRows(out);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [brand, canonicalId, limit]);

  return useMemo(() => ({ rows, loading }), [rows, loading]);
}
