// Client wrapper over the `lookup-barcode` edge function.
//
// Checks the local brand_nutrition cache first (useBrandNutrition's
// rows) so a barcode we've already seen resolves without a round
// trip. On a cache miss, invokes the edge function which queries
// Open Food Facts and returns mapped nutrition data.
//
// Returns a single shape regardless of source so the caller doesn't
// have to fork on cache-vs-network:
//
//   { found, barcode, brand, productName, categoryHints, nutrition,
//     source, sourceId, offUrl, cached }
//
// `cached: true` means we resolved from the realtime cache; the
// caller can skip the upsert step (the row already exists).

import { supabase } from "./supabase";

export async function lookupBarcode(barcode, { brandNutritionRows = [] } = {}) {
  const normalized = String(barcode || "").trim();
  if (!/^\d{8,14}$/.test(normalized)) {
    return { found: false, barcode: normalized, reason: "invalid_barcode" };
  }

  // 1. Cache check — brand_nutrition has a barcode column (indexed
  //    where not null) that Phase 3 populates on every OFF hit. If
  //    the user's household, or any other user, has already scanned
  //    this UPC, we short-circuit. This makes the second-and-beyond
  //    scan of the same product instant.
  const cached = (brandNutritionRows || []).find(r => r.barcode === normalized);
  if (cached) {
    return {
      found:         true,
      barcode:       normalized,
      brand:         cached.displayBrand || null,
      productName:   null,                    // not carried on brand_nutrition — OFF-only field
      categoryHints: [],
      nutrition:     cached.nutrition || {},
      source:        cached.source || "cache",
      sourceId:      cached.sourceId || normalized,
      offUrl:        `https://world.openfoodfacts.org/product/${normalized}`,
      cached:        true,
      canonicalId:   cached.canonicalId || null,
    };
  }

  // 2. Network fallback — hit the edge function.
  const { data, error } = await supabase.functions.invoke("lookup-barcode", {
    body: { barcode: normalized },
  });
  if (error) {
    // supabase-js wraps the upstream Response in error.context.
    // Extract the detail for a readable error surface.
    let detail = "";
    const ctx = error.context;
    if (ctx && typeof ctx.text === "function") {
      try { detail = await ctx.text(); } catch { /* noop */ }
    }
    console.error("[lookup-barcode] edge fn failed:", error.message, detail);
    return { found: false, barcode: normalized, reason: "fetch_failed" };
  }
  return { ...data, cached: false };
}
