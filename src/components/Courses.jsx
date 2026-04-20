import { useMemo, useState } from "react";
import CookMode from "./CookMode";
import SchedulePicker from "./SchedulePicker";
import { useScheduledMeals } from "../lib/useScheduledMeals";
import {
  RECIPES,
  CUISINES,
  difficultyLabel,
  totalTimeMin,
} from "../data/recipes";
import { SKILL_TREE } from "../data";
import { recipeNutrition } from "../lib/nutrition";
import { useIngredientInfo } from "../lib/useIngredientInfo";
import { useBrandNutrition } from "../lib/useBrandNutrition";

// A course is a LEARN-route recipe whose unlock gate is driven by the
// user's skill levels. The Courses tab surfaces two things stacked:
//   1. The skill tree — visible progress with color-coded fill. A tap
//      on a skill scrolls to (or filters) the ladder below.
//   2. The ladder — every LEARN recipe, sorted by difficulty, grouped
//      by cuisine. Locked recipes are dimmed + marked with the
//      specific skill gap.
//
// This is the promotion of what used to live inside the Cook tab's
// "LEARN" sub-route. Giving it its own tab gives the skill-progression
// story room to breathe and frees Cook (template browser) to get
// absorbed into Quick Cook.

function lockGaps(recipe, skillLevels) {
  const gaps = [];
  const req = recipe.minSkillLevels || {};
  for (const id of Object.keys(req)) {
    const have = (skillLevels || {})[id] ?? 0;
    if (have < req[id]) gaps.push({ skill: id, need: req[id], have });
  }
  return gaps;
}

function difficultyBar(n) {
  const filled = Math.ceil((n / 10) * 5);
  return Array.from({ length: 5 }, (_, i) => i < filled);
}

