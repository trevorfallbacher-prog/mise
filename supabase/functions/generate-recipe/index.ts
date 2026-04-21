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
  // Stamped true by aiContext when the user explicitly picked this
  // canonical in the STAR INGREDIENTS chip row. The prompt treats
  // starred rows as the anchor the recipe must be built around,
  // overriding the expiring-soon default.
  star?: boolean;
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
  // Hero input from the AIRecipe setup screen. Renamed from `notes`
  // to signal the user is actively directing the AI. Accept both
  // names for one release cycle — stale clients that still send
  // `notes` don't break.
  mealPrompt?: string;
  notes?: string;          // deprecated alias
  // When is the user eating this? Shapes whether Claude drafts
  // breakfast vs dinner vs lunch vs "any time."
  mealTiming?: string;
  // Course role — main / side / dessert / appetizer / bake / prep / any.
  // "bake" and "prep" are component-style recipes (bread, stock, sauce)
  // that aren't plate roles and don't live in a meal slot.
  course?: string;
  // Which side of the "I want X / I have Y" tension wins.
  //   "category" — course / timing / cuisine are authoritative; Claude
  //                rejects drafts that don't fit the category even when
  //                the pantry pushes toward something else. The client
  //                also pre-filters the pantry block for tight-category
  //                courses (bake/dessert/prep) so incompatible items
  //                never become visible narrative pressure.
  //   "pantry"   — legacy behavior. Pantry items drive the draft; the
  //                course is a soft hint Claude bends around the
  //                ingredients.
  // Undefined → legacy behavior (course is a soft hint). Client only
  // sends the field when course !== "any".
  priority?: "category" | "pantry";
  // Canonical ids the user explicitly chose to build around. Must
  // appear in the recipe as primary components, not garnishes.
  starIngredientIds?: string[];
  // Revision instruction from the tweak phase — what to change in
  // technique / seasoning / approach when going from sketch to
  // final cook. Only meaningful in mode = "final".
  recipeFeedback?: string;
  // Anchor context for compose-a-meal drafts. When present, the draft
  // is a side / dessert / appetizer intended to be served alongside
  // `pairWith.title`. Claude uses it for contrast/complement — don't
  // duplicate the anchor's dominant protein / starch / sauce.
  pairWith?: {
    title: string;
    course: string;         // "main" | "side" | "dessert" | "appetizer"
    cuisine?: string;
    ingredients: Array<{ name: string; amount?: string | number | null }>;
  };
};

