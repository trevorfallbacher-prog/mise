// Supabase Edge Function: categorize-product-photo
//
// The "memory book" categorizer. Fires when a UPC scan misses every
// resolution tier (no OFF data, no prior correction, no learned tag,
// no fuzzy hit). The user takes a photo of the front of the package,
// we send it to Claude Haiku 4.5 with a structured-extraction prompt,
// and return the axes the resolver couldn't fill in:
//
//   - brand
//   - productName (as printed on the package, lightly cleaned)
//   - suggestedCanonicalName (the common-noun the product reduces to)
//   - category (food family — "pantry"/"dairy"/"meat"/"produce"/"beverage"/"frozen")
//   - state (physical form — sliced/ground/cubed/loaf/etc.)
//   - claims (sub-line markers like "Original", "Scoops", "Zero Sugar")
//   - packageSize (amount + unit, parsed from the label)
//   - confidence ("high" | "medium" | "low")
//
// Companion: scan-nutrition-label edge fn handles the nutrition-panel
// photo separately. Caller stitches both results into one draft row.
//
// Cost: ~$0.001/call on Haiku 4.5 vision. We don't cache server-side
// because the client is responsible for writing the result into
// barcode_identity_corrections via rememberBarcodeCorrection — the
// next scan of the same UPC reads from memory and never reaches us.
//
// Deploy:
//   supabase functions deploy categorize-product-photo
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
//
// Request body:
//   {
//     image:           "<base64 string, no data: prefix>",
//     mediaType:       "image/jpeg" | "image/png" | "image/webp",
//     barcodeUpc?:     "<digits>",            // optional, for telemetry
//     offCategoryHints?: ["en:colas", ...],   // optional, biases the prompt
//   }
//
// Response (success — registry hit):
//   {
//     found: true,
//     brand:             "Pepsi",
//     productName:       "Pepsi Zero Sugar Cola",
//     canonicalId:       "soda",            // picked from CANONICALS
//     newCanonicalName:  null,
//     bindConfidence:    "exact",           // "exact" | "stripped" | "guessed"
//     category:          "beverage",
//     state:             null,
//     claims:            ["Zero Sugar"],    // flavor / variant words stripped from the canonical
//     packageSize:       { amount: 12, unit: "fl_oz" },
//     confidence:        "high"             // photo-read confidence (Haiku self-rated)
//   }
//
// Response (success — genuinely novel product, no registry fit):
//   {
//     found: true,
//     brand:             null,
//     productName:       "Caramel Dip",
//     canonicalId:       null,
//     newCanonicalName:  "Caramel Dip",     // client synthesizes user-tier slug
//     bindConfidence:    "guessed",
//     ...
//   }
//
// Response (miss — Haiku couldn't read the photo):
//   { found: false, reason: "unreadable" | "not_a_product" | "blank" }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { CANONICALS } from "./canonicals.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Haiku 4.5 vision — categorization is a structured-extraction task,
// not a precision-digit task like decode-barcode-image. Haiku's faster
// + cheaper and well-suited for "read the obvious labels off a
// package." Falls back to Sonnet only if the user reports persistent
// misclassifications in production.
const MODEL = "claude-haiku-4-5-20251001";

// CANONICAL_LIST — flat, token-efficient view of the registry passed
// inside the system prompt. Format: "<id> | <name>" one per line, so
// Haiku can grep against it with minimal token spend. Cached at module
// load (the edge fn process is reused across invocations within an
// instance), and embedded in the prompt that itself uses ephemeral
// cache_control — so the steady-state cost is ~10% of the full token
// count after the first call.
const CANONICAL_LIST = CANONICALS
  .map(c => `${c.id} | ${c.name}${c.shortName ? ` (${c.shortName})` : ""}${c.category ? ` [${c.category}]` : ""}`)
  .join("\n");

