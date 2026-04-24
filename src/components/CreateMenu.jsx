import { useMemo, useState } from "react";
// CookMode is mounted at the App level (see App.jsx cookModeRecipe
// state). This overlay no longer renders it inline — cook requests
// are bubbled up via onStartCook, which lets the resume banner keep
// the session alive across tab changes.
import CustomRecipeBuilder from "./CustomRecipeBuilder";
import AIRecipe from "./AIRecipe";
import SchedulePicker from "./SchedulePicker";
import {
  RECIPES,
  totalTimeMin,
  difficultyLabel,
  findRecipe,
} from "../data/recipes";
import { inferCanonicalFromName, findIngredient } from "../data/ingredients";
import { useUserRecipes } from "../lib/useUserRecipes";
import { useMeals } from "../lib/useMeals";
import { useScheduledMeals } from "../lib/useScheduledMeals";
import { useIngredientInfo } from "../lib/useIngredientInfo";
import { useCookLog } from "../lib/useCookLog";
import { useToast } from "../lib/toast";
import { mealNutrition, formatMacros } from "../lib/nutrition";
import { useBrandNutrition } from "../lib/useBrandNutrition";

// CreateMenu — full-screen overlay launched by the center ➕ in the
// tab bar. Universal creation hub: launches either a COOK flow
// (custom / AI / template recipe → CookMode) or dispatches a PANTRY
// action (scan / manual add) back to the Kitchen tab via
// onRequestPantryAction.
//
// Drives a small state machine:
//   choose     → four big cards (CUSTOM / AI / TEMPLATE / ADD TO PANTRY)
//   custom     → multi-step recipe builder, saves to user_recipes
//   ai         → Claude-drafted recipe from the pantry
//   template   → browseable picker over YOUR RECIPES + AI DRAFTS + bundled
//   (scan / manual promoted to the main chooser; no sub-phase needed)
//   cook       → hands the resolved recipe to CookMode
// (orthogonal) scheduling → SchedulePicker overlaid on any mode
//
// Save / schedule / cook all persist through useUserRecipes.saveRecipe.
// Privacy rule: recipes are private by default; the schedule path flips
// shared=true since scheduled meals are family-visible.

