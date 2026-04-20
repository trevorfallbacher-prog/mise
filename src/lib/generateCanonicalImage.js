import { supabase } from "./supabase";

// Thin client wrapper over the `generate-canonical-image` edge
// function. Admins trigger this from GenerateImageButton; the edge
// function calls Recraft, uploads to the canonical-images bucket,
// and stamps ingredient_info.info.imageUrl. Returns the new URL so
// the caller can render it immediately without waiting for realtime.
//
// Errors are normalized to Error instances with user-readable
// messages. The edge function returns structured { error, detail? }
// shapes; we unwrap those here so components don't juggle both.
export async function generateCanonicalImage({ canonicalId, canonicalName, hint } = {}) {
  if (!canonicalId) throw new Error("canonicalId is required");
  if (!canonicalName) throw new Error("canonicalName is required");

  const { data, error } = await supabase.functions.invoke("generate-canonical-image", {
    body: { canonicalId, canonicalName, hint: hint || undefined },
  });

  if (error) {
    // supabase-js wraps the upstream Response in error.context; peel
    // it so a 403 (non-admin) surfaces as "admin-only" rather than a
    // cryptic network error.
    let detail = "";
    let status = null;
    const ctx = error.context;
    if (ctx) {
      status = ctx.status ?? null;
      if (typeof ctx.text === "function") {
        try { detail = await ctx.text(); } catch { /* noop */ }
      }
    }
    console.error("[generate-canonical-image] edge fn failed:", { message: error.message, status, detail });
    if (status === 403) {
      throw new Error("Canonical image generation is admin-only.");
    }
    if (status === 404) {
      throw new Error("Image generator edge function isn't deployed. Run: supabase functions deploy generate-canonical-image");
    }
    if (status === 500 && detail && /RECRAFT_API_KEY/.test(detail)) {
      throw new Error("Server missing RECRAFT_API_KEY. Set it with: supabase secrets set RECRAFT_API_KEY=<your-key>");
    }
    throw new Error(error.message || "Image generation failed. Try again?");
  }

  if (!data?.imageUrl) {
    throw new Error("Edge function returned no imageUrl.");
  }
  return { imageUrl: data.imageUrl, canonicalId: data.canonicalId };
}
