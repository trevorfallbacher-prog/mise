import { useEffect, useMemo, useState } from "react";
import { generateRecipe, classifyDishPrompt } from "../lib/generateRecipe";
import { suggestCookInstructions } from "../lib/suggestCookInstructions";
import { buildAIContext } from "../lib/aiContext";
import { totalTimeMin, difficultyLabel } from "../data/recipes";
import {
  findIngredient,
  coerceRecipeCanonicalIds,
} from "../data/ingredients";
import {
  extractDietaryClaims,
  namesMatch,
  normalizeForMatch,
  resolveNameToCanonicalId,
  sameCanonicalFamily,
  deriveRowHeader,
  deriveRowCut,
  pairRecipeIngredients,
  describePairing,
} from "../lib/recipePairing";
import { recipeNutrition, formatMacros } from "../lib/nutrition";
import { useBrandNutrition } from "../lib/useBrandNutrition";

// Kick off a Claude-drafted recipe from the user's pantry. Three phases:
//   setup   — meal prompt + star ingredients + timing/course + nuance chips,
//             tap DRAFT to call the edge fn
//   loading — skeleton while the edge function is running
//   preview — show the generated recipe; four actions below
//
// Preview action bar (four buttons):
//   ↻ REGEN    — back to setup, same prefs
//   SAVE       — onSave(recipe) → persist privately, close
//   📅 SCHED   — onSchedule(recipe) → parent persists (shared=true)
//                and opens SchedulePicker
//   COOK IT    — onSaveAndCook(recipe) → persist + enter CookMode
//
// The parent (CreateMenu) owns the shared/private semantics. This
// component just emits events.

const CUISINE_CHIPS = [
  { id: "any",      label: "Any cuisine"   },
  { id: "italian",  label: "Italian"       },
  { id: "french",   label: "French"        },
  { id: "mexican",  label: "Mexican"       },
  { id: "american", label: "American"      },
  { id: "japanese", label: "Japanese"      },
  { id: "thai",     label: "Thai"          },
  { id: "indian",   label: "Indian"        },
];

const TIME_CHIPS = [
  { id: "quick",  label: "≤30 min" },
  { id: "medium", label: "≤60 min" },
  { id: "long",   label: "Long cook" },
];

const DIFFICULTY_CHIPS = [
  { id: "easy",     label: "Easy"    },
  { id: "medium",   label: "Medium"  },
  { id: "advanced", label: "Advanced"},
];

// When is the user eating this? A breakfast dish and a dinner entrée
// draft very differently; telling Claude the intended meal time keeps
// it from suggesting pancakes for dinner unless asked.
const MEAL_TIMING_CHIPS = [
  { id: "any",       label: "Any time" },
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch",     label: "Lunch" },
  { id: "dinner",    label: "Dinner" },
];

// Course type. Mains carry the meal, sides support it, desserts sit
// on their own track. Same dish title can read very differently
// depending on which of these Claude is aiming for.
const COURSE_CHIPS = [
  { id: "any",       label: "Any course" },
  { id: "main",      label: "Main" },
  { id: "side",      label: "Side" },
  { id: "dessert",   label: "Dessert" },
  { id: "appetizer", label: "Appetizer" },
  // "Baked Goods" and "Prep" are component recipes (bread, stock,
  // sauce, pickles, pastry) that live in the library without a meal
  // slot. Selecting them hides MEAL TIMING since these aren't tied to
  // breakfast/lunch/dinner — they're pantry/bakery-case items.
  //
  // Label says "Baked Goods" rather than just "Bake" because users
  // kept getting meals-on-bread (pesto focaccia topped with burrata,
  // pizza, savory galettes) when they picked "Bake" — the plain verb
  // read as "put something in the oven" and Claude happily obliged
  // with sheet-pan dinners disguised as flatbreads. "Baked Goods"
  // primes the bakery-case mental model. Edge-fn prompt reinforces
  // it with an explicit exclusion list. Oven-roasted mains stay under
  // "Main" where they belong.
  { id: "bake",      label: "Baked Goods" },
  { id: "prep",      label: "Prep" },
];

// PRIORITY chips — which side of the "I want X / I have Y" tension
// wins. Only meaningful when a course is set (see buildPrefs). The
// emojis pre-prime the user: 🎯 = category/target, 📦 = pantry/use
// what's there.
const PRIORITY_CHIPS = [
  { id: "category", label: "🎯 Follow the category" },
  { id: "pantry",   label: "📦 Use my pantry"       },
];

// Canonical ids that count as "protein" for the STAR INGREDIENTS
// picker when the pantry row's category isn't in the meat/poultry/
// seafood set. Keeps eggs / tofu / beans from being filtered out.
const PLANT_PROTEIN_SLUGS = new Set([
  "eggs", "egg_whites", "tofu", "tempeh", "beans", "lentils",
  "chickpeas", "black_beans", "kidney_beans", "pinto_beans",
  "white_beans", "edamame", "peanut_butter",
]);
const PROTEIN_CATEGORIES = new Set(["meat", "poultry", "seafood"]);

// Is a pantry row "proteiny enough" to show up in the STAR picker?
// Shows meat/poultry/seafood from the canonical registry + a hand-
// picked set of plant / egg / dairy proteins.
function isProteinRow(row) {
  const canon = row?.ingredientId ? findIngredient(row.ingredientId) : null;
  if (canon && PROTEIN_CATEGORIES.has(canon.category)) return true;
  const slug = row?.ingredientId || row?.canonicalId;
  if (slug && PLANT_PROTEIN_SLUGS.has(slug)) return true;
  return false;
}

// Split an ideal name on alternative separators into candidate sub-
// names. Claude frequently emits "ciabatta or crusty bread" / "salt &
// black pepper" / "penne, rigatoni" — those are alternatives, not
// compound identities, and matching the literal compound against the
// pantry fails on both sides: "ciabatta or crusty bread" isn't a
// substring of "Ciabatta Roll" (false negative), and a broad category
// fallback on a loose resolver sweep pulls in unrelated rows (false
// positive). Splitting lets each alternative resolve to its own
// canonical and match cleanly.
const NAME_SEPARATOR_RE = /\s+or\s+|\s+and\s+|\s*[&/,]\s*/i;
function splitIdealName(name) {
  if (!name) return [];
  const parts = String(name)
    .split(NAME_SEPARATOR_RE)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [String(name)];
}

// Scan the user's actual pantry for rows that can cover a sketch.pantry
// row Claude marked as shopping (pantryItemId == null). Returns a
// map { sketchPantryIdx → pantryRowId } of recommended auto-pairs.
//
// Why this exists: the AI frequently emits a sketch.pantry row with
// pantryItemId: null ("you need to buy tortillas") even when the
// user's real pantry has a matching item. The ingredientEntries
// pairing code then renders that row as "matched" — it's not
// `missing`, so findRawPantryCandidates never runs — and the user
// sees "NOT IN PANTRY — SHOPPING" on an item they already own. Plus
// the top-line coverage count reads "you have everything" because
// the sketch.pantry length equals the ideal length, regardless of
// whether any of those rows trace back to a real pantryItemId.
//
// Auto-pair fixes both: we promote the real pantry row into the
// pantryEdits.swaps diff before first render, so `showRow` resolves
// cleanly and the green "FROM your pantry" tag lights up. The swap
// is rendered as "⚡ AUTO-PAIRED" (not ✓ FROM) so the substitution
// is visible and the user can still tap SWAP to override.
//
// Rules:
//   - Never steal a pantry row another sketch.pantry row already
//     claims via pantryItemId.
//   - Tier 1: canonical-id match (sketch row's ingredientId or
//     resolved-from-name canonical ↔ pantry row's ingredientId).
//   - Tier 2: name-fuzzy match via namesMatch — catches free-text
//     user pantry rows without canonical ids.
function autoPairShoppingRows(sketch, pantry) {
  const swaps = {};
  if (!sketch || !Array.isArray(sketch.pantry) || !Array.isArray(pantry)) return swaps;
  const used = new Set();
  for (const row of sketch.pantry) {
    if (row && row.pantryItemId) used.add(row.pantryItemId);
  }
  sketch.pantry.forEach((row, j) => {
    if (!row || row.pantryItemId) return;
    const canonId = row.ingredientId || resolveNameToCanonicalId(row.name) || null;
    let found = null;
    if (canonId) {
      // Exact canonical OR same-hub family ("chicken" hub ↔ "chicken_breast"
      // cut). Without the family check, a recipe asking for generic Chicken
      // fails to auto-pair with the user's Chicken Breast and the row
      // misrenders as NOT IN PANTRY — SHOPPING.
      found = pantry.find(p => {
        if (!p || used.has(p.id)) return false;
        const pSlug = p.ingredientId || p.canonicalId || null;
        if (!pSlug) return false;
        return sameCanonicalFamily(pSlug, canonId);
      });
    }
    if (!found && row.name) {
      found = pantry.find(p =>
        p && !used.has(p.id) && namesMatch(p.name, row.name),
      );
    }
    if (found) {
      used.add(found.id);
      swaps[j] = found.id;
    }
  });

  // Spurious-sub auto-correct. The AI occasionally substitutes when
  // the pantry HAS the exact ideal — "classic calls for flour
  // tortillas, we subbed Croissant Rolls" while Mission Tortillas
  // sits right there. Prompt rules push against this but belt-and-
  // suspenders: for every sketch.pantry row with a subbedFrom, try
  // resolving the original to a canonical and check if the user's
  // real pantry has a direct family match. If yes, override the
  // sketch's chosen row with the canonical match — user still sees
  // the swap affordance and can re-substitute if they actually
  // wanted the AI's sub.
  sketch.pantry.forEach((row, j) => {
    if (!row || !row.subbedFrom) return;
    const origSlug = resolveNameToCanonicalId(row.subbedFrom);
    if (!origSlug) return;
    const directMatch = pantry.find(p => {
      if (!p || used.has(p.id)) return false;
      const pSlug = p.ingredientId || p.canonicalId || null;
      if (!pSlug) return false;
      return sameCanonicalFamily(pSlug, origSlug);
    });
    if (!directMatch) return;
    // If the AI already pointed this row at directMatch, leave it
    // alone — nothing to correct.
    if (row.pantryItemId === directMatch.id) return;
    used.add(directMatch.id);
    swaps[j] = directMatch.id;
  });
  return swaps;
}

