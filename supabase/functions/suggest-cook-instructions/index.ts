// Supabase Edge Function: suggest-cook-instructions
//
// AI-autofill for pantry_items.cook_instructions (migration 0125). The
// mini-recipe-on-an-item shape mirrors recipes.reheat so IAteThisSheet
// can render it verbatim. Called from CookInstructionsSheet's SUGGEST
// button; the user sees the filled form and can tweak before saving.
//
// Single-shot Haiku call. Input is the pantry row's identity
// (canonical id, brand, state, cut, display name) — enough for Claude
// to pick a sensible heating method without a full cook-log history.
// Output is one `{ primary: {method, tempF, timeMin, covered, tips} }`
// block — no alternates (users refine manually from there).
//
// Deploy:
//   supabase functions deploy suggest-cook-instructions
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxx
//
// Request body:
//   {
//     name?:         string,   // display name on the pantry row
//     canonicalId?:  string,   // canonical slug ("chicken", "pizza", ...)
//     brand?:        string,   // optional ("Trader Joe's", "DiGiorno")
//     state?:        string,   // optional ("loaf", "slices", "cubed")
//     cut?:          string,   // optional ("breast", "thigh")
//     category?:     string,   // optional food category
//   }
//
// Response: { cookInstructions: { primary: {...} } } or { error }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

const MODEL = "claude-haiku-4-5-20251001";

type Input = {
  name?: string;
  canonicalId?: string;
  brand?: string;
  state?: string;
  cut?: string;
  category?: string;
};

function buildPrompt(input: Input): string {
  const lines: string[] = [];
  lines.push("Identity of the pantry item we need cook/reheat instructions for:");
  if (input.name)         lines.push(`- Display name: ${input.name}`);
  if (input.canonicalId)  lines.push(`- Canonical id: ${input.canonicalId}`);
  if (input.cut)          lines.push(`- Cut: ${input.cut}`);
  if (input.state)        lines.push(`- State: ${input.state}`);
  if (input.brand)        lines.push(`- Brand: ${input.brand}`);
  if (input.category)     lines.push(`- Category: ${input.category}`);
  if (lines.length === 1) {
    lines.push("- (no additional identity — infer from display name alone)");
  }

  return `You are writing a SINGLE reheat/cook instruction block for a pantry item.
The user will see your suggestion pre-filled into a form that they can
edit. Pick the ONE best method for THIS specific item — not a generic
default. Be honest about time and temperature.

${lines.join("\n")}

Heuristics that should drive the method pick:
- Pizza / pizza slice: stovetop on a cast-iron pan (crisps the base).
- Lasagna / baked casseroles: oven (even heat, no sogginess).
- Soup / stew / braise: stovetop (microwave makes the proteins rubbery).
- Fried food / wings / fries: air_fryer or oven (re-crisp the exterior).
- Egg dishes / frittata: toaster_oven or cold (gentle — microwave
  scrambles eggs further).
- Whole raw proteins (chicken breast, pork chop, ground beef): stovetop
  when cooking fresh; oven when reheating a cooked cut.
- Breads / rolls / bagels: toaster_oven.
- Prepared cold items (yogurt, cheese, cured meats, fresh salads): cold.
- Frozen meals / burritos / dumplings: microwave if that's what the
  packaging assumes; otherwise air_fryer.
- Raw produce / dry goods that don't need cooking: cold with a short
  "eat as-is" tip.

If the item TRULY requires no heating (raw produce, drinks,
condiments, yogurt), return method="cold" with a one-line "eat as-is"
tip. Do not fabricate a fake temp / time just to fill the field.

Temp rules:
- tempF is REQUIRED for oven, air_fryer, toaster_oven.
- tempF MUST be null for microwave, stovetop, cold.
- timeMin is ALWAYS a single number (not a range). Pick the midpoint
  when the realistic window is wide.
- covered: true when a lid helps (braises, casseroles, rice). false
  when a lid traps steam and ruins the texture (fries, pizza,
  anything crispy). null when it doesn't apply (microwave defaults).

Return EXACTLY this JSON — no markdown fence, no prose, no keys beyond
what's shown:

{
  "primary": {
    "method":  "oven" | "microwave" | "stovetop" | "air_fryer" | "toaster_oven" | "cold",
    "tempF":   <number or null>,
    "timeMin": <number>,
    "covered": <true | false | null>,
    "tips":    "<1-2 sentences of specific, actionable guidance — a splash of water, loosely cover with foil, medium-low heat, stir once, etc. Never generic.>"
  }
}
`;
}

