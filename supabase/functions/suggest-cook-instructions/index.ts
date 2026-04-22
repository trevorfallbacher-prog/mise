// Supabase Edge Function: suggest-cook-instructions
//
// AI-autofills pantry_items.cook_instructions with a recipe-shaped
// mini-cook. Shape matches the bundled recipe schema so the client
// can render it through the same CookMode visual vocabulary without
// a second template. Writes a SMALL recipe — one identity, 2-5 steps,
// optional timer per step — not a full meal recipe.
//
// Why recipe-shape (vs a flat reheat block): the user asked for
// cook_instructions to "look like the cook screen." Reusing the
// recipe schema means the step card / progress bar / heat badge /
// doneCue grammar already rendered by CookMode can render reheats
// too, with no new template.
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
// Response:
//   {
//     cookInstructions: {
//       title:   string,
//       emoji:   string,
//       summary: string,                   // one-liner for item card preview
//       reheat:  { primary: {...} },       // drives the itemcard pill
//       steps:   [{ id, title, instruction, icon?, timer?, tip?, heat?, doneCue? }],
//     }
//   }

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

  return `You are writing a TIGHT mini cook-recipe for a single pantry
item. This is NOT a full meal recipe — it's the short sequence of
steps the user walks through before eating this specific item. The
output will render in a cook-screen walkthrough (progress bar, step
card, per-step timer).

${lines.join("\n")}

Decide method first, then write steps. Method heuristics:
- Pizza / pizza slice: stovetop on a cast-iron pan (crisps the base).
- Lasagna / baked casseroles: oven (even heat, no sogginess).
- Soup / stew / braise: stovetop (microwave makes proteins rubbery).
- Fried food / wings / fries: air_fryer or oven (re-crisp the exterior).
- Egg dishes / frittata: toaster_oven or cold (microwave scrambles).
- Whole raw proteins (chicken breast, pork chop, ground beef): stovetop
  when fresh; oven when reheating a cooked cut.
- Breads / rolls / bagels: toaster_oven.
- Prepared cold items (yogurt, cheese, cured meats, fresh salads): cold.
- Frozen meals / burritos / dumplings: microwave if the packaging
  assumes it; otherwise air_fryer.
- Raw produce / beverages that don't need cooking: cold with a single
  "eat as-is" step.

Steps rules:
- 2 to 5 steps. Most reheats need 3: preheat → heat → check/serve.
- Each step has ONE action. Don't pack "remove from oven and let rest"
  into a heating step — make "rest" its own step.
- The heating step must carry a timer (in SECONDS). Prep and plating
  steps set timer to null.
- Every step needs a short title (3-5 words) and a 1-2 sentence
  instruction written in plain, second-person, active voice.
- doneCue is required on the step where visual/sensory confirmation
  matters (e.g. "steam rising steadily", "edges start to brown",
  "center feels warm to the back of your hand"). Null otherwise.
- heat is required for stovetop steps ("medium-low" / "medium" /
  "medium-high" / "high"). Null for other methods.
- tip is optional — a specific fix when things go sideways (splash of
  water, loosely tent with foil, flip halfway). Use it sparingly.

If the item truly needs NO heating (raw produce, bottled drinks,
condiments), return a single step with method="cold" and a one-line
"eat as-is" instruction. Do not fabricate fake heat just to fill
steps.

Title rules:
- Start with an action verb: "Reheat", "Crisp up", "Warm through",
  "Slice and serve", "Plate cold".
- Include the item in plain language: "Reheat leftover lasagna",
  "Crisp up frozen fries". 4-6 words.

Return EXACTLY this JSON shape — no markdown fence, no prose, no
keys beyond what's shown:

{
  "title":   "<4-6 word action title>",
  "emoji":   "<one relevant food emoji>",
  "summary": "<one-line summary for the item-card pill, like 'Oven 350°F · 15 min' or 'Stovetop · 5 min · medium heat'>",
  "reheat": {
    "primary": {
      "method":  "oven" | "microwave" | "stovetop" | "air_fryer" | "toaster_oven" | "cold",
      "tempF":   <number or null for microwave/stovetop/cold>,
      "timeMin": <number — total active time in minutes>,
      "covered": <true | false | null when N/A>,
      "tips":    "<1 sentence top-level tip or null>"
    }
  },
  "steps": [
    {
      "id":          "step1",
      "title":       "<3-5 word step title>",
      "instruction": "<1-2 sentence plain-language instruction>",
      "icon":        "<one emoji>",
      "timer":       <seconds or null>,
      "tip":         "<optional short tip or null>",
      "heat":        "<'low'|'medium-low'|'medium'|'medium-high'|'high' or null>",
      "doneCue":     "<qualitative ready-signal or null>"
    },
    ...
  ]
}
`;
}

const METHODS = new Set([
  "oven", "microwave", "stovetop", "air_fryer", "toaster_oven", "cold",
]);
const HEATS = new Set([
  "low", "medium-low", "medium", "medium-high", "high", "off",
]);

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fence) return fence[1].trim();
  const first = trimmed.indexOf("{");
  const last  = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function sanitizeStep(raw: unknown, i: number): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const title = typeof s.title === "string" ? s.title.trim() : "";
  const instruction = typeof s.instruction === "string" ? s.instruction.trim() : "";
  if (!title || !instruction) return null;
  const timer = typeof s.timer === "number" && Number.isFinite(s.timer) && s.timer > 0
    ? Math.round(s.timer) : null;
  const heat = typeof s.heat === "string" && HEATS.has(s.heat) ? s.heat : null;
  const icon = typeof s.icon === "string" && s.icon.trim() ? s.icon.trim() : "👨‍🍳";
  const tip = typeof s.tip === "string" && s.tip.trim() ? s.tip.trim() : null;
  const doneCue = typeof s.doneCue === "string" && s.doneCue.trim() ? s.doneCue.trim() : null;
  const id = typeof s.id === "string" && s.id.trim() ? s.id.trim() : `step${i + 1}`;
  return { id, title, instruction, icon, timer, tip, heat, doneCue };
}

