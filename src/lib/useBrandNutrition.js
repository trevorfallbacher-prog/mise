// Brand-specific nutrition lookup. Reads public.brand_nutrition
// (migration 0065) and exposes a Map keyed by `${canonical_id}::${brand}`
// so the resolver in src/lib/nutrition.js can hit it in O(1).
//
// Brand is lowercased in both the table row and the key so "Kerrygold"
// / "KERRYGOLD" / "kerrygold" collapse to one entry. display_brand
// preserves the original casing for UI.
//
// Single Provider at App level mirrors useIngredientInfo: one fetch,
// every consumer reads from context. No local cache — brand_nutrition
// is small enough (one row per popular brand per canonical) that a
// fresh SELECT on mount is cheap, and a stale cache across Phase 3's
// barcode-scan flow would delay "the barcode I just scanned shows
// nutrition" by a full reload.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";
import { validateNutrition } from "./nutrition";

// Shape returned by the context — matches what src/lib/nutrition.js
// expects via its `brandNutrition` parameter (a Map with .get()).
// Callers that just want raw brand data can read `rows` directly.
const BrandNutritionContext = createContext({
  get: () => null,
  rows: [],
  loading: true,
  refresh: async () => {},
  upsert: async () => null,
});

function fromDb(row) {
  return {
    canonicalId:   row.canonical_id,
    brand:         row.brand,          // normalized lowercase
    displayBrand:  row.display_brand,  // original casing for UI
    nutrition:     row.nutrition || {},
    barcode:       row.barcode || null,
    source:        row.source,
    sourceId:      row.source_id || null,
    confidence:    row.confidence ?? 80,
    createdBy:     row.created_by || null,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

function keyFor(canonicalId, brand) {
  if (!canonicalId || !brand) return null;
  return `${canonicalId}::${String(brand).trim().toLowerCase()}`;
}

export function BrandNutritionProvider({ children }) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from("brand_nutrition")
      .select("*");
    if (error) {
      // Table may not exist yet (migration not run) — non-fatal,
      // resolver falls back to canonical nutrition.
      console.warn("[brand_nutrition] fetch failed:", error.message);
      return;
    }
    setRows((data || []).map(fromDb));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await fetchAll();
      if (!alive) return;
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [fetchAll]);

  // Realtime — any contribution (Phase 3 barcode scan, Phase 4
  // manual entry) reaches every open tab without a refresh. One
  // shared channel per app load; userId-scoped isn't needed since
  // the data is public-read.
  const setRowsRef = useRef(setRows);
  useEffect(() => { setRowsRef.current = setRows; }, []);
  useEffect(() => {
    const ch = safeChannel("rt:brand_nutrition")
      .on("postgres_changes", { event: "*", schema: "public", table: "brand_nutrition" }, (payload) => {
        const apply = setRowsRef.current;
        if (payload.eventType === "INSERT") {
          const row = fromDb(payload.new);
          apply(prev => {
            const k = keyFor(row.canonicalId, row.brand);
            return prev.some(r => keyFor(r.canonicalId, r.brand) === k) ? prev : [...prev, row];
          });
        } else if (payload.eventType === "UPDATE") {
          const row = fromDb(payload.new);
          apply(prev => prev.map(r => (
            r.canonicalId === row.canonicalId && r.brand === row.brand ? row : r
          )));
        } else if (payload.eventType === "DELETE") {
          const o = payload.old;
          if (!o) return;
          apply(prev => prev.filter(r => !(r.canonicalId === o.canonical_id && r.brand === o.brand)));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Build the Map once per rows-change. Memoized so resolver callers
  // don't rebuild it every render.
  const map = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFor(r.canonicalId, r.brand);
      if (k) m.set(k, r);
    }
    return m;
  }, [rows]);

  // Shape the Map exposes via `.get` to match what nutrition.js
  // expects: Map<"canonical::brand", { nutrition, displayBrand, ... }>.
  // Adding a convenience second-arg signature (canonicalId, brand)
  // so call sites can pass the parts directly instead of stringing
  // them themselves.
  const get = useCallback((canonicalIdOrKey, maybeBrand) => {
    if (typeof maybeBrand === "string") {
      const k = keyFor(canonicalIdOrKey, maybeBrand);
      return k ? map.get(k) || null : null;
    }
    return map.get(canonicalIdOrKey) || null;
  }, [map]);

  // Phase 3 / 4 write path. Upserts a brand_nutrition row and lets
  // the realtime subscription update the local state. Returns the
  // inserted row on success or null on failure. Brand is normalized
  // lowercase at the boundary so composite-key collisions are
  // predictable regardless of casing in the input.
  const upsert = useCallback(async ({
    canonicalId, brand, nutrition,
    barcode = null, source = "user", sourceId = null, confidence = 80,
  }) => {
    if (!canonicalId || !brand || !nutrition) {
      throw new Error("brand_nutrition upsert needs canonicalId + brand + nutrition");
    }
    // Reject malformed / lazy nutrition blobs at the write boundary so
    // garbage can't reach brand_nutrition and silently inflate dashboard
    // totals. Legitimate sources (OFF via lookup-barcode, the pantry
    // override sheet, the admin editor) all produce enum-shaped blocks
    // — anything that fails validateNutrition is a bug at the caller,
    // not in resolver math.
    const check = validateNutrition(nutrition);
    if (!check.ok) {
      console.warn(`[brand_nutrition] refusing malformed nutrition for ${canonicalId}/${brand}: ${check.reason}`);
      return null;
    }
    const normalizedBrand = String(brand).trim().toLowerCase();
    const displayBrand    = String(brand).trim();
    // Stamp created_by with the current user's id so the self-update
    // RLS policy (auth.uid() = created_by) permits future rescans of
    // the same (canonical, brand) pair to refresh the row. Without
    // this, created_by defaults to null and every subsequent upsert
    // hits the UPDATE path and fails with 42501.
    const { data: { user } = {} } = await supabase.auth.getUser();
    const row = {
      canonical_id:  canonicalId,
      brand:         normalizedBrand,
      display_brand: displayBrand,
      nutrition,
      barcode,
      source,
      source_id:     sourceId,
      confidence,
      ...(user?.id ? { created_by: user.id } : {}),
    };
    const { data, error } = await supabase
      .from("brand_nutrition")
      .upsert(row, { onConflict: "canonical_id,brand" })
      .select()
      .single();
    if (error) {
      // 42501 = RLS insufficient_privilege. Most common cause: a
      // pre-existing row with created_by=null (from before this fix)
      // or created by a different user — self-update policy can't
      // reach it. Warn instead of error so the console stays clean
      // for the common "stale row" case; the brand still lands on
      // pantry_items.brand via a different code path.
      const level = error?.code === "42501" ? "warn" : "error";
      console[level]("[brand_nutrition] upsert failed:", error);
      return null;
    }
    return fromDb(data);
  }, []);

  const value = useMemo(() => ({
    get,
    rows,
    loading,
    refresh: fetchAll,
    upsert,
  }), [get, rows, loading, fetchAll, upsert]);

  return (
    <BrandNutritionContext.Provider value={value}>
      {children}
    </BrandNutritionContext.Provider>
  );
}

// Reads from the App-level Provider. Shape:
//   { get(canonicalId, brand?) | get(`${canonicalId}::${brand}`),
//     rows, loading, refresh, upsert }
export function useBrandNutrition() {
  return useContext(BrandNutritionContext);
}
