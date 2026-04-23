import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

// Cook telemetry — per-step start/finish timestamps written to
// cook_sessions / cook_session_steps (migration 0136) so the app can
// eventually calibrate prep-notification lead times against real data.
//
// Also schedules mid-cook timer pushes via cook_step_notifications
// (migration 0137): when a step with a timer starts, a row gets
// queued with deliver_at = now + timer_seconds. The drain RPC fires
// it as a Web Push so the user can close the app during a 30-min
// braise and get pinged when it's time to act. finishStep / endCook
// delete any still-pending row so a user who advances early doesn't
// get a "flip the steak" push three minutes after they already did.
//
// Distinct from useCookSession.js (shared override state between
// CookMode and CookComplete — swaps, extras). This hook ONLY deals
// with durations + timer pushes; nothing it writes affects the live UI.
//
// The API is intentionally imperative. CookMode calls startCook() at
// the top of the cook flow, startStep() each time the user advances,
// finishStep() on timer-ring or manual tap, and endCook() on either
// finalize or abandon. Every method is fire-and-forget from the
// caller's perspective — failures log and swallow so the kitchen
// flow is never blocked by a logging hiccup.

/**
 * useCookTelemetry(userId)
 *   → { session, activeStep, startCook, startStep, finishStep, endCook }
 *
 * `session` is the current cook_sessions row (null until startCook).
 * `activeStep` is the most recent cook_session_steps row without a
 * finished_at, so UI can read "currently on step N" without tracking
 * its own pointer.
 */
export function useCookTelemetry(userId) {
  const [session, setSession] = useState(null);
  const [activeStep, setActiveStep] = useState(null);

  // Mirror in refs so end-of-cook unmount paths can reach the current
  // value without stale-closure pain.
  const sessionRef    = useRef(null);
  const activeStepRef = useRef(null);
  useEffect(() => { sessionRef.current    = session;    }, [session]);
  useEffect(() => { activeStepRef.current = activeStep; }, [activeStep]);

  const startCook = useCallback(async ({ recipeSlug, recipeTitle, recipeEmoji } = {}) => {
    if (!userId || !recipeSlug) return null;
    try {
      const { data, error } = await supabase
        .from("cook_sessions")
        .insert({
          user_id:      userId,
          recipe_slug:  recipeSlug,
          recipe_title: recipeTitle || null,
          recipe_emoji: recipeEmoji || null,
          status:       "active",
        })
        .select()
        .single();
      if (error) { console.warn("[cookTelemetry] startCook failed:", error); return null; }
      setSession(data);
      return data;
    } catch (e) {
      console.warn("[cookTelemetry] startCook threw:", e);
      return null;
    }
  }, [userId]);

  const startStep = useCallback(async ({ stepId, stepTitle, nominalSeconds, timerBody } = {}) => {
    const cur = sessionRef.current;
    if (!userId || !cur?.id || stepId == null) return null;
    try {
      // Auto-finish any still-open step — "tap next before timer rang"
      // would otherwise leave a dangling row that corrupts percentile math.
      // Also dismiss any pending timer push on the old step so a late
      // drain doesn't fire for a step the user already left behind.
      const open = activeStepRef.current;
      if (open?.id) {
        if (!open.finished_at) {
          await supabase.from("cook_session_steps")
            .update({ finished_at: new Date().toISOString() })
            .eq("id", open.id);
        }
        await supabase.from("cook_step_notifications")
          .delete()
          .eq("step_row_id", open.id)
          .is("delivered_at", null);
      }

      const { data, error } = await supabase
        .from("cook_session_steps")
        .insert({
          cook_session_id: cur.id,
          user_id:         userId,
          step_id:         String(stepId),
          step_title:      stepTitle || null,
          nominal_seconds: Number.isFinite(nominalSeconds) ? nominalSeconds : null,
        })
        .select()
        .single();
      if (error) { console.warn("[cookTelemetry] startStep failed:", error); return null; }
      setActiveStep(data);

      // Queue a timer push if this step has a countdown. No quiet-hours
      // shift applied — the user is actively cooking, pings are the
      // point. Body: "Step 4: Flip the steak" unless the caller passed
      // something richer.
      if (Number.isFinite(nominalSeconds) && nominalSeconds > 0) {
        const body = (timerBody && String(timerBody).trim())
          || (stepTitle
                ? `Timer's up — ${stepTitle}`
                : `Step ${stepId} — timer's up`);
        const deliverAt = new Date(Date.now() + nominalSeconds * 1000).toISOString();
        const { error: pushErr } = await supabase
          .from("cook_step_notifications")
          .insert({
            user_id:         userId,
            cook_session_id: cur.id,
            step_row_id:     data.id,
            step_id:         String(stepId),
            step_title:      stepTitle || null,
            recipe_title:    cur.recipe_title || null,
            recipe_emoji:    cur.recipe_emoji || null,
            body,
            timer_seconds:   nominalSeconds,
            deliver_at:      deliverAt,
          });
        if (pushErr) console.warn("[cookTelemetry] queue timer push failed:", pushErr);
      }

      return data;
    } catch (e) {
      console.warn("[cookTelemetry] startStep threw:", e);
      return null;
    }
  }, [userId]);

  const finishStep = useCallback(async ({ stepRowId, skipped = false, note = null } = {}) => {
    const id = stepRowId || activeStepRef.current?.id;
    if (!id) return null;
    try {
      const { data, error } = await supabase
        .from("cook_session_steps")
        .update({
          finished_at: new Date().toISOString(),
          skipped,
          note,
        })
        .eq("id", id)
        .select()
        .single();
      if (error) { console.warn("[cookTelemetry] finishStep failed:", error); return null; }

      // Cancel any pending timer push for this step — user advanced
      // early, the push would just be noise. Only target undelivered
      // rows so we don't leave delivered history dangling.
      await supabase.from("cook_step_notifications")
        .delete()
        .eq("step_row_id", id)
        .is("delivered_at", null);

      if (activeStepRef.current?.id === id) setActiveStep(null);
      return data;
    } catch (e) {
      console.warn("[cookTelemetry] finishStep threw:", e);
      return null;
    }
  }, []);

  const endCook = useCallback(async ({ cookLogId = null, status = "finished" } = {}) => {
    const cur = sessionRef.current;
    if (!cur?.id) return null;
    try {
      const open = activeStepRef.current;
      if (open?.id && !open.finished_at) {
        await supabase.from("cook_session_steps")
          .update({
            finished_at: new Date().toISOString(),
            skipped: status === "abandoned",
          })
          .eq("id", open.id);
      }

      // Purge any pending timer pushes for this session — the cook is
      // done, further pings would be nonsensical. FK cascade on session
      // delete would catch these too, but we keep the row for analytics;
      // just kill the unfired ones.
      await supabase.from("cook_step_notifications")
        .delete()
        .eq("cook_session_id", cur.id)
        .is("delivered_at", null);
      const { data, error } = await supabase
        .from("cook_sessions")
        .update({
          ended_at:    new Date().toISOString(),
          cook_log_id: cookLogId,
          status,
        })
        .eq("id", cur.id)
        .select()
        .single();
      if (error) { console.warn("[cookTelemetry] endCook failed:", error); return null; }
      setSession(null);
      setActiveStep(null);
      return data;
    } catch (e) {
      console.warn("[cookTelemetry] endCook threw:", e);
      return null;
    }
  }, []);

  return { session, activeStep, startCook, startStep, finishStep, endCook };
}
