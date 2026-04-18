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
  ingredientIds?: string[];
  amount?: number | string;
  unit?: string;
  category?: string;
  state?: string | null;
  location?: string | null;
  daysToExpiry?: number | null;
  kind?: string | null;
  enrichment?: {
    flavorProfile?: string | null;
    pairs?: string[];
    diet?: Record<string, unknown> | null;
  };
};

type Prefs = {
  cuisine?: string;
  difficulty?: string;
  time?: string;
  notes?: string;
};

type RichContext = {
  profile?: {
    dietary?:    string | null;
    veganStyle?: string | null;
    level?:      string | null;
    goal?:       string | null;
    topSkills?:  Array<{ id: string; level: number }>;
  } | null;
  history?: {
    cookCount?:          number;
    ratingCounts?:       Record<string, number>;
    topCuisines?:        Array<{ id: string; count: number }>;
    topFavoritedTitles?: string[];
  } | null;
} | null;

function buildPrompt(
  pantry: PantryItem[],
  prefs: Prefs,
  avoidTitles: string[],
  context: RichContext,
): string {
  const pantryLines = pantry.length === 0
    ? "(pantry is empty — suggest something that needs only staples)"
    : pantry
        .map((p) => {
          const amount = p.amount != null ? `${p.amount}${p.unit || ""}` : "";
          const facts = [
            amount,
            p.canonicalId ? `id:${p.canonicalId}` : "",
            p.category || "",
            p.state ? `state:${p.state}` : "",
            p.location ? `loc:${p.location}` : "",
            p.kind && p.kind !== "ingredient" ? `kind:${p.kind}` : "",
            typeof p.daysToExpiry === "number"
              ? (p.daysToExpiry <= 0 ? "EXPIRED" : `expires in ${p.daysToExpiry}d`)
              : "",
          ].filter(Boolean).join(" · ");
          const base = `- ${p.name || "unknown"}${facts ? ` (${facts})` : ""}`;
          const enr = p.enrichment;
          if (!enr) return base;
          const enrBits = [
            enr.flavorProfile ? `flavor: ${enr.flavorProfile}` : "",
            enr.pairs && enr.pairs.length ? `pairs: ${enr.pairs.join(", ")}` : "",
            dietSummary(enr.diet),
          ].filter(Boolean).join(" | ");
          return enrBits ? `${base}\n    ${enrBits}` : base;
        })
        .join("\n");

  const prefLines = [
    prefs.cuisine && prefs.cuisine !== "any" ? `- cuisine: ${prefs.cuisine}` : "",
    prefs.difficulty ? `- difficulty preference: ${prefs.difficulty}` : "",
    prefs.time ? `- time preference: ${prefs.time}` : "",
    prefs.notes ? `- user notes: ${prefs.notes}` : "",
  ].filter(Boolean).join("\n") || "(none — use your judgment)";

  // Profile + cook-history blocks — only present on first-draft calls.
  // REGEN deliberately drops these so the second draft isn't pulled
  // back toward the same flavor-profile pairings as the first.
  const profileBlock = context?.profile ? profileSection(context.profile) : "";
  const historyBlock = context?.history ? historySection(context.history) : "";

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

  return `You are drafting a single recipe for a home cook.

The user's notes in USER PREFERENCES — especially any protein or
dish they explicitly ask for ("make me shrimp pad thai", "something
with lamb", "a curry") — are the TOP priority. When the user calls
out a specific ingredient or dish, reach for it even if it isn't in
their pantry; they'll source what's missing. The pantry is your
default palette, not a hard constraint. If the user asked for
shrimp and there's no shrimp in the pantry, write a shrimp recipe
anyway and call out the non-pantry items plainly in the ingredients
list.

When the user has NOT asked for something specific, lean on the
pantry as your primary source of ingredients and prioritize items
that are expiring soon to reduce waste. A handful of assumed staples
(salt, pepper, oil, water) is always fine.

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
${profileBlock}${historyBlock}
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
      "tip":         "<optional one-line tip or null>",
      "uses": [
        {
          "amount":       "<display string matching the amount used AT THIS STEP>",
          "item":         "<display text, e.g. 'butter'>",
          "ingredientId": "<canonical id from pantry if applicable, else null>",
          "state":        "<optional physical form: 'minced', 'sliced', 'grated'>"
        },
        ...
      ],
      "heat":    "<optional: 'low' | 'medium-low' | 'medium' | 'medium-high' | 'high' | 'off'>",
      "doneCue": "<optional short qualitative ready-signal: 'nutty smell, color of wet sand'>"
    },
    ...
  ],
  "tags": ["<short tag>", ...],                         // 2-5 useful tags
  "aiRationale": "<1-3 sentences in plain language, written TO the user in second person,
                 explaining WHY you picked this dish. Cite specific signals you used — items
                 about to expire, user's dietary constraints, recent cuisines they've leaned
                 into, their cooking level. Examples:
                   'Your heavy cream and tomatoes both expire this week, so I leaned into a
                    creamy tomato sauce. You've nailed three Italian dishes recently, so I
                    stayed in that lane but pushed toward something a little more adventurous.'
                   'You mentioned spicy, and you've got all the aromatics for a Thai curry
                    on hand. The fish sauce and coconut milk open that door — and it comes
                    together in 25 minutes, matching your quick-cook preference.'
                 Do NOT invent signals that weren't in the context. If no rich context was
                 provided, keep it to one sentence about the pantry fit."
}

Rules (in priority order — higher rules beat lower ones on conflict):

  1. USER NOTES WIN. If the user asked for a specific protein, dish,
     or cuisine in their notes, honor it even if nothing in the pantry
     supports it. Non-pantry ingredients are fine in that case — just
     list them plainly. Do NOT redirect to a pantry-fitting dish when
     the user has a clear ask.

  2. Respect dietary constraints in the PROFILE block if present. If
     the user is vegetarian/vegan, do not propose meat or fish even
     if the pantry contains it (their family may have added it) AND
     even if the user's notes mention one. Dietary beats notes — call
     out the conflict in the aiRationale.

  3. When the user has NOT asked for something specific, prefer
     recipes that use pantry items marked "EXPIRED" or "expires in Nd"
     where N is small. Reducing waste is the default goal.

  4. EVERY pantry item you use must appear as an ingredient with the
     matching "ingredientId" when the pantry item carried a
     canonicalId. Leave "ingredientId" null for staples you assumed
     (salt, pepper, oil) and for any non-pantry ingredients you
     added because the user asked for them.

  5. ALWAYS produce at least 4 steps and 4 ingredients.

  5a. EVERY step must carry a `uses` array listing the ingredients
     consumed AT that step with the amount used at that step. If an
     ingredient spans multiple steps (eggs split between batter and
     wash), it legitimately appears in more than one step with
     partial amounts that sum to the top-level ingredients[] amount.
     If a step is purely action-only (plate, rest, serve), `uses`
     may be an empty array.

  5b. Add `heat` whenever a step involves a burner/oven/grill — it
     helps the cook dial in the stove without rereading the prose.
     Omit for prep steps.

  5c. Add `doneCue` whenever the step has a qualitative readiness
     signal ("onions translucent, not brown"; "pasta has 1 minute
     less than package says"). Skip for trivial steps.

  6. Keep total time reasonable — prep + cook ≤ 90 min unless the user
     asked for a long recipe.

  7. Keep the slug short, lowercase, hyphenated. No trailing hyphens.

  8. Respect the skill level implied by profile.level and topSkills. A
     "beginner" shouldn't get a five-step braise; an "advanced" cook
     is bored by scrambled eggs.

  9. The aiRationale field is how the user finds out WHY you picked
     this dish. Make it specific and grounded in what you saw in the
     context. If you honored an explicit user ask OVER the expiring
     items, say so ("You asked for shrimp, so I skipped the cream
     that's about to turn — save it for a pasta tomorrow"). Don't
     pad with generic food-writing prose.

Return the JSON object and nothing else.`;
}

