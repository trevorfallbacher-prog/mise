// Color + CSS-string blending for the time-of-day theme system.
//
// The theme system anchors four palettes at specific hours and
// interpolates every token between the two adjacent anchors at
// render time. That means 6:45am is a blend of morning + night
// with most of the weight on morning, distinct from 4:30am which
// is mostly-night.
//
// Color blending is straightforward per-channel linear interpolation
// on RGB + alpha. For CSS strings that carry multiple rgba() calls
// in a fixed structure — shadow stacks, linear-gradient bases —
// we pair up the rgba occurrences between A and B and blend each
// pair. That only works when A and B share the same structural
// skeleton, which every theme export in themes.js does by
// construction.

// --- Parsers ------------------------------------------------------------

// Parse a color string into [r, g, b, a]. Accepts:
//   #rrggbb        → alpha 1
//   rgb(r, g, b)   → alpha 1
//   rgba(r, g, b, a)
// Exported so the contrast calculator in contrast.js can reuse it.
export function parseColor(str) {
  if (!str || typeof str !== "string") return [0, 0, 0, 1];
  const s = str.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (h.length === 3) {
      // #rgb → expand to #rrggbb
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
        1,
      ];
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      1,
    ];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
    return [
      parts[0] || 0,
      parts[1] || 0,
      parts[2] || 0,
      parts[3] == null ? 1 : parts[3],
    ];
  }
  return [0, 0, 0, 1];
}

function serializeColor([r, g, b, a]) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;
}

// --- Blends -------------------------------------------------------------

// Linear interpolate between two color strings. `t` is a 0..1
// fraction — 0 returns a, 1 returns b.
export function blendColor(a, b, t) {
  if (a === b) return a;
  const A = parseColor(a);
  const B = parseColor(b);
  return serializeColor([
    A[0] + (B[0] - A[0]) * t,
    A[1] + (B[1] - A[1]) * t,
    A[2] + (B[2] - A[2]) * t,
    A[3] + (B[3] - A[3]) * t,
  ]);
}

// Blend two CSS strings that share the same non-color skeleton
// (same count + positions of rgba() / #hex occurrences). Used for
// shadow stacks and linear-gradient backdrops — both are strings
// whose structure is identical across themes by construction.
// Falls back to snap-at-50% if the structures diverge.
const COLOR_RE = /rgba?\([^)]+\)|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g;

export function blendCssString(a, b, t) {
  if (a === b) return a;
  const aMatches = a.match(COLOR_RE) || [];
  const bMatches = b.match(COLOR_RE) || [];
  if (aMatches.length !== bMatches.length || aMatches.length === 0) {
    return t < 0.5 ? a : b;
  }
  let i = 0;
  return a.replace(COLOR_RE, () => {
    const blended = blendColor(aMatches[i], bMatches[i], t);
    i += 1;
    return blended;
  });
}

