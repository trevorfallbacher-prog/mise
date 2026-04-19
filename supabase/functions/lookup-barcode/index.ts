// Supabase Edge Function: lookup-barcode
//
// Proxy + mapper over the Open Food Facts public API
// (https://world.openfoodfacts.org/api/v2/product/{barcode}.json).
// Called by BarcodeScanner when the user scans a UPC/EAN; returns
// the product's nutrition mapped into our canonical shape along with
// display metadata (brand, product name, category hints) so the
// client can prefill the add-pantry-item form and bind to a
// canonical_id. The client owns the write to `brand_nutrition` —
// this function is stateless, just fetches and maps.
//
// Why not write here? Two reasons:
//   1. brand_nutrition's PK requires canonical_id, which the user
//      must confirm (OFF's categories are soft hints, not a 1:1 map
//      to ingredients.js). Forcing the binding server-side would
//      either pick the wrong canonical or gate on extra round trips.
//   2. brand_nutrition writes go through useBrandNutrition.upsert
//      on the client so the realtime cache stays consistent across
//      tabs. One write path = one source of truth.
//
// Request body:
//   { barcode: string }
//
// Response (hit):
//   {
//     found:       true,
//     barcode:     string,
//     brand:       string | null,       // first brand from OFF, display casing
//     productName: string | null,
//     categoryHints: string[],          // from OFF categories_tags, stripped
//     nutrition:   {
//       per:        "100g" | "serving",
//       kcal, protein_g, fat_g, carb_g,
//       fiber_g?, sodium_mg?, sugar_g?, serving_g?
//     },
//     source:      "openfoodfacts",
//     sourceId:    string | null,       // OFF product id (same as barcode, here for audit)
//     offUrl:      string               // deep link back to the OFF product page
//   }
//
// Response (miss):
//   { found: false, barcode, reason: "off_not_found" | "no_nutriments" }
//
// Errors: non-2xx with { error: string }.
//
// Deploy:
//   supabase functions deploy lookup-barcode

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Open Food Facts asks callers to identify themselves with a UA that
// includes a contact path. Non-blocking if omitted, but sets us up as
// a good citizen and lets OFF reach out if our traffic ever spikes.
const OFF_USER_AGENT = "mise-app/0.13 (nutrition-lookup; +https://github.com/trevorfallbacher-prog/mise)";

// Barcode must be digits only, 8-14 chars (UPC-E=8, EAN-8=8,
// UPC-A=12, EAN-13=13, ITF-14=14). Tight validation keeps us from
// forwarding user-typed garbage to OFF and cluttering their logs.
function isValidBarcode(v: unknown): v is string {
  return typeof v === "string" && /^\d{8,14}$/.test(v);
}

// Map OFF's sparse nutriments block into our shape. OFF keys vary —
// some products only ship per-serving numbers, some only per-100g,
// many ship both. Prefer per-100g because it composes cleanly into
// recipe rollups; fall back to per-serving when that's all we have.
function mapNutrition(
  nutriments: Record<string, unknown>,
  servingSizeStr: string | null,
): Record<string, unknown> | null {
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const kcal100 = num(nutriments["energy-kcal_100g"]);
  const kcalSrv = num(nutriments["energy-kcal_serving"]);

  // Decide per. Per-100g is the default; fall back to per-serving
  // only when no _100g data exists AND we have serving_g to scale.
  const servingG = parseServingGrams(servingSizeStr);
  const have100g = kcal100 != null;
  const haveSrv  = kcalSrv != null && servingG != null;

  let per: "100g" | "serving" | null = null;
  if (have100g) per = "100g";
  else if (haveSrv) per = "serving";
  if (!per) return null;

  const pick = (key100: string, keySrv: string): number | undefined => {
    return per === "100g" ? num(nutriments[key100]) : num(nutriments[keySrv]);
  };

  const kcal      = pick("energy-kcal_100g",  "energy-kcal_serving");
  const protein_g = pick("proteins_100g",     "proteins_serving");
  const fat_g     = pick("fat_100g",          "fat_serving");
  const carb_g    = pick("carbohydrates_100g","carbohydrates_serving");
  const fiber_g   = pick("fiber_100g",        "fiber_serving");
  const sugar_g   = pick("sugars_100g",       "sugars_serving");
  const sodium_g  = pick("sodium_100g",       "sodium_serving");

  // Require at least one of the big-four macros, else the row is
  // effectively empty (some OFF entries only carry energy; we keep
  // those and set missing macros to null rather than inventing zeros).
  if (kcal == null && protein_g == null && fat_g == null && carb_g == null) {
    return null;
  }

  const out: Record<string, unknown> = { per };
  if (kcal      != null) out.kcal      = round(kcal);
  if (protein_g != null) out.protein_g = round(protein_g);
  if (fat_g     != null) out.fat_g     = round(fat_g);
  if (carb_g    != null) out.carb_g    = round(carb_g);
  if (fiber_g   != null) out.fiber_g   = round(fiber_g);
  if (sugar_g   != null) out.sugar_g   = round(sugar_g);
  // OFF ships sodium in GRAMS; our schema uses mg. Converting here
  // keeps the UI's mg-labeled field accurate without a second pass.
  if (sodium_g  != null) out.sodium_mg = round(sodium_g * 1000);
  if (per === "serving" && servingG != null) out.serving_g = servingG;

  return out;
}

