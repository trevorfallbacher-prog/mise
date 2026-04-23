// Prep-notification scheduling — translates a recipe's prep-step metadata
// into rows in public.prep_notifications keyed to a specific scheduled
// meal. Called by useScheduledMeals whenever a meal is created, the
// scheduled_for changes, or the notification_settings toggle map moves.
//
// Why the client computes these rows instead of a DB trigger:
// recipes live in src/data/recipes/*.js (imported JS modules), not in
// the database. A DB trigger on scheduled_meals has no access to a
// recipe's prepSteps shape. The client already has the recipe loaded
// when the user schedules, so this is the natural place to translate
// "recipe says T-30m marinate" into "insert prep_notifications row
// with deliver_at = scheduled_for - 30m".
//
// Idempotency: syncPrepNotifications DELETEs any existing rows for the
// scheduled_meal_id before inserting fresh, so reschedule/toggle is
// correct even if the same function ran a moment ago. The FK cascade
// on scheduled_meals handles the delete case.

import { supabase } from "./supabase";

/**
 * Parse a human-readable lead-time string into minutes.
 *   "T-30m"     → 30
 *   "T-2h"      → 120
 *   "T-1d"      → 1440
 *   "overnight" → 720    (12h — the effective freeze-overnight budget)
 *   42          → 42     (passthrough if already a number)
 *
 * Tolerant to author typos: case-insensitive, "T-" prefix optional,
 * whitespace ignored. Unknown formats return 0 so a typo doesn't
 * schedule a reminder 1970-01-01.
 */
export function parseLeadTime(input) {
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(0, input);
  if (!input) return 0;
  const s = String(input).trim().toLowerCase();
  if (s === "overnight") return 12 * 60;
  if (s === "same-day")  return 4  * 60;
  const m = s.match(/^t?-?\s*(\d+)\s*([mhd])$/);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return 0;
  const unit = m[2];
  if (unit === "m") return n;
  if (unit === "h") return n * 60;
  if (unit === "d") return n * 24 * 60;
  return 0;
}

/**
 * Normalize a recipe's prep-step metadata into a flat array of
 * { key, leadMinutes, title, body, emoji, defaultOn, source }.
 *
 * Sources, in descending priority:
 *   1. recipe.prepSteps — new structured shape (preferred).
 *   2. recipe.prepNotifications — legacy shape with leadTime strings.
 *   3. Auto-derived fallback: if the recipe has time.prep set but no
 *      authored steps at all, emit a single "Start prepping" reminder
 *      so every scheduled meal gets at least ONE useful ping.
 */
export function resolvePrepSteps(recipe) {
  if (!recipe) return [];
  const out = [];
  const seen = new Set();

  for (const s of recipe.prepSteps || []) {
    const key = s.id || s.key;
    if (!key || seen.has(key)) continue;
    const leadMinutes = typeof s.leadMinutes === "number"
      ? s.leadMinutes
      : parseLeadTime(s.leadTime);
    if (leadMinutes <= 0) continue;
    out.push({
      key,
      leadMinutes,
      title: s.title || "Prep reminder",
      body: s.body || s.text || "",
      emoji: s.emoji || (leadMinutes >= 6 * 60 ? "🧊" : "⏰"),
      defaultOn: s.defaultOn !== false,
      source: s.source
        || (leadMinutes >= 6 * 60 ? "freeze_overnight" : "recipe_prep"),
    });
    seen.add(key);
  }

  for (const n of recipe.prepNotifications || []) {
    const key = n.id;
    if (!key || seen.has(key)) continue;
    const leadMinutes = parseLeadTime(n.leadTime);
    if (leadMinutes <= 0) continue;
    out.push({
      key,
      leadMinutes,
      title: "Prep reminder",
      body: n.text || "",
      emoji: "⏰",
      defaultOn: n.defaultOn !== false,
      source: "recipe_prep",
    });
    seen.add(key);
  }

  if (out.length === 0 && recipe.time?.prep) {
    const prep = Number(recipe.time.prep) || 0;
    // Fire a little before prep time kicks in so the user has a
    // runway to wash hands / pull tools.
    const leadMinutes = prep + 5;
    out.push({
      key: "start-prep",
      leadMinutes,
      title: "Start prepping " + (recipe.title || "your meal"),
      body: "Pull everything out, read the recipe top-to-bottom before the burners go on.",
      emoji: "🥕",
      defaultOn: true,
      source: "recipe_prep",
    });
  }

  return out;
}

/**
 * Return `true` if the user has opted-IN for this prep key on this
 * specific meal. `notification_settings` is a JSONB toggle map stored
 * on scheduled_meals (migration 0003); missing keys fall through to
 * the step's defaultOn value.
 */
export function prepEnabled(notificationSettings, step) {
  const v = notificationSettings?.[step.key];
  if (v === true) return true;
  if (v === false) return false;
  return !!step.defaultOn;
}

/**
 * Insert prep_notifications rows for a scheduled meal. Idempotent:
 * deletes rows for this meal then reinserts the enabled ones. Returns
 * the number of rows queued.
 *
 *   scheduledMeal — a row from public.scheduled_meals
 *   recipe        — the recipe object (imported from src/data/recipes)
 *   userId        — who the reminders fire for (typically the cook)
 *
 * Fire-and-forget from callers; the function catches its own errors
 * and warns, because a failure to queue prep reminders should never
 * block the main meal-scheduling flow.
 */
export async function syncPrepNotifications({ scheduledMeal, recipe, userId }) {
  if (!scheduledMeal?.id || !recipe || !userId) return 0;
  try {
    // Clean slate: reschedule semantics are "replace the whole set".
    await supabase.from("prep_notifications")
      .delete()
      .eq("scheduled_meal_id", scheduledMeal.id);

    const steps = resolvePrepSteps(recipe);
    const settings = scheduledMeal.notification_settings || {};
    const scheduledForMs = new Date(scheduledMeal.scheduled_for).getTime();
    if (!Number.isFinite(scheduledForMs)) return 0;

    const rows = steps
      .filter(s => prepEnabled(settings, s))
      .map(s => {
        const deliverAt = new Date(scheduledForMs - s.leadMinutes * 60_000).toISOString();
        return {
          user_id:           userId,
          scheduled_meal_id: scheduledMeal.id,
          recipe_slug:       scheduledMeal.recipe_slug,
          prep_key:          s.key,
          title:             s.title,
          body:              s.body,
          emoji:             s.emoji,
          lead_minutes:      s.leadMinutes,
          deliver_at:        deliverAt,
          source:            s.source,
        };
      });

    if (rows.length === 0) return 0;

    const { error } = await supabase
      .from("prep_notifications")
      .insert(rows);
    if (error) {
      console.warn("[prepScheduler] insert failed:", error);
      return 0;
    }
    return rows.length;
  } catch (e) {
    console.warn("[prepScheduler] sync threw:", e);
    return 0;
  }
}