const METHODS = new Set([
  "oven", "microwave", "stovetop", "air_fryer", "toaster_oven", "cold",
]);

// Salvage the JSON block even when Claude wraps it in a code fence
// or adds a trailing explanation. We only need the {...} payload.
function extractJson(text: string): string {
  const trimmed = text.trim();
  // Strip ```json fences if present.
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fence) return fence[1].trim();
  // Locate the first balanced {...} block. Handles cases where
  // Claude prefixes a short explanation ("Here's the block:\n{...}").
  const first = trimmed.indexOf("{");
  const last  = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function sanitize(block: unknown): { primary: Record<string, unknown> } | null {
  if (!block || typeof block !== "object") return null;
  const obj = block as Record<string, unknown>;
  const primary = obj.primary && typeof obj.primary === "object"
    ? obj.primary as Record<string, unknown>
    : null;
  if (!primary) return null;

  const method = typeof primary.method === "string" ? primary.method : "";
  if (!METHODS.has(method)) return null;

  const needsTemp = method === "oven" || method === "air_fryer" || method === "toaster_oven";
  let tempF: number | null = null;
  if (needsTemp) {
    const t = Number(primary.tempF);
    tempF = Number.isFinite(t) && t > 0 ? Math.round(t) : null;
    if (tempF == null) return null;   // oven without a temp is broken
  }

  const timeRaw = Number(primary.timeMin);
  if (!Number.isFinite(timeRaw) || timeRaw <= 0) return null;
  const timeMin = Math.round(timeRaw * 10) / 10;

  const covered = primary.covered === true ? true
                : primary.covered === false ? false
                : null;

  const tips = typeof primary.tips === "string" ? primary.tips.trim() : "";

  return {
    primary: {
      method,
      tempF,
      timeMin,
      covered,
      tips: tips || null,
    },
  };
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

  let body: Input;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400, headers: JSON_HEADERS,
    });
  }

  // Strip empty strings so the prompt only mentions axes we actually
  // have. An all-empty input still works — Claude just falls back to
  // heuristics keyed off whatever display name survived.
  const input: Input = {
    name:        typeof body.name === "string"        ? body.name.trim()        : "",
    canonicalId: typeof body.canonicalId === "string" ? body.canonicalId.trim() : "",
    brand:       typeof body.brand === "string"       ? body.brand.trim()       : "",
    state:       typeof body.state === "string"       ? body.state.trim()       : "",
    cut:         typeof body.cut === "string"         ? body.cut.trim()         : "",
    category:    typeof body.category === "string"    ? body.category.trim()    : "",
  };
  for (const k of Object.keys(input) as (keyof Input)[]) {
    if (!input[k]) delete input[k];
  }
  if (!input.name && !input.canonicalId) {
    return new Response(
      JSON.stringify({ error: "need at least one of: name, canonicalId" }),
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
        // 500 tokens is plenty for a single-block response; this caps
        // cost and makes the timeout budget predictable. If Claude
        // ever needs more headroom (a verbose tips field), we bump it
        // — for now the typical response is ~100 tokens.
        max_tokens: 500,
        messages: [{ role: "user", content: buildPrompt(input) }],
      }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "anthropic fetch failed", detail: String(err) }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  if (!anthropicResp.ok) {
    const detail = await anthropicResp.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: `anthropic ${anthropicResp.status}`, detail }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  let anthropicJson: { content?: Array<{ type: string; text?: string }> };
  try {
    anthropicJson = await anthropicResp.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "anthropic returned non-JSON" }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const text = (anthropicJson.content || [])
    .filter(b => b?.type === "text" && typeof b.text === "string")
    .map(b => b.text as string)
    .join("");
  if (!text) {
    return new Response(
      JSON.stringify({ error: "empty model response" }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "model returned malformed JSON",
        detail: String(err),
        raw: text.slice(0, 400),
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  const block = sanitize(parsed);
  if (!block) {
    return new Response(
      JSON.stringify({
        error: "model response failed shape validation",
        raw: text.slice(0, 400),
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  return new Response(
    JSON.stringify({ cookInstructions: block }),
    { status: 200, headers: JSON_HEADERS },
  );
});
