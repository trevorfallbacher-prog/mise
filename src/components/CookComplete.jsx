import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { findIngredient, unitLabel } from "../data/ingredients";
import { convert, decrementRow, formatQty } from "../lib/unitConvert";
import { setComponentsForParent, leftoverCompositionFromPlan } from "../lib/pantryComponents";

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
export function buildInitialUsedItems(recipe, pantry) {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const list = Array.isArray(pantry) ? pantry : [];
  return ingredients.map((ing, idx) => {
    const canonical = ing.ingredientId ? findIngredient(ing.ingredientId) : null;
    const matches = ing.ingredientId
      ? list.filter(p =>
          p.ingredientId === ing.ingredientId &&
          (p.kind || "ingredient") === "ingredient" &&
          Number(p.amount) > 0
        )
      : [];
    const defaultMatch = matches[0] || null;
    return {
      idx,
      recipeIng: ing,
      canonical,
      matches,
      skipped: false,
      selectedRowId: defaultMatch?.id || null,
      usedAmount: ing.qty?.amount ?? null,
      usedUnit:   ing.qty?.unit   ?? (defaultMatch?.unit ?? null),
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
  const out = [];
  for (const row of usedItems) {
    if (row.skipped || !row.selectedRowId) continue;
    if (row.usedAmount == null || !Number.isFinite(Number(row.usedAmount))) continue;
    if (!row.usedUnit) continue;
    const pantryRow = lookup(row.selectedRowId);
    if (!pantryRow) continue;
    const used = { amount: Number(row.usedAmount), unit: row.usedUnit };
    const newAmount = row.canonical ? decrementRow(pantryRow, used, row.canonical) : null;
    out.push({
      pantryRowId: pantryRow.id,
      pantryRow,
      ingredient: row.canonical,
      used,
      newAmount,
      convertible: newAmount != null,
      source: "recipe",
      displayName: row.canonical?.name || row.recipeIng.item || "Ingredient",
      displayEmoji: row.canonical?.emoji || row.recipeIng.emoji || "🥣",
    });
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

export default function CookComplete({ recipe, userId, family = [], friends = [], pantry = [], setPantry, onFinish }) {
  const [phase, setPhase] = useState("celebrate");
  const [selectedDiners, setSelectedDiners] = useState(() => new Set());
  const [rating, setRating] = useState(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // usedItems captures the user's "what did I actually use" decisions across
  // the ingredients-used → confirm-removal → save sequence. Seeded once from
  // the initial pantry snapshot; realtime pantry changes during the flow are
  // intentionally ignored so the user's edits don't flip out from under them.
  const [usedItems, setUsedItems] = useState(() => buildInitialUsedItems(recipe, pantry));
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
          if (entry.newAmount <= 0) {
            byId.delete(row.id);
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
    onFinish?.({ saved: true, rating });
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
        </div>
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
            const emoji = ing?.emoji || row.recipeIng.emoji || "🥣";
            const displayName = ing?.name || row.recipeIng.item || "Ingredient";
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
                {canEditAmount && !row.skipped ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:6, alignItems:"flex-end", flexShrink:0, minWidth:160 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <input
                        type="number" min="0" step="any"
                        value={row.usedAmount ?? ""}
                        onChange={e => setRow(row.idx, { usedAmount: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ width:56, padding:"6px 8px", background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:13, color:"#f0ece4", textAlign:"right", outline:"none" }}
                      />
                      <select
                        value={row.usedUnit || ""}
                        onChange={e => setRow(row.idx, { usedUnit: e.target.value })}
                        style={{ padding:"6px 4px", background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#ccc", outline:"none" }}
                      >
                        {unitOptions.map(u => (
                          <option key={u.id} value={u.id}>{unitLabel(ing, u.id)}</option>
                        ))}
                      </select>
                    </div>
                    {/* Estimate slider — drag to set how much of THIS
                        ingredient you used. Range 0..source's current
                        amount (or 0..1 if the recipe-hinted amount
                        can't be converted; the caller then commits the
                        amount directly). Nobody's weighing half a bag
                        of chips; slide to what looks right. Live write
                        to usedAmount so the confirm-removal screen's
                        \"LEAVES x\" readout updates as you drag. */}
                    {match && Number(match.amount) > 0 && (() => {
                      const maxVal = Number(match.amount);
                      const step = maxVal <= 10 ? 0.1 : maxVal <= 100 ? 1 : maxVal / 100;
                      return (
                        <input
                          type="range"
                          min="0" max={maxVal} step={step}
                          value={Number.isFinite(Number(row.usedAmount)) ? Math.min(Number(row.usedAmount), maxVal) : 0}
                          onChange={e => setRow(row.idx, { usedAmount: Number(e.target.value), usedUnit: row.usedUnit || match.unit })}
                          aria-label={`Estimate ${displayName} used`}
                          style={{ width:"100%", accentColor:"#f5c842" }}
                        />
                      );
                    })()}
                  </div>
                ) : null}
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
                <div style={{
                  width:44, height:44, borderRadius:"50%",
                  background: selected ? "#f5c842" : "#222",
                  color: selected ? "#111" : "#aaa",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:500,
                }}>
                  {c.initial}
                </div>
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
            onClick={() => setPhase("notes")}
            disabled={!rating}
            style={{ flex:2, padding:"14px", background: rating?"#f5c842":"#1a1a1a", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color: rating?"#111":"#444", cursor: rating?"pointer":"not-allowed", letterSpacing:"0.08em" }}>
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
          <button onClick={() => setPhase("rating")} disabled={saving}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor: saving?"not-allowed":"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{ flex:2, padding:"14px", background: saving?"#1a1a1a":"#f5c842", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color: saving?"#444":"#111", cursor: saving?"not-allowed":"pointer", letterSpacing:"0.08em" }}>
            {saving ? "SAVING..." : "SAVE TO COOKBOOK →"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
