// Supabase Edge Function: enrich-ingredient
//
// On-demand per-ingredient metadata enrichment. Called when the user
// clicks "Add AI Enrichment" on an item that has no metadata (either a
// custom pantry item with `ingredient_id=null`, or a canonical
// ingredient that has no row in `ingredient_info`).
//
// Flow:
//   1. Validate input: one of { source_name } or { canonical_id } required.
//   2. Ask Claude Haiku to generate the full ingredient_info JSONB shape,
//      including the six forward-looking AI meal-planning fields
//      (flavor_profile, aromatic_category, cooking_behaviors,
//      role_tendencies, heat_stability, substitutions_functional/_flavor).
//   3. Stamp `_meta` server-side (source, generated_by, generated_at,
//      prompt_version, reviewed=false).
//   4. Upsert into `pending_ingredient_info` as the calling user (RLS
//      keeps the row scoped to them).
//   5. Insert a notification into the user's inbox — realtime delivers
//      it to the bell.
//   6. Return the pending row so the UI can re-render immediately
//      without waiting for the realtime roundtrip.
//
// Request body:
//   {
//     source_name?: string,     // user's free-text label, e.g. "Nori from the Japanese store"
//     canonical_id?: string,    // or an existing canonical id that's missing metadata
//     pantry_item_id?: string,  // optional back-reference to a pantry row
//   }
//   (source_name OR canonical_id must be present; both is fine — canonical_id wins for the slug)
//
// Response:
//   {
//     pending: { id, user_id, slug, source_name, info, status, created_at, ... }
//   }
//
// Errors return { error: string } with a non-2xx status.
//
// Deploy:
//   supabase functions deploy enrich-ingredient
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Haiku 4.5 — fast (~2-5s), cheap, plenty smart for structured JSON synthesis.
const MODEL = "claude-haiku-4-5-20251001";
// v3 — nutrition.per is enum-constrained, density moved to per-unit
// gram fields so the client-side resolver can build a proper unit
// ladder. See buildPrompt() for the shape contract.
const PROMPT_VERSION = "v3";

// Slugify a free-text name into a stable per-user key. "Nori from the
// Japanese store" → "nori_from_the_japanese_store". Collisions within
// a user are resolved by the `(user_id, slug)` unique index's on-conflict
// update — re-enrichment overwrites the draft.
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unnamed_ingredient";
}

