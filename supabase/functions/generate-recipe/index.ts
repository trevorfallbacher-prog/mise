// Supabase Edge Function: generate-recipe
//
// Drafts a recipe from the user's current pantry using Claude. Lives
// server-side so the Anthropic API key never ships to the browser. The
// returned JSON matches the bundled recipe schema at
// src/data/recipes/schema.js so CookMode can open it without any shape
// conversion.
//
// Deploy:
//   supabase functions deploy generate-recipe
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
//
// Called from the client via `supabase.functions.invoke("generate-recipe", …)`.
// JWT verification is handled by Supabase automatically.
//
// Request body:
//   {
//     pantry: [
//       { name, canonicalId?, amount?, unit?, category? },
//       ...
//     ],
//     prefs?: {
//       cuisine?:    "any" | "italian" | "french" | ...
//       difficulty?: "easy" | "medium" | "advanced"
//       time?:       "quick" | "medium" | "long"   (≤30 / ≤60 / any)
//       notes?:      free-text from the user ("spicy please", "no nuts")
//     },
//     avoidTitles?: string[]   // recent drafts the user has already seen —
//                              // makes REGEN actually produce something
//                              // different instead of the same dish back.
//   }
//
// Response:
//   { recipe: <schema.js shape> }
//
// Errors return { error, detail? } with a non-2xx status.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Haiku 4.5 — same model the rest of the app uses. Recipe drafting is
// well within its headroom; keeping everything on one model keeps
// behavior consistent.
const MODEL = "claude-haiku-4-5-20251001";

type PantryItem = {
  name?: string;
  canonicalId?: string;
  amount?: number;
  unit?: string;
  category?: string;
};

type Prefs = {
  cuisine?: string;
  difficulty?: string;
  time?: string;
  notes?: string;
};

