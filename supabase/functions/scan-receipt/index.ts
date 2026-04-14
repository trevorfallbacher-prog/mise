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
  - use a unit from that ingredient's valid units list (prefer the one that
    matches how the item was sold — gallon for milk, dozen for eggs, lb for
    bulk meat, etc.)
  - use the canonical name and its typical emoji

If there's no clear canonical match (e.g. "Alouette", "capers", "pickles"):
  - set ingredientId to null
  - invent a reasonable name, emoji, amount, unit, and category
  - CHOOSE THE UNIT BASED ON WHAT THE ITEM IS, NEVER DEFAULT TO "count":
      * Cheese (emoji 🧀, any style) → "oz" or "lb", NEVER "count"
      * Liquid dairy / juice / milk-style drink (🥛 🧃) → "gallon", "half_gallon",
        "quart", "pint", "fl_oz" — use the container size shown on the receipt
      * Yogurt / sour cream / cottage cheese (🥛 tub-style) → "oz" or "tub"
      * Meat / fish / poultry (🥩 🍗 🥓 🐟 🍤) → "lb" or "oz", NEVER "count"
        (the one exception is if the receipt literally says "4 CT" / "2 PACK")
      * Deli meats → "oz" or "slice"
      * Bread / baguette / bagel (🍞 🥖 🥯) → "loaf" or "slice"
      * Rice / grains / flour / sugar (🍚 🌾) → "lb" or "bag"
      * Canned goods (🥫) → "can"
      * Condiments / sauces in jars/bottles (🍶 🍯) → "jar" or "bottle"
      * Fresh produce usually sold individually (🍎 🍌 🥑 🥒 🫑) → "count" IS fine
      * Fresh produce sold by weight (bulk 🥔 🥕 🥦) → "lb"

  "count" is a LAST RESORT for obscure items with no better fit. If you're
  unsure about a cheese or a meat, err toward "oz".

CRITICAL: the big number next to an item on a receipt is almost always the
PRICE in USD ($6.53, $3.99, etc.), NOT the quantity. Do NOT put the price in
the amount field. If the receipt doesn't clearly show a quantity, use 1.

Reading examples:
  - "MILK 2% GAL 4.29"      → amount: 1,    unit: "gallon"  (4.29 is price)
  - "EGGS LG 18CT 6.53"     → amount: 18,   unit: "count"   (or 1.5 dozen)
  - "BANANAS 2.14 LB @ .59" → amount: 2.14, unit: "lb"
  - "NY STRIP 1.10 LB 15.67"→ amount: 1.10, unit: "lb"      (15.67 is price)
  - "BUTTER QTRS 4.99"      → amount: 1,    unit: "lb"      (no quantity shown → 1)

Categories (use for non-canonical items): dairy, produce, dry, meat, pantry, frozen

Canonical ingredient registry:
${registry}

For every item also include:
  - priceCents: the USD price shown next to it, in integer cents. "4.29" →
    429. If a price isn't legible, use null.

Additionally, look at the receipt header / footer and return receipt metadata:
  - store:    the store name if visible (e.g. "Trader Joe's", "Safeway", "Wegmans"); null if not.
  - date:     the transaction date in YYYY-MM-DD if visible; null if not.
  - totalCents: the receipt TOTAL in integer cents if visible; null if not.
    (Use the "TOTAL" line, not subtotal or tax line.)

Return ONLY a JSON object — no markdown fences, no prose, no trailing commentary —
with this shape:

{
  "store": "Trader Joe's" | null,
  "date": "2026-04-14" | null,
  "totalCents": 4523 | null,
  "items": [
    {"ingredientId":"butter","name":"Unsalted Butter","emoji":"🧈","amount":1,"unit":"stick","category":"dairy","priceCents":499},
    {"ingredientId":"milk","name":"Milk","emoji":"🥛","amount":1,"unit":"gallon","category":"dairy","priceCents":429},
    {"ingredientId":"eggs","name":"Eggs","emoji":"🥚","amount":18,"unit":"count","category":"dairy","priceCents":653},
    {"ingredientId":null,"name":"Greek Yogurt","emoji":"🥛","amount":32,"unit":"oz","category":"dairy","priceCents":599}
  ]
}

If the image clearly is not a grocery receipt or you can't read any items,
return {"store":null,"date":null,"totalCents":null,"items":[]}.`;
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

  // Accept either the new object shape {store,date,totalCents,items}
  // or the legacy bare array (in case the model regresses to the old style).
  let payload: {
    store: string | null;
    date: string | null;
    totalCents: number | null;
    items: unknown[];
  };
  if (Array.isArray(parsed)) {
    payload = { store: null, date: null, totalCents: null, items: parsed };
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).items)) {
    const p = parsed as any;
    payload = {
      store: typeof p.store === "string" ? p.store : null,
      date: typeof p.date === "string" ? p.date : null,
      totalCents: Number.isFinite(p.totalCents) ? p.totalCents : null,
      items: p.items,
    };
  } else {
    return new Response(
      JSON.stringify({ error: "model returned unexpected shape", raw }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  return new Response(JSON.stringify(payload), { headers: JSON_HEADERS });
});
