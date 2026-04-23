import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { findIngredient, unitLabel } from "../data/ingredients";
import { convert, convertWithBridge, decrementRow, formatQty, planInstanceDecrement } from "../lib/unitConvert";
import { parseAmountString } from "../lib/nutrition";
import { sameCanonicalFamily, resolvesToSameCanonical, pairRecipeIngredients } from "../lib/recipePairing";
import { setComponentsForParent, leftoverCompositionFromPlan } from "../lib/pantryComponents";
import { identityKey } from "../lib/pantryFormat";
import { recipeNutrition, recipeNutritionBreakdown } from "../lib/nutrition";
import { applyCookSessionToRecipe, canonicalizeEffectiveRecipe, countActiveSwaps } from "../lib/effectiveRecipe";
import { reheatToCookInstructions } from "../lib/reheatToCookInstructions";
import CookCompleteSummary from "./CookCompleteSummary";

// Visibility gate for the per-ingredient calorie breakdown phase. The
// `nutritionDebug` phase is a diagnostic screen that exposes the
// macro-resolver trace (canonical match, factor, why a row was
// skipped) and reads as engineering output to end users. Gated behind
// a localStorage flag so day-to-day cooks go rating → notes → save
// without seeing it. Flip on when debugging a dashboard regression:
//     localStorage.setItem("mise_debug", "1")
const SHOW_NUTRITION_DEBUG = typeof localStorage !== "undefined"
  && localStorage.getItem("mise_debug") === "1";

// Completion flow shown when the user taps the final "DONE! LOG IT"
// button in CookMode. Phases:
//   1. celebrate      — confetti + "+XP" pulse, "Continue →"
//   2. ingredientsUsed— (Phase 2) what did you actually use / from which
//                       pantry row? Each recipe ingredient shows up as an
//                       editable row; ✕ drops a row the user didn't
//                       actually consume (subs, leftovers, already-out).
//   3. diners         — multi-select family + friends who ate with you
//   4. rating         — 4-face scale (rough / meh / good / nailed)
//   5. notes          — optional free-text, then save
//
// On save, we insert one row into `cook_logs`. The DB's INSERT trigger fans
// out a rating-aware notification to every diner. Positive ratings mark the
// row as a favorite so the Cookbook can surface it immediately.
//
// Props:
//   recipe       — the recipe being logged (needs slug, title, emoji, etc.)
//   userId       — chef's user id (for the row's user_id)
//   family       — [{ otherId, other: { name, ... } }] accepted family
//   friends      — [{ otherId, other: { name, ... } }] accepted friends
//   onFinish()   — called after the row is saved (or the user bailed out).
//                  Typically the parent navigates to the Cookbook here.
//
// Copy is deliberately warm — a finished meal is a celebration, not a form.

const RATINGS = [
  { id: "rough",  emoji: "😬", label: "Rough one",   color: "#ef4444", bg: "#1a0a0a", border: "#3a1a1a" },
  { id: "meh",    emoji: "😐", label: "Meh",         color: "#888",    bg: "#161616", border: "#2a2a2a" },
  { id: "good",   emoji: "😊", label: "Pretty good", color: "#4ade80", bg: "#0f1a0f", border: "#1e3a1e" },
  { id: "nailed", emoji: "🤩", label: "Nailed it",   color: "#f5c842", bg: "#1a1608", border: "#3a2f10" },
];

// Sum up the "xp per cook" weights on the recipe's skills so the celebration
// screen can show a pulsing "+N XP" number. If the recipe has no skill block,
// fall back to a token 10 XP so there's something to land on.
function totalXpForRecipe(recipe) {
  const skills = recipe?.skills;
  if (!Array.isArray(skills) || skills.length === 0) return 10;
  return skills.reduce((sum, s) => sum + (Number(s.xp) || 0), 0);
}

// Build one row per recipe ingredient for the "what did you use" phase.
// Each row carries:
//   recipeIng    — the original entry from recipe.ingredients[]
//   canonical    — the INGREDIENTS registry def (null for untracked free-text)
//   matches      — pantry rows for this ingredient (kind='ingredient' only)
//   selectedRowId— which pantry row the user is drawing from (first match by
//                  default; the multi-match picker will swap it in a follow-up)
//   usedAmount / usedUnit — initial estimate from recipe.qty, editable in the
//                  phase. Untracked rows have both null and a ✕-only card.
//   skipped      — user tapped ✕. Final removal plan ignores skipped rows.
// Pure function — no React, easy to unit test once we add a test harness.
export function buildInitialUsedItems(recipe, pantry, session) {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const list = Array.isArray(pantry) ? pantry : [];
  // Run the SAME pairer CookMode uses so closest-match substitutes
  // (recipe wants Mozzarella, user has Parmesan, Tier 3 category
  // match picks Parmesan) carry through to the deduction screen.
  // Previously this function filtered with resolvesToSameCanonical
  // alone — exact canonical — so a substitute like Parmesan-for-
  // Mozzarella was invisible here and the row rendered "NOT IN
  // PANTRY" even after CookMode paired it live.
  const pairings = pairRecipeIngredients(ingredients, list);
  return ingredients.map((ing, idx) => {
    const canonical = ing.ingredientId ? findIngredient(ing.ingredientId) : null;
    // Match universe for this ingredient row — the cascade that
    // deduction and the swap picker choose from. Three tiers:
    //   1. Explicit canonical family (exact match after alias
    //      redirect, no hub widening — heavy_cream and milk stay
    //      distinct).
    //   2. Pairer's paired row (same canonical / hub) and
    //      closestMatch row (substitute band) — surfaces rows that
    //      pairRecipeIngredients already decided were valid.
    //   3. Deduped, sorted FIFO by expires_at so the oldest-
    //      expiring instance is the default (consume before spoil).
    const familyMatches = ing.ingredientId
      ? list.filter(p =>
          resolvesToSameCanonical(p.ingredientId, ing.ingredientId) &&
          (p.kind || "ingredient") === "ingredient" &&
          Number(p.amount) > 0
        )
      : [];
    const pairing = pairings[idx] || null;
    const suggested = [pairing?.paired, pairing?.closestMatch].filter(Boolean);
    // Composition-match candidates: compound rows (kind !== "ingredient")
    // whose ingredientIds[] genuinely contains the target canonical
    // AND whose category is in the same family as the target. User's
    // insight: "wouldn't it look Dairy → Cheese → what contains
    // mozzarella, not Freezer → Frozen Meals → pizza?" Exactly —
    // same-category gate uses the pantry-taxonomy lineage as a
    // scoop-ability proxy:
    //
    //   mozzarella (dairy) + italian_cheese_dip (dairy)    → match ✓
    //   mozzarella (dairy) + frozen_pizza (frozen/entree)  → reject ✗
    //
    // No per-canonical scoopable flag needed; the category hierarchy
    // already tells us whether the compound lives in the "I can
    // scoop this" aisle or the "I'm eating this as a meal" aisle.
    const compositionMatches = ing.ingredientId
      ? (list || []).filter(p => {
          if (!p || Number(p.amount) <= 0) return false;
          if ((p.kind || "ingredient") === "ingredient") return false;
          const ids = Array.isArray(p.ingredientIds) ? p.ingredientIds : [];
          if (!ids.some(id => resolvesToSameCanonical(id, ing.ingredientId))) return false;
          // Category-lineage gate — scoop from the cheese aisle, not
          // the frozen-meals aisle. When the target canonical has no
          // category (rare — synthetic / unenriched), allow through;
          // when the pantry row has no category, fall back to item
          // category (set at add-time from tile).
          const ingCanonCat = canonical?.category || null;
          const pCanon = p.ingredientId ? findIngredient(p.ingredientId) : null;
          const pCat = pCanon?.category || p.category || null;
          if (ingCanonCat && pCat && ingCanonCat !== pCat) return false;
          return true;
        })
      : [];
    const seen = new Set();
    const matches = [...familyMatches, ...suggested, ...compositionMatches]
      .filter(m => {
        if (!m || !m.id || seen.has(m.id)) return false;
        seen.add(m.id);
        return Number(m.amount) > 0;
      })
      .sort((a, b) => {
        const ea = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
        const eb = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
        if (ea !== eb) return ea - eb;
        const pa = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
        const pb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
        return pa - pb;
      });
    // Priority order for the default selection:
    //   1. Session override — user's explicit choice from cook-prep
    //      or AIRecipe tweak, authoritative.
    //   2. pairing.paired — Tier 1 primary canonical match (kind=ingredient).
    //   3. Composition match — compound row whose ingredientIds[]
    //      contains the target. Prefers "cheese dip that has mozz"
    //      over "queso dip as a generic cheese substitute." Only
    //      fires when no primary-canonical row exists.
    //   4. pairing.closestMatch — Tier 3 substitute (hub / category).
    //   5. FIFO first from the family universe.
    const overrideRowId = session?.overrides?.[idx]?.pantryItemId || null;
    const overrideRow = overrideRowId
      ? list.find(p => p.id === overrideRowId) || null
      : null;
    const defaultMatch = overrideRow
      || pairing?.paired
      || compositionMatches[0]
      || pairing?.closestMatch
      || matches[0]
      || null;
    // Resolve the recipe's called-for quantity so the slider + amount
    // field prefill instead of loading at 0 (seen in the wild: "What
    // did you use?" screen with every slider pinned to 0 because
    // AI-drafted recipes only carry the display string "2 tbsp" and
    // not the structured qty {amount, unit}). Three-tier resolve:
    //   1. ing.qty — explicit structured qty (bundled recipes, older
    //      drafts that kept it)
    //   2. parseAmountString(ing.amount, canonical) — parse "2 tbsp"
    //      or "¼ cup" or "8" off the display string using the unit
    //      ladder of the matched canonical
    //   3. null — untracked / free-text, slider stays manual
    const recipeQty = ing.qty || (canonical ? parseAmountString(ing.amount, canonical) : null);

    // Display unit policy: RECIPE UNIT WINS.
    //
    // Recipe called for "¾ cup" → show everything in cups. Pantry
    // row happens to be stored in quarts → convert quarts to cups
    // for display, don't force the user to read the pantry's unit.
    // Previous behavior (pantry unit wins) was the bug the user
    // flagged: recipe in cups but meter showing quarts + pints,
    // too many units on screen.
    //
    // Only fall back to the pantry row's unit when (a) the recipe
    // had no parseable qty, or (b) the recipe's unit isn't in the
    // canonical's ladder (e.g. garlic recipe says "2 tbsp" but
    // garlic's ladder is [clove, head] — can't display "tbsp").
    // That fallback path is handled by the coherence guard below.
    let displayAmount = recipeQty?.amount ?? null;
    let displayUnit   = recipeQty?.unit   ?? (defaultMatch?.unit ?? null);

    // Coherence guard: usedUnit MUST be in the canonical's ladder,
    // otherwise the dropdown shows the first option (browser fallback
    // when <select value> isn't a valid option) while state stays on
    // an invalid unit — labels render in the stale unit, conversions
    // fail silently. Seen when a garlic pantry row was stored in oz
    // (outside garlic's [clove, head] ladder) and a recipe asked for
    // "2 tbsp" that didn't parse. If the current displayUnit isn't
    // valid, fall back to the canonical's defaultUnit and re-convert
    // the displayed amount into that unit so the number agrees with
    // what the label will read.
    const ladderHas = (u) => !!canonical?.units?.some(x => x.id === u);
    if (canonical && displayUnit && !ladderHas(displayUnit)) {
      const targetUnit = canonical.defaultUnit && ladderHas(canonical.defaultUnit)
        ? canonical.defaultUnit
        : (canonical.units?.[0]?.id || null);
      if (targetUnit) {
        // Try to carry the number across, if we can find any valid
        // source qty to convert from.
        const sourceQty = recipeQty && ladderHas(recipeQty.unit)
          ? recipeQty
          : (displayAmount != null && ladderHas(displayUnit)
              ? { amount: displayAmount, unit: displayUnit }
              : null);
        if (sourceQty) {
          const res = convertWithBridge(sourceQty, targetUnit, canonical, defaultMatch);
          displayAmount = res.ok ? Number(res.value.toFixed(3)) : null;
        } else {
          // No convertible source (e.g. "2 tbsp" for garlic with only
          // clove/head ladder). Clear the number — user types in the
          // picker — but ensure the unit is valid so the dropdown and
          // labels agree.
          displayAmount = null;
        }
        displayUnit = targetUnit;
      }
    }

    return {
      idx,
      recipeIng: ing,
      canonical,
      matches,
      skipped: false,
      selectedRowId: defaultMatch?.id || null,
      usedAmount: displayAmount,
      usedUnit:   displayUnit,
    };
  });
}