// Compact single-line summary of the diet flags so the model sees
// vegan/vegetarian/gluten-free signals without drowning in a giant
// per-ingredient blob.
function dietSummary(diet: Record<string, unknown> | null | undefined): string {
  if (!diet || typeof diet !== "object") return "";
  const flags: string[] = [];
  for (const key of ["vegan", "vegetarian", "glutenFree", "keto", "halal", "kosher"]) {
    const v = (diet as Record<string, unknown>)[key];
    if (v === true) flags.push(key);
  }
  return flags.length ? `diet: ${flags.join(",")}` : "";
}

function profileSection(p: NonNullable<NonNullable<RichContext>["profile"]>): string {
  const lines: string[] = [];
  if (p.dietary)    lines.push(`- dietary: ${p.dietary}${p.veganStyle ? ` (${p.veganStyle})` : ""}`);
  if (p.level)      lines.push(`- cooking level: ${p.level}`);
  if (p.goal)       lines.push(`- goal: ${p.goal}`);
  if (p.topSkills && p.topSkills.length) {
    lines.push(`- practiced skills: ${p.topSkills.map((s) => `${s.id}(L${s.level})`).join(", ")}`);
  }
  if (!lines.length) return "";
  return `\nPROFILE:\n${lines.join("\n")}\n`;
}