// Walk a sketch and stamp each ideal slot with the dietary claims
// extracted from its name. Non-destructive copy. The claims travel
// with the slot from ingestion through render so the swap/pair UI
// can diff them against the paired pantry row's attributes.claims
// and flag "⚠ NO LONGER VEGAN" when the user takes a non-compliant
// substitution.
// MUST-INCLUDE picker renderer — pulled out of the main component
// body so the JSX + filter logic doesn't bloat the setup phase. Not
// a React component (no hooks of its own); just a render helper that
// takes the shared state bag and returns the <Section> block.
function renderStarPicker({
  starOptionGroups,
  starIngredientIds,
  setStarIngredientIds,
  starSearch,
  setStarSearch,
}) {
  const q = starSearch.trim().toLowerCase();
  // Default state (empty search) shows NOTHING — a 100-row pantry
  // dumped as chips is unusable. The user either searches for
  // something specific ("crisco", "ricotta") or taps one of their
  // already-selected chips. Matching groups only render while a
  // search is active.
  const filteredGroups = q
    ? starOptionGroups
        .map(g => ({ ...g, items: g.items.filter(o => o.label.toLowerCase().includes(q)) }))
        .filter(g => g.items.length > 0)
    : [];
  const allOptions = starOptionGroups.flatMap(g => g.items);
  // Currently-selected chips always pin at the top — they're the
  // user's own picks, not noise, and they need to be tappable to
  // remove without re-searching.
  const selectedOptions = starIngredientIds
    .map(id => allOptions.find(o => o.id === id))
    .filter(Boolean);
  // Drop the search id set from result groups so a selected chip
  // doesn't render twice (once in SELECTED, once in search results).
  const selectedIdSet = new Set(starIngredientIds);
  const visibleGroups = filteredGroups.map(g => ({
    ...g,
    items: g.items.filter(o => !selectedIdSet.has(o.id)),
  })).filter(g => g.items.length > 0);

  return (
    <Section label="MUST INCLUDE — star any pantry item">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="text"
          value={starSearch}
          onChange={(e) => setStarSearch(e.target.value)}
          placeholder="Search pantry (e.g. crisco, ricotta, gochujang)"
          style={{
            width: "100%", padding: "10px 12px",
            background: "#0f0f0f", color: "#f0ece4",
            border: "1px solid #2a2a2a", borderRadius: 8,
            fontFamily: "'DM Sans',sans-serif", fontSize: 13,
            outline: "none",
          }}
        />
        {/* SELECTED chips always pin at the top once they've been
            added — independent of what's in the search box. Tapping
            removes. */}
        {selectedOptions.length > 0 && (
          <div>
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 9,
              color: "#f5c842", letterSpacing: "0.1em",
              marginBottom: 6,
            }}>
              SELECTED ({selectedOptions.length})
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {selectedOptions.map(o => (
                <button
                  key={o.id}
                  onClick={() => setStarIngredientIds(prev => prev.filter(id => id !== o.id))}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 12px",
                    background: "#1e1a0e",
                    border: "1px solid #f5c842",
                    color: "#f5c842",
                    borderRadius: 20,
                    fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 14 }}>{o.emoji}</span>
                  {o.label}
                  <span style={{ opacity: 0.6, marginLeft: 4 }}>×</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Empty state: nothing searched AND nothing selected → a
            one-liner hint instead of a wall of chips. Users asked
            explicitly NOT to dump the whole pantry by default. */}
        {!q && selectedOptions.length === 0 && (
          <div style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
            color: "#666", fontStyle: "italic",
          }}>
            Type to search your pantry — e.g. &quot;crisco&quot;, &quot;ricotta&quot;,
            &quot;gochujang&quot;. Pick anything the dish MUST include.
          </div>
        )}
        {q && visibleGroups.length === 0 && (
          <div style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
            color: "#666", fontStyle: "italic",
          }}>
            No pantry items match &quot;{starSearch}&quot;.
          </div>
        )}
        {visibleGroups.map(group => (
          <div key={group.key}>
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 9,
              color: "#666", letterSpacing: "0.1em",
              marginBottom: 6,
            }}>
              {group.label.toUpperCase()}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {group.items.map(o => {
                const active = starIngredientIds.includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => setStarIngredientIds(prev => (
                      active ? prev.filter(id => id !== o.id) : [...prev, o.id]
                    ))}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "7px 12px",
                      background: active ? "#1e1a0e" : "#161616",
                      border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                      color: active ? "#f5c842" : "#888",
                      borderRadius: 20,
                      fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                      cursor: "pointer", transition: "all 0.2s",
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{o.emoji}</span>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function stampDietaryClaims(sketch) {
  if (!sketch || !Array.isArray(sketch.ideal)) return sketch;
  return {
    ...sketch,
    ideal: sketch.ideal.map(row => {
      if (!row || typeof row !== "object") return row;
      const { claims } = extractDietaryClaims(row.name);
      if (claims.length === 0) return row;
      return { ...row, dietaryClaims: claims };
    }),
  };
}


export default function AIRecipe({
  pantry = [],
  profile,          // viewer's profile row (dietary, level, skill_levels, …)
  cookLogs = [],    // viewer's recent cook_log rows for the history summary
  ingredientInfo,   // the useIngredientInfo() context — optional
  onCancel,
  onSave,           // (recipe) => Promise — persist privately, then close
  onSilentSave,     // (recipe) => Promise<persistedRecipe> — persist
                    // WITHOUT toasting or closing. Used by the compose-
                    // a-meal flow to lock the anchor in user_recipes
                    // before re-entering setup for a side/dessert.
                    // Falls back to onSave when parent didn't provide.
  onSchedule,       // (recipe) => Promise — parent persists + opens SchedulePicker
  onSaveAndCook,    // (recipe) => Promise — existing save + cook path
  onMealSave,       // ({ name, emoji, cuisine, mealTiming, anchorSlug, pieces })
                    // => Promise<meal> — parent persists a MEAL row
                    // (meals + meal_recipes). Called from the sticky
                    // header's SAVE MEAL CTA once the user has two+
                    // pieces composed. Optional — when absent, the
                    // CTA just closes the overlay and leaves pieces
                    // as loose recipes in the library.
  onShoppingAdd,    // (items[]) => void — receives the locked ingredients
                    // promoted to shopping in the tweak phase so the
                    // parent can merge them into the shoppingList state.
                    // Optional — when absent the promotions still show
                    // in the recipe with a "user will pick up" note
                    // but don't land on the actual shopping list.
  // Library sources used by the "Pick existing" path of the compose
  // flow — filtered to course=target (side/dessert/appetizer) and
  // soft-sorted by cuisine/timing match to the anchor.
  userRecipes = [], // [{ id, recipe, source }, ...] from useUserRecipes
  bundledRecipes = [],
}) {
  // Brand-nutrition lookup for the per-serving rollup. Wrapped in a
  // Map-like shape so the resolver's signature stays source-agnostic.
  const { get: getBrandNutrition } = useBrandNutrition();
  const brandNutrition = useMemo(
    () => ({ get: (k) => getBrandNutrition?.(k) || null }),
    [getBrandNutrition],
  );

  const [phase,  setPhase]  = useState("setup");     // setup | sketch_loading | tweak | final_loading | preview | error
  const [recipe, setRecipe] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  // Titles we've already shown the user this session — handed to the
  // edge function on every draft so REGEN produces a genuinely
  // different dish instead of converging on the same one every time.
  const [previousTitles, setPreviousTitles] = useState([]);
  // Per-action busy state so exactly one button shows SAVING… and
  // the other two stay tappable / disabled appropriately.
  const [busy,   setBusy]   = useState(null);         // null | "save" | "schedule" | "cook"

  // Sketch + tweak state. The sketch holds the rough draft (title +
  // dual IDEAL/PANTRY ingredient lists, no steps). pantryEdits is
  // the diff the user applied during the tweak phase: per-row
  // swaps to a different pantry item, removes, extra adds (e.g.
  // "throw in egg whites"), and ideal items promoted to shopping
  // ("yes I'll buy the mozzarella"). Combined into the locked
  // ingredient list on COOK THIS.
  const [sketch, setSketch] = useState(null);
  const [pantryEdits, setPantryEdits] = useState({
    swaps:    {},          // sketch.pantry index → pantry row id
    removes:  new Set(),   // sketch.pantry indices the user dropped
    adds:     [],          // [{ name, amount, ingredientId, pantryItemId, emoji }]
    shopping: new Set(),   // sketch.ideal indices the user wants on the shopping list
  });
  // Inline picker open state. swapOpenIdx = which pantry-row's swap
  // popover is open (null = none). addOpen = "+ ADD" picker visible.
  // swapSearch is the live filter query inside the open swap popover
  // — resets every time a different row's picker opens.
  const [swapOpenIdx, setSwapOpenIdx] = useState(null);
  const [swapSearch,  setSwapSearch]  = useState("");
  const openSwapPicker = (idx) => {
    setSwapOpenIdx(idx);
    setSwapSearch("");
  };
  const [addOpen, setAddOpen]         = useState(false);
  // Revision instruction for the FINAL cook — the user's "make it
  // spicier, skip the garlic in the steps" note. Sent as
  // prefs.recipeFeedback on the second call.
  const [recipeFeedback, setRecipeFeedback] = useState("");

  // Prefs. mealPrompt is the hero input — renamed from "notes" to
  // signal that the user is DIRECTING an AI, not scribbling a
  // secondary note. Lives at the top of the setup screen.
  const [mealPrompt, setMealPrompt] = useState("");
  // Dish contract (classified from mealPrompt). Session-cached so
  // regens don't re-classify. Three tiers:
  //   SPECIFIC  → aliases + rules injected into the prompt; deterministic
  //               post-check enforces that the output title matches.
  //   FAMILY    → family + examples injected; output must fit the family.
  //   OPEN      → (empty mealPrompt) drop pantry entirely, dream mode.
  //   FREEFORM  → (unrecognizable text) fall back to verbatim quoting.
  // classifiedPromptRef tracks which mealPrompt produced the current
  // contract so re-typing the SAME text doesn't refire the Haiku call.
  const [dishContract, setDishContract] = useState(null);
  const [classifiedFrom, setClassifiedFrom] = useState("");
  const [mealTiming, setMealTiming] = useState("any");
  const [course,     setCourse]     = useState("any");
  // Priority mode — which side of the "I want X / I have Y" tension
  // wins when the two conflict. "category" (default) makes the course
  // constraint authoritative and filters the pantry palette to
  // compatible items (bake = flour/sugar/butter/eggs/etc, not hot
  // dogs). "pantry" keeps the old behavior where Claude drafts around
  // whatever's stocked and bends the course to fit. Hidden from the
  // UI when course === "any" — no tension to resolve.
  const [priority,   setPriority]   = useState("category");
  const [starIngredientIds, setStarIngredientIds] = useState([]);
  // Search query for the MUST-INCLUDE picker. Filters starOptionGroups
  // by substring (case-insensitive) against item labels so a user
  // searching "crisco" in a 104-row pantry doesn't have to scroll.
  const [starSearch, setStarSearch] = useState("");
  const [cuisine,    setCuisine]    = useState("any");
  const [time,       setTime]       = useState("medium");
  const [difficulty, setDifficulty] = useState("medium");

  // Compose-a-meal state. pairWith carries the anchor dish's identity
  // into Claude's prompt so a side/dessert/appetizer is drafted to
  // COMPLEMENT the main (contrast, balance, no duplicated protein)
  // rather than in isolation. mealInProgress tracks every piece the
  // user has committed to this meal so the sticky header can render
  // the composition. Each piece's `recipe` is the row we actually
  // persisted to user_recipes — pieces are reusable standalone
  // recipes, not meal-owned rows.
  const [pairWith,        setPairWith]        = useState(null);
  //   { title, course, cuisine, ingredients: [{name, amount}] } | null
  const [mealInProgress,  setMealInProgress]  = useState(null);
  //   { anchor: recipe, pieces: [{ course, recipe }] } | null

  // "+ Add X" sheet state. When non-null, the two-option sheet
  // ("Draft new" / "Pick existing") is open for this course.
  const [addSheetCourse,  setAddSheetCourse]  = useState(null);
  //   null | "side" | "dessert" | "appetizer"
  // When non-null, the library picker is open, filtered to this course.
  const [pickExistingFor, setPickExistingFor] = useState(null);
  //   null | "side" | "dessert" | "appetizer"

  // Protein picker source — collapse the pantry to one chip per
  // canonical (5 cans of tuna = one TUNA chip, not five) and group
  // by category so the user can scan MEAT / POULTRY / SEAFOOD /
  // PLANT at a glance instead of reading a wall of chips. Uses the
  // canonical's full `name` (not `shortName`) so "Ground Beef" and
  // "Ground Pork" don't both read as just "Ground."
  // MUST-INCLUDE picker — the full pantry (not just proteins).
  // Previously this was gated to meat/poultry/seafood + a hand-picked
  // plant-protein set, but users (rightly) wanted to tag things like
  // Crisco, tortillas, brown butter, or a specific cheese when that
  // ingredient was the POINT of the dish. Now every pantry row with
  // kind="ingredient" (i.e. not a compound dish or leftover) is
  // pickable. A search input sits above the groups so finding one
  // item in a 100-row pantry doesn't require scrolling.
  //
  // Grouping: prefer meat/poultry/seafood/dairy/produce/grains/fats/
  // pantry/frozen in that visual order; anything with an unknown
  // category falls under "Other" at the end.
  const starOptionGroups = useMemo(() => {
    const byCanonical = new Map();
    for (const row of pantry) {
      // Compound dishes (frozen pizzas) and leftovers (last night's
      // rice) carry ingredientIds but aren't pickable as "must
      // include" tags — you don't build a dish around the fact that
      // you have a leftover.
      if (row?.kind && row.kind !== "ingredient") continue;
      const slug = row.ingredientId || row.canonicalId;
      if (!slug) continue;
      if (!byCanonical.has(slug)) {
        const canon = findIngredient(slug);
        byCanonical.set(slug, {
          id: slug,
          label: canon?.name || row.name || slug,
          emoji: row.emoji || canon?.emoji || "🍽️",
          category: canon?.category || row.category || null,
          slug,
        });
      }
    }
    const categoryOrder = [
      { key: "meat",     label: "Meat" },
      { key: "poultry",  label: "Poultry" },
      { key: "seafood",  label: "Seafood" },
      { key: "dairy",    label: "Dairy & eggs" },
      { key: "produce",  label: "Produce" },
      { key: "grains",   label: "Grains & starches" },
      { key: "fats",     label: "Fats & oils" },
      { key: "pantry",   label: "Pantry" },
      { key: "frozen",   label: "Frozen" },
      { key: "beverage", label: "Beverages" },
      { key: "other",    label: "Other" },
    ];
    const groups = new Map(categoryOrder.map(c => [c.key, { ...c, items: [] }]));
    // Map a handful of equivalent category strings to the canonical
    // bucket keys above. Anything unmapped lands under "other" so the
    // picker never silently loses a pantry row.
    const CATEGORY_BUCKET = {
      meat: "meat", poultry: "poultry", seafood: "seafood",
      dairy: "dairy", egg: "dairy", eggs: "dairy",
      produce: "produce", fruit: "produce", vegetable: "produce",
      grain: "grains", grains: "grains", starch: "grains", bread: "grains", pasta: "grains", rice: "grains",
      fat: "fats", fats: "fats", oil: "fats", oils: "fats",
      pantry: "pantry", condiment: "pantry", spice: "pantry", sauce: "pantry", baking: "pantry",
      frozen: "frozen",
      beverage: "beverage", drink: "beverage",
    };
    for (const opt of byCanonical.values()) {
      const bucket = CATEGORY_BUCKET[opt.category] || "other";
      groups.get(bucket).items.push(opt);
    }
    const out = [];
    for (const c of categoryOrder) {
      const g = groups.get(c.key);
      if (g.items.length === 0) continue;
      g.items.sort((a, b) => a.label.localeCompare(b.label));
      out.push(g);
    }
    return out;
  }, [pantry]);

  const pantryCount = pantry.length;

  // Shared prefs payload — both the sketch and final calls assemble
  // the same set; only mode + lockedIngredients differ.
  const buildPrefs = (extra = {}) => {
    // bake/prep courses don't belong to a meal slot — drop any stale
    // mealTiming so the backend's HARD CONSTRAINTS block doesn't get a
    // "breakfast" tag on a chicken-stock prep.
    const isComponentCourse = course === "bake" || course === "prep";
    return {
      cuisine, time, difficulty,
      mealPrompt: mealPrompt.trim() || undefined,
      mealTiming: (isComponentCourse || mealTiming === "any") ? undefined : mealTiming,
      course: course === "any" ? undefined : course,
      // Always send priority on BOTH sketch and final — the edge fn
      // previously had an inconsistency where the final pass dropped
      // priority when course="any" and the edge fn silently defaulted
      // it back to "category", flipping precedence mid-session. The
      // user's "category-first" vs "pantry-first" intent is authoritative
      // on every call in the draft.
      priority,
      starIngredientIds: starIngredientIds.length ? starIngredientIds : undefined,
      // Compose-a-meal anchor. Only present when the user clicked
      // "+ Add side/dessert/appetizer" from a main's preview; Claude
      // uses it to build something that complements rather than
      // duplicates the anchor.
      pairWith: pairWith || undefined,
      ...extra,
    };
  };

  // Resolve the dish contract for the current mealPrompt. Cached by
  // the exact string so re-typing the same prompt doesn't refire the
  // Haiku call; regens within a session reuse the contract.
  const ensureContract = async () => {
    const target = (mealPrompt || "").trim();
    if (dishContract && classifiedFrom === target) return dishContract;
    const c = await classifyDishPrompt(target);
    setDishContract(c);
    setClassifiedFrom(target);
    return c;
  };

  // Phase 2 entry — kicks off the cheap sketch pass. User lands on
  // the tweak screen with the rough draft + dual IDEAL/PANTRY lists,
  // can swap / remove / add / promote-to-shopping / type feedback,
  // then taps COOK THIS to fire the final full-recipe call.
  const start = async () => {
    setPhase("sketch_loading");
    setErrMsg("");
    try {
      const isRegen = previousTitles.length > 0;
      const contract = await ensureContract();
      const isDreamMode = contract?.tier === "OPEN";
      const built = buildAIContext({
        pantry, profile, ingredientInfo, cookLogs,
        mode: isRegen ? "lean" : "rich",
        starIngredientIds,
        // filterPantryByCourse is a no-op when course is "any" (no
        // compatibility set) or priority is "pantry" — pass both
        // through unconditionally; the filter does the gating.
        course:   course === "any" ? undefined : course,
        priority,
      });
      const payload = {
        mode: "sketch",
        // OPEN/dream mode: drop the pantry entirely — Claude dreams
        // without any "use what's here" pressure. User's dietary
        // constraints + cook history still ride through `context`.
        pantry: isDreamMode ? [] : built.pantry,
        prefs: buildPrefs({
          pantryFiltered: isDreamMode ? false : built.pantryFiltered,
          dishContract: contract || undefined,
        }),
        avoidTitles: previousTitles,
        context: built.context,
      };
      const result = await generateRecipe(payload);
      // Graceful fallback — if the edge function hasn't been
      // redeployed with Phase 2, the client sees { recipe }
      // instead of { sketch } and we skip tweak entirely, landing
      // in preview with the single-pass result. Logs so the user
      // knows they need to deploy to unlock the tweak flow.
      if (result.fellBackToFinal) {
        // eslint-disable-next-line no-console
        console.warn("[AIRecipe] generate-recipe edge fn predates Phase 2 (sketch mode) — deploy `supabase functions deploy generate-recipe` to enable the tweak flow.");
        // Pipe every ingredientId through coerceRecipeCanonicalIds so
        // the recipe we persist + render is strictly bound to the
        // canonical registry. Claude occasionally drifts ("fresh
        // tortillas" vs "tortillas"); the coercer normalizes those
        // back and sets unknown ids to null.
        const coerced = coerceRecipeCanonicalIds(result.recipe);
        setRecipe(coerced);
        if (coerced?.title) {
          setPreviousTitles(prev => (prev.includes(coerced.title) ? prev : [...prev, coerced.title]));
        }
        setPhase("preview");
        return;
      }
      // Same normalization on the sketch so pantry-coverage + swap
      // matching downstream work against real canonicals, not the
      // raw strings Claude handed back. Stamp dietaryClaims onto
      // each ideal slot so diet-loss detection has the signal when
      // a paired pantry row doesn't carry the same claim.
      const drafted = stampDietaryClaims(coerceRecipeCanonicalIds(result.sketch));
      setSketch(drafted);
      // Reset the tweak diff every fresh sketch — old swaps from a
      // previous draft don't apply to the new ingredient list. The
      // initial swaps map is pre-populated by autoPairShoppingRows:
      // any sketch.pantry row Claude marked as shopping (pantryItemId
      // null) that we can cover from the user's real pantry gets
      // swap-linked up front, so the UI's "in-kitchen" tag and
      // coverage count reflect what the user actually owns. The
      // matched render branch shows "⚡ AUTO-PAIRED" for these so
      // the substitution is visible and reversible via SWAP.
      const autoSwaps = autoPairShoppingRows(drafted, pantry);
      setPantryEdits({ swaps: autoSwaps, removes: new Set(), adds: [], shopping: new Set() });
      setRecipeFeedback("");
      setSwapOpenIdx(null);
      setSwapSearch("");
      setAddOpen(false);
      if (drafted?.title) {
        setPreviousTitles(prev => (prev.includes(drafted.title) ? prev : [...prev, drafted.title]));
      }
      setPhase("tweak");
    } catch (e) {
      console.error("AI recipe sketch failed:", e);
      setErrMsg(e?.message || "Sketch failed");
      setPhase("error");
    }
  };

  // Build the locked-ingredients payload from the sketch + the
  // user's tweak diff. Order: kept pantry rows (with swaps applied)
  // → user adds → ideal-promoted-to-shopping. Removes are dropped.
  const buildLockedIngredients = () => {
    if (!sketch) return [];
    const out = [];
    sketch.pantry.forEach((row, i) => {
      if (pantryEdits.removes.has(i)) return;
      const swappedId = pantryEdits.swaps[i];
      const swappedRow = swappedId ? pantry.find(p => p.id === swappedId) : null;
      if (swappedRow) {
        out.push({
          name: swappedRow.name,
          amount: row.amount,
          ingredientId: swappedRow.ingredientId || swappedRow.canonicalId || null,
          pantryItemId: swappedRow.id,
          source: "pantry",
          note: row.subbedFrom ? `subbed from ${row.subbedFrom} (was ${row.name})` : `swapped in for ${row.name}`,
        });
      } else {
        out.push({
          name: row.name,
          amount: row.amount,
          ingredientId: row.ingredientId ?? null,
          pantryItemId: row.pantryItemId ?? null,
          source: row.pantryItemId ? "pantry" : "shopping",
          note: row.subbedFrom ? `subbed from ${row.subbedFrom}` : null,
        });
      }
    });
    pantryEdits.adds.forEach(add => {
      out.push({
        name: add.name,
        amount: add.amount,
        ingredientId: add.ingredientId || null,
        pantryItemId: add.pantryItemId || null,
        source: "added",
        note: null,
      });
    });
    pantryEdits.shopping.forEach(idx => {
      const ideal = sketch.ideal[idx];
      if (!ideal) return;
      out.push({
        name: ideal.name,
        amount: ideal.amount,
        ingredientId: null,
        pantryItemId: null,
        source: "shopping",
        note: "user will pick up",
      });
    });
    return out;
  };

  // Phase 4 entry — fires the FINAL full-recipe call with the
  // user's locked ingredient set + revision feedback. Lands in the
  // existing preview phase.
  const cookFinal = async () => {
    if (!sketch) return;
    setPhase("final_loading");
    setErrMsg("");
    try {
      const contract = await ensureContract();
      const isDreamMode = contract?.tier === "OPEN";
      const built = buildAIContext({
        pantry, profile, ingredientInfo, cookLogs,
        mode: "rich",
        starIngredientIds,
        course:   course === "any" ? undefined : course,
        // Pass priority unconditionally — was previously nulled out
        // when course="any", which tripped the edge fn's silent
        // undefined→"category" default and flipped precedence midway
        // through a single session.
        priority,
      });
      const locked = buildLockedIngredients();
      const payload = {
        mode: "final",
        pantry: isDreamMode ? [] : built.pantry,
        prefs: buildPrefs({
          recipeFeedback: recipeFeedback.trim() || undefined,
          pantryFiltered: isDreamMode ? false : built.pantryFiltered,
          // Anchor the final pass to the sketch's dish identity —
          // without this the final pass saw the locked ingredient
          // list but had no binding to what dish they belonged to,
          // and Claude would sometimes re-conceptualize the dish
          // (Bacon Egg Sandwich sketch → Quiche Lorraine final).
          sketchTitle:     sketch?.title || undefined,
          sketchSubtitle:  sketch?.subtitle || undefined,
          sketchRationale: sketch?.aiRationale || undefined,
          dishContract:    contract || undefined,
        }),
        avoidTitles: previousTitles,
        context: built.context,
        lockedIngredients: locked,
      };
      const { recipe: drafted } = await generateRecipe(payload);
      // Coerce canonical ids on the way in. Protects the stored
      // user_recipes row from AI drift ("fresh_tortillas" → "tortillas")
      // and guarantees the pantry-match loop downstream is operating
      // on real registry slugs.
      const normalized = coerceRecipeCanonicalIds(drafted);
      // Re-stamp pantryItemId from the locked set. The AI response
      // only carries { item, amount, ingredientId, state? } — it
      // drops the pantryItemId that buildLockedIngredients wrote
      // for swapped/bound rows. Without this merge the cook-prep
      // pairing re-matches from scratch and lands on the wrong row
      // (in practice: swapping Mozzarella for Great Value string
      // cheese got re-paired with Powdered Sugar by the category
      // fallback). We key by ingredientId first (tightest signal)
      // then by normalized name so brand-prefixed reformulations
      // like "Great Value String Cheese" still find their locked
      // pantry binding.
      const pairedNorm = (s) => String(s || "").toLowerCase().trim();
      const byCanon = new Map();
      const byName  = new Map();
      for (const l of locked) {
        if (!l || !l.pantryItemId) continue;
        if (l.ingredientId && !byCanon.has(l.ingredientId)) byCanon.set(l.ingredientId, l.pantryItemId);
        const n = pairedNorm(l.name);
        if (n && !byName.has(n)) byName.set(n, l.pantryItemId);
      }
      const withPantry = normalized && Array.isArray(normalized.ingredients)
        ? {
            ...normalized,
            ingredients: normalized.ingredients.map(ing => {
              if (!ing || typeof ing !== "object") return ing;
              if (ing.pantryItemId) return ing;
              const canonHit = ing.ingredientId ? byCanon.get(ing.ingredientId) : null;
              const nameHit  = canonHit ? null : byName.get(pairedNorm(ing.item || ing.name));
              const pantryItemId = canonHit || nameHit || null;
              return pantryItemId ? { ...ing, pantryItemId } : ing;
            }),
          }
        : normalized;
      // Stamp dietaryClaims onto every persisted ingredient row.
      // Claims are recipe INTENT (the AI asked for "low-carb
      // tortilla"), not transient pairing — they must survive into
      // user_recipes so preview/CookMode can warn on diet-loss a
      // month from now even if the user has different pantry state.
      // Pairing itself is still re-derived live every render via
      // pairRecipeIngredients, so brands/availability drift doesn't
      // fossilize; only the claim labels on each ingredient persist.
      const claimed = withPantry && Array.isArray(withPantry.ingredients)
        ? {
            ...withPantry,
            ingredients: withPantry.ingredients.map(ing => {
              if (!ing || typeof ing !== "object") return ing;
              if (Array.isArray(ing.dietaryClaims) && ing.dietaryClaims.length > 0) {
                return ing;
              }
              const { claims } = extractDietaryClaims(ing.item || ing.name || "");
              if (claims.length === 0) return ing;
              return { ...ing, dietaryClaims: claims };
            }),
          }
        : withPantry;
      // Chained reheat upgrade. generate-recipe produces a reheat
      // block as ONE field in a ~40-field schema; Claude's attention
      // is spread thin and the steps are often flat. A second, focused
      // call through suggest-cook-instructions — same input budget,
      // purpose-built prompt — produces dramatically richer steps
      // with heat badges, doneCues, per-step timers and tips. We
      // merge the focused result onto recipe.reheat so the leftover
      // pantry row inherits the good walkthrough without a manual
      // SUGGEST tap downstream.
      //
      // Failure is non-fatal — if Claude rate-limits or the shape
      // fails, we fall back to whatever reheat generate-recipe
      // authored. The leftover then still gets a walkthrough via
      // reheatToCookInstructions' synthesis path.
      let enriched = claimed;
      if (claimed?.title) {
        try {
          const { cookInstructions } = await suggestCookInstructions({
            name:     claimed.title,
            category: claimed.category,
          });
          if (cookInstructions?.steps?.length > 0) {
            enriched = {
              ...claimed,
              reheat: {
                // Focused call always wins on primary since its
                // method/time/temp are derived from the same prompt
                // that wrote the walkthrough — guaranteed internally
                // consistent with the steps.
                primary: cookInstructions.reheat?.primary || claimed?.reheat?.primary || null,
                // Stash the full step array on reheat so the leftover
                // row's walkthrough reads them directly instead of
                // synthesizing from primary.
                steps: cookInstructions.steps,
                // Preserve any top-level note generate-recipe might
                // have authored ("eggs scramble if microwaved").
                ...(claimed?.reheat?.note ? { note: claimed.reheat.note } : {}),
              },
            };
          }
        } catch (_) { /* non-fatal, fall through with the first-pass reheat */ }
      }
      setRecipe(enriched);
      if (enriched?.title) {
        setPreviousTitles(prev => (prev.includes(enriched.title) ? prev : [...prev, enriched.title]));
      }
      // Push shopping-source locked items into the parent's shopping
      // list. Happens only after the final cook actually lands so a
      // user who cancels mid-tweak doesn't pollute their list.
      const shoppingItems = locked.filter(l => l.source === "shopping");
      if (shoppingItems.length > 0 && onShoppingAdd) {
        onShoppingAdd(shoppingItems.map(l => ({
          name: l.name,
          amount: typeof l.amount === "string" ? parseFloat(l.amount) || 1 : (Number(l.amount) || 1),
          unit: l.unit || (typeof l.amount === "string" ? String(l.amount).replace(/[\d.\s]+/, "").trim() : "") || "count",
          ingredientId: l.ingredientId || null,
          source: "ai-recipe",
        })));
      }
      setPhase("preview");
    } catch (e) {
      console.error("AI recipe final failed:", e);
      setErrMsg(e?.message || "Final cook failed");
      setPhase("error");
    }
  };

  // Each action guards on busy so a double-tap can't fire twice.
  const handleAction = (kind, cb) => async () => {
    if (!recipe || busy) return;
    setBusy(kind);
    try {
      await cb?.(recipe);
    } catch (e) {
      console.error(`[ai recipe] ${kind} failed:`, e);
    } finally {
      setBusy(null);
    }
  };
  const handleSave     = handleAction("save",     onSave);
  const handleSchedule = handleAction("schedule", onSchedule);
  const handleCookIt   = handleAction("cook",     onSaveAndCook);

  // ── Compose-a-meal handlers ─────────────────────────────────────

  // Derive ingredient descriptors for the pairWith payload. Trims to
  // name + amount so a long recipe doesn't bloat the prompt. The full
  // recipe is already saved in user_recipes; this is just the context
  // Claude needs to build something complementary.
  const ingredientDescriptors = (r) =>
    (r?.ingredients || [])
      .filter((i) => i && typeof i.item === "string" && i.item.trim())
      .map((i) => ({ name: i.item, amount: i.amount ?? null }));

  // Open the "+ Add X" sheet for a course. The sheet offers two paths:
  // Draft new (re-enters setup with pairWith seeded) or Pick existing
  // (opens the filtered library picker).
  const openAddSheet = (courseType) => {
    if (busy) return;
    setAddSheetCourse(courseType);
  };

  // "Draft new" path — saves the current recipe as the anchor (or
  // extends the in-progress meal), seeds pairWith with the anchor's
  // identity, resets the sketch/tweak machinery, and kicks back to
  // setup with course pre-filled to the target. The pieces already
  // in mealInProgress survive the reset.
  const draftNewComponent = async (courseType) => {
    if (!recipe) return;
    setAddSheetCourse(null);
    const saver = onSilentSave || onSave;
    if (!saver) return;
    setBusy("compose");
    try {
      // Fall back to the user's setup chips when Claude forgot to
      // stamp the tags on its final output — the user's intent is
      // the ground truth. Without this a pre-Phase-1 cached response
      // could land as a "main" on a slot it wasn't.
      const resolvedCourse     = recipe.course     || (course     === "any" ? null : course);
      const resolvedMealTiming = recipe.mealTiming || (mealTiming === "any" ? null : mealTiming);
      const recipeWithTags = { ...recipe, course: resolvedCourse, mealTiming: resolvedMealTiming };
      // Persist the current recipe so it exists as a standalone row
      // in user_recipes. This piece is reusable — it lives in the
      // library regardless of whether the user ever "saves the meal".
      const saved = (await saver(recipeWithTags)) || recipeWithTags;
      // Seed or extend the in-progress meal. First call establishes
      // the anchor (main); subsequent + Add calls append pieces.
      setMealInProgress((prev) => {
        const incoming = { course: saved.course || "main", recipe: saved };
        if (!prev) {
          return { anchor: saved, pieces: [incoming] };
        }
        return { ...prev, pieces: [...prev.pieces, incoming] };
      });
      // Anchor context for the next draft. Use the current anchor if
      // one's already set (so "Dessert after side after main" still
      // complements the MAIN, not the side), else the just-saved
      // recipe.
      const anchor = mealInProgress?.anchor || saved;
      setPairWith({
        title:       anchor.title,
        course:      anchor.course || "main",
        cuisine:     anchor.cuisine || undefined,
        ingredients: ingredientDescriptors(anchor),
      });
      // Reset the sketch + tweak machinery AND star-ingredient picks.
      // Star ingredients are a "build around THIS protein" signal for
      // the piece the user is currently drafting; they should never
      // carry from main → side. The eggs that were the main's hero
      // shouldn't reappear in the side's star slot — the anchor's
      // proteins already ride along via pairWith, so Claude has the
      // context without the side being forced to include them.
      // mealPrompt / cuisine / time / difficulty stay — those read as
      // overall session mood, not piece-specific direction.
      setRecipe(null);
      setSketch(null);
      setPantryEdits({ swaps: {}, removes: new Set(), adds: [], shopping: new Set() });
      setRecipeFeedback("");
      setSwapOpenIdx(null);
      setSwapSearch("");
      setAddOpen(false);
      setStarIngredientIds([]);
      setCourse(courseType);
      setErrMsg("");
      setPhase("setup");
    } catch (e) {
      console.error("[ai recipe] compose draft-new failed:", e);
    } finally {
      setBusy(null);
    }
  };

  // "Pick existing" path — attach a library recipe to the meal
  // without re-drafting. Recipe is already in user_recipes (or is a
  // bundled one); we just pin it into mealInProgress.pieces. The
  // anchor stays on the current preview so the user can keep adding.
  const attachExistingComponent = async (courseType, chosenRecipe) => {
    if (!recipe || !chosenRecipe) return;
    setPickExistingFor(null);
    setAddSheetCourse(null);
    const saver = onSilentSave || onSave;
    // Make sure the current preview's anchor is in user_recipes too.
    // First call of the compose flow needs to lock the anchor in so
    // pieces are siblings, not just floating refs to an unsaved draft.
    let anchorRecipe = mealInProgress?.anchor;
    if (!mealInProgress) {
      if (!saver) return;
      setBusy("compose");
      try {
        anchorRecipe = (await saver(recipe)) || recipe;
      } catch (e) {
        console.error("[ai recipe] compose anchor-save failed:", e);
        setBusy(null);
        return;
      }
    }
    setMealInProgress((prev) => {
      if (!prev) {
        return {
          anchor: anchorRecipe,
          pieces: [
            { course: anchorRecipe.course || "main", recipe: anchorRecipe },
            { course: courseType, recipe: chosenRecipe },
          ],
        };
      }
      return { ...prev, pieces: [...prev.pieces, { course: courseType, recipe: chosenRecipe }] };
    });
    setBusy(null);
  };

  // Remove a piece from the in-progress meal. Does NOT delete the
  // recipe from user_recipes — it just unpins it from this meal.
  const removePiece = (idx) => {
    setMealInProgress((prev) => {
      if (!prev) return prev;
      const nextPieces = prev.pieces.filter((_, i) => i !== idx);
      if (nextPieces.length === 0) return null;
      return { ...prev, pieces: nextPieces };
    });
  };

  // "SAVE MEAL" CTA from the sticky header. Two jobs:
  //   1. If the user is sitting on a preview (e.g. the dessert they
  //      just drafted) that hasn't been pinned yet, silently persist
  //      it and append so the meal captures everything on screen.
  //   2. Persist the meal itself — a `meals` row plus one
  //      `meal_recipes` row per piece — via onMealSave. The pieces
  //      are already in user_recipes individually (every + Add
  //      triggered a silent save), so the meal is a pure pointer-set.
  const finishMeal = async () => {
    const saver = onSilentSave || onSave;
    setBusy("compose");
    try {
      // 1. Pin the current preview's recipe if it's not yet in pieces.
      //    Build the committed piece list in a local so we use the
      //    post-pin snapshot without waiting for setState to flush.
      let committed = mealInProgress;
      const pinnedSlugs = new Set((committed?.pieces || []).map(p => p.recipe?.slug).filter(Boolean));
      const shouldPinCurrent = phase === "preview" &&
        recipe &&
        recipe.course !== "bake" && recipe.course !== "prep" &&
        !pinnedSlugs.has(recipe.slug);
      if (shouldPinCurrent && saver) {
        try {
          const resolvedCourse     = recipe.course     || (course     === "any" ? null : course);
          const resolvedMealTiming = recipe.mealTiming || (mealTiming === "any" ? null : mealTiming);
          const recipeWithTags = { ...recipe, course: resolvedCourse, mealTiming: resolvedMealTiming };
          const saved = (await saver(recipeWithTags)) || recipeWithTags;
          const incoming = { course: saved.course || "side", recipe: saved };
          committed = committed
            ? { ...committed, pieces: [...committed.pieces, incoming] }
            : { anchor: saved, pieces: [{ course: saved.course || "main", recipe: saved }] };
          setMealInProgress(committed);
        } catch (e) {
          console.error("[ai recipe] finishMeal pin-current failed:", e);
        }
      }

      // 2. Persist the meal row. Need a parent handler + at least one
      //    piece; otherwise the CTA is really just "close this flow".
      const piecesForRow = (committed?.pieces || [])
        .filter(p => p.recipe?.slug)
        .map((p, i) => ({
          recipeSlug: p.recipe.slug,
          course:     p.course || "main",
          sortOrder:  i,
        }));
      if (onMealSave && piecesForRow.length > 0) {
        const anchor = committed?.anchor || piecesForRow[0];
        const mealTimingForRow = anchor?.mealTiming
          || (mealTiming === "any" ? null : mealTiming)
          || null;
        const name = buildMealName(committed?.anchor, committed?.pieces);
        try {
          await onMealSave({
            name,
            emoji:       committed?.anchor?.emoji   || null,
            cuisine:     committed?.anchor?.cuisine || null,
            mealTiming:  mealTimingForRow,
            anchorSlug:  committed?.anchor?.slug    || null,
            pieces:      piecesForRow,
          });
        } catch (e) {
          console.error("[ai recipe] finishMeal onMealSave failed:", e);
        }
      }
    } finally {
      setBusy(null);
    }
    setMealInProgress(null);
    setPairWith(null);
    onCancel?.();
  };

  // Header is shared across phases so the back button is always where
  // the user expects it.
  const header = (
    <div style={{ padding: "24px 20px 0", display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={onCancel} style={iconBtn}>←</button>
      <div style={{ flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#c7a8d4", letterSpacing: "0.12em" }}>
        AI RECIPE
      </div>
    </div>
  );

  // A slot counts as filled either because a piece is pinned in
  // mealInProgress.pieces OR because the user is currently previewing
  // a draft of that course (about to be pinned via "+ Add" or "SAVE
  // MEAL"). Without this, "+ SIDE" on a side-preview would double-add
  // the same slot.
  const filledSlots = new Set((mealInProgress?.pieces || []).map(p => p.course));
  if (phase === "preview" && recipe?.course && recipe.course !== "main"
      && recipe.course !== "bake" && recipe.course !== "prep") {
    filledSlots.add(recipe.course);
  }

  // Sticky MEAL header — shown across all phases whenever a meal is
  // mid-compose. Renders the pieces as pills + "+ Add X" buttons for
  // the slots the user hasn't filled yet, plus a SAVE MEAL CTA. Lives
  // outside the scrollable body so it stays visible as the user
  // drafts / tweaks / previews subsequent pieces. Hidden when
  // mealInProgress is null (first draft hasn't been anchored yet).
  const mealHeaderBlock = mealInProgress ? (
    <MealInProgressHeader
      meal={mealInProgress}
      filledSlots={filledSlots}
      onAdd={openAddSheet}
      onRemovePiece={removePiece}
      onFinish={finishMeal}
      disabled={!!busy}
    />
  ) : null;

  if (phase === "sketch_loading" || phase === "final_loading" || phase === "loading") {
    const isFinal = phase === "final_loading";
    return (
      <div>
        {header}
        {mealHeaderBlock}
        <div style={{ padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 44, animation: "spin 1.2s linear infinite", display: "inline-block" }}>✨</div>
          <div style={{ marginTop: 18, fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic", color: "#f0ece4" }}>
            {isFinal ? "Cooking it up…" : "Sketching from your pantry…"}
          </div>
          <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.5 }}>
            {isFinal
              ? "Writing the steps around what you locked in."
              : `Claude is looking at ${pantryCount} pantry ${pantryCount === 1 ? "item" : "items"} and your preferences.`}
          </div>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div>
        {header}
        {mealHeaderBlock}
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 44, opacity: 0.6 }}>🫠</div>
          <div style={{ marginTop: 14, fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic", color: "#f0ece4" }}>
            Draft hiccup
          </div>
          <div style={{
            marginTop: 8, marginLeft: "auto", marginRight: "auto", maxWidth: 440,
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888",
            lineHeight: 1.5, wordBreak: "break-word", textAlign: "left",
            padding: "10px 12px", background: "#0f0f0f",
            border: "1px solid #242424", borderRadius: 10,
            maxHeight: 180, overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}>
            {errMsg || "Something went sideways."}
          </div>
          <div style={{ marginTop: 10, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.06em" }}>
            Full detail also in devtools console.
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={() => setPhase("setup")} style={primaryBtn}>TRY AGAIN</button>
            <button onClick={onCancel} style={secondaryBtn}>CANCEL</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "tweak" && sketch) {
    // Helpers scoped to the tweak render so they can close over
    // pantryEdits + setPantryEdits cleanly.
    const pantryById = new Map(pantry.map(p => [p.id, p]));
    const lookupPantryRow = (id) => (id ? pantryById.get(id) : null);

    // Rank all pantry rows by closeness to a sketch pantry row.
    // Replaces the old same-category dump (which scrolled past the
    // screen the moment the user had >10 pantry items in that
    // bucket). Returns [{ row, score }] sorted highest first.
    //
    // Ranking signals (additive), highest of the two targets wins:
    //   +1000  same canonical id as the target
    //   +500   same parentId / hub as the target
    //   +100   same food category
    //   +10    per token shared with the target's normalized name
    //
    // TWO TARGETS. When the sketch row is an AI sub ("Croissant
    // Rolls as wrapper substitute for flour tortillas"), both the
    // current row AND the `subbedFrom` original count as targets.
    // Without this the ranker scored only against "croissant roll"
    // and the user's search for "torti" returned Tortilla Chips
    // ahead of Mission Tortillas because neither scored against
    // croissant. Scoring against subbedFrom ("flour tortillas")
    // pulls Mission Tortillas to +1000 (exact canonical) while
    // Tortilla Chips stays near zero — the match the user clearly
    // wants rises to the top.
    //
    // When `query` is non-empty we additionally require the row's
    // name to contain the query as a substring (user is explicitly
    // typing, so loose substring is fine — we're filtering a list
    // in front of their eyes, not auto-pairing).
    const rankSwapCandidates = (sketchPantryRow, query) => {
      const primaryCanon = sketchPantryRow.ingredientId
        ? findIngredient(sketchPantryRow.ingredientId)
        : null;
      const subFromName = sketchPantryRow.subbedFrom || null;
      const subFromSlug = subFromName ? resolveNameToCanonicalId(subFromName) : null;
      const subFromCanon = subFromSlug ? findIngredient(subFromSlug) : null;

      const targetSlugs = new Set(
        [primaryCanon?.id, subFromCanon?.id].filter(Boolean),
      );
      const targetHubs = new Set(
        [
          primaryCanon?.parentId || primaryCanon?.id,
          subFromCanon?.parentId || subFromCanon?.id,
        ].filter(Boolean),
      );
      const targetCats = new Set(
        [primaryCanon?.category, subFromCanon?.category].filter(Boolean),
      );
      const targetTokens = new Set([
        ...normalizeForMatch(
          sketchPantryRow.name || primaryCanon?.name || "",
        ).split(/\s+/).filter(Boolean),
        ...normalizeForMatch(subFromName || "").split(/\s+/).filter(Boolean),
      ]);

      const q = (query || "").trim().toLowerCase();
      const seen = new Set();
      const scored = [];
      for (const p of pantry) {
        if (!p) continue;
        if (p.id === sketchPantryRow.pantryItemId) continue;
        const canon = p.ingredientId ? findIngredient(p.ingredientId) : null;
        const key = canon?.id || (p.name || "").toLowerCase() || p.id;
        if (seen.has(key)) continue;
        seen.add(key);

        if (q && !(p.name || "").toLowerCase().includes(q)) continue;

        let score = 0;
        if (canon?.id && targetSlugs.has(canon.id)) score += 1000;
        const pHub = canon?.parentId || canon?.id;
        if (pHub && targetHubs.has(pHub)) score += 500;
        if (canon?.category && targetCats.has(canon.category)) score += 100;
        const pTokens = new Set(
          normalizeForMatch(p.name || "").split(/\s+/).filter(Boolean),
        );
        let overlap = 0;
        for (const t of targetTokens) if (pTokens.has(t)) overlap++;
        score += overlap * 10;
        scored.push({ row: p, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored;
    };

    const toggleRemove = (i) => setPantryEdits(prev => {
      const removes = new Set(prev.removes);
      if (removes.has(i)) removes.delete(i);
      else removes.add(i);
      return { ...prev, removes };
    });
    const applySwap = (i, rowId) => setPantryEdits(prev => ({
      ...prev,
      swaps: { ...prev.swaps, [i]: rowId },
    }));
    const clearSwap = (i) => setPantryEdits(prev => {
      const swaps = { ...prev.swaps };
      delete swaps[i];
      return { ...prev, swaps };
    });
    const togglePromoteToShopping = (i) => setPantryEdits(prev => {
      const shopping = new Set(prev.shopping);
      if (shopping.has(i)) shopping.delete(i);
      else shopping.add(i);
      return { ...prev, shopping };
    });
    const dropAdd = (i) => setPantryEdits(prev => ({
      ...prev,
      adds: prev.adds.filter((_, idx) => idx !== i),
    }));
    const addPantryRow = (row) => setPantryEdits(prev => ({
      ...prev,
      adds: [...prev.adds, {
        name: row.name,
        amount: `${row.amount ?? 1}${row.unit ? ` ${row.unit}` : ""}`,
        ingredientId: row.ingredientId || row.canonicalId || null,
        pantryItemId: row.id,
        emoji: row.emoji,
      }],
    }));

    // Unified ingredient list — ordered by classical recipe
    // structure (sketch.ideal), with each slot resolved to either
    // a pantry row (direct match or sub) or a shoppable stub.
    // Replaces the prior two-section layout that confused users
    // with ingredients appearing in both "WHAT WE'RE GRABBING"
    // and "ALSO TYPICAL" when the name match missed a brand
    // prefix or plural.
    //
    // Entry kinds:
    //   matched    — ideal slot covered by a pantry row exactly
    //   subbed     — ideal slot covered by a different pantry row
    //                (subbedFrom or name mismatch)
    //   missing    — ideal slot with no pantry counterpart
    //   extra      — pantry row that doesn't map to any ideal slot
    //                (user added, or sketch put it in pantry only)
    //   userAdd    — user's + ADD FROM PANTRY row
    //   removed    — user removed this pantry slot (thin undo strip)
    const ingredientEntries = (() => {
      const entries = [];
      const matchedPantryIdx = new Set();
      // First pass: walk ideal slots in classical order.
      sketch.ideal.forEach((ideal, idealIdx) => {
        let pantryIdx = null;
        let isSub = false;
        // Resolve the ideal to a canonical slug (e.g. "Ricotta" →
        // "ricotta"). Used to pair pantry rows by canonical rather
        // than display-name — handles "GV Ricotta 32oz" vs "Ricotta"
        // without needing brand/size stripping heuristics to line
        // up exactly.
        // Resolve ideal → one primary canonical id plus any alt
        // canonicals the AI's "or/and/&/," separators implied. The
        // sketch's pantry column matches a canonical on EITHER side,
        // so splitting the ideal lets "ciabatta or crusty bread"
        // pair with a sketch.pantry row canonical'd to "ciabatta".
        const idealCanonIds = new Set();
        if (ideal.ingredientId) idealCanonIds.add(ideal.ingredientId);
        const directSlug = resolveNameToCanonicalId(ideal.name);
        if (directSlug) idealCanonIds.add(directSlug);
        for (const sub of splitIdealName(ideal.name)) {
          const subSlug = resolveNameToCanonicalId(sub);
          if (subSlug) idealCanonIds.add(subSlug);
        }
        const idealSubNames = [ideal.name, ...splitIdealName(ideal.name)];

        // (1) subbedFrom match — the sketch told us which ideal
        // slot this pantry row was subbing for. Cheapest, truest
        // signal: pair on that. Check against every sub-name so the
        // "ciabatta" the AI picked still matches a subbedFrom of
        // "ciabatta or crusty bread".
        for (let j = 0; j < sketch.pantry.length; j++) {
          if (matchedPantryIdx.has(j)) continue;
          const p = sketch.pantry[j];
          if (!p.subbedFrom) continue;
          if (idealSubNames.some(n => namesMatch(p.subbedFrom, n))) {
            pantryIdx = j;
            isSub = true;
            break;
          }
        }
        // (2) canonical-id match — same slug on EITHER side (primary
        // OR any alt from the split) means same ingredient regardless
        // of brand / size / casing in the display names. Hub-family
        // equivalence also counts here: the ideal's `chicken` hub
        // pairs with the sketch.pantry row's `chicken_breast` cut
        // because both resolve to the same chicken_hub parent.
        if (pantryIdx === null && idealCanonIds.size > 0) {
          for (let j = 0; j < sketch.pantry.length; j++) {
            if (matchedPantryIdx.has(j)) continue;
            const p = sketch.pantry[j];
            if (!p.ingredientId) continue;
            const familyHit = [...idealCanonIds].some(slug =>
              sameCanonicalFamily(p.ingredientId, slug),
            );
            if (familyHit) {
              pantryIdx = j;
              isSub = false;
              break;
            }
          }
        }
        // (3) fuzzy name match — last-resort fallback for rows
        // without canonical ids on either side. Match against any
        // sub-name so "Ciabatta Roll" can pair with the "ciabatta"
        // alt of a compound ideal.
        if (pantryIdx === null) {
          for (let j = 0; j < sketch.pantry.length; j++) {
            if (matchedPantryIdx.has(j)) continue;
            const p = sketch.pantry[j];
            if (idealSubNames.some(n => namesMatch(p.name, n))) {
              pantryIdx = j;
              isSub = false;
              break;
            }
          }
        }
        if (pantryIdx !== null) {
          matchedPantryIdx.add(pantryIdx);
          entries.push({
            kind: pantryEdits.removes.has(pantryIdx) ? "removed"
                : isSub ? "subbed"
                : "matched",
            idealIdx,
            pantryIdx,
          });
        } else {
          entries.push({ kind: "missing", idealIdx });
        }
      });
      // Second pass: any pantry rows the sketch included that
      // didn't map to an ideal slot (rare, but handles sketches
      // where the AI adds something extra beyond the classical).
      sketch.pantry.forEach((p, j) => {
        if (matchedPantryIdx.has(j)) return;
        entries.push({
          kind: pantryEdits.removes.has(j) ? "removed" : "extra",
          pantryIdx: j,
        });
      });
      // Third pass: user-added extras (egg whites case).
      pantryEdits.adds.forEach((_, k) => {
        entries.push({ kind: "userAdd", addIdx: k });
      });
      return entries;
    })();

    // When an ideal slot has no pantry match in the SKETCH, scan
    // the user's actual pantry for anything that could fill it.
    // The AI occasionally overlooks obvious pairings (saw this on
    // "Pasta (penne or rigatoni)" with penne sitting right there in
    // pantry). Three tiers, in order: same canonical id → same
    // food category → name substring. Dedupes by canonical so a
    // 50-can tuna stack contributes one candidate, not fifty.
    const findRawPantryCandidates = (ideal) => {
      // Build a list of resolution targets: one per sub-name the AI
      // wrote ("ciabatta or crusty bread" → two targets). The top-
      // level ingredientId, when Claude stamped one, rides along as
      // an additional exact-match target.
      const subNames = splitIdealName(ideal.name);
      const targets = subNames.map(n => {
        const slug = resolveNameToCanonicalId(n);
        const canon = slug ? findIngredient(slug) : null;
        return {
          name:     n,
          slug,
          category: canon?.category || null,
        };
      });
      if (ideal.ingredientId) {
        const canon = findIngredient(ideal.ingredientId);
        targets.unshift({
          name:     ideal.name,
          slug:     ideal.ingredientId,
          category: canon?.category || null,
        });
      }

      // Items already locked into the recipe (pantry-matched,
      // swapped-in, or user-added) shouldn't appear as candidates
      // for OTHER missing slots.
      const usedIds = new Set();
      sketch.pantry.forEach((row, i) => {
        if (pantryEdits.removes.has(i)) return;
        if (row.pantryItemId) usedIds.add(row.pantryItemId);
        const swapped = pantryEdits.swaps[i];
        if (swapped) usedIds.add(swapped);
      });
      pantryEdits.adds.forEach(a => { if (a.pantryItemId) usedIds.add(a.pantryItemId); });

      const seenCanon = new Set();
      const exact = [];
      const byCategory = [];
      const byName = [];
      for (const row of pantry) {
        if (usedIds.has(row.id)) continue;
        const canonKey = row.ingredientId || row.canonicalId || null;
        if (canonKey && seenCanon.has(canonKey)) continue;
        const rowCanon = row.ingredientId ? findIngredient(row.ingredientId) : null;
        const rowCategory = rowCanon?.category || null;

        // Tier 1 — canonical match against ANY target slug. Exact
        // match OR hub-family equivalence (a `chicken` target pairs
        // with a pantry row tagged `chicken_breast` because both
        // hang off chicken_hub). Hub-family is how the user's actual
        // cuts surface under a generic recipe call like "Chicken".
        let matched = null;
        for (const t of targets) {
          if (!t.slug) continue;
          if (row.ingredientId && sameCanonicalFamily(row.ingredientId, t.slug)) {
            matched = "exact"; break;
          }
        }

        // Tier 2 — category match, BUT only when the row's name also
        // carries a name-level signal for the same target. Without
        // this name check, a loose category like "pantry" pulled in
        // every unrelated jar/box/bag that happened to share the
        // fallback bucket (Mustard, Crackers, Oats, Sugar all landing
        // under "salt & black pepper"). Requiring both raises the bar.
        if (!matched) {
          for (const t of targets) {
            if (t.category && rowCategory === t.category && namesMatch(row.name, t.name)) {
              matched = "byCategory"; break;
            }
          }
        }

        // Tier 3 — last-resort fuzzy name match against any target.
        // Catches user-typed pantry rows (no ingredientId, no
        // category) where the name alone has to do the work.
        if (!matched) {
          for (const t of targets) {
            if (namesMatch(row.name, t.name)) { matched = "byName"; break; }
          }
        }

        if (matched === "exact") {
          if (canonKey) seenCanon.add(canonKey);
          exact.push(row);
        } else if (matched === "byCategory") {
          if (canonKey) seenCanon.add(canonKey);
          byCategory.push(row);
        } else if (matched === "byName") {
          if (canonKey) seenCanon.add(canonKey);
          byName.push(row);
        }
      }
      return [...exact, ...byCategory, ...byName].slice(0, 6);
    };

    const lockedCount = buildLockedIngredients().length;

    return (
      <div>
        {header}
        {mealHeaderBlock}
        <div style={{ padding: "12px 20px 60px" }}>
          {/* Sketch header — title + emoji + AI rationale. Reads as
              "here's what we drafted, want to tweak before cooking?" */}
          <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
            <div style={{ fontSize: 48 }}>{sketch.emoji || "🍽️"}</div>
            <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 24, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", margin: "8px 0 4px" }}>
              {sketch.title}
            </h1>
            {sketch.subtitle && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.4 }}>
                {sketch.subtitle}
              </div>
            )}
            <div style={{
              marginTop: 10, display: "inline-flex", gap: 6, alignItems: "center",
              padding: "4px 10px", background: "#1a1608",
              border: "1px solid #c7a8d455", borderRadius: 14,
              fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#c7a8d4",
              letterSpacing: "0.08em",
            }}>
              ✨ SKETCH — TWEAK BEFORE COOK
            </div>
          </div>

          {sketch.aiRationale && (
            <div style={{
              padding: "10px 12px", marginBottom: 14,
              background: "#0f0d18", border: "1px solid #2a2438", borderRadius: 10,
              fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#c7a8d4", lineHeight: 1.5,
            }}>
              {sketch.aiRationale}
            </div>
          )}

          {/* PANTRY column — what the recipe will use, derived from
              the sketch + the user's tweak diff. Each row shows the
              pulled pantry item inline + swap/remove affordances. */}
          <Section label="INGREDIENTS">
            <div style={{ marginBottom: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#888", fontStyle: "italic" }}>
              Listed in classical order. Swap or remove what's grabbed from your pantry, or add missing items to shopping — whatever fits.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ingredientEntries.map((entry, idx) => {
                // REMOVED — thin undo strip for both pantry & ideal.
                if (entry.kind === "removed") {
                  const row = sketch.pantry[entry.pantryIdx];
                  return (
                    <div key={`rem-${idx}`} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 12px", background: "#0a0a0a",
                      border: "1px dashed #2a2a2a", borderRadius: 10,
                      fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#555",
                    }}>
                      <span><s>{row.name} · {row.amount}</s></span>
                      <button onClick={() => toggleRemove(entry.pantryIdx)} style={undoChip}>UNDO</button>
                    </div>
                  );
                }

                // MISSING — classical ingredient with no pantry match
                // IN THE SKETCH. Before offering + SHOP, scan the
                // raw user pantry for candidates the AI overlooked
                // (same canonical, same category, or name-fuzzy
                // match). If any exist, present them as tap-to-use
                // chips so the user recovers Claude's oversights
                // without bouncing through the + ADD FROM PANTRY
                // picker.
                if (entry.kind === "missing") {
                  const ideal = sketch.ideal[entry.idealIdx];
                  const promoted = pantryEdits.shopping.has(entry.idealIdx);
                  const rawCandidates = findRawPantryCandidates(ideal);
                  const missSwapKey = `miss-${entry.idealIdx}`;
                  const missSwapOpen = swapOpenIdx === missSwapKey;
                  return (
                    <div key={`miss-${idx}`} style={{
                      padding: "10px 12px",
                      background: promoted ? "#0f1a0f" : "#0a0a0a",
                      border: `1px dashed ${promoted ? "#1e3a1e" : "#2a2a2a"}`,
                      borderRadius: 12,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 15, color: promoted ? "#7ec87e" : "#aaa" }}>
                            {ideal.name} · <span style={{ color: "#888", fontStyle: "normal", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>{ideal.amount}</span>
                          </div>
                          <div style={{ marginTop: 3, fontFamily: "'DM Mono',monospace", fontSize: 9, color: promoted ? "#7ec87e" : (rawCandidates.length > 0 ? "#7eb8d4" : "#f59e0b"), letterSpacing: "0.06em" }}>
                            {promoted
                              ? "✓ ON SHOPPING LIST"
                              : rawCandidates.length > 0
                                ? `⚡ YOU HAVE ${rawCandidates.length} MATCH${rawCandidates.length === 1 ? "" : "ES"} IN PANTRY`
                                : "✗ NOT IN PANTRY"}
                            {ideal.role && !promoted ? ` · ${String(ideal.role).toUpperCase()}` : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            onClick={() => missSwapOpen ? openSwapPicker(null) : openSwapPicker(missSwapKey)}
                            style={missSwapOpen ? swapBtnActive : swapBtn}
                          >
                            ⇌ SWAP
                          </button>
                          <button onClick={() => togglePromoteToShopping(entry.idealIdx)} style={promoted ? shopActiveBtn : shopBtn}>
                            {promoted ? "✓ ON LIST" : "+ SHOP"}
                          </button>
                        </div>
                      </div>
                      {missSwapOpen && (() => {
                        // Search picker for missing rows. The target is
                        // the ideal itself (not a sketch.pantry row) so
                        // rankSwapCandidates scores the user's pantry
                        // against what the recipe asked for. Picking
                        // something binds it via addPantryRow → userAdd
                        // path, which is the same shape + ADD FROM
                        // PANTRY uses.
                        const q = swapSearch.trim();
                        const target = {
                          name: ideal.name,
                          ingredientId: ideal.ingredientId || resolveNameToCanonicalId(ideal.name) || null,
                          pantryItemId: null,
                        };
                        const ranked = rankSwapCandidates(target, swapSearch);
                        const shown = q
                          ? ranked.slice(0, 8).map(r => r.row)
                          : ranked.filter(r => r.score > 0).slice(0, 3).map(r => r.row);
                        return (
                          <div style={{
                            marginTop: 10, paddingTop: 10,
                            borderTop: "1px dashed #2a2a2a",
                            display: "flex", flexDirection: "column", gap: 6,
                          }}>
                            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#888", letterSpacing: "0.08em" }}>
                              USE SOMETHING FROM PANTRY FOR {ideal.name.toUpperCase()}:
                            </div>
                            <input
                              type="text"
                              value={swapSearch}
                              onChange={e => setSwapSearch(e.target.value)}
                              placeholder="Search your pantry…"
                              style={swapSearchInput}
                              autoFocus
                            />
                            {!q && (
                              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.06em" }}>
                                TOP 3 CLOSEST · TYPE TO SEARCH
                              </div>
                            )}
                            {shown.length === 0 && (
                              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#666", fontStyle: "italic" }}>
                                {q ? "No pantry items match that search." : "No close matches in pantry — try typing to search."}
                              </div>
                            )}
                            {shown.map(c => (
                              <button
                                key={c.id}
                                onClick={() => { addPantryRow(c); openSwapPicker(null); }}
                                style={swapOptionBtn}
                              >
                                <span style={{ fontSize: 16 }}>{c.emoji || "🥫"}</span>
                                <span style={{ flex: 1, textAlign: "left", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
                                  {c.name}
                                </span>
                                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888" }}>
                                  {c.amount}{c.unit ? ` ${c.unit}` : ""}
                                </span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                      {rawCandidates.length > 0 && !promoted && (
                        <div style={{
                          marginTop: 10, paddingTop: 10,
                          borderTop: "1px dashed #2a2a2a",
                          display: "flex", flexDirection: "column", gap: 6,
                        }}>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#888", letterSpacing: "0.08em" }}>
                            THE AI MISSED THESE — TAP TO USE:
                          </div>
                          {rawCandidates.map(c => (
                            <button
                              key={c.id}
                              onClick={() => addPantryRow(c)}
                              style={swapOptionBtn}
                            >
                              <span style={{ fontSize: 16 }}>{c.emoji || "🥫"}</span>
                              <span style={{ flex: 1, textAlign: "left", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
                                {c.name}
                              </span>
                              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888" }}>
                                {c.amount}{c.unit ? ` ${c.unit}` : ""}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                // USER-ADDED — egg-whites case. Green accent, remove only.
                if (entry.kind === "userAdd") {
                  const add = pantryEdits.adds[entry.addIdx];
                  return (
                    <div key={`add-${idx}`} style={{
                      padding: "10px 12px",
                      background: "#0f1a0f", border: "1px solid #1e3a1e", borderRadius: 12,
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 15, color: "#f0ece4" }}>
                          {add.emoji ? `${add.emoji} ` : ""}{add.name} · <span style={{ color: "#aaa", fontStyle: "normal", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>{add.amount}</span>
                        </div>
                        <div style={{ marginTop: 3, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7ec87e", letterSpacing: "0.06em" }}>
                          + ADDED BY YOU
                        </div>
                      </div>
                      <button onClick={() => dropAdd(entry.addIdx)} style={removeBtn}>×</button>
                    </div>
                  );
                }

                // PANTRY-BACKED (matched | subbed | extra) — the
                // grabbed ingredient. Matched shows a classic tag;
                // subbed shows "classic calls for X" right under the
                // ingredient name so the user sees the swap inline
                // instead of inferring from a separate section.
                const pantryIdx = entry.pantryIdx;
                const row = sketch.pantry[pantryIdx];
                const isSub = entry.kind === "subbed";
                const isExtra = entry.kind === "extra";
                const idealRef = entry.kind === "matched" || entry.kind === "subbed"
                  ? sketch.ideal[entry.idealIdx]
                  : null;
                const swappedId = pantryEdits.swaps[pantryIdx];
                const swappedRow = lookupPantryRow(swappedId);
                const originRow  = lookupPantryRow(row.pantryItemId);
                const showRow    = swappedRow || originRow;
                const swapOpen   = swapOpenIdx === pantryIdx;
                const subHint = isSub && idealRef
                  ? `classic calls for ${idealRef.name}`
                  : row.subbedFrom && !isSub
                    ? `subbed from ${row.subbedFrom}`
                    : null;
                // Diet-loss check. When the AI asked for a claimed
                // variant ("low-carb tortilla", "vegan sausage") and
                // we paired a pantry row that doesn't carry that
                // claim, the substitution silently breaks the dietary
                // intent. Surface it inline so the user sees the
                // tradeoff before cooking. Claims are compared
                // case-insensitively; pantry claims come from scan
                // attributes (buildAttributesFromScan) or manual
                // ItemCard edits.
                const idealClaims = Array.isArray(idealRef?.dietaryClaims)
                  ? idealRef.dietaryClaims
                  : (idealRef ? extractDietaryClaims(idealRef.name).claims : []);
                const rowClaimsRaw = [
                  ...(Array.isArray(showRow?.attributes?.claims) ? showRow.attributes.claims : []),
                  ...(Array.isArray(showRow?.attributes?.certifications)
                    ? showRow.attributes.certifications.map(c => c?.label).filter(Boolean)
                    : []),
                ];
                const rowClaimSet = new Set(rowClaimsRaw.map(c => String(c).toLowerCase()));
                const lostClaims = idealClaims.filter(
                  c => !rowClaimSet.has(String(c).toLowerCase()),
                );
                return (
                  <div key={`p-${idx}`} style={{
                    padding: "10px 12px",
                    background: "#141414", border: "1px solid #1e1e1e", borderRadius: 12,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 15, color: "#f0ece4", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                          <span>{deriveRowHeader(swappedRow || row)}</span>
                          {(() => {
                            const cut = deriveRowCut(swappedRow || row);
                            if (!cut) return null;
                            return (
                              <span style={{
                                display: "inline-flex", alignItems: "center",
                                padding: "1px 7px",
                                background: "#201a26", border: "1px solid #3b2f48",
                                borderRadius: 8,
                                fontFamily: "'DM Mono',monospace", fontSize: 9, fontStyle: "normal",
                                color: "#c7a8d4", letterSpacing: "0.08em",
                              }}>
                                {String(cut).toUpperCase()}
                              </span>
                            );
                          })()}
                          <span style={{ color: "#aaa", fontStyle: "normal", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>· {row.amount}</span>
                        </div>
                        {showRow && (
                          <div style={{ marginTop: 3, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7ec87e", letterSpacing: "0.06em" }}>
                            {row.pantryItemId == null && swappedRow ? "⚡ AUTO-PAIRED FROM" : "✓ FROM"} {showRow.amount}{showRow.unit ? ` ${showRow.unit}` : ""} · {showRow.location || "pantry"}
                          </div>
                        )}
                        {!showRow && row.pantryItemId == null && (
                          <div style={{ marginTop: 3, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#f59e0b", letterSpacing: "0.06em" }}>
                            ⚠ NOT IN PANTRY — SHOPPING
                          </div>
                        )}
                        {subHint && (
                          <div style={{
                            marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "2px 8px",
                            background: "#1f1410", border: "1px solid #4a2f1a",
                            borderRadius: 10,
                            fontFamily: "'DM Mono',monospace", fontSize: 9,
                            color: "#d4a878", letterSpacing: "0.04em",
                          }}>
                            ⇌ {subHint}
                          </div>
                        )}
                        {lostClaims.length > 0 && (
                          <div style={{
                            marginTop: 4, marginLeft: subHint ? 6 : 0,
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "2px 8px",
                            background: "#2a1210", border: "1px solid #5a2a22",
                            borderRadius: 10,
                            fontFamily: "'DM Mono',monospace", fontSize: 9,
                            color: "#e8908a", letterSpacing: "0.04em",
                          }}>
                            ⚠ NO LONGER {lostClaims.map(c => c.toUpperCase()).join(" / ")}
                          </div>
                        )}
                        {isExtra && (
                          <div style={{
                            marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "2px 8px",
                            background: "#0f1620", border: "1px solid #1f3040",
                            borderRadius: 10,
                            fontFamily: "'DM Mono',monospace", fontSize: 9,
                            color: "#7eb8d4", letterSpacing: "0.04em",
                          }}>
                            + beyond classical
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => swapOpen ? openSwapPicker(null) : openSwapPicker(pantryIdx)}
                          style={swapOpen ? swapBtnActive : swapBtn}
                        >
                          ⇌ SWAP
                        </button>
                        <button onClick={() => toggleRemove(pantryIdx)} style={removeBtn}>×</button>
                      </div>
                    </div>
                    {swapOpen && (() => {
                      // Pin the 3 closest matches at the top and let
                      // the user type to filter the rest of pantry.
                      // Replaces the old full-category dump that made
                      // the user scroll past 20+ items every swap.
                      const q = swapSearch.trim();
                      const ranked = rankSwapCandidates(row, swapSearch);
                      const shown = q
                        ? ranked.slice(0, 8).map(r => r.row)
                        : ranked.filter(r => r.score > 0).slice(0, 3).map(r => r.row);
                      return (
                        <div style={{
                          marginTop: 10, paddingTop: 10,
                          borderTop: "1px dashed #2a2a2a",
                          display: "flex", flexDirection: "column", gap: 6,
                        }}>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#888", letterSpacing: "0.08em" }}>
                            SWAP {row.name.toUpperCase()} FOR:
                          </div>
                          <input
                            type="text"
                            value={swapSearch}
                            onChange={e => setSwapSearch(e.target.value)}
                            placeholder="Search your pantry…"
                            style={swapSearchInput}
                            autoFocus
                          />
                          {!q && (
                            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.06em" }}>
                              TOP 3 CLOSEST · TYPE TO SEARCH
                            </div>
                          )}
                          {shown.length === 0 && (
                            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#666", fontStyle: "italic" }}>
                              {q ? "No pantry items match that search." : "No close matches in pantry — try typing to search."}
                            </div>
                          )}
                          {shown.map(c => (
                            <button
                              key={c.id}
                              onClick={() => { applySwap(pantryIdx, c.id); openSwapPicker(null); }}
                              style={swapOptionBtn}
                            >
                              <span style={{ fontSize: 16 }}>{c.emoji || "🥫"}</span>
                              <span style={{ flex: 1, textAlign: "left", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
                                {c.name}
                              </span>
                              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888" }}>
                                {c.amount}{c.unit ? ` ${c.unit}` : ""}
                              </span>
                            </button>
                          ))}
                          {swappedRow && (
                            <button onClick={() => { clearSwap(pantryIdx); openSwapPicker(null); }} style={swapClearBtn}>
                              ↺ REVERT TO ORIGINAL ({row.name})
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>

            {/* + ADD INGREDIENT FROM PANTRY — egg-whites case. */}
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => setAddOpen(o => !o)}
                style={addOpen ? addBtnActive : addBtn}
              >
                {addOpen ? "× CLOSE" : "+ ADD INGREDIENT FROM PANTRY"}
              </button>
              {addOpen && (() => {
                const usedIds = new Set();
                sketch.pantry.forEach((row, i) => {
                  if (pantryEdits.removes.has(i)) return;
                  if (row.pantryItemId) usedIds.add(row.pantryItemId);
                  const swapped = pantryEdits.swaps[i];
                  if (swapped) usedIds.add(swapped);
                });
                pantryEdits.adds.forEach(a => { if (a.pantryItemId) usedIds.add(a.pantryItemId); });
                const seenCanon = new Set();
                const candidates = pantry.filter(p => {
                  if (usedIds.has(p.id)) return false;
                  const canonId = p.ingredientId || p.canonicalId || p.name?.toLowerCase();
                  if (canonId && seenCanon.has(canonId)) return false;
                  if (canonId) seenCanon.add(canonId);
                  return true;
                });
                return (
                  <div style={{
                    marginTop: 8, padding: "10px 12px",
                    background: "#0a0a0a", border: "1px solid #242424", borderRadius: 10,
                    maxHeight: 240, overflowY: "auto",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    {candidates.length === 0 ? (
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", fontStyle: "italic", padding: "12px 0", textAlign: "center" }}>
                        Every pantry item is already in the recipe.
                      </div>
                    ) : candidates.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { addPantryRow(p); setAddOpen(false); }}
                        style={swapOptionBtn}
                      >
                        <span style={{ fontSize: 16 }}>{p.emoji || "🥫"}</span>
                        <span style={{ flex: 1, textAlign: "left", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
                          {p.name}
                        </span>
                        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888" }}>
                          {p.amount}{p.unit ? ` ${p.unit}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </Section>

          {/* Recipe Feedback — second prompt, scoped to this sketch.
              Shapes the EXECUTION (technique, seasoning, plating) of
              the final cook. Distinct from the Meal Prompt at setup
              which shaped the CONCEPT. */}
          <Section label="ANY LAST NOTES BEFORE WE COOK?">
            <textarea
              value={recipeFeedback}
              onChange={e => setRecipeFeedback(e.target.value)}
              placeholder='e.g. "make it spicier" · "skip the garlic in the steps" · "crispier edges" · "keep it under 30 min"'
              rows={3}
              style={{
                width: "100%", padding: "10px 12px",
                background: "#0a0a0a", border: "1px solid #242424",
                borderRadius: 10, color: "#f0ece4",
                fontFamily: "'DM Sans',sans-serif", fontSize: 13, lineHeight: 1.5,
                outline: "none", boxSizing: "border-box", resize: "vertical",
              }}
            />
          </Section>

          {/* Action bar — REGEN sketch (back to setup with same prefs)
              vs COOK THIS (locks the ingredient set + fires final). */}
          <div style={{ marginTop: 24, display: "flex", gap: 10 }}>
            <button onClick={() => setPhase("setup")} style={iconActionBtn} title="Back to setup">
              ←
            </button>
            <button onClick={start} style={secondaryBtn}>
              ↻ NEW SKETCH
            </button>
            <button
              onClick={cookFinal}
              disabled={lockedCount === 0}
              style={{
                flex: 2, padding: "14px",
                background: lockedCount === 0 ? "#2a2a2a" : "linear-gradient(135deg, #c7a8d4 0%, #a389b8 100%)",
                color: lockedCount === 0 ? "#555" : "#111",
                border: "none", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
                letterSpacing: "0.1em",
                cursor: lockedCount === 0 ? "not-allowed" : "pointer",
              }}
            >
              ✨ COOK THIS · {lockedCount}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "preview" && recipe) {
    return (
      <div>
        {header}
        {mealHeaderBlock}
        <div style={{ padding: "12px 20px 140px" }}>
          <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
            <div style={{ fontSize: 52 }}>{recipe.emoji || "🍽️"}</div>
            <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", margin: "10px 0 4px" }}>
              {recipe.title}
            </h1>
            {recipe.subtitle && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.4 }}>
                {recipe.subtitle}
              </div>
            )}
            <div style={{ marginTop: 6, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.1em" }}>
              {(recipe.cuisine || "").toUpperCase()} · {totalTimeMin(recipe)} MIN · {difficultyLabel(recipe.difficulty).toUpperCase()} · SERVES {recipe.serves}
            </div>
            {/* Meal-composition tags — course (main/side/...) and meal
                timing (breakfast/lunch/...) render as small neutral pills
                below the cuisine line. Only surface when Claude stamped
                them; a recipe with null tags (old drafts pre-Phase-1)
                skips this row entirely. Neutral styling (no color)
                keeps clear of the reserved color axes in CLAUDE.md. */}
            {(recipe.course || recipe.mealTiming) && (
              <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                {recipe.course     && <MetaPill label={recipe.course} />}
                {recipe.mealTiming && <MetaPill label={recipe.mealTiming} />}
              </div>
            )}
            {/* Nutrition summary — per-serving macros rolled up from
                the ingredients list. `coverage` discloses gaps so we
                don't pretend a recipe is 100% known when some lines
                didn't resolve. */}
            <RecipeNutritionLine recipe={recipe} pantry={pantry} ingredientInfo={ingredientInfo} brandNutrition={brandNutrition} />
          </div>

          {recipe.aiRationale && (
            // "Why I picked this" banner. Claude cites the concrete
            // signals it used — expiring items, the user's stated
            // preferences, recent cuisine runs, cooking level — so
            // the draft doesn't feel like a black box. Styled softer
            // than the bundled copy so it reads as AI commentary, not
            // part of the recipe.
            <div style={{
              marginTop: 8, padding: "12px 14px",
              background: "linear-gradient(135deg, #1a1624 0%, #141018 100%)",
              border: "1px solid #2e2538",
              borderRadius: 12,
              display: "flex", gap: 10, alignItems: "flex-start",
            }}>
              <div style={{ fontSize: 18, flexShrink: 0, lineHeight: 1 }}>✨</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
                  color: "#c7a8d4", letterSpacing: "0.12em", marginBottom: 4,
                }}>
                  WHY THIS DISH
                </div>
                <div style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                  color: "#d8d2c8", lineHeight: 1.55,
                }}>
                  {recipe.aiRationale}
                </div>
              </div>
            </div>
          )}

          <Section label={`INGREDIENTS · ${recipe.ingredients?.length || 0}`}>
            <IngredientsWithPairing
              ingredients={recipe.ingredients || []}
              pantry={pantry}
              onShoppingAdd={onShoppingAdd}
            />
          </Section>

          <Section label={`STEPS · ${recipe.steps?.length || 0}`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(recipe.steps || []).map((step, i) => (
                <div key={step.id || i} style={{
                  background: "#141414", border: "1px solid #222", borderRadius: 12,
                  padding: "12px 14px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 11,
                      background: "#1a1608", border: "1px solid #3a2f10",
                      fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#f5c842",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontFamily: "'Fraunces',serif", fontSize: 15, color: "#f0ece4", fontWeight: 400 }}>
                      {step.title}
                    </span>
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#bbb", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {step.instruction}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Bottom action area — two rows when the recipe is a plate
            piece (compose row + action bar); single row when it's a
            bake/prep component (nothing to pair with). */}
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          maxWidth: 480, margin: "0 auto",
          padding: "8px 20px 22px",
          background: "linear-gradient(180deg, rgba(11,11,11,0) 0%, #0b0b0b 40%)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {recipe.course !== "bake" && recipe.course !== "prep" && (
            <ComposeRow
              filledSlots={filledSlots}
              onAdd={openAddSheet}
              disabled={!!busy}
            />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={start}
              disabled={!!busy}
              style={{ ...iconActionBtn, opacity: busy ? 0.5 : 1 }}
              title="Draft a different recipe"
            >
              ↻
            </button>
            <button
              onClick={handleSave}
              disabled={!!busy}
              style={{ ...outlineBtn, opacity: busy ? 0.5 : 1 }}
            >
              {busy === "save" ? "…" : "SAVE"}
            </button>
            <button
              onClick={handleSchedule}
              disabled={!!busy}
              style={{ ...outlineBtn, opacity: busy ? 0.5 : 1 }}
            >
              {busy === "schedule" ? "…" : "📅 SCHED"}
            </button>
            <button
              onClick={handleCookIt}
              disabled={!!busy}
              style={{ ...primaryBtn, flex: 2, opacity: busy ? 0.6 : 1 }}
            >
              {busy === "cook" ? "SAVING…" : "COOK IT →"}
            </button>
          </div>
        </div>
        {addSheetCourse && (
          <AddComponentSheet
            courseType={addSheetCourse}
            onDraftNew={() => draftNewComponent(addSheetCourse)}
            onPickExisting={() => {
              setPickExistingFor(addSheetCourse);
              setAddSheetCourse(null);
            }}
            onClose={() => setAddSheetCourse(null)}
            busy={busy}
          />
        )}
        {pickExistingFor && (
          <PickExistingPicker
            courseType={pickExistingFor}
            anchor={mealInProgress?.anchor || recipe}
            userRecipes={userRecipes}
            bundledRecipes={bundledRecipes}
            alreadyPinnedSlugs={(mealInProgress?.pieces || []).map(p => p.recipe?.slug).filter(Boolean)}
            onPick={(picked) => attachExistingComponent(pickExistingFor, picked)}
            onClose={() => setPickExistingFor(null)}
          />
        )}
      </div>
    );
  }

  // setup phase
  return (
    <div>
      {header}
      {mealHeaderBlock}
      <div style={{ padding: "12px 20px 40px" }}>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 30, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", letterSpacing: "-0.02em", margin: 0 }}>
          What are we making?
        </h1>
        <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.5 }}>
          {pantryCount === 0
            ? "Your pantry is empty — I'll lean on staples."
            : `I'll look at ${pantryCount} pantry ${pantryCount === 1 ? "item" : "items"} and shape the recipe around what you tell me below.`}
        </div>

        {/* MEAL PROMPT — hero input, top of the screen. The user is
            directing an AI that's looking into their kitchen; this is
            where they tell it what they're in the mood for. Styled
            with the AI accent gradient border so it reads as the
            primary input, not a footnote. */}
        <div style={{
          marginTop: 24, padding: "14px 14px 10px",
          background: "linear-gradient(135deg, #1e1a28 0%, #1a1818 100%)",
          border: "1px solid #c7a8d455",
          borderRadius: 14,
        }}>
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 10,
            color: "#c7a8d4", letterSpacing: "0.12em", marginBottom: 8,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span>✨</span> MEAL PROMPT
          </div>
          <textarea
            value={mealPrompt}
            onChange={e => setMealPrompt(e.target.value)}
            placeholder={'e.g. "Italian lasagna, Sunday-dinner energy"  ·  "Light breakfast with the eggs"  ·  "Dessert that uses the ricotta before it goes"'}
            rows={3}
            style={{
              width: "100%", padding: "6px 0",
              background: "transparent", border: "none",
              color: "#f0ece4",
              fontFamily: "'DM Sans',sans-serif", fontSize: 14, lineHeight: 1.5,
              outline: "none", boxSizing: "border-box", resize: "vertical",
            }}
          />
          <div style={{
            marginTop: 6,
            fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#777",
            fontStyle: "italic",
          }}>
            Tell me what you're in the mood for — I'll pull from your kitchen.
          </div>
        </div>

        {/* PRIORITY — meta-level stance about how Claude should
            balance the user's requested course/flavor/prompt against
            their actual pantry inventory. Hoisted to the top of the
            form (right under the meal prompt, above every other
            chip row) because it colors how EVERY lower-ranked
            constraint is interpreted: star ingredients, course,
            timing, and cuisine all behave differently depending on
            whether we're filtering the palette to category-compatible
            items or leaning into what's stocked. Placing it below
            COURSE made users commit to a course before seeing that
            their pantry might not support it. */}
        <Section label="PRIORITY">
          <ChipRow
            value={priority}
            onChange={setPriority}
            options={PRIORITY_CHIPS}
            color="#7ec87e"
          />
        </Section>

        {/* MUST-INCLUDE picker — the full pantry, searchable. Multi-
            select: the user's explicit "these have to be in the dish"
            signal. Beats the expiring-soon heuristic in the ranker
            and flows into the prompt's star-ingredient block.
            Previously this was gated to proteins only; users wanted
            to tag things like Crisco or a specific cheese when that
            ingredient was the POINT of the dish. */}
        {starOptionGroups.length > 0 && renderStarPicker({
          starOptionGroups,
          starIngredientIds,
          setStarIngredientIds,
          starSearch,
          setStarSearch,
        })}

        <Section label="COURSE">
          <ChipRow
            value={course}
            onChange={setCourse}
            options={COURSE_CHIPS}
            color="#e07a3a"
          />
        </Section>

        {/* MEAL TIMING hides for bake/prep courses — a sourdough loaf
            or a gallon of stock isn't pinned to breakfast/lunch/dinner.
            Reset to "any" when the user flips to those courses so the
            backend doesn't receive a stale timing signal. */}
        {course !== "bake" && course !== "prep" && (
          <Section label="MEAL TIMING">
            <ChipRow
              value={mealTiming}
              onChange={setMealTiming}
              options={MEAL_TIMING_CHIPS}
              color="#f5c842"
            />
          </Section>
        )}

        <Section label="CUISINE">
          <ChipRow
            value={cuisine}
            onChange={setCuisine}
            options={CUISINE_CHIPS}
            color="#7eb8d4"
          />
        </Section>

        <Section label="TIME">
          <ChipRow
            value={time}
            onChange={setTime}
            options={TIME_CHIPS}
            color="#a8d5a2"
          />
        </Section>

        <Section label="DIFFICULTY">
          <ChipRow
            value={difficulty}
            onChange={setDifficulty}
            options={DIFFICULTY_CHIPS}
            color="#f5c842"
          />
        </Section>

        <button
          onClick={start}
          style={{
            marginTop: 24, width: "100%", padding: "14px",
            background: "linear-gradient(135deg, #c7a8d4 0%, #a389b8 100%)",
            color: "#111",
            border: "none", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
            letterSpacing: "0.1em", cursor: "pointer",
          }}
        >
          ✨ DRAFT RECIPE
        </button>
      </div>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────

// Renders the ingredients list on the preview / cook-ready screen
// with a live-derived "we'll use your X from your fridge" sub-line
// per row. The pair lookup runs every render against the CURRENT
// pantry, so the pairing is always fresh — if the user cooks this
// dish again in a month with different brands on hand, the banner
// reflects today's pantry, not whatever was stocked when the recipe
// was first drafted. Only the canonical + dietaryClaims intent
// persists on the recipe; pantry identity is re-bound live.
//
// Tone conventions match the pill palette already in use:
//   gray  (#7ec87e) — clean pair, in-kitchen
//   amber (#f59e0b) — substitute or missing, no dietary conflict
//   red   (#e8908a) — dietary conflict on the chosen pair/sub
function IngredientsWithPairing({ ingredients, pantry, onShoppingAdd }) {
  const pairings = pairRecipeIngredients(ingredients, pantry || []);
  // Track per-row shopping adds locally so the button flips to
  // ✓ ON LIST after commit without waiting for the parent to
  // round-trip state back down.
  const [shoppedIdx, setShoppedIdx] = useState(new Set());
  const addOneToShopping = (ing, idx) => {
    if (!onShoppingAdd) return;
    if (shoppedIdx.has(idx)) return;
    const canon = ing.ingredientId ? findIngredient(ing.ingredientId) : null;
    onShoppingAdd([{
      name:         canon?.name || ing.item || "item",
      amount:       typeof ing.amount === "string"
        ? parseFloat(ing.amount) || 1
        : (Number(ing.amount) || 1),
      unit:         typeof ing.amount === "string"
        ? (String(ing.amount).replace(/[\d.\s]+/, "").trim() || "count")
        : "count",
      ingredientId: ing.ingredientId || null,
      source:       "ai-recipe",
    }]);
    setShoppedIdx(prev => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {pairings.map((p, i) => {
        const { ingredient: ing, paired, closestMatch, lostClaims, status } = p;
        const describe = describePairing(p);
        const showRow = paired || closestMatch;
        const cut = showRow ? deriveRowCut(showRow) : null;
        const toneColor = describe?.tone === "gray"  ? "#7ec87e"
                        : describe?.tone === "amber" ? "#f59e0b"
                        : describe?.tone === "red"   ? "#e8908a"
                        : "#888";
        const borderColor = describe?.tone === "red" ? "#3a1f1f"
                          : describe?.tone === "amber" ? "#3a2a1a"
                          : "#222";
        const showShop = status === "missing" && !!onShoppingAdd;
        const shopDone = shoppedIdx.has(i);
        return (
          <div key={i} style={{
            background: "#141414", border: `1px solid ${borderColor}`, borderRadius: 10,
            padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#b8a878", minWidth: 60 }}>
                {ing.amount || "—"}
              </span>
              <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
                {ing.item}
              </span>
              {cut && (
                <span style={{
                  padding: "1px 7px",
                  background: "#201a26", border: "1px solid #3b2f48",
                  borderRadius: 8,
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  color: "#c7a8d4", letterSpacing: "0.08em",
                }}>
                  {String(cut).toUpperCase()}
                </span>
              )}
              {ing.ingredientId && (
                <span style={{ marginLeft: "auto", fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#b8a878" }}>
                  · {ing.ingredientId}
                </span>
              )}
            </div>
            {describe && (
              <div style={{
                fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontStyle: "italic",
                color: toneColor, paddingLeft: 70, lineHeight: 1.4,
              }}>
                {describe.text}
                {lostClaims.length > 0 && (
                  <>
                    {" — "}
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, fontStyle: "normal", letterSpacing: "0.04em" }}>
                      ⚠ NO LONGER {lostClaims.map(c => c.toUpperCase()).join(" / ")}
                    </span>
                  </>
                )}
              </div>
            )}
            {showShop && (
              <div style={{ paddingLeft: 70, marginTop: 4 }}>
                <button
                  onClick={() => addOneToShopping(ing, i)}
                  disabled={shopDone}
                  style={shopDone ? previewShopBtnDone : previewShopBtn}
                >
                  {shopDone ? "✓ ON LIST" : "+ SHOP"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const previewShopBtn = {
  padding: "5px 10px",
  background: "#1a1608", border: "1px solid #3a2f10",
  color: "#f5c842", borderRadius: 8,
  fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
  letterSpacing: "0.08em", cursor: "pointer", whiteSpace: "nowrap",
};
const previewShopBtnDone = { ...previewShopBtn, background: "#0f1a0f", borderColor: "#22c55e44", color: "#4ade80", cursor: "default" };

function Section({ label, children }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 10 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

// Small neutral pill for meal-composition tags (course, mealTiming) on
// recipe cards and previews. Neutral styling sidesteps the reserved
// color axes in CLAUDE.md (tan/orange/blue/purple/yellow). Exported
// via file-local usage; CreateMenu imports its own copy for the
// PICK A RECIPE row.
function MetaPill({ label }) {
  return (
    <span style={{
      fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
      color: "#aaa", background: "#1a1a1a",
      border: "1px solid #2a2a2a",
      padding: "2px 7px", borderRadius: 6,
      letterSpacing: "0.1em", textTransform: "uppercase",
    }}>
      {label}
    </span>
  );
}

function ChipRow({ value, onChange, options, color = "#f5c842" }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              padding: "7px 14px",
              background: active ? "#1e1a0e" : "#161616",
              border: `1px solid ${active ? color : "#2a2a2a"}`,
              color: active ? color : "#888",
              borderRadius: 20,
              fontFamily: "'DM Sans',sans-serif", fontSize: 12,
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const iconBtn = {
  background: "#161616", border: "1px solid #2a2a2a",
  borderRadius: 18, width: 34, height: 34,
  color: "#aaa", fontSize: 16, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  lineHeight: 1,
};
const primaryBtn = {
  flex: 1, padding: "14px",
  background: "#f5c842", color: "#111",
  border: "none", borderRadius: 12,
  fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
  letterSpacing: "0.08em", cursor: "pointer",
};
const secondaryBtn = {
  flex: 1, padding: "14px",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  color: "#888", borderRadius: 12,
  fontFamily: "'DM Mono',monospace", fontSize: 12,
  letterSpacing: "0.08em", cursor: "pointer",
};
// Used in the preview action bar — a neutral outline button that sits
// between REGEN (subtle) and COOK IT (yellow CTA) so SAVE / SCHEDULE
// don't fight the primary action for attention.
const outlineBtn = {
  flex: 1, padding: "12px 8px",
  background: "transparent", border: "1px solid #3a3a3a",
  color: "#c7a8d4", borderRadius: 12,
  fontFamily: "'DM Mono',monospace", fontSize: 10,
  fontWeight: 600, letterSpacing: "0.06em",
  cursor: "pointer", whiteSpace: "nowrap",
};
// Narrow square REGEN tap target — frees horizontal space for the
// three action buttons to breathe.
const iconActionBtn = {
  width: 42, padding: "12px 0",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  color: "#888", borderRadius: 12,
  fontFamily: "'DM Mono',monospace", fontSize: 16,
  cursor: "pointer", flexShrink: 0,
};

// ── Tweak phase buttons ─────────────────────────────────────────────
const swapBtn = {
  padding: "5px 10px",
  background: "#0f1620", border: "1px solid #1f3040",
  color: "#7eb8d4", borderRadius: 8,
  fontFamily: "'DM Mono',monospace", fontSize: 9,
  letterSpacing: "0.06em", cursor: "pointer", whiteSpace: "nowrap",
};
const swapBtnActive = { ...swapBtn, background: "#1a2430", color: "#9bcae0" };
const removeBtn = {
  width: 28, height: 28, padding: 0,
  background: "transparent", border: "1px solid #2a2a2a",
  color: "#666", borderRadius: 14,
  fontFamily: "'DM Mono',monospace", fontSize: 14,
  cursor: "pointer", flexShrink: 0,
};
const undoChip = {
  padding: "4px 8px",
  background: "transparent", border: "1px solid #2a2a2a",
  color: "#888", borderRadius: 8,
  fontFamily: "'DM Mono',monospace", fontSize: 9,
  letterSpacing: "0.06em", cursor: "pointer",
};
const swapOptionBtn = {
  display: "flex", alignItems: "center", gap: 10,
  padding: "8px 10px", width: "100%",
  background: "#141414", border: "1px solid #242424",
  borderRadius: 8, cursor: "pointer", textAlign: "left",
};
const swapClearBtn = {
  marginTop: 4, padding: "6px 10px",
  background: "transparent", border: "1px dashed #3a3a3a",
  color: "#888", borderRadius: 8,
  fontFamily: "'DM Mono',monospace", fontSize: 10,
  letterSpacing: "0.06em", cursor: "pointer",
};
const swapSearchInput = {
  width: "100%", padding: "8px 10px",
  background: "#0a0a0a", border: "1px solid #2a2a2a",
  borderRadius: 8, color: "#f0ece4",
  fontFamily: "'DM Sans',sans-serif", fontSize: 12,
  outline: "none", boxSizing: "border-box",
};
const addBtn = {
  width: "100%", padding: "10px",
  background: "transparent", border: "1px dashed #3a3a3a",
  color: "#888", borderRadius: 10,
  fontFamily: "'DM Mono',monospace", fontSize: 11,
  letterSpacing: "0.08em", cursor: "pointer",
};
const addBtnActive = { ...addBtn, color: "#aaa", borderStyle: "solid" };
const shopBtn = {
  padding: "6px 12px",
  background: "#1a1608", border: "1px solid #3a2f10",
  color: "#f5c842", borderRadius: 8,
  fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
  letterSpacing: "0.08em", cursor: "pointer", whiteSpace: "nowrap",
};
const shopActiveBtn = {
  ...shopBtn,
  background: "#0f1a0f", border: "1px solid #1e3a1e", color: "#7ec87e",
};

// Auto-generate a display name for a composed meal. Uses the anchor's
// title directly; if we have a strong cuisine + mealTiming signal
// we append a descriptor ("Ribeye · Italian Dinner"). Keeps it short
// so it fits a calendar tile. User can rename later via a library edit.
function buildMealName(anchor, _pieces) {
  if (!anchor?.title) return "Untitled meal";
  const base = anchor.title.trim();
  const bits = [];
  if (anchor.cuisine && anchor.cuisine !== "other") {
    bits.push(anchor.cuisine.charAt(0).toUpperCase() + anchor.cuisine.slice(1));
  }
  if (anchor.mealTiming) {
    bits.push(anchor.mealTiming.charAt(0).toUpperCase() + anchor.mealTiming.slice(1));
  }
  return bits.length ? `${base} · ${bits.join(" ")}` : base;
}

// ── Compose-a-meal components ────────────────────────────────────────

// COMPOSE_SLOTS defines the non-main slots the user can add to a meal.
// "main" is established by the anchor (the recipe currently on
// preview), so the compose row only surfaces the three optional
// accompaniments. "bake" and "prep" aren't here — those are pantry-
// building components, not plate roles.
const COMPOSE_SLOTS = [
  { id: "side",      label: "+ SIDE",    emoji: "🥗" },
  { id: "dessert",   label: "+ DESSERT", emoji: "🍰" },
  { id: "appetizer", label: "+ APP",     emoji: "🥟" },
];

// Sticky MEAL header — renders at the top of AIRecipe whenever a meal
// is mid-compose. Pills show every piece already pinned (tap × to
// unpin — removes from the meal only, recipe stays in library).
// Empty slots render as "+ Add X" buttons. SAVE MEAL on the right
// commits the composition (Phase 3 will write the meals row; for now
// it just closes since pieces are already saved individually).
function MealInProgressHeader({ meal, filledSlots, onAdd, onRemovePiece, onFinish, disabled }) {
  // filledSlots already folds in the currently-previewed recipe's
  // course (computed in the parent) so clicking "+ SIDE" from a side
  // preview is prevented — the "+ Add X" button is hidden entirely.
  const filled = filledSlots || new Set((meal?.pieces || []).map(p => p.course));
  const anchorLabel = meal?.anchor?.title || "this meal";
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 20,
      padding: "10px 20px 12px",
      background: "linear-gradient(180deg, #0b0b0b 70%, rgba(11,11,11,0.92) 100%)",
      borderBottom: "1px solid #2a2a2a",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 14 }}>🍽️</span>
        <div style={{
          flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 9,
          color: "#888", letterSpacing: "0.12em", textTransform: "uppercase",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          Your meal · {anchorLabel}
        </div>
        <button
          onClick={onFinish}
          disabled={disabled}
          style={{
            padding: "5px 10px",
            background: "#1a1608", border: "1px solid #3a2f10",
            color: "#f5c842", borderRadius: 8,
            fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
            letterSpacing: "0.1em", cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          SAVE MEAL
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(meal?.pieces || []).map((piece, i) => (
          <MealPiecePill
            key={`${piece.recipe?.slug || piece.course}-${i}`}
            piece={piece}
            removable={piece.course !== "main"}
            onRemove={() => onRemovePiece(i)}
          />
        ))}
        {COMPOSE_SLOTS.filter(s => !filled.has(s.id)).map(slot => (
          <button
            key={slot.id}
            onClick={() => onAdd(slot.id)}
            disabled={disabled}
            style={{
              padding: "5px 10px",
              background: "#141414",
              border: "1px dashed #3a3a3a",
              color: "#888", borderRadius: 8,
              fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
              letterSpacing: "0.1em", cursor: disabled ? "not-allowed" : "pointer",
              display: "inline-flex", alignItems: "center", gap: 4,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <span>{slot.emoji}</span>
            {slot.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MealPiecePill({ piece, removable, onRemove }) {
  const emoji = piece.recipe?.emoji || (
    piece.course === "main" ? "🍽️" :
    piece.course === "side" ? "🥗" :
    piece.course === "dessert" ? "🍰" : "🥟"
  );
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 8px",
      background: "#161616", border: "1px solid #2a2a2a",
      borderRadius: 8,
      fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#d8d2c8",
      maxWidth: 180,
    }}>
      <span style={{ fontSize: 12 }}>{emoji}</span>
      <span style={{
        fontFamily: "'DM Mono',monospace", fontSize: 8, fontWeight: 700,
        color: "#888", letterSpacing: "0.1em", textTransform: "uppercase",
      }}>
        {piece.course}
      </span>
      <span style={{
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        maxWidth: 100,
      }}>
        {piece.recipe?.title || "(untitled)"}
      </span>
      {removable && (
        <button
          onClick={onRemove}
          style={{
            background: "transparent", border: "none",
            color: "#666", fontSize: 12, lineHeight: 1,
            padding: 0, marginLeft: 2, cursor: "pointer",
          }}
          title="Remove from meal (keeps recipe in library)"
        >
          ×
        </button>
      )}
    </span>
  );
}

// Row of three small outline buttons above the main preview action
// bar. Filled slots render as disabled "✓ SIDE" confirmations; unfilled
// slots are tappable "+ SIDE" adds. Hidden entirely when the current
// recipe is a bake/prep component (not a plate piece).
function ComposeRow({ filledSlots, onAdd, disabled }) {
  const filled = filledSlots || new Set();
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {COMPOSE_SLOTS.map(slot => {
        const isFilled = filled.has(slot.id);
        return (
          <button
            key={slot.id}
            onClick={() => !isFilled && onAdd(slot.id)}
            disabled={disabled || isFilled}
            style={{
              flex: 1, padding: "8px 4px",
              background: isFilled ? "#0f1a0f" : "transparent",
              border: `1px ${isFilled ? "solid" : "dashed"} ${isFilled ? "#1e3a1e" : "#3a3a3a"}`,
              color: isFilled ? "#7ec87e" : "#888",
              borderRadius: 10,
              fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 600,
              letterSpacing: "0.08em", whiteSpace: "nowrap",
              cursor: (disabled || isFilled) ? "default" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {isFilled ? `✓ ${slot.id.toUpperCase()}` : slot.label}
          </button>
        );
      })}
    </div>
  );
}

// Bottom sheet that asks "Draft new" vs "Pick existing" for a given
// course. Backdrop dismisses. Tapping "Draft new" kicks straight into
// the setup flow with pairWith seeded; "Pick existing" opens the
// filtered library picker.
function AddComponentSheet({ courseType, onDraftNew, onPickExisting, onClose, busy }) {
  const label = courseType === "appetizer" ? "APPETIZER" : courseType.toUpperCase();
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 220,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480,
          background: "#141414",
          borderTop: "1px solid #2a2a2a",
          borderRadius: "16px 16px 0 0",
          padding: "20px 20px 28px",
          display: "flex", flexDirection: "column", gap: 10,
        }}
      >
        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: "#888", letterSpacing: "0.12em",
          marginBottom: 4,
        }}>
          ADD A {label}
        </div>
        <button
          onClick={onDraftNew}
          disabled={!!busy}
          style={addPathBtn}
        >
          <span style={{ fontSize: 20 }}>✨</span>
          <span style={{ flex: 1, textAlign: "left" }}>
            <span style={addPathTitle}>Draft new</span>
            <span style={addPathBlurb}>
              Claude builds a {courseType} that complements this dish.
            </span>
          </span>
        </button>
        <button
          onClick={onPickExisting}
          disabled={!!busy}
          style={addPathBtn}
        >
          <span style={{ fontSize: 20 }}>📖</span>
          <span style={{ flex: 1, textAlign: "left" }}>
            <span style={addPathTitle}>Pick existing</span>
            <span style={addPathBlurb}>
              Choose a {courseType} from your recipes or the library.
            </span>
          </span>
        </button>
        <button
          onClick={onClose}
          style={{
            marginTop: 6, padding: "10px",
            background: "transparent", border: "1px solid #2a2a2a",
            color: "#888", borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 10,
            letterSpacing: "0.08em", cursor: "pointer",
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}

const addPathBtn = {
  display: "flex", alignItems: "center", gap: 12,
  padding: "14px 14px",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  borderRadius: 12, cursor: "pointer",
  textAlign: "left",
};
const addPathTitle = {
  display: "block",
  fontFamily: "'Fraunces',serif", fontSize: 16, fontStyle: "italic",
  color: "#f0ece4", fontWeight: 400,
};
const addPathBlurb = {
  display: "block", marginTop: 2,
  fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888",
  lineHeight: 1.4,
};

// Full-screen library picker for the "Pick existing" path. Filtered to
// course=target (keeps strict for sides / desserts / apps so the user
// doesn't accidentally pin a main as a side). Soft-sorted by cuisine
// match to the anchor, then mealTiming match, then recency. Recipes
// already in the meal render disabled with an "IN MEAL" badge so the
// user can't double-add.
function PickExistingPicker({
  courseType, anchor,
  userRecipes, bundledRecipes,
  alreadyPinnedSlugs,
  onPick, onClose,
}) {
  const [query, setQuery] = useState("");

  const pinned = new Set(alreadyPinnedSlugs || []);

  // Flatten candidates from both sources. User recipes come as rows
  // with { id, recipe, source }; bundled as flat recipe objects.
  const candidates = useMemo(() => {
    const rows = [];
    (userRecipes || []).forEach((ur) => {
      if (ur && ur.recipe) rows.push({ recipe: ur.recipe, source: ur.source || "user", createdAt: ur.createdAt || null });
    });
    (bundledRecipes || []).forEach((r) => {
      if (r) rows.push({ recipe: r, source: "bundled", createdAt: null });
    });
    return rows;
  }, [userRecipes, bundledRecipes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (r) => {
      if (!q) return true;
      return (r.title || "").toLowerCase().includes(q) ||
             (r.cuisine || "").toLowerCase().includes(q) ||
             (r.category || "").toLowerCase().includes(q);
    };
    const anchorCuisine    = anchor?.cuisine || null;
    const anchorMealTiming = anchor?.mealTiming || null;
    const scored = [];
    candidates.forEach((row) => {
      const r = row.recipe;
      if (!r || !matchesQuery(r)) return;
      // Strict course filter. A recipe with no `course` tag (pre-Phase-1
      // draft) is eligible only if its `category` hints strongly at
      // the target (e.g. category="dessert" for a dessert slot). Keeps
      // the picker useful before every recipe has been re-tagged.
      const recipeCourse = r.course || null;
      if (recipeCourse && recipeCourse !== courseType) return;
      if (!recipeCourse) {
        if (courseType === "dessert" && r.category !== "dessert") return;
        if (courseType !== "dessert" && r.category === "dessert")  return;
      }
      let score = 0;
      if (anchorCuisine    && r.cuisine    === anchorCuisine)    score += 3;
      if (anchorMealTiming && r.mealTiming === anchorMealTiming) score += 2;
      if (recipeCourse === courseType)                           score += 1;
      scored.push({ row, score });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.row);
  }, [candidates, query, courseType, anchor]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 230,
      background: "#0b0b0b",
      maxWidth: 480, margin: "0 auto",
      overflowY: "auto",
    }}>
      <div style={{
        padding: "24px 20px 12px",
        display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid #1e1e1e",
      }}>
        <button onClick={onClose} style={iconBtn}>←</button>
        <div style={{
          flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: "#c7a8d4", letterSpacing: "0.12em",
        }}>
          PICK A {courseType === "appetizer" ? "APPETIZER" : courseType.toUpperCase()}
        </div>
        <button onClick={onClose} style={iconBtn}>✕</button>
      </div>
      <div style={{ padding: "14px 20px 0" }}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${courseType}s…`}
          style={{
            width: "100%", padding: "12px 14px",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            borderRadius: 10, color: "#f0ece4", boxSizing: "border-box",
            fontFamily: "'DM Sans',sans-serif", fontSize: 14, outline: "none",
          }}
        />
        {anchor?.cuisine && (
          <div style={{
            marginTop: 8,
            fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#777",
            fontStyle: "italic",
          }}>
            Sorted by fit with your {anchor.cuisine} main.
          </div>
        )}
      </div>
      <div style={{ padding: "14px 20px 60px", display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{
            padding: 40, textAlign: "center",
            color: "#555", fontFamily: "'DM Sans',sans-serif", fontSize: 13,
          }}>
            No {courseType} recipes yet. Try "Draft new" instead.
          </div>
        )}
        {filtered.map((row, i) => {
          const r = row.recipe;
          const isPinned = pinned.has(r.slug);
          return (
            <button
              key={`${r.slug || "recipe"}-${i}`}
              onClick={() => !isPinned && onPick(r)}
              disabled={isPinned}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px",
                background: isPinned ? "#0f1a0f" : "#161616",
                border: `1px solid ${isPinned ? "#1e3a1e" : "#2a2a2a"}`,
                borderRadius: 12,
                cursor: isPinned ? "default" : "pointer",
                textAlign: "left",
                opacity: isPinned ? 0.7 : 1,
              }}
            >
              <div style={{ fontSize: 26, flexShrink: 0 }}>{r.emoji || "🍽️"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'Fraunces',serif", fontSize: 15, color: "#f0ece4",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {r.title}
                </div>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555",
                  letterSpacing: "0.05em", marginTop: 2,
                }}>
                  {(r.cuisine || "").toUpperCase()}
                  {r.mealTiming ? ` · ${r.mealTiming.toUpperCase()}` : ""}
                  {row.source === "bundled" ? " · BUNDLED" : row.source === "ai" ? " · AI" : " · CUSTOM"}
                </div>
              </div>
              {isPinned ? (
                <span style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
                  color: "#7ec87e", background: "#0f1a0f",
                  border: "1px solid #1e3a1e",
                  padding: "3px 7px", borderRadius: 6,
                  letterSpacing: "0.1em",
                }}>
                  IN MEAL
                </span>
              ) : (
                <span style={{ color: "#c7a8d4", fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Per-serving macros rolled up across the recipe's ingredients.
// Renders as a compact single line between the cuisine/timing meta
// and the ingredients list. Hidden when no ingredient resolves so
// we don't surface a fake "0 kcal" on a recipe the nutrition data
// doesn't cover. Coverage ratio ("based on 7 of 9") is always shown
// when partial so the user knows we're estimating.
function RecipeNutritionLine({ recipe, pantry, ingredientInfo, brandNutrition }) {
  const summary = useMemo(
    () => recipeNutrition(recipe, { pantry, getInfo: ingredientInfo?.getInfo, brandNutrition }),
    [recipe, pantry, ingredientInfo, brandNutrition],
  );
  if (!summary || summary.coverage.resolved === 0) return null;
  const { resolved, total } = summary.coverage;
  const partial = resolved < total;
  return (
    <div style={{
      marginTop: 10, padding: "8px 12px",
      background: "#141414", border: "1px solid #242424",
      borderRadius: 10, textAlign: "center",
    }}>
      <div style={{
        fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4",
      }}>
        ~ {formatMacros(summary.perServing, { verbose: true })}
      </div>
      <div style={{
        marginTop: 3,
        fontFamily: "'DM Mono',monospace", fontSize: 9,
        color: "#666", letterSpacing: "0.08em",
      }}>
        PER SERVING
        {partial ? ` · BASED ON ${resolved} OF ${total} INGREDIENTS` : ""}
      </div>
    </div>
  );
}