// Flatten usedItems + extraRemovals into a single list of decrement
// instructions the confirm-removal screen can render and the final save()
// can apply. Each entry resolves to a specific pantry row + how much to
// subtract in that row's own unit, so the caller never needs to reason
// about conversion again.
//
// Returns:
//   [{ pantryRowId, pantryRow, ingredient, used: {amount, unit},
//      newAmount,   — row.amount after decrement (null if un-convertible)
//      convertible, — false when used.unit isn't in the ingredient's ladder
//      source: "recipe" | "added" }]
export function buildRemovalPlan(usedItems, extraRemovals, pantry) {
  const lookup = (id) => (pantry || []).find(p => p.id === id) || null;
  // Siblings of `seed` = rows sharing identity (canonical + state +
  // composition + name) with a positive amount, sorted FIFO so the
  // cascade consumes oldest-expires first. Excludes the seed itself —
  // the caller handles it as the head of the cascade.
  const siblingsForCascade = (seed) => {
    if (!seed) return [];
    const key = identityKey(seed);
    return (pantry || [])
      .filter(p => p.id !== seed.id && Number(p.amount) > 0 && identityKey(p) === key)
      .sort((a, b) => {
        const ea = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
        const eb = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
        if (ea !== eb) return ea - eb;
        const pa = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
        const pb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
        return pa - pb;
      });
  };
  const out = [];
  for (const row of usedItems) {
    if (row.skipped || !row.selectedRowId) continue;
    if (row.usedAmount == null || !Number.isFinite(Number(row.usedAmount))) continue;
    if (!row.usedUnit) continue;
    const pantryRow = lookup(row.selectedRowId);
    if (!pantryRow) continue;
    const used = { amount: Number(row.usedAmount), unit: row.usedUnit };
    // Display prefers the matched pantry row's label so the user sees
    // "Tostitos Queso" on the confirm-removal screen, not the recipe's
    // "Fresh Mozzarella" — they're actually decrementing the queso.
    // Same priority chain as the cook-prep screen uses.
    const pantryCanon = pantryRow.ingredientId ? findIngredient(pantryRow.ingredientId) : null;
    const recipeAsk = row.canonical?.name || row.recipeIng.item || null;
    const isSubstitute = !!pantryRow.ingredientId
      && !!row.canonical?.id
      && !resolvesToSameCanonical(pantryRow.ingredientId, row.canonical.id);
    const displayName = pantryRow.name
      || pantryCanon?.name
      || row.canonical?.name
      || row.recipeIng.item
      || "Ingredient";
    const displayEmoji = pantryRow.emoji
      || pantryCanon?.emoji
      || row.canonical?.emoji
      || row.recipeIng.emoji
      || "🥣";
    // Cascade: consume the selected row first, then fall through to
    // sibling instances FIFO when demand exceeds the seed's stock.
    // Preserves the user's explicit "use this row" pick — we just
    // cascade AFTER they've drained it.
    const cascade = row.canonical
      ? planInstanceDecrement([pantryRow, ...siblingsForCascade(pantryRow)], used, row.canonical)
      : null;
    if (!cascade || cascade.entries.length === 0) {
      // Un-convertible (unit not in ladder) or no canonical — keep
      // the legacy single-entry, non-convertible signal so the
      // confirm screen still renders its red warning chip.
      out.push({
        pantryRowId: pantryRow.id,
        pantryRow,
        ingredient: row.canonical,
        used,
        newAmount: null,
        convertible: false,
        source: "recipe",
        displayName,
        displayEmoji,
        subFor: isSubstitute ? recipeAsk : null,
      });
      continue;
    }
    for (const entry of cascade.entries) {
      out.push({
        pantryRowId: entry.row.id,
        pantryRow: entry.row,
        ingredient: row.canonical,
        used: { amount: entry.consumedAmount, unit: entry.unit },
        newAmount: entry.newAmount,
        convertible: true,
        source: "recipe",
        displayName,
        displayEmoji,
        subFor: isSubstitute ? recipeAsk : null,
      });
    }
  }
  for (const extra of extraRemovals) {
    if (extra.amount == null || !Number.isFinite(Number(extra.amount))) continue;
    const pantryRow = lookup(extra.pantryRowId);
    if (!pantryRow) continue;
    const canonical = extra.ingredientId ? findIngredient(extra.ingredientId) : null;
    const used = { amount: Number(extra.amount), unit: extra.unit };
    // Meal rows (kind='meal') have no ingredientId / canonical, but also no
    // unit ambiguity — everything is "serving" on both sides — so we can
    // subtract directly without going through the converter.
    let newAmount;
    if (canonical) {
      newAmount = decrementRow(pantryRow, used, canonical);
    } else if (extra.unit === pantryRow.unit) {
      newAmount = Math.max(0, Number(pantryRow.amount) - used.amount);
    } else {
      newAmount = null;
    }
    out.push({
      pantryRowId: pantryRow.id,
      pantryRow,
      ingredient: canonical,
      used,
      newAmount,
      convertible: newAmount != null,
      source: "added",
      displayName: extra.name,
      displayEmoji: extra.emoji,
    });
  }
  return out;
}

