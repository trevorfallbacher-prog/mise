import { useEffect, useMemo, useState } from "react";

/**
 * ReheatMode — full-screen, cook-screen-shaped walkthrough for a
 * pantry item's saved cook_instructions (migration 0125).
 *
 * Reuses CookMode's visual vocabulary — progress bar, step dots,
 * STEP N OF M kicker, big Fraunces italic step title, FOR THIS STEP
 * tile with heat badge + doneCue, per-step timer with start / reset —
 * but deliberately strips the machinery CookMode carries for full
 * recipes: no cook_logs write, no pantry decrement (decrement is the
 * IAteThisSheet's job on the next screen), no swap/skip, no uses[]
 * ingredient tiles (reheats don't need ingredient scaffolding), no
 * XP. The goal is "it looks and feels like the cook screen" without
 * re-running the full pantry/log plumbing that's already handled by
 * the consumption-log path.
 *
 * Finish lands back on the caller's amount-and-log screen. Exit
 * (user backs out) cancels the whole flow.
 *
 * Props:
 *   recipe   — recipe-shaped object from pantryRow.cookInstructions.
 *              Required: { title, emoji, steps: [...] }.
 *              Optional: reheat.primary.tips surface as a note above
 *              step 1; steps[].timer in SECONDS; steps[].heat;
 *              steps[].doneCue; steps[].tip; steps[].icon.
 *   emoji    — pantry row emoji override for the top bar.
 *   onFinish() — user tapped FINISH on the last step.
 *   onExit()   — user backed out mid-walkthrough.
 */

const HEAT_COLORS = {
  "low":          { bg: "#0f1410", fg: "#7ec87e", border: "#1e3a1e" },
  "medium-low":   { bg: "#141410", fg: "#c9a34e", border: "#3a2f10" },
  "medium":       { bg: "#1a1608", fg: "#e0a868", border: "#3a2f10" },
  "medium-high":  { bg: "#1a1008", fg: "#e07a3a", border: "#3a2010" },
  "high":         { bg: "#1a0808", fg: "#ef4d4d", border: "#3a1010" },
  "off":          { bg: "#0f0f0f", fg: "#666",    border: "#2a2a2a" },
};