export default function CreateMenu({
  userId, profile, familyKey,
  pantry, setPantry, shoppingList, setShoppingList, onGoToShopping,
  family = [], friends = [],
  onClose, onCooked,
  // New — signals the pantry-creation intent back up to App, which
  // routes to the pantry tab and flips Kitchen's Scanner or
  // AddItemModal open. Receiving null means the host didn't wire
  // the feature yet (backwards-compat during rollout).
  onRequestPantryAction,
  // Hands the chosen recipe up to App, which owns CookMode. The old
  // flow rendered CookMode inline inside this overlay — unmount on
  // close killed the resume-from-banner story. App now keeps one
  // CookMode alive across tab changes and uses the banner to surface
  // an in-flight cook to the user.
  onStartCook,
}) {
  // `cook` was once a valid mode here when CookMode rendered inline.
  // That's gone now — cook requests exit through onStartCook + onClose.
  const [mode, setMode] = useState("choose");        // choose | custom | ai | template
  // When set, the meal-detail overlay is shown (rendered on top of
  // the template picker) so the user can inspect pieces + cook one.
  const [viewingMeal, setViewingMeal] = useState(null);
  // When set, SchedulePicker renders on top of the current mode. The
  // recipe has already been persisted to user_recipes by the time we
  // enter this state — picking a day just writes the scheduled_meals row.
  const [scheduling, setScheduling] = useState(null); // recipe object | null

  const { recipes: userRecipes, saveRecipe, findBySlug: findUserRecipe } = useUserRecipes(userId);
  // MEAL composition hook — exposes hydrated meals + CRUD. Pieces
  // resolve through userRecipes and bundled RECIPES so tap-to-cook on
  // a meal's piece hands CookMode a full recipe object.
  const { meals, createMeal, deleteMeal } = useMeals(userId, {
    userRecipes,
    bundledRecipes: RECIPES,
  });
  const { schedule } = useScheduledMeals(userId, {
    recipeResolver: (slug) => findRecipe(slug, findUserRecipe),
  });
  const { push: pushToast } = useToast();
  // Ingredient enrichment is provided once at App level; reading it
  // here lets AIRecipe's context builder look up flavorProfile/pairs/
  // diet per pantry item without re-fetching.
  const ingredientInfo = useIngredientInfo();
  // Brand-nutrition lookup — wrapped in a Map-like shape for the
  // resolver in nutrition.js. Shared by the MealDetail totals card
  // and anywhere else in this overlay that renders macros.
  const { get: getBrandNutrition } = useBrandNutrition();
  const brandNutrition = useMemo(
    () => ({ get: (k) => getBrandNutrition?.(k) || null }),
    [getBrandNutrition],
  );
  // Cook logs feed the AI-context "recent history" summary. Lazily
  // loaded at the CreateMenu level so users who never open the overlay
  // don't pay for the subscription. Cookbook's own useCookLog call
  // dedupes via supabase channel naming, so a second subscriber here
  // costs roughly nothing.
  const { logs: cookLogs = [] } = useCookLog(userId, familyKey);

  const userName = profile?.name?.trim().split(/\s+/)[0] || null;
  const hasFamily = family.length > 0;

  // Template picker — search over both user recipes AND bundled. The
  // three sections (CUSTOM · AI · BUNDLED) stay visually distinct so
  // the user can tell what they're tapping even without reading the
  // header, but the search box filters all three together.
  const [query, setQuery] = useState("");

  // Split user recipes by source; already sorted newest-first by the hook.
  const userCustom = useMemo(
    () => userRecipes.filter(r => r.source === "custom" && r.userId === userId),
    [userRecipes, userId],
  );
  const userAI = useMemo(
    () => userRecipes.filter(r => r.source === "ai" && r.userId === userId),
    [userRecipes, userId],
  );

  const matches = (r, q) => {
    if (!q) return true;
    return (r.title || "").toLowerCase().includes(q) ||
           (r.cuisine || "").toLowerCase().includes(q) ||
           (r.category || "").toLowerCase().includes(q);
  };
  const filteredUserCustom = useMemo(() => {
    const q = query.trim().toLowerCase();
    return userCustom.filter(ur => matches(ur.recipe, q));
  }, [userCustom, query]);
  const filteredUserAI = useMemo(() => {
    const q = query.trim().toLowerCase();
    return userAI.filter(ur => matches(ur.recipe, q));
  }, [userAI, query]);
  const filteredBundled = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? RECIPES.filter(r => matches(r, q)) : RECIPES;
  }, [query]);
  // Meals are searched against the meal's own identity (name /
  // cuisine / mealTiming) plus each piece's title, so typing "ribeye"
  // surfaces a meal whose main is named Ribeye even if the meal was
  // renamed to something generic.
  const filteredMeals = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meals;
    return meals.filter(m => {
      if ((m.name || "").toLowerCase().includes(q)) return true;
      if ((m.cuisine || "").toLowerCase().includes(q)) return true;
      if ((m.mealTiming || "").toLowerCase().includes(q)) return true;
      return (m.pieces || []).some(p => (p.recipe?.title || "").toLowerCase().includes(q));
    });
  }, [meals, query]);

  // Hand the chosen recipe up to App and close the overlay. App
  // mounts CookMode at the top level so navigating tabs away from a
  // cook doesn't destroy the session — useActiveCookSession + the
  // CookBanner keep the in-flight cook visible and resumable.
  const startCooking = (recipe) => {
    onStartCook?.(recipe);
    onClose?.();
  };

  // Back from a nested mode should return to the chooser, not to the
  // parent — only "close" from the chooser itself actually closes.
  const backToChoose = () => {
    setMode("choose");
  };

  // Persist a builder/draft output, handling every callsite's error
  // expectations. `opts` carries { shared, submitForReview } from the
  // child's toggle state.
  const persist = async (recipe, source, opts = {}) => {
    try {
      return await saveRecipe(recipe, source, opts);
    } catch (e) {
      console.error(`[quickcook] ${source} save failed:`, e);
      pushToast("Couldn't save your recipe", { emoji: "⚠️", kind: "warn" });
      return null;
    }
  };

  // SAVE action — persist, toast, close the overlay. Used by both the
  // custom builder and the AI preview.
  const handleSave = (source) => async (recipe, opts = {}) => {
    const row = await persist(recipe, source, opts);
    if (!row) return;
    pushToast("Saved to your recipes", { emoji: "💾", kind: "info" });
    onClose?.();
  };

  // SCHEDULE action — persist with shared=true (scheduling is a family-
  // visible action), then open SchedulePicker on top of the current
  // mode. The picker writes the scheduled_meals row and closes.
  const handleSchedule = (source) => async (recipe, opts = {}) => {
    const row = await persist(recipe, source, { ...opts, shared: true });
    if (!row) return;
    // Use the stamped (db-slugged) recipe so scheduled_meals.recipe_slug
    // resolves via the user-recipe fallback in findRecipe.
    setScheduling(row.recipe);
  };

  // COOK IT — save then cook. Two rules learned the hard way:
  //
  //   1. Bail when the save fails. Before, the cook proceeded even if
  //      persist() returned null (unique-slug collision, RLS denial,
  //      network blip) — the user would cook something that never
  //      landed in their library, then wonder "where did my recipe go."
  //      Now we stop, re-toast, and let the user retry. The pushToast
  //      inside persist() already surfaced the original error; this
  //      extra nudge explains why cook didn't happen.
  //
  //   2. Mirror handleSchedule and stamp shared=true. Cooking an AI
  //      recipe means the rest of the family sees the cook_log and
  //      any scheduled_meals row in realtime. Without shared=true,
  //      the user_recipes row is private, the family view resolves
  //      null, and the meal detail drawer renders a "locked recipe"
  //      state. Cooking is a family-visible action; the recipe that
  //      was cooked should be too.
  const handleSaveAndCook = (source) => async (recipe, opts = {}) => {
    const row = await persist(recipe, source, { ...opts, shared: true });
    if (!row) {
      pushToast("Save failed — couldn't start cook", { emoji: "⚠️", kind: "warn" });
      return;
    }
    // Use the stamped (DB-slugged) recipe so subsequent lookups via
    // findRecipe hit the exact row we just wrote. Pre-save slug may
    // have collided and been suffixed "-2" — the raw `recipe` arg
    // still has the old slug.
    startCooking(row.recipe || recipe);
  };

  // Silent save — persist without toasting or closing. Used by the
  // compose-a-meal flow in AIRecipe: when the user clicks "+ Add
  // Side" from the main's preview, we persist the main first (so it's
  // a real user_recipes row) before re-entering setup for the side.
  // Returns the stamped recipe (with db-assigned slug) so the caller
  // can pin it into mealInProgress by its saved identity.
  const handleSilentSave = (source) => async (recipe, opts = {}) => {
    const row = await persist(recipe, source, opts);
    return row?.recipe || null;
  };

  // CookMode is mounted at the App level now (see App.jsx
  // cookModeRecipe state). The old inline-CookMode block that lived
  // here was removed when we pinned a resume banner to the top of
  // the app — keeping the cook alive across navigation means CookMode
  // cannot be tied to the CreateMenu overlay's lifetime.

  if (mode === "custom") {
    return (
      <div style={OVERLAY_STYLE}>
        <CustomRecipeBuilder
          pantry={pantry}
          onCancel={backToChoose}
          onSave={handleSave("custom")}
          onSchedule={handleSchedule("custom")}
          onSaveAndCook={handleSaveAndCook("custom")}
        />
        {scheduling && (
          <SchedulePicker
            recipe={scheduling}
            userId={userId}
            userName={userName}
            family={family}
            defaultRequest={hasFamily}
            onClose={() => setScheduling(null)}
            onSave={async ({ scheduledFor, notificationSettings, note, cookId, isRequest, servings }) => {
              await schedule({
                recipeSlug: scheduling.slug,
                scheduledFor,
                notificationSettings,
                note,
                cookId,
                isRequest,
                servings,
              });
              setScheduling(null);
              pushToast("Scheduled — see the calendar tab", { emoji: "📅", kind: "info" });
              onClose?.();
            }}
          />
        )}
      </div>
    );
  }

  if (mode === "ai") {
    return (
      <div style={OVERLAY_STYLE}>
        <AIRecipe
          pantry={pantry}
          profile={profile}
          cookLogs={cookLogs}
          ingredientInfo={ingredientInfo}
          userRecipes={userRecipes}
          bundledRecipes={RECIPES}
          onCancel={backToChoose}
          onSave={handleSave("ai")}
          onSilentSave={handleSilentSave("ai")}
          onSchedule={handleSchedule("ai")}
          onSaveAndCook={handleSaveAndCook("ai")}
          onMealSave={async (payload) => {
            try {
              await createMeal(payload);
              pushToast("Meal saved", { emoji: "🍽️", kind: "info" });
            } catch (e) {
              console.error("[createMenu] createMeal failed:", e);
              pushToast("Couldn't save meal", { emoji: "⚠️", kind: "warn" });
            }
          }}
          onShoppingAdd={(items) => {
            // Items come in as { name, amount, unit, ingredientId,
            // source: "ai-recipe" }. Merge into shoppingList with
            // fresh uuids so useSyncedList persists them.
            //
            // Canonical backfill: AIRecipe forwards `ingredientId`
            // only when Claude stamped it on the recipe ingredient.
            // Claude leaves it null for "staples it assumed" and any
            // newly-introduced ingredient (generate-recipe/index.ts
            // :447). Before we push to the list, run a substring
            // lookup against the bundled registry so a match like
            // "ricotta cheese" → ricotta lands with the canonical
            // stamped — enabling the +30 receipt-scan bias tier
            // instead of the weaker +20 free-text tier.
            if (!items || items.length === 0) return;
            setShoppingList(prev => [
              ...prev,
              ...items.map(i => {
                const resolvedId = i.ingredientId
                  || inferCanonicalFromName(i.name)
                  || null;
                const canonical = findIngredient(resolvedId);
                return {
                  id: (typeof crypto !== "undefined" && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  name: canonical?.name || i.name,
                  emoji: canonical?.emoji || "🥫",
                  amount: i.amount,
                  unit: i.unit,
                  ingredientId: resolvedId,
                  category: canonical?.category || "pantry",
                  source: "ai-recipe",
                };
              }),
            ]);
          }}
        />
        {scheduling && (
          <SchedulePicker
            recipe={scheduling}
            userId={userId}
            userName={userName}
            family={family}
            defaultRequest={hasFamily}
            onClose={() => setScheduling(null)}
            onSave={async ({ scheduledFor, notificationSettings, note, cookId, isRequest, servings }) => {
              await schedule({
                recipeSlug: scheduling.slug,
                scheduledFor,
                notificationSettings,
                note,
                cookId,
                isRequest,
                servings,
              });
              setScheduling(null);
              pushToast("Scheduled — see the calendar tab", { emoji: "📅", kind: "info" });
              onClose?.();
            }}
          />
        )}
      </div>
    );
  }

  // The addIntent sub-phase was deleted — scan + manual are now top-
  // level cards on the main chooser (one tap, not two). onRequestPantryAction
  // is still the dispatch path; the chooser cards call it directly.

  if (mode === "template") {
    const totalResults =
      filteredMeals.length + filteredUserCustom.length + filteredUserAI.length + filteredBundled.length;
    return (
      <div style={OVERLAY_STYLE}>
        <div style={{ padding: "24px 20px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #1e1e1e" }}>
          <button onClick={backToChoose} style={iconBtn}>←</button>
          <div style={{ flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
            PICK A RECIPE
          </div>
          <button onClick={onClose} style={iconBtn}>✕</button>
        </div>
        <div style={{ padding: "14px 20px 0" }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search your recipes and the library…"
            style={{
              width: "100%", padding: "12px 14px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              borderRadius: 10, color: "#f0ece4", boxSizing: "border-box",
              fontFamily: "'DM Sans',sans-serif", fontSize: 14, outline: "none",
            }}
          />
        </div>
        <div style={{ padding: "14px 20px 100px" }}>
          {filteredMeals.length > 0 && (
            <RecipeSection title="YOUR MEALS" accent={TAG_MEAL}>
              {filteredMeals.map(m => (
                <MealRow
                  key={m.id}
                  meal={m}
                  onClick={() => setViewingMeal(m)}
                />
              ))}
            </RecipeSection>
          )}
          {filteredUserCustom.length > 0 && (
            <RecipeSection title="YOUR RECIPES" accent={TAG_CUSTOM}>
              {filteredUserCustom.map(ur => (
                <RecipeRow
                  key={ur.id}
                  recipe={ur.recipe}
                  tag="CUSTOM"
                  tagColor={TAG_CUSTOM}
                  onClick={() => startCooking(ur.recipe)}
                />
              ))}
            </RecipeSection>
          )}
          {filteredUserAI.length > 0 && (
            <RecipeSection title="AI DRAFTS" accent={TAG_AI}>
              {filteredUserAI.map(ur => (
                <RecipeRow
                  key={ur.id}
                  recipe={ur.recipe}
                  tag="AI"
                  tagColor={TAG_AI}
                  onClick={() => startCooking(ur.recipe)}
                />
              ))}
            </RecipeSection>
          )}
          {filteredBundled.length > 0 && (
            <RecipeSection title="BUNDLED TEMPLATES" accent="#7eb8d4">
              {filteredBundled.map(r => (
                <RecipeRow
                  key={r.slug}
                  recipe={r}
                  tag={null}
                  onClick={() => startCooking(r)}
                />
              ))}
            </RecipeSection>
          )}
          {totalResults === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "#555", fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
              {query ? `No recipes match "${query}"` : "No recipes yet."}
            </div>
          )}
        </div>
        {viewingMeal && (
          <MealDetail
            meal={viewingMeal}
            pantry={pantry}
            ingredientInfo={ingredientInfo}
            brandNutrition={brandNutrition}
            onClose={() => setViewingMeal(null)}
            onCookPiece={(pieceRecipe) => {
              // Tap a piece inside the meal detail to cook just that
              // piece. Phase 3 doesn't sequence multiple pieces — each
              // component cooks individually. "Cook whole meal" is a
              // future ticket (CookMode needs a multi-recipe mode).
              setViewingMeal(null);
              startCooking(pieceRecipe);
            }}
            onDelete={async () => {
              try {
                await deleteMeal(viewingMeal.id);
                setViewingMeal(null);
                pushToast("Meal removed (recipes kept)", { emoji: "🗑️", kind: "info" });
              } catch (e) {
                console.error("[createMenu] deleteMeal failed:", e);
                pushToast("Couldn't remove meal", { emoji: "⚠️", kind: "warn" });
              }
            }}
          />
        )}
      </div>
    );
  }

  // Default — the chooser. Cards grouped into QUICK COOK (AI draft,
  // library, custom builder) and QUICK KITCHEN ADD (scan, manual).
  // Order within QUICK COOK: AI first (the new / featured path —
  // user directive), pick-a-recipe second (library when you know
  // what you want), custom last (authoring from scratch). Scan is
  // top of the add group since it's faster for packaged goods;
  // manual is the fallback. No sub-phases — every card is one tap
  // from the chooser to the action.
  return (
    <div style={OVERLAY_STYLE}>
      <div style={{ padding: "24px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
          CREATE
        </div>
        <button onClick={onClose} style={iconBtn}>✕</button>
      </div>
      <div style={{ padding: "12px 20px 0" }}>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 34, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", letterSpacing: "-0.02em", margin: 0 }}>
          What do you want to make?
        </h1>
        <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.5 }}>
          Cook something from your pantry or add new items to it.
        </div>
      </div>

      <div style={{ padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionDivider label="QUICK COOK" />

        <BigCard
          emoji="✨"
          accent="#c7a8d4"
          title="AI recipe from pantry"
          blurb="Claude drafts a recipe using what's on your shelves. Tweak it, then cook."
          onClick={() => setMode("ai")}
        />
        <BigCard
          emoji="📖"
          accent="#7eb8d4"
          title="Pick a recipe or meal"
          blurb={`${meals.length > 0 ? `${meals.length} meal${meals.length === 1 ? "" : "s"} · ` : ""}${
            userCustom.length + userAI.length > 0
              ? `${userCustom.length + userAI.length} recipes · `
              : ""
          }${RECIPES.length} bundled templates.`}
          onClick={() => setMode("template")}
        />
        <BigCard
          emoji="✏️"
          accent="#f5c842"
          title="Custom recipe"
          blurb="Write your own — ingredients, steps, photos. Save it so you can cook it again."
          onClick={() => setMode("custom")}
        />

        <SectionDivider label="QUICK KITCHEN ADD" />

        {/* Scan + manual promoted out of the addIntent sub-phase so
            pantry adds are one tap from the create menu instead of
            two. Scan on top — it's faster for packaged goods
            (receipt, shelf, or the single-item barcode mode inside
            Scanner all feed into the same confirm flow). Manual
            below for the cases where a photo would be overkill. */}
        <BigCard
          emoji="🧾"
          accent="#7eb8d4"
          title="Scan something"
          blurb="Receipt, fridge, pantry, or a single barcode — snap a photo, we read it."
          onClick={() => {
            if (onRequestPantryAction) onRequestPantryAction("scan");
            else onClose?.();
          }}
        />
        <BigCard
          emoji="➕"
          accent="#4ade80"
          title="Add manually"
          blurb="Type one item — name, amount, category, where it lives."
          onClick={() => {
            if (onRequestPantryAction) onRequestPantryAction("add");
            else onClose?.();
          }}
        />
      </div>
    </div>
  );
}

function SectionDivider({ label }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      marginTop: 6, marginBottom: 0,
    }}>
      <div style={{ flex: 1, height: 1, background: "#2a2a2a" }} />
      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 9,
        color: "#666", letterSpacing: "0.14em",
      }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 1, background: "#2a2a2a" }} />
    </div>
  );
}