// Rough perceived-luminance estimate (0..1). Good enough to
// classify a color string as "light" vs "dark" for ink-mode
// decisions. Uses the ITU BT.601 coefficients because we care
// about HUMAN readability, not pixel precision.
function luminance(colorStr) {
  const [r, g, b] = parseColor(colorStr);
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

// Does this theme use light ink (night-style) or dark ink
// (day-style)? Classifying on the main `ink` token is enough —
// inkMuted/inkFaint always sit on the same side.
function isLightInk(theme) {
  return luminance(theme.color.ink) > 0.5;
}

// Is the theme's SKY (the backdrop cream stop) dark? Dawn and dusk
// have dark ink on glass but dark skies, so they trip this and not
// the regular ink-mode check. We classify on `cream` (the top
// backdrop stop) since that's the largest visible bg area.
function isDarkSky(theme) {
  return luminance(theme.color.cream) < 0.5;
}

// Fields that SNAP (pick a side) rather than linearly blend when
// the two anchors straddle a light↔dark ink boundary. Without
// this, a 50/50 blend between a dark-ink-on-light-bg theme and a
// light-ink-on-dark-bg theme sends BOTH the background AND the
// ink through mid-grey at exactly the same t, collapsing contrast
// to ~1:1 — the 8pm washout bug. Snapping ink at t=0.5 means the
// text jumps from dark to light at the crossover, keeping ≥4:1
// contrast on either side of the transition.
const INK_SNAP_KEYS = new Set([
  "ink", "inkMuted", "inkFaint",
  // hairline tracks ink's side — same flip needed.
  "hairline",
]);

// skyInk / skyInkMuted snap on a SEPARATE axis — they flip when
// the BACKDROP changes luminance mode, not when the card ink does.
// Dawn has dark ink (for cards on bright cream glass) but bright
// skyInk (for hero text on the dark wine-red sky). Morning has
// dark both. Morning→dawn crosses the sky-mode boundary even
// though the card ink mode is stable. Treat it independently so
// hero text doesn't disappear across those windows.
const SKY_INK_SNAP_KEYS = new Set([
  "skyInk", "skyInkMuted",
]);

// Glass fills blend linearly through a muddy warm-taupe at the
// cross-mode midpoint, which made cards dissolve into the equally
// taupe backdrop at 8pm / 6am. Instead of snapping (jarring jump)
// we bias the blended glass TOWARD a warm cream with higher alpha,
// peaking at t=0.5. Reads as "morning light through the windows"
// or "lamp cream on a cold counter" — a deliberate twilight tile
// color rather than an accidentally grey one.
const TWILIGHT_CREAM_RGBA = [255, 240, 210, 0.82];
const GLASS_BIAS_KEYS = new Set([
  "glassFill", "glassFillLite", "glassFillHeavy",
]);
// Max bias weight at the exact midpoint. 0.55 = cream dominates
// by just over half; strong enough to pop cards off the taupe bg,
// subtle enough that it doesn't read as a hard theme snap.
const GLASS_BIAS_PEAK = 0.55;

// Linear interpolate a color toward the twilight cream target.
// Preserves the source alpha trajectory (blends toward a higher
// target alpha too so the glass gets more opaque at the midpoint,
// which is where bg↔glass contrast needs the most help).
function biasTowardCream(colorStr, strength) {
  const [r, g, b, a] = parseColor(colorStr);
  const [cr, cg, cb, ca] = TWILIGHT_CREAM_RGBA;
  return serializeColor([
    r + (cr - r) * strength,
    g + (cg - g) * strength,
    b + (cb - b) * strength,
    a + (ca - a) * strength,
  ]);
}

// Blend two complete theme objects. Every token that consumers
// read from `theme` interpolates; theme.id / theme.label snap
// to the closer of the two so `theme.id === "night"` still works
// as a boolean for discrete decisions (sun/moon swap, etc).
export function blendThemes(a, b, t) {
  // Short-circuit when both anchors are the same theme — the
  // night plateau between its start (21h) and end (5h) anchors
  // hits this path for every hour from dusk to dawn, so avoiding
  // the property walk there matters.
  if (a === b)   return a;
  if (t <= 0)    return a;
  if (t >= 1)    return b;

  // Two independent mode crossings to watch.
  //  - crossingInkMode — card ink (dark ↔ light). Drives the
  //    existing ink snap + glass-cream bias.
  //  - crossingSkyMode — backdrop mode (light sky ↔ dark sky).
  //    Drives the new skyInk snap so hero text stays legible on
  //    the bare backdrop across dawn/dusk/night boundaries.
  const crossingInkMode = isLightInk(a) !== isLightInk(b);
  const crossingSkyMode = isDarkSky(a) !== isDarkSky(b);
  const inkSide = t < 0.5 ? a : b;
  // Triangle bias: 0 at t=0 and t=1, peaks at t=0.5. Only applies
  // when we're actually crossing modes (pure-theme plateaus skip
  // the whole path via the a===b short-circuit above).
  const glassBias = crossingInkMode
    ? GLASS_BIAS_PEAK * (1 - Math.abs(t - 0.5) * 2)
    : 0;

  const blendedColor  = {};
  const blendedShadow = {};

  for (const k of Object.keys(a.color)) {
    if (crossingInkMode && INK_SNAP_KEYS.has(k)) {
      blendedColor[k] = inkSide.color[k];
    } else if (crossingSkyMode && SKY_INK_SNAP_KEYS.has(k)) {
      blendedColor[k] = inkSide.color[k];
    } else {
      const linear = blendColor(a.color[k], b.color[k], t);
      blendedColor[k] = (glassBias > 0 && GLASS_BIAS_KEYS.has(k))
        ? biasTowardCream(linear, glassBias)
        : linear;
    }
  }
  for (const k of Object.keys(a.shadow)) {
    blendedShadow[k] = blendCssString(a.shadow[k], b.shadow[k], t);
  }

  return {
    // Snap the id/label so sun/moon decisions + the slider label
    // read sensibly. Below the halfway point we're still mostly A.
    id:    t < 0.5 ? a.id    : b.id,
    label: t < 0.5 ? a.label : b.label,
    // Which "bucket" we're actually closer to. Useful for
    // animations that key off theme.id but want to know the
    // other-side anchor too.
    fromId: a.id,
    toId:   b.id,
    t,
    color:  blendedColor,
    shadow: blendedShadow,
    backdrop: {
      base: blendCssString(a.backdrop.base, b.backdrop.base, t),
      blobs: a.backdrop.blobs.map((blob, i) => ({
        ...blob,
        bg: blendColor(blob.bg, b.backdrop.blobs[i].bg, t),
      })),
    },
  };
}