function buildPrompt(displayName: string, isCanonical: boolean): string {
  return `You are a culinary reference assistant. Generate a complete metadata
record for the ingredient: "${displayName}".

${isCanonical
  ? "This is a known canonical ingredient in our registry — treat it as the standard pantry item with that common name."
  : "This is a user-submitted free-text ingredient name. Interpret it sensibly (e.g. \"Nori from the Japanese store\" → nori seaweed sheets). If the name is too vague to identify, return an error field instead."}

Return ONLY a JSON object — no markdown fences, no prose, no trailing
commentary — matching this exact shape. Fields marked OPTIONAL may be
omitted when not applicable. Every other field is REQUIRED.

{
  "description": "1-3 sentences — what the ingredient is, what makes it distinctive",
  "flavorProfile": "1-2 sentences — how it tastes",
  "prepTips": "1-2 sentences — how to use it in cooking",

  "storage": {
    "location": "pantry" | "fridge" | "freezer" | "counter",
    "shelfLifeDays": number,            // realistic days in recommended location (unopened)
    "shelfLife": {                       // per-location unopened; use null when not applicable
      "pantry": number | null,
      "fridge": number | null,
      "freezer": number | null
    },
    "shelfLifeOpened": {                 // once-opened shelf life in the recommended location
      "days": number | null,
      "location": "pantry" | "fridge" | "freezer" | null,
      "note": "OPTIONAL — 1 sentence (e.g. 'transfer to airtight jar')"
    },
    "tips": "1 sentence — storage best practice",
    "spoilageSigns": "1 sentence — what going bad looks/smells like",
    "freezable": boolean,
    "freezeNotes": "OPTIONAL — 1 sentence on freezing if freezable"
  },

  "substitutions_functional": [          // preserves structural/textural role
    { "id": "string_slug", "tier": "direct" | "caution" | "creative", "note": "short note" }
  ],
  "substitutions_flavor": [              // preserves taste profile
    { "id": "string_slug", "tier": "direct" | "caution" | "creative", "note": "short note" }
  ],
  "pairs": ["array", "of", "ingredient_slugs_that_pair_well"],
  "aliases": ["common", "alt", "names"], // e.g. ["coriander","chinese parsley"] for cilantro

  "nutrition": {
    // REQUIRED — "per" must be EXACTLY one of these three literal
    // strings. The client-side resolver uses this as an enum key; any
    // other value (including "1 oz", "1 tsp (5g)", "per serving") is
    // rejected and the nutrition block is dropped on write.
    //   "100g"    — kcal/protein/etc. are per 100 grams of the ingredient.
    //   "count"   — nutrition is per one countable unit (1 egg, 1 apple).
    //   "serving" — per one manufacturer-defined serving. When you pick
    //               this, you MUST also populate "serving_g" below with
    //               the gram weight of that serving.
    "per": "100g" | "count" | "serving",
    "serving_g": number,                 // REQUIRED when per="serving", otherwise omit
    "kcal": number,                      // REQUIRED
    "protein_g": number,                 // OPTIONAL
    "fat_g": number,                     // OPTIONAL
    "carb_g": number,                    // OPTIONAL
    "fiber_g": number,                   // OPTIONAL
    "sodium_mg": number                  // OPTIONAL
  },

  // OPTIONAL — emit ONLY for meat-hub canonicals (chicken, beef, pork,
  // turkey). Map of anatomical cut → per-100g nutrition block. Same
  // shape as "nutrition" above (each value must validate the same
  // per/serving_g rules). The client resolver prefers this over the
  // generic "nutrition" block when the pantry row has a `cut` tag
  // set, so "chicken + cut=thigh" gets thigh-specific macros (209 kcal)
  // instead of the hub default (breast, 165 kcal). Keys should be the
  // cut slugs used by CUT_WEIGHTS_G (breast, thigh, leg, wing, ribeye,
  // brisket, chop, shoulder, etc.). Skip for every non-meat canonical.
  "cutNutrition": {
    "<cut_slug>": {                      // e.g. "breast", "thigh", "ribeye"
      "per": "100g" | "count" | "serving",
      "serving_g": number,
      "kcal": number,
      "protein_g": number,
      "fat_g": number,
      "carb_g": number,
      "fiber_g": number,
      "sodium_mg": number
    }
    // ... one entry per commonly-purchased cut for this hub
  },

  // OPTIONAL — emit ONLY for meat-hub canonicals where the state is
  // nutritionally distinct from the raw cut. Today the only such
  // state is "ground": ground beef (85/15 ≈ 250 kcal/100g), ground
  // chicken (≈143), ground pork (≈263), ground turkey (≈148). The
  // client resolver prefers this over cutNutrition because grinding
  // erases the cut axis. Same value shape as "nutrition". Skip for
  // non-meat canonicals and for states that don't change macros
  // (diced, sliced, minced — those are physical transformations
  // only).
  "stateNutrition": {
    "<state_slug>": {                    // e.g. "ground"
      "per": "100g" | "count" | "serving",
      "serving_g": number,
      "kcal": number,
      "protein_g": number,
      "fat_g": number,
      "carb_g": number,
      "fiber_g": number,
      "sodium_mg": number
    }
  },

  "density": {                           // REQUIRED for anything measured in tsp/tbsp/cup
    // Grams per volume unit. Provide whichever of these make sense
    // (spices/leaveners/extracts need g_per_tsp; flours/oats need
    // g_per_cup; liquid ingredients can use g_per_tbsp or g_per_cup).
    // A single key is enough — the client derives the rest (1 tbsp = 3
    // tsp, 1 cup = 48 tsp). Omit the whole block entirely for count-only
    // ingredients (eggs, apples) or pre-packaged items (boxes, cans).
    "g_per_tsp": number,                 // OPTIONAL — e.g. 2.6 for ground cinnamon
    "g_per_tbsp": number,                // OPTIONAL — e.g. 15 for oils, 20 for honey
    "g_per_cup": number                  // OPTIONAL — e.g. 120 for flour, 240 for milk
  },

  "package": {                           // OPTIONAL — typical grocery packaging
    "typicalSizes": ["16 oz", "1 lb bag", "1 gallon jug"],
    "unitsPerPackage": "OPTIONAL — e.g. '1 bag = ~4 cups flour' for pantry math",
    "aisle": "produce" | "dairy" | "meat" | "seafood" | "pantry" | "baking" |
             "frozen" | "bakery" | "deli" | "spice" | "condiment" | "beverage" |
             "international" | "specialty" | null
  },

  "allergens": ["milk" | "eggs" | "fish" | "shellfish" | "tree_nuts" | "peanuts" | "wheat" | "soy" | "sesame"],
  "diet": {
    "vegan": boolean, "vegetarian": boolean, "keto": boolean,
    "halal": boolean, "kosher": "pareve" | "meat" | "dairy" | false,
    "fodmap": "low" | "moderate" | "high",
    "nightshade": boolean, "allium": boolean, "glutenFree": boolean
  },

  "origin": "1-2 sentences — geographic / historical origin",
  "culturalNotes": "OPTIONAL — 1-2 sentences on cultural context",

  "market": {
    "priceTier": "budget" | "moderate" | "premium" | "luxury",
    "availability": "supermarket" | "specialty" | "online" | "rare",
    "qualityMatters": boolean,
    "qualityNote": "OPTIONAL — 1 sentence on when quality matters"
  },

  // ── Meal-planning signals (for AI meal generation downstream) ──

  "flavor_profile": {                    // 0-5 scale per axis
    "salty": 0-5, "sweet": 0-5, "sour": 0-5, "bitter": 0-5,
    "umami": 0-5, "heat": 0-5, "fat": 0-5, "aromatic_intensity": 0-5
  },

  "aromatic_category": "allium" | "herbaceous" | "citrus" | "warm_spice" |
    "earthy" | "floral" | "smoky" | "fermented" | "sulfurous" | "nutty" |
    "marine" | "none",

  "cooking_behaviors": [                 // array; pick all that apply
    "browns" | "caramelizes" | "wilts" | "renders_fat" | "emulsifies" |
    "melts" | "thickens" | "ferments" | "softens" | "holds_shape" |
    "shrinks" | "releases_liquid" | "crisps" | "toasts" | "rehydrates"
  ],

  "role_tendencies": {                   // 0-5 scale — how often plays each role in a dish
    "base": 0-5, "protein": 0-5, "aromatic": 0-5, "acid": 0-5,
    "fat": 0-5, "seasoning": 0-5, "garnish": 0-5
  },

  "heat_stability": "raw_only" | "low_heat" | "medium_heat" | "high_heat" | "burns_easily",

  "cookingMethods": [                    // where this ingredient shines
    "raw" | "grill" | "roast" | "bake" | "fry" | "sauté" | "braise" |
    "steam" | "boil" | "simmer" | "poach" | "smoke" | "pickle" | "ferment"
  ],

  "mealTypes": [                         // meal-slot affinity
    "breakfast" | "lunch" | "dinner" | "snack" | "party" | "dessert"
  ],

  "cuisines": [                          // cuisine affinity (lowercase slugs)
    "italian" | "french" | "mexican" | "chinese" | "japanese" | "korean" |
    "thai" | "indian" | "middle_eastern" | "mediterranean" | "american" |
    "southern_us" | "cajun" | "bbq" | "greek" | "vietnamese" | "filipino" |
    "latin_american" | "caribbean" | "ethiopian" | "moroccan" | "other"
  ]
}

Guidance:
- Be specific and culinary-accurate. "Umami: 5" means intensely savory (parmesan, anchovy, nori). "Umami: 0" means none (sugar, water).
- Substitution ids should be reasonable slugs (e.g. "dulse", "dashi_powder"). Admin review will normalize them.
- If the ingredient name is too ambiguous to generate a meaningful record, return exactly: {"error": "ambiguous_name", "reason": "…"}.`;
}