function BigCard({ emoji, accent, title, blurb, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", padding: "18px 18px", textAlign: "left",
        background: "linear-gradient(135deg, #1a1a1a 0%, #141414 100%)",
        border: `1px solid ${accent}55`,
        borderRadius: 16, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 14,
        transition: "all 0.2s",
      }}
    >
      <div style={{ fontSize: 36, flexShrink: 0 }}>{emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, color: "#f0ece4", fontWeight: 400, fontStyle: "italic" }}>
          {title}
        </div>
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", marginTop: 3, lineHeight: 1.5 }}>
          {blurb}
        </div>
      </div>
      <span style={{ color: accent, fontFamily: "'DM Mono',monospace", fontSize: 16 }}>→</span>
    </button>
  );
}

// Section wrapper used by the PICK A RECIPE list to visually separate
// YOUR RECIPES / AI DRAFTS / BUNDLED TEMPLATES. Hidden automatically by
// the caller when the section would be empty.
function RecipeSection({ title, accent, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 10,
        color: accent, letterSpacing: "0.12em", marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function RecipeRow({ recipe, tag, tagColor, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px", background: "#161616",
        border: "1px solid #2a2a2a", borderRadius: 12,
        cursor: "pointer", textAlign: "left",
      }}
    >
      <div style={{ fontSize: 26, flexShrink: 0 }}>{recipe.emoji || "🍽️"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            fontFamily: "'Fraunces',serif", fontSize: 15, color: "#f0ece4",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, minWidth: 0,
          }}>
            {recipe.title}
          </div>
          {tag && (
            <span style={{
              fontFamily: "'DM Mono',monospace", fontSize: 8, fontWeight: 700,
              color: tagColor, background: `${tagColor}15`,
              border: `1px solid ${tagColor}55`,
              padding: "2px 6px", borderRadius: 6,
              letterSpacing: "0.1em", flexShrink: 0,
            }}>
              {tag}
            </span>
          )}
        </div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.05em", marginTop: 2 }}>
          {(recipe.cuisine || "").toUpperCase()} · {totalTimeMin(recipe)} MIN · {difficultyLabel(recipe.difficulty).toUpperCase()}
        </div>
        {(recipe.course || recipe.mealTiming) && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
            {recipe.course     && <MetaPill label={recipe.course} />}
            {recipe.mealTiming && <MetaPill label={recipe.mealTiming} />}
          </div>
        )}
      </div>
      <span style={{ color: "#f5c842", fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
    </button>
  );
}

