import { useMemo, useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";
import { findIngredient, unitLabel } from "../data/ingredients";
import { useScheduledMeals } from "../lib/useScheduledMeals";

/**
 * ScheduleEatingSheet — "I'm going to eat this at lunch tomorrow."
 *
 * Opens from the pantry ItemCard SCHEDULE button. Companion to
 * IAteThisSheet: instead of logging a consumption event now, it
 * drops a row into scheduled_meals that points back at this pantry
 * row via from_pantry_row_id. When the scheduled time arrives, the
 * Plan UI routes the tap directly to IAteThisSheet on the same row
 * so the user confirms + logs the consumption then.
 *
 * The row is identified as an ingredient-eat schedule (not a cook)
 * by the combination of:
 *   - from_pantry_row_id set (the specific row to consume)
 *   - recipe_slug null when the pantry row isn't a leftover with
 *     cook provenance, or the source recipe slug when it is (so
 *     leftover-meal schedules still carry title/emoji via the
 *     recipe library, matching migration 0120's original flow)
 *
 * Minimal by design — date + meal slot + note. Amount/unit is NOT
 * collected here; that's IAteThisSheet's job when the user actually
 * sits down to eat. Keeps the scheduler a quick-entry affordance.
 *
 * Props:
 *   pantryRow — the pantry_items row to be consumed later.
 *               Requires { id, name, emoji, ingredientId|canonicalId }.
 *   userId    — creator for scheduled_meals.user_id.
 *   onClose() — dismiss.
 *   onDone(meal) — optional success callback with the inserted row.
 */

const MEAL_SLOTS = [
  { id: "breakfast", label: "Breakfast", emoji: "🥞", defaultTime: "08:00" },
  { id: "lunch",     label: "Lunch",     emoji: "🥪", defaultTime: "12:30" },
  { id: "dinner",    label: "Dinner",    emoji: "🍽️", defaultTime: "18:30" },
  { id: "snack",     label: "Snack",     emoji: "🍎", defaultTime: "15:00" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function inferSlot() {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 14) return "lunch";
  if (h < 17) return "snack";
  return "dinner";
}

export default function ScheduleEatingSheet({ pantryRow, userId, onClose, onDone }) {
  const canonicalId = pantryRow?.ingredientId || pantryRow?.canonicalId || null;
  const canonical = canonicalId ? findIngredient(canonicalId) : null;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const days = useMemo(() => buildDayStrip(today, 14), [today]);

  const [selectedDay, setSelectedDay] = useState(today);
  const [mealSlot,    setMealSlot]    = useState(() => inferSlot());
  const [note,        setNote]        = useState("");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState(null);

  const { schedule } = useScheduledMeals(userId);

  const confirm = async () => {
    if (!userId) { setError("Not signed in."); return; }
    if (!pantryRow?.id) { setError("Missing pantry row."); return; }
    setError(null);
    setSaving(true);
    try {
      // Compose scheduled_for by stamping the selected day with the
      // slot's default wall-clock time. Users who want a specific
      // minute override can edit it later from the Plan calendar.
      const slot = MEAL_SLOTS.find(s => s.id === mealSlot) || MEAL_SLOTS[1];
      const [hh, mm] = slot.defaultTime.split(":").map(Number);
      const scheduledFor = new Date(selectedDay);
      scheduledFor.setHours(hh, mm, 0, 0);

      // Leftover meal rows carry a sourceRecipeSlug — preserve it so
      // the Plan calendar still shows the recipe title/emoji on the
      // scheduled slot. Pure ingredient rows pass null; migration
      // 0124 makes recipe_slug nullable and enforces that at least
      // one identity pointer (recipe_slug OR from_pantry_row_id) is
      // always present.
      const recipeSlug = pantryRow?.sourceRecipeSlug || null;

      const meal = await schedule({
        recipeSlug,
        scheduledFor: scheduledFor.toISOString(),
        mealSlot,
        fromPantryRowId: pantryRow.id,
        note: note.trim() || null,
      });
      onDone?.(meal);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Couldn't schedule — try again.");
    } finally {
      setSaving(false);
    }
  };

  const titleText = pantryRow?.name || canonical?.name || "Ingredient";
  const emojiText = pantryRow?.emoji || canonical?.emoji || "🍽️";
  const amountText = (() => {
    const n = Number(pantryRow?.amount);
    if (!Number.isFinite(n)) return null;
    const ul = unitLabel(canonical, pantryRow?.unit) || pantryRow?.unit || "";
    return `${n % 1 ? n.toFixed(2) : n} ${ul}`.trim();
  })();

  return (
    <ModalSheet onClose={onClose} zIndex={Z.picker} label="SCHEDULE TO EAT">
      <div style={{ padding: "4px 22px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div style={{ fontSize: 44, flexShrink: 0 }}>{emojiText}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 22, color: "#f0ece4", lineHeight: 1.15 }}>
              {titleText}
            </div>
            {amountText && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", marginTop: 4, letterSpacing: "0.08em" }}>
                IN PANTRY: {amountText}
              </div>
            )}
          </div>
        </div>

        {/* Day strip — 14 days starting today. Horizontal scroll keeps
            the sheet short on small screens. Selected day has the
            standard tan-on-dark treatment. */}
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 8 }}>
          WHEN
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none", marginBottom: 14 }}>
          {days.map(d => {
            const isSelected = d.getTime() === selectedDay.getTime();
            const isToday = d.getTime() === today.getTime();
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => setSelectedDay(d)}
                style={{
                  flexShrink: 0, width: 58, padding: "8px 0",
                  background: isSelected ? "#1e1a0e" : "#141414",
                  border: `1px solid ${isSelected ? "#f5c842" : "#242424"}`,
                  color: isSelected ? "#f5c842" : "#bbb",
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
            );
          })}
        </div>

        {/* Meal slot — same four-chip layout as IAteThisSheet for
            visual continuity. Default inferred from the current hour. */}
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 8 }}>
          MEAL
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {MEAL_SLOTS.map(s => {
            const active = s.id === mealSlot;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setMealSlot(s.id)}
                style={{
                  flex: 1, padding: "10px 0",
                  background: active ? "#f5c842" : "#141414",
                  border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                  color: active ? "#111" : "#bbb",
                  borderRadius: 10,
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  fontWeight: active ? 700 : 400,
                  cursor: "pointer", letterSpacing: "0.06em",
                }}
              >
                <div style={{ fontSize: 16, marginBottom: 2 }}>{s.emoji}</div>
                {s.label.toUpperCase()}
              </button>
            );
          })}
        </div>

        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Note (optional)…"
          rows={2}
          style={{
            width: "100%", padding: "10px 12px", marginBottom: 12,
            background: "#141414", border: "1px solid #2a2a2a", borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4",
            outline: "none", resize: "none", boxSizing: "border-box",
          }}
        />

        {error && (
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "#1a0f0f", border: "1px solid #3a1a1a", borderRadius: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#f87171" }}>
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={confirm}
          disabled={saving || !userId}
          style={{
            width: "100%", padding: "14px",
            background: saving || !userId ? "#1a1a1a" : "#f5c842",
            border: "none", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
            color: saving || !userId ? "#444" : "#111",
            cursor: saving || !userId ? "not-allowed" : "pointer",
            letterSpacing: "0.08em",
          }}
        >
          {saving ? "SCHEDULING…" : "SCHEDULE"}
        </button>
      </div>
    </ModalSheet>
  );
}
