import { useMemo, useState } from "react";
import CookMode from "./CookMode";
import SchedulePicker from "./SchedulePicker";
import { useScheduledMeals } from "../lib/useScheduledMeals";
import { RECIPES, findRecipe, totalTimeMin, difficultyLabel } from "../data/recipes";

const DAY_LABELS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_SHORTS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

// Midnight of `d` as a local Date.
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// Format meal time as "7:30 PM".
function fmtTime(isoOrDate) {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Bucket meals by local day (key = yyyy-mm-dd).
function bucketByDay(meals) {
  const map = new Map();
  for (const m of meals) {
    const d = new Date(m.scheduled_for);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return map;
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe picker (used when tapping "+" on an empty day)
// ─────────────────────────────────────────────────────────────────────────────

function RecipePickerModal({ onPick, onClose }) {
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

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 290,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0",
        padding: "20px 22px 30px",
        maxHeight: "80vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
          PICK A RECIPE
        </div>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search recipes…"
          style={{
            marginTop: 10, padding: "12px 14px",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            borderRadius: 10, color: "#f0ece4",
            fontFamily: "'DM Sans',sans-serif", fontSize: 14, outline: "none",
          }}
        />
        <div style={{ marginTop: 14, overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(r => (
              <button
                key={r.slug}
                onClick={() => onPick(r)}
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
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: "#555", fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
                No recipes match "{query}"
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 12, padding: "14px",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            color: "#888", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12,
            letterSpacing: "0.08em", cursor: "pointer",
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled meal detail drawer (shown when tapping an existing meal)
// ─────────────────────────────────────────────────────────────────────────────

function MealDetailDrawer({ meal, recipe, onCookNow, onDelete, onClose }) {
  const [confirming, setConfirming] = useState(false);
  if (!recipe) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "#000000dd", zIndex: 280,
        display: "flex", alignItems: "flex-end",
        maxWidth: 480, margin: "0 auto",
      }}>
        <div style={{ width: "100%", background: "#141414", borderRadius: "20px 20px 0 0", padding: "24px 22px 36px" }}>
          <div style={{ color: "#f87171", fontFamily: "'DM Sans',sans-serif", fontSize: 14 }}>
            Recipe "{meal.recipe_slug}" not found in the library.
          </div>
          <button onClick={onClose} style={{
            marginTop: 16, width: "100%", padding: "14px",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            color: "#888", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12, cursor: "pointer",
          }}>CLOSE</button>
        </div>
      </div>
    );
  }

  const activeNotifs = Object.values(meal.notification_settings || {}).filter(Boolean).length;
  const totalNotifs  = (recipe.prepNotifications || []).length;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 280,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{ width: "100%", background: "#141414", borderRadius: "20px 20px 0 0", padding: "20px 22px 36px" }}>
        <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 18px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 40 }}>{recipe.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
              {fmtTime(meal.scheduled_for).toUpperCase()}
            </div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {recipe.title}
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666" }}>
              {totalTimeMin(recipe)} min · {difficultyLabel(recipe.difficulty)} · {recipe.cuisine}
            </div>
          </div>
        </div>

        {meal.note && (
          <div style={{
            marginTop: 14, padding: "10px 12px",
            background: "#161616", border: "1px solid #2a2a2a",
            borderRadius: 10, fontFamily: "'DM Sans',sans-serif",
            fontSize: 13, color: "#ccc", fontStyle: "italic",
          }}>
            "{meal.note}"
          </div>
        )}

        {totalNotifs > 0 && (
          <div style={{
            marginTop: 14, padding: "10px 12px",
            background: "#0f0f0f", border: "1px solid #1e1e1e",
            borderRadius: 10, display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 16 }}>🔔</span>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888" }}>
              {activeNotifs} of {totalNotifs} prep reminder{totalNotifs === 1 ? "" : "s"} on
            </span>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          {confirming ? (
            <>
              <button
                onClick={() => setConfirming(false)}
                style={{
                  flex: 1, padding: "14px",
                  background: "#1a1a1a", border: "1px solid #2a2a2a",
                  color: "#888", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 12,
                  letterSpacing: "0.08em", cursor: "pointer",
                }}
              >
                KEEP IT
              </button>
              <button
                onClick={() => onDelete(meal.id)}
                style={{
                  flex: 1, padding: "14px",
                  background: "#3a1a1a", border: "1px solid #5a2a2a",
                  color: "#f87171", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600,
                  letterSpacing: "0.08em", cursor: "pointer",
                }}
              >
                YES, REMOVE
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirming(true)}
                style={{
                  padding: "14px 16px",
                  background: "#1a1a1a", border: "1px solid #2a2a2a",
                  color: "#888", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 12,
                  cursor: "pointer",
                }}
              >
                REMOVE
              </button>
              <button
                onClick={onCookNow}
                style={{
                  flex: 1, padding: "14px",
                  background: "#f5c842", border: "none", color: "#111",
                  borderRadius: 12, fontFamily: "'DM Mono',monospace", fontSize: 12,
                  fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer",
                  boxShadow: "0 0 30px #f5c84233",
                }}
              >
                COOK NOW →
              </button>
            </>
          )}
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 10, width: "100%", background: "none", border: "none",
            color: "#555", fontFamily: "'DM Mono',monospace", fontSize: 11,
            letterSpacing: "0.08em", cursor: "pointer", padding: 8,
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan tab — 7 days, tap + to add, tap meal for details
// ─────────────────────────────────────────────────────────────────────────────

export default function Plan({ profile, userId }) {
  // Show a rolling 14-day window so next week is visible without scrolling mechanics.
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [today]);

  const windowEnd = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 15); // end of 15th day to cover the last day fully
    return d;
  }, [today]);

  const { meals, loading, schedule, cancel } = useScheduledMeals(userId, {
    fromISO: today.toISOString(),
    toISO:   windowEnd.toISOString(),
  });

  // UI state
  const [addingForDay, setAddingForDay] = useState(null);       // Date picked via "+"
  const [recipeToSchedule, setRecipeToSchedule] = useState(null); // Recipe picked from modal
  const [openMeal, setOpenMeal] = useState(null);                // Meal tapped to view
  const [cookingRecipe, setCookingRecipe] = useState(null);      // Recipe now in CookMode

  // If user tapped a meal → Cook Now, CookMode takes over the whole tab.
  if (cookingRecipe) {
    return (
      <CookMode
        recipe={cookingRecipe}
        onExit={() => setCookingRecipe(null)}
        onDone={() => setCookingRecipe(null)}
      />
    );
  }

  const byDay = bucketByDay(meals);

  const onPickRecipe = (recipe) => {
    setRecipeToSchedule(recipe);
  };

  const onSaveSchedule = async ({ scheduledFor, notificationSettings, note }) => {
    await schedule({
      recipeSlug: recipeToSchedule.slug,
      scheduledFor,
      notificationSettings,
      note,
    });
  };

  const firstName = profile?.name?.trim().split(/\s+/)[0];

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "24px 20px 0" }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>
          YOUR WEEK{firstName ? `, ${firstName.toUpperCase()}` : ""}
        </div>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 38, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", letterSpacing: "-0.03em" }}>
          Plan
        </h1>
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#666", marginTop: 4 }}>
          Schedule meals ahead so the notifications know when to fire.
        </div>
      </div>

      <div style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        {days.map((d, i) => {
          const key = dayKey(d);
          const dayMeals = byDay.get(key) || [];
          const isToday  = d.getTime() === today.getTime();
          const dateLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

          return (
            <div key={key} style={{
              background: isToday ? "#1a1408" : "#141414",
              border: `1px solid ${isToday ? "#f5c84233" : "#1e1e1e"}`,
              borderRadius: 16, padding: "14px 16px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: dayMeals.length ? 10 : 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: isToday ? "#f5c842" : "#666", letterSpacing: "0.12em" }}>
                    {isToday ? "TODAY" : i === 1 ? "TOMORROW" : DAY_SHORTS[d.getDay()]}
                  </div>
                  <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontStyle: "italic", fontWeight: 300, color: isToday ? "#f0ece4" : "#aaa" }}>
                    {dateLabel}
                  </div>
                </div>
                <button
                  onClick={() => setAddingForDay(d)}
                  style={{
                    background: "#1a1a1a", border: "1px solid #2a2a2a",
                    borderRadius: 20, padding: "4px 12px",
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#888", letterSpacing: "0.08em", cursor: "pointer",
                  }}
                >
                  + ADD
                </button>
              </div>

              {dayMeals.length === 0 && !isToday && (
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#444", fontStyle: "italic" }}>
                  Nothing planned.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dayMeals.map(meal => {
                  const recipe = findRecipe(meal.recipe_slug);
                  const activeNotifs = Object.values(meal.notification_settings || {}).filter(Boolean).length;
                  return (
                    <button
                      key={meal.id}
                      onClick={() => setOpenMeal(meal)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "12px 14px", background: "#0f0f0f",
                        border: "1px solid #1e1e1e", borderRadius: 12,
                        cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <div style={{ fontSize: 26, flexShrink: 0 }}>{recipe?.emoji || "🍽️"}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                          <span style={{ fontFamily: "'Fraunces',serif", fontSize: 15, color: "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {recipe?.title || meal.recipe_slug}
                          </span>
                          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", flexShrink: 0 }}>
                            {fmtTime(meal.scheduled_for)}
                          </span>
                        </div>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.05em", marginTop: 3 }}>
                          {recipe && `${totalTimeMin(recipe)} MIN`}
                          {activeNotifs > 0 && ` · 🔔 ${activeNotifs}`}
                          {meal.note && " · 📝"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: 20, color: "#555", fontFamily: "'DM Sans',sans-serif", fontSize: 12 }}>
          Loading your week…
        </div>
      )}

      {/* Layered modals:
          1. + tapped, no recipe picked yet → RecipePickerModal
          2. Recipe picked → SchedulePicker with initialDate = the tapped day
          3. Meal tapped → MealDetailDrawer
      */}
      {addingForDay && !recipeToSchedule && (
        <RecipePickerModal
          onPick={onPickRecipe}
          onClose={() => { setAddingForDay(null); }}
        />
      )}
      {recipeToSchedule && (
        <SchedulePicker
          recipe={recipeToSchedule}
          initialDate={addingForDay}
          onClose={() => { setRecipeToSchedule(null); setAddingForDay(null); }}
          onSave={onSaveSchedule}
        />
      )}
      {openMeal && (
        <MealDetailDrawer
          meal={openMeal}
          recipe={findRecipe(openMeal.recipe_slug)}
          onClose={() => setOpenMeal(null)}
          onCookNow={() => {
            const r = findRecipe(openMeal.recipe_slug);
            setOpenMeal(null);
            if (r) setCookingRecipe(r);
          }}
          onDelete={async (id) => {
            await cancel(id);
            setOpenMeal(null);
          }}
        />
      )}
    </div>
  );
}