// Mirror of AIRecipe.MetaPill. Neutral styling keeps clear of the
// reserved color axes in CLAUDE.md while still reading as metadata.
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

// Tag colors per CLAUDE.md palette. CUSTOM uses the canonical-identity
// tan (user-authored identity); AI uses the state-axis purple (mirrors
// the AI-recipe card accent); MEAL uses a soft cream-white since
// "meal" is a higher-order concept (a bundle) and none of the reserved
// axis colors fit — green was the obvious third but it's reserved for
// the pantry accent elsewhere in the app.
const TAG_CUSTOM = "#b8a878";
const TAG_AI     = "#c7a8d4";
const TAG_MEAL   = "#e0d4b8";

// Row for a composed MEAL in the PICK A RECIPE list. Visually heavier
// than a single-recipe row so the user sees at a glance this is a
// bundle, not a recipe. Shows piece count + per-piece emoji stack.
function MealRow({ meal, onClick }) {
  const pieceEmojis = (meal.pieces || [])
    .slice(0, 4)
    .map(p => p.recipe?.emoji || "🍽️");
  const pieceCount = (meal.pieces || []).length;
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px",
        background: "linear-gradient(135deg, #1a1815 0%, #151310 100%)",
        border: `1px solid ${TAG_MEAL}33`,
        borderRadius: 12, cursor: "pointer", textAlign: "left",
      }}
    >
      <div style={{ fontSize: 26, flexShrink: 0 }}>{meal.emoji || "🍽️"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            fontFamily: "'Fraunces',serif", fontSize: 15, color: "#f0ece4",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, minWidth: 0,
          }}>
            {meal.name}
          </div>
          <span style={{
            fontFamily: "'DM Mono',monospace", fontSize: 8, fontWeight: 700,
            color: TAG_MEAL, background: `${TAG_MEAL}15`,
            border: `1px solid ${TAG_MEAL}55`,
            padding: "2px 6px", borderRadius: 6,
            letterSpacing: "0.1em", flexShrink: 0,
          }}>
            MEAL
          </span>
        </div>
        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555",
          letterSpacing: "0.05em", marginTop: 2,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>{pieceCount} PIECE{pieceCount === 1 ? "" : "S"}</span>
          {meal.cuisine && <span>· {meal.cuisine.toUpperCase()}</span>}
          {meal.mealTiming && <span>· {meal.mealTiming.toUpperCase()}</span>}
          <span style={{ marginLeft: "auto", fontSize: 13, letterSpacing: 0 }}>
            {pieceEmojis.join(" ")}
          </span>
        </div>
      </div>
      <span style={{ color: TAG_MEAL, fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
    </button>
  );
}

