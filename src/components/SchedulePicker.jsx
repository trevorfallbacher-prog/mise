import { useMemo, useState } from "react";
import { totalTimeMin, difficultyLabel, findRecipe } from "../data/recipes";
import { scaleRecipe } from "../lib/recipeScaling";
import { useScheduledMeals } from "../lib/useScheduledMeals";
import { useUserRecipes } from "../lib/useUserRecipes";
import { useWebPush } from "../lib/useWebPush";
import { resolvePrepSteps } from "../lib/prepScheduler";

// Meal slots — the structural-time axis the user wanted in place of
// (or alongside) raw HH:MM input. Default times per slot are
// reasonable middle-of-the-window picks; the user can still override
// via the TIME input below. Persisted on scheduled_meals.meal_slot
// (migration 0069) so Plan can surface 'DINNER · Thu 6:30 PM' instead
// of just 'Thu 6:30 PM'.
const MEAL_SLOTS = [
  { id: "breakfast", label: "Breakfast", emoji: "🥞", defaultTime: "08:00" },
  { id: "lunch",     label: "Lunch",     emoji: "🥪", defaultTime: "12:30" },
  { id: "dinner",    label: "Dinner",    emoji: "🍽️", defaultTime: "18:30" },
];
// Snack is NOT in the day-strip grid (keeps the grid to 3 clean rows).
// Users who want to schedule a snack can pick via the optional time
// override — snack falls out naturally from inferSlotFromTime. If
// this becomes a frequent ask we expand the grid to 4 rows.
const SNACK_SLOT = { id: "snack", label: "Snack", emoji: "🍎", defaultTime: "15:00" };
const ALL_SLOTS = [...MEAL_SLOTS, SNACK_SLOT];