function buildPrompt(pantry: PantryItem[], prefs: Prefs, avoidTitles: string[]): string {
  const pantryLines = pantry.length === 0
    ? "(pantry is empty — suggest something that needs only staples)"
    : pantry
        .map((p) => {
          const amount = p.amount != null ? `${p.amount}${p.unit || ""}` : "";
          const tail = [amount, p.canonicalId ? `id:${p.canonicalId}` : "",
            p.category || ""].filter(Boolean).join(" · ");
          return `- ${p.name || "unknown"}${tail ? ` (${tail})` : ""}`;
        })
        .join("\n");

  const prefLines = [
    prefs.cuisine && prefs.cuisine !== "any" ? `- cuisine: ${prefs.cuisine}` : "",
    prefs.difficulty ? `- difficulty preference: ${prefs.difficulty}` : "",
    prefs.time ? `- time preference: ${prefs.time}` : "",
    prefs.notes ? `- user notes: ${prefs.notes}` : "",
  ].filter(Boolean).join("\n") || "(none — use your judgment)";

  // Avoid-list + random nonce — together these are what make REGEN
  // actually produce a different dish rather than the model's single
  // most-likely output for this pantry. Temperature alone isn't enough;
  // we also tell the model explicitly what it already handed us.
  const avoidBlock = avoidTitles.length > 0
    ? `\nRECENTLY SUGGESTED — pick a genuinely different dish, not a variant:\n${
        avoidTitles.map((t) => `- ${t}`).join("\n")
      }\n`
    : "";
  const nonce = crypto.randomUUID();

  return `You are drafting a single recipe for a home cook. Use the
pantry below as your primary source of ingredients — lean on what's
actually on hand. A handful of assumed staples (salt, pepper, oil,
water) is fine; don't invent uncommon ingredients that aren't in the
pantry.

Lean toward creative, non-obvious combinations. When the user asks
for a draft from their pantry, boring defaults (generic pasta, plain
omelette) are a failure mode; reach for something the user might not
have thought of themselves.

Variety seed: ${nonce}
${avoidBlock}
PANTRY:
${pantryLines}

USER PREFERENCES:
${prefLines}

Return ONLY a single JSON object (no markdown, no prose) with this
exact shape. Every field is REQUIRED unless marked optional.

{
  "slug":       "<kebab-case-title>",
  "title":      "<short display title>",
  "subtitle":   "<one short line description>",        // optional, can be null
  "emoji":      "🍝",
  "cuisine":    "italian" | "french" | "mexican" | "american" | "japanese" | "thai" | "indian" | "chinese" | "mediterranean" | "other",
  "category":   "pasta" | "eggs" | "lunch" | "soup" | "salad" | "chicken" | "beef" | "pork" | "fish" | "vegetarian" | "dessert" | "sauce" | "snack" | "other",
  "difficulty": <integer 1..10; 1-3 easy, 4-6 medium, 7-10 advanced>,
  "routes":     ["plan"],                               // always ["plan"] for generated recipes
  "time":       { "prep": <minutes>, "cook": <minutes> },
  "serves":     <integer>,
  "tools":      ["<short name>", ...],                  // pans, knives, etc
  "ingredients": [
    {
      "amount":       "<display string, e.g. '2 tbsp' or '½ cup'>",
      "item":         "<display text, e.g. 'olive oil'>",
      "ingredientId": "<canonical id from pantry if matched, else null>"
    },
    ...
  ],
  "steps": [
    {
      "id":          "step1",
      "title":       "<short step title>",
      "instruction": "<1-3 sentences>",
      "icon":        "🔪",
      "timer":       <seconds or null>,
      "tip":         "<optional one-line tip or null>"
    },
    ...
  ],
  "tags": ["<short tag>", ...]                          // 2-5 useful tags
}

Rules:
  - ALWAYS produce at least 4 steps and 4 ingredients, even for simple
    recipes. Short steps are fine; zero steps is not.
  - EVERY pantry item you use must appear as an ingredient with the
    matching "ingredientId" when the pantry item carried a canonicalId.
    Leave "ingredientId" null for staples you assumed (salt, pepper, oil).
  - Keep total time reasonable — prep + cook ≤ 90 min unless the user
    asked for a long recipe.
  - Keep the slug short, lowercase, hyphenated. No trailing hyphens.
  - If the pantry can't plausibly yield a coherent dish, still return a
    recipe that uses staples + 1-2 pantry items, but note the assumed
    staples in the ingredients list.

Return the JSON object and nothing else.`;
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

  let body: { pantry?: PantryItem[]; prefs?: Prefs };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400, headers: JSON_HEADERS,
    });
  }

  const pantry = Array.isArray(body.pantry) ? body.pantry : [];
  const prefs = body.prefs || {};
  // Truncate the avoid list so a long regen session doesn't blow out
  // the prompt. The last five titles are plenty to steer away from
  // whatever the user actually saw most recently.
  const avoidTitles = Array.isArray((body as { avoidTitles?: string[] }).avoidTitles)
    ? ((body as { avoidTitles?: string[] }).avoidTitles as string[])
        .filter((t) => typeof t === "string" && t.trim().length > 0)
        .slice(-5)
    : [];

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
        max_tokens: 2500,
        // temperature=1 is the API default but we set it explicitly so
        // nobody accidentally pins it to 0 during debugging and wipes
        // out regen variety without realizing why.
        temperature: 1,
        messages: [
          { role: "user", content: [{ type: "text", text: buildPrompt(pantry, prefs, avoidTitles) }] },
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

  let recipe: Record<string, unknown>;
  try {
    recipe = JSON.parse(cleaned);
  } catch {
    return new Response(
      JSON.stringify({ error: "couldn't parse model output as JSON", raw }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  // Light shape check — anything catastrophically wrong comes back as
  // a 502 so the client can surface "try again" rather than feeding
  // garbage into CookMode.
  if (!recipe || typeof recipe !== "object" ||
      typeof recipe.title !== "string" ||
      !Array.isArray(recipe.ingredients) ||
      !Array.isArray(recipe.steps)) {
    return new Response(
      JSON.stringify({ error: "model returned an unexpected recipe shape", raw }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  // Backfill anything the model forgot. Keeps the downstream pipeline
  // from having to defend against missing optional fields.
  const finalRecipe = {
    slug:       recipe.slug       || slugify(recipe.title as string),
    title:      recipe.title,
    subtitle:   recipe.subtitle   ?? null,
    emoji:      recipe.emoji      || "🍽️",
    cuisine:    recipe.cuisine    || "other",
    category:   recipe.category   || "other",
    difficulty: clampInt(recipe.difficulty, 1, 10, 3),
    routes:     Array.isArray(recipe.routes) && recipe.routes.length ? recipe.routes : ["plan"],
    time:       recipe.time       || { prep: 10, cook: 20 },
    serves:     clampInt(recipe.serves, 1, 12, 2),
    tools:      Array.isArray(recipe.tools) ? recipe.tools : [],
    ingredients: recipe.ingredients,
    steps:      recipe.steps,
    tags:       Array.isArray(recipe.tags) ? recipe.tags : [],
  };

  return new Response(JSON.stringify({ recipe: finalRecipe }), { headers: JSON_HEADERS });
});

function slugify(s: string): string {
  return String(s || "recipe")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "recipe";
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