// Full-screen overlay showing a meal's pieces. Each piece is a
// tappable row that fires onCookPiece(pieceRecipe) — Phase 3 cooks
// individual pieces via the existing CookMode; a future "cook whole
// meal" mode would sequence the pieces. Includes a delete action
// that cascades only to meal_recipes (pieces stay in the library).
function MealDetail({ meal, pantry = [], ingredientInfo, brandNutrition, onClose, onCookPiece, onDelete }) {
  const pieceCount = (meal.pieces || []).length;
  // Sum of per-serving macros across each piece. Hidden when no piece
  // resolves (coverage.ingredients.resolved === 0) so we don't render
  // a misleading zero card on a meal where no nutrition data exists.
  const macros = useMemo(
    () => mealNutrition(meal, { pantry, getInfo: ingredientInfo?.getInfo, brandNutrition }),
    [meal, pantry, ingredientInfo, brandNutrition],
  );
  const showMacros = macros && macros.coverage.ingredients.resolved > 0;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 220,
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
          color: TAG_MEAL, letterSpacing: "0.12em",
        }}>
          MEAL DETAIL
        </div>
        <button onClick={onClose} style={iconBtn}>✕</button>
      </div>
      <div style={{ padding: "20px 20px 0", textAlign: "center" }}>
        <div style={{ fontSize: 46 }}>{meal.emoji || "🍽️"}</div>
        <h1 style={{
          fontFamily: "'Fraunces',serif", fontSize: 24, fontWeight: 300,
          fontStyle: "italic", color: "#f0ece4", margin: "8px 0 2px",
        }}>
          {meal.name}
        </h1>
        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555",
          letterSpacing: "0.1em",
        }}>
          {pieceCount} PIECE{pieceCount === 1 ? "" : "S"}
          {meal.cuisine && ` · ${meal.cuisine.toUpperCase()}`}
          {meal.mealTiming && ` · ${meal.mealTiming.toUpperCase()}`}
        </div>
        {/* Meal-level macros — sum of per-serving across pieces. One
            eater's share of the whole meal. Coverage string is honest
            when not every ingredient resolved. */}
        {showMacros && (
          <div style={{
            marginTop: 14, padding: "10px 14px",
            background: "#141414", border: "1px solid #242424",
            borderRadius: 10,
          }}>
            <div style={{
              fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4",
            }}>
              ~ {formatMacros(macros.total, { verbose: true })}
            </div>
            <div style={{
              marginTop: 3,
              fontFamily: "'DM Mono',monospace", fontSize: 9,
              color: "#666", letterSpacing: "0.08em",
            }}>
              PER EATER
              {macros.coverage.ingredients.resolved < macros.coverage.ingredients.total
                ? ` · BASED ON ${macros.coverage.ingredients.resolved} OF ${macros.coverage.ingredients.total} INGREDIENTS`
                : ""}
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: "20px 20px 100px" }}>
        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: TAG_MEAL, letterSpacing: "0.12em",
          marginBottom: 8,
        }}>
          PIECES
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(meal.pieces || []).map((p, i) => {
            const r = p.recipe;
            const missing = !r;
            return (
              <button
                key={`${p.recipeSlug}-${i}`}
                onClick={() => !missing && onCookPiece(r)}
                disabled={missing}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px",
                  background: missing ? "#1a1515" : "#161616",
                  border: `1px solid ${missing ? "#3a2020" : "#2a2a2a"}`,
                  borderRadius: 12,
                  cursor: missing ? "not-allowed" : "pointer",
                  textAlign: "left",
                  opacity: missing ? 0.65 : 1,
                }}
              >
                <div style={{ fontSize: 24, flexShrink: 0 }}>
                  {r?.emoji || "🍽️"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      fontFamily: "'Fraunces',serif", fontSize: 14, color: "#f0ece4",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      flex: 1, minWidth: 0,
                    }}>
                      {r?.title || `(missing: ${p.recipeSlug})`}
                    </div>
                    <span style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 8, fontWeight: 700,
                      color: "#aaa", background: "#1a1a1a",
                      border: "1px solid #2a2a2a",
                      padding: "2px 6px", borderRadius: 6,
                      letterSpacing: "0.1em", textTransform: "uppercase",
                      flexShrink: 0,
                    }}>
                      {p.course}
                    </span>
                  </div>
                  {r && (
                    <div style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555",
                      letterSpacing: "0.05em", marginTop: 2,
                    }}>
                      {(r.cuisine || "").toUpperCase()} · {totalTimeMin(r)} MIN
                    </div>
                  )}
                </div>
                {!missing && (
                  <span style={{ color: "#f5c842", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>
                    COOK →
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={onDelete}
          style={{
            marginTop: 24, width: "100%", padding: "12px",
            background: "transparent", border: "1px solid #3a2020",
            color: "#a06060", borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 600,
            letterSpacing: "0.1em", cursor: "pointer",
          }}
        >
          REMOVE MEAL · KEEP RECIPES
        </button>
      </div>
    </div>
  );
}

const OVERLAY_STYLE = {
  position: "fixed", inset: 0, zIndex: 210,
  background: "#0b0b0b",
  maxWidth: 480, margin: "0 auto",
  overflowY: "auto",
  color: "#f5f5f0",
};

const iconBtn = {
  background: "#161616", border: "1px solid #2a2a2a",
  borderRadius: 18, width: 34, height: 34,
  color: "#aaa", fontSize: 16, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  lineHeight: 1,
};
