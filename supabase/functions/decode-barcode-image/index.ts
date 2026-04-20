// Supabase Edge Function: decode-barcode-image
//
// Fallback path for devices where `window.BarcodeDetector` / live
// `getUserMedia` aren't available — notably iOS PWAs in standalone
// mode, which block BarcodeDetector regardless of iOS version.
//
// Takes a photo of the product (any barcode captured via the native
// camera app through an `<input type="file" capture="environment">`
// field) and returns the barcode digits that are printed in plain
// text beneath every UPC/EAN/ITF label. Claude vision reads the
// digits directly — we don't need to decode the bar pattern because
// the human-readable number is always printed right next to it.
//
// Downstream: client feeds the returned barcode into the existing
// lookup-barcode edge function, so the OFF resolution + nutrition
// mapping path is unchanged from the live-scanner flow.
//
// Deploy:
//   supabase functions deploy decode-barcode-image
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
//
// Request body:
//   {
//     image:     "<base64 string, no data: prefix>",
//     mediaType: "image/jpeg" | "image/png" | "image/webp"
//   }
//
// Response (hit):
//   { found: true, barcode: "0123456789012" }
//
// Response (miss):
//   { found: false, reason: "no_barcode_visible" | "unreadable" | "not_a_product" }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Sonnet 4.6 — Haiku 4.5 turned out to miss digits on real-world
// product photos (dropped an 8 from an 811670031139 UPC in testing;
// Go-UPC's fuzzy matcher was more forgiving than ours could be).
// Reading 12 digits precisely is an accuracy task, not a speed task;
// Sonnet is the right tool. Still responds in ~2s for this prompt.
const MODEL = "claude-sonnet-4-6";

const PROMPT = `You are reading a barcode off a product photo.

Every UPC / EAN / ITF barcode prints its digits in human-readable form
directly below or beside the bars. Your job is to extract ONLY those
digits, precisely.

Return ONE of these exact JSON shapes, nothing else. No prose, no
markdown fences, no explanation.

  SUCCESS:
    { "barcode": "<digits only, 8-14 chars>" }

  FAILURES:
    { "error": "no_barcode_visible" }       // no barcode in the frame at all
    { "error": "unreadable" }               // blurry / cut off / glare
    { "error": "not_a_product" }            // QR code, loyalty card, wristband

Rules (precision matters — wrong digits are worse than a miss):

  1. Common barcode structures. Use these to sanity-check your read:
     - UPC-A: 12 digits, printed as "X XXXXX XXXXX X" (1-5-5-1 groups)
     - EAN-13: 13 digits, printed as "X XXXXXX XXXXXX" (1-6-6)
     - EAN-8: 8 digits, printed as "XXXX XXXX" (4-4)
     - UPC-E: 8 digits, single block
     - ITF-14: 14 digits, usually grouped 1-3-5-5 or similar

  2. Count every digit in the PRINTED text under the bars. If the
     label shows 4 groups, concatenate all 4. Don't skip a group
     because it's small — the leading / trailing single digits
     (check digits, number-system digits) are often printed smaller
     than the middle block but they are STILL PART OF THE BARCODE.

  3. "0 12345 67890 5" -> "0123456789012". Twelve digits. If your
     output has fewer digits than the printed label shows, you
     missed one — re-read, don't submit.

  4. Digits only in the output. No spaces, no hyphens, no letters.

  5. If you see multiple barcodes, return the one on the main product
     label (the big one on the box/bag/bottle), not a serial-number
     sticker, a promo code, or a secondary shipping label.

  6. If you can't read the full code confidently — even by one digit
     — return { "error": "unreadable" }. A wrong guess routes the
     user to the wrong product; an honest miss just asks them to
     retake the photo.`;

// OFF accepts 8-14 digit codes (UPC-E=8, EAN-8=8, UPC-A=12, EAN-13=13,
// ITF-14=14). Guard against the model returning something that won't
// pass downstream validation.
function isValidBarcode(v: unknown): v is string {
  return typeof v === "string" && /^\d{8,14}$/.test(v);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  let body: { image?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const image = body?.image?.trim?.() || "";
  const mediaType = body?.mediaType || "image/jpeg";
  if (!image) {
    return new Response(JSON.stringify({ error: "image required" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
  if (!/^image\/(jpeg|png|webp)$/i.test(mediaType)) {
    return new Response(
      JSON.stringify({ error: "mediaType must be image/jpeg|png|webp" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "server is missing ANTHROPIC_API_KEY — run `supabase secrets set ANTHROPIC_API_KEY=…`",
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  let anthropicResp: Response;
  try {
    anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 80,   // a JSON blob with just digits is <60 tokens
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
              { type: "text",  text: PROMPT },
            ],
          },
          // Prefill so Claude continues straight from "{" — no
          // leading prose, no markdown. Same trick as generate-recipe.
          { role: "assistant", content: [{ type: "text", text: "{" }] },
        ],
      }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `anthropic fetch failed: ${String(err)}` }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (!anthropicResp.ok) {
    const text = await anthropicResp.text();
    return new Response(
      JSON.stringify({ error: `anthropic returned ${anthropicResp.status}`, detail: text }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const data = await anthropicResp.json();
  // Prepend the "{" we prefilled to recover a valid JSON body.
  const raw = "{" + (data?.content?.[0]?.text ?? "");
  const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return new Response(
      JSON.stringify({ found: false, reason: "unreadable" }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  if (typeof parsed.error === "string" && parsed.error) {
    const reason = ["no_barcode_visible", "unreadable", "not_a_product"].includes(parsed.error as string)
      ? (parsed.error as string)
      : "unreadable";
    return new Response(
      JSON.stringify({ found: false, reason }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  if (isValidBarcode(parsed.barcode)) {
    return new Response(
      JSON.stringify({ found: true, barcode: parsed.barcode }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  return new Response(
    JSON.stringify({ found: false, reason: "unreadable" }),
    { status: 200, headers: JSON_HEADERS },
  );
});
