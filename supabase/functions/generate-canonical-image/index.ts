// Supabase Edge Function: generate-canonical-image
//
// Calls Recraft's image API to generate a visual identity for a
// canonical ingredient, uploads the result to the canonical-images
// Storage bucket, and stamps the public URL onto
// ingredient_info.info.imageUrl.
//
// Unlike enrich-ingredient (one-shot, auto-approved), this function
// is re-runnable. Each call overwrites the existing image for the
// canonical — single active slot per canonical, no history. An admin
// dissatisfied with the output just taps ↻ and burns another Recraft
// call.
//
// Request body:
//   {
//     canonicalId:   string,   // the slug we're generating for
//     canonicalName: string,   // human-readable name for the prompt
//     hint?:         string,   // optional style/subject nudge from the
//                              //   admin ("rustic", "on a marble slab", etc.)
//   }
//
// Response:
//   { imageUrl: string, canonicalId: string }
//
// Errors return { error, detail? } with 4xx/5xx status.
//
// Deploy:
//   supabase functions deploy generate-canonical-image
//   supabase secrets set RECRAFT_API_KEY=<your-key>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Recraft's public API. Per the docs the `/v1` path is the API
// version (not the model version), and the specific model is chosen
// via the `model` field in the body. Returns a short-lived URL to
// the rendered image; we fetch the bytes before storing so we don't
// leave the app pointing at something that'll 404 in an hour.
const RECRAFT_ENDPOINT = "https://external.api.recraft.ai/v1/images/generations";

// Model + size. Per Recraft's docs (and confirmed against the
// March 2026 model catalog):
//   • V4 model names are SNAKE_CASE — `recraftv4_pro`, not
//     `recraftv4pro`. Camel-case / merged variants fail validation.
//   • V4 does NOT accept `style` / `style_id` / `substyle` — those
//     are V2/V3 only. The aesthetic is driven entirely by the
//     prompt text for V4 models.
//   • `recraftv4_pro_vector` returns a real SVG (Content-Type
//     image/svg+xml), which plays nicely with our hand-drawn
//     /icons/*.svg set and scales infinitely at any render size.
// If you need to fall back to V3 for style/substyle control, swap
// the model to `recraftv3` or `recraftv3_vector` and re-add the
// `style` + `substyle` fields to the POST body below.
const RECRAFT_MODEL = "recraftv4_pro_vector";
const RECRAFT_SIZE = "1024x1024";

const BUCKET = "canonical-images";

// Pull the `sub` (user id) claim out of a bearer JWT without verifying
// the signature. Supabase's platform already verified the token before
// this function runs; we're reading claims afterwards. Mirrors the
// pattern in enrich-ingredient/index.ts.
function extractUserIdFromJwt(authHeader: string): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m) return null;
  const token = m[1];
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    let payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payloadB64.length % 4 !== 0) payloadB64 += "=";
    const payload = JSON.parse(atob(payloadB64));
    const sub = payload?.sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

