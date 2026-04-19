import { useEffect, useMemo, useState } from "react";
import { generateRecipe } from "../lib/generateRecipe";
import { buildAIContext } from "../lib/aiContext";
import { totalTimeMin, difficultyLabel } from "../data/recipes";
import { findIngredient } from "../data/ingredients";

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
  { id: "any",     label: "Any course" },
  { id: "main",    label: "Main" },
  { id: "side",    label: "Side" },
  { id: "dessert", label: "Dessert" },
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

export default function AIRecipe({
  pantry = [],
  profile,          // viewer's profile row (dietary, level, skill_levels, …)
  cookLogs = [],    // viewer's recent cook_log rows for the history summary
  ingredientInfo,   // the useIngredientInfo() context — optional
  onCancel,
  onSave,           // (recipe) => Promise — persist privately, then close
  onSchedule,       // (recipe) => Promise — parent persists + opens SchedulePicker
  onSaveAndCook,    // (recipe) => Promise — existing save + cook path
}) {
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
  const [swapOpenIdx, setSwapOpenIdx] = useState(null);
  const [addOpen, setAddOpen]         = useState(false);
  // Revision instruction for the FINAL cook — the user's "make it
  // spicier, skip the garlic in the steps" note. Sent as
  // prefs.recipeFeedback on the second call.
  const [recipeFeedback, setRecipeFeedback] = useState("");

  // Prefs. mealPrompt is the hero input — renamed from "notes" to
  // signal that the user is DIRECTING an AI, not scribbling a
  // secondary note. Lives at the top of the setup screen.
  const [mealPrompt, setMealPrompt] = useState("");
  const [mealTiming, setMealTiming] = useState("any");
  const [course,     setCourse]     = useState("any");
  const [starIngredientIds, setStarIngredientIds] = useState([]);
  const [cuisine,    setCuisine]    = useState("any");
  const [time,       setTime]       = useState("medium");
  const [difficulty, setDifficulty] = useState("medium");

  // Protein picker source — collapse the pantry to one chip per
  // canonical (5 cans of tuna = one TUNA chip, not five) and group
  // by category so the user can scan MEAT / POULTRY / SEAFOOD /
  // PLANT at a glance instead of reading a wall of chips. Uses the
  // canonical's full `name` (not `shortName`) so "Ground Beef" and
  // "Ground Pork" don't both read as just "Ground."
  const proteinGroups = useMemo(() => {
    const byCanonical = new Map();
    for (const row of pantry) {
      if (!isProteinRow(row)) continue;
      const slug = row.ingredientId || row.canonicalId;
      if (!slug) continue;
      if (!byCanonical.has(slug)) {
        const canon = findIngredient(slug);
        byCanonical.set(slug, {
          id: slug,
          // Full name first; shortName was causing "Ground Beef" and
          // "Ground Pork" to both render as "Ground."
          label: canon?.name || row.name || slug,
          emoji: row.emoji || canon?.emoji || "🍖",
          category: canon?.category || null,
          slug,
        });
      }
    }
    // Categories in the order we want them surfaced. Anything that
    // doesn't match one of the meat/poultry/seafood buckets lands
    // under "PLANT & OTHER" — tofu, eggs, beans, egg whites, etc.
    const categoryOrder = [
      { key: "meat",    label: "Meat" },
      { key: "poultry", label: "Poultry" },
      { key: "seafood", label: "Seafood" },
      { key: "plant",   label: "Plant & other" },
    ];
    const groups = new Map(categoryOrder.map(c => [c.key, { ...c, items: [] }]));
    for (const opt of byCanonical.values()) {
      const key = ["meat", "poultry", "seafood"].includes(opt.category)
        ? opt.category
        : "plant";
      groups.get(key).items.push(opt);
    }
    // Sort each group alphabetically; drop empties.
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
  const buildPrefs = (extra = {}) => ({
    cuisine, time, difficulty,
    mealPrompt: mealPrompt.trim() || undefined,
    mealTiming: mealTiming === "any" ? undefined : mealTiming,
    course: course === "any" ? undefined : course,
    starIngredientIds: starIngredientIds.length ? starIngredientIds : undefined,
    ...extra,
  });

  // Phase 2 entry — kicks off the cheap sketch pass. User lands on
  // the tweak screen with the rough draft + dual IDEAL/PANTRY lists,
  // can swap / remove / add / promote-to-shopping / type feedback,
  // then taps COOK THIS to fire the final full-recipe call.
  const start = async () => {
    setPhase("sketch_loading");
    setErrMsg("");
    try {
      const isRegen = previousTitles.length > 0;
      const built = buildAIContext({
        pantry, profile, ingredientInfo, cookLogs,
        mode: isRegen ? "lean" : "rich",
        starIngredientIds,
      });
      const payload = {
        mode: "sketch",
        pantry: built.pantry,
        prefs: buildPrefs(),
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
        setRecipe(result.recipe);
        if (result.recipe?.title) {
          setPreviousTitles(prev => (prev.includes(result.recipe.title) ? prev : [...prev, result.recipe.title]));
        }
        setPhase("preview");
        return;
      }
      const drafted = result.sketch;
      setSketch(drafted);
      // Reset the tweak diff every fresh sketch — old swaps from a
      // previous draft don't apply to the new ingredient list.
      setPantryEdits({ swaps: {}, removes: new Set(), adds: [], shopping: new Set() });
      setRecipeFeedback("");
      setSwapOpenIdx(null);
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
      const built = buildAIContext({
        pantry, profile, ingredientInfo, cookLogs,
        mode: "rich",
        starIngredientIds,
      });
      const locked = buildLockedIngredients();
      const payload = {
        mode: "final",
        pantry: built.pantry,
        prefs: buildPrefs({
          recipeFeedback: recipeFeedback.trim() || undefined,
        }),
        avoidTitles: previousTitles,
        context: built.context,
        lockedIngredients: locked,
      };
      const { recipe: drafted } = await generateRecipe(payload);
      setRecipe(drafted);
      if (drafted?.title) {
        setPreviousTitles(prev => (prev.includes(drafted.title) ? prev : [...prev, drafted.title]));
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

  if (phase === "sketch_loading" || phase === "final_loading" || phase === "loading") {
    const isFinal = phase === "final_loading";
    return (
      <div>
        {header}
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
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 44, opacity: 0.6 }}>🫠</div>
          <div style={{ marginTop: 14, fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic", color: "#f0ece4" }}>
            Draft hiccup
          </div>
          <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.5 }}>
            {errMsg || "Something went sideways."}
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

    // Same-category alternates for the swap picker. Falls back to
    // an empty list when the canonical isn't in the registry.
    const swapCandidatesFor = (sketchPantryRow) => {
      const targetCanon = sketchPantryRow.ingredientId
        ? findIngredient(sketchPantryRow.ingredientId)
        : null;
      const targetCat = targetCanon?.category;
      const targetId  = targetCanon?.id;
      const seen = new Set();
      const out = [];
      for (const row of pantry) {
        const canon = row.ingredientId ? findIngredient(row.ingredientId) : null;
        // Skip the row that's already the current pick.
        if (row.id === sketchPantryRow.pantryItemId) continue;
        // Skip already-listed rows of the same canonical to keep
        // the picker compact (one chip per canonical, not per
        // physical instance).
        const key = canon?.id || row.name?.toLowerCase() || row.id;
        if (seen.has(key)) continue;
        seen.add(key);
        // Same category wins; if no canonical match was available
        // we just show every other pantry row (rare fallback).
        if (!targetCat || (canon && canon.category === targetCat) || canon?.id === targetId) {
          out.push(row);
        }
      }
      return out;
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

    // IDEAL items the user might want to grab. Filter out anything
    // the pantry list already covers (by name match) so we don't
    // double-show ingredients that ARE in the kitchen.
    const pantryNames = new Set(
      sketch.pantry
        .filter((_, i) => !pantryEdits.removes.has(i))
        .map(p => (p.name || "").toLowerCase())
    );
    sketch.pantry.forEach(p => { if (p.subbedFrom) pantryNames.add(p.subbedFrom.toLowerCase()); });
    const idealMissing = sketch.ideal
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => !pantryNames.has((row.name || "").toLowerCase()));

    const lockedCount = buildLockedIngredients().length;

    return (
      <div>
        {header}
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
          <Section label="WHAT WE'RE GRABBING FROM YOUR KITCHEN">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sketch.pantry.map((row, i) => {
                if (pantryEdits.removes.has(i)) {
                  // Removed rows render as a thin strip with an
                  // "undo" affordance so accidental removes are
                  // recoverable without re-running the sketch.
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 12px", background: "#0a0a0a",
                      border: "1px dashed #2a2a2a", borderRadius: 10,
                      fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#555",
                    }}>
                      <span><s>{row.name} · {row.amount}</s></span>
                      <button onClick={() => toggleRemove(i)} style={undoChip}>UNDO</button>
                    </div>
                  );
                }
                const swappedId = pantryEdits.swaps[i];
                const swappedRow = lookupPantryRow(swappedId);
                const originRow  = lookupPantryRow(row.pantryItemId);
                const showRow    = swappedRow || originRow;
                const swapOpen   = swapOpenIdx === i;
                return (
                  <div key={i} style={{
                    padding: "10px 12px",
                    background: "#141414", border: "1px solid #1e1e1e", borderRadius: 12,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 15, color: "#f0ece4" }}>
                          {swappedRow ? swappedRow.name : row.name} · <span style={{ color: "#aaa", fontStyle: "normal", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>{row.amount}</span>
                        </div>
                        {showRow && (
                          <div style={{ marginTop: 3, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7ec87e", letterSpacing: "0.06em" }}>
                            ✓ FROM {showRow.amount}{showRow.unit ? ` ${showRow.unit}` : ""} · {showRow.location || "pantry"}
                          </div>
                        )}
                        {!showRow && row.pantryItemId == null && (
                          <div style={{ marginTop: 3, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#f59e0b", letterSpacing: "0.06em" }}>
                            ⚠ NOT IN PANTRY — SHOPPING
                          </div>
                        )}
                        {row.subbedFrom && (
                          <div style={{ marginTop: 3, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#888", fontStyle: "italic" }}>
                            subbed from {row.subbedFrom}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => setSwapOpenIdx(swapOpen ? null : i)}
                          style={swapOpen ? swapBtnActive : swapBtn}
                        >
                          ⇌ SWAP
                        </button>
                        <button onClick={() => toggleRemove(i)} style={removeBtn}>×</button>
                      </div>
                    </div>
                    {swapOpen && (() => {
                      const candidates = swapCandidatesFor(row);
                      return (
                        <div style={{
                          marginTop: 10, paddingTop: 10,
                          borderTop: "1px dashed #2a2a2a",
                          display: "flex", flexDirection: "column", gap: 6,
                        }}>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#888", letterSpacing: "0.08em" }}>
                            SWAP TO ANOTHER {((findIngredient(row.ingredientId)?.category) || "ingredient").toUpperCase()}:
                          </div>
                          {candidates.length === 0 && (
                            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#666", fontStyle: "italic" }}>
                              Nothing else in that category — try Recipe Feedback below.
                            </div>
                          )}
                          {candidates.map(c => (
                            <button
                              key={c.id}
                              onClick={() => { applySwap(i, c.id); setSwapOpenIdx(null); }}
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
                            <button onClick={() => { clearSwap(i); setSwapOpenIdx(null); }} style={swapClearBtn}>
                              ↺ REVERT TO ORIGINAL ({row.name})
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              {/* User-added rows (egg-whites case) */}
              {pantryEdits.adds.map((add, i) => (
                <div key={`add-${i}`} style={{
                  padding: "10px 12px",
                  background: "#0f1a0f", border: "1px solid #1e3a1e", borderRadius: 12,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 14, color: "#f0ece4" }}>
                      {add.emoji ? `${add.emoji} ` : ""}{add.name} · <span style={{ color: "#aaa", fontStyle: "normal", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>{add.amount}</span>
                    </div>
                    <div style={{ marginTop: 3, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7ec87e", letterSpacing: "0.06em" }}>
                      + ADDED BY YOU
                    </div>
                  </div>
                  <button onClick={() => dropAdd(i)} style={removeBtn}>×</button>
                </div>
              ))}
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
                // Filter out pantry rows that are already in the
                // sketch (by canonical or by name) or already
                // user-added.
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

          {/* IDEAL items NOT in pantry — the "you may want to grab"
              shopping prompt. User can promote each to the locked
              list as a shopping-source ingredient. */}
          {idealMissing.length > 0 && (
            <Section label="ALSO TYPICAL IN THIS DISH">
              <div style={{ marginBottom: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#888", fontStyle: "italic" }}>
                These aren't in your kitchen. Tap to add to the recipe and your shopping list — or skip and we'll cook without.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {idealMissing.map(({ row, i }) => {
                  const promoted = pantryEdits.shopping.has(i);
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                      padding: "8px 12px",
                      background: promoted ? "#0f1a0f" : "#0a0a0a",
                      border: `1px solid ${promoted ? "#1e3a1e" : "#242424"}`,
                      borderRadius: 10,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: promoted ? "#7ec87e" : "#aaa" }}>
                          {row.name} · <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#888" }}>{row.amount}</span>
                        </div>
                        {row.role && (
                          <div style={{ marginTop: 2, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.06em" }}>
                            {row.role.toUpperCase()}
                          </div>
                        )}
                      </div>
                      <button onClick={() => togglePromoteToShopping(i)} style={promoted ? shopActiveBtn : shopBtn}>
                        {promoted ? "✓ ON LIST" : "+ SHOP"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

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
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(recipe.ingredients || []).map((ing, i) => (
                <div key={i} style={{
                  background: "#141414", border: "1px solid #222", borderRadius: 10,
                  padding: "8px 12px", display: "flex", alignItems: "center", gap: 10,
                }}>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#b8a878", minWidth: 60 }}>
                    {ing.amount || "—"}
                  </span>
                  <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
                    {ing.item}
                  </span>
                  {ing.ingredientId && (
                    <span style={{ marginLeft: "auto", fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#b8a878" }}>
                      · {ing.ingredientId}
                    </span>
                  )}
                </div>
              ))}
            </div>
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

        {/* Bottom action bar — four actions. REGEN is narrow (secondary,
            non-destructive); SAVE + SCHEDULE are medium-weight outline
            buttons; COOK IT is the flex-2 yellow CTA. */}
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          maxWidth: 480, margin: "0 auto",
          padding: "14px 20px 22px",
          background: "linear-gradient(180deg, rgba(11,11,11,0) 0%, #0b0b0b 40%)",
          display: "flex", gap: 8,
        }}>
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
    );
  }

  // setup phase
  return (
    <div>
      {header}
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

        {/* STAR INGREDIENTS — only surfaces when the pantry has
            proteins. Multi-select: the user's explicit "use these"
            signal. Beats the expiring-soon heuristic in the pantry
            ranking. */}
        {proteinGroups.length > 0 && (
          <Section label="BUILD AROUND THESE PROTEINS">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {proteinGroups.map(group => (
                <div key={group.key}>
                  {/* Per-category sub-header. Keeps the four buckets
                      (Meat / Poultry / Seafood / Plant & other) scannable
                      instead of a single wall of chips. */}
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
        )}

        <Section label="MEAL TIMING">
          <ChipRow
            value={mealTiming}
            onChange={setMealTiming}
            options={MEAL_TIMING_CHIPS}
            color="#f5c842"
          />
        </Section>

        <Section label="COURSE">
          <ChipRow
            value={course}
            onChange={setCourse}
            options={COURSE_CHIPS}
            color="#e07a3a"
          />
        </Section>

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
