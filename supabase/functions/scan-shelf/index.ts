// Supabase Edge Function: scan-shelf
//
// Vision-scans a photo of a fridge interior or a pantry shelf and returns a
// structured list of items the user can review before they hit the pantry.
// Companion to scan-receipt: same response envelope, different prompt, no
// receipt-specific metadata (store / date / total).
//
// Lives server-side so the Anthropic API key never ships to the browser.
// Deployed via:
//
//   supabase functions deploy scan-shelf
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
//
// Called from the client via `supabase.functions.invoke("scan-shelf", …)`.
// Supabase forwards the caller's JWT — only authenticated users can hit this.
//
// Request body:
//   {
//     image: "<base64 string, no data: prefix>",
//     mediaType: "image/jpeg" | "image/png" | "image/webp",
//     ingredients: [
//       { id, name, category, units: [unit_id, ...] },  // canonical registry
//       ...
//     ],
//     location: "fridge" | "pantry" | "freezer"          // drives the prompt
//   }
//
// Response:
//   {
//     items: [
//       {
//         ingredientId: string | null,
//         name: string,
//         emoji: string,
//         amount: number,
//         unit: string,
//         category: string,
//         confidence: "high" | "medium" | "low",
//         priceCents: null,             // shelf scans never see prices
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

// Haiku 4.5 has vision, is cheap, and is plenty for "name everything you see".
const MODEL = "claude-haiku-4-5-20251001";

type CanonicalIngredient = {
  id: string;
  name: string;
  category: string;
  units: string[];
};

type Location = "fridge" | "pantry" | "freezer";

// Per-location guidance. The shared prompt frame around it stays the same so
// the response shape never drifts between modes.
const LOCATION_GUIDE: Record<Location, string> = {
  fridge: `You're looking at the inside of an open refrigerator. Catalog every
distinct food item you can see. Focus on:
  - dairy (milk cartons, yogurt tubs, cheese, butter, eggs)
  - produce (whole fruits, bagged greens, herbs, vegetables)
  - condiments (jars, bottles, squeeze tubes on the door)
  - leftovers in clear containers (call them out by what's visible — "looks
    like pasta", "rice and vegetables")
  - drinks (juice, soda, beer, sparkling water)
  - raw meat/fish in butcher paper or trays

Estimating amount:
  - Transparent containers: estimate fill (e.g. "milk gallon, ~1/3 full" →
    amount: 0.33, unit: "gallon"). Confidence "high".
  - Opaque containers / hidden contents: assume one full container and mark
    confidence "low" so the user knows to double-check.
  - Loose produce: count what's visible (3 lemons, 2 bell peppers).
  - Bagged greens / pre-cut produce: 1 bag/clamshell, confidence "medium".`,

  pantry: `You're looking at a pantry shelf or open kitchen cabinet. Catalog
every distinct food item you can see. Focus on:
  - dry goods in bags or boxes (rice, pasta, flour, cereal, crackers)
  - canned goods (soups, beans, tomatoes, tuna)
  - jars and bottles (peanut butter, oils, vinegars, sauces)
  - snacks (chips, granola bars, cookies)
  - baking staples (sugar, baking powder, chocolate chips)

Estimating amount:
  - Containers are almost always opaque — count discrete items (1 box, 2
    cans, 1 jar) rather than guessing how full each one is.
  - Confidence "high" when the label is fully readable, "medium" when you can
    identify the type but not the exact product, "low" when partially
    occluded or label-illegible.
  - If multiples are stacked (3 cans of black beans), report amount: 3 with
    unit: "can".`,

  freezer: `You're looking inside a freezer. Catalog every distinct frozen
food item you can see. Focus on:
  - frozen vegetables, fruits, meals
  - ice cream pints / tubs
  - meat / fish in freezer bags
  - bread, dough, frozen baked goods

Most freezer items are in opaque packaging or frosted bags. Count discrete
items (1 bag, 1 pint, 1 box) rather than estimating mass. Mark confidence
"low" when the label is obscured by frost.`,
};