export default function CookComplete({ recipe, userId, family = [], friends = [], pantry = [], setPantry, ingredientInfo, brandNutrition, onFinish, cookSession = null, onForkRecipe = null }) {
  const [phase, setPhase] = useState("celebrate");
  const [selectedDiners, setSelectedDiners] = useState(() => new Set());
  const [rating, setRating] = useState(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Award_xp breakdown captured during save() — drives the
  // beat-sequenced summary in CookCompleteSummary (P5-5).
  const [xpBreakdown, setXpBreakdown] = useState(null);
  // The cook_log id we just inserted — handed to the summary
  // overlay so it can fetch every related xp_events row.
  const [summaryCookLogId, setSummaryCookLogId] = useState(null);
  // How many recipe-servings each eater consumed. Default 1 covers the
  // common case (four people eat a four-serving recipe, one slice
  // each). Stepper surfaces on the rating screen so the chef can bump
  // to 2 for "we went back for seconds", 0.5 for "family of four
  // split a two-serving soup", or 3 for "solo chef demolished three
  // of four servings". Stamped on cook_logs.servings_per_eater; the
  // tally multiplies perServing macros by this.
  const [servingsPerEater, setServingsPerEater] = useState(1);
  // usedItems captures the user's "what did I actually use" decisions across
  // the ingredients-used → confirm-removal → save sequence. Seeded once from
  // the initial pantry snapshot; realtime pantry changes during the flow are
  // intentionally ignored so the user's edits don't flip out from under them.
  const [usedItems, setUsedItems] = useState(() => buildInitialUsedItems(recipe, pantry, cookSession?.session));
  // pickerForIdx is the row whose multi-match picker is currently open (null
  // for closed). Sheet overlays the phase and lets the user choose which
  // pantry row to draw from when more than one matches the ingredient id.
  const [pickerForIdx, setPickerForIdx] = useState(null);
  // extraRemovals captures "I subbed X for Y" cases: the user ✕'d the recipe
  // ingredient and wants to decrement a different pantry row instead (e.g.
  // "I used yesterday's leftover chicken" — a kind='meal' row — for the raw
  // chicken this recipe called for). Lives alongside usedItems in the final
  // removal plan. Each entry is an opaque decrement against a specific row.
  const [extraRemovals, setExtraRemovals] = useState([]);
  const [addLeftoverOpen, setAddLeftoverOpen] = useState(false);
  // Leftovers state. leftoverChoice is the yes/no from the first leftover
  // screen; leftoverLocation selects fridge/freezer/pantry (or garbage, which
  // means "I'm tossing the extra" and bypasses the pantry write). Mode +
  // fraction/servings are two alternative ways to express the amount saved —
  // users who don't weigh portions stay on "fraction" (⅛ ¼ ⅓ ½ ⅔ ¾ full),
  // users who track nutrition flip to "servings" and key in a number.
  const [leftoverChoice,   setLeftoverChoice]   = useState(null);
  const [leftoverLocation, setLeftoverLocation] = useState(null);
  const [leftoverMode,     setLeftoverMode]     = useState("fraction");
  const [leftoverFraction, setLeftoverFraction] = useState(0.5);
  const [leftoverServings, setLeftoverServings] = useState(() => {
    const diners = 1;
    return Math.max(1, Number(recipe?.serves || 2) - diners);
  });
  // Optional user-override for the leftover Meal's name. Empty string =
  // use the auto-generated "Leftover ${recipe.title}". This is what
  // turns "Leftover Lasagna" into "Mom's Lasagna" or "Sunday Sauce" —
  // the auto name is fine, the override is the brag-with-humility
  // affordance the user asked for. Only used in the regular-meal
  // leftover branch; compound-produce (sriracha, pesto) keeps the
  // canonical name since it merges into the existing pantry row.
  const [leftoverCustomName, setLeftoverCustomName] = useState("");

  // Compound recipes (sriracha, pesto, stock) produce an ingredient row the
  // user fully intended to save — skipping the yes/no feels right, but we
  // still ask so "I made sriracha but knocked it over" stays expressible.
  // Copy varies so the yes/no screen doesn't read weird for compounds.
  const isCompoundProduce = recipe?.produces?.kind === "ingredient";

  // Fork-to-new-recipe state. The user made one or more cook-time swaps
  // and can choose to promote them into a new user_recipes row —
  // "iterations or versions that progress" per the feature spec.
  // Original recipe is left untouched (saveRecipe generates a unique
  // slug when the current one is taken, so forking beef-wellington
  // lands as beef-wellington-2, etc.). forkState drives the save
  // button: idle → pending → saved | error.
  const swapCount = countActiveSwaps(cookSession?.session);
  const canOfferFork = !!onForkRecipe && swapCount > 0;
  const [forkState, setForkState] = useState("idle");
  const [forkName,  setForkName]  = useState(() => {
    const base = String(recipe?.title || "Recipe").trim();
    return `${base} v2`;
  });
  const [forkOpen,  setForkOpen]  = useState(false);
  const [forkError, setForkError] = useState(null);
  const handleForkSave = async () => {
    if (!onForkRecipe) return;
    setForkState("pending");
    setForkError(null);
    try {
      // Materialize the ephemeral session into a concrete recipe
      // object. This is the only place in the codebase that persists
      // the derivation — everywhere else re-derives per render per
      // the "pure derivation, never stored" principle in
      // src/lib/effectiveRecipe.js. canonicalizeEffectiveRecipe strips
      // the UI-only markers (_swappedFrom, _skipped, _extra) so the
      // fork reads as clean canon on its next cook — no ghost
      // strikethroughs or "Using X instead of Y" banners against
      // ingredients that are already the new default.
      const promoted = applyCookSessionToRecipe(recipe, cookSession?.session, pantry);
      const canonical = canonicalizeEffectiveRecipe(promoted);
      const forked = {
        ...canonical,
        title: forkName.trim() || `${recipe.title || "Recipe"} v2`,
        // Mint a fresh slug base from the new title; saveRecipe
        // will uniqueify it per-user. Dropping the old slug
        // prevents accidental collisions when the parent slug is
        // long and already has a -2 suffix.
        slug:  undefined,
        // Provenance so a future library-edit surface can trace
        // "this recipe is a fork of X" without a schema migration.
        forkedFrom: {
          slug:   recipe?.slug || null,
          title:  recipe?.title || null,
          source: recipe?.source || null,
        },
      };
      // source='custom' — the user authored this iteration, even if
      // the parent was an AI draft. Matches the CreateMenu pattern
      // and avoids awarding AI-authored XP on a user-curated fork.
      await onForkRecipe(forked, "custom");
      setForkState("saved");
      setTimeout(() => setForkOpen(false), 1200);
    } catch (e) {
      console.error("[CookComplete] fork save failed:", e);
      setForkError(e?.message || "Couldn't save");
      setForkState("idle");
    }
  };

  // Step numbering helper. The flow is a variable-length sequence depending
  // on whether the recipe has ingredients (adds the pantry pair) and whether
  // the user has family/friends (adds diners). Pass the phase id to get a
  // { num, denom } back and stick them in the STEP label.
  //
  // Leftovers screens count as a single step in the ratio (they're a logical
  // pair) to keep the progress bar from feeling like it's stalling. The
  // location screen just slides in after the yes/no without bumping the
  // numerator.
  const stepOf = (id) => {
    const seq = [];
    if (usedItems.length > 0) seq.push("ingredientsUsed", "confirmRemoval");
    seq.push("leftovers");
    if (connections.length > 0) seq.push("diners");
    seq.push("rating", "notes");
    const normalized = id === "leftoverLocation" ? "leftovers" : id;
    const i = seq.indexOf(normalized);
    return { num: i + 1, denom: seq.length };
  };

  const xp = useMemo(() => totalXpForRecipe(recipe), [recipe]);
  // Merge family + friends, dedupe by otherId (someone could be tagged as
  // both in weird invite flows), preserve family-first ordering.
  const connections = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const row of [...family, ...friends]) {
      if (!row?.otherId || seen.has(row.otherId)) continue;
      seen.add(row.otherId);
      const name = row.other?.name || "Friend";
      out.push({
        id: row.otherId,
        name,
        first: name.split(/\s+/)[0],
        kind: row.kind,                        // "family" | "friend"
        initial: (name[0] || "?").toUpperCase(),
        avatarUrl: row.other?.avatar_url || null,
      });
    }
    return out;
  }, [family, friends]);

  const toggleDiner = (id) => setSelectedDiners(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const save = async () => {
    setSaving(true);
    setError(null);

    // 1) Insert the cook_log first so we have its id for source_cook_log_id
    //    back-references on any pantry rows we're about to create. Errors
    //    here abort everything — we never want to mutate the pantry against
    //    a cook that didn't log.
    // Nutrition snapshot for the NutritionDashboard tally (migration
    // 0068). recipeNutrition walks the full resolver chain (pantry
    // override → brand_nutrition → ingredient_info → bundled
    // canonical) so the stamped macros reflect whatever was actually
    // scanned + seeded. Null when coverage is zero — the tally reader
    // skips nulls and surfaces "based on X of Y meals" honestly
    // instead of silently treating a zero blob as "this cook had zero
    // calories". perServing only (not total): the row already stores
    // one-serving macros and servings_per_eater scales from there.
    const n = (recipe && recipeNutrition)
      ? recipeNutrition(recipe, { pantry, brandNutrition, getInfo: ingredientInfo?.getInfo })
      : null;
    const nutritionBlob = (n && n.coverage.resolved > 0)
      ? { ...n.perServing, coverage: n.coverage }
      : null;
    const payload = {
      user_id: userId,
      recipe_slug:    recipe.slug,
      recipe_title:   recipe.title,
      recipe_emoji:   recipe.emoji || "🍽️",
      recipe_cuisine: recipe.cuisine || null,
      recipe_category: recipe.category || null,
      rating,
      notes: notes.trim() || null,
      xp_earned: xp,
      diners: [...selectedDiners],
      is_favorite: rating === "good" || rating === "nailed",
      nutrition:           nutritionBlob,
      // Zero is a valid value ("saved it all"), so we guard with
      // Number.isFinite rather than the || 1 fallback which would
      // collapse a deliberate 0 into 1.
      servings_per_eater:  Number.isFinite(Number(servingsPerEater)) ? Number(servingsPerEater) : 1,
    };
    const { data: logRow, error: logErr } = await supabase
      .from("cook_logs")
      .insert(payload)
      .select("id")
      .single();
    if (logErr) {
      console.error("[cook_logs] insert failed:", logErr);
      setError(logErr.message || "Couldn't save. Try again?");
      setSaving(false);
      return;
    }
    const cookLogId = logRow?.id || null;

    // 1b) Fire the XP ledger via award_xp() and AWAIT the breakdown.
    //     Phase-5 evolution from P1's fire-and-forget: the breakdown
    //     payload (base / curated / caps / streak / total) drives the
    //     beat-sequenced reveal in CookCompleteSummary. Failures are
    //     still soft — if the RPC errors we just don't show a summary
    //     and the legacy +XP pulse handles celebration.
    if (cookLogId) {
      const { data: breakdown, error: xpErr } = await supabase.rpc("award_xp", {
        p_user_id:   userId,
        p_source:    "cook_complete",
        p_ref_table: "cook_logs",
        p_ref_id:    cookLogId,
      });
      if (xpErr) {
        console.error("[award_xp] cook_complete failed:", xpErr);
      } else {
        setXpBreakdown(breakdown || null);
      }
    }

    // 2) Apply pantry mutations in a single setPantry call. useSyncedList
    //    diffs prev vs next and fires INSERT / UPDATE / DELETE behind the
    //    scenes, so we just return the post-cook array.
    //
    // Leftover-Meal component writes happen AFTER setPantry returns —
    // captured here so the post-state-update code knows what to write.
    // leftoverMealToCompose is populated only for the kind='meal'
    // leftover branch; compound-produce (kind='ingredient') leftovers
    // stay atomic and don't need component rows.
    let leftoverMealToCompose = null;
    if (setPantry) {
      const plan = buildRemovalPlan(usedItems, extraRemovals, pantry);
      setPantry(prev => {
        const byId = new Map(prev.map(r => [r.id, r]));

        // 2a) Decrements from the removal plan. Non-convertible entries are
        //     left untouched — the confirm-removal screen flagged them red
        //     and we don't want to risk a bad write based on a unit we
        //     couldn't resolve.
        for (const entry of plan) {
          if (!entry.convertible) continue;
          const row = byId.get(entry.pantryRowId);
          if (!row) continue;
          // Protected keepsake rows (migration 0044) never get deleted
          // or decremented by a cook. The DB delete policy would block
          // the DELETE anyway, but clamping client-side keeps the
          // optimistic state honest — no flicker, no ghost row, no
          // accidental "I cooked with Bella's gummy bear" math.
          if (row.protected) continue;
          if (entry.newAmount <= 0) {
            // Package-mode rows (migration 0054) hold a two-tier
            // quantity: the open unit in `amount`, plus `reserveCount`
            // sealed units in the cupboard. When the open unit hits
            // zero we don't delete the row — we pop the next sealed
            // unit into the open slot. Only delete when we're truly
            // out of EVERYTHING (no reserves either).
            if (row.packageAmount != null && row.reserveCount > 0) {
              byId.set(row.id, {
                ...row,
                reserveCount: row.reserveCount - 1,
                amount: Number(row.packageAmount),
              });
            } else {
              byId.delete(row.id);
            }
          } else {
            byId.set(row.id, { ...row, amount: entry.newAmount });
          }
        }

        // 2b) Leftover row creation. Compound-produce recipes create or
        //     merge a kind='ingredient' row under the recipe's produced
        //     ingredient id (sriracha bottle ↔ homemade sriracha live as
        //     the same id). Regular meals create a fresh kind='meal' row
        //     keyed by source_cook_log_id.
        const wantsLeftover = leftoverChoice === "yes"
          && leftoverLocation
          && leftoverLocation !== "garbage";
        if (wantsLeftover) {
          const now = new Date();
          const produces = recipe?.produces;
          const fraction = leftoverMode === "fraction"
            ? leftoverFraction
            : Math.min(1, Math.max(0, leftoverServings / (Number(recipe?.serves) || 1)));

          if (produces?.kind === "ingredient" && produces.ingredientId) {
            const canonical = findIngredient(produces.ingredientId);
            const yieldAmount = Number(produces.yield?.amount) || 1;
            const yieldUnit   = produces.yield?.unit || canonical?.defaultUnit || "g";
            const savedAmount = yieldAmount * fraction;
            const shelfDays = leftoverLocation === "freezer"
              ? (produces.freezerShelfLifeDays ?? produces.shelfLifeDays ?? 90)
              : (produces.shelfLifeDays ?? 90);
            const expiresAt = new Date(now.getTime() + shelfDays * 86400000);

            // Merge with an existing same-id same-location row so the
            // compound-ingredient insight holds: bought bottle + homemade
            // batch in the same fridge land as one row, earliest-expiry
            // wins per the 0025 merge rule.
            const existing = [...byId.values()].find(r =>
              r.ingredientId === produces.ingredientId &&
              (r.location || "pantry") === leftoverLocation &&
              (r.kind || "ingredient") === "ingredient"
            );
            if (existing) {
              byId.set(existing.id, {
                ...existing,
                amount: Number(existing.amount) + savedAmount,
                expiresAt: existing.expiresAt && existing.expiresAt < expiresAt
                  ? existing.expiresAt
                  : expiresAt,
                purchasedAt: now,
                sourceRecipeSlug: recipe.slug,
                sourceCookLogId: cookLogId,
              });
            } else {
              const newId = typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `pantry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              byId.set(newId, {
                id: newId,
                ingredientId: produces.ingredientId,
                name: canonical?.name || produces.ingredientId,
                emoji: canonical?.emoji || recipe.emoji || "🥣",
                amount: savedAmount,
                unit: yieldUnit,
                max: Math.max(yieldAmount, savedAmount),
                category: canonical?.category || "pantry",
                lowThreshold: 0.25,
                priceCents: null,
                location: leftoverLocation,
                expiresAt,
                purchasedAt: now,
                kind: "ingredient",
                servingsRemaining: null,
                sourceRecipeSlug: recipe.slug,
                sourceCookLogId: cookLogId,
                ownerId: userId,
              });
            }
          } else {
            // Regular meal: kind='meal' row keyed by cook_log_id so the
            // same cook can't accidentally merge into a prior night's
            // carbonara. Shelf-life defaults: fridge 3d, freezer 60d,
            // pantry no default (shelf-stable dishes are rare enough that
            // the user can set it manually later).
            const servesCount = Number(recipe?.serves) || 1;
            const savedServings = leftoverMode === "fraction"
              ? servesCount * fraction
              : Math.max(0, leftoverServings);
            const shelfDays = leftoverLocation === "freezer" ? 60
              : leftoverLocation === "fridge" ? 3
              : 0;
            const expiresAt = shelfDays > 0
              ? new Date(now.getTime() + shelfDays * 86400000)
              : null;
            const newId = typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `meal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            // Compose the leftover Meal's tree from the removal plan.
            // Each consumed row contributes one component:
            //   * consumed meal  -> sub-meal pointer (recursive tree)
            //   * consumed ingredient -> canonical ref
            //   * consumed free-text -> skipped (tree-unrepresentable)
            // Flat ingredient_ids[] = union of all consumed rows'
            // flattened ids, so the GIN-indexed recipe matcher picks
            // up the leftover for any recipe calling for any of its
            // component canonicals. Sub-meal components contribute
            // their own flattened ids, giving transitive coverage for
            // free (a leftover lasagna made from leftover marinara
            // inherits tomato / onion / garlic / basil even though
            // those live two levels down).
            const { components, flatIngredientIds } = leftoverCompositionFromPlan(plan);
            leftoverMealToCompose = { id: newId, components };

            byId.set(newId, {
              id: newId,
              ingredientId: null,
              // Flattened tag set for fast recipe matching. Authoritative
              // structure is in pantry_item_components (written below,
              // after this setPantry returns).
              ingredientIds: flatIngredientIds,
              // User-override wins; empty string falls back to the
              // auto-generated "Leftover X" so the existing default is
              // preserved when the user just taps through.
              name: leftoverCustomName.trim() || `Leftover ${recipe.title}`,
              emoji: recipe.emoji || "🍽️",
              amount: savedServings,
              unit: "serving",
              max: servesCount,
              category: recipe.category || "pantry",
              lowThreshold: 0.25,
              priceCents: null,
              location: leftoverLocation,
              expiresAt,
              purchasedAt: now,
              kind: "meal",
              servingsRemaining: savedServings,
              sourceRecipeSlug: recipe.slug,
              sourceCookLogId: cookLogId,
              // Auto-populate the reheat walkthrough at cook-complete
              // time. When the recipe carries a reheat block (authored
              // by generate-recipe + refined by the
              // suggest-cook-instructions chain), synthesize a
              // recipe-shape cookInstructions and stamp it directly on
              // the leftover. This replaces the old runtime-lookup
              // fallback (findBySlug + synth at ItemCard render) with
              // a concrete stored block — self-contained, no lookup
              // dance, and every row reads the same walkthrough even
              // if the source recipe is deleted or un-saved later.
              cookInstructions: reheatToCookInstructions(recipe),
              ownerId: userId,
            });
          }
        }

        return [...byId.values()];
      });
    }

    // 3) Write the leftover Meal's component tree. Done *after*
    //    setPantry so the parent pantry_items row is (usually) already
    //    on its way to the server; setComponentsForParent retries on
    //    FK-violation (23503) to cover the race where the parent
    //    INSERT hasn't landed yet. Non-fatal on failure — the leftover
    //    is still usable via its flat ingredient_ids[] array, the
    //    COMPONENTS deep-dive just wouldn't render a tree yet. Logged
    //    so a regression is visible in the console.
    if (leftoverMealToCompose && leftoverMealToCompose.components.length > 0) {
      const { error: compErr } = await setComponentsForParent(
        leftoverMealToCompose.id,
        leftoverMealToCompose.components
      );
      if (compErr) {
        console.error("[CookComplete] leftover composition write failed:", compErr);
      }
    }

    setSaving(false);

    // Phase-5: gate onFinish on the summary overlay. If the
    // award_xp call landed (we have a cookLogId and no fatal
    // error), surface the beat-sequenced reveal first; the
    // summary's onClose calls onFinish. Otherwise (RPC failed,
    // no cookLogId) finish immediately so the legacy flow still
    // works end-to-end.
    if (cookLogId) {
      setSummaryCookLogId(cookLogId);
    } else {
      onFinish?.({ saved: true, rating });
    }
  };

  // ── shared modal shell ───────────────────────────────────────────────────
  const shell = (children) => (
    <div style={{ position:"fixed", inset:0, background:"#080808", zIndex:220, maxWidth:480, margin:"0 auto", display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>
      {children}
      <style>{`
        @keyframes fall { 0%{transform:translateY(-120px) rotate(0deg); opacity:0} 10%{opacity:1} 100%{transform:translateY(110vh) rotate(520deg); opacity:0.9} }
        @keyframes pulse-xp { 0%,100%{transform:scale(1); text-shadow:0 0 30px #f5c84266} 50%{transform:scale(1.08); text-shadow:0 0 50px #f5c842aa} }
        @keyframes rise { from{opacity:0; transform:translateY(16px)} to{opacity:1; transform:translateY(0)} }
      `}</style>
    </div>
  );

  // Summary overlay short-circuits the phase tree once save() has
  // landed. The summary's onClose calls onFinish so the parent's
  // navigation only fires after the beat sequence wraps.
  if (summaryCookLogId) {
    return (
      <CookCompleteSummary
        cookLogId={summaryCookLogId}
        onClose={() => {
          setSummaryCookLogId(null);
          onFinish?.({ saved: true, rating });
        }}
      />
    );
  }

  // ── phase 1: celebrate ───────────────────────────────────────────────────
  if (phase === "celebrate") {
    // 28 confetti pieces, scattered deterministically so they don't re-roll
    // on every re-render (avoids the "flicker" when typing/tapping).
    const confetti = Array.from({ length: 28 }, (_, i) => ({
      left: `${(i * 37) % 100}%`,
      delay: `${(i % 14) * 0.12}s`,
      color: ["#f5c842","#4ade80","#7eb8d4","#f59e0b","#e07a3a","#d4a8c7"][i % 6],
      size: 6 + (i % 4) * 2,
      rot: (i * 47) % 360,
    }));
    return shell(
      <>
        <div style={{ position:"absolute", inset:0, pointerEvents:"none", overflow:"hidden" }}>
          {confetti.map((c, i) => (
            <span key={i} style={{
              position:"absolute", top:-20, left:c.left,
              width:c.size, height:c.size*1.6, background:c.color,
              transform:`rotate(${c.rot}deg)`,
              animation:`fall 2.6s ${c.delay} ease-in forwards`,
              borderRadius:1,
            }} />
          ))}
        </div>
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:40, textAlign:"center", position:"relative", zIndex:1 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4ade80", letterSpacing:"0.18em", marginBottom:14, animation:"rise 0.4s ease" }}>
            ✓ MEAL COMPLETE
          </div>
          <div style={{ fontSize:80, marginBottom:12, animation:"rise 0.5s 0.1s ease backwards" }}>{recipe.emoji || "🍽️"}</div>
          <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:34, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6, animation:"rise 0.5s 0.2s ease backwards" }}>
            You cooked {recipe.title}!
          </h1>
          <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#888", marginBottom:28, animation:"rise 0.5s 0.3s ease backwards" }}>
            That's a whole meal out of your kitchen. Take a breath.
          </p>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:44, color:"#f5c842", fontWeight:600, animation:"pulse-xp 1.6s ease-in-out infinite" }}>
            +{xp} XP
          </div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.15em", marginTop:4, marginBottom:36 }}>
            SKILL POINTS EARNED
          </div>
          <button
            onClick={() => setPhase(usedItems.length > 0 ? "ingredientsUsed" : (connections.length > 0 ? "diners" : "rating"))}
            style={{ width:"100%", maxWidth:320, padding:"16px", background:"#f5c842", color:"#111", border:"none", borderRadius:14, fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer", boxShadow:"0 0 30px #f5c84244" }}
          >
            CONTINUE →
          </button>
          {/* Fork-to-new-recipe affordance. Only surfaces when the user
              actually made swaps or skips during this cook — otherwise
              there's nothing to promote and offering the button would
              clutter the celebration screen. Clicking opens a small
              name prompt (defaulted "<title> v2"); saving writes a new
              user_recipes row via onForkRecipe (wired by Plan /
              CreateMenu to useUserRecipes.saveRecipe). The original
              recipe is never touched — "recipe remains the golden
              standard" principle from the feature spec. */}
          {canOfferFork && (
            <button
              onClick={() => { setForkOpen(true); setForkError(null); }}
              style={{ marginTop:12, width:"100%", maxWidth:320, padding:"13px", background:"transparent", color:"#f5c842", border:"1px solid #3a2f10", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer" }}
            >
              ↔ SAVE CHANGES AS NEW RECIPE
            </button>
          )}
        </div>
        {forkOpen && (
          <div
            onClick={() => { if (forkState !== "pending") setForkOpen(false); }}
            style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, zIndex:10 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ width:"100%", maxWidth:380, background:"#161616", border:"1px solid #2a2a2a", borderRadius:16, padding:"22px 20px" }}
            >
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:6 }}>
                FORK RECIPE
              </div>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:300, color:"#f0ece4", marginBottom:6 }}>
                Save {swapCount} swap{swapCount === 1 ? "" : "s"} as a new recipe
              </div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#888", marginBottom:16, lineHeight:1.5 }}>
                The original "{recipe?.title}" stays as-is. This saves an iteration with your swaps baked in.
              </div>
              <label style={{ display:"block", fontFamily:"'DM Mono',monospace", fontSize:10, color:"#888", letterSpacing:"0.1em", marginBottom:6 }}>
                NAME
              </label>
              <input
                type="text"
                value={forkName}
                onChange={(e) => setForkName(e.target.value)}
                disabled={forkState === "pending" || forkState === "saved"}
                style={{ width:"100%", padding:"12px 14px", background:"#0f0f0f", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", boxSizing:"border-box" }}
              />
              {forkError && (
                <div style={{ marginTop:10, fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#ef4444" }}>
                  {forkError}
                </div>
              )}
              <div style={{ display:"flex", gap:10, marginTop:18 }}>
                <button
                  onClick={() => setForkOpen(false)}
                  disabled={forkState === "pending"}
                  style={{ flex:1, padding:"12px", background:"#1a1a1a", border:"1px solid #2a2a2a", color:"#bbb", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer" }}
                >
                  CANCEL
                </button>
                <button
                  onClick={handleForkSave}
                  disabled={forkState === "pending" || forkState === "saved" || !forkName.trim()}
                  style={{ flex:2, padding:"12px", background: forkState === "saved" ? "#1a3a1a" : "#f5c842", color: forkState === "saved" ? "#4ade80" : "#111", border:"none", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600, letterSpacing:"0.08em", cursor: forkState === "pending" ? "wait" : "pointer" }}
                >
                  {forkState === "pending" ? "SAVING…"
                    : forkState === "saved"  ? "✓ SAVED"
                    : "SAVE AS NEW RECIPE"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── phase 2: what did you actually use? ──────────────────────────────────
  //
  // First screen of the pantry-reconcile flow. Shows every recipe.ingredients
  // row as an editable card; the user can tweak how much they really used,
  // or ✕ any row they didn't consume (sub, already-out, "I used yesterday's
  // leftover chicken"). Untracked free-text ingredients (no ingredientId)
  // render as greyed info-only cards — they don't have a pantry row to
  // decrement, but we still show them so the user sees the whole ingredient
  // list and can ✕ the ones they swapped out mentally.
  //
  // Default behavior: each tracked ingredient pre-fills the recipe's quantity
  // and defaults to the first matching pantry row. The multi-match picker
  // (expiration + location labels) lands in a follow-up commit; for now the
  // card surfaces a "+N more" count so nothing is hidden.
  if (phase === "ingredientsUsed") {
    const setRow = (idx, patch) =>
      setUsedItems(prev => prev.map(r => r.idx === idx ? { ...r, ...patch } : r));

    const { num, denom } = stepOf("ingredientsUsed");

    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px", overflowY:"auto" }}>
        {/* Keyframes for the delta segment's scrolling hatches.
            Scoped to the component via a single inline <style> tag
            so we don't pollute the global stylesheet. Honors
            prefers-reduced-motion — pauses the animation entirely
            for users who've opted out of motion. */}
        <style>{`
          @keyframes cookCompleteDelta {
            from { background-position: 0 0; }
            to   { background-position: 34px 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            [style*="cookCompleteDelta"] {
              animation: none !important;
            }
          }
        `}</style>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>STEP {num} OF {denom}</div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          What did you use?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:20 }}>
          Tweak the amounts or tap ✕ on anything you swapped out or skipped. We'll pull these from your pantry next.
        </p>

        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10, marginBottom:18 }}>
          {usedItems.map(row => {
            const ing = row.canonical;
            const tracked = Boolean(ing);
            const match = tracked && row.selectedRowId
              ? row.matches.find(m => m.id === row.selectedRowId) || null
              : null;
            const extraMatches = tracked ? Math.max(0, row.matches.length - 1) : 0;
            // Display name / emoji prefer the MATCHED pantry row when
            // one is selected — the user is pulling Tostitos Queso from
            // the fridge, so the header should read "Tostitos Queso",
            // not the recipe's original "Fresh Mozzarella." When the
            // match is a substitute (different canonical than the
            // recipe's), we also surface a "SUB FOR ..." subtitle so
            // the user sees both: what they're actually using AND what
            // the recipe asked for.
            const matchCanon = match?.ingredientId ? findIngredient(match.ingredientId) : null;
            const isSubstitute = !!match && !!ing?.id && !!matchCanon?.id
              && !resolvesToSameCanonical(match.ingredientId, ing.id);
            const emoji = match?.emoji
              || matchCanon?.emoji
              || ing?.emoji
              || row.recipeIng.emoji
              || "🥣";
            const displayName = match?.name
              || matchCanon?.name
              || ing?.name
              || row.recipeIng.item
              || "Ingredient";
            const recipeAsk = ing?.name || row.recipeIng.item || null;
            const unitOptions = ing?.units || [];
            const canEditAmount = tracked && row.usedUnit;
            // Card styling: active rows have the yellow underline, skipped
            // rows dim way down so they read as "we won't touch this".
            return (
              <div
                key={row.idx}
                style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"12px 14px",
                  background: row.skipped ? "#0c0c0c" : "#141414",
                  border: `1px solid ${row.skipped ? "#1a1a1a" : (tracked ? "#2a2a2a" : "#1e1e1e")}`,
                  borderRadius:12,
                  opacity: row.skipped ? 0.45 : 1,
                  transition:"all 0.15s",
                }}
              >
                <span style={{ fontSize:22, flexShrink:0 }}>{emoji}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"'Fraunces',serif", fontSize:15, color: row.skipped ? "#555" : "#f0ece4", fontStyle:"italic", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {displayName}
                  </div>
                  {isSubstitute && recipeAsk && (
                    <div style={{
                      fontFamily:"'DM Mono',monospace", fontSize:9,
                      color:"#f59e0b", letterSpacing:"0.05em",
                      marginTop:1, fontStyle:"italic",
                    }}>
                      SUB FOR {recipeAsk.toUpperCase()}
                    </div>
                  )}
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", marginTop:2, letterSpacing:"0.05em", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                    {tracked && match && extraMatches > 0 ? (
                      <button
                        onClick={() => setPickerForIdx(row.idx)}
                        style={{
                          padding:"2px 6px", background:"#1a1608", color:"#f5c842",
                          border:"1px solid #3a2f10", borderRadius:4, cursor:"pointer",
                          fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.05em",
                        }}
                      >
                        {`FROM ${(match.location || "pantry").toUpperCase()} · +${extraMatches} MORE ▾`}
                      </button>
                    ) : (
                      <span>
                        {tracked
                          ? (match ? `FROM ${(match.location || "pantry").toUpperCase()}` : "NOT IN PANTRY")
                          : "UNTRACKED"}
                      </span>
                    )}
                    <span>· RECIPE: {row.recipeIng.amount || "—"}</span>
                  </div>
                </div>
                {canEditAmount && !row.skipped ? (() => {
                  // Compute reference quantities in the user's CURRENT
                  // unit so the slider range, the recipe tick, and the
                  // amount display all live in one coordinate space.
                  // When the user flips the unit dropdown, everything
                  // re-renders against the new unit — slider range
                  // expands/contracts, tick position updates, and the
                  // number input gets live-converted (below).
                  const recipeQty = row.recipeIng.qty
                    || parseAmountString(row.recipeIng.amount, ing)
                    || null;
                  const toUsed = (qty) => {
                    if (!qty || !row.usedUnit) return null;
                    if (qty.unit === row.usedUnit) return Number(qty.amount);
                    const res = convertWithBridge(qty, row.usedUnit, ing, match);
                    return res.ok ? res.value : null;
                  };
                  const maxInUsed = match && Number(match.amount) > 0
                    ? toUsed({ amount: Number(match.amount), unit: match.unit })
                    : null;
                  const recipeInUsed = recipeQty ? toUsed(recipeQty) : null;
                  // Live-convert when the user flips the unit dropdown.
                  // Without this the number stayed the same digit while
                  // the unit changed beneath it — silently corrupting
                  // the deduction. Now: 0.5 sticks → switch to tbsp →
                  // number flips to 8 tbsp, slider range rescales, tick
                  // marker slides to the equivalent recipe position.
                  const onUnitChange = (nextUnit) => {
                    if (!nextUnit || nextUnit === row.usedUnit) return;
                    const curAmt = Number(row.usedAmount);
                    if (!Number.isFinite(curAmt) || curAmt <= 0) {
                      setRow(row.idx, { usedUnit: nextUnit });
                      return;
                    }
                    const res = convertWithBridge(
                      { amount: curAmt, unit: row.usedUnit },
                      nextUnit, ing, match,
                    );
                    setRow(row.idx, res.ok
                      ? { usedAmount: Number(res.value.toFixed(3)), usedUnit: nextUnit }
                      : { usedUnit: nextUnit }
                    );
                  };
                  const fmt = (n) => n == null
                    ? "—"
                    : Number(n.toFixed(n >= 10 ? 1 : 2));
                  return (
                    <div style={{ display:"flex", flexDirection:"column", gap:6, alignItems:"flex-end", flexShrink:0, minWidth:200 }}>
                      {/* "USE:" label inline with the amount+unit
                          selectors so the input pair reads as one
                          phrase: "USE: [5.7] [tortillas ▾]". Kills the
                          redundant "USED: 5.7 tortillas" corner label
                          below. Label color tracks leftColor to stay
                          part of the same visual system. */}
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{
                          fontFamily:"'DM Mono',monospace", fontSize:10,
                          color: "#888", letterSpacing:"0.08em",
                        }}>
                          USE:
                        </span>
                        <input
                          type="number" min="0" step="any"
                          value={row.usedAmount ?? ""}
                          onChange={e => setRow(row.idx, { usedAmount: e.target.value === "" ? null : Number(e.target.value) })}
                          style={{ width:56, padding:"6px 8px", background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:13, color:"#f0ece4", textAlign:"right", outline:"none" }}
                        />
                        <select
                          value={row.usedUnit || ""}
                          onChange={e => onUnitChange(e.target.value)}
                          style={{ padding:"6px 4px", background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#ccc", outline:"none" }}
                        >
                          {unitOptions.map(u => (
                            <option key={u.id} value={u.id}>{unitLabel(ing, u.id)}</option>
                          ))}
                        </select>
                      </div>
                      {/* Meter diagnostic — if the gate below fails
                          we used to silently render nothing, making
                          "chicken gives me no slider" a mystery.
                          Short honest label tells why so we can
                          debug without staring at the code. */}
                      {!(match && maxInUsed != null && maxInUsed > 0) && (
                        <div style={{
                          fontFamily:"'DM Mono',monospace", fontSize:9,
                          color:"#555", letterSpacing:"0.04em",
                          fontStyle:"italic",
                        }}>
                          {!match
                            ? "(no pantry row selected — meter hidden)"
                            : maxInUsed == null
                              ? `(can't convert pantry ${match.unit} → ${row.usedUnit} — meter hidden)`
                              : maxInUsed <= 0
                                ? "(pantry row shows 0 — meter hidden)"
                                : "(meter unavailable)"}
                        </div>
                      )}
                      {match && maxInUsed != null && maxInUsed > 0 && (() => {
                        // Single horizontal bar with three colored
                        // segments side-by-side:
                        //
                        //   |====left after (dynamic)====|==used==|==pack rem==|
                        //                                ^ slider thumb
                        //
                        // The LEFT AFTER COOK fill color shifts live
                        // with how much is left, acting as a status
                        // light for the pantry row:
                        //
                        //   > 60% left → GREEN  (good condition)
                        //   25–60%     → TAN    (getting low)
                        //   < 25%      → RUST   (almost out)
                        //
                        // USED TODAY is always blue. The tail after
                        // the current pantry total (gray) shows package
                        // headroom / package reference so the user sees
                        // how many packs their stock adds up to.
                        const pkgQty = match.packageAmount && match.packageUnit
                          ? { amount: Number(match.packageAmount), unit: match.packageUnit }
                          : null;
                        const pkgInUsed = pkgQty ? toUsed(pkgQty) : null;
                        // Per-row "original stock" in user's unit.
                        // Three signals, most-specific wins:
                        //   1. packageAmount × 1 (explicit pack size)
                        //   2. max (original amount when opened)
                        //   3. amount (current — partial pack with no
                        //      capacity info)
                        // convertWithBridge handles cross-unit so a row
                        // in lb with max=1.5 resolves correctly when
                        // usedUnit is oz, etc.
                        const rowOriginalInUsed = (m) => {
                          const pack = m.packageAmount && m.packageUnit
                            ? (m.packageUnit === row.usedUnit
                                ? Number(m.packageAmount)
                                : (convertWithBridge(
                                    { amount: Number(m.packageAmount), unit: m.packageUnit },
                                    row.usedUnit, ing, m,
                                  ).value))
                            : null;
                          if (Number.isFinite(pack) && pack > 0) return pack;
                          const max = Number(m.max);
                          if (Number.isFinite(max) && max > 0) {
                            if (m.unit === row.usedUnit) return max;
                            const res = convertWithBridge(
                              { amount: max, unit: m.unit },
                              row.usedUnit, ing, m,
                            );
                            return res.ok ? res.value : null;
                          }
                          if (m.unit === row.usedUnit) return Number(m.amount);
                          const res = convertWithBridge(
                            { amount: Number(m.amount), unit: m.unit },
                            row.usedUnit, ing, m,
                          );
                          return res.ok ? res.value : null;
                        };
                        const rowCurrentInUsed = (m) => {
                          if (m.unit === row.usedUnit) return Number(m.amount);
                          const res = convertWithBridge(
                            { amount: Number(m.amount), unit: m.unit },
                            row.usedUnit, ing, m,
                          );
                          return res.ok ? res.value : 0;
                        };
                        // Sum across every sibling row. Original stock =
                        // the full-package ceiling (bar width); current
                        // stock = what's physically in the kitchen now.
                        // The gap between them is "already consumed from
                        // packages" — rendered as the empty tail that
                        // user asked for ("we start from less because
                        // the package has been opened").
                        const stockOriginal = (row.matches || []).reduce((sum, m) => {
                          const v = rowOriginalInUsed(m);
                          return sum + (Number.isFinite(v) && v > 0 ? v : 0);
                        }, 0);
                        const stockCurrent = (row.matches || []).reduce((sum, m) => {
                          const v = rowCurrentInUsed(m);
                          return sum + (Number.isFinite(v) && v > 0 ? v : 0);
                        }, 0);
                        const pantryNow = Math.max(maxInUsed, stockCurrent);
                        const meterMax  = Math.max(pantryNow, stockOriginal);
                        const packageCount = (pkgInUsed && pkgInUsed > 0)
                          ? Math.max(1, Math.round(meterMax / pkgInUsed))
                          : 0;
                        const step = meterMax <= 10 ? 0.1 : meterMax <= 100 ? 1 : meterMax / 100;
                        const cur = Number.isFinite(Number(row.usedAmount))
                          ? Math.min(Number(row.usedAmount), pantryNow)
                          : 0;
                        const leftAfter = Math.max(0, pantryNow - cur);
                        const pct = (v) => Math.max(0, Math.min(100, (v / meterMax) * 100));
                        const unitTxt = unitLabel(ing, row.usedUnit);
                        // Health color — shifts live as the user moves
                        // the slider. Ratio is against pantryNow (not
                        // meterMax) so a user with 4 full packs doesn't
                        // read "bad condition" the moment they commit
                        // one pack; badness is relative to what they
                        // actually have on hand.
                        const leftRatio = pantryNow > 0 ? leftAfter / pantryNow : 0;
                        const leftColor = leftRatio >= 0.6 ? "#7ec87e"     // good
                                        : leftRatio >= 0.25 ? "#c9a34e"   // medium
                                        : "#c05a44";                       // bad
                        const leftLabel = leftRatio >= 0.6 ? "GOOD"
                                        : leftRatio >= 0.25 ? "LOW"
                                        : "ALMOST OUT";
                        const leftPct = pct(leftAfter);
                        const usedPct = pct(cur);
                        // pkg-tail covers the meter beyond pantryNow,
                        // i.e. the package-count × packageSize headroom
                        // that represents sealed packages the user isn't
                        // drawing from this cook.
                        return (
                          <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:6 }}>
                            {/* Single-line "how much left" label. Drops
                                the · LOW / · GOOD / · ALMOST OUT tag —
                                color already telegraphs condition, the
                                words were redundant noise. */}
                            <div style={{
                              fontFamily:"'DM Mono',monospace", fontSize:9,
                              letterSpacing:"0.04em",
                              color: leftColor,
                            }}>
                              {fmt(leftAfter)} {unitTxt} LEFT AFTER COOK
                            </div>
                            {/* The bar. 0 on the left, pantry-max on
                                the right. LEFT AFTER COOK is the solid
                                fill growing from 0; USED (animated
                                delta) is the hatched tail on the right.
                                Slider value maps to leftAfter (not
                                used) — so dragging RIGHT increases
                                leftAfter (= less used) and moves the
                                thumb RIGHT. Reading and interaction
                                both go the same direction now, no
                                inversion. */}
                            <div style={{ position:"relative", width:"100%", height:22 }}>
                              <div style={{
                                position:"absolute", top:5, left:0, right:0, height:12,
                                background:"#2a2a2a", borderRadius:6,
                              }} />
                              {/* LEFT AFTER COOK — solid color, grows
                                  from 0 to leftPct% */}
                              <div style={{
                                position:"absolute", top:5, left:0, height:12,
                                width:`${leftPct}%`,
                                background: leftColor,
                                borderRadius: leftPct >= 99.5 ? 6 : "6px 0 0 6px",
                                transition:"width 0.08s linear, background 0.15s linear",
                              }} />
                              {/* USED TODAY — animated delta tail,
                                  from leftPct% to leftPct+usedPct% */}
                              <div style={{
                                position:"absolute", top:5, left:`${leftPct}%`, height:12,
                                width:`${usedPct}%`,
                                background: `repeating-linear-gradient(
                                  -45deg,
                                  ${leftColor}66 0px,
                                  ${leftColor}66 6px,
                                  ${leftColor}22 6px,
                                  ${leftColor}22 12px
                                )`,
                                backgroundSize: "17px 17px",
                                animation: "cookCompleteDelta 1.8s linear infinite",
                                borderRadius:
                                  (leftPct + usedPct) >= 99.5 && leftPct < 0.5 ? 6
                                  : (leftPct + usedPct) >= 99.5 ? "0 6px 6px 0"
                                  : 0,
                                transition:"width 0.08s linear, left 0.08s linear, background 0.15s linear",
                              }} />
                              {/* Thumb — color-matched to leftColor.
                                  Sits at the leftPct% boundary. Driven
                                  by the invisible range input below. */}
                              <div style={{
                                position:"absolute",
                                top:2, left:`calc(${leftPct}% - 9px)`,
                                width:18, height:18,
                                background: leftColor,
                                border:"3px solid #0a0a0a",
                                borderRadius:"50%",
                                pointerEvents:"none",
                                boxShadow:`0 0 6px ${leftColor}66`,
                                transition:"background 0.15s linear, box-shadow 0.15s linear, left 0.08s linear",
                              }} />
                              {/* Range input drives LEFT AFTER directly:
                                  value = pantryNow − usedAmount. Drag
                                  right → leftAfter up → used down →
                                  thumb tracks right. Drag left → used
                                  up → thumb tracks left. Visual and
                                  interaction aligned. */}
                              <input
                                type="range"
                                min="0" max={pantryNow} step={step}
                                value={leftAfter}
                                onChange={e => {
                                  const nextLeft = Number(e.target.value);
                                  const nextUsed = Math.max(0, pantryNow - nextLeft);
                                  setRow(row.idx, {
                                    usedAmount: nextUsed,
                                    usedUnit: row.usedUnit,
                                  });
                                }}
                                aria-label={`Estimate ${displayName} used`}
                                style={{
                                  position:"absolute", inset:0,
                                  width: meterMax > 0
                                    ? `${(pantryNow / meterMax) * 100}%`
                                    : "100%",
                                  margin:0,
                                  opacity:0.01,
                                  cursor:"pointer",
                                }}
                              />
                            </div>
                            {/* Bottom labels — pantry stock composition
                                (package count × size) on the left, recipe
                                ask on the right. */}
                            <div style={{
                              display:"flex", justifyContent:"space-between",
                              fontFamily:"'DM Mono',monospace", fontSize:9,
                              letterSpacing:"0.04em", color:"#666",
                            }}>
                              <span style={{ color:"#7ec87e" }}>
                                IN PANTRY: {(pkgInUsed && pkgInUsed > 0 && packageCount > 1)
                                  ? `${fmt(pkgInUsed)} × ${packageCount} PACKS`
                                  : `${fmt(pantryNow)} ${unitTxt}`}
                              </span>
                              {recipeInUsed != null && (
                                <span style={{ color:"#b8a878" }}>
                                  RECIPE: {fmt(recipeInUsed)} {unitTxt}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      {/* Conversion shadow intentionally removed.
                          The prefill now defaults to the recipe's unit
                          and the meter/labels all use ONE unit, so the
                          shadow readout was just noise ("0.86 pints"
                          popping up when the user is already reading
                          cups everywhere else). If the user flips the
                          dropdown to a different unit, the number
                          live-converts and the whole row re-renders in
                          that unit — no second unit needed on screen. */}
                    </div>
                  );
                })() : null}
                <button
                  onClick={() => setRow(row.idx, { skipped: !row.skipped })}
                  aria-label={row.skipped ? "Re-include" : "Skip this ingredient"}
                  style={{
                    width:30, height:30, flexShrink:0,
                    background: row.skipped ? "#1a1608" : "transparent",
                    color: row.skipped ? "#f5c842" : "#666",
                    border:`1px solid ${row.skipped ? "#3a2f10" : "#2a2a2a"}`,
                    borderRadius:8, cursor:"pointer",
                    fontFamily:"'DM Mono',monospace", fontSize:12,
                  }}
                >
                  {row.skipped ? "↺" : "✕"}
                </button>
              </div>
            );
          })}

          {/* Extra-removal rows: pantry rows the user tapped "Add leftover /
              sub" to decrement instead of (or in addition to) the recipe
              ingredients. Rendered inline so the cumulative removal plan
              reads as one list. Tag reads "+ ADDED" to distinguish from the
              recipe-derived rows above. */}
          {extraRemovals.map(extra => (
            <div
              key={extra.tempId}
              style={{
                display:"flex", alignItems:"center", gap:10,
                padding:"12px 14px",
                background:"#0f140a",
                border:"1px solid #1e3a1e",
                borderRadius:12,
              }}
            >
              <span style={{ fontSize:22, flexShrink:0 }}>{extra.emoji || "🥣"}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:"'Fraunces',serif", fontSize:15, color:"#d4ebd4", fontStyle:"italic", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {extra.name}
                </div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#7ec87e", marginTop:2, letterSpacing:"0.05em" }}>
                  + ADDED · FROM {(extra.location || "pantry").toUpperCase()}
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                <input
                  type="number" min="0" step="any"
                  value={extra.amount ?? ""}
                  onChange={e => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    setExtraRemovals(prev => prev.map(x => x.tempId === extra.tempId ? { ...x, amount: v } : x));
                  }}
                  style={{ width:56, padding:"6px 8px", background:"#0a0a0a", border:"1px solid #1e3a1e", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:13, color:"#d4ebd4", textAlign:"right", outline:"none" }}
                />
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#7ec87e", minWidth:38 }}>
                  {extra.unitLabel}
                </span>
              </div>
              <button
                onClick={() => setExtraRemovals(prev => prev.filter(x => x.tempId !== extra.tempId))}
                aria-label="Remove from list"
                style={{ width:30, height:30, flexShrink:0, background:"transparent", color:"#666", border:"1px solid #2a2a2a", borderRadius:8, cursor:"pointer", fontFamily:"'DM Mono',monospace", fontSize:12 }}
              >
                ✕
              </button>
            </div>
          ))}

          {/* Add-leftover / substitution entry. Keeps the CTA low-key so it
              doesn't out-shout the primary "Continue". Disabled if the
              pantry is empty — nothing to pick from. */}
          <button
            onClick={() => setAddLeftoverOpen(true)}
            disabled={!pantry || pantry.length === 0}
            style={{
              padding:"12px 14px",
              background:"transparent",
              border:"1px dashed #2a2a2a",
              borderRadius:12,
              fontFamily:"'DM Mono',monospace", fontSize:11,
              color: pantry && pantry.length > 0 ? "#888" : "#444",
              letterSpacing:"0.08em",
              cursor: pantry && pantry.length > 0 ? "pointer" : "not-allowed",
              textAlign:"left",
            }}
          >
            + ADD LEFTOVER / SUB
          </button>
        </div>

        <div style={{ display:"flex", gap:10, marginTop:"auto" }}>
          <button onClick={() => setPhase("celebrate")}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button onClick={() => setPhase("confirmRemoval")}
            style={{ flex:2, padding:"14px", background:"#f5c842", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color:"#111", cursor:"pointer", letterSpacing:"0.08em" }}>
            CONTINUE →
          </button>
        </div>

        {/* Add-leftover / substitution picker. Lists every current pantry row
            (both kind='ingredient' and future kind='meal' leftovers) grouped
            by location so the user can scan fridge → freezer → pantry the
            way they'd think about it. Tapping a row adds it to the removal
            plan with a default amount the user can tweak inline on the
            main list afterward. */}
        {addLeftoverOpen && (
          <div
            onClick={() => setAddLeftoverOpen(false)}
            style={{ position:"absolute", inset:0, background:"#000d", zIndex:6, display:"flex", alignItems:"flex-end", animation:"rise 0.18s ease" }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ width:"100%", maxHeight:"80%", overflowY:"auto", background:"#0a0a0a", borderTop:"1px solid #2a2a2a", borderTopLeftRadius:18, borderTopRightRadius:18, padding:"22px 20px 16px" }}
            >
              <div style={{ width:42, height:4, background:"#2a2a2a", borderRadius:2, margin:"0 auto 16px" }} />
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:6 }}>
                ADD LEFTOVER / SUB
              </div>
              <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666", marginBottom:16 }}>
                Used something the recipe didn't call for — yesterday's cooked chicken, a homemade sauce? Pick it here and we'll decrement it too.
              </p>

              {["fridge","freezer","pantry"].map(loc => {
                const rowsAtLoc = (pantry || [])
                  .filter(p => (p.location || "pantry") === loc && Number(p.amount) > 0)
                  .sort((a, b) => {
                    const ax = a.expiresAt ? a.expiresAt.getTime() : Infinity;
                    const bx = b.expiresAt ? b.expiresAt.getTime() : Infinity;
                    return ax - bx;
                  });
                if (rowsAtLoc.length === 0) return null;
                return (
                  <div key={loc} style={{ marginBottom:14 }}>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.15em", marginBottom:8 }}>
                      {loc.toUpperCase()}
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {rowsAtLoc.map(p => {
                        const canonical = p.ingredientId ? findIngredient(p.ingredientId) : null;
                        const uLabel = canonical ? unitLabel(canonical, p.unit) : p.unit;
                        const alreadyAdded = extraRemovals.some(x => x.pantryRowId === p.id);
                        const isMeal = (p.kind || "ingredient") === "meal";
                        return (
                          <button
                            key={p.id}
                            disabled={alreadyAdded}
                            onClick={() => {
                              // Default to the recipe's qty if the ingredient
                              // matches; otherwise 1 of the row's unit.
                              const defaultAmount = 1;
                              setExtraRemovals(prev => [...prev, {
                                tempId: `extra-${p.id}-${Date.now()}`,
                                pantryRowId: p.id,
                                ingredientId: p.ingredientId || null,
                                name: p.name,
                                emoji: p.emoji,
                                amount: defaultAmount,
                                unit: p.unit,
                                unitLabel: uLabel,
                                location: p.location || "pantry",
                                kind: p.kind || "ingredient",
                              }]);
                              setAddLeftoverOpen(false);
                            }}
                            style={{
                              textAlign:"left", padding:"10px 12px",
                              background: alreadyAdded ? "#0c0c0c" : "#141414",
                              border:`1px solid ${alreadyAdded ? "#1a1a1a" : "#2a2a2a"}`,
                              borderRadius:10,
                              cursor: alreadyAdded ? "not-allowed" : "pointer",
                              opacity: alreadyAdded ? 0.45 : 1,
                              display:"flex", alignItems:"center", gap:10,
                            }}
                          >
                            <span style={{ fontSize:20 }}>{p.emoji || "🥣"}</span>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontFamily:"'Fraunces',serif", fontSize:14, color:"#f0ece4", fontStyle:"italic", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {p.name}
                                {isMeal && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7ec87e", marginLeft:8, letterSpacing:"0.1em" }}>LEFTOVER</span>}
                              </div>
                              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", marginTop:2 }}>
                                {p.amount} {uLabel}
                              </div>
                            </div>
                            {alreadyAdded && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.1em" }}>ADDED</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <button
                onClick={() => setAddLeftoverOpen(false)}
                style={{ marginTop:4, width:"100%", padding:"12px", background:"transparent", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}
              >
                CLOSE
              </button>
            </div>
          </div>
        )}

        {/* Multi-match picker sheet. Opens over the phase when the user taps
            the "+N MORE ▾" pill on a row with more than one matching pantry
            row. We never auto-pick even though 99% of the time nearest-
            expiring is right — the user asked to confirm per the kitchen
            reality that people reach for the wrong container all the time.
            Rows are sorted earliest-expiring first (FIFO nudge) with a
            sentinel for rows missing an expires_at. */}
        {pickerForIdx != null && (() => {
          const row = usedItems.find(r => r.idx === pickerForIdx);
          if (!row) return null;
          const sorted = [...row.matches].sort((a, b) => {
            const ax = a.expiresAt ? a.expiresAt.getTime() : Infinity;
            const bx = b.expiresAt ? b.expiresAt.getTime() : Infinity;
            return ax - bx;
          });
          const now = Date.now();
          return (
            <div
              onClick={() => setPickerForIdx(null)}
              style={{ position:"absolute", inset:0, background:"#000d", zIndex:5, display:"flex", alignItems:"flex-end", animation:"rise 0.18s ease" }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{ width:"100%", maxHeight:"75%", overflowY:"auto", background:"#0a0a0a", borderTop:"1px solid #2a2a2a", borderTopLeftRadius:18, borderTopRightRadius:18, padding:"22px 20px 16px" }}
              >
                <div style={{ width:42, height:4, background:"#2a2a2a", borderRadius:2, margin:"0 auto 16px" }} />
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:6 }}>
                  PICK YOUR {(row.canonical?.name || row.recipeIng.item || "").toUpperCase()}
                </div>
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666", marginBottom:16 }}>
                  You have {row.matches.length} containers. Which one did you pull from?
                </p>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {sorted.map(m => {
                    const active = row.selectedRowId === m.id;
                    const days = m.expiresAt ? Math.round((m.expiresAt.getTime() - now) / 86400000) : null;
                    const dayLabel = days == null
                      ? "no expiration"
                      : days < 0 ? `${Math.abs(days)}d past`
                      : days === 0 ? "expires today"
                      : `${days}d left`;
                    const dayColor = days == null ? "#666"
                      : days <= 1 ? "#ef4444"
                      : days <= 3 ? "#f59e0b"
                      : "#4ade80";
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          setUsedItems(prev => prev.map(r => r.idx === row.idx ? { ...r, selectedRowId: m.id, usedUnit: r.usedUnit || m.unit } : r));
                          setPickerForIdx(null);
                        }}
                        style={{
                          textAlign:"left", padding:"12px 14px",
                          background: active ? "#1a1608" : "#141414",
                          border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                          borderRadius:12, cursor:"pointer",
                        }}
                      >
                        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.1em" }}>
                            {(m.location || "pantry").toUpperCase()}
                          </span>
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:dayColor, letterSpacing:"0.1em" }}>
                            {dayLabel.toUpperCase()}
                          </span>
                          {active && <span style={{ marginLeft:"auto", fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.1em" }}>✓ SELECTED</span>}
                        </div>
                        <div style={{ fontFamily:"'Fraunces',serif", fontSize:14, color:"#f0ece4", fontStyle:"italic" }}>
                          {m.amount} {unitLabel(row.canonical, m.unit)}
                          {m.purchasedAt ? (
                            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", marginLeft:8, letterSpacing:"0.05em" }}>
                              · bought {m.purchasedAt.toLocaleDateString(undefined, { month:"short", day:"numeric" })}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setPickerForIdx(null)}
                  style={{ marginTop:14, width:"100%", padding:"12px", background:"transparent", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}
                >
                  CLOSE
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ── phase: confirm removal ───────────────────────────────────────────────
  //
  // Read-only summary of "here's exactly what we're taking off your pantry."
  // Lets the user eyeball the list + "leaves N remaining" math before
  // committing. No writes yet — the Remove button just transitions to the
  // leftovers phase so the whole decrement + leftover-row + cook_log insert
  // can fire atomically in save(). A user bailing out of the modal at any
  // point past here still hasn't touched their pantry.
  if (phase === "confirmRemoval") {
    const plan = buildRemovalPlan(usedItems, extraRemovals, pantry);
    const { num, denom } = stepOf("confirmRemoval");

    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px", overflowY:"auto" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          STEP {num} OF {denom}
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          Take these off the pantry?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:20 }}>
          Last check before we update your shelves. Back up to tweak anything.
        </p>

        {plan.length === 0 ? (
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#555", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontStyle:"italic", textAlign:"center", padding:"0 20px" }}>
            Nothing to remove. Either the recipe has no tracked ingredients, or you ✕'d them all. Continue past this screen to log the cook anyway.
          </div>
        ) : (
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10, marginBottom:18 }}>
            {plan.map((entry, i) => {
              const uLabel = entry.ingredient
                ? unitLabel(entry.ingredient, entry.used.unit)
                : entry.used.unit;
              const rowUnitLabel = entry.ingredient
                ? unitLabel(entry.ingredient, entry.pantryRow.unit)
                : entry.pantryRow.unit;
              const leaves = entry.convertible
                ? (entry.newAmount === 0
                    ? "ITEM CLEARS"
                    : `LEAVES ${formatQty({ amount: entry.newAmount, unit: entry.pantryRow.unit }, entry.ingredient)} ${rowUnitLabel}`)
                : "UNIT MISMATCH · TAP BACK TO FIX";
              return (
                <div
                  key={`${entry.pantryRowId}-${i}`}
                  style={{
                    display:"flex", alignItems:"center", gap:10,
                    padding:"12px 14px",
                    background: entry.source === "added" ? "#0f140a" : "#141414",
                    border: `1px solid ${entry.convertible ? (entry.source === "added" ? "#1e3a1e" : "#2a2a2a") : "#3a1a1a"}`,
                    borderRadius:12,
                  }}
                >
                  <span style={{ fontSize:22 }}>{entry.displayEmoji}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:"'Fraunces',serif", fontSize:15, color:"#f0ece4", fontStyle:"italic" }}>
                      {entry.displayName}
                    </div>
                    {entry.subFor && (
                      <div style={{
                        fontFamily:"'DM Mono',monospace", fontSize:9,
                        color:"#f59e0b", letterSpacing:"0.05em",
                        marginTop:1, fontStyle:"italic",
                      }}>
                        SUB FOR {entry.subFor.toUpperCase()}
                      </div>
                    )}
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: entry.convertible ? "#888" : "#ef4444", marginTop:2, letterSpacing:"0.05em" }}>
                      {entry.source === "added" ? "+ ADDED · " : ""}
                      {(entry.pantryRow.location || "pantry").toUpperCase()} · {leaves}
                    </div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontFamily:"'Fraunces',serif", fontSize:16, color:"#f5c842", fontStyle:"italic" }}>
                      −{formatQty(entry.used, entry.ingredient)}
                    </div>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.05em" }}>
                      {uLabel}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display:"flex", gap:10, marginTop:"auto" }}>
          <button onClick={() => setPhase("ingredientsUsed")}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button onClick={() => setPhase("leftovers")}
            style={{ flex:2, padding:"14px", background:"#f5c842", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color:"#111", cursor:"pointer", letterSpacing:"0.08em" }}>
            {plan.length === 0 ? "CONTINUE →" : `REMOVE ${plan.length} →`}
          </button>
        </div>
      </div>
    );
  }

  // ── phase: leftovers? (yes/no) ───────────────────────────────────────────
  //
  // Single binary question — did anything survive the meal? For compounds
  // (sriracha, pesto, stock) the copy reframes as "bottle this up?" since
  // the user made this specifically to save; for regular dishes it's the
  // classic "store leftovers?" No path skips straight to diners/rating;
  // Yes routes to the location + amount picker.
  if (phase === "leftovers") {
    const { num, denom } = stepOf("leftovers");
    const prevPhase = usedItems.length > 0 ? "confirmRemoval" : "celebrate";
    const nextOnNo = connections.length > 0 ? "diners" : "rating";
    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          STEP {num} OF {denom}
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          {isCompoundProduce ? "Bottle this up?" : "Store leftovers?"}
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:28 }}>
          {isCompoundProduce
            ? "We'll add it to your kitchen so you can pull from it next time a recipe calls for it."
            : "Put a portion in the fridge / freezer and it'll show up in your kitchen for a future meal."}
        </p>

        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:12 }}>
          <button
            onClick={() => { setLeftoverChoice("yes"); setPhase("leftoverLocation"); }}
            style={{ padding:"18px 20px", background:"#0f1a0f", border:"1px solid #1e3a1e", borderRadius:14, cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:14 }}
          >
            <span style={{ fontSize:32 }}>🥡</span>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:"#4ade80", fontStyle:"italic" }}>
                {isCompoundProduce ? "Yes, bottle it" : "Yes, save some"}
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#7ec87e", letterSpacing:"0.08em", marginTop:3 }}>
                ADDS A ROW TO YOUR PANTRY
              </div>
            </div>
          </button>
          <button
            onClick={() => { setLeftoverChoice("no"); setPhase(nextOnNo); }}
            style={{ padding:"18px 20px", background:"#141414", border:"1px solid #2a2a2a", borderRadius:14, cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:14 }}
          >
            <span style={{ fontSize:32 }}>🍽️</span>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:"#f0ece4", fontStyle:"italic" }}>
                {isCompoundProduce ? "Used it tonight" : "Ate it all"}
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", letterSpacing:"0.08em", marginTop:3 }}>
                NOTHING SAVED
              </div>
            </div>
          </button>
        </div>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={() => setPhase(prevPhase)}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
        </div>
      </div>
    );
  }

  // ── phase: leftover location + amount ────────────────────────────────────
  //
  // Location tabs across the top (Fridge / Freezer / Pantry / Garbage) and,
  // once a location is picked, a fraction-or-servings amount picker below.
  // Garbage means "I'm tossing the extra" — still a valid user answer, and
  // selecting it hides the amount picker and just continues.
  //
  // For compound-produce recipes the fraction pre-selects to "full" (user
  // made a full yield of sriracha to save), otherwise "½" feels like a
  // reasonable middle ground for most dinners.
  if (phase === "leftoverLocation") {
    const { num, denom } = stepOf("leftoverLocation");
    const nextPhase = connections.length > 0 ? "diners" : "rating";
    const FRACTIONS = [
      { value: 0.125, label: "⅛" },
      { value: 0.25,  label: "¼" },
      { value: 0.333, label: "⅓" },
      { value: 0.5,   label: "½" },
      { value: 0.667, label: "⅔" },
      { value: 0.75,  label: "¾" },
      { value: 1,     label: "FULL" },
    ];
    const LOCATIONS = [
      { id: "fridge",  emoji: "🧊", label: "Fridge",  hint: "Use within a few days" },
      { id: "freezer", emoji: "❄️", label: "Freezer", hint: "Good for weeks to months" },
      { id: "pantry",  emoji: "🥫", label: "Pantry",  hint: "Shelf-stable only" },
      { id: "garbage", emoji: "🗑️", label: "Garbage", hint: "Tossing the extra — nothing stored" },
    ];
    const isGarbage = leftoverLocation === "garbage";

    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px", overflowY:"auto" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          STEP {num} OF {denom}
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          Where's it going?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:20 }}>
          Pick a location and roughly how much you saved.
        </p>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:10, marginBottom:22 }}>
          {LOCATIONS.map(loc => {
            const active = leftoverLocation === loc.id;
            return (
              <button
                key={loc.id}
                onClick={() => setLeftoverLocation(loc.id)}
                style={{
                  padding:"14px 12px",
                  background: active ? "#1a1608" : "#141414",
                  border:`1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                  borderRadius:12, cursor:"pointer", textAlign:"left",
                  display:"flex", alignItems:"center", gap:10,
                }}
              >
                <span style={{ fontSize:26 }}>{loc.emoji}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"'Fraunces',serif", fontSize:15, color: active ? "#f5c842" : "#f0ece4", fontStyle:"italic" }}>
                    {loc.label}
                  </div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666", marginTop:2, letterSpacing:"0.05em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    {loc.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {leftoverLocation && !isGarbage && (
          <>
            <div style={{ display:"flex", gap:8, marginBottom:14, background:"#0a0a0a", border:"1px solid #1e1e1e", borderRadius:10, padding:3 }}>
              {["fraction","servings"].map(mode => {
                const active = leftoverMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => setLeftoverMode(mode)}
                    style={{
                      flex:1, padding:"10px",
                      background: active ? "#1a1608" : "transparent",
                      color: active ? "#f5c842" : "#666",
                      border:"none", borderRadius:8,
                      fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600,
                      letterSpacing:"0.08em", cursor:"pointer",
                    }}
                  >
                    {mode === "fraction" ? "BY FRACTION" : "BY SERVINGS"}
                  </button>
                );
              })}
            </div>

            {leftoverMode === "fraction" ? (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8, marginBottom:10 }}>
                {FRACTIONS.map(f => {
                  const active = Math.abs(leftoverFraction - f.value) < 0.01;
                  return (
                    <button
                      key={f.value}
                      onClick={() => setLeftoverFraction(f.value)}
                      style={{
                        padding:"14px 6px",
                        background: active ? "#1a1608" : "#141414",
                        border:`1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                        borderRadius:10,
                        fontFamily:"'Fraunces',serif", fontSize: f.label === "FULL" ? 14 : 22,
                        color: active ? "#f5c842" : "#f0ece4",
                        cursor:"pointer",
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:"#141414", border:"1px solid #2a2a2a", borderRadius:12, marginBottom:10 }}>
                <input
                  type="number" min="0" step="0.25"
                  value={leftoverServings}
                  onChange={e => setLeftoverServings(Math.max(0, Number(e.target.value) || 0))}
                  style={{ flex:1, padding:"10px 12px", background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:18, color:"#f5c842", textAlign:"center", outline:"none" }}
                />
                <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#888" }}>
                  serving{leftoverServings === 1 ? "" : "s"}
                </div>
              </div>
            )}

            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.08em", textAlign:"center", marginBottom:6 }}>
              {leftoverMode === "fraction"
                ? `≈ ${Number((recipe?.serves || 2) * leftoverFraction).toFixed(2)} servings saved`
                : `${leftoverServings} of ${recipe?.serves || "?"} servings saved`}
            </div>

            {/* Optional leftover name override. Default placeholder shows
                what the auto-name would be (Leftover X), so the user
                sees the fallback even when the input is empty. Skipped
                for compound-produce because that path merges into an
                existing canonical row whose name we never want to
                clobber from the cook flow. */}
            {!isCompoundProduce && (
              <div style={{ marginTop:14, marginBottom:4 }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", letterSpacing:"0.1em", marginBottom:6 }}>
                  CALL IT SOMETHING ELSE? (OPTIONAL)
                </div>
                <input
                  type="text"
                  value={leftoverCustomName}
                  onChange={e => setLeftoverCustomName(e.target.value)}
                  placeholder={`Leftover ${recipe.title}`}
                  maxLength={80}
                  style={{
                    width:"100%", boxSizing:"border-box",
                    padding:"12px 14px",
                    background:"#0a0a0a", border:"1px solid #2a2a2a",
                    borderRadius:10, color:"#f0ece4",
                    fontFamily:"'Fraunces',serif", fontStyle:"italic",
                    fontSize:15, outline:"none",
                  }}
                />
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#444", letterSpacing:"0.08em", marginTop:4 }}>
                  E.G. "MOM'S LASAGNA" · "SUNDAY SAUCE" · "BIRTHDAY CAKE NIGHT"
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display:"flex", gap:10, marginTop:"auto" }}>
          <button onClick={() => setPhase("leftovers")}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button
            onClick={() => setPhase(nextPhase)}
            disabled={!leftoverLocation}
            style={{ flex:2, padding:"14px", background: leftoverLocation ? "#f5c842" : "#1a1a1a", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color: leftoverLocation ? "#111" : "#444", cursor: leftoverLocation ? "pointer" : "not-allowed", letterSpacing:"0.08em" }}>
            CONTINUE →
          </button>
        </div>
      </div>
    );
  }

  // ── phase 3: who ate with you? ───────────────────────────────────────────
  if (phase === "diners") {
    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px", overflowY:"auto" }}>
        {(() => { const { num, denom } = stepOf("diners"); return (
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          STEP {num} OF {denom}
        </div>
        ); })()}
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          Who ate with you?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:22 }}>
          They'll get a heads-up and can leave their own review later. Skip if you flew solo.
        </p>

        <div style={{ flex:1, display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10, alignContent:"start" }}>
          {connections.map(c => {
            const selected = selectedDiners.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleDiner(c.id)}
                style={{
                  display:"flex", flexDirection:"column", alignItems:"center", gap:6,
                  padding:"14px 6px",
                  background: selected ? "#1e1a0e" : "#161616",
                  border: `1px solid ${selected ? "#f5c842" : "#2a2a2a"}`,
                  borderRadius:14, cursor:"pointer", transition:"all 0.2s",
                }}
              >
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt={c.name}
                    referrerPolicy="no-referrer"
                    style={{
                      width:44, height:44, borderRadius:"50%", objectFit:"cover", display:"block",
                      boxShadow: selected ? "0 0 0 2px #f5c842" : "none",
                    }}
                  />
                ) : (
                  <div style={{
                    width:44, height:44, borderRadius:"50%",
                    background: selected ? "#f5c842" : "#222",
                    color: selected ? "#111" : "#aaa",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:500,
                  }}>
                    {c.initial}
                  </div>
                )}
                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color: selected ? "#f5c842" : "#ccc", textAlign:"center", lineHeight:1.2 }}>
                  {c.first}
                </span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:8, color:"#666", letterSpacing:"0.1em" }}>
                  {c.kind.toUpperCase()}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={() => setPhase("rating")}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            I ATE ALONE
          </button>
          <button onClick={() => setPhase("rating")}
            style={{ flex:2, padding:"14px", background:"#f5c842", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color:"#111", cursor:"pointer", letterSpacing:"0.08em" }}>
            {selectedDiners.size > 0 ? `CONTINUE WITH ${selectedDiners.size} →` : "CONTINUE →"}
          </button>
        </div>
      </div>
    );
  }

  // ── phase 3: rating ──────────────────────────────────────────────────────
  if (phase === "rating") {
    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          {(() => { const { num, denom } = stepOf("rating"); return `STEP ${num} OF ${denom}`; })()}
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          How'd it go?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:28 }}>
          Honest answer — we use this to suggest better meals and learn your taste.
        </p>

        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10 }}>
          {RATINGS.map(r => {
            const active = rating === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setRating(r.id)}
                style={{
                  display:"flex", alignItems:"center", gap:14,
                  padding:"16px 18px",
                  background: active ? r.bg : "#141414",
                  border: `1px solid ${active ? r.color : "#2a2a2a"}`,
                  borderRadius:14, cursor:"pointer", transition:"all 0.2s",
                  textAlign:"left",
                }}
              >
                <span style={{ fontSize:32 }}>{r.emoji}</span>
                <span style={{ flex:1, fontFamily:"'Fraunces',serif", fontSize:18, color: active ? r.color : "#f0ece4", fontStyle:"italic" }}>
                  {r.label}
                </span>
                {active && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: r.color, letterSpacing:"0.1em" }}>SELECTED</span>}
              </button>
            );
          })}
        </div>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={() => setPhase(
              connections.length > 0 ? "diners"
              : leftoverChoice === "yes" ? "leftoverLocation"
              : "leftovers"
            )}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button
            onClick={() => setPhase(SHOW_NUTRITION_DEBUG ? "nutritionDebug" : "notes")}
            disabled={!rating}
            style={{ flex:2, padding:"14px", background: rating?"#f5c842":"#1a1a1a", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color: rating?"#111":"#444", cursor: rating?"pointer":"not-allowed", letterSpacing:"0.08em" }}>
            CONTINUE →
          </button>
        </div>
      </div>
    );
  }

  // ── DEBUG phase: per-ingredient calorie breakdown ────────────────────────
  // Temporary diagnostic screen. Surfaces exactly how the resolver chain
  // scored each recipe ingredient so we can see why cook_logs.nutrition
  // keeps coming back as null on the dashboard. Safe to remove once the
  // pipeline is trusted — just delete this block, drop the two
  // setPhase("nutritionDebug") callers above, and remove the
  // recipeNutritionBreakdown import.
  if (phase === "nutritionDebug") {
    const bd = recipeNutritionBreakdown(recipe, { pantry, brandNutrition, getInfo: ingredientInfo?.getInfo });
    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px", overflowY:"auto" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#ef4444", letterSpacing:"0.15em", marginBottom:8 }}>
          DEBUG · CALORIE BREAKDOWN
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:26, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:4 }}>
          Where did the calories come from?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666", marginBottom:16 }}>
          Per-ingredient resolver trace. Rows without a macro contribution show why.
        </p>

        <div style={{ padding:"10px 12px", background:"#0f0f0f", border:"1px solid #2a2a2a", borderRadius:10, marginBottom:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#bbb" }}>
          <div>TOTAL: {Math.round(bd.total.kcal)} kcal · {Math.round(bd.total.protein_g)}p · {Math.round(bd.total.carb_g)}c · {Math.round(bd.total.fat_g)}f</div>
          <div style={{ marginTop:2 }}>PER SERVING (÷ {bd.serves}): {Math.round(bd.perServing.kcal)} kcal</div>
          <div style={{ marginTop:2, color:"#888" }}>
            COVERAGE: {bd.coverage.resolved} / {bd.coverage.total} ingredients
            {bd.coverage.resolved === 0 && <span style={{ color:"#ef4444" }}> · NOTHING RESOLVED — dashboard will skip this cook</span>}
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
          {bd.items.length === 0 && (
            <div style={{ padding:"12px", background:"#1a0a0a", border:"1px solid #3a1a1a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f87171" }}>
              Recipe has no ingredients array.
            </div>
          )}
          {bd.items.map((row, i) => {
            const ok = row.kcal > 0;
            return (
              <div key={i} style={{
                padding:"10px 12px",
                background: ok ? "#0f1a0f" : "#1a0f0f",
                border: `1px solid ${ok ? "#1e3a1e" : "#3a1a1a"}`,
                borderRadius:8,
                fontFamily:"'DM Mono',monospace", fontSize:11, color:"#ccc",
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:4 }}>
                  <span style={{ color:"#f0ece4", fontWeight:600 }}>{row.name}</span>
                  <span style={{ color: ok ? "#4ade80" : "#f87171" }}>
                    {ok ? `+${Math.round(row.kcal)} kcal` : "— kcal"}
                  </span>
                </div>
                <div style={{ color:"#888", fontSize:10, lineHeight:1.5 }}>
                  <div>canonical: {row.canonicalId || "(none)"}{row.canonical ? ` → ${row.canonical}` : ""}</div>
                  <div>amount: {row.amount || "(none)"} {row.parsedQty ? `→ ${row.parsedQty.amount} ${row.parsedQty.unit}` : ""}</div>
                  <div>nutrition source: {row.source || "(none)"}{row.brand ? ` · brand=${row.brand}` : ""}{row.nutrition?.per ? ` · per=${row.nutrition.per}` : ""}</div>
                  {row.parsedQty?.unit === "count" && (
                    <div>grams/count: {Number.isFinite(row.countWeightG) && row.countWeightG > 0 ? `${Math.round(row.countWeightG)}g` : "(unset)"}</div>
                  )}
                  <div>factor: {row.factor == null ? "null" : row.factor.toFixed(3)}</div>
                  {row.reason && (
                    <div style={{ color:"#f87171", marginTop:2 }}>× {row.reason}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display:"flex", gap:10, marginTop:"auto" }}>
          <button onClick={() => setPhase("rating")}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button onClick={() => setPhase("notes")}
            style={{ flex:2, padding:"14px", background:"#f5c842", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color:"#111", cursor:"pointer", letterSpacing:"0.08em" }}>
            CONTINUE →
          </button>
        </div>
      </div>
    );
  }

  // ── phase 4: notes + save ────────────────────────────────────────────────
  if (phase === "notes") {
    const ratingDef = RATINGS.find(r => r.id === rating);
    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          {(() => { const { num, denom } = stepOf("notes"); return `STEP ${num} OF ${denom}`; })()}
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          Any notes?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:20 }}>
          What'd you tweak? What'd you learn? Future-you will thank you.
        </p>

        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={rating === "nailed" ? "e.g. The lime rest time made all the difference..." : rating === "rough" ? "e.g. Pan wasn't hot enough. Next time crank it earlier." : "Anything you'd remember for next time..."}
          rows={6}
          style={{ width:"100%", padding:"14px 16px", background:"#141414", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#f0ece4", outline:"none", resize:"none", boxSizing:"border-box", marginBottom:14 }}
        />

        {/* Servings-per-eater stepper. Drives cook_logs.servings_per_eater
            (migration 0068) which the NutritionDashboard tally multiplies
            against the stamped per-serving macros. Default 1 = one
            serving each; 0.5 for "family of four split a two-serving
            recipe"; 2 or 3 for "went back for seconds / solo chef
            finished the pan". Only rendered when the row will actually
            have nutrition to scale — no point asking for a portion
            multiplier on an untracked recipe. */}
        {(() => {
          const nPreview = recipeNutrition
            ? recipeNutrition(recipe, { pantry, brandNutrition, getInfo: ingredientInfo?.getInfo })
            : null;
          if (!nPreview || nPreview.coverage.resolved === 0) return null;
          // 0 = "saved it all" — the cook_log still records the event
          // but contributes nothing to the macro tally. Later
          // consumption through the "I ATE THIS" flow on the leftover
          // pantry row adds macros at actual eat-time. Perfect fit for
          // batch recipes (cookies, biscuits) where the cook was a
          // production event, not a meal.
          const options = [0, 0.5, 1, 1.5, 2, 3];
          const labelFor = (v) => {
            if (v === 0)   return "0";
            if (v === 1)   return "1";
            if (v === 0.5) return "½";
            if (v === 1.5) return "1½";
            return String(v);
          };
          return (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", letterSpacing: "0.12em", marginBottom: 8 }}>
                HOW MANY SERVINGS DID EACH PERSON EAT?
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {options.map(v => {
                  const active = Math.abs(servingsPerEater - v) < 0.01;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setServingsPerEater(v)}
                      style={{
                        flex: 1, padding: "10px 0",
                        background: active ? "#f5c842" : "#141414",
                        border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                        color: active ? "#111" : "#bbb",
                        borderRadius: 10,
                        fontFamily: "'DM Mono',monospace", fontSize: 12,
                        fontWeight: active ? 700 : 400,
                        cursor: "pointer", letterSpacing: "0.06em",
                      }}
                    >
                      {labelFor(v)}
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: 6, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.06em" }}>
                {servingsPerEater === 0
                  ? "SAVED IT ALL — LOG BITES LATER VIA \"I ATE THIS\""
                  : `~ ${Math.round((nPreview.perServing.kcal || 0) * servingsPerEater)} kcal PER EATER`}
              </div>
            </div>
          );
        })()}

        {/* Summary row — a visual confirm of what we're saving */}
        <div style={{ padding:"12px 14px", background:"#0f0f0f", border:`1px solid ${ratingDef?.border || "#1e1e1e"}`, borderRadius:12, display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
          <span style={{ fontSize:26 }}>{ratingDef?.emoji}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color: ratingDef?.color || "#ccc" }}>
              {ratingDef?.label}
            </div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", marginTop:2 }}>
              {selectedDiners.size > 0
                ? `with ${selectedDiners.size} ${selectedDiners.size === 1 ? "person" : "people"}`
                : "ate alone"}
              {" · "}
              +{xp} XP
            </div>
          </div>
          {(rating === "good" || rating === "nailed") && (
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", background:"#1a1608", border:"1px solid #3a2f10", borderRadius:4, padding:"2px 6px", letterSpacing:"0.1em" }}>
              ★ FAVORITE
            </span>
          )}
        </div>

        {error && (
          <div style={{ marginBottom:12, padding:"10px 12px", background:"#1a0f0f", border:"1px solid #3a1a1a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#f87171" }}>
            {error}
          </div>
        )}

        <div style={{ display:"flex", gap:10, marginTop:"auto" }}>
          <button onClick={() => setPhase(SHOW_NUTRITION_DEBUG ? "nutritionDebug" : "rating")} disabled={saving}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor: saving?"not-allowed":"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button
            onClick={save}
            disabled={saving}
            className={saving ? "" : "mise-cta"}
            style={{ flex:2, padding:"14px", background: saving?"#1a1a1a":"#f5c842", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color: saving?"#444":"#111", cursor: saving?"not-allowed":"pointer", letterSpacing:"0.08em" }}>
            {saving ? "SAVING..." : "SAVE TO COOKBOOK →"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
