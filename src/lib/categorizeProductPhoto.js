// Client wrapper over the `categorize-product-photo` edge function.
//
// Fires when a UPC scan misses every resolution tier and the user
// uploads a front-of-package photo as their fallback identity source.
// Server-side calls Claude Haiku 4.5 vision and returns the structured
// axes the resolver couldn't fill in.
//
// Returns ONE shape regardless of source so the caller doesn't fork:
//
//   {
//     found,
//     brand, productName,
//     canonicalId,        // picked from the registry list (null if nothing fit)
//     newCanonicalName,   // ONLY when canonicalId is null — proposed new stem
//     bindConfidence,     // "exact" | "stripped" | "guessed"
//     category, state, claims, packageSize,
//     confidence,         // photo-read confidence (separate from bindConfidence)
//     reason?             // when found=false
//   }
//
// The edge fn validates Haiku's canonicalId against the bundled
// registry and runs a flavor-prefix stripper safety net on
// newCanonicalName, so callers always receive either a list id or
// a clean stem-only proposal — never a phantom id, never raw AI text.
//
// `image` is a base64 string WITHOUT the data: prefix. `mediaType`
// is one of image/jpeg | image/png | image/webp. Match the shape of
// decodeBarcodeFromImage exactly so the camera-capture surface can
// fan out to either fn.

import { supabase } from "./supabase";

export async function categorizeProductPhoto({
  image,
  mediaType        = "image/jpeg",
  barcodeUpc       = null,
  offCategoryHints = null,
}) {
  if (!image) {
    return { found: false, reason: "no_image" };
  }
  const body = { image, mediaType };
  if (barcodeUpc) body.barcodeUpc = String(barcodeUpc);
  if (Array.isArray(offCategoryHints) && offCategoryHints.length > 0) {
    body.offCategoryHints = offCategoryHints;
  }

  const { data, error } = await supabase.functions.invoke(
    "categorize-product-photo",
    { body },
  );

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
    console.error("[categorize-product-photo] edge fn failed:", {
      message: error.message, status, detail,
    });
    const reason = status === 404 ? "edge_fn_not_deployed" : "categorize_failed";
    return { found: false, reason, status, detail: detail || error.message };
  }
  return data || { found: false, reason: "empty_response" };
}
