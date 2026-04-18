import { useMemo, useState } from "react";
import CookMode from "./CookMode";
import CustomRecipeBuilder from "./CustomRecipeBuilder";
import AIRecipe from "./AIRecipe";
import SchedulePicker from "./SchedulePicker";
import {
  RECIPES,
  totalTimeMin,
  difficultyLabel,
} from "../data/recipes";
import { useUserRecipes } from "../lib/useUserRecipes";
import { useScheduledMeals } from "../lib/useScheduledMeals";
import { useIngredientInfo } from "../lib/useIngredientInfo";
import { useCookLog } from "../lib/useCookLog";
import { useToast } from "../lib/toast";

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
//   addIntent  → two sub-cards (SCAN / ADD MANUALLY) + back link
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
}) {
  const [mode, setMode] = useState("choose");        // choose | custom | ai | template | addIntent | cook
  const [activeRecipe, setActiveRecipe] = useState(null);
  // When set, SchedulePicker renders on top of the current mode. The
  // recipe has already been persisted to user_recipes by the time we
  // enter this state — picking a day just writes the scheduled_meals row.
  const [scheduling, setScheduling] = useState(null); // recipe object | null

  const { recipes: userRecipes, saveRecipe } = useUserRecipes(userId);
  const { schedule } = useScheduledMeals(userId);
  const { push: pushToast } = useToast();
  // Ingredient enrichment is provided once at App level; reading it
  // here lets AIRecipe's context builder look up flavorProfile/pairs/
  // diet per pantry item without re-fetching.
  const ingredientInfo = useIngredientInfo();
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

  // Enter CookMode with a given recipe, regardless of source.
  const startCooking = (recipe) => {
    setActiveRecipe(recipe);
    setMode("cook");
  };

  // Back from a nested mode should return to the chooser, not to the
  // parent — only "close" from the chooser itself actually closes.
  const backToChoose = () => {
    setActiveRecipe(null);
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

  // COOK IT — original save + cook handoff. Preserves the "cook anyway
  // if save fails" behavior so a transient DB error doesn't strand the
  // user mid-session.
  const handleSaveAndCook = (source) => async (recipe, opts = {}) => {
    await persist(recipe, source, opts);
    startCooking(recipe);
  };

  // Cook mode handoff — CookMode can end in exit OR done; we preserve
  // both and route onDone up to the parent (App).
  if (mode === "cook" && activeRecipe) {
    return (
      <div style={OVERLAY_STYLE}>
        <CookMode
          recipe={activeRecipe}
          onExit={backToChoose}
          onDone={() => {
            const r = activeRecipe;
            setActiveRecipe(null);
            onCooked?.(r);
            onClose?.();
          }}
          pantry={pantry}
          setPantry={setPantry}
          shoppingList={shoppingList}
          setShoppingList={setShoppingList}
          onGoToShopping={onGoToShopping}
          userId={userId}
          family={family}
          friends={friends}
        />
      </div>
    );
  }

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
          onCancel={backToChoose}
          onSave={handleSave("ai")}
          onSchedule={handleSchedule("ai")}
          onSaveAndCook={handleSaveAndCook("ai")}
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

  // ADD TO PANTRY sub-phase — user tapped the 4th tile and we need to
  // pick between "scan something" and "add manually." Both entries
  // fire onRequestPantryAction back to App, which flips to the
  // pantry tab and opens the matching Kitchen flow (Scanner or
  // AddItemModal). CreateMenu closes immediately so the user isn't
  // staring at a dim overlay while the tab switches behind it.
  if (mode === "addIntent") {
    const dispatchPantryAction = (kind) => {
      if (onRequestPantryAction) onRequestPantryAction(kind);
      else onClose?.();
    };
    return (
      <div style={OVERLAY_STYLE}>
        <div style={{ padding: "24px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={() => setMode("choose")}
            style={{
              background: "transparent", border: "none",
              color: "#aaa", fontFamily: "'DM Mono',monospace",
              fontSize: 11, letterSpacing: "0.08em", cursor: "pointer",
              padding: "4px 0",
            }}
          >
            ← BACK
          </button>
          <button onClick={onClose} style={iconBtn}>✕</button>
        </div>
        <div style={{ padding: "12px 20px 0" }}>
          <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 34, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", letterSpacing: "-0.02em", margin: 0 }}>
            How are you adding it?
          </h1>
          <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.5 }}>
            Scan a receipt or a shelf photo, or type a single item by hand.
          </div>
        </div>
        <div style={{ padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
          <BigCard
            emoji="🧾"
            accent="#7eb8d4"
            title="Scan something"
            blurb="Receipt, fridge shelf, pantry, or freezer — snap a photo and we'll read the items."
            onClick={() => dispatchPantryAction("scan")}
          />
          <BigCard
            emoji="➕"
            accent="#f5c842"
            title="Add manually"
            blurb="Type one item in — name, amount, category, where it lives. For when a scan would be overkill."
            onClick={() => dispatchPantryAction("add")}
          />
        </div>
      </div>
    );
  }

  if (mode === "template") {
    const totalResults =
      filteredUserCustom.length + filteredUserAI.length + filteredBundled.length;
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
      </div>
    );
  }

  // Default — the chooser. Four big cards matching the nav color
  // language: custom is italic/yellow (authoring), AI is gradient
  // (Claude), template is neutral (library), ADD TO PANTRY is green
  // (the pantry's own accent). Tapping the fourth drills into the
  // addIntent sub-phase, which offers SCAN / MANUAL entry points.
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
        <BigCard
          emoji="✏️"
          accent="#f5c842"
          title="Custom recipe"
          blurb="Write your own — ingredients, steps, photos. Save it so you can cook it again."
          onClick={() => setMode("custom")}
        />
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
          title="Pick a recipe"
          blurb={`${userCustom.length + userAI.length > 0
            ? `${userCustom.length + userAI.length} saved · `
            : ""}${RECIPES.length} bundled templates.`}
          onClick={() => setMode("template")}
        />
        <BigCard
          emoji="🥫"
          accent="#4ade80"
          title="Add to pantry"
          blurb="Scan a receipt, capture a shelf, or type a single item in manually."
          onClick={() => setMode("addIntent")}
        />
      </div>
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
      </div>
      <span style={{ color: "#f5c842", fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
    </button>
  );
}

// Tag colors per CLAUDE.md palette. CUSTOM uses the canonical-identity
// tan (user-authored identity); AI uses the state-axis purple (mirrors
// the AI-recipe card accent). These avoid colliding with STORED-IN
// (blue) and INGREDIENTS (yellow) axes.
const TAG_CUSTOM = "#b8a878";
const TAG_AI     = "#c7a8d4";

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