function SkillTile({ skill, onTap, active }) {
  const pct = (skill.level / skill.maxLevel) * 100;
  return (
    <button
      onClick={onTap}
      style={{
        background: active ? "#1a1608" : "#161616",
        border: `1px solid ${active ? skill.color : "#2a2a2a"}`,
        borderRadius: 12, padding: "12px 12px",
        display: "flex", alignItems: "center", gap: 10,
        cursor: "pointer", textAlign: "left",
        transition: "all 0.2s",
      }}
    >
      <div style={{ fontSize: 22, flexShrink: 0 }}>{skill.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
            {skill.name}
          </span>
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: skill.level > 0 ? skill.color : "#555" }}>
            {skill.level}/{skill.maxLevel}
          </span>
        </div>
        <div style={{ height: 3, background: "#222", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${pct}%`,
            background: skill.color,
            boxShadow: skill.level > 0 ? `0 0 6px ${skill.color}88` : "none",
            transition: "width 0.3s",
          }} />
        </div>
      </div>
    </button>
  );
}

function RecipeCard({ recipe, locked, lockReasons, onOpen, pantry = [], ingredientInfo, brandNutrition }) {
  const bars = difficultyBar(recipe.difficulty);
  // Per-serving kcal rollup. Falls back through pantry override →
  // brand_nutrition → ingredient_info → bundled canonical.nutrition,
  // so even a recipe on a row with zero scanned brands still shows
  // the default calorie estimate from src/data/ingredients.js.
  // Hidden when coverage is zero — a "0 kcal" tile on a recipe full
  // of untracked ingredients reads like a bug, not a gap.
  const kcal = useMemo(() => {
    const n = recipeNutrition(recipe, { pantry, getInfo: ingredientInfo?.getInfo, brandNutrition });
    if (!n.coverage.resolved) return null;
    const v = Math.round(n.perServing?.kcal || 0);
    return v > 0 ? v : null;
  }, [recipe, pantry, ingredientInfo, brandNutrition]);
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
              {totalTimeMin(recipe)} min{kcal != null ? ` · ${kcal} kcal` : ""}
            </span>
          </div>
          {recipe.subtitle && (
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {recipe.subtitle}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
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

export default function Courses({
  profile, userId,
  pantry, setPantry, shoppingList, setShoppingList, onGoToShopping,
  family = [], friends = [], hasFamily = false,
  onCooked,
}) {
  const [cuisine, setCuisine]   = useState("all");
  const [skillFilter, setSkillFilter] = useState(null);  // skill id or null
  const [openRecipe, setOpenRecipe] = useState(null);
  const [schedulingRecipe, setSchedulingRecipe] = useState(null);

  const skillLevels = profile?.skill_levels || {};
  const { schedule } = useScheduledMeals(userId);
  const userName = profile?.name?.trim().split(/\s+/)[0];

  // Nutrition context for every RecipeCard's calorie chip. Shared here
  // so the resolver hits the brand_nutrition + ingredient_info cache
  // once for the whole list instead of per-card.
  const ingredientInfo = useIngredientInfo();
  const { get: getBrandNutrition } = useBrandNutrition();
  const brandNutrition = useMemo(
    () => ({ get: (k) => getBrandNutrition?.(k) || null }),
    [getBrandNutrition],
  );

  const skills = useMemo(
    () => SKILL_TREE.map(s => ({ ...s, level: skillLevels[s.id] ?? 0 })),
    [skillLevels],
  );

  // The LEARN ladder — every recipe that opts into the LEARN route.
  // Filtered by optional cuisine chip + optional skill-tile tap.
  const list = useMemo(() => {
    const filtered = RECIPES.filter(r => {
      if (!r.routes.includes("learn")) return false;
      if (cuisine !== "all" && r.cuisine !== cuisine) return false;
      if (skillFilter && !(r.minSkillLevels || {})[skillFilter]) return false;
      return true;
    });
    return [...filtered].sort((a, b) => a.difficulty - b.difficulty);
  }, [cuisine, skillFilter]);

  const grouped = useMemo(() => {
    if (cuisine !== "all") return [{ cuisine, recipes: list }];
    const map = new Map();
    for (const r of list) {
      if (!map.has(r.cuisine)) map.set(r.cuisine, []);
      map.get(r.cuisine).push(r);
    }
    return [...map.entries()].map(([c, rs]) => ({ cuisine: c, recipes: rs }));
  }, [cuisine, list]);

  // An opened recipe takes over the surface — CookMode handles cooking,
  // SchedulePicker layers on top for a deferred cook. On complete,
  // bubble back up so App can bounce to the profile archive.
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
          setPantry={setPantry}
          shoppingList={shoppingList}
          setShoppingList={setShoppingList}
          onGoToShopping={onGoToShopping}
          userId={userId}
          family={family}
          friends={friends}
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

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "24px 20px 0" }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>LEVEL UP YOUR</div>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 38, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", letterSpacing: "-0.03em" }}>Courses</h1>
        <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", lineHeight: 1.5 }}>
          Skill-tree progression. Every finished cook levels the relevant skills; harder dishes unlock as you climb.
        </div>
      </div>

      {/* Skill tree — 2-column grid of tiles. Tap a tile to filter the
          ladder below to recipes that touch that skill. Tap again to
          clear. */}
      <div style={{ padding: "18px 20px 0" }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 10 }}>
          YOUR SKILLS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {skills.map(s => (
            <SkillTile
              key={s.id}
              skill={s}
              active={skillFilter === s.id}
              onTap={() => setSkillFilter(skillFilter === s.id ? null : s.id)}
            />
          ))}
        </div>
        {skillFilter && (
          <button
            onClick={() => setSkillFilter(null)}
            style={{
              marginTop: 10, width: "100%", padding: "8px",
              background: "transparent", border: "1px solid #2a2a2a",
              color: "#888", borderRadius: 10,
              fontFamily: "'DM Mono',monospace", fontSize: 10,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            CLEAR SKILL FILTER
          </button>
        )}
      </div>

      {/* Cuisine chips — mirror Cook's original chip strip so the
          control surface stays familiar. */}
      <div style={{ display: "flex", gap: 8, padding: "20px 20px 0", overflowX: "auto", scrollbarWidth: "none" }}>
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

      {/* Recipe ladder — groups by cuisine, sorted by difficulty within
          each group. Locked recipes dim and show the required skill. */}
      <div style={{ padding: "8px 20px 0" }}>
        {grouped.map(({ cuisine: groupCuisine, recipes }) => (
          <div key={groupCuisine} style={{ marginTop: 20 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.15em", marginBottom: 10, textTransform: "uppercase" }}>
              {groupCuisine}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {recipes.map(r => {
                const gaps = lockGaps(r, skillLevels);
                const locked = gaps.length > 0;
                return (
                  <RecipeCard
                    key={r.slug}
                    recipe={r}
                    locked={locked}
                    lockReasons={gaps}
                    onOpen={() => setOpenRecipe(r)}
                    pantry={pantry}
                    ingredientInfo={ingredientInfo}
                    brandNutrition={brandNutrition}
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
            No courses yet for this filter.
          </div>
        )}
      </div>
    </div>
  );
}
