import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

// Cook telemetry — per-step start/finish timestamps written to
// cook_sessions / cook_session_steps (migration 0136) so the app can
// eventually calibrate prep-notification lead times against real data.
//
// Distinct from useCookSession.js (shared override state between
// CookMode and CookComplete — swaps, extras). This hook ONLY deals
// with durations; nothing it writes affects the live UI.
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

  const startStep = useCallback(async ({ stepId, stepTitle, nominalSeconds } = {}) => {
    const cur = sessionRef.current;
    if (!userId || !cur?.id || stepId == null) return null;
    try {
      // Auto-finish any still-open step — "tap next before timer rang"
      // would otherwise leave a dangling row that corrupts percentile math.
      const open = activeStepRef.current;
      if (open?.id && !open.finished_at) {
        await supabase.from("cook_session_steps")
          .update({ finished_at: new Date().toISOString() })
          .eq("id", open.id);
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