const SYSTEM_PROMPT = `You are reading the FRONT of a grocery product package and extracting the identity axes a pantry-tracking app needs.

Return ONE JSON object, nothing else. No prose, no markdown fences.

Schema:
{
  "brand":            string | null,    // Manufacturer / shelf brand. "Pepsi", "Chobani", "Kerrygold". null if unbranded / store-brand opaque.
  "productName":      string | null,    // Full product name as printed. "Pepsi Zero Sugar Cola", "Strawberry Greek Yogurt". Light cleanup OK; do not re-write.
  "canonicalId":      string | null,    // MUST be an id from CANONICALS below, OR null if no entry fits even loosely.
  "newCanonicalName": string | null,    // ONLY when canonicalId is null. Propose the bare common noun the product reduces to. Title-case ("Caramel Dip"). Stem only — no flavors, no variants, no brand.
  "category":         "pantry" | "dairy" | "meat" | "produce" | "beverage" | "frozen" | null,
  "state":            string | null,    // Physical form. "sliced" | "ground" | "cubed" | "loaf" | "shredded" | "whole" etc. null when not applicable.
  "claims":           string[],         // Flavor / variant / sub-line words YOU STRIPPED to land on the canonical. "Buffalo", "Honey Mustard", "Zero Sugar", "Original", "Extra Virgin". Capitalized as printed.
  "packageSize":      { "amount": number, "unit": string } | null,    // unit one of: g, kg, oz, lb, ml, l, fl_oz, count, ct, pk, pack
  "confidence":       "high" | "medium" | "low",
  "error":            null | "unreadable" | "not_a_product" | "blank"
}

CANONICAL PICK — the load-bearing rule:

You will receive a list of canonicals below (CANONICALS). Your job is to REDUCE the product on the package to its bare common noun (the "stem") and pick the matching id. Modifiers that decorate the stem (flavors, variants, claims) belong in \`claims\`, NOT in the canonical.

The reduction test: "Could a \`<canonical>\` reasonably exist with multiple flavor variants?" If yes, the modifier is a CLAIM and the broader noun is the canonical.

GOOD reductions (modifier moved to claims):
  "Buffalo Beef Stick with Honey Mustard"  → canonicalId: "beef_stick",     claims: ["Buffalo", "Honey Mustard"]
  "Strawberry Greek Yogurt"                → canonicalId: "greek_yogurt",   claims: ["Strawberry"]
  "Honey Mustard Pretzels"                 → canonicalId: "pretzels",       claims: ["Honey Mustard"]
  "Tostitos Scoops Original Tortilla Chips"→ canonicalId: "tortilla_chips", claims: ["Scoops", "Original"]
  "Pepsi Zero Sugar Cola"                  → canonicalId: "soda",           claims: ["Zero Sugar"]
  "Lightly Salted Roasted Almonds"         → canonicalId: "almonds",        claims: ["Lightly Salted", "Roasted"]

KEEP the modifier IN the canonical when it defines a DISTINCT KIND of thing rather than a flavor of an existing thing:
  "Greek Yogurt"   → canonicalId: "greek_yogurt"   (Greek is the style, not a flavor of yogurt)
  "Brown Sugar"   → canonicalId: "brown_sugar"   (different sweetener, not a flavor of sugar)
  "Coconut Milk"  → canonicalId: "coconut_milk"  (different category, not a flavor of milk)

PROPOSE A NEW canonical (canonicalId: null, newCanonicalName: "...") ONLY when no list entry fits even after reduction. The proposal MUST be the stem only — no flavors, no claim words.
  "Caramel Dip"               → canonicalId: null, newCanonicalName: "Caramel Dip"
  "Marshmallow Fluff"         → canonicalId: null, newCanonicalName: "Marshmallow Fluff"
  "Buffalo Bison Jerky Bites" → canonicalId: null, newCanonicalName: "Bison Jerky", claims: ["Buffalo", "Bites"]   // strip even when going to a new canonical

When unsure, prefer the BROADER list entry plus a claim. Merging two near-duplicate slugs later is harder than splitting them.

Other rules:

  1. Read what's on the package — don't guess. If the brand isn't visible, return null.
  2. category reflects where the product belongs in a kitchen, NOT what aisle. Frozen peas → "frozen", sealed yogurt → "dairy", bottle of soda → "beverage", jar of tomato sauce → "pantry".
  3. state — only set when the package shows a physical-form modifier ("Sliced", "Ground", "Crumbled", "Loaf", "Whole"). Otherwise null.
  4. claims — flavor / variant / sub-line words. Skip generic marketing ("Authentic", "Premium", "Fresh", "Crafted"). Keep specific descriptors ("Scoops", "Original", "Zero Sugar", "Extra Virgin", "Sea Salt", "Buffalo", "Honey Mustard").
  5. packageSize — read the printed weight/volume/count. Multipack ("12 x 12 fl oz") returns the per-unit if obvious, otherwise the total. Prefer fl_oz / oz / g / ml; "ct" for discrete counts.
  6. confidence:
       high   = brand + canonical both unambiguous
       medium = one axis clear, the other inferred
       low    = blurry, only partial visibility, or non-grocery item
  7. If the photo isn't a packaged product (loose produce, raw meat, a receipt, a person, a pet), return { "error": "not_a_product" }.
  8. If the photo is too blurry / cut off / dark to read, return { "error": "unreadable" }.
  9. If the photo is blank or black, return { "error": "blank" }.

When categoryHints are provided, treat them as a STRONG bias — Open Food Facts already classified this product. Use them to disambiguate when the image alone is ambiguous.

CANONICALS (id | display name):
${CANONICAL_LIST}`;