// One ingredient line in the sketch's "what we're locking in"
// payload. Sent on the FINAL call so Claude builds steps around the
// exact set the user approved (after their swaps / adds / shopping
// promotions) instead of re-resolving from pantry.
type LockedIngredient = {
  name: string;
  amount?: string | number | null;
  unit?: string | null;
  ingredientId?: string | null;     // canonical slug if known
  pantryItemId?: string | null;     // matched pantry row, or null = shopping
  source?: "pantry" | "shopping" | "added";
  note?: string | null;             // e.g. "subbed from mozzarella"
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

// Shared preamble for both sketch and final prompts: PRECEDENCE
// rules, pantry table, user prefs, profile, history, avoid list,
// and a per-call nonce. Both modes need exactly this header; the
// modes differ only in the JSON schema they request below.
function assemblePromptHeader(
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
            p.star ? "★ STARRED BY USER" : "",
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

  const mealPrompt = prefs.mealPrompt || prefs.notes || "";

  const starPantryNames = Array.isArray(prefs.starIngredientIds) && prefs.starIngredientIds.length
    ? prefs.starIngredientIds
        .map((slug) => {
          const match = pantry.find((p) => p.canonicalId === slug);
          return match?.name || slug;
        })
    : [];

  const prefLines = [
    mealPrompt ? `- meal prompt (user's ask): ${mealPrompt}` : "",
    starPantryNames.length
      ? `- star ingredients (BUILD AROUND THESE, not garnish): ${starPantryNames.join(", ")}`
      : "",
    prefs.mealTiming && prefs.mealTiming !== "any"
      ? `- meal timing: ${prefs.mealTiming} (draft a ${prefs.mealTiming} dish)`
      : "",
    prefs.course && prefs.course !== "any"
      ? `- course: ${prefs.course} (the recipe should function as a ${prefs.course})`
      : "",
    prefs.cuisine && prefs.cuisine !== "any" ? `- cuisine: ${prefs.cuisine}` : "",
    prefs.difficulty ? `- difficulty preference: ${prefs.difficulty}` : "",
    prefs.time ? `- time preference: ${prefs.time}` : "",
  ].filter(Boolean).join("\n") || "(none — use your judgment)";

  const profileBlock = context?.profile ? profileSection(context.profile) : "";
  const historyBlock = context?.history ? historySection(context.history) : "";

  const avoidBlock = avoidTitles.length > 0
    ? `\nRECENTLY SUGGESTED — pick a genuinely different dish, not a variant:\n${
        avoidTitles.map((t) => `- ${t}`).join("\n")
      }\n`
    : "";
  const nonce = crypto.randomUUID();

  // Hoist meal timing / course into their own HARD CONSTRAINTS block at
  // the top of the prompt. Buried at the bottom of USER PREFERENCES the
  // model was treating them as soft nuance; promoting them to a standalone
  // block (with explicit violation callouts) makes breakfast-vs-dinner and
  // main-vs-side-vs-dessert actually swing the output.
  const hardConstraintLines: string[] = [];
  if (prefs.mealTiming && prefs.mealTiming !== "any") {
    const t = prefs.mealTiming;
    const examples = t === "breakfast"
      ? "egg dishes, pancakes, oatmeal, breakfast burritos, shakshuka, frittatas, breakfast sandwiches, yogurt bowls"
      : t === "lunch"
        ? "sandwiches, wraps, grain bowls, soups, salads, lighter mains"
        : t === "dinner"
          ? "substantial mains, braises, roasts, pastas, stir-fries, hearty entrées"
          : "";
    hardConstraintLines.push(
      `- MEAL TIMING = ${t.toUpperCase()}. The dish MUST read unmistakably as a ${t} dish.${examples ? ` Think: ${examples}.` : ""} Do NOT draft a dinner entrée when the user asked for breakfast, or vice versa.`,
    );
  }
  if (prefs.course && prefs.course !== "any") {
    const c = prefs.course;
    const roleDesc = c === "main"
      ? "a meal-carrying entrée, substantial enough to stand alone on the plate"
      : c === "side"
        ? "a supporting side dish — smaller scale, meant to sit alongside a main; do NOT draft a full entrée"
        : c === "dessert"
          ? "a post-meal SWEET — cakes, pies, tarts, cookies, brownies, bars, custards, mousses, panna cotta, puddings, frozen desserts (ice cream, sorbet, granita), fruit-based finishes (compotes, crisps, cobblers), confections (truffles, bark, fudge). Single plated serving size, not a batch / bakery-case quantity. When something is both sweet AND baked, prefer Baked Goods unless the user's framing reads as 'finish to a meal' rather than 'bakery item.' ABSOLUTELY NOT savory, not meat, not a main, not an appetizer. If the pantry offers only savory starred items, draft a standard dessert and call out the missing sweet ingredients as shopping items — do not invent a savory dessert to use the pantry"
          : c === "appetizer"
            ? "a small opening bite — served before the main, meant to whet the appetite; 1-2 oz portions, finger-food or small-plate scale; do NOT draft a full entrée or a dessert"
            : c === "bake"
              ? "a sweet or neutral BAKED GOOD — cookies, cakes, brownies, muffins, scones, pies, tarts, quick breads, yeast breads (plain loaves), cinnamon rolls, croissants, biscuits, dinner rolls, bars, banana bread, pound cake. Think bakery display case. Explicitly NOT a meal-on-bread: no pizza, no focaccia with cheese/meat/avocado/pesto/etc. toppings, no savory galettes, no meal-style flatbreads, no stuffed savory breads, no quiche, no calzones, no savory tarts that function as a dinner. If it has a cheesy / meaty / vegetable topping composed like a plated dish, it's a MAIN disguised as a bake — reject that frame entirely and pick a true pastry or sweet/plain bread instead. The output must be something a user would eat as a standalone bakery item (with coffee, as dessert, as breakfast carbs) — NOT as the centerpiece of dinner. mealTiming should be null"
              : c === "prep"
                ? "a kitchen PREP/COMPONENT — stock, broth, sauce, marinade, pickle, spice blend, ferment, dressing, vinaigrette, confit, flavored salt, chili oil, compound butter. A single ingredient-like output meant to be used in OTHER recipes. No composed-plate instructions, no 'serve with rice' step, no 'plate with garnish' step. Output is a jar / bottle / pouch of something, not a dinner. mealTiming should be null (this is not a meal). If the pantry's starred items are whole proteins or full produce sets that read like a plated-dish palette, ignore that framing — produce a stock/sauce/pickle that USES the aromatics/acids/salts on hand, not a plated entrée"
                : "";
    hardConstraintLines.push(
      `- COURSE = ${c.toUpperCase()}. The dish MUST function as ${roleDesc}.`,
    );
  }
  if (prefs.pairWith) {
    const pw = prefs.pairWith;
    const ingLine = Array.isArray(pw.ingredients) && pw.ingredients.length
      ? pw.ingredients
          .slice(0, 15)
          .map((i) => `${i.name}${i.amount ? ` (${i.amount})` : ""}`)
          .join(", ")
      : "(no ingredient list provided)";
    const thisCourse = (prefs.course && prefs.course !== "any") ? prefs.course : "dish";
    hardConstraintLines.push(
      `- PAIRING: this ${thisCourse} will be served alongside a ${pw.course}` +
        (pw.cuisine ? ` (${pw.cuisine})` : "") +
        ` — "${pw.title}". That anchor dish includes: ${ingLine}. Your ${thisCourse} MUST complement those flavors/textures — do NOT duplicate the same protein, starch, or dominant sauce. Think contrast and balance: crunch next to something rich, acid next to something fatty, a light element next to a heavy one. If the anchor is heavy and creamy, lean bright and sharp; if the anchor is lean and acidic, lean rich and savory.`,
    );
  }
  const hardConstraintsBlock = hardConstraintLines.length > 0
    ? `\nHARD CONSTRAINTS — violating these is a failure, not a stylistic choice:\n${hardConstraintLines.join("\n")}\n`
    : "";

  // Priority mode — category-first (course wins, pantry is a palette
  // filtered to compatible items) vs pantry-first (legacy; pantry
  // drives the draft and course bends). The client pre-filters the
  // pantry block when priority==="category", so Claude sees a
  // shortened palette; this block makes the precedence match that
  // reality so Claude doesn't try to paint around missing ingredients
  // by inventing something off-category.
  const priorityMode: "category" | "pantry" =
    prefs.priority === "pantry" ? "pantry" : "category";
  const precedenceBlock = priorityMode === "category" ? `
PRECEDENCE (hard → soft). Earlier beats later when they conflict.
You are in CATEGORY-PRIORITY mode: the user picked a course and
wants that category respected over pantry convenience.
  1. Dietary / allergy constraints from the profile block.
  2. COURSE — if set, the recipe MUST function as that course. This
     is authoritative. A "bake" output is a baked good, not a meal
     with a bread element. A "dessert" output is sweet. A "prep"
     output is a single-component jar/bottle. Do not reframe the
     category to fit the pantry.
  3. MEAL TIMING — if set, the recipe fits that meal within the
     category (breakfast pastry, dinner prep, etc.).
  4. STAR INGREDIENTS — compatible only. If a starred item doesn't
     fit the course category (e.g. hot dogs starred but course is
     "bake"), SILENTLY DROP that star. Do not bend the category to
     include it. Keep compatible stars (butter, flour, sugar, eggs
     for bake; aromatics for prep; fruit/dairy for dessert).
  5. The MEAL PROMPT text — the user's direct ask, respected within
     the course category. "lasagna" under "bake" → reject lasagna,
     pick a pastry.
  6. CUISINE / TIME / DIFFICULTY — nuance knobs applied within the
     constraints above.

The pantry block has already been filtered to category-compatible
items. Ignore urgency/expiry narratives — the user explicitly asked
for a category output, not for you to use up what's going bad. If
the pantry is sparse for the category, draft a standard recipe and
call the missing items out as shopping items.

Lean toward creative, non-obvious combinations WITHIN the category.
A boring chocolate chip cookie is a failure mode; so is a savory
skillet disguised as a bake. Reach for something the user might
not have thought of themselves — but keep it in-category.
` : `
PRECEDENCE (hard → soft). Earlier beats later when they conflict.
You are in PANTRY-PRIORITY mode: the user wants to cook around what
they have, not chase a category at the expense of waste.
  1. Dietary / allergy constraints from the profile block.
  2. STAR INGREDIENTS in USER PREFERENCES — if the user listed any,
     the recipe MUST feature EVERY one as a primary component, not
     as a garnish or afterthought. Don't substitute them away.
     Pantry rows marked "★ STARRED BY USER" are the same list.
  3. The MEAL PROMPT text — the user's direct ask ("Italian lasagna,
     Sunday dinner energy"). When it calls out a protein or dish,
     reach for it even if it isn't in their pantry; they'll source
     what's missing.
  4. MEAL TIMING — if set, the recipe MUST fit that meal (breakfast
     = breakfast dishes, dinner = dinner dishes).
  5. COURSE — a soft hint in this mode. Try to honor it, but if the
     pantry can't support it (course="bake" with zero flour/sugar/
     butter/eggs/etc.), return a structured reason="pantry_incompatible_with_course"
     so the client can suggest switching to Main or shopping first.
     Do NOT fake a category by labeling a savory skillet "Baked
     Goods." Better to admit the mismatch than produce a misleading
     draft.
  6. CUISINE / TIME / DIFFICULTY — nuance knobs applied within the
     constraints above.

Lean on the pantry as your primary source and prioritize items that
are expiring soon to reduce waste. A handful of assumed staples
(salt, pepper, oil, water) is always fine.

Lean toward creative, non-obvious combinations. When the user asks
for a draft from their pantry, boring defaults (generic pasta, plain
omelette) are a failure mode; reach for something the user might not
have thought of themselves.
`;

  // Final self-check gate. Claude reliably respects HARD CONSTRAINTS
  // more often when asked to explicitly verify its draft against
  // them before emitting. This block fires regardless of priority
  // mode; it exists because even with the category-priority
  // precedence, Claude occasionally drifts (e.g. "Crispy Hot Dog &
  // Avocado Scramble" labeled Baked Goods). The ABORT framing is
  // proven language from OpenAI-style self-critique prompts.
  const sanityCheck = prefs.course && prefs.course !== "any" ? `
FINAL SANITY CHECK — run this against your draft BEFORE emitting JSON:

  Course = ${prefs.course}:
${prefs.course === "bake" ? `    • Title must not reference meat/fish/skillet/scramble/omelet/
      breakfast-sandwich/burrito/quiche/pizza/calzone/focaccia-
      with-toppings. If it does, ABORT and rewrite as a sweet or
      plain baked good.
    • Primary cooking method must be OVEN-BAKE. No pan-fry, no
      sear, no grill, no stir-fry as the main step. If it is,
      ABORT and switch to a true bake method.
    • Output must read as a bakery-case item (served with coffee,
      for breakfast carbs, as dessert), not as a plated meal. If
      it looks like a plated dish with a bread base, ABORT.` : ""}
${prefs.course === "dessert" ? `    • Output must be sweet. If the recipe is savory in any form —
      a main disguised as dessert, a meat-containing finish, a
      savory tart — ABORT and rewrite as a true sweet.
    • Output must be a single plated serving or a small batch of
      single servings. Not a bakery loaf.` : ""}
${prefs.course === "prep" ? `    • Output must be a SINGLE COMPONENT meant to go into other
      recipes — a stock, sauce, pickle, blend, dressing, confit,
      oil, or salt. Not a plated dish. If the draft has
      "serve with" or "plate alongside" language, ABORT and
      produce a jar-of-something instead.` : ""}
${prefs.course === "main" || prefs.course === "side" || prefs.course === "appetizer" ? `    • Output must function as the requested course. Don't draft
      a sprawling three-component meal when asked for a side.
      Don't draft a dessert when asked for an appetizer.` : ""}

If ABORT fires, restart the JSON from scratch with a compliant
recipe. Do not emit the failing draft.
` : "";

  return `You are drafting a single recipe for a home cook.
${precedenceBlock}
Variety seed: ${nonce}
${hardConstraintsBlock}${avoidBlock}
PANTRY:
${pantryLines}

USER PREFERENCES:
${prefLines}
${profileBlock}${historyBlock}${sanityCheck}`;
}

// SKETCH mode prompt — title + dual IDEAL/PANTRY ingredient lists,
// no steps. Used for the rough-draft pass so the user can tweak
// proteins / cheeses / noodles before we burn the full token budget
// writing a step-by-step.
function buildSketchPrompt(
  pantry: PantryItem[],
  prefs: Prefs,
  avoidTitles: string[],
  context: RichContext,
): string {
  return `${assemblePromptHeader(pantry, prefs, avoidTitles, context)}
This is a SKETCH PASS. Return only enough for the user to confirm
the dish concept and ingredient direction — they'll tweak (swap a
protein, sub a cheese, add a side ingredient, mark something for
shopping) before we draft the full step-by-step. NO cooking
instructions, NO plating notes, NO cultural commentary.

Return ONLY a single JSON object (no markdown, no prose) with this
exact shape:

{
  "slug":         "<kebab-case-title>",
  "title":        "<short display title>",
  "subtitle":     "<one-line dish description>",         // optional, can be null
  "emoji":        "🍝",
  "cuisine":     "italian" | "french" | "mexican" | "american" | "japanese" | "thai" | "indian" | "chinese" | "mediterranean" | "other",
  "mealTiming":  "breakfast" | "lunch" | "dinner" | null,
  "course":      "main" | "side" | "dessert" | "appetizer" | "bake" | "prep" | null,
  "serves":      <integer 1..12>,
  "estimatedTime": { "prep": <minutes>, "cook": <minutes> },
  "ideal": [
    {
      "name":   "<canonical ingredient name, e.g. 'mozzarella'>",
      "amount": "<display, e.g. '8 oz'>",
      "role":   "protein" | "dairy" | "grain" | "produce" | "fat" | "spice" | "sauce" | "other"
    },
    ...
  ],
  "pantry": [
    {
      "name":             "<display name as shown in the user's pantry>",
      "amount":           "<display, e.g. '1 lb'>",
      "pantryItemId":     "<the pantry row id you grabbed, or null when shopping>",
      "ingredientId":     "<canonical id from pantry if matched, else null>",
      "subbedFrom":       "<name of the IDEAL item this replaced, or null>",
      "missingFromIdeal": <true | false>
    },
    ...
  ],
  "aiRationale": "<1-2 sentences in second person — what the dish is and why it fits this pantry. Skip generic food-writing prose.>"
}

IDEAL is the classical version of the dish — what an ideal pantry
would have. PANTRY is what the user can actually make right now,
substituting pantry rows where their kitchen forces a swap and
flagging what's missing. Always emit BOTH arrays even when they're
identical.

Rules:
  - Same precedence rules as the header above.
  - Every PANTRY entry that uses a real pantry row MUST set
    "pantryItemId" to that row's id (the "id:..." token in the
    PANTRY table). null only when this ingredient is something the
    user would need to shop for.
  - "subbedFrom" tells the user "we used Parmesan because you
    didn't have Mozzarella." null when the pantry item matches the
    ideal directly.
  - "missingFromIdeal: true" only when you ADDED something beyond
    the classical recipe (rare — e.g., the user starred an extra
    protein that doesn't traditionally go in this dish).
  - 4-12 ideal ingredients, 4-12 pantry ingredients.
  - Keep the rationale short — this is a sketch. Detail comes on
    the FINAL pass.

Return the JSON object and nothing else.`;
}

// FINAL mode prompt — full recipe with steps. Same shape Claude
// returned before the sketch / final split. Optionally accepts a
// LOCKED INGREDIENTS list (from the user's tweak phase) that
// supersedes pantry-driven choices: the model writes steps AROUND
// these exact ingredients verbatim instead of re-resolving from
// the pantry.
function buildFinalPrompt(
  pantry: PantryItem[],
  prefs: Prefs,
  avoidTitles: string[],
  context: RichContext,
  lockedIngredients: LockedIngredient[] = [],
): string {
  const lockedBlock = lockedIngredients.length > 0
    ? `\nLOCKED INGREDIENTS — the user already approved this exact set during the
sketch tweak. You MUST use ALL of them, with these names and amounts. Do NOT
add new ingredients beyond this list (other than assumed staples: salt, pepper,
oil, water). Do NOT swap or substitute.

${lockedIngredients.map((i) => {
  const amount = i.amount != null ? `${i.amount}${i.unit ? ` ${i.unit}` : ""}` : "";
  const note = i.note ? ` (${i.note})` : "";
  const src = i.source === "shopping" ? " [user will shop for]" : "";
  return `- ${i.name}${amount ? ` · ${amount}` : ""}${src}${note}`;
}).join("\n")}\n`
    : "";

  const feedbackBlock = (prefs.recipeFeedback || "").trim()
    ? `\nRECIPE FEEDBACK (most recent revision instruction — apply on top of everything above except dietary + locked ingredients):
${prefs.recipeFeedback!.trim()}\n`
    : "";

  return `${assemblePromptHeader(pantry, prefs, avoidTitles, context)}${lockedBlock}${feedbackBlock}
Return ONLY a single JSON object (no markdown, no prose) with this
exact shape. Every field is REQUIRED unless marked optional.

{
  "slug":       "<kebab-case-title>",
  "title":      "<short display title>",
  "subtitle":   "<one short line description>",        // optional, can be null
  "emoji":      "🍝",
  "cuisine":    "italian" | "french" | "mexican" | "american" | "japanese" | "thai" | "indian" | "chinese" | "mediterranean" | "other",
  "category":   "pasta" | "eggs" | "lunch" | "soup" | "salad" | "chicken" | "beef" | "pork" | "fish" | "vegetarian" | "dessert" | "sauce" | "snack" | "other",
  "mealTiming": "breakfast" | "lunch" | "dinner" | null,  // null when course is bake/prep (no plate slot)
  "course":     "main" | "side" | "dessert" | "appetizer" | "bake" | "prep" | null,
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
  "reheat": {                                           // REQUIRED when the dish keeps as a leftover
    "primary": {
      "method":   "oven" | "microwave" | "stovetop" | "air_fryer" | "toaster_oven" | "cold",
      "tempF":    <number or null for microwave/cold>,
      "timeMin":  <number of minutes — single number, not a range>,
      "covered":  <true | false | null when N/A>,
      "tips":     "<1-2 sentence specifics — 'splash of water', 'cover with foil until last 5 min', 'medium-low or the sauce breaks'>"
    },
    "alt": [                                            // OPTIONAL — 0-2 alternatives
      { "method": "...", "tempF": ..., "timeMin": ..., "covered": ..., "tips": "..." }
    ],
    "note": "<OPTIONAL quality caveat — 'eggs scramble if rushed', 'pasta gets gummy past 2 days', null if none>"
  },
                                                         // OMIT reheat entirely for dishes that MUST be eaten fresh:
                                                         //   vinaigrettes, aiolis, tartares, carpaccios, anything raw,
                                                         //   delicate foams / whipped creams, blended smoothies.
                                                         //   For these the leftover pantry flow simply shows no reheat tip.
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

  1. LOCKED INGREDIENTS (when present) are the FINAL set. Use every
     one verbatim. No additions beyond assumed staples (salt,
     pepper, oil, water). No substitutions.

  2. RECIPE FEEDBACK (when present) is the most recent revision
     directive. Apply it as a hard rule for technique / seasoning /
     timing — the only things it CAN'T override are dietary
     constraints and the locked ingredient list.

  3. USER NOTES / MEAL PROMPT WIN. If the user asked for a specific
     protein, dish, or cuisine, honor it even if nothing in the
     pantry supports it. Non-pantry ingredients are fine in that
     case — just list them plainly. Do NOT redirect to a pantry-
     fitting dish when the user has a clear ask.

  4. Respect dietary constraints in the PROFILE block if present.
     If the user is vegetarian/vegan, do not propose meat or fish
     even if the pantry contains it (their family may have added
     it) AND even if the user's notes mention one. Dietary beats
     notes — call out the conflict in the aiRationale.

  5. When the user has NOT asked for something specific, prefer
     recipes that use pantry items marked "EXPIRED" or "expires in Nd"
     where N is small. Reducing waste is the default goal.

  6. EVERY pantry item you use must appear as an ingredient with
     the matching "ingredientId" when the pantry item carried a
     canonicalId. Leave "ingredientId" null for staples you assumed
     (salt, pepper, oil) and for any non-pantry ingredients you
     added because the user asked for them.

  7. ALWAYS produce at least 4 steps and 4 ingredients.

  7a. EVERY step must carry a "uses" array listing the ingredients
      consumed AT that step with the amount used at that step. If
      an ingredient spans multiple steps (eggs split between batter
      and wash), it legitimately appears in more than one step
      with partial amounts that sum to the top-level ingredients[]
      amount. If a step is purely action-only (plate, rest, serve),
      "uses" may be an empty array.

  7b. Add "heat" whenever a step involves a burner/oven/grill — it
      helps the cook dial in the stove without rereading the prose.
      Omit for prep steps.

  7c. Add "doneCue" whenever the step has a qualitative readiness
      signal ("onions translucent, not brown"; "pasta has 1 minute
      less than package says"). Skip for trivial steps.

  8. Keep total time reasonable — prep + cook ≤ 90 min unless the
     user asked for a long recipe.

  9. Keep the slug short, lowercase, hyphenated. No trailing hyphens.

  10. Respect the skill level implied by profile.level and
      topSkills. A "beginner" shouldn't get a five-step braise; an
      "advanced" cook is bored by scrambled eggs.

  11. The aiRationale field is how the user finds out WHY you picked
      this dish. Make it specific and grounded in what you saw in
      the context. If you honored an explicit user ask OVER the
      expiring items, say so ("You asked for shrimp, so I skipped
      the cream that's about to turn — save it for a pasta
      tomorrow"). Don't pad with generic food-writing prose.

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
    mode?: "sketch" | "final";
    pantry?: PantryItem[];
    prefs?: Prefs;
    avoidTitles?: string[];
    context?: RichContext;
    lockedIngredients?: LockedIngredient[];
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400, headers: JSON_HEADERS,
    });
  }

  // Default mode = "final" so existing callers (and the legacy
  // single-pass flow) keep working unchanged. Sketch mode is opt-in
  // from the new tweak-loop UI.
  const mode: "sketch" | "final" = body.mode === "sketch" ? "sketch" : "final";
  const pantry = Array.isArray(body.pantry) ? body.pantry : [];
  const prefs = body.prefs || {};
  const context = body.context || null;
  const lockedIngredients = Array.isArray(body.lockedIngredients)
    ? body.lockedIngredients.filter((x): x is LockedIngredient => !!x && typeof x === "object")
    : [];
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
        // Both modes get the full 2500-token budget. Earlier attempts
        // to trim sketch to 1000 / 1600 kept truncating mid-JSON on
        // larger pantries (10+ ingredients × IDEAL+PANTRY arrays).
        // Token cost is secondary to not failing; a truncated draft
        // is worse than an expensive one.
        max_tokens: 2500,
        // temperature=1 is the API default but we set it explicitly so
        // nobody accidentally pins it to 0 during debugging and wipes
        // out regen variety without realizing why.
        temperature: 1,
        messages: [
          {
            role: "user",
            content: [{
              type: "text",
              text: mode === "sketch"
                ? buildSketchPrompt(pantry, prefs, avoidTitles, context)
                : buildFinalPrompt(pantry, prefs, avoidTitles, context, lockedIngredients),
            }],
          },
          // Prefill the assistant with "{" so Claude MUST continue
          // from valid-JSON start. No preface ("Here's your recipe:"),
          // no markdown fences, no trailing commentary. Handles the
          // couldn't-parse 502s we were seeing from a chatty model.
          // We prepend "{" back to the response before parsing.
          {
            role: "assistant",
            content: [{ type: "text", text: "{" }],
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
  // The request prefilled the assistant with "{", so Claude returns
  // the body AFTER the opening brace. Prepend it back so we parse
  // a whole object. Fall back to "{}" if Anthropic gave us nothing.
  const rawBody = data?.content?.[0]?.text ?? "";
  const raw = rawBody ? `{${rawBody}` : "{}";

  // Tolerant JSON extraction as a safety net. Even with prefill,
  // Claude may still wrap output in fences or produce a truncated
  // response on a complex pantry. Strip fences first; if a direct
  // parse fails, carve out between the first { and last } and try
  // that. Catches both chatty-model and mid-JSON-truncation cases.
  const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
  let recipe: Record<string, unknown>;
  try {
    recipe = JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last  = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const sliced = cleaned.slice(first, last + 1);
      try {
        recipe = JSON.parse(sliced);
      } catch {
        return new Response(
          JSON.stringify({
            error: "couldn't parse model output as JSON",
            detail: "model returned non-JSON content; tried both direct and brace-slice parse",
            raw,
          }),
          { status: 502, headers: JSON_HEADERS },
        );
      }
    } else {
      return new Response(
        JSON.stringify({
          error: "couldn't parse model output as JSON",
          detail: "no JSON object found in model response",
          raw,
        }),
        { status: 502, headers: JSON_HEADERS },
      );
    }
  }

  // Sketch mode response — narrower shape. Title + IDEAL + PANTRY
  // arrays only. No steps, no tools, no per-step uses. Validator
  // gets a relaxed schema so an answer missing `steps` doesn't
  // 502 the way it would for a full cook.
  if (mode === "sketch") {
    if (!recipe || typeof recipe !== "object" ||
        typeof recipe.title !== "string" ||
        !Array.isArray(recipe.ideal) ||
        !Array.isArray(recipe.pantry)) {
      return new Response(
        JSON.stringify({ error: "sketch returned an unexpected shape", raw }),
        { status: 502, headers: JSON_HEADERS },
      );
    }
    const sketch = {
      slug:        recipe.slug       || slugify(recipe.title as string),
      title:       recipe.title,
      subtitle:    recipe.subtitle   ?? null,
      emoji:       recipe.emoji      || "🍽️",
      cuisine:     recipe.cuisine    || "other",
      mealTiming:  normalizeMealTiming(recipe.mealTiming),
      course:      normalizeCourse(recipe.course),
      serves:      clampInt(recipe.serves, 1, 12, 2),
      estimatedTime: recipe.estimatedTime || recipe.time || { prep: 10, cook: 20 },
      ideal:       Array.isArray(recipe.ideal)  ? recipe.ideal  : [],
      pantry:      Array.isArray(recipe.pantry) ? recipe.pantry : [],
      aiRationale: typeof recipe.aiRationale === "string"
        ? String(recipe.aiRationale).slice(0, 400).trim() || null
        : null,
    };
    return new Response(JSON.stringify({ sketch }), { headers: JSON_HEADERS });
  }

  // FINAL mode response — full recipe with steps. Same validation as
  // before the mode split.
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
    // Preserve meal-composition tags the user picked (breakfast vs
    // dinner, main vs side vs dessert vs appetizer). Claude returns
    // them in its JSON; without this passthrough they were getting
    // dropped during normalization, stripping the filter/grouping
    // signal from every saved recipe.
    mealTiming: normalizeMealTiming(recipe.mealTiming),
    course:     normalizeCourse(recipe.course),
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

// Whitelist the meal-composition enum values so a chatty model that
// invents "brunch" or "starter" doesn't poison the saved recipe with a
// value the UI can't render. Returns null for anything unrecognized.
const MEAL_TIMING_VALUES = new Set(["breakfast", "lunch", "dinner"]);
const COURSE_VALUES      = new Set(["main", "side", "dessert", "appetizer", "bake", "prep"]);
function normalizeMealTiming(v: unknown): string | null {
  return typeof v === "string" && MEAL_TIMING_VALUES.has(v) ? v : null;
}
function normalizeCourse(v: unknown): string | null {
  return typeof v === "string" && COURSE_VALUES.has(v) ? v : null;
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