function historySection(h: NonNullable<NonNullable<RichContext>["history"]>): string {
  if (!h.cookCount) return "";
  const ratings = h.ratingCounts
    ? Object.entries(h.ratingCounts)
        .filter(([, c]) => c > 0)
        .map(([k, c]) => `${k}:${c}`).join(" ")
    : "";
  const cuisines = (h.topCuisines || []).map((c) => `${c.id}(${c.count})`).join(", ");
  const favs = (h.topFavoritedTitles || []).join(" | ");
  const lines: string[] = [`- recent cooks: ${h.cookCount}`];
  if (ratings)  lines.push(`- rating mix: ${ratings}`);
  if (cuisines) lines.push(`- top cuisines: ${cuisines}`);
  if (favs)     lines.push(`- favorited: ${favs}`);
  return `\nRECENT HISTORY:\n${lines.join("\n")}\n`;
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

  let body: {
    pantry?: PantryItem[];
    prefs?: Prefs;
    avoidTitles?: string[];
    context?: RichContext;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400, headers: JSON_HEADERS,
    });
  }

  const pantry = Array.isArray(body.pantry) ? body.pantry : [];
  const prefs = body.prefs || {};
  const context = body.context || null;
  // Truncate the avoid list so a long regen session doesn't blow out
  // the prompt. The last five titles are plenty to steer away from
  // whatever the user actually saw most recently.
  const avoidTitles = Array.isArray(body.avoidTitles)
    ? body.avoidTitles
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
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
          { role: "user", content: [{ type: "text", text: buildPrompt(pantry, prefs, avoidTitles, context) }] },
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
    // Backfill step shape so CookMode never has to defend against a
    // step that skipped `uses`, `heat`, or `doneCue`. If the model
    // dropped `uses` entirely, default to an empty array (CookMode
    // falls back to the top-level ingredients list for rendering).
    steps:      normalizeSteps(recipe.steps),
    tags:       Array.isArray(recipe.tags) ? recipe.tags : [],
    // Narrative "why this dish" string for the preview banner.
    // Truncated defensively so a verbose model doesn't eat the
    // preview UI. Null when the model skipped the field.
    aiRationale: typeof recipe.aiRationale === "string"
      ? String(recipe.aiRationale).slice(0, 400).trim() || null
      : null,
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

// Ensure every step carries the fields CookMode reads without
// blowing up on a model that skipped one. `uses` defaults to an
// empty array (triggers CookMode's fallback to the top-level
// ingredients list); `heat` and `doneCue` default to null.
function normalizeSteps(steps: unknown): unknown[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((s, i) => {
    const step = (s && typeof s === "object") ? s as Record<string, unknown> : {};
    const uses = Array.isArray(step.uses)
      ? (step.uses as unknown[]).map((u) => {
          const row = (u && typeof u === "object") ? u as Record<string, unknown> : {};
          return {
            amount:       typeof row.amount === "string" ? row.amount : null,
            item:         typeof row.item   === "string" ? row.item   : null,
            ingredientId: typeof row.ingredientId === "string" ? row.ingredientId : null,
            state:        typeof row.state  === "string" ? row.state  : null,
          };
        })
      : [];
    return {
      id:          typeof step.id          === "string" ? step.id          : `step${i + 1}`,
      title:       typeof step.title       === "string" ? step.title       : `Step ${i + 1}`,
      instruction: typeof step.instruction === "string" ? step.instruction : "",
      icon:        typeof step.icon        === "string" ? step.icon        : "👨‍🍳",
      timer:       typeof step.timer       === "number" ? step.timer       : null,
      tip:         typeof step.tip         === "string" ? step.tip         : null,
      uses,
      heat:        typeof step.heat        === "string" ? step.heat        : null,
      doneCue:     typeof step.doneCue     === "string" ? step.doneCue     : null,
    };
  });
}
