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

  return `You are reading a grocery receipt. Extract every food/grocery item.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULE — RAW TEXT IS SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The user wants to trust what YOU tell them is on their receipt. Every
hallucinated expansion destroys that trust. Treat the receipt text as
sacred: preserve it unless you are highly confident the expansion is
correct.

For each item, return TWO name fields:

  * rawText: the EXACT characters printed on the receipt, in the order
    printed. Fix obvious OCR errors ("MLLK" → "MILK", "BRCCOU" →
    "BROCCOLI"). Do NOT expand abbreviations. Do NOT add brand names
    that aren't visible. Do NOT rewrite cryptic codes into full words.
    If the receipt literally says "ACQUAMAR FLA 3.99", rawText is
    "ACQUAMAR FLA".

  * name: the user-facing display name.
      - If you are ≥90% confident what the item is AND the expansion
        is close to rawText ("MILK 2% GAL" → "2% Milk"), set name to
        the cleaned-up version.
      - Otherwise SET name EQUAL TO rawText. No guessing. No "probably
        imitation crab" expansions. The user will fix it if the
        display text is gibberish; they can't fix an item that was
        silently renamed into something it isn't.

  * canonicalId: only set when confidence is "high" AND there is an
    unambiguous match in the canonical registry below. When in doubt,
    canonicalId = null.

  * barcode: the UPC / EAN / SKU digit string printed on that
    receipt line, if visible. THIS IS HIGH-VALUE — getting the
    barcode lets us pair the receipt line back to the in-aisle scan,
    which is how the user attaches a price to the right pantry row.
    Look HARD on every line. Receipts print barcodes in many places:
      - between the item text and the price (most common)
      - immediately after the item text on its own (Walmart often)
      - at the very end of the line, after the price
      - on a separate sub-line below the item
      - in tiny font directly under the item description
    Extract whichever digit cluster on the line LOOKS like a barcode
    (a long, contiguous run of 7+ digits). Strip spaces and hyphens.
    Length is typically 8–14 digits BUT some retailers print
    truncated forms — accept anything 7+ digits long that looks
    like a product code, not a price or weight.

    IMPORTANT — Walmart prints a 12-digit form that LOOKS unusual
    but IS a real barcode: the manufacturer's UPC right-shifted
    (drop the check digit, prepend "0"). So a Walmart line like
    "GV TWO PCT 1G 007342000011 3.27" — that "007342000011" IS
    the barcode (NOT a SKU to skip). Same for similar-shaped
    runs starting with "00".

    Examples of what to extract:
      - "MILK 2% GAL  0070038000563  4.29"      → barcode:"0070038000563"
      - "TOSTITOS SCOOPS 028400647465 4.99"     → barcode:"028400647465"
      - "041287305201 EGGS LG 18CT 6.53"        → barcode:"041287305201"
      - "GV 2% MILK 007342000011 3.27"          → barcode:"007342000011"  (Walmart-shifted form, still a barcode)
      - "BANANAS 2.14 LB @ .59  1.26"           → barcode:null  (no UPC printed; produce sold by weight)

    Examples of what NOT to extract:
      - 4-6 digit PLU codes on produce ("#4011 BANANAS") → null
      - register/dept/cashier numbers in the receipt header → null
      - prices, weights, dates, phone numbers → null

    When a line clearly has no UPC printed (produce sold by weight,
    deli items priced by weight, generic short codes), barcode = null.
    Better to return null than to invent digits.

  * brand: the manufacturer label, canonicalized to its full brand
    name, only when you recognize a brand abbreviation in rawText.
    Receipts abbreviate aggressively — the brand almost never appears
    spelled out. Common ones:
      - GV / GRT VALUE     → "Great Value"       (Walmart)
      - KRK / KIRKLND      → "Kirkland"          (Costco)
      - TJ / TRDR JOE      → "Trader Joe's"
      - 365                → "365"               (Whole Foods)
      - OM / OSCR MYR      → "Oscar Mayer"
      - KG                 → "Kerrygold"
      - HZ / HNZ           → "Heinz"
      - TYSN               → "Tyson"
      - PRDE               → "Perdue"
      - BTRBLL             → "Butterball"
      - PHLLY / PHIL       → "Philadelphia"
      - CHOB               → "Chobani"
      - HELL / HLMN        → "Hellmann's"
      - HUY FNG            → "Huy Fong"
      - CHOL               → "Cholula"
      - BRLLA              → "Barilla"
    Set brand = null unless you are confident. Do NOT invent brands
    from cut / state / pack-size tokens — "STRP STK" is a cut, not a
    brand. "SHRD" is a state, not a brand. When in doubt, null.

  * confidence: "high" | "medium" | "low" — your self-rating of the
    match.  Be honest — medium/low values are features, not failures.
      - high:   unambiguous (e.g. "MILK 2% GAL" → milk)
      - medium: reasonable but not certain (e.g. "SHREDDED MOZZ" →
        mozzarella; cheese could be pre-grated or fresh)
      - low:    cryptic abbreviation, unclear category, or OCR noise.
        canonicalId MUST be null on low confidence.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Unit selection (same rules as before — never "count" for mass-priced
items):
  - Cheese → "oz" or "lb", NEVER "count"
  - Liquid dairy / juice (🥛 🧃) → "gallon", "half_gallon", "quart",
    "pint", "fl_oz" — use container size if shown
  - Yogurt / sour cream / cottage cheese → "oz" or "tub"
  - Meat / fish / poultry → "lb" or "oz", NEVER "count"
    (exception: receipt literally says "4 CT" / "2 PACK")
  - Deli meats → "oz" or "slice"
  - Bread / baguette / bagel → "loaf" or "slice"
  - Rice / grains / flour / sugar → "lb" or "bag"
  - Canned goods → "can"
  - Condiments / sauces in jars/bottles → "jar" or "bottle"
  - Fresh produce individually sold → "count" IS fine
  - Fresh produce sold by weight → "lb"

  "count" is a LAST RESORT for obscure items with no better fit.

CRITICAL: the big number next to an item is almost always the PRICE
in USD ($6.53, $3.99), NOT the quantity. Do NOT put the price in the
amount field. If the receipt doesn't clearly show a quantity, use 1.

QUANTITY MULTIPLIER — the user may have bought MULTIPLE of the same
item on a single receipt line. Receipts print this as:

  - "3 @ 1.99"        (3 units, $1.99 each)
  - "2 PACK MARINARA" (a 2-pack — qty=2)
  - "MARINARA QTY 3"  (explicit count column)
  - a leading "3 " or "2x" before the item name

When you see ANY of these multiplier patterns, set:
  qty: <the multiplier number>     (default 1 if no multiplier)

The 'amount' field is the PACKAGE SIZE (16 oz, 1 gallon), not the
multiplier. They are different fields. A "3 @ 16oz Marinara $5.97"
line should return amount:16, unit:"oz", qty:3, priceCents:597.

If the line doesn't show a multiplier, qty=1 (one of this package).

Reading examples (showing the two-name shape + brand axis):
  - "MILK 2% GAL 4.29"      → rawText:"MILK 2% GAL",      name:"2% Milk",        canonicalId:"milk",   brand:null,          confidence:"high"
  - "EGGS LG 18CT 6.53"     → rawText:"EGGS LG 18CT",     name:"Large Eggs",     canonicalId:"eggs",   brand:null,          confidence:"high"
  - "BANANAS 2.14 LB @ .59" → rawText:"BANANAS",          name:"Bananas",        canonicalId:"bananas",brand:null,          confidence:"high"
  - "NY STRIP 1.10 LB 15.67"→ rawText:"NY STRIP",         name:"NY Strip Steak", canonicalId:"beef",   brand:null,          confidence:"high"
  - "BUTTER QTRS 4.99"      → rawText:"BUTTER QTRS",      name:"Butter Quarters",canonicalId:"butter", brand:null,          confidence:"high"
  - "SHRD MOZZ 8OZ 3.49"    → rawText:"SHRD MOZZ 8OZ",    name:"Shredded Mozzarella",canonicalId:"mozzarella",brand:null,    confidence:"medium"
  - "GV GRN BNS 14OZ 1.29"  → rawText:"GV GRN BNS 14OZ",  name:"Green Beans",    canonicalId:"green_beans",brand:"Great Value",confidence:"high"
  - "KG UNSLT BTR 5.49"     → rawText:"KG UNSLT BTR",     name:"Unsalted Butter",canonicalId:"butter", brand:"Kerrygold",   confidence:"high"
  - "KRK PPR TWLS 18CT"     → rawText:"KRK PPR TWLS 18CT",name:"Paper Towels",   canonicalId:null,     brand:"Kirkland",    confidence:"medium"
  - "TJ MARINARA 2.99"      → rawText:"TJ MARINARA",      name:"Marinara",       canonicalId:"marinara",brand:"Trader Joe's",confidence:"high"
  - "OM BACON 16OZ 6.49"    → rawText:"OM BACON 16OZ",    name:"Bacon",          canonicalId:"bacon",  brand:"Oscar Mayer", confidence:"high"
  - "ACQUAMAR FLA 3.99"     → rawText:"ACQUAMAR FLA",     name:"ACQUAMAR FLA",   canonicalId:null,     brand:null,          confidence:"low"
  - "FRANK CHS DOG 2.49"    → rawText:"FRANK CHS DOG",    name:"FRANK CHS DOG",  canonicalId:null,     brand:null,          confidence:"low"
  - "GNDBF 80/20 5.79"      → rawText:"GNDBF 80/20",      name:"Ground Beef 80/20",canonicalId:"ground_beef",brand:null,     confidence:"medium"

Categories (for canonicalId=null items): dairy, produce, dry, meat, pantry, frozen

Canonical ingredient registry:
${registry}

For every item also include:
  - priceCents: the USD price shown next to it, in integer cents. "4.29" →
    429. If a price isn't legible, use null.

Additionally, look at the receipt header / footer and return metadata:
  - store:    the store name if visible; null if not.
  - date:     transaction date in YYYY-MM-DD if visible; null if not.
  - totalCents: receipt TOTAL in integer cents; null if not.

Return ONLY a JSON object — no markdown fences, no prose — with this shape:

{
  "store": "Trader Joe's" | null,
  "date": "2026-04-14" | null,
  "totalCents": 4523 | null,
  "items": [
    {"rawText":"MILK 2% GAL","name":"2% Milk","canonicalId":"milk","barcode":"0070038000563","brand":null,"emoji":"🥛","amount":1,"unit":"gallon","qty":1,"category":"dairy","priceCents":429,"confidence":"high"},
    {"rawText":"GV GRN BNS 14OZ","name":"Green Beans","canonicalId":"green_beans","barcode":null,"brand":"Great Value","emoji":"🫛","amount":14,"unit":"oz","qty":1,"category":"pantry","priceCents":129,"confidence":"high"},
    {"rawText":"3 @ MARINARA 16OZ","name":"Marinara","canonicalId":"marinara","barcode":null,"brand":null,"emoji":"🍝","amount":16,"unit":"oz","qty":3,"category":"pantry","priceCents":597,"confidence":"high"},
    {"rawText":"ACQUAMAR FLA","name":"ACQUAMAR FLA","canonicalId":null,"barcode":null,"brand":null,"emoji":"🥫","amount":1,"unit":"count","qty":1,"category":"pantry","priceCents":399,"confidence":"low"}
  ]
}

EVERY item must include the "barcode" field — set it to null when
no UPC/EAN-shaped digit string appears on that line, never omit it.

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
        // 4000 tokens — the prompt now asks for rawText + name per item
        // (roughly double the per-item payload), so a full-length
        // grocery receipt (25-40 items) needs more headroom. Old cap
        // was 2000, which truncated mid-JSON on longer receipts and
        // surfaced as "couldn't parse model output as JSON" → 502.
        max_tokens: 4000,
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