// Sanitize + rehydrate Claude's response. Tolerant by design — a
// partially valid response with usable steps is still worth
// surfacing to the user instead of bouncing to a 502. Returns
// [block, reason] where block is null and reason is a short debug
// string when we genuinely can't salvage anything. Reason flows
// back to the client in the 502 detail so the user can tell
// whether the model refused, truncated, or deviated from the shape.
function sanitize(raw: unknown): [Record<string, unknown> | null, string | null] {
  if (!raw || typeof raw !== "object") return [null, "response was not a JSON object"];
  const obj = raw as Record<string, unknown>;

  // Steps are the load-bearing field — without at least one
  // rendered step, ReheatMode has nothing to show. Everything else
  // (title, emoji, reheat summary) we can fill in defensively.
  const stepsRaw = Array.isArray(obj.steps) ? obj.steps : [];
  const steps = stepsRaw
    .map((s, i) => sanitizeStep(s, i))
    .filter((s): s is Record<string, unknown> => !!s);
  if (steps.length === 0) return [null, "no valid steps in response"];
  if (steps.length > 6) steps.length = 6;

  const title = typeof obj.title === "string" && obj.title.trim()
    ? obj.title.trim()
    : "Reheat";
  const emoji = typeof obj.emoji === "string" && obj.emoji.trim()
    ? obj.emoji.trim()
    : "♨";
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";

  // Reheat primary — best-effort reconstruction. When the model
  // skipped it OR validation rejects it, we synthesize one from
  // the first timed step so the ItemCard pill still has a summary
  // pill to display.
  let primary: Record<string, unknown> | null = null;
  const reheatRaw = obj.reheat && typeof obj.reheat === "object"
    ? obj.reheat as Record<string, unknown>
    : null;
  const primaryRaw = reheatRaw?.primary && typeof reheatRaw.primary === "object"
    ? reheatRaw.primary as Record<string, unknown>
    : null;
  if (primaryRaw) {
    const method = typeof primaryRaw.method === "string" ? primaryRaw.method : "";
    if (METHODS.has(method)) {
      const needsTemp = method === "oven" || method === "air_fryer" || method === "toaster_oven";
      const t = Number(primaryRaw.tempF);
      const tempF = Number.isFinite(t) && t > 0 ? Math.round(t) : null;
      const timeRaw = Number(primaryRaw.timeMin);
      const timeMin = Number.isFinite(timeRaw) && timeRaw > 0
        ? Math.round(timeRaw * 10) / 10
        : null;
      // Reject the primary only when BOTH of its load-bearing
      // fields are missing — needs-temp methods still salvage with
      // a default of 350°F and we log the patch. Otherwise fall
      // through to the step-based synthesis below.
      if (timeMin != null || steps.some(s => typeof s.timer === "number" && s.timer)) {
        const covered = primaryRaw.covered === true ? true
                      : primaryRaw.covered === false ? false
                      : null;
        const tips = typeof primaryRaw.tips === "string" ? primaryRaw.tips.trim() : "";
        primary = {
          method,
          tempF: needsTemp && tempF == null ? 350 : tempF,
          timeMin: timeMin != null
            ? timeMin
            : Math.round((steps.reduce((m, s) => m + (Number(s.timer) || 0), 0) / 60) * 10) / 10 || 5,
          covered,
          tips: tips || null,
        };
      }
    }
  }
  if (!primary) {
    // Synthesize from the first step that has a timer. Covers the
    // "Claude forgot reheat.primary entirely" case without
    // punishing the user with a 502.
    const firstTimed = steps.find(s => typeof s.timer === "number" && Number(s.timer) > 0);
    const totalSec = steps.reduce((m, s) => m + (Number(s.timer) || 0), 0);
    const minutes = Math.max(1, Math.round((totalSec || 300) / 60));
    primary = {
      method: "stovetop",
      tempF: null,
      timeMin: minutes,
      covered: null,
      tips: firstTimed && typeof firstTimed.tip === "string" ? firstTimed.tip : null,
    };
  }

  return [{
    title,
    emoji,
    summary: summary || null,
    reheat: { primary },
    steps,
  }, null];
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
        // 1500-token cap — a 3-5 step cook-walkthrough runs 400-800
        // tokens typical. Leaves margin for a verbose tips field
        // without risking truncation mid-step.
        max_tokens: 1500,
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

  const [block, reason] = sanitize(parsed);
  if (!block) {
    return new Response(
      JSON.stringify({
        error: `cook-instructions validation failed: ${reason || "unknown"}`,
        raw: text.slice(0, 600),
      }),
      { status: 502, headers: JSON_HEADERS },
    );
  }

  return new Response(
    JSON.stringify({ cookInstructions: block }),
    { status: 200, headers: JSON_HEADERS },
  );
});