function buildPrompt(canonicalName: string, hint?: string): string {
  // House icon style — thick warm-tan outline on pure black. Every
  // canonical gets the same treatment so the set reads like one
  // illustrator's sheet. The hex code is a soft hint (models can
  // lose exact colors); the descriptive language ("warm premium tan")
  // does the heavy lifting. Canonical name appears in the prompt as
  // the SUBJECT only — NOT rendered as a text label on the image.
  const base = `An icon of a single ${canonicalName.trim()}. ` +
    `Thick warm premium tan (#D4B896) outline stroke only, transparent fill, ` +
    `on a pure black background. Single weight stroke throughout, ` +
    `minimal anchor points, clean geometric construction. ` +
    `No gradients, no shadows, no texture, no fills. ` +
    `Bold enough to read at 24 pixels. No padding. ` +
    `Centered subject, no text, no labels, no decorative borders.`;
  if (hint && hint.trim()) {
    return `${base} ${hint.trim()}.`;
  }
  return base;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: JSON_HEADERS,
    });
  }

  let body: { canonicalId?: string; canonicalName?: string; hint?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400, headers: JSON_HEADERS,
    });
  }

  const canonicalId = String(body.canonicalId || "").trim();
  const canonicalName = String(body.canonicalName || "").trim();
  if (!canonicalId || !/^[a-z0-9_]+$/.test(canonicalId)) {
    return new Response(
      JSON.stringify({ error: "canonicalId required, [a-z0-9_] slug shape" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }
  if (!canonicalName) {
    return new Response(
      JSON.stringify({ error: "canonicalName required — used to build the prompt" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // Env check upfront so we fail loud if the secret wasn't set.
  const recraftKey = Deno.env.get("RECRAFT_API_KEY");
  if (!recraftKey) {
    return new Response(
      JSON.stringify({
        error: "server missing RECRAFT_API_KEY",
        detail: "run: supabase secrets set RECRAFT_API_KEY=<your-key>",
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "server missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  // Admin gate. Recraft is a paid upstream; we keep the trigger
  // admin-only (same curation model as ingredient_info). The
  // is_admin() SQL helper from migration 0042 reads the user's
  // profiles.role server-side — we don't trust any client claim.
  const userId = extractUserIdFromJwt(req.headers.get("authorization") || "");
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401, headers: JSON_HEADERS,
    });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  {
    const { data: isAdminRow, error: isAdminErr } = await admin
      .rpc("is_admin", { uid: userId });
    if (isAdminErr) {
      console.error("[generate-canonical-image] is_admin rpc failed:", isAdminErr);
      return new Response(
        JSON.stringify({ error: "admin check failed", detail: isAdminErr.message }),
        { status: 500, headers: JSON_HEADERS },
      );
    }
    if (!isAdminRow) {
      return new Response(
        JSON.stringify({ error: "forbidden", detail: "canonical image generation is admin-only" }),
        { status: 403, headers: JSON_HEADERS },
      );
    }
  }

  // 1. Recraft generation.
  const prompt = buildPrompt(canonicalName, body.hint);
  let recraftUrl: string | null = null;
  try {
    const res = await fetch(RECRAFT_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${recraftKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        // V4 vector models accept only prompt / model / size / n /
        // response_format / controls. No style or substyle field —
        // sending them makes Recraft 400 with a validation error.
        size:  RECRAFT_SIZE,
        model: RECRAFT_MODEL,
        n:     1,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[generate-canonical-image] recraft non-2xx:", res.status, text);
      return new Response(
        JSON.stringify({
          error: "recraft_failed",
          detail: `Recraft returned ${res.status}: ${text.slice(0, 400)}`,
        }),
        { status: 502, headers: JSON_HEADERS },
      );
    }
    const data = await res.json();
    recraftUrl = data?.data?.[0]?.url || null;
    if (!recraftUrl) {
      return new Response(
        JSON.stringify({ error: "recraft_no_url", detail: "Recraft returned no image URL" }),
        { status: 502, headers: JSON_HEADERS },
      );
    }
  } catch (e) {
    console.error("[generate-canonical-image] recraft fetch threw:", e);
    return new Response(
      JSON.stringify({ error: "recraft_fetch_threw", detail: String(e) }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  // 2. Download the image bytes. Recraft's URL is short-lived; we
  //    persist to our own bucket so the app doesn't dead-link.
  let imageBytes: Uint8Array;
  let contentType = "image/png";
  try {
    const imgRes = await fetch(recraftUrl);
    if (!imgRes.ok) {
      return new Response(
        JSON.stringify({ error: "recraft_download_failed", detail: `status ${imgRes.status}` }),
        { status: 502, headers: JSON_HEADERS },
      );
    }
    contentType = imgRes.headers.get("content-type") || "image/png";
    const buf = await imgRes.arrayBuffer();
    imageBytes = new Uint8Array(buf);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "recraft_download_threw", detail: String(e) }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  // 3. Upload to Storage. Path keyed on canonical_id; upsert=true so
  //    regen overwrites cleanly. Cache-busting handled by storing the
  //    full public URL (which includes the path) on
  //    ingredient_info.info.imageUrl — re-fetching the same URL
  //    after regen will serve the new bytes once CDN expiry flushes;
  //    we could append a ?v= param if that turns out to be a problem
  //    in practice.
  // V4 vector model returns image/svg+xml; raster models return
  // png/webp/jpg. Pick the extension from the content type so the
  // storage object is served back with the right MIME at render
  // time. SVG is cohesive with our hand-drawn /icons/*.svg set.
  const ext = contentType.includes("svg") ? "svg"
    : contentType.includes("webp") ? "webp"
    : contentType.includes("jpeg") ? "jpg"
    : "png";
  const storagePath = `${canonicalId}.${ext}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, imageBytes, {
      contentType,
      upsert: true,
      cacheControl: "3600",
    });
  if (upErr) {
    console.error("[generate-canonical-image] storage upload failed:", upErr);
    return new Response(
      JSON.stringify({ error: "storage_upload_failed", detail: upErr.message }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  // 4. Public URL for <img src>. Bucket is public per migration 0070
  //    so this works without signed URLs. Append ?v=<timestamp> so
  //    browsers + CDNs bust their cache when the admin regenerates —
  //    otherwise the old image might hang around for the
  //    cacheControl window even though we overwrote the bytes.
  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
  const imageUrl = `${publicData.publicUrl}?v=${Date.now()}`;

  // 5. Pre-upload lock check. If another admin already marked the
  //    image as final (info.imageLocked === true), refuse the
  //    regeneration — they sealed this on purpose and a regen would
  //    silently overwrite the work. Admin must explicitly unlock
  //    first. Status 409 'Conflict' is the right shape: it's not a
  //    permission issue, it's a state conflict with the existing
  //    resource.
  const { data: existing, error: selErr } = await admin
    .from("ingredient_info")
    .select("info")
    .eq("ingredient_id", canonicalId)
    .maybeSingle();
  if (selErr) {
    console.error("[generate-canonical-image] select failed:", selErr);
    return new Response(
      JSON.stringify({ error: "ingredient_info_select_failed", detail: selErr.message }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
  if (existing?.info?.imageLocked === true) {
    return new Response(
      JSON.stringify({
        error: "locked",
        detail: "This canonical's image is locked as final. Unlock first to regenerate.",
        lockedBy: existing.info.imageLockedBy || null,
        lockedAt: existing.info.imageLockedAt || null,
      }),
      { status: 409, headers: JSON_HEADERS },
    );
  }
  const mergedInfo = { ...(existing?.info || {}), imageUrl };
  const { error: upsertErr } = await admin
    .from("ingredient_info")
    .upsert({ ingredient_id: canonicalId, info: mergedInfo });
  if (upsertErr) {
    console.error("[generate-canonical-image] info upsert failed:", upsertErr);
    return new Response(
      JSON.stringify({ error: "ingredient_info_upsert_failed", detail: upsertErr.message }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  return new Response(
    JSON.stringify({ imageUrl, canonicalId }),
    { status: 200, headers: JSON_HEADERS },
  );
});
