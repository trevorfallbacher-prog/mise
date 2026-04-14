import { useMemo, useState } from "react";
import CookMode from "./CookMode";
import SchedulePicker from "./SchedulePicker";
import SuggestMeal from "./SuggestMeal";
import { useScheduledMeals } from "../lib/useScheduledMeals";
import {
  RECIPES,
  CUISINES,
  difficultyLabel,
  totalTimeMin,
} from "../data/recipes";

// Map each skill level requirement against the user's current levels.
// Returns [] if unlocked, or an array of { skill, need, have } describing gaps.
function lockGaps(recipe, skillLevels) {
  const gaps = [];
  const req = recipe.minSkillLevels || {};
  for (const id of Object.keys(req)) {
    const have = (skillLevels || {})[id] ?? 0;
    if (have < req[id]) gaps.push({ skill: id, need: req[id], have });
  }
  return gaps;
}

// 10 → 5-segment difficulty bar. Round up so 4.5 shows as 3/5.
function difficultyBar(n) {
  const filled = Math.ceil((n / 10) * 5);
  return Array.from({ length: 5 }, (_, i) => i < filled);
}

function RecipeCard({ recipe, locked, lockReasons, onOpen }) {
  const bars = difficultyBar(recipe.difficulty);
  return (
    <button
      onClick={locked ? undefined : onOpen}
      style={{
        display: "block", width: "100%", textAlign: "left",
        background: locked ? "#0f0f0f" : "#161616",
        border: `1px solid ${locked ? "#1a1a1a" : "#2a2a2a"}`,
        borderRadius: 14, padding: "14px 16px",
        cursor: locked ? "not-allowed" : "pointer",
        opacity: locked ? 0.55 : 1,
        transition: "all 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: 32, flexShrink: 0 }}>
          {locked ? "🔒" : recipe.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "'Fraunces',serif", fontSize: 16, color: locked ? "#555" : "#f0ece4", fontWeight: 400 }}>
              {recipe.title}
            </span>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", flexShrink: 0 }}>
              {totalTimeMin(recipe)} min
            </span>
          </div>
          {recipe.subtitle && (
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {recipe.subtitle}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            {/* difficulty bar */}
            <div style={{ display: "flex", gap: 3 }}>
              {bars.map((on, i) => (
                <div key={i} style={{
                  width: 16, height: 4, borderRadius: 2,
                  background: on ? "#f5c842" : "#252525",
                }} />
              ))}
            </div>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", letterSpacing: "0.08em" }}>
              {difficultyLabel(recipe.difficulty).toUpperCase()}
            </span>
          </div>
          {locked && lockReasons.length > 0 && (
            <div style={{ marginTop: 8, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#e07a3a", letterSpacing: "0.04em" }}>
              Requires {lockReasons.map(g => `${g.skill} ${g.need}`).join(", ")}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export default function Cook({ profile, userId, onCooked, pantry, shoppingList, setShoppingList, onGoToShopping, family = [], hasFamily = false }) {
  const [route, setRoute]     = useState("plan");   // "plan" | "learn"
  const [cuisine, setCuisine] = useState("all");    // "all" | "italian" | "french" | ...
  const [openRecipe, setOpenRecipe] = useState(null);
  const [schedulingRecipe, setSchedulingRecipe] = useState(null);
  const [suggesting, setSuggesting] = useState(false);

  const skillLevels = profile?.skill_levels || {};
  const { schedule } = useScheduledMeals(userId);
  const userName = profile?.name?.trim().split(/\s+/)[0];

  const list = useMemo(() => {
    const filtered = RECIPES.filter(r =>
      r.routes.includes(route) &&
      (cuisine === "all" || r.cuisine === cuisine)
    );
    // Sort by difficulty ascending — builds the natural ladder feel.
    return [...filtered].sort((a, b) => a.difficulty - b.difficulty);
  }, [route, cuisine]);

  // Group by cuisine when "all" is selected, so the list doesn't blur together.
  const grouped = useMemo(() => {
    if (cuisine !== "all") return [{ cuisine, recipes: list }];
    const map = new Map();
    for (const r of list) {
      if (!map.has(r.cuisine)) map.set(r.cuisine, []);
      map.get(r.cuisine).push(r);
    }
    return [...map.entries()].map(([c, rs]) => ({ cuisine: c, recipes: rs }));
  }, [cuisine, list]);

  // If a recipe is open, render CookMode instead of the browser.
  // Schedule picker can layer on top when the user taps "Schedule".
  if (openRecipe) {
    return (
      <>
        <CookMode
          recipe={openRecipe}
          onExit={() => setOpenRecipe(null)}
          onSchedule={() => setSchedulingRecipe(openRecipe)}
          onDone={() => {
            setOpenRecipe(null);
            onCooked?.(openRecipe);
          }}
          pantry={pantry}
          shoppingList={shoppingList}
          setShoppingList={setShoppingList}
          onGoToShopping={onGoToShopping}
        />
        {schedulingRecipe && (
          <SchedulePicker
            recipe={schedulingRecipe}
            userId={userId}
            userName={userName}
            family={family}
            defaultRequest={hasFamily}
            onClose={() => setSchedulingRecipe(null)}
            onSave={async ({ scheduledFor, notificationSettings, note, cookId, isRequest, servings }) => {
              await schedule({
                recipeSlug: schedulingRecipe.slug,
                scheduledFor,
                notificationSettings,
                note,
                cookId,
                isRequest,
                servings,
              });
            }}
          />
        )}
      </>
    );
  }

  const routePill = (id, label) => (
    <button
      key={id}
      onClick={() => setRoute(id)}
      style={{
        flex: 1, padding: "12px 0",
        background: route === id ? "#f5c842" : "#161616",
        color: route === id ? "#111" : "#888",
        border: `1px solid ${route === id ? "#f5c842" : "#2a2a2a"}`,
        borderRadius: 12,
        fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600,
        letterSpacing: "0.12em", cursor: "pointer", transition: "all 0.2s",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "24px 20px 0" }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>WHAT'S FOR</div>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 38, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", letterSpacing: "-0.03em" }}>Dinner</h1>
      </div>

      {/* PLAN vs LEARN */}
      <div style={{ display: "flex", gap: 8, padding: "16px 20px 0" }}>
        {routePill("plan", "PLAN")}
        {routePill("learn", "LEARN")}
      </div>
      <div style={{ padding: "8px 20px 0", fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#555", lineHeight: 1.5 }}>
        {route === "plan"
          ? "Cook whatever you want. Schedule it, prep it, eat it."
          : "Skill-tree progression. Harder dishes unlock as your skills level up."}
      </div>

      {/* Suggest-a-meal — prominent when pantry has anything in it */}
      {pantry && pantry.length > 0 && (
        <div style={{ padding: "16px 20px 0" }}>
          <button
            onClick={() => setSuggesting(true)}
            style={{
              width: "100%", padding: "14px 16px",
              background: "linear-gradient(135deg, #1e1a0e 0%, #141414 100%)",
              border: "1px solid #f5c84244", borderRadius: 14,
              display: "flex", alignItems: "center", gap: 12,
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{ fontSize: 24 }}>✨</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
                SUGGEST A MEAL
              </div>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#bbb", marginTop: 2 }}>
                See what you could make with what you have
              </div>
            </div>
            <span style={{ color: "#f5c842", fontSize: 18 }}>→</span>
          </button>
        </div>
      )}

      {/* Cuisine chips */}
      <div style={{ display: "flex", gap: 8, padding: "16px 20px 0", overflowX: "auto", scrollbarWidth: "none" }}>
        {["all", ...CUISINES].map(c => (
          <button
            key={c}
            onClick={() => setCuisine(c)}
            style={{
              flexShrink: 0, padding: "6px 14px",
              background: cuisine === c ? "#1e1a0e" : "#161616",
              border: `1px solid ${cuisine === c ? "#f5c842" : "#2a2a2a"}`,
              color: cuisine === c ? "#f5c842" : "#888",
              borderRadius: 20,
              fontFamily: "'DM Sans',sans-serif", fontSize: 12,
              cursor: "pointer", textTransform: "capitalize", transition: "all 0.2s",
            }}
          >
            {c === "all" ? "All" : c}
          </button>
        ))}
      </div>

      {/* Groups */}
      <div style={{ padding: "8px 20px 0" }}>
        {grouped.map(({ cuisine: groupCuisine, recipes }) => (
          <div key={groupCuisine} style={{ marginTop: 20 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.15em", marginBottom: 10, textTransform: "uppercase" }}>
              {groupCuisine}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {recipes.map(r => {
                // Learn gates on skill levels; Plan doesn't.
                const gaps = route === "learn" ? lockGaps(r, skillLevels) : [];
                const locked = gaps.length > 0;
                return (
                  <RecipeCard
                    key={r.slug}
                    recipe={r}
                    locked={locked}
                    lockReasons={gaps}
                    onOpen={() => setOpenRecipe(r)}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {list.length === 0 && (
          <div style={{
            marginTop: 40, padding: "30px 20px", textAlign: "center",
            fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#666",
          }}>
            No recipes yet for this filter. More coming soon.
          </div>
        )}
      </div>

      {suggesting && (
        <SuggestMeal
          pantry={pantry}
          onPick={(r) => { setSuggesting(false); setOpenRecipe(r); }}
          onClose={() => setSuggesting(false)}
        />
      )}
    </div>
  );
}
