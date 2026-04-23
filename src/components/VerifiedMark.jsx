import { useEffect, useRef, useState } from "react";

/**
 * VerifiedMark — animated blue checkmark.
 *
 * Used in two places:
 *
 *   1. Source badge for the "pantry" tier (user-verified nutrition).
 *      Replaces the old "YOU" tag with a blue ✓ VERIFIED chip that
 *      draws itself in the first time a card appears on screen. Tells
 *      the user: "this data is official because a human confirmed it"
 *      rather than "you typed this in." Small but important narrative
 *      shift — the scan-then-save flow is the user helping CURATE the
 *      shared database, not just fiddling with their own numbers.
 *
 *   2. The ScanRewardSheet celebration — bigger, slower-drawn variant
 *      that lands as the centerpiece after a successful save.
 *
 * Draws using an SVG stroke-dashoffset animation (the "line draws on"
 * effect). IntersectionObserver would be overkill for a tiny badge,
 * so we key the draw on mount + an optional `replayKey` prop if the
 * parent wants to re-run the animation.
 *
 * Props:
 *   size       — outer diameter in px (default 14). Set 72+ for the
 *                reward-sheet hero variant.
 *   color      — stroke + halo color. Default tokens.sky-ish blue
 *                (#7eb8d4) matching the "verified" family.
 *   label      — optional text rendered next to the check. Leave
 *                undefined for icon-only use (e.g. hero).
 *   delay      — ms before the draw starts (default 120 — enough for
 *                the card mount to settle, then the tick feels
 *                earned).
 *   duration   — stroke-draw duration in ms (default 480).
 *   replayKey  — any stable-identity value whose change re-runs the
 *                animation. Use for "just saved" celebrations.
 */
const BLUE       = "#7eb8d4";
const BLUE_SOFT  = "#1f3040";
const BLUE_DEEP  = "#0f1620";

export default function VerifiedMark({
  size = 14,
  color = BLUE,
  label,
  delay = 120,
  duration = 480,
  replayKey = 0,
  showLabel = true,
}) {
  const [drawn, setDrawn] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    setDrawn(false);
    timeoutRef.current = setTimeout(() => setDrawn(true), delay);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [delay, replayKey]);

  const strokeWidth = Math.max(2, Math.round(size * 0.17));
  const haloId = `verifiedHalo-${size}-${replayKey}`;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: showLabel && label ? 5 : 0,
      verticalAlign: "middle",
    }}>
      <span
        style={{
          position: "relative",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: size, height: size,
          flexShrink: 0,
        }}
      >
        {/* Halo pulse — fires once when the check completes */}
        <span style={{
          position: "absolute", inset: 0,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color}66 0%, transparent 70%)`,
          opacity: drawn ? 0 : 0,
          animation: drawn ? `verifiedHalo ${Math.max(600, duration + 120)}ms ease-out ${duration * 0.55}ms forwards` : "none",
          pointerEvents: "none",
        }} />

        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block", overflow: "visible" }}
        >
          {/* Circle outline */}
          <circle
            cx="12" cy="12" r="10"
            stroke={color}
            strokeWidth={strokeWidth}
            fill={BLUE_DEEP}
            style={{
              strokeDasharray: 63,
              strokeDashoffset: drawn ? 0 : 63,
              transition: `stroke-dashoffset ${Math.round(duration * 0.6)}ms cubic-bezier(0.65, 0, 0.35, 1)`,
            }}
          />
          {/* Check path */}
          <path
            d="M7 12.5 L10.5 16 L17 9"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: 18,
              strokeDashoffset: drawn ? 0 : 18,
              transition: `stroke-dashoffset ${Math.round(duration * 0.55)}ms cubic-bezier(0.65, 0, 0.35, 1) ${Math.round(duration * 0.45)}ms`,
              filter: `drop-shadow(0 0 4px ${color}66)`,
            }}
          />
        </svg>
      </span>
      {showLabel && label && (
        <span style={{
          fontFamily: "'DM Mono',monospace", fontSize: 8, fontWeight: 700,
          color, letterSpacing: "0.12em",
        }}>
          {label}
        </span>
      )}
      <style>{VERIFIED_KEYFRAMES}</style>
    </span>
  );
}

const VERIFIED_KEYFRAMES = `
@keyframes verifiedHalo {
  0%   { opacity: 0;    transform: scale(0.7); }
  40%  { opacity: 0.85; transform: scale(1.15); }
  100% { opacity: 0;    transform: scale(1.8); }
}
`;

export { BLUE as VERIFIED_BLUE, BLUE_SOFT as VERIFIED_BLUE_BORDER, BLUE_DEEP as VERIFIED_BLUE_BG };
