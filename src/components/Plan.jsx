import { useEffect, useMemo, useRef, useState } from "react";
import CookMode from "./CookMode";
import SchedulePicker from "./SchedulePicker";
import { useScheduledMeals } from "../lib/useScheduledMeals";
import { useUserRecipes } from "../lib/useUserRecipes";
import { RECIPES, findRecipe, totalTimeMin, difficultyLabel } from "../data/recipes";
import { supabase } from "../lib/supabase";
import { scaleRecipe } from "../lib/recipeScaling";

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

// Meal slots for the per-day grid on Plan — breakfast / lunch /
// dinner rows inside every day card. Matches SchedulePicker's slot
// set (minus snack, which lives in the time override path there
// too). Each day card renders all three rows regardless of whether
// they're filled, so the user sees the 3-meal shape at a glance and
// can tap an empty row to schedule directly into that slot.
const PLAN_SLOTS = [
  { id: "breakfast", label: "Breakfast", emoji: "🥞" },
  { id: "lunch",     label: "Lunch",     emoji: "🥪" },
  { id: "dinner",    label: "Dinner",    emoji: "🍽️" },
];

// Infer which slot a meal / cook belongs to. Prefers the explicit
// meal_slot column (migration 0069) when present, falls back to
// hour-based inference for pre-0069 rows and for cook_logs (which
// don't carry a slot column).
function slotForTime(ts, explicit) {
  if (explicit && PLAN_SLOTS.some(s => s.id === explicit)) return explicit;
  const d = ts instanceof Date ? ts : new Date(ts);
  const h = d.getHours();
  if (h < 10) return "breakfast";
  if (h < 15) return "lunch";
  return "dinner";
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe picker (used when tapping "+" on an empty day)
// ─────────────────────────────────────────────────────────────────────────────

function RecipePickerModal({ userRecipes = [], onPick, onClose }) {
  const [query, setQuery] = useState("");
  // Merge bundled + user-authored into a single list. Bundled wins slug
  // collisions to mirror findRecipe()'s precedence; user rows get a tag
  // so the UI can label them "YOURS" / "AI" and the picker handler can
  // tell which source it's scheduling from.
  const all = useMemo(() => {
    const bundledSlugs = new Set(RECIPES.map(r => r.slug));
    const userOnly = userRecipes
      .filter(r => r?.recipe && r.slug && !bundledSlugs.has(r.slug))
      .map(r => ({ ...r.recipe, slug: r.slug, _source: r.source }));
    return [...RECIPES, ...userOnly];
  }, [userRecipes]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(r =>
      (r.title || "").toLowerCase().includes(q) ||
      (r.cuisine || "").toLowerCase().includes(q) ||
      (r.category || "").toLowerCase().includes(q)
    );
  }, [query, all]);

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
            {filtered.map(r => {
              const bits = [
                r.cuisine ? r.cuisine.toUpperCase() : null,
                `${totalTimeMin(r) || 0} MIN`,
                r.difficulty ? difficultyLabel(r.difficulty).toUpperCase() : null,
              ].filter(Boolean);
              const tag = r._source === "custom" ? "YOURS" : r._source === "ai" ? "AI" : null;
              return (
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
                  <div style={{ fontSize: 26, flexShrink: 0 }}>{r.emoji || "🍽️"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 15, color: "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                        {r.title || "(untitled)"}
                      </div>
                      {tag && (
                        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#f5c842", background: "#1a1608", border: "1px solid #3a2f10", borderRadius: 4, padding: "2px 6px", letterSpacing: "0.08em", flexShrink: 0 }}>
                          {tag}
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.05em", marginTop: 2 }}>
                      {bits.join(" · ")}
                    </div>
                  </div>
                </button>
              );
            })}
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

function MealDetailDrawer({ meal, recipe, userId, nameFor, family = [], onCookNow, onClaim, onUnclaim, onChangeCook, onChangeServings, onDelete, onClose }) {
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
              {meal.meal_slot ? `${meal.meal_slot.toUpperCase()} · ` : ""}{fmtTime(meal.scheduled_for).toUpperCase()}
            </div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {recipe.title}
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666" }}>
              {totalTimeMin(recipe)} min · {difficultyLabel(recipe.difficulty)} · {recipe.cuisine}
            </div>
          </div>
        </div>

        {/* Attribution: who scheduled it and who's cooking / requesting. */}
        {(() => {
          const creatorName = nameFor ? nameFor(meal.user_id) : null;
          const isRequest   = meal.cook_id == null;
          const cookName    = !isRequest && nameFor ? nameFor(meal.cook_id) : null;
          return (
            <div style={{
              marginTop: 14, padding: "10px 12px",
              background: isRequest ? "#1e1408" : "#0f0f0f",
              border: `1px solid ${isRequest ? "#3a2a15" : "#1e1e1e"}`,
              borderRadius: 10, display: "flex", alignItems: "center", gap: 8,
              fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb",
            }}>
              <span style={{ fontSize: 16 }}>{isRequest ? "🙋" : "🧑‍🍳"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {isRequest
                  ? <><b style={{ color:"#d9b877" }}>{creatorName}</b> is hoping someone will cook this</>
                  : <>Scheduled by <b style={{ color:"#eee" }}>{creatorName}</b>{cookName && cookName !== creatorName ? <> · Cooking: <b style={{ color:"#a3d977" }}>{cookName}</b></> : null}</>
                }
              </span>
            </div>
          );
        })()}

        {/* Servings stepper — only the creator can change (realtime will push to family). */}
        {meal.user_id === userId && onChangeServings && (
          <div style={{
            marginTop: 10, padding: "8px 10px 8px 14px",
            background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 14 }}>👥</span>
            <span style={{ flex: 1, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#aaa" }}>
              Cooking for <b style={{ color: "#f0ece4" }}>{meal.servings ?? 2}</b>
            </span>
            <button
              onClick={() => onChangeServings(Math.max(1, (meal.servings ?? 2) - 1))}
              style={{ width: 28, height: 28, borderRadius: 14, background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#f5c842", cursor: "pointer" }}
            >−</button>
            <button
              onClick={() => onChangeServings(Math.min(20, (meal.servings ?? 2) + 1))}
              style={{ width: 28, height: 28, borderRadius: 14, background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#f5c842", cursor: "pointer" }}
            >+</button>
          </div>
        )}
        {meal.user_id !== userId && meal.servings != null && (
          <div style={{
            marginTop: 10, padding: "8px 12px",
            background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#aaa",
          }}>
            👥 Cooking for <b style={{ color: "#f0ece4" }}>{meal.servings}</b>
          </div>
        )}

        {/* Reassign cook — creator can pick a different family member. */}
        {meal.user_id === userId && onChangeCook && family.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.1em", marginBottom: 6 }}>
              REASSIGN
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[
                { id: "request", label: "🙋 Request", target: null },
                { id: userId, label: "Me", target: userId },
                ...family.filter(f => f.otherId && f.other?.name).map(f => ({
                  id: f.otherId,
                  label: f.other.name.trim().split(/\s+/)[0],
                  target: f.otherId,
                })),
              ].map(opt => {
                const isActive = (opt.target ?? null) === (meal.cook_id ?? null);
                return (
                  <button
                    key={opt.id}
                    onClick={() => onChangeCook(opt.target)}
                    disabled={isActive}
                    style={{
                      padding: "6px 12px",
                      background: isActive ? "#1e1a0e" : "#161616",
                      border: `1px solid ${isActive ? "#f5c842" : "#2a2a2a"}`,
                      color: isActive ? "#f5c842" : "#888",
                      borderRadius: 16,
                      fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                      cursor: isActive ? "default" : "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {meal.note && (
          <div style={{
            marginTop: 10, padding: "10px 12px",
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

        {/* Cook/request action — only when not in "confirming delete" mode. */}
        {!confirming && (meal.cook_id == null || meal.cook_id === userId) && (
          <div style={{ marginTop: 14 }}>
            {meal.cook_id == null ? (
              <button
                onClick={onClaim}
                style={{
                  width: "100%", padding: "12px",
                  background: "#1a2015", border: "1px solid #2a3a1e",
                  color: "#a3d977", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
                  letterSpacing: "0.08em", cursor: "pointer",
                }}
              >
                🙋 I'LL COOK THIS
              </button>
            ) : (
              <button
                onClick={onUnclaim}
                style={{
                  width: "100%", padding: "12px",
                  background: "#1a1a1a", border: "1px solid #2a2a2a",
                  color: "#d9b877", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 11,
                  letterSpacing: "0.08em", cursor: "pointer",
                }}
              >
                ↩ ASK FAMILY INSTEAD
              </button>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
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

export default function Plan({ profile, userId, familyKey, nameFor, hasFamily, family = [], friends = [], pantry = [], setPantry, shoppingList = [], setShoppingList, onGoToShopping, onOpenCook }) {
  // 21-day rolling window: past 7 days for week-in-review + today + next 14.
  // Chronological order (oldest past on top, future on bottom) so users
  // scroll down through time the same way the eye reads a diary.
  const PAST_DAYS   = 7;
  const FUTURE_DAYS = 14;
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => {
    const arr = [];
    for (let i = -PAST_DAYS; i < FUTURE_DAYS; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [today]);

  const windowStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - PAST_DAYS);
    return d;
  }, [today]);
  const windowEnd = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + FUTURE_DAYS + 1); // +1 to cover the last day fully
    return d;
  }, [today]);

  // No onRealtime here — toast/inbox notifications are produced by a DB
  // trigger (see migration 0010) and surfaced via App-level useNotifications,
  // so they fire from any tab. Plan's subscription just keeps its local
  // state in sync.
  //
  // Window now extends backwards PAST_DAYS so pastlabeled scheduled meals
  // (e.g. one that was planned last Tuesday and never cooked) still surface
  // on the timeline — they read as "missed" next to a cook_log that DID
  // happen on that day.
  const { meals, loading, schedule, cancel, claim, unclaim, updateMeal } = useScheduledMeals(userId, {
    fromISO: windowStart.toISOString(),
    toISO:   windowEnd.toISOString(),
    familyKey,
  });

  // User-recipe resolver — lets findRecipe() below resolve slugs that
  // point at user_recipes rows (custom or AI recipes scheduled via
  // Quick Cook). Without this wired in, scheduled user recipes would
  // render as blank tiles on the calendar.
  const { recipes: userRecipesList, findBySlug: findUserRecipe } = useUserRecipes(userId);

  // Past cooks — cook_logs with cooked_at in the past-portion of the window.
  // RLS already restricts to self + family + diners-of-me (see 0013), so we
  // just filter by the cooked_at range. Viewer-scoped list — every member
  // of the family sees their family's cooks in this window.
  const [pastCooks, setPastCooks] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!userId) { setPastCooks([]); return; }
    (async () => {
      const { data, error } = await supabase
        .from("cook_logs")
        .select("id, user_id, recipe_slug, recipe_title, recipe_emoji, recipe_cuisine, recipe_category, rating, notes, diners, cooked_at, xp_earned")
        .gte("cooked_at", windowStart.toISOString())
        .lt("cooked_at",  today.toISOString())  // strictly before today — today's cooks land under TODAY via the scheduled_meals + live state, not as "past"
        .order("cooked_at", { ascending: false });
      if (!alive) return;
      if (error) { console.warn("[past cooks] load failed:", error.message); setPastCooks([]); return; }
      setPastCooks(data || []);
    })();
    return () => { alive = false; };
  }, [userId, familyKey, windowStart, today]);

  // UI state
  const [addingForDay, setAddingForDay] = useState(null);       // Date picked via "+"
  // Meal slot pre-selected when the user tapped "+ add" on a
  // specific slot row (breakfast / lunch / dinner) rather than the
  // day-level "+ ADD" button. SchedulePicker seeds its mealSlot
  // state from this when present. null = let the picker default.
  const [addingForSlot, setAddingForSlot] = useState(null);
  const [recipeToSchedule, setRecipeToSchedule] = useState(null); // Recipe picked from modal
  const [isRequesting, setIsRequesting] = useState(false);       // "Request" mode vs. "I'll cook"
  const [openMeal, setOpenMeal] = useState(null);                // Meal tapped to view
  const [cookingRecipe, setCookingRecipe] = useState(null);      // Recipe now in CookMode

  // Auto-scroll the TODAY card into view on first mount — with 7 past
  // days above today, the default scroll-top lands on a week ago, which
  // is the wrong anchor for a tab whose primary job is \"what's on the
  // board now?\". Scroll once, not on every rerender.
  const todayRef = useRef(null);
  const didScrollToTodayRef = useRef(false);
  useEffect(() => {
    if (didScrollToTodayRef.current) return;
    if (!todayRef.current) return;
    todayRef.current.scrollIntoView({ block: "start", behavior: "auto" });
    didScrollToTodayRef.current = true;
  });

  // If user tapped a meal → Cook Now, CookMode takes over the whole tab.
  // Pantry + shoppingList wiring is identical to the Cook tab's path so
  // "ADD MISSING TO SHOPPING LIST" works regardless of where you started.
  if (cookingRecipe) {
    return (
      <CookMode
        recipe={cookingRecipe}
        onExit={() => setCookingRecipe(null)}
        onDone={() => setCookingRecipe(null)}
        pantry={pantry}
        setPantry={setPantry}
        shoppingList={shoppingList}
        setShoppingList={setShoppingList}
        onGoToShopping={onGoToShopping}
        userId={userId}
        family={family}
        friends={friends}
      />
    );
  }

  const byDay = bucketByDay(meals);

  // Bucket past cooks onto their cooked_at local day so each day card can
  // render a \"✓ cooked\" section below its planned meals. Separate map so
  // the ordering inside a day (planned above cooked) stays deterministic.
  const cooksByDay = useMemo(() => {
    const map = new Map();
    for (const c of pastCooks) {
      const d = new Date(c.cooked_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return map;
  }, [pastCooks]);

  const onPickRecipe = (recipe) => {
    setRecipeToSchedule(recipe);
  };

  const onSaveSchedule = async ({ scheduledFor, notificationSettings, note, cookId, isRequest, servings }) => {
    await schedule({
      recipeSlug: recipeToSchedule.slug,
      scheduledFor,
      notificationSettings,
      note,
      cookId,
      isRequest,
      servings,
    });
    setIsRequesting(false);
  };

  const firstName = profile?.name?.trim().split(/\s+/)[0];
  const userName = firstName;

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
          Scroll back through last week, schedule the next one.
        </div>
      </div>

      <div style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        {days.map((d, i) => {
          const key = dayKey(d);
          const dayMeals = byDay.get(key) || [];
          const dayCooks = cooksByDay.get(key) || [];
          const isToday  = d.getTime() === today.getTime();
          const isPast   = d.getTime() < today.getTime();
          const daysAgo  = Math.round((today.getTime() - d.getTime()) / 86400000);
          // Past day cards read as a diary entry — dimmer, different top
          // accent, no + ADD or REQUEST buttons. Scheduled meals that
          // landed in the past are rendered as "missed" (no action, grey
          // label). Completed cook_logs are the primary content.
          const hasContent = dayMeals.length > 0 || dayCooks.length > 0;
          const dateLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

          return (
            <div key={key}
              ref={isToday ? todayRef : undefined}
              style={{
                background: isToday ? "#1a1408" : isPast ? "#0f0f0f" : "#141414",
                border: `1px solid ${isToday ? "#f5c84233" : isPast ? "#1a1a1a" : "#1e1e1e"}`,
                borderRadius: 16, padding: "14px 16px",
                opacity: isPast ? 0.82 : 1,
                scrollMarginTop: 24,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: hasContent ? 10 : 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: isToday ? "#f5c842" : isPast ? "#555" : "#666", letterSpacing: "0.12em" }}>
                    {isToday
                      ? "TODAY"
                      : isPast
                        ? (daysAgo === 1 ? "YESTERDAY" : DAY_SHORTS[d.getDay()])
                        : (i - PAST_DAYS === 1 ? "TOMORROW" : DAY_SHORTS[d.getDay()])}
                  </div>
                  <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontStyle: "italic", fontWeight: 300, color: isToday ? "#f0ece4" : isPast ? "#888" : "#aaa" }}>
                    {dateLabel}
                  </div>
                </div>
                {!isPast && (
                  <div style={{ display: "flex", gap: 6 }}>
                    {hasFamily && (
                      <button
                        onClick={() => { setIsRequesting(true); setAddingForDay(d); }}
                        title="Ask family to cook something"
                        style={{
                          background: "#1a1a1a", border: "1px solid #2a2a2a",
                          borderRadius: 20, padding: "4px 10px",
                          fontFamily: "'DM Mono',monospace", fontSize: 10,
                          color: "#d9b877", letterSpacing: "0.08em", cursor: "pointer",
                        }}
                      >
                        🙋 REQUEST
                      </button>
                    )}
                    <button
                      onClick={() => { setIsRequesting(false); setAddingForDay(d); }}
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
                )}
              </div>

              {/* Three-slot grid — breakfast / lunch / dinner rows
                  always rendered so every day surfaces the same
                  shape at a glance. Filled slots render their meal
                  or cook; empty future slots expose a "+" tap to
                  schedule directly into that specific slot.
                  Bucketing: prefer meal_slot (migration 0069) when
                  present, else infer from scheduled_for / cooked_at
                  hour. Cooks + scheduled meals can share a slot —
                  past cooks land on the same day's row. */}
              {(() => {
                // Bucket both scheduled meals and past cooks by slot.
                const bySlot = { breakfast: [], lunch: [], dinner: [] };
                for (const m of dayMeals) {
                  const s = slotForTime(m.scheduled_for, m.meal_slot);
                  if (bySlot[s]) bySlot[s].push({ kind: "meal", row: m });
                }
                for (const c of dayCooks) {
                  const s = slotForTime(c.cooked_at);
                  if (bySlot[s]) bySlot[s].push({ kind: "cook", row: c });
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {PLAN_SLOTS.map(slot => {
                      const entries = bySlot[slot.id];
                      const hasEntries = entries.length > 0;
                      return (
                        <div key={slot.id}>
                          {/* Slot header — visible every row even when empty,
                              so the day always reads as a three-meal shape. */}
                          <div style={{
                            fontFamily: "'DM Mono',monospace", fontSize: 9,
                            color: "#555", letterSpacing: "0.12em",
                            marginBottom: 4, display: "flex", alignItems: "center", gap: 6,
                          }}>
                            <span>{slot.emoji}</span>
                            <span>{slot.label.toUpperCase()}</span>
                          </div>
                          {hasEntries ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {entries.map(({ kind, row }) => {
                                if (kind === "cook") {
                                  const chef = nameFor ? nameFor(row.user_id) : "";
                                  const isMine = row.user_id === userId;
                                  const time = new Date(row.cooked_at);
                                  return (
                                    <button
                                      key={`cook-${row.id}`}
                                      onClick={() => onOpenCook?.(row.id)}
                                      style={{
                                        display: "flex", alignItems: "center", gap: 12,
                                        padding: "10px 12px",
                                        background: "#0f140f", border: "1px solid #1e3a1e",
                                        borderRadius: 12, cursor: "pointer", textAlign: "left",
                                      }}
                                    >
                                      <span style={{ fontSize: 22, flexShrink: 0 }}>{row.recipe_emoji || "🍽️"}</span>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 14, color: "#f0ece4", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {row.recipe_title}
                                        </div>
                                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#6b8a6b", marginTop: 2, letterSpacing: "0.05em" }}>
                                          ✓ COOKED · {fmtTime(time).toUpperCase()}{isMine ? " · YOU" : chef ? ` · ${chef.toUpperCase()}` : ""}
                                          {Array.isArray(row.diners) && row.diners.length > 0 ? ` · ${row.diners.length} DINER${row.diners.length === 1 ? "" : "S"}` : ""}
                                        </div>
                                      </div>
                                      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#4ade80", letterSpacing: "0.08em" }}>→</span>
                                    </button>
                                  );
                                }
                                // Scheduled meal
                                const meal = row;
                                const recipe = findRecipe(meal.recipe_slug, findUserRecipe);
                                const activeNotifs = Object.values(meal.notification_settings || {}).filter(Boolean).length;
                                const isRequest = meal.cook_id == null;
                                const cookLabel = isRequest
                                  ? `Requested by ${nameFor ? nameFor(meal.user_id) : "someone"}`
                                  : `Cooking: ${nameFor ? nameFor(meal.cook_id) : ""}`;
                                return (
                                  <button
                                    key={`meal-${meal.id}`}
                                    onClick={() => setOpenMeal(meal)}
                                    style={{
                                      display: "flex", alignItems: "center", gap: 12,
                                      padding: "12px 14px",
                                      background: isRequest ? "#1e1408" : "#0f0f0f",
                                      border: `1px solid ${isRequest ? "#3a2a15" : "#1e1e1e"}`,
                                      borderRadius: 12, cursor: "pointer", textAlign: "left",
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
                                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: isRequest ? "#d9b877" : "#555", letterSpacing: "0.05em", marginTop: 3 }}>
                                        {isRequest && "🙋 "}{cookLabel}
                                        {meal.servings != null && ` · 👥 ${meal.servings}`}
                                        {recipe && ` · ${totalTimeMin(recipe)} MIN`}
                                        {activeNotifs > 0 && ` · 🔔 ${activeNotifs}`}
                                        {meal.note && " · 📝"}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          ) : isPast ? (
                            <div style={{
                              padding: "8px 12px",
                              fontFamily: "'DM Sans',sans-serif", fontSize: 11,
                              color: "#333", fontStyle: "italic",
                            }}>
                              —
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setIsRequesting(false);
                                setAddingForSlot(slot.id);
                                setAddingForDay(d);
                              }}
                              style={{
                                width: "100%", textAlign: "left",
                                padding: "8px 12px",
                                background: "transparent",
                                border: "1px dashed #2a2a2a",
                                borderRadius: 10, cursor: "pointer",
                                fontFamily: "'DM Mono',monospace", fontSize: 10,
                                color: "#555", letterSpacing: "0.08em",
                              }}
                            >
                              + ADD {slot.label.toUpperCase()}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
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
          userRecipes={userRecipesList}
          onPick={onPickRecipe}
          onClose={() => { setAddingForDay(null); }}
        />
      )}
      {recipeToSchedule && (
        <SchedulePicker
          recipe={recipeToSchedule}
          initialDate={addingForDay}
          initialSlot={addingForSlot}
          userId={userId}
          userName={userName}
          family={family}
          defaultRequest={hasFamily}
          onClose={() => { setRecipeToSchedule(null); setAddingForDay(null); setAddingForSlot(null); }}
          onSave={onSaveSchedule}
        />
      )}
      {openMeal && (
        <MealDetailDrawer
          meal={openMeal}
          recipe={findRecipe(openMeal.recipe_slug, findUserRecipe)}
          userId={userId}
          nameFor={nameFor}
          family={family}
          onClose={() => setOpenMeal(null)}
          onCookNow={() => {
            const r = findRecipe(openMeal.recipe_slug, findUserRecipe);
            setOpenMeal(null);
            if (!r) return;
            // If the scheduled meal carries a servings override
            // (SchedulePicker let the user scale on the way in),
            // hand CookMode the pre-scaled recipe so ingredient
            // amounts already reflect the cook's intent. No override
            // = original recipe passes through unchanged.
            const scaled = openMeal.servings && openMeal.servings !== r.serves
              ? scaleRecipe(r, openMeal.servings)
              : r;
            setCookingRecipe(scaled);
          }}
          onClaim={async () => {
            const updated = await claim(openMeal.id);
            setOpenMeal(updated);
          }}
          onUnclaim={async () => {
            const updated = await unclaim(openMeal.id);
            setOpenMeal(updated);
          }}
          onChangeCook={async (cookId) => {
            const updated = await updateMeal(openMeal.id, { cook_id: cookId });
            setOpenMeal(updated);
          }}
          onChangeServings={async (servings) => {
            const updated = await updateMeal(openMeal.id, { servings });
            setOpenMeal(updated);
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
