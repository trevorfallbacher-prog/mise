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

// Photo-capture fallback for devices that can't do live BarcodeDetector
// (iOS PWA standalones, Firefox mobile, older browsers). Sends a photo
// to the decode-barcode-image edge function, which uses Claude vision
// to read the human-readable digits printed below every UPC/EAN
// barcode. Returns { found: true, barcode } or { found: false, reason }.
//
// `image` is a base64 string WITHOUT the data: prefix. `mediaType`
// is one of image/jpeg | image/png | image/webp.
export async function decodeBarcodeFromImage(image, mediaType = "image/jpeg") {
  if (!image) return { found: false, reason: "no_image" };
  const { data, error } = await supabase.functions.invoke("decode-barcode-image", {
    body: { image, mediaType },
  });
  if (error) {
    let detail = "";
    let status = null;
    const ctx = error.context;
    if (ctx) {
      status = ctx.status ?? null;
      if (typeof ctx.text === "function") {
        try { detail = await ctx.text(); } catch { /* noop */ }
      }
    }
    console.error("[decode-barcode-image] edge fn failed:", { message: error.message, status, detail });
    const reason = status === 404 ? "edge_fn_not_deployed" : "decode_failed";
    return { found: false, reason, status, detail: detail || error.message };
  }
  return data || { found: false, reason: "empty_response" };
}

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
    // Extract the detail for a readable error surface + pass through
    // so the caller can distinguish "edge fn not deployed" (404) from
    // "edge fn threw" (500) from "network broken" (no status).
    let detail = "";
    let status = null;
    const ctx = error.context;
    if (ctx) {
      status = ctx.status ?? null;
      if (typeof ctx.text === "function") {
        try { detail = await ctx.text(); } catch { /* noop */ }
      }
    }
    console.error("[lookup-barcode] edge fn failed:", { message: error.message, status, detail });
    // 404 from supabase usually means the function is not deployed;
    // flag that distinctly so the UI can tell the user what to do.
    const reason = status === 404 ? "edge_fn_not_deployed" : "fetch_failed";
    return { found: false, barcode: normalized, reason, status, detail: detail || error.message };
  }
  return { ...data, cached: false };
}