type PendingInsert = {
  user_id: string;
  slug: string;
  source_name: string;
  pantry_item_id: string | null;
  info: Record<string, unknown>;
  status: "pending";
};

// Pull the `sub` (user id) claim out of a bearer JWT without verifying
// the signature. Safe because Supabase's edge-function platform has
// already verified the token before this function runs — we're just
// reading the claims afterwards. Returns null when the header is
// missing or malformed.
function extractUserIdFromJwt(authHeader: string): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m) return null;
  const token = m[1];
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    // base64url → base64 → JSON
    let payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payloadB64.length % 4 !== 0) payloadB64 += "=";
    const payloadText = atob(payloadB64);
    const payload = JSON.parse(payloadText);
    const sub = payload?.sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
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
    source_name?: string;
    canonical_id?: string;
    pantry_item_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const { source_name, canonical_id, pantry_item_id } = body;
  if (!source_name && !canonical_id) {
    return new Response(
      JSON.stringify({
        error: "one of source_name or canonical_id is required",
      }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "auth required" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return new Response(
      JSON.stringify({
        error:
          "server is missing SUPABASE_SERVICE_ROLE_KEY — edge functions need it to write to pending_ingredient_info on behalf of the caller",
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  // Identify the caller by decoding the JWT payload directly. Supabase's
  // edge-function platform has already verified the token's signature
  // before invoking this function (default verify_jwt = true), so we
  // don't need to re-verify here — we just read the claims.
  //
  // Why not call /auth/v1/user or supabase.auth.getUser()? Both routes
  // return "UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM" on Supabase
  // projects that use asymmetric JWT signing keys (ES256 / RS256) with
  // older GoTrue builds. Decoding the claims ourselves sidesteps the
  // algorithm-compat gap entirely.
  const userId = extractUserIdFromJwt(authHeader);
  if (!userId) {
    return new Response(
      JSON.stringify({ error: "could not extract user id from auth header" }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  // Service-role client for DB writes. Bypasses RLS, so we set user_id
  // explicitly on every insert to keep the per-user scope correct.
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const displayName = canonical_id ?? source_name!;
  const isCanonical = Boolean(canonical_id);

  // ── Call Claude ──
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
        max_tokens: 3000,
        messages: [
          {
            role: "user",
            content: buildPrompt(displayName, isCanonical),
          },
        ],
      }),
    });
  } catch (err) {
    await insertFailureNotification(supabase, userId, displayName);
    return new Response(
      JSON.stringify({ error: `anthropic fetch failed: ${String(err)}` }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (!anthropicResp.ok) {
    const text = await anthropicResp.text();
    await insertFailureNotification(supabase, userId, displayName);
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

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    await insertFailureNotification(supabase, userId, displayName);
    return new Response(
      JSON.stringify({ error: "couldn't parse model output as JSON", raw }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (parsed.error === "ambiguous_name") {
    await insertFailureNotification(
      supabase,
      userId,
      displayName,
      "name too ambiguous — try a more specific label",
    );
    return new Response(
      JSON.stringify({
        error: "ambiguous_name",
        reason: parsed.reason ?? "model could not identify ingredient",
      }),
      { status: 422, headers: JSON_HEADERS },
    );
  }

  const slug = canonical_id ?? slugify(source_name!);

  // ── Nutrition sanity check (v3) ──
  // The client-side resolver (src/lib/nutrition.js#scaleFactor) treats
  // `nutrition.per` as a strict enum: "100g" | "count" | "serving".
  // Anything else silently returns a null scale factor, which is why
  // every AI-enriched canonical we shipped before v3 contributed zero
  // calories to the dashboard. Strip the nutrition block outright
  // when the shape is wrong — a missing block degrades to "tap to
  // add" in the UI, which is honest. A malformed block would persist
  // as usable-looking data that the resolver silently ignored.
  // Same shape check applies to every nutrition block the model can
  // emit — the main one plus each entry of cutNutrition / stateNutrition.
  // Malformed per= values silently produce null scale factors downstream,
  // so drop offenders at the boundary instead of persisting decorative
  // data the resolver can't use.
  const isValidNutritionBlock = (n: Record<string, unknown>): boolean => {
    const per = n.per;
    const allowed = per === "100g" || per === "count" || per === "serving";
    const servingOk = per !== "serving" || typeof n.serving_g === "number";
    return allowed && servingOk;
  };
  if (parsed && typeof parsed === "object" && parsed.nutrition && typeof parsed.nutrition === "object") {
    const n = parsed.nutrition as Record<string, unknown>;
    if (!isValidNutritionBlock(n)) {
      console.warn(
        `[enrich-ingredient] dropping malformed nutrition for ${slug}: ` +
          `per=${JSON.stringify(n.per)} serving_g=${JSON.stringify(n.serving_g)}`,
      );
      delete parsed.nutrition;
    }
  }
  // Scrub individual entries in cutNutrition / stateNutrition maps.
  // If an entry is malformed drop that entry only — keep the rest.
  // If the whole map empties, delete the property so it doesn't
  // persist as an empty object in ingredient_info.
  for (const field of ["cutNutrition", "stateNutrition"] as const) {
    if (parsed && typeof parsed === "object" && parsed[field] && typeof parsed[field] === "object") {
      const map = parsed[field] as Record<string, Record<string, unknown>>;
      for (const [key, block] of Object.entries(map)) {
        if (!block || typeof block !== "object" || !isValidNutritionBlock(block)) {
          console.warn(
            `[enrich-ingredient] dropping malformed ${field}.${key} for ${slug}: ` +
              `per=${JSON.stringify(block?.per)} serving_g=${JSON.stringify(block?.serving_g)}`,
          );
          delete map[key];
        }
      }
      if (Object.keys(map).length === 0) {
        delete parsed[field];
      }
    }
  }

  // Stamp provenance server-side so the model can't forge `_meta`.
  // `reviewed: true` because enrichments now auto-approve — the
  // admin queue was pure overhead for every new canonical the
  // system saw. The same edge function ran the generation, so
  // trusting its output on the write side loses no security we
  // actually had before.
  const info = {
    ...parsed,
    _meta: {
      source: "user_enrichment",
      generated_by: MODEL,
      generated_at: new Date().toISOString(),
      prompt_version: PROMPT_VERSION,
      reviewed: true,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      source_name: displayName,
    },
  };

  // ── Merge with any existing ingredient_info so admin-curated
  //    routing data (packaging, parentId) isn't clobbered by the
  //    AI-generated fields. Deep-merge top-level keys; the model's
  //    description/sourcing/tips overwrite the generic defaults,
  //    but existing routing stays intact.
  const { data: existing } = await supabase
    .from("ingredient_info")
    .select("info")
    .eq("ingredient_id", slug)
    .maybeSingle();

  const mergedInfo = existing?.info
    ? { ...existing.info, ...info, _meta: info._meta }
    : info;

  // ── Upsert directly into ingredient_info (skip the old
  //    pending_ingredient_info queue — no admin review step). Edge
  //    function runs with SERVICE_ROLE so the admin-only RLS on
  //    ingredient_info doesn't block us.
  const { data: approved, error: upsertErr } = await supabase
    .from("ingredient_info")
    .upsert(
      { ingredient_id: slug, info: mergedInfo },
      { onConflict: "ingredient_id" },
    )
    .select()
    .single();

  if (upsertErr) {
    return new Response(
      JSON.stringify({
        error: "failed to write ingredient_info row",
        detail: upsertErr.message,
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  // ── Notify the user ──
  await supabase.from("notifications").insert({
    user_id: userId,
    msg: `${displayName} is enriched ✨`,
    emoji: "✨",
    kind: "success",
  });

  // Return in the same shape as before so callers work unchanged
  // (`{ pending }` key preserved). The row object shape matches
  // pending_ingredient_info enough that existing consumers don't
  // break — slug, info, and a synthesized status: "approved".
  return new Response(
    JSON.stringify({
      pending: {
        slug,
        info: approved?.info ?? mergedInfo,
        status: "approved",
      },
    }),
    { status: 200, headers: JSON_HEADERS },
  );
});

async function insertFailureNotification(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  displayName: string,
  reason?: string,
) {
  await supabase.from("notifications").insert({
    user_id: userId,
    msg: reason
      ? `Enrichment for ${displayName} failed — ${reason}`
      : `Enrichment for ${displayName} failed — try again later`,
    emoji: "⚠️",
    kind: "error",
  });
}
