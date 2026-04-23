import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// CookBanner — the pinned "you've got a cook in progress" bar. Sits
// between the top of the app and the first tab content (above the
// bottom nav, below modals). Reads from useActiveCookSession; tapping
// the bar calls onResume(recipe) to reopen CookMode on whatever step
// the user was on.
//
// Visual contract (top-down):
//   Row 1: emoji + "Cooking {recipeTitle}"       STEP N OF M ›
//   Row 2 (only if timerEndsAt in future):
//          mm:ss countdown in DM Mono · progress bar
//   Row 3: "Tap to resume →"                           ✕
//
// The progress bar fills left → right as the timer elapses (orange);
// the last 10 seconds pulse red. When the timer is expired but the
// banner is still up (push delivered while user was elsewhere, or
// drain hasn't ticked yet), we show "TIMER'S UP" with a green flash
// instead of a negative countdown.
//
// Height: ~76px with timer, ~54px without. Slides down from top on
// first mount (framer-motion), slides up on dismiss.
//
// Z-index: 120. Above the bottom nav (100) and the admin pill (50),
// below modal sheets (160). Matches the token hierarchy in
// src/lib/tokens.js so stacked sheets still cover it.
//
// The banner does NOT own the cook lifecycle — it's a read-only view
// onto useActiveCookSession. Dismiss only hides the bar in the current
// tab session; the cook_sessions row stays active and the banner
// reappears on next page load.

export default function CookBanner({ active, onResume, onDismiss }) {
  const { session, recipe, activeStep, timerEndsAt, dismissed, refresh } = active;

  // Count steps so we can render "STEP 3 OF 6". Falls back to "—"
  // when the recipe couldn't be resolved (e.g. user recipe pruned).
  const totalSteps = recipe?.steps?.length || 0;
  const stepIndex  = useMemo(() => {
    if (!activeStep || !recipe?.steps?.length) return 0;
    const idx = recipe.steps.findIndex(s => String(s.id) === String(activeStep.step_id));
    return idx >= 0 ? idx + 1 : 0;
  }, [activeStep, recipe?.steps]);

  // Live countdown — ticks every 500ms while timerEndsAt is in the
  // future. Separate from the server-side drain: we just need a smooth
  // mm:ss for the eye. When the deadline passes, we freeze on
  // "TIMER'S UP" until the row is cleared (drain deletes it, or
  // finishStep cancels).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timerEndsAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [timerEndsAt]);

  const visible = Boolean(session && recipe && !dismissed);

  // Render nothing when there's no cook. Keep the AnimatePresence so
  // the slide-up exit animation plays on dismiss.
  const remainingMs = timerEndsAt ? new Date(timerEndsAt).getTime() - now : null;
  const remainingSec = remainingMs != null ? Math.max(0, Math.ceil(remainingMs / 1000)) : null;
  const timerDone = remainingMs != null && remainingMs <= 0;
  const mins = remainingSec != null ? Math.floor(remainingSec / 60) : 0;
  const secs = remainingSec != null ? remainingSec % 60 : 0;
  const pulsing = remainingSec != null && remainingSec > 0 && remainingSec <= 10;

  // Progress fill — uses nominal_seconds stamped on the step row so
  // we don't need to look up the recipe step's `.timer`. Falls back
  // to 0% / 100% at the edges.
  const nominal = Number(activeStep?.nominal_seconds) || 0;
  const progressPct = nominal > 0 && remainingSec != null
    ? Math.max(0, Math.min(100, ((nominal - remainingSec) / nominal) * 100))
    : null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="cook-banner"
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            maxWidth: 480,
            margin: "0 auto",
            zIndex: 120,
            background: timerDone
              ? "linear-gradient(180deg,#15301a 0%,#0f1a0f 100%)"
              : "linear-gradient(180deg,#231509 0%,#170d05 100%)",
            borderBottom: `2px solid ${timerDone ? "#2f6d3a" : "#4a3a10"}`,
            boxShadow: timerDone
              ? "0 10px 28px rgba(34,197,94,0.25), 0 4px 10px rgba(0,0,0,0.5)"
              : "0 10px 28px rgba(245,200,66,0.18), 0 4px 10px rgba(0,0,0,0.5)",
            padding: "14px 18px 14px",
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => onResume?.(recipe, session)}
          role="button"
          aria-label={`Resume cooking ${recipe.title}`}
        >
          {/* Row 1 — identity */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 28, flexShrink: 0, lineHeight: 1 }}>
              {recipe.emoji || session.recipe_emoji || "👨‍🍳"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "'DM Mono',monospace", fontSize: 10,
                color: timerDone ? "#4ade80" : "#f5c842",
                letterSpacing: "0.16em",
                marginBottom: 2,
              }}>
                {timerDone ? "⏰ TIMER'S UP — TAP TO FINISH" : "COOKING · TAP TO RESUME"}
              </div>
              <div style={{
                fontFamily: "'Fraunces',serif", fontStyle: "italic",
                fontSize: 19, lineHeight: 1.15,
                color: "#f5f5f0",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {recipe.title}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {totalSteps > 0 && stepIndex > 0 && (
                <span style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  color: "#b8a878", letterSpacing: "0.12em",
                  background: "#1a1508", border: "1px solid #3a2f10",
                  padding: "5px 9px", borderRadius: 5,
                  fontWeight: 600,
                }}>
                  STEP {stepIndex}/{totalSteps}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
                aria-label="Dismiss banner"
                style={{
                  background: "transparent", border: "none", color: "#777",
                  fontSize: 20, cursor: "pointer", padding: "4px 8px",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Row 2 — live countdown + progress bar */}
          {remainingSec != null && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                display: "flex", alignItems: "baseline", gap: 12,
                fontFamily: "'DM Mono',monospace",
              }}>
                <span style={{
                  fontSize: 32, letterSpacing: "0.04em", fontWeight: 600,
                  color: timerDone ? "#4ade80" : pulsing ? "#ef4444" : "#f59e0b",
                  animation: pulsing ? "cookBannerPulse 1s ease-in-out infinite" : "none",
                  textShadow: pulsing ? "0 0 16px rgba(239,68,68,0.5)" : "none",
                }}>
                  {timerDone ? "0:00" : `${mins}:${String(secs).padStart(2, "0")}`}
                </span>
                <span style={{ fontSize: 11, color: "#999", letterSpacing: "0.14em", fontWeight: 500 }}>
                  {activeStep?.step_title ? activeStep.step_title.toUpperCase() : "TIMER"}
                </span>
              </div>
              {progressPct != null && (
                <div style={{
                  marginTop: 9, height: 5, borderRadius: 3,
                  background: "#2a1f10", overflow: "hidden",
                }}>
                  <div style={{
                    width: `${progressPct}%`, height: "100%",
                    background: timerDone ? "#4ade80" : pulsing ? "#ef4444" : "#f59e0b",
                    transition: "width 0.5s linear, background 0.3s",
                    boxShadow: pulsing ? "0 0 10px rgba(239,68,68,0.6)" : "none",
                  }} />
                </div>
              )}
            </div>
          )}

          <style>{`
            @keyframes cookBannerPulse {
              0%,100% { opacity: 1; }
              50%     { opacity: 0.55; }
            }
          `}</style>

          {/* Refresh trigger kept alive via any state change inside
              the banner — when the user taps dismiss, the parent hook
              state resets on next session change. Nothing to wire here,
              but the refresh is available for future admin actions. */}
          {/* eslint-disable-next-line no-unused-expressions */}
          {refresh && null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
