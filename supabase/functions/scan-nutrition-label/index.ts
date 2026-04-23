// Supabase Edge Function: scan-nutrition-label
//
// Reads a photo of a US FDA "Nutrition Facts" panel (or EU-style
// per-100g label) and returns a structured block mapping every
// printed field to our pantry schema — macros + full micros +
// package sizing. Client calls this instead of making the user
// type label numbers by hand.
//
// Deployed via:
//   supabase functions deploy scan-nutrition-label
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
//
// Called from the client via
//   supabase.functions.invoke("scan-nutrition-label", {
//     body: { image: base64, mediaType, hintCanonicalId?, hintBrand? }
//   })
//
// Request body:
//   {
//     image: "<base64 string, no data: prefix>",
//     mediaType: "image/jpeg" | "image/png" | "image/webp",
//     hintCanonicalId?: string,    // if known, helps Sonnet disambiguate
//     hintBrand?: string           // e.g. on a barcode-stocked row
//   }
//
// Response (success):
//   {
//     ok: true,
//     per: "serving" | "100g" | "count",   // US default: serving
//     serving_g: number | null,            // grams per serving
//     servings_per_container: number | null,
//     net_weight: { amount: number, unit: string } | null,
//     nutrition: {
//       kcal, total_fat_g, saturated_fat_g, trans_fat_g,
//       cholesterol_mg, sodium_mg,
//       carb_g, fiber_g, total_sugar_g, added_sugar_g,
//       protein_g,
//       vitamin_d_mcg, calcium_mg, iron_mg, potassium_mg
//     },  // each value: number | null
//     confidence: "high" | "medium" | "low",
//     notes: string | null
//   }
//
// Response (non-label / unreadable):
//   { ok: false, reason: string }
//
// Errors return { error: string } with a non-2xx status.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Sonnet 4.6 over Haiku — labels have 6-7pt fine print with
// fractional grams, "<1g" sub-lines, and "Includes Xg Added Sugars"
// insets. Haiku drops digits on those; Sonnet discriminates them
// reliably. ~$0.01/scan; nutrition capture is once-per-SKU (teaches
// brand_nutrition), so the marginal cost collapses across users.
const MODEL = "claude-sonnet-4-6";

