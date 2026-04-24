// WCAG 2.1 contrast calculator for the MCM cooking-app theme system.
//
// Ships three layers:
//   - relativeLuminance(color)  — BT.709 luminance after sRGB
//     gamma correction, per the official WCAG formula.
//   - contrastRatio(a, b)       — the (L1+0.05)/(L2+0.05) ratio,
//     1..21.
//   - passesAA / passesAAA      — convenience bools at the
//     4.5/3.0/7.0/4.5 standard thresholds.
//
// Plus `pickBestInk(bg, candidates)` — given a bg and a list of
// candidate ink colors, returns the candidate with the highest
// contrast. Useful when the backdrop shifts continuously and we
// need ink to track it without hand-tuning every anchor.
//
// Imports `parseColor` from blend.js so parsing stays consistent
// with the blend path (both handle #hex + rgb()/rgba() + #rgb).

import { parseColor } from "./blend";

// Linearize a single sRGB 0–255 channel into its physical
// intensity, per WCAG 2.1 § 1.4.3.
function linearize(c255) {
  const s = c255 / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// Y = 0.2126R + 0.7152G + 0.0722B on linearized channels.
// Returns 0..1, where 0 is black and 1 is white.
export function relativeLuminance(colorStr) {
  const [r, g, b] = parseColor(colorStr);
  return (
    0.2126 * linearize(r) +
    0.7152 * linearize(g) +
    0.0722 * linearize(b)
  );
}

// WCAG contrast ratio: (Lmax + 0.05) / (Lmin + 0.05). Always
// returns a value between 1 (same color) and 21 (black vs white).
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// WCAG AA — 4.5:1 for body copy, 3:1 for large text (≥18pt or
// ≥14pt bold).
export function passesAA(fg, bg, { large = false } = {}) {
  return contrastRatio(fg, bg) >= (large ? 3.0 : 4.5);
}

// WCAG AAA — 7:1 body, 4.5:1 large. Used as a "we could do
// better" target, not a hard gate.
export function passesAAA(fg, bg, { large = false } = {}) {
  return contrastRatio(fg, bg) >= (large ? 4.5 : 7.0);
}

// Given a background color and a list of candidate foregrounds,
// returns the candidate that produces the highest contrast.
// Simple argmax — if two tie, returns the first.
export function pickBestInk(bg, candidates) {
  let bestIdx = 0;
  let bestRatio = contrastRatio(bg, candidates[0]);
  for (let i = 1; i < candidates.length; i += 1) {
    const r = contrastRatio(bg, candidates[i]);
    if (r > bestRatio) {
      bestIdx = i;
      bestRatio = r;
    }
  }
  return candidates[bestIdx];
}

// Dev-only sanity check: warns in the console if a theme's declared
// (fg, bg) pair is below AA. Lets a designer tune anchor palettes
// and get immediate feedback when they accidentally land in
// unreadable territory (dark ink on dark dawn sky, etc). Imports
// of contrast.js stay zero-cost in production because this is
// only called from dev-time tooling.
export function warnIfBelowAA(fg, bg, label, { large = false } = {}) {
  if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") return;
  const ratio = contrastRatio(fg, bg);
  const threshold = large ? 3.0 : 4.5;
  if (ratio < threshold) {
    // eslint-disable-next-line no-console
    console.warn(
      `[mcm-contrast] ${label || "pair"} below AA (${ratio.toFixed(2)}:1 < ${threshold}:1) — fg=${fg} bg=${bg}`
    );
  }
}
