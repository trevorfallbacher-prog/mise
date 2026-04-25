// AddDraftProgressStrip — sticky progress header for AddDraftSheet.
//
// Three required steps (canonical / package size / unit) drive a
// segmented progress bar with a moodful avatar pinned to the right.
// Step 5 is the secret "loveMode": all three set AND the typed brand
// matches a row in brand_nutrition. That flips the avatar to Step5,
// recolors the strip red, and floats hearts up past her.
//
// Extracted from AddDraftSheet.jsx so the parent file fits under the
// 1500-line tripwire from CLAUDE.md.

import { motion, AnimatePresence } from "framer-motion";
import { withAlpha } from "./primitives";
import { font } from "./tokens";

export function AddDraftProgressStrip({
  theme,
  canonicalId,
  packageSize,
  unit,
  brand,
  brandNutritionRows,
}) {
  // 3 required steps — name dropped because the name IS the
  // canonical. Every path that commits a canonical (typeahead pick,
  // auto-resolve from typing, "+ Add canonical" escape hatch) also
  // writes name, so checking canonicalId is the strict superset.
  const steps = [
    { id: "canonical",   label: "canonical",    done: !!canonicalId },
    { id: "packageSize", label: "package size", done: !!packageSize && Number(packageSize) > 0 },
    { id: "unit",        label: "unit",         done: !!unit.trim() },
  ];
  const completed = steps.filter(s => s.done).length;
  const ready = completed === steps.length;
  const nextStep = steps.find(s => !s.done);

  // Secret step 5 — required fields all set AND the typed brand
  // matches a row in brand_nutrition (the system's source of truth
  // for what's a real brand). Reward is real-brand recognition, so
  // observation tables (popular_package_sizes) are out — those are
  // for size suggestions, not brand validation.
  const loveMode = (() => {
    if (!ready) return false;
    const b = brand.trim().toLowerCase();
    if (!b) return false;
    return Array.isArray(brandNutritionRows)
      && brandNutritionRows.some(r => (r.brand || "").toLowerCase() === b);
  })();

  // Avatar mapping — 4 emotional states for 4 thresholds (0..3 done)
  // plus the secret 5th. stateIndex 0..3 maps to step 1..4 in
  // user-facing copy (and step 5 when loveMode flips on).
  const stateIndex = Math.min(completed, 3);
  const stateSrc = loveMode
    ? "/icons/AddItemProgression/Step5.svg"
    : [
        "/icons/AddItemProgression/Step1.svg",
        "/icons/AddItemProgression/Step2.svg",
        "/icons/AddItemProgression/Step%203.svg",
        "/icons/AddItemProgression/Step4.svg",
      ][stateIndex];

  // Per-state palette pulled from each avatar's background tint —
  // meter fill + caption text shift to match her so the strip reads
  // as one mood with her as the anchor. Step 4 (ready) keeps the
  // theme teal; step 5 (love) goes red.
  const stateColors = ["#4a8e92", "#eac289", "#79a49c", theme.color.teal];
  const tone = loveMode ? "#ec6545" : stateColors[stateIndex];
  const captionKey = loveMode
    ? "love"
    : ready
      ? "ready"
      : `step-${stateIndex}-${nextStep?.id || "next"}`;

  return (
    // Sticky to the top of the scrolling sheet so the user keeps a
    // fixed anchor while content reflows below. Negative side-margins
    // span the full panel width; padding compensates so content reads
    // as a pinned header, not loose floating chrome.
    <div style={{
      position: "sticky",
      top: -22, // sheet's parent padding is 22; pin at the visual top
      zIndex: 4,
      margin: "-22px -22px 12px -22px",
      padding: "16px 22px 12px",
      background: withAlpha(theme.color.glassFillHeavy, 0.92),
      backdropFilter: "blur(20px) saturate(150%)",
      WebkitBackdropFilter: "blur(20px) saturate(150%)",
      borderBottom: `1px solid ${theme.color.hairline}`,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      display: "flex",
      alignItems: "center",
      gap: 12,
    }}>
      {/* Progress segments + caption — sit on the LEFT so the user
          reads "I'm trying to get to her" with the avatar on the
          right as the goal. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", gap: 4, alignItems: "stretch",
          marginBottom: 6,
        }}>
          {steps.map((s, i) => {
            // Count-based fill — segment[i] is "on" when i < completed,
            // regardless of WHICH specific step is done. Reads as a
            // left-to-right progress bar that resets cleanly on
            // backwards progression.
            const filled = i < completed;
            // Next-up segment — first unfilled one sitting just past
            // the lit run. Soft accent tint + slow pulse so the user's
            // eye tracks "here's what to do next" without copy.
            const isNext = !filled && i === completed && !ready;
            return (
              <motion.div
                key={s.id}
                animate={filled
                  ? { scaleY: ready ? 1.4 : [1, 1.6, 1] }
                  : isNext
                    ? { opacity: [0.55, 1, 0.55] }
                    : { scaleY: 1 }}
                transition={isNext
                  ? { duration: 1.6, ease: "easeInOut", repeat: Infinity }
                  : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  transformOrigin: "center",
                  background: filled
                    ? tone
                    : isNext
                      ? withAlpha(tone, 0.45)
                      : withAlpha(theme.color.ink, 0.08),
                  boxShadow: filled
                    ? `0 0 6px ${withAlpha(tone, 0.45)}`
                    : isNext
                      ? `0 0 4px ${withAlpha(tone, 0.30)}`
                      : "none",
                  transition: "background 220ms ease, box-shadow 220ms ease",
                }}
              />
            );
          })}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={captionKey}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              fontFamily: font.mono, fontSize: 10,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: tone,
              fontWeight: 600,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {loveMode ? (
              <>
                <motion.span
                  aria-hidden
                  initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 480, damping: 18 }}
                  style={{ fontSize: 14, lineHeight: 1 }}
                >
                  ♥
                </motion.span>
                She loves it · ready to save
              </>
            ) : ready ? (
              <>
                <motion.span
                  aria-hidden
                  initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 480, damping: 18 }}
                  style={{ fontSize: 14, lineHeight: 1 }}
                >
                  ✓
                </motion.span>
                Ready to save
              </>
            ) : (
              <>
                Step {completed + 1} · add {nextStep ? nextStep.label : "more"} next
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Avatar — anchored on the RIGHT so she reads as the goal the
          user is filling fields toward. 0 done → Step1 (most
          frustrated, fresh form), 1 → Step2, 2 → Step3, 3 → Step4
          (ready). Clean 1:1 with the completion count. */}
      <div style={{
        width: 64, height: 64, flexShrink: 0,
        position: "relative",
        // Hearts overflow above the strip on love mode; need overflow
        // visible so they can float past the avatar's bbox.
        overflow: "visible",
      }}>
        <AnimatePresence initial={false}>
          <motion.img
            key={stateSrc}
            src={stateSrc}
            alt=""
            aria-hidden
            // Halo cascade: blue at step 4 (ready), unset at step 5
            // (love — the hearts and red caption carry the celebration).
            // Class drives a filter:drop-shadow keyframe so the glow
            // hugs her figure outline; inline filter takes over otherwise.
            className={ready && !loveMode ? "mise-avatar-ready" : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{    opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%", objectFit: "contain",
              filter: ready && !loveMode
                ? undefined
                : "drop-shadow(0 1px 3px rgba(20,12,4,0.25))",
            }}
          />
        </AnimatePresence>
        {/* Hearts overlay — five hearts at staggered delays cascade
            up past the avatar continuously while love mode holds.
            CSS keyframe handles the float + fade. AnimatePresence
            fades the wrapper in / out when loveMode flips. */}
        <AnimatePresence>
          {loveMode && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: "absolute", inset: 0,
                pointerEvents: "none",
              }}
            >
              {[0, 1, 2, 3, 4].map(i => (
                <span
                  key={i}
                  aria-hidden
                  className="mise-heart"
                  style={{
                    left: `${10 + i * 11}px`,
                    bottom: 4,
                    animationDelay: `${i * 0.36}s`,
                    fontSize: 14 + (i % 2) * 2,
                  }}
                >♥</span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