function buildPrompt(hintCanonicalId?: string, hintBrand?: string): string {
  const hint =
    hintCanonicalId || hintBrand
      ? `\nContext hint (do not override what the label shows — just for disambiguation):\n${
          hintCanonicalId ? `  - canonical: ${hintCanonicalId}\n` : ""
        }${hintBrand ? `  - brand: ${hintBrand}\n` : ""}\n`
      : "";

  return `You are reading a Nutrition Facts label off a food package. Extract
every printed value into a single JSON object — no prose, no markdown
fences. Return ONLY the JSON.
${hint}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE OUTPUT SHAPE (return exactly this)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "ok": true,
  "per": "serving" | "100g" | "count",
  "serving_g": <number or null>,
  "servings_per_container": <number or null>,
  "net_weight": { "amount": <number>, "unit": "oz"|"g"|"lb"|"kg"|"fl_oz"|"ml"|"l" } | null,
  "nutrition": {
    "kcal":              <number or null>,
    "total_fat_g":       <number or null>,
    "saturated_fat_g":   <number or null>,
    "trans_fat_g":       <number or null>,
    "cholesterol_mg":    <number or null>,
    "sodium_mg":         <number or null>,
    "carb_g":            <number or null>,
    "fiber_g":           <number or null>,
    "total_sugar_g":     <number or null>,
    "added_sugar_g":     <number or null>,
    "protein_g":         <number or null>,
    "vitamin_d_mcg":     <number or null>,
    "calcium_mg":        <number or null>,
    "iron_mg":           <number or null>,
    "potassium_mg":      <number or null>
  },
  "confidence": "high" | "medium" | "low",
  "notes": "<one-line caveat or null>"
}

Every nutrition key MUST appear — use null (not a missing key) when
the label omits that row. Numbers must be plain JSON numbers, not
strings. Do not wrap the JSON in markdown fences.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
READING RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BASIS (per):
  - US FDA labels always declare a serving size. Return per="serving"
    and set serving_g from the "Serving Size XXg" line (the number in
    parentheses, not the household measure).
  - If the label is EU/UK style and shows per-100g values only
    (no serving size declared), return per="100g", serving_g=null.
  - Return per="count" only if the label explicitly says "per 1
    piece" or similar (rare — mostly individually-wrapped candies).
  - If the label has BOTH a per-serving and a per-container column,
    ALWAYS return the per-serving values. Record "dual-column label;
    returned per-serving" in notes.
  - If the label shows a per-serving column AND a per-100g column
    (common on EU exports), prefer per-serving. Record it in notes.

SERVING SIZE:
  - serving_g is the grams in parentheses, e.g. "2 tbsp (32g)" → 32.
  - If the household measure is the primary declaration and no grams
    are given, set serving_g=null.
  - Fractions: "2/3 cup (55g)" → serving_g=55.

SERVINGS PER CONTAINER:
  - "Servings Per Container: 4" → 4.
  - "Servings Per Container: about 10" → 10 (drop the "about").
  - "1 serving per container" → 1.
  - Missing / varies → null.

NET WEIGHT (from the package front, if visible in the photo):
  - "Net Wt 16 oz (453g)" → { "amount": 16, "unit": "oz" }.
  - "Net Wt 300g" → { "amount": 300, "unit": "g" }.
  - "1 LB" → { "amount": 1, "unit": "lb" }.
  - "12 FL OZ" → { "amount": 12, "unit": "fl_oz" }.
  - Prefer the IMPERIAL value on US packages; metric on EU.
  - Not visible in the photo → null.

UNITS — be disciplined:
  - sodium_mg, cholesterol_mg, calcium_mg, iron_mg, potassium_mg  →
    milligrams. If the label shows "1.1 g" for sodium, convert to
    1100 mg.
  - vitamin_d_mcg → micrograms. If the label shows IU, convert
    (1 mcg = 40 IU; 400 IU → 10 mcg) and record the conversion in
    notes. If both mcg and IU are printed, use the mcg column.
  - All other macro fields are grams.

ROUNDING + SUB-LINES:
  - "Less than 1g" / "<1g" / "<1 g" → return 0.5.
  - "0g" with a dagger (0g†) → return 0.
  - "Includes Xg Added Sugars" (inset under Total Sugars) →
    added_sugar_g = X. DO NOT subtract X from total_sugar_g — the
    FDA label already sums them into Total Sugars. Just extract
    both numbers as printed.
  - Trailing asterisks for "Daily Value" — ignore those; we only
    want the absolute quantity.

FRACTIONS:
  - "2/3 cup" → 0.67. "1/4 cup" → 0.25. "1½ tbsp" → 1.5.
  - Unicode fractions (¼ ½ ¾ ⅓ ⅔ ⅛ ⅜ ⅝ ⅞) count the same way.

NON-NUTRITION OR UNREADABLE IMAGE:
  Return { "ok": false, "reason": "<short description>" } with NO
  other fields. Examples of reasons:
    - "not a nutrition label"        (photo of a pet, a receipt, etc.)
    - "label is too blurry to read"
    - "label is in a language I can't read"
    - "only partial label visible — missing Nutrition Facts panel"

CONFIDENCE:
  - high:   clean photo, every field you returned was unambiguous.
  - medium: legible but you had to convert units (IU → mcg), or
            one or two values were ambiguous between two digits.
  - low:    half the label is glare / cut off / rotated; you
            returned what you could but expect the user to correct.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORKED EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Example 1 — Standard US label (cereal):
  "Serving Size 1 cup (40g), Servings Per Container about 10.
   Calories 150 | Total Fat 2g (Sat 0.5g, Trans 0g) | Cholesterol 0mg |
   Sodium 180mg | Total Carb 34g (Fiber 4g, Total Sugars 8g, Includes 6g
   Added Sugars) | Protein 5g | Vitamin D 2mcg | Calcium 100mg | Iron
   8mg | Potassium 170mg."
  Net Wt 14 oz (397g) on the front panel.
  →
  {
    "ok": true, "per": "serving", "serving_g": 40, "servings_per_container": 10,
    "net_weight": { "amount": 14, "unit": "oz" },
    "nutrition": {
      "kcal": 150, "total_fat_g": 2, "saturated_fat_g": 0.5, "trans_fat_g": 0,
      "cholesterol_mg": 0, "sodium_mg": 180,
      "carb_g": 34, "fiber_g": 4, "total_sugar_g": 8, "added_sugar_g": 6,
      "protein_g": 5,
      "vitamin_d_mcg": 2, "calcium_mg": 100, "iron_mg": 8, "potassium_mg": 170
    },
    "confidence": "high", "notes": null
  }

Example 2 — Dual-column label (peanut butter, per serving and per container):
  "Serving Size 2 tbsp (32g) | 15 servings per container
   [Per Serving]  [Per Container]
    200 kcal       3000 kcal
    16 g fat       240 g fat
    ..."
  →
  returns the PER SERVING column only. Notes: "dual-column label;
  returned per-serving column".

Example 3 — EU-style label (imported snack, metric only):
  "Per 100g: Energy 512 kcal / 2140 kJ | Fat 28g (of which saturated
   3.2g) | Carbs 59g (sugars 2.1g) | Protein 8g | Salt 0.8g."
  (No per-serving column; salt, not sodium.)
  →
  per="100g", serving_g=null, servings_per_container=null.
  trans_fat_g=null, cholesterol_mg=null (not printed).
  sodium_mg = 0.8g × 0.4 (salt→sodium factor) × 1000 = 320.
  notes: "EU per-100g label; sodium converted from 0.8g salt".

Example 4 — Photo is actually a receipt:
  → { "ok": false, "reason": "not a nutrition label" }

Example 5 — Label with Vitamin D in IU only:
  "Vitamin D 400 IU"
  → vitamin_d_mcg = 10, notes: "Vitamin D converted from IU (400 IU → 10 mcg)",
    confidence: "medium".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Now extract the label from the image. Return ONLY the JSON object.`;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  let body: {
    image?: string;
    mediaType?: string;
    hintCanonicalId?: string;
    hintBrand?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const { image, mediaType, hintCanonicalId, hintBrand } = body;
  if (!image || !mediaType) {
    return new Response(
      JSON.stringify({ error: "image and mediaType are required" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          "server is missing ANTHROPIC_API_KEY — run `supabase secrets set ANTHROPIC_API_KEY=…`",
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  // Call Claude
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
        // 2000 tokens — single-label output is ~400 tokens of JSON.
        // Plenty of headroom for notes + preamble the model sometimes
        // emits despite instructions.
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image },
              },
              { type: "text", text: buildPrompt(hintCanonicalId, hintBrand) },
            ],
          },
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
      JSON.stringify({
        error: `anthropic returned ${anthropicResp.status}`,
        detail: text,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const data = await anthropicResp.json();
  const raw = data?.content?.[0]?.text ?? "{}";
  const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return new Response(
      JSON.stringify({
        error: "couldn't parse model output as JSON",
        raw,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  // Normalize shape. Accept the happy-path object, the "ok:false"
  // refusal, or a bare object missing "ok" (treat as success).
  if (!parsed || typeof parsed !== "object") {
    return new Response(
      JSON.stringify({ error: "model returned unexpected shape", raw }),
      { status: 502, headers: JSON_HEADERS },
    );
  }
  const p = parsed as Record<string, unknown>;

  // Refusal path.
  if (p.ok === false) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: typeof p.reason === "string" ? p.reason : "couldn't read label",
      }),
      { headers: JSON_HEADERS },
    );
  }

  // Success path. Coerce every field to its expected type + range.
  const nutIn = (p.nutrition ?? {}) as Record<string, unknown>;
  const numOrNull = (v: unknown, { min = 0, max = Infinity } = {}): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n < min || n > max) return null;
    return n;
  };

  const nutrition = {
    kcal:             numOrNull(nutIn.kcal,              { max: 10000 }),
    total_fat_g:      numOrNull(nutIn.total_fat_g,       { max: 200 }),
    saturated_fat_g:  numOrNull(nutIn.saturated_fat_g,   { max: 200 }),
    trans_fat_g:      numOrNull(nutIn.trans_fat_g,       { max: 100 }),
    cholesterol_mg:   numOrNull(nutIn.cholesterol_mg,    { max: 5000 }),
    sodium_mg:        numOrNull(nutIn.sodium_mg,         { max: 50000 }),
    carb_g:           numOrNull(nutIn.carb_g,            { max: 200 }),
    fiber_g:          numOrNull(nutIn.fiber_g,           { max: 200 }),
    total_sugar_g:    numOrNull(nutIn.total_sugar_g,     { max: 200 }),
    added_sugar_g:    numOrNull(nutIn.added_sugar_g,     { max: 200 }),
    protein_g:        numOrNull(nutIn.protein_g,         { max: 200 }),
    vitamin_d_mcg:    numOrNull(nutIn.vitamin_d_mcg,     { max: 500 }),
    calcium_mg:       numOrNull(nutIn.calcium_mg,        { max: 5000 }),
    iron_mg:          numOrNull(nutIn.iron_mg,           { max: 200 }),
    potassium_mg:     numOrNull(nutIn.potassium_mg,      { max: 10000 }),
  };

  // Refuse to return a "success" response with nothing in it —
  // protects the client from writing an empty override that masks
  // lower resolver tiers. Fall back to the refusal shape.
  if (nutrition.kcal == null) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason:
          "couldn't extract Calories — is this the right side of the package?",
      }),
      { headers: JSON_HEADERS },
    );
  }

  const per =
    p.per === "100g" || p.per === "count" || p.per === "serving"
      ? p.per
      : "serving";
  const serving_g = numOrNull(p.serving_g, { min: 0.1, max: 5000 });
  const servings_per_container = numOrNull(p.servings_per_container, { min: 0.1, max: 1000 });

  let net_weight: { amount: number; unit: string } | null = null;
  if (p.net_weight && typeof p.net_weight === "object") {
    const nw = p.net_weight as Record<string, unknown>;
    const amt = numOrNull(nw.amount, { min: 0.01, max: 100000 });
    const unit = typeof nw.unit === "string" ? nw.unit.trim().toLowerCase() : null;
    if (amt != null && unit) net_weight = { amount: amt, unit };
  }

  const confidence =
    p.confidence === "high" || p.confidence === "medium" || p.confidence === "low"
      ? p.confidence
      : "medium";
  const notes = typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null;

  const payload = {
    ok: true,
    per,
    serving_g: per === "serving" ? serving_g : null,
    servings_per_container,
    net_weight,
    nutrition,
    confidence,
    notes,
  };

  return new Response(JSON.stringify(payload), { headers: JSON_HEADERS });
});