interface ParsedResponse {
  brand?: unknown;
  productName?: unknown;
  canonicalId?: unknown;
  newCanonicalName?: unknown;
  category?: unknown;
  state?: unknown;
  claims?: unknown;
  packageSize?: unknown;
  confidence?: unknown;
  error?: unknown;
}

// Set of valid canonical ids — used to validate Haiku's pick. If it
// returns an id that isn't in the registry, we treat it as a freshly
// proposed canonical (move the value to newCanonicalName) rather than
// passing a phantom id forward.
const CANONICAL_IDS = new Set(CANONICALS.map(c => c.id));

// Common flavor / variant adjectives that often slip into AI's
// `newCanonicalName` even after the prompt's reduction rule. The
// stripper tries removing each leading token; if the trimmed name
// matches an existing canonical, we bind to that and append the
// stripped token to claims. Order matters — longer / more specific
// terms first so "honey mustard" wins over "honey".
const FLAVOR_PREFIXES = [
  "honey mustard", "buffalo", "honey", "spicy", "sweet", "salted",
  "smoked", "roasted", "toasted", "lightly salted", "sea salt",
  "original", "classic", "extra", "extra virgin", "zero sugar",
  "sugar free", "fat free", "low fat", "low sodium", "low carb",
  "hot", "mild", "crispy", "crunchy", "creamy", "double", "mini",
  "jumbo", "family", "cracked",
];

function stripFlavorAndBind(rawName: string): { canonicalId: string | null; stripped: string[]; remainingName: string } {
  const stripped: string[] = [];
  let working = rawName.trim();
  // Try direct hit on the registry first by name (case-insensitive).
  const directHit = CANONICALS.find(c =>
    c.name.toLowerCase() === working.toLowerCase()
    || (c.shortName && c.shortName.toLowerCase() === working.toLowerCase())
  );
  if (directHit) return { canonicalId: directHit.id, stripped, remainingName: directHit.name };

  // Iteratively strip leading flavor tokens. Stop when nothing strips
  // OR the result hits the registry. Bounded loop so a malformed AI
  // response can't loop forever.
  for (let i = 0; i < 4; i++) {
    const lower = working.toLowerCase();
    let didStrip = false;
    for (const prefix of FLAVOR_PREFIXES) {
      if (lower.startsWith(prefix + " ")) {
        stripped.push(prefix.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "));
        working = working.slice(prefix.length + 1).trim();
        didStrip = true;
        break;
      }
    }
    if (!didStrip) break;
    const hit = CANONICALS.find(c =>
      c.name.toLowerCase() === working.toLowerCase()
      || (c.shortName && c.shortName.toLowerCase() === working.toLowerCase())
    );
    if (hit) return { canonicalId: hit.id, stripped, remainingName: hit.name };
  }

  return { canonicalId: null, stripped, remainingName: working };
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = asString(x);
    if (s) out.push(s);
    if (out.length >= 5) break;
  }
  return out;
}

