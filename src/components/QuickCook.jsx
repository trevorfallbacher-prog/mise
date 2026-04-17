import { useMemo, useState } from "react";
import CookMode from "./CookMode";
import CustomRecipeBuilder from "./CustomRecipeBuilder";
import AIRecipe from "./AIRecipe";
import {
  RECIPES,
  totalTimeMin,
  difficultyLabel,
} from "../data/recipes";
import { useUserRecipes } from "../lib/useUserRecipes";

// QuickCook — full-screen overlay launched by the center ➕ in the tab bar.
//
// Drives a small state machine:
//   choose   → three big cards (CUSTOM / AI / TEMPLATE)
//   custom   → multi-step recipe builder, saves to user_recipes
//   ai       → Claude-drafted recipe from the pantry
//   template → browseable picker over the bundled library
//   cook     → hands the resolved recipe to CookMode
//
// Each path's final action hands a recipe object (matching the bundled
// schema) into `cook` mode so CookMode doesn't care where it came from.
// CookMode onDone bubbles up to the parent (App) which flips to Home so
// the newly-logged cook surfaces in YOUR CIRCLE / UserProfile archive.

export default function QuickCook({
  userId, profile,
  pantry, setPantry, shoppingList, setShoppingList, onGoToShopping,
  family = [], friends = [],
  onClose, onCooked,
}) {
  const [mode, setMode] = useState("choose");   // choose | custom | ai | template | cook
  const [activeRecipe, setActiveRecipe] = useState(null);

  const { saveRecipe } = useUserRecipes(userId);

  // Template picker — search over the bundled library. Re-implements
  // the Plan.jsx RecipePickerModal inline so it can slot into our
  // state machine without fighting Plan's own scheduling callbacks.
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return RECIPES;
    return RECIPES.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.cuisine.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q)
    );
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
          onSaveAndCook={async (recipe) => {
            try {
              await saveRecipe(recipe, "custom");
            } catch (e) {
              console.error("custom save failed — cooking anyway", e);
            }
            startCooking(recipe);
          }}
        />
      </div>
    );
  }

  if (mode === "ai") {
    return (
      <div style={OVERLAY_STYLE}>
        <AIRecipe
          pantry={pantry}
          onCancel={backToChoose}
          onSaveAndCook={async (recipe) => {
            try {
              await saveRecipe(recipe, "ai");
            } catch (e) {
              console.error("ai save failed — cooking anyway", e);
            }
            startCooking(recipe);
          }}
        />
      </div>
    );
  }

  if (mode === "template") {
    return (
      <div style={OVERLAY_STYLE}>
        <div style={{ padding: "24px 20px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #1e1e1e" }}>
          <button onClick={backToChoose} style={iconBtn}>←</button>
          <div style={{ flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
            PICK A TEMPLATE
          </div>
          <button onClick={onClose} style={iconBtn}>✕</button>
        </div>
        <div style={{ padding: "14px 20px 0" }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search recipes…"
            style={{
              width: "100%", padding: "12px 14px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              borderRadius: 10, color: "#f0ece4", boxSizing: "border-box",
              fontFamily: "'DM Sans',sans-serif", fontSize: 14, outline: "none",
            }}
          />
        </div>
        <div style={{ padding: "14px 20px 100px", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
          {filtered.map(r => (
            <button
              key={r.slug}
              onClick={() => startCooking(r)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px", background: "#161616",
                border: "1px solid #2a2a2a", borderRadius: 12,
                cursor: "pointer", textAlign: "left",
              }}
            >
              <div style={{ fontSize: 26, flexShrink: 0 }}>{r.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Fraunces',serif", fontSize: 15, color: "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title}
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.05em", marginTop: 2 }}>
                  {r.cuisine.toUpperCase()} · {totalTimeMin(r)} MIN · {difficultyLabel(r.difficulty).toUpperCase()}
                </div>
              </div>
              <span style={{ color: "#f5c842", fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "#555", fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
              No recipes match "{query}"
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default — the chooser. Three big cards matching the nav color
  // language: custom is italic/yellow (authoring), AI is gradient
  // (Claude), template is neutral (library).
  return (
    <div style={OVERLAY_STYLE}>
      <div style={{ padding: "24px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
          QUICK COOK
        </div>
        <button onClick={onClose} style={iconBtn}>✕</button>
      </div>
      <div style={{ padding: "12px 20px 0" }}>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 34, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", letterSpacing: "-0.02em", margin: 0 }}>
          What are you cooking?
        </h1>
        <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.5 }}>
          Start from scratch, let Claude draft something from your pantry, or pick from the library.
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
          title="Pick a template"
          blurb="Browse the bundled library — classic recipes, graded by difficulty."
          onClick={() => setMode("template")}
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