// "40 g" / "45g" / "1 piece (40g)" / "30 ml" → 40 or null.
// Only returns a grams value; ml / fluid ounces are ignored (we
// can't safely scale liquids without a density, and the recipe
// rollup already handles liquid canonicals via their own ladder).
function parseServingGrams(raw: string | null): number | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  // First try a trailing "(NN g)" — OFF often duplicates the gram
  // value in parens after a serving count.
  const parenMatch = raw.match(/\((\d+(?:\.\d+)?)\s*g\)/i);
  if (parenMatch) {
    const n = Number(parenMatch[1]);
    if (Number.isFinite(n) && n > 0) return round(n);
  }
  const m = raw.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? round(n) : undefined;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// OFF tags land as "en:chocolate-spreads", "en:breakfast-cereals", etc.
// Strip the language prefix and return the tag body so the client can
// suggest a canonical binding. Cap at 8 hints — the client only uses
// the first couple.
function categoryHints(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return (tags as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^[a-z]{2}:/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

// "Ferrero, Nutella" → "Ferrero" (first brand wins; OFF lists them
// comma-separated with the manufacturer first). Empty string → null.
function firstBrand(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const first = raw.split(",")[0]?.trim();
  return first ? first : null;
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

  let body: { barcode?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const barcode = body?.barcode?.trim?.() || "";
  if (!isValidBarcode(barcode)) {
    return new Response(
      JSON.stringify({ error: "barcode must be 8-14 digits" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // Hit Open Food Facts v2. The `product.json` endpoint returns
  // `status: 1` on hit with a `product` block, `status: 0` on miss.
  let offResp: Response;
  try {
    offResp = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
      { headers: { "User-Agent": OFF_USER_AGENT } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `open food facts fetch failed: ${String(err)}` }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (!offResp.ok) {
    // OFF occasionally 5xxs under load; treat any non-2xx as a
    // transient miss rather than a client error — the client can
    // retry or fall back to manual entry.
    return new Response(
      JSON.stringify({ found: false, barcode, reason: "off_unavailable" }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  const data = await offResp.json().catch(() => null) as Record<string, unknown> | null;
  if (!data || data.status !== 1 || !data.product || typeof data.product !== "object") {
    return new Response(
      JSON.stringify({ found: false, barcode, reason: "off_not_found" }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  const product = data.product as Record<string, unknown>;
  const nutriments = (product.nutriments || {}) as Record<string, unknown>;
  const servingSize = typeof product.serving_size === "string" ? product.serving_size : null;
  const nutrition = mapNutrition(nutriments, servingSize);

  if (!nutrition) {
    return new Response(
      JSON.stringify({ found: false, barcode, reason: "no_nutriments" }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  const payload = {
    found:         true,
    barcode,
    brand:         firstBrand(product.brands),
    productName:   (typeof product.product_name === "string" && product.product_name.trim()) ||
                   (typeof product.generic_name === "string" && product.generic_name.trim()) ||
                   null,
    categoryHints: categoryHints(product.categories_tags),
    nutrition,
    source:        "openfoodfacts",
    sourceId:      typeof data.code === "string" ? data.code : barcode,
    offUrl:        `https://world.openfoodfacts.org/product/${barcode}`,
  };

  return new Response(JSON.stringify(payload), { status: 200, headers: JSON_HEADERS });
});