const ALLOWED_CATEGORY = new Set(["pantry", "dairy", "meat", "produce", "beverage", "frozen"]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium", "low"]);
const ALLOWED_UNITS = new Set([
  "g", "kg", "oz", "lb", "ml", "l", "fl_oz",
  "count", "ct", "pk", "pack",
]);
const ALLOWED_ERROR = new Set(["unreadable", "not_a_product", "blank"]);

function asCategory(v: unknown): string | null {
  const s = asString(v);
  return s && ALLOWED_CATEGORY.has(s) ? s : null;
}

function asConfidence(v: unknown): "high" | "medium" | "low" {
  const s = asString(v);
  return s && ALLOWED_CONFIDENCE.has(s) ? (s as "high" | "medium" | "low") : "low";
}

function asPackageSize(v: unknown): { amount: number; unit: string } | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as { amount?: unknown; unit?: unknown };
  const amount = typeof obj.amount === "number" && Number.isFinite(obj.amount) && obj.amount > 0
    ? obj.amount
    : null;
  const unit = asString(obj.unit);
  if (amount == null || !unit || !ALLOWED_UNITS.has(unit)) return null;
  return { amount, unit };
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

  let body: {
    image?: string;
    mediaType?: string;
    barcodeUpc?: string;
    offCategoryHints?: string[];
  };
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

  const userText: string[] = [];
  if (body.barcodeUpc) {
    userText.push(`Barcode: ${String(body.barcodeUpc).slice(0, 14)}`);
  }
  if (Array.isArray(body.offCategoryHints) && body.offCategoryHints.length > 0) {
    const hints = body.offCategoryHints
      .filter((t) => typeof t === "string")
      .slice(0, 12)
      .join(", ");
    if (hints) userText.push(`OFF categoryHints: ${hints}`);
  }
  userText.push("Read the package and return the JSON.");

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
        max_tokens: 600,
        // Cache the system prompt — same prompt on every call.
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
              { type: "text",  text: userText.join("\n") },
            ],
          },
          // Prefill so Haiku continues straight from "{".
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
  const raw = "{" + (data?.content?.[0]?.text ?? "");
  const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();

  let parsed: ParsedResponse;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return new Response(
      JSON.stringify({ found: false, reason: "unreadable" }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  // Error path — Haiku told us it couldn't read the photo.
  if (typeof parsed.error === "string" && parsed.error) {
    const reason = ALLOWED_ERROR.has(parsed.error) ? parsed.error : "unreadable";
    return new Response(
      JSON.stringify({ found: false, reason }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  // Success path — resolve the canonical pick through three tiers:
  //
  //   1. Haiku returned a valid id from CANONICALS → bind exact.
  //   2. Haiku returned a phantom id (or invented one) → demote to a
  //      newCanonicalName proposal, run the flavor-prefix stripper to
  //      catch obvious cheats ("Buffalo Beef Stick" → bind beef_stick
  //      with claims: ["Buffalo"]), promote to bind if strip succeeds.
  //   3. Stripper finds nothing → keep newCanonicalName as a
  //      "guessed" proposal the client synthesizes a slug from.
  //
  // Always returns `found: true` with a canonical the client can
  // pair to (either id-from-list or newCanonicalName); the only
  // "miss" surface left is the photo-read error path above.
  const aiBrand           = asString(parsed.brand);
  const aiProductName     = asString(parsed.productName);
  const aiCanonicalIdRaw  = asString(parsed.canonicalId);
  const aiNewCanonicalRaw = asString(parsed.newCanonicalName);
  const aiClaims          = asStringArray(parsed.claims);

  let canonicalId: string | null = null;
  let newCanonicalName: string | null = null;
  let bindConfidence: "exact" | "stripped" | "guessed" = "guessed";
  let extraClaims: string[] = [];

  if (aiCanonicalIdRaw && CANONICAL_IDS.has(aiCanonicalIdRaw)) {
    // Haiku picked a real id from the list.
    canonicalId    = aiCanonicalIdRaw;
    bindConfidence = "exact";
  } else {
    // Haiku either skipped the list or returned a phantom id. Try
    // the flavor stripper on whichever name AI surfaced (newCanonicalName
    // first, then productName as a last resort).
    const candidate = aiNewCanonicalRaw || aiProductName || "";
    if (candidate) {
      const strip = stripFlavorAndBind(candidate);
      if (strip.canonicalId) {
        canonicalId    = strip.canonicalId;
        bindConfidence = strip.stripped.length > 0 ? "stripped" : "exact";
        extraClaims    = strip.stripped;
      } else {
        newCanonicalName = strip.remainingName || candidate;
        bindConfidence   = "guessed";
      }
    }
  }

  // Merge stripper-extracted claims with AI's own claim list, dedup'd
  // case-insensitively so "Buffalo" doesn't appear twice.
  const mergedClaims = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...extraClaims, ...aiClaims]) {
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  })();

  return new Response(
    JSON.stringify({
      found:            true,
      brand:            aiBrand,
      productName:      aiProductName,
      canonicalId,
      newCanonicalName,
      bindConfidence,
      category:         asCategory(parsed.category),
      state:            asString(parsed.state),
      claims:           mergedClaims,
      packageSize:      asPackageSize(parsed.packageSize),
      confidence:       asConfidence(parsed.confidence),
    }),
    { status: 200, headers: JSON_HEADERS },
  );
});
