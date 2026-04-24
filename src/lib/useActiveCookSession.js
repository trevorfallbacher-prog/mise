import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";
import { findRecipe } from "../data/recipes";
import { useUserRecipes } from "./useUserRecipes";

// useActiveCookSession — app-level "is there a cook in progress?" query.
//
// Reads cook_sessions (migration 0136) + joins the most-recent open
// cook_session_steps row so the banner knows which step is live, and
// the earliest-undelivered cook_step_notifications row so the banner
// can render an accurate mm:ss countdown tied to the same deadline
// that the server-side pg_cron drain fires on.
//
// Why a dedicated hook instead of reading from useCookTelemetry: the
// telemetry hook is OWNED by CookMode (it writes). The banner needs a
// READ view that stays live whether CookMode is mounted or not — the
// whole point is "user closed the cook view, banner still knows a cook
// is active." This hook subscribes via realtime so taps in another tab
// / the server-side drain deleting a row propagate without a refresh.
//
// Contract:
//   { session, recipe, activeStep, timerEndsAt, dismissed, dismiss,
//     undismiss, refresh, loading }
//
//   session        cook_sessions row, or null
//   recipe         resolved recipe object (bundled or user_recipes), or null
//   activeStep     the live cook_session_steps row (finished_at IS NULL), or null
//   timerEndsAt    ISO timestamp of the earliest pending cook_step_notification
//                  for this session, or null
//   dismissed      user hit the × on the banner in THIS tab session (in-memory)
//   dismiss/undismiss  control the above
//   refresh        force re-query (e.g. after CookMode explicitly ends cook)
//   loading        initial-load flag so the banner doesn't flicker

const ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000; // mirrors useCookTelemetry.startCook

export function useActiveCookSession(userId) {
  const [session, setSession]         = useState(null);
  const [activeStep, setActiveStep]   = useState(null);
  const [timerEndsAt, setTimerEndsAt] = useState(null);
  const [dismissed, setDismissed]     = useState(false);
  const [loading, setLoading]         = useState(true);
  const [tick, setTick]               = useState(0);  // manual refresh trigger

  // Resolver for user-authored recipes (custom / AI). findRecipe checks
  // bundled first, falls through to the user resolver — matches the
  // pattern used in CreateMenu / Plan.
  const { findBySlug: findUserRecipe } = useUserRecipes(userId);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  // ── Query ─────────────────────────────────────────────────────────
  // Fetch the most-recent active session for this user within the
  // 2-hour resume window. Filtering at the DB side keeps us honest
  // about which sessions are banner-worthy.
  useEffect(() => {
    if (!userId) { setSession(null); setActiveStep(null); setTimerEndsAt(null); setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
        const { data: sessions, error } = await supabase
          .from("cook_sessions")
          .select("id, recipe_slug, recipe_title, recipe_emoji, started_at, status")
          .eq("user_id", userId)
          .eq("status", "active")
          .gte("started_at", cutoff)
          .order("started_at", { ascending: false })
          .limit(1);
        if (!alive) return;
        if (error) { console.warn("[activeCook] session query:", error.message); setLoading(false); return; }
        const s = sessions?.[0] || null;
        setSession(s);
        if (!s) { setActiveStep(null); setTimerEndsAt(null); setLoading(false); return; }

        // Live step + pending timer in parallel — both scoped to this
        // session id. RLS on both tables already limits to self / family,
        // so we trust the returned rows.
        const [stepRes, timerRes] = await Promise.all([
          supabase
            .from("cook_session_steps")
            .select("id, step_id, step_title, started_at, finished_at, nominal_seconds")
            .eq("cook_session_id", s.id)
            .is("finished_at", null)
            .order("started_at", { ascending: false })
            .limit(1),
          supabase
            .from("cook_step_notifications")
            .select("deliver_at, delivered_at, step_row_id")
            .eq("cook_session_id", s.id)
            .is("delivered_at", null)
            .is("dismissed_at", null)
            .order("deliver_at", { ascending: true })
            .limit(1),
        ]);
        if (!alive) return;
        setActiveStep(stepRes.data?.[0] || null);
        setTimerEndsAt(timerRes.data?.[0]?.deliver_at || null);
        setLoading(false);
      } catch (e) {
        console.warn("[activeCook] refresh threw:", e?.message || e);
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId, tick]);

  // ── Realtime ──────────────────────────────────────────────────────
  // Tail changes to all three relevant tables so the banner converges
  // without a poll. One channel, three filters. Any event just triggers
  // a refresh — simpler than threading the row into state, and these
  // events are rare (a few per cook).
  useEffect(() => {
    if (!userId) return undefined;
    const channel = supabase
      .channel(`active-cook:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cook_sessions", filter: `user_id=eq.${userId}` },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cook_session_steps", filter: `user_id=eq.${userId}` },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cook_step_notifications", filter: `user_id=eq.${userId}` },
        () => refresh(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, refresh]);

  // ── Poll fallback ─────────────────────────────────────────────────
  // Realtime channels drop on network blips — a 30s poll ensures the
  // banner converges even if we missed a delete event (the common
  // failure mode: server-side drain deletes a cook_step_notifications
  // row and our subscription is in reconnect purgatory).
  useEffect(() => {
    if (!userId) return undefined;
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [userId, refresh]);

  // Resolve the recipe object. findRecipe checks bundled, then user.
  // Memoized on slug + the user resolver so swap to custom recipes
  // doesn't cache-miss the lookup.
  const recipe = useMemo(() => {
    if (!session?.recipe_slug) return null;
    return findRecipe(session.recipe_slug, findUserRecipe) || null;
  }, [session?.recipe_slug, findUserRecipe]);

  // Reset dismissal whenever the session identity changes — a new cook
  // deserves a fresh banner, even if the user dismissed the last one.
  const lastSessionIdRef = useRef(null);
  useEffect(() => {
    if (lastSessionIdRef.current !== session?.id) {
      setDismissed(false);
      lastSessionIdRef.current = session?.id || null;
    }
  }, [session?.id]);

  const dismiss   = useCallback(() => setDismissed(true), []);
  const undismiss = useCallback(() => setDismissed(false), []);

  return {
    session,
    recipe,
    activeStep,
    timerEndsAt,
    dismissed,
    dismiss,
    undismiss,
    refresh,
    loading,
  };
}
