import { supabase } from "./supabase";

// Lock / unlock a canonical's generated image. Direct ingredient_info
// upsert — migration 0047 tightened the write policy to admin-only,
// so RLS enforces the admin check server-side and any non-admin
// attempt fails there.
//
// Lock: stamps info.imageLocked + imageLockedBy + imageLockedAt,
// preserving the existing info blob.
// Unlock: drops the three fields.
export async function setCanonicalImageLock({ canonicalId, locked, userId }) {
  if (!canonicalId) throw new Error("canonicalId is required");
  if (locked && !userId) throw new Error("userId is required to lock");

  // Pull the existing info so we can merge rather than clobber. The
  // row should always exist by the time Lock is available (an image
  // has been generated), but be defensive.
  const { data: existing, error: selErr } = await supabase
    .from("ingredient_info")
    .select("info")
    .eq("ingredient_id", canonicalId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message || "Failed to load current image lock state");

  const base = existing?.info || {};
  const mergedInfo = { ...base };
  if (locked) {
    mergedInfo.imageLocked = true;
    mergedInfo.imageLockedBy = userId;
    mergedInfo.imageLockedAt = new Date().toISOString();
  } else {
    delete mergedInfo.imageLocked;
    delete mergedInfo.imageLockedBy;
    delete mergedInfo.imageLockedAt;
  }

  const { error: upErr } = await supabase
    .from("ingredient_info")
    .upsert({ ingredient_id: canonicalId, info: mergedInfo });
  if (upErr) {
    // RLS denial surfaces here for non-admins.
    if (upErr.code === "42501" || /row-level security|permission denied/i.test(upErr.message || "")) {
      throw new Error("Locking canonical images is admin-only.");
    }
    throw new Error(upErr.message || "Couldn't update lock state. Try again?");
  }
  return { locked: !!locked };
}

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
    // cryptic network error. Parse the detail blob as JSON when we
    // can so the Recraft/upstream failure reason flows into the
    // thrown Error message — that way a user-visible toast says
    // "Recraft returned 400: invalid model" instead of "Image
    // generation failed."
    let detail = "";
    let status = null;
    const ctx = error.context;
    if (ctx) {
      status = ctx.status ?? null;
      if (typeof ctx.text === "function") {
        try { detail = await ctx.text(); } catch { /* noop */ }
      }
    }
    let parsed = null;
    if (detail) {
      try { parsed = JSON.parse(detail); } catch { /* noop */ }
    }
    console.error("[generate-canonical-image] edge fn failed:", {
      message: error.message, status, detail, parsed,
    });
    if (status === 403) {
      throw new Error("Canonical image generation is admin-only.");
    }
    if (status === 409) {
      throw new Error("This image is locked as final. Unlock before regenerating.");
    }
    if (status === 404) {
      throw new Error("Image generator edge function isn't deployed. Run: supabase functions deploy generate-canonical-image");
    }
    if (status === 500 && detail && /RECRAFT_API_KEY/.test(detail)) {
      throw new Error("Server missing RECRAFT_API_KEY. Set it with: supabase secrets set RECRAFT_API_KEY=<your-key>");
    }
    // Fall through — surface the edge fn's detail (or the parsed
    // { error, detail } shape) so the real upstream reason reaches
    // the toast instead of a generic failure message.
    if (parsed?.detail) {
      throw new Error(String(parsed.detail));
    }
    if (parsed?.error) {
      throw new Error(String(parsed.error));
    }
    if (detail) {
      throw new Error(detail.slice(0, 300));
    }
    throw new Error(error.message || "Image generation failed. Try again?");
  }

  if (!data?.imageUrl) {
    throw new Error("Edge function returned no imageUrl.");
  }
  return { imageUrl: data.imageUrl, canonicalId: data.canonicalId };
}