// Infer a meal slot from an HH:MM string so the chip row lights up
// correctly when the scheduler opens with a pre-set time.
function inferSlotFromTime(timeStr) {
  const [h] = (timeStr || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "dinner";
  if (h < 10)  return "breakfast";
  if (h < 14)  return "lunch";
  if (h < 17)  return "snack";
  return "dinner";
}

// Local-tz date key "YYYY-MM-DD" for bucketing scheduled meals.
// Same shape the nutrition tally uses so consumers agree on "today."
function dayKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Infer the slot for an existing scheduled_meals row. Prefers the
// explicit meal_slot column (migration 0069), falls back to a
// time-based inference for pre-0069 rows so the grid still renders
// them in the right row.
function slotForMeal(meal) {
  if (meal?.meal_slot) return meal.meal_slot;
  if (!meal?.scheduled_for) return "dinner";
  const t = new Date(meal.scheduled_for);
  const hh = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  return inferSlotFromTime(hh);
}

// Format a JS Date as a local ISO-ish string for <input type="time"> ("HH:mm").
const hhmm = (d) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// Parse "HH:mm" into { hours, minutes }.
const parseHHMM = (s) => {
  const [h, m] = (s || "19:00").split(":").map(Number);
  return { hours: h || 0, minutes: m || 0 };
};

// Build the next N days starting at `start` (midnight local).
function buildDayStrip(start, count = 14) {
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }
  return days;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * SchedulePicker modal.
 *
 * Props:
 *   recipe         — the recipe to schedule
 *   initialDate    — optional Date the picker should default to
 *   userId         — current user id (for self-cook option)
 *   userName       — current user's first name (for "Me (Alex)" label)
 *   family         — [{ otherId, other: { name } }] from useRelationships
 *   defaultRequest — if true, the "Who's cooking?" picker defaults to REQUEST
 *   onClose()      — user dismissed
 *   onSave({ scheduledFor, notificationSettings, note, cookId, isRequest, servings })
 */
export default function SchedulePicker({
  recipe, initialDate, initialSlot, userId, userName, family = [], defaultRequest = false,
  onClose, onSave,
}) {
  // Push subscription for this device. Drives the "RING ME ON THE
  // LOCK SCREEN" prompt below — scheduling a meal with long-lead prep
  // (thaw chicken, freeze butter, marinate overnight) is useless if
  // the reminder can't reach a locked phone. One-tap enable keeps the
  // discovery moment attached to the action that benefits from it.
  const webPush = useWebPush(userId);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const days = useMemo(() => buildDayStrip(today, 14), [today]);

  // Existing scheduled meals in the visible window — drives the
  // filled-slot preview on the day grid. Window = start of today
  // through end of day+13 (14-day strip). Using the hook here means
  // SchedulePicker re-renders when the user schedules a meal from a
  // different surface; the grid stays honest.
  const { meals: existingMeals } = useScheduledMeals(userId, {
    fromISO: useMemo(() => today.toISOString(), [today]),
    toISO:   useMemo(() => {
      const end = new Date(today);
      end.setDate(end.getDate() + 14);
      end.setHours(23, 59, 59, 999);
      return end.toISOString();
    }, [today]),
  });
  // Matches the Plan pattern: useUserRecipes exposes a findBySlug
  // helper that combines user-authored recipes with the bundled
  // library. findRecipe(slug, findBySlug) resolves either source.
  const { findBySlug: findUserRecipe } = useUserRecipes(userId);

  // { "YYYY-MM-DD": { breakfast, lunch, dinner, snack } }.
  // Each value is the existing meal row (or undefined if empty).
  // First-wins on collision — a duplicate slot on the same day is
  // rare but possible; we just surface the earliest-scheduled one.
  const byDaySlot = useMemo(() => {
    const out = {};
    for (const m of existingMeals || []) {
      const k = dayKey(m.scheduled_for);
      if (!out[k]) out[k] = {};
      const slot = slotForMeal(m);
      if (!out[k][slot]) out[k][slot] = m;
    }
    return out;
  }, [existingMeals]);

  const [selectedDay, setSelectedDay] = useState(() => {
    if (initialDate) {
      const d = new Date(initialDate);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    return today;
  });
  // Meal slot drives the default time. Picking Dinner sets 6:30 PM;
  // picking Lunch sets 12:30 PM. User can still override the TIME
  // input to any HH:MM. Changing the time manually re-infers the
  // slot so the chip row always reflects which window they're in.
  // Seed slot + time from initialSlot when the caller pre-selected
  // one (e.g. Plan's "+ add to breakfast" tap on an empty slot row).
  // Falls back to dinner as the sensible default for users opening
  // the picker without a slot hint.
  const seededSlotId = (initialSlot && ALL_SLOTS.find(s => s.id === initialSlot))
    ? initialSlot
    : "dinner";
  const [mealSlot, setMealSlot] = useState(seededSlotId);
  const [timeStr,  setTimeStr]  = useState(() => {
    const slot = ALL_SLOTS.find(s => s.id === seededSlotId);
    return slot?.defaultTime || "18:30";
  });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // When the user picks a slot chip, snap time to that slot's default.
  // When they manually change the TIME input, re-infer the slot.
  const pickSlot = (slotId) => {
    const slot = MEAL_SLOTS.find(s => s.id === slotId);
    if (!slot) return;
    setMealSlot(slotId);
    setTimeStr(slot.defaultTime);
  };
  const pickTime = (t) => {
    setTimeStr(t);
    setMealSlot(inferSlotFromTime(t));
  };

  // Cook picker. "request" = nobody assigned yet, userId = self, other uuid = family
  // member. Default to request per user spec ("start as request until changed").
  const [cookChoice, setCookChoice] = useState(defaultRequest ? "request" : (userId || "request"));

  // Servings stepper. Seed from the recipe's default.
  const [servings, setServings] = useState(recipe.serves || 2);

  // Resolved prep steps — unifies the new recipe.prepSteps shape, the
  // legacy recipe.prepNotifications shape, AND the auto-synthesized
  // "start prepping" fallback. Rendering from this means every
  // recipe that has prep metadata shows the toggle UI, regardless of
  // which shape the author used. Before, the UI only rendered
  // prepNotifications and silently dropped prepSteps (which AI-
  // generated recipes use), so users scheduling those recipes never
  // saw reminders in the picker even though syncPrepNotifications
  // was queueing them server-side.
  const resolvedPrepSteps = useMemo(() => resolvePrepSteps(recipe), [recipe]);

  // Per-step opt-in state, keyed by step.key (from resolvePrepSteps).
  const [notifOpts, setNotifOpts] = useState(() => {
    const map = {};
    for (const s of resolvedPrepSteps) {
      map[s.key] = s.defaultOn !== false;
    }
    return map;
  });

  const toggleNotif = (id) =>
    setNotifOpts(prev => ({ ...prev, [id]: !prev[id] }));

  // Cook options: [ {id: "request", label: "Request — ask family"} , {id: userId, label: "Me (…)"}, ...family ]
  const cookOptions = useMemo(() => {
    const options = [
      { id: "request", label: "🙋 Request", hint: "Ask family to volunteer" },
    ];
    if (userId) {
      options.push({ id: userId, label: userName ? `${userName} (me)` : "Me", hint: "I'll cook it" });
    }
    for (const f of family) {
      if (f.otherId && f.other?.name) {
        const first = f.other.name.trim().split(/\s+/)[0];
        options.push({ id: f.otherId, label: first, hint: "Assign to them" });
      }
    }
    return options;
  }, [userId, userName, family]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const { hours, minutes } = parseHHMM(timeStr);
      const dt = new Date(selectedDay);
      dt.setHours(hours, minutes, 0, 0);
      const isRequest = cookChoice === "request";
      await onSave({
        scheduledFor: dt.toISOString(),
        notificationSettings: notifOpts,
        note: note.trim() || null,
        cookId: isRequest ? null : cookChoice,
        isRequest,
        servings,
        mealSlot,
      });
      onClose();
    } catch (e) {
      setError(e.message || "Couldn't save. Try again.");
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 300,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "20px 22px 40px",
        maxHeight: "92vh", overflowY: "auto",
      }}>
        <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 20px" }} />

        {/* Recipe header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 32 }}>{recipe.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>SCHEDULE</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {recipe.title}
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666" }}>
              {totalTimeMin(recipe)} min · {difficultyLabel(recipe.difficulty)}
            </div>
          </div>
        </div>

        {/* Day grid — each day is a vertical column of three slot
            cells (breakfast / lunch / dinner). Tapping a cell picks
            BOTH the day and the slot in one gesture; the gold border
            marks the target for this schedule-save. Cells that already
            hold a scheduled meal render its recipe emoji so the grid
            doubles as a 14-day glance at the week. Skipped meals are
            dimmed. The TIME input below lets power users nudge the
            exact clock time (and also unlocks the snack slot — scale
            outside the 3-row grid via time-based inference). */}
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 10 }}>WHEN</div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
          {days.map(d => {
            const isSelectedDay = d.getTime() === selectedDay.getTime();
            const isToday = d.getTime() === today.getTime();
            const k = dayKey(d);
            const filled = byDaySlot[k] || {};
            return (
              <div
                key={d.toISOString()}
                style={{
                  flexShrink: 0, width: 66,
                  display: "flex", flexDirection: "column", gap: 4,
                }}
              >
                {/* Day header — selectable separately to jump the
                    whole column without committing to a slot. */}
                <button
                  onClick={() => setSelectedDay(d)}
                  style={{
                    padding: "8px 0",
                    background: isSelectedDay ? "#1e1a0e" : "#141414",
                    border: `1px solid ${isSelectedDay ? "#f5c842" : "#242424"}`,
                    color: isSelectedDay ? "#f5c842" : "#bbb",
                    borderRadius: 10, cursor: "pointer",
                    fontFamily: "'DM Sans',sans-serif", transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.1em", opacity: 0.8 }}>
                    {isToday ? "TODAY" : DAY_LABELS[d.getDay()].toUpperCase()}
                  </div>
                  <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 400, marginTop: 0 }}>
                    {d.getDate()}
                  </div>
                </button>

                {/* Three slot cells — the user taps one to schedule
                    THIS recipe into that (day, slot). Filled cells
                    preview the existing meal; tapping overwrites the
                    target but the existing meal stays in the DB until
                    the user commits this new save. */}
                {MEAL_SLOTS.map(slot => {
                  const meal = filled[slot.id];
                  const selected = isSelectedDay && mealSlot === slot.id;
                  const skipped = meal?.status === "skipped";
                  const hasMeal = !!meal;
                  let existingRecipe = null;
                  if (hasMeal) {
                    existingRecipe = findRecipe(meal.recipe_slug, findUserRecipe) || null;
                  }
                  return (
                    <button
                      key={slot.id}
                      onClick={() => {
                        setSelectedDay(d);
                        pickSlot(slot.id);
                      }}
                      title={hasMeal
                        ? `${slot.label}: ${existingRecipe?.title || meal.recipe_slug}${skipped ? " (skipped)" : ""}`
                        : `${slot.label} — tap to schedule`}
                      style={{
                        height: 38, padding: "4px 2px",
                        background: selected
                          ? "#1e1a0e"
                          : hasMeal
                            ? (skipped ? "#0c0c0c" : "#141414")
                            : "#0f0f0f",
                        border: `1px solid ${selected
                          ? "#f5c842"
                          : hasMeal
                            ? (skipped ? "#1a1a1a" : "#2a2a2a")
                            : "#1e1e1e"}`,
                        borderRadius: 8, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                        opacity: skipped ? 0.35 : 1,
                        transition: "all 0.15s",
                      }}
                    >
                      {hasMeal ? (
                        <span style={{ fontSize: 18 }}>{existingRecipe?.emoji || "🍽️"}</span>
                      ) : (
                        <>
                          <span style={{ fontSize: 13, opacity: 0.6 }}>{slot.emoji}</span>
                          <span style={{
                            fontFamily: "'DM Mono',monospace", fontSize: 12,
                            color: selected ? "#f5c842" : "#444",
                          }}>
                            +
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Selected target line — plain-language confirmation of what
            this save will commit. Also reveals the TIME field so users
            who care about exact clock times (or want the snack slot)
            can nudge it. Collapsed by default behind a CUSTOMIZE TIME
            toggle to keep the picker simple. */}
        <div style={{ marginTop: 14, padding: "10px 12px", background: "#141414", border: "1px solid #242424", borderRadius: 10 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.08em" }}>
            {(() => {
              const slot = ALL_SLOTS.find(s => s.id === mealSlot);
              const label = slot?.label?.toUpperCase() || "DINNER";
              return `${label} · ${DAY_LABELS[selectedDay.getDay()]}, ${selectedDay.getDate()}`;
            })()}
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.08em" }}>
              TIME
            </label>
            <input
              type="time"
              value={timeStr}
              onChange={(e) => pickTime(e.target.value)}
              style={{
                flex: 1, padding: "6px 10px",
                background: "#0b0b0b", border: "1px solid #2a2a2a",
                borderRadius: 8, color: "#bbb",
                fontFamily: "'DM Mono',monospace", fontSize: 12,
                outline: "none", colorScheme: "dark",
              }}
            />
          </div>
        </div>

        {/* Who's cooking? */}
        <div style={{ marginTop: 22 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 10 }}>
            WHO'S COOKING?
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {cookOptions.map(opt => {
              const selected = cookChoice === opt.id;
              const isReq = opt.id === "request";
              return (
                <button
                  key={opt.id}
                  onClick={() => setCookChoice(opt.id)}
                  style={{
                    padding: "10px 14px",
                    background: selected ? (isReq ? "#1e1408" : "#1e1a0e") : "#161616",
                    border: `1px solid ${selected ? (isReq ? "#f5c842" : "#a3d977") : "#2a2a2a"}`,
                    color: selected ? (isReq ? "#f5c842" : "#a3d977") : "#888",
                    borderRadius: 20,
                    fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 6, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#555", lineHeight: 1.4 }}>
            {cookChoice === "request"
              ? "Family will see this as a request. Anyone can tap \"I'll cook this\" to claim it."
              : cookChoice === userId
              ? "You'll get the prep reminders."
              : "They'll be tagged as the cook."}
          </div>
        </div>

        {/* Servings stepper */}
        <div style={{ marginTop: 22 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 10 }}>
            HOW MANY PEOPLE EATING?
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 12, padding: "10px 14px" }}>
            <button
              onClick={() => setServings(s => Math.max(1, s - 1))}
              disabled={servings <= 1}
              style={{
                width: 36, height: 36, borderRadius: 18,
                background: "#0f0f0f", border: "1px solid #2a2a2a",
                color: servings <= 1 ? "#333" : "#f5c842", fontSize: 18,
                cursor: servings <= 1 ? "not-allowed" : "pointer",
              }}
            >−</button>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 28, color: "#f0ece4", fontWeight: 400 }}>
                {servings}
              </div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.08em" }}>
                {servings === 1 ? "PERSON" : "PEOPLE"}
              </div>
            </div>
            <button
              onClick={() => setServings(s => Math.min(20, s + 1))}
              disabled={servings >= 20}
              style={{
                width: 36, height: 36, borderRadius: 18,
                background: "#0f0f0f", border: "1px solid #2a2a2a",
                color: servings >= 20 ? "#333" : "#f5c842", fontSize: 18,
                cursor: servings >= 20 ? "not-allowed" : "pointer",
              }}
            >+</button>
          </div>
          {recipe.serves && servings !== recipe.serves && (() => {
            // Live scaling preview. Instead of nagging the user to
            // "scale ingredients accordingly" on their own, compute
            // the scaled recipe right here and show the new amounts.
            // Helps them sanity-check the scale before committing —
            // 6 cups of flour hits different than 1.5 cups.
            const scaled = scaleRecipe(recipe, servings);
            const scaledIngs = Array.isArray(scaled.ingredients) ? scaled.ingredients : [];
            if (!scaledIngs.length) return null;
            return (
              <div style={{ marginTop: 10, padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.08em", marginBottom: 8 }}>
                  SCALED FOR {servings} · from {recipe.serves}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {scaledIngs.slice(0, 8).map((ing, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ing.name}</span>
                      <span style={{ color: "#888", fontFamily: "'DM Mono',monospace", fontSize: 11, flexShrink: 0 }}>{ing.amount || ""}</span>
                    </div>
                  ))}
                  {scaledIngs.length > 8 && (
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.08em", marginTop: 4 }}>
                      + {scaledIngs.length - 8} MORE
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Prep reminders — renders from resolvePrepSteps so both
            authored prepSteps and legacy prepNotifications surface,
            plus the auto-synthesized fallback for recipes with no
            explicit prep metadata. */}
        {resolvedPrepSteps.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 10 }}>
              PREP REMINDERS
            </div>

            {/* Lock-screen push enable — shown ONLY when this recipe
                has long-lead prep (≥1 hour) that the user is
                expecting to reach them on a locked phone. A 15-min
                heads-up doesn't justify nagging for permission; a
                "thaw chicken 12 hours ahead" absolutely does. */}
            {webPush.supported &&
             !webPush.enabled &&
             webPush.permission !== "denied" &&
             resolvedPrepSteps.some(s => s.leadMinutes >= 60) && (
              <div style={{
                marginBottom: 10,
                padding: "12px 14px",
                background: "linear-gradient(180deg,#1e1408 0%,#170d05 100%)",
                border: "1px solid #3a2a0a",
                borderRadius: 12,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>🔔</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:700,
                    color:"#f5c842", letterSpacing:"0.14em", marginBottom:3,
                  }}>
                    RING ME ON THE LOCK SCREEN
                  </div>
                  <div style={{
                    fontFamily:"'DM Sans',sans-serif", fontSize:12,
                    color:"#bbb", lineHeight:1.4,
                  }}>
                    Prep reminders only reach your phone when it's locked if notifications are enabled.
                  </div>
                </div>
                <button
                  onClick={() => webPush.enable()}
                  disabled={webPush.busy}
                  style={{
                    flexShrink: 0,
                    padding: "9px 12px",
                    background: "#f5c842", color: "#111",
                    border: "none", borderRadius: 10,
                    fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:700,
                    letterSpacing:"0.08em", cursor: webPush.busy ? "not-allowed" : "pointer",
                    opacity: webPush.busy ? 0.5 : 1,
                  }}
                >
                  {webPush.busy ? "…" : "ENABLE"}
                </button>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {resolvedPrepSteps.map(s => {
                const on = notifOpts[s.key];
                // Human-readable lead label (e.g. "12h" or "30m before").
                const lead = s.leadMinutes >= 1440
                  ? `${Math.round(s.leadMinutes / 1440)}d`
                  : s.leadMinutes >= 60
                    ? `${Math.round(s.leadMinutes / 60)}h`
                    : `${s.leadMinutes}m`;
                return (
                  <button
                    key={s.key}
                    onClick={() => toggleNotif(s.key)}
                    style={{
                      textAlign: "left", display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 14px",
                      background: on ? "#1e1a0e" : "#111",
                      border: `1px solid ${on ? "#f5c84244" : "#1e1e1e"}`,
                      borderRadius: 12, cursor: "pointer", transition: "all 0.2s",
                    }}
                  >
                    <div style={{
                      width: 34, height: 20, borderRadius: 10, flexShrink: 0,
                      background: on ? "#f5c842" : "#2a2a2a",
                      position: "relative", transition: "background 0.2s",
                    }}>
                      <div style={{
                        position: "absolute", top: 2, left: on ? 16 : 2,
                        width: 16, height: 16, borderRadius: "50%",
                        background: on ? "#111" : "#888",
                        transition: "left 0.2s",
                      }} />
                    </div>
                    <div style={{ fontSize: 18, flexShrink: 0 }}>{s.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: on ? "#f0ece4" : "#888", lineHeight: 1.4, fontWeight: 500 }}>
                        {s.title}
                      </div>
                      {s.body && (
                        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: on ? "#999" : "#555", lineHeight: 1.3, marginTop: 2 }}>
                          {s.body}
                        </div>
                      )}
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", marginTop: 3, letterSpacing: "0.08em" }}>
                        {lead} BEFORE MEAL
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Optional note */}
        <div style={{ marginTop: 22 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>
            NOTE (OPTIONAL)
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For Sarah's birthday, try with 'nduja, etc."
            style={{
              width: "100%", padding: "12px 14px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              borderRadius: 10, color: "#f0ece4",
              fontFamily: "'DM Sans',sans-serif", fontSize: 13,
              outline: "none",
            }}
          />
        </div>

        {error && (
          <div style={{
            marginTop: 12, padding: "10px 12px",
            background: "#1a0f0f", border: "1px solid #3a1a1a",
            borderRadius: 10, fontFamily: "'DM Sans',sans-serif",
            fontSize: 13, color: "#f87171",
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, padding: "14px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              color: "#888", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12,
              cursor: "pointer", letterSpacing: "0.08em",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2, padding: "14px",
              background: "#f5c842", border: "none", color: "#111",
              borderRadius: 12, fontFamily: "'DM Mono',monospace", fontSize: 12,
              fontWeight: 600, letterSpacing: "0.08em",
              cursor: saving ? "progress" : "pointer",
              boxShadow: "0 0 30px #f5c84233",
            }}
          >
            {saving ? "SCHEDULING…" : "SCHEDULE IT →"}
          </button>
        </div>
      </div>
    </div>
  );
}