function Timer({ seconds, onDone }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running,   setRunning]   = useState(false);
  const [done,      setDone]      = useState(false);

  useEffect(() => {
    if (!running || remaining <= 0) return;
    const id = setTimeout(() => setRemaining(r => {
      if (r <= 1) { setRunning(false); setDone(true); onDone?.(); return 0; }
      return r - 1;
    }), 1000);
    return () => clearTimeout(id);
  }, [running, remaining, onDone]);

  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div style={{
      padding: "14px 16px", marginTop: 16,
      background: done ? "#0f1a0f" : running ? "#1a1608" : "#0f0f0f",
      border: `1px solid ${done ? "#1e3a1e" : running ? "#3a2f10" : "#2a2a2a"}`,
      borderRadius: 12, textAlign: "center",
    }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.14em", marginBottom: 6 }}>
        {done ? "✓ READY" : running ? "HEATING" : "TIMER"}
      </div>
      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 40,
        color: done ? "#7ec87e" : running ? "#f5c842" : "#888",
        letterSpacing: "0.05em",
      }}>
        {mm}:{ss}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
        {!running && !done && (
          <button
            type="button"
            onClick={() => setRunning(true)}
            style={{
              padding: "8px 18px",
              background: "#f5c842", border: "none",
              color: "#111", borderRadius: 8,
              fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            ▶ START
          </button>
        )}
        {running && (
          <button
            type="button"
            onClick={() => setRunning(false)}
            style={{
              padding: "8px 18px",
              background: "transparent", border: "1px solid #2a2a2a",
              color: "#888", borderRadius: 8,
              fontFamily: "'DM Mono',monospace", fontSize: 11,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            PAUSE
          </button>
        )}
        {(done || (!running && remaining !== seconds)) && (
          <button
            type="button"
            onClick={() => { setRemaining(seconds); setRunning(false); setDone(false); }}
            style={{
              padding: "8px 18px",
              background: "transparent", border: "1px solid #2a2a2a",
              color: "#888", borderRadius: 8,
              fontFamily: "'DM Mono',monospace", fontSize: 11,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            RESET
          </button>
        )}
      </div>
    </div>
  );
}

export default function ReheatMode({ recipe, emoji, onFinish, onExit }) {
  const steps = useMemo(() => Array.isArray(recipe?.steps) ? recipe.steps : [], [recipe]);
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(() => new Set());

  // Guard against a malformed cook_instructions blob (no steps). The
  // caller should gate on `recipe.steps?.length > 0` before mounting
  // us, but a defensive early-return keeps a bad DB row from crashing
  // the whole card.
  if (steps.length === 0) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "#0a0a0a", zIndex: 400,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 24, textAlign: "center",
      }}>
        <div style={{ fontFamily: "'DM Sans',sans-serif", color: "#f87171", marginBottom: 18 }}>
          This item's cook instructions are missing the steps. Regenerate from the ItemCard.
        </div>
        <button
          onClick={onExit}
          style={{
            padding: "12px 24px",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            color: "#888", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12,
            letterSpacing: "0.1em", cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>
    );
  }

  const step = steps[activeStep];
  const progress = ((completedSteps.size) / steps.length) * 100;
  const isLast = activeStep === steps.length - 1;

  const onNext = () => {
    // Mark current complete, advance. On the last step this fires
    // the onFinish callback so the caller transitions to its own
    // amount-and-log screen.
    setCompletedSteps(prev => {
      const next = new Set(prev);
      next.add(activeStep);
      return next;
    });
    if (isLast) {
      onFinish?.();
      return;
    }
    setActiveStep(s => Math.min(s + 1, steps.length - 1));
  };

  const heatStyle = step.heat && HEAT_COLORS[step.heat];
  const topNote = recipe?.reheat?.primary?.tips || recipe?.reheat?.note || null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#0a0a0a", zIndex: 400,
      overflowY: "auto",
      display: "flex", justifyContent: "center",
    }}>
      <div style={{ width: "100%", maxWidth: 480, padding: "16px 22px 40px" }}>
        {/* Top bar — pantry row emoji + recipe title + exit. Matches
            CookMode's header rhythm: compact, not a full nav bar,
            exit on the right as a muted kicker. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 30, flexShrink: 0 }}>{emoji || recipe?.emoji || "♨"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#f5c842", letterSpacing: "0.14em" }}>
              ♨ REHEAT
            </div>
            <div style={{
              fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 18,
              color: "#f0ece4", lineHeight: 1.15,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {recipe?.title || "Reheat"}
            </div>
          </div>
          <button
            type="button"
            onClick={onExit}
            style={{
              padding: "6px 10px",
              background: "transparent", border: "1px solid #2a2a2a",
              color: "#666", borderRadius: 8,
              fontFamily: "'DM Mono',monospace", fontSize: 10,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            EXIT
          </button>
        </div>

        {/* Progress bar + STEP N OF M + completed count. Same geometry
            as CookMode.jsx:881-887 so the two screens read as the
            same grammar. */}
        <div style={{ height: 3, background: "#222", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", background: "#f5c842", borderRadius: 2, width: `${progress}%`, transition: "width 0.5s ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555" }}>
            STEP {activeStep + 1} OF {steps.length}
          </span>
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555" }}>
            {completedSteps.size} DONE
          </span>
        </div>

        {/* Step dots — tappable to jump back to an earlier step when
            the user realizes they missed a beat. Same visual language
            as CookMode:888-891. */}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveStep(i)}
              style={{
                width: completedSteps.has(i) || i === activeStep ? 24 : 8,
                height: 8, borderRadius: 4, border: "none", cursor: "pointer",
                background: completedSteps.has(i) ? "#22c55e" : i === activeStep ? "#f5c842" : "#333",
                transition: "all 0.3s",
              }}
            />
          ))}
        </div>

        {/* Optional top note from reheat.primary.tips — surfaces once
            above step 1 only (the scope of "watch out for this for
            the whole cook"). */}
        {topNote && activeStep === 0 && (
          <div style={{
            marginTop: 14, padding: "10px 12px",
            background: "#1a1608", border: "1px solid #3a2f10",
            borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
            color: "#e0a868", fontStyle: "italic", lineHeight: 1.45,
          }}>
            ⚠ {topNote}
          </div>
        )}

        {/* Step card — matches CookMode:893-899. Icon + STEP id kicker,
            big Fraunces italic title, instruction body. No animation
            primitive (reheats don't need that scaffolding); leaving
            a small hero emoji instead. */}
        <div style={{
          marginTop: 24,
          background: "#161616", border: "1px solid #2a2a2a",
          borderRadius: 20, padding: "28px 24px",
          display: "flex", flexDirection: "column", alignItems: "center",
        }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>{step.icon || "♨"}</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 8 }}>
              STEP {step.id || activeStep + 1}
            </div>
            <h2 style={{
              fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 300,
              fontStyle: "italic", letterSpacing: "-0.02em",
              margin: 0, color: "#f0ece4",
            }}>
              {step.title}
            </h2>
          </div>
          <div style={{
            marginTop: 18, fontFamily: "'DM Sans',sans-serif", fontSize: 15,
            color: "#ddd", lineHeight: 1.55, textAlign: "center",
          }}>
            {step.instruction}
          </div>
        </div>

        {/* Heat badge + doneCue band — same shape as CookMode's FOR
            THIS STEP tile but without the uses[] ingredient scaffold.
            Only renders when at least one of heat or doneCue is set. */}
        {(step.heat || step.doneCue) && (
          <div style={{
            marginTop: 16, padding: "14px 16px",
            background: "#14110a", border: "1px solid #2f2818",
            borderRadius: 12,
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {step.heat && heatStyle && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: heatStyle.fg, background: heatStyle.bg,
                  border: `1px solid ${heatStyle.border}`,
                  padding: "3px 8px", borderRadius: 6,
                }}>
                  🔥 {String(step.heat).toUpperCase()} HEAT
                </span>
              </div>
            )}
            {step.doneCue && (
              <div style={{
                fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                color: "#c9a34e", lineHeight: 1.5,
              }}>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.12em", color: "#888", marginRight: 6 }}>
                  DONE WHEN
                </span>
                {step.doneCue}
              </div>
            )}
          </div>
        )}

        {/* Per-step timer. timer is seconds on the recipe schema so
            we pass it through verbatim. Absent / zero = no timer
            shown for this step (prep and plating steps). */}
        {typeof step.timer === "number" && step.timer > 0 && (
          <Timer key={`timer-${activeStep}`} seconds={step.timer} />
        )}

        {/* Optional per-step tip — the recipe author's "if X, try Y"
            specific aside. Not generic filler. */}
        {step.tip && (
          <div style={{
            marginTop: 12, padding: "10px 12px",
            background: "#0f1420", border: "1px solid #1f3040",
            borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
            color: "#6aa3d9", lineHeight: 1.45,
          }}>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.1em", color: "#4a7aa5", marginRight: 6 }}>
              TIP
            </span>
            {step.tip}
          </div>
        )}

        {/* Navigation — BACK left-aligned when available, NEXT /
            FINISH on the right. FINISH wording and palette match the
            green "LOG IT" on IAteThisSheet so the two screens read as
            one chained flow. */}
        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
          {activeStep > 0 && (
            <button
              type="button"
              onClick={() => setActiveStep(s => Math.max(0, s - 1))}
              style={{
                flex: 1, padding: "14px",
                background: "#1a1a1a", border: "1px solid #2a2a2a",
                color: "#888", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 11,
                letterSpacing: "0.1em", cursor: "pointer",
              }}
            >
              ← BACK
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            style={{
              flex: 2, padding: "14px",
              background: isLast ? "#0f1a0f" : "#f5c842",
              border: isLast ? "1px solid #1e3a1e" : "none",
              color: isLast ? "#7ec87e" : "#111",
              borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
              letterSpacing: "0.1em", cursor: "pointer",
            }}
          >
            {isLast ? "FINISH · HOW MUCH? →" : "NEXT STEP →"}
          </button>
        </div>
      </div>
    </div>
  );
}
