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
      // Resume if an active session for this user + recipe was opened
      // within the last 2 hours. Covers page refresh mid-cook, tab
      // swap, accidental navigation away, browser crash. Window cap
      // keeps long-abandoned active sessions from being resurrected
      // the next time the user cooks the same dish.
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("cook_sessions")
        .select("*")
        .eq("user_id", userId)
        .eq("recipe_slug", recipeSlug)
        .eq("status", "active")
        .gte("started_at", twoHoursAgo)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        // Adopt the session without restoring the step pointer. The
        // consumer's own activeStep state drives which step is shown;
        // when they advance, our startStep auto-finishes any lingering
        // open rows from before the refresh so cook_duration_stats
        // stays clean. Attempting to auto-resume to the "right" step
        // index fights React's effect ordering in the consumer for
        // minimal UX gain.
        setSession(existing);
        return existing;
      }

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
      // Close any open step rows in this session. Covers:
      //   1. normal flow — the previous step's row is held in activeStepRef
      //   2. resume flow — activeStepRef is null after remount, but a
      //      refresh mid-cook leaves dangling open rows in the DB; find
      //      them by session_id and close them so cook_duration_stats
      //      doesn't exclude them forever.
      // Also delete any pending timer push tied to those rows so a late
      // drain doesn't fire for a step the user has already left behind.
      const { data: openRows } = await supabase
        .from("cook_session_steps")
        .select("id")
        .eq("cook_session_id", cur.id)
        .is("finished_at", null);
      if (openRows?.length) {
        const ids = openRows.map(r => r.id);
        const nowIso = new Date().toISOString();
        await supabase.from("cook_session_steps")
          .update({ finished_at: nowIso })
          .in("id", ids);
        await supabase.from("cook_step_notifications")
          .delete()
          .in("step_row_id", ids)
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
        // Calibration lookup (migration 0138) — if the global corpus
        // has enough observations for this recipe+step, use the p50
        // observed duration instead of the recipe author's nominal.
        // Threshold 5 is arbitrary but reasonable: small enough that
        // popular recipes calibrate fast, large enough that one fast-
        // cook outlier doesn't drag everyone's timer low. Fallback on
        // any RPC hiccup preserves the nominal — never ring the timer
        // shorter than the recipe says just because the lookup failed.
        let effectiveSeconds = nominalSeconds;
        try {
          const { data: obs } = await supabase.rpc("observed_step_duration", {
            p_recipe_slug: cur.recipe_slug,
            p_step_id:     String(stepId),
          });
          const row = Array.isArray(obs) ? obs[0] : obs;
          if (row && Number(row.sample_count) >= 5 && Number.isFinite(Number(row.p50_seconds))) {
            effectiveSeconds = Number(row.p50_seconds);
          }
        } catch (e) {
          // Calibration is best-effort; fall through to the nominal.
          console.warn("[cookTelemetry] calibration lookup skipped:", e?.message || e);
        }

        const body = (timerBody && String(timerBody).trim())
          || (stepTitle
                ? `Timer's up — ${stepTitle}`
                : `Step ${stepId} — timer's up`);
        const deliverAt = new Date(Date.now() + effectiveSeconds * 1000).toISOString();
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
            timer_seconds:   effectiveSeconds,
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

  // Fire the timer push immediately, bypassing the 60-second pg_cron
  // drain window. Called from the in-app Timer when it hits 0:00 —
  // because the client knows the exact deadline (wall-clock-accurate)
  // and can beat the next cron tick. Race-safe via a compare-and-set
  // on delivered_at: if cron got there first, the UPDATE returns 0
  // rows and we skip the notifications insert so the user doesn't see
  // two banners for the same ring.
  //
  // On success, the fanout trigger on notifications (migration 0053)
  // sends Web Push to all the user's push_subscriptions rows within
  // ~1 second total (DB insert → trigger → edge function → VAPID
  // sign → push service → device).
  //
  // Fire-and-forget; the in-app chime + local Notification have
  // already delivered the user-facing signal. If this network call
  // fails, cron will still fire the row on its next tick.
  const fireTimerPushNow = useCallback(async ({ stepRowId, body, emoji, recipeTitle, stepTitle } = {}) => {
    const cur = sessionRef.current;
    if (!userId || !cur?.id || !stepRowId) return;
    try {
      // Claim the pending push row. Only succeeds when delivered_at
      // is still null. `.select()` returns [] on no-match — our cue
      // that cron already beat us to it.
      const { data: claimed } = await supabase
        .from("cook_step_notifications")
        .update({ delivered_at: new Date().toISOString() })
        .eq("step_row_id", stepRowId)
        .is("delivered_at", null)
        .select("id");
      if (!claimed || claimed.length === 0) return;

      // Insert into notifications — the fanout trigger does the rest.
      await supabase.from("notifications").insert({
        user_id:     userId,
        actor_id:    userId,
        msg:         body || (stepTitle ? `Timer's up — ${stepTitle}` : "Step timer ended"),
        emoji:       emoji || "⏲️",
        kind:        "info",
        target_kind: "cook_session",
        target_id:   cur.id,
      });
    } catch (e) {
      console.warn("[cookTelemetry] fireTimerPushNow failed (cron will retry):", e?.message || e);
    }
  }, [userId]);

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

  return { session, activeStep, startCook, startStep, finishStep, endCook, fireTimerPushNow };
}