function buildPrompt(location: Location, ingredients: CanonicalIngredient[]): string {
  const registry = ingredients
    .map(
      (i) =>
        `- ${i.id}: ${i.name} (${i.category}) — valid units: ${i.units.join(", ")}`,
    )
    .join("\n");

  return `${LOCATION_GUIDE[location]}

For each item, try to match it to one of the canonical ingredients listed
below. When there's a clear match:
  - set ingredientId to the canonical id (exact string)
  - use a unit from that ingredient's valid units list (prefer the unit that
    matches how the item is packaged — gallon for milk, dozen for eggs, lb
    for bulk meat, can for canned goods, jar for jarred sauces)
  - use the canonical name and its typical emoji

If there's no clear canonical match (e.g. "Alouette spread", "capers",
"branded cereal"):
  - set ingredientId to null
  - invent a reasonable name, emoji, amount, unit, and category
  - CHOOSE THE UNIT BASED ON WHAT THE ITEM IS, NEVER DEFAULT TO "count":
      * Cheese (any style) → "oz" or "lb", NEVER "count"
      * Liquid dairy / juice / milk-style drink → "gallon", "half_gallon",
        "quart", "pint", "fl_oz" — match the visible container size
      * Yogurt / sour cream / cottage cheese → "oz" or "tub"
      * Meat / fish / poultry → "lb" or "oz" (unless it's clearly N pieces)
      * Deli meats → "oz" or "slice"
      * Bread / baguette / bagel → "loaf" or "slice"
      * Rice / grains / flour / sugar → "lb" or "bag"
      * Canned goods → "can"
      * Condiments / sauces in jars/bottles → "jar" or "bottle"
      * Whole fresh produce sold individually → "count" is fine
      * Bulk produce → "lb"

Categories (use for non-canonical items): dairy, produce, dry, meat, pantry, frozen

Confidence tag (REQUIRED on every item):
  - "high":   you can identify the item AND estimate the amount with
              reasonable certainty (clear label, transparent container, or
              a countable number of discrete units in plain view).
  - "medium": you're confident about WHAT it is but not exactly how much
              (typical for bagged or boxed shelf items).
  - "low":    partially occluded, label hidden, frosted-over, or the item
              is identifiable only by silhouette / color. The user should
              definitely double-check.

Canonical ingredient registry:
${registry}

Return ONLY a JSON object — no markdown fences, no prose, no commentary —
with this shape:

{
  "items": [
    {"ingredientId":"milk","name":"Milk","emoji":"🥛","amount":0.33,"unit":"gallon","category":"dairy","confidence":"high"},
    {"ingredientId":"butter","name":"Unsalted Butter","emoji":"🧈","amount":2,"unit":"stick","category":"dairy","confidence":"high"},
    {"ingredientId":null,"name":"Hummus","emoji":"🥣","amount":1,"unit":"tub","category":"dairy","confidence":"medium"}
  ]
}

If the image clearly isn't a fridge / pantry / freezer photo, or you can't
identify any items, return {"items": []}.`;
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
    location?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const { image, mediaType, ingredients = [], location } = body;
  if (!image || !mediaType) {
    return new Response(
      JSON.stringify({ error: "image and mediaType are required" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const loc: Location =
    location === "fridge" || location === "pantry" || location === "freezer"
      ? location
      : "pantry";

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
              { type: "text", text: buildPrompt(loc, ingredients) },
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

  // Accept either an object with `items` or a bare array (model regressions).
  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { items?: unknown[] })?.items)
      ? (parsed as { items: unknown[] }).items
      : [];

  // Normalize confidence to one of the three tags so the client can color-code
  // without defensive checks. Anything weird becomes "medium".
  const normalized = items.map((raw) => {
    const it = raw as Record<string, unknown>;
    const conf = it.confidence;
    const confidence =
      conf === "high" || conf === "medium" || conf === "low" ? conf : "medium";
    return {
      ...it,
      confidence,
      // Shelf scans never carry receipt prices — explicit null so the client
      // doesn't accidentally inherit a stale value from a previous scan.
      priceCents: null,
    };
  });

  return new Response(
    JSON.stringify({ store: null, date: null, totalCents: null, items: normalized }),
    { headers: JSON_HEADERS },
  );
});
