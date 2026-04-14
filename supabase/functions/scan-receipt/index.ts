// Supabase Edge Function: scan-receipt
//
// Proxies a receipt image to Claude and returns a structured list of pantry
// items. Lives server-side so the Anthropic API key is never shipped to the
// browser. Deployed via:
//
//   supabase functions deploy scan-receipt
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
//
// Called from the client via `supabase.functions.invoke("scan-receipt", …)`.
// Supabase handles JWT verification automatically (the caller's Authorization
// header is forwarded), so only authenticated users can hit this.
//
// Request body:
//   {
//     image: "<base64 string, no data: prefix>",
//     mediaType: "image/jpeg" | "image/png" | "image/webp",
//     ingredients: [
//       { id, name, category, units: [unit_id, ...] },  // canonical registry
//       ...
//     ]
//   }
//
// Response:
//   {
//     items: [
//       {
//         ingredientId: string | null,  // populated if matched to canon
//         name: string,                 // canonical name or free-text
//         emoji: string,
//         amount: number,
//         unit: string,                 // canonical unit id, or free text
//         category: string,
//       },
//       ...
//     ]
//   }
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

// Using Haiku 4.5 — it has vision, is cheap, and plenty smart for receipt OCR.
const MODEL = "claude-haiku-4-5-20251001";

type CanonicalIngredient = {
  id: string;
  name: string;
  category: string;
  units: string[];
};

function buildPrompt(ingredients: CanonicalIngredient[]): string {
  const registry = ingredients
    .map(
      (i) =>
        `- ${i.id}: ${i.name} (${i.category}) — valid units: ${i.units.join(", ")}`,
    )
    .join("\n");

  return `You are reading a grocery receipt. Extract every food/grocery item on it.

For each item, try to match it to one of the canonical ingredients listed
below. When there's a clear match:
  - set ingredientId to the canonical id (exact string)
  - use a unit from that ingredient's valid units list
  - use the canonical name and its typical emoji

If there's no clear canonical match (e.g. "Greek yogurt", "rice", "capers"):
  - set ingredientId to null
  - invent a reasonable name, emoji, amount, unit, and category

Categories (use for non-canonical items): dairy, produce, dry, meat, pantry, frozen

Canonical ingredient registry:
${registry}

Return ONLY a JSON array — no markdown fences, no prose, no trailing commentary.
Example output:
[
  {"ingredientId":"butter","name":"Unsalted Butter","emoji":"🧈","amount":2,"unit":"stick","category":"dairy"},
  {"ingredientId":null,"name":"Greek Yogurt","emoji":"🥛","amount":32,"unit":"oz","category":"dairy"}
]

If the image clearly is not a grocery receipt or you can't read any items,
return an empty array: []`;
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
    ingredients?: CanonicalIngredient[];
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const { image, mediaType, ingredients = [] } = body;
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
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image },
              },
              { type: "text", text: buildPrompt(ingredients) },
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
  const raw = data?.content?.[0]?.text ?? "[]";
  const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();

  let items: unknown;
  try {
    items = JSON.parse(cleaned);
  } catch {
    return new Response(
      JSON.stringify({
        error: "couldn't parse model output as JSON",
        raw,
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (!Array.isArray(items)) {
    return new Response(
      JSON.stringify({ error: "model returned non-array", raw }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  return new Response(JSON.stringify({ items }), { headers: JSON_HEADERS });
});
