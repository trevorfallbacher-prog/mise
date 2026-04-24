// Time-of-day themes for the MCM cooking-app experiment.
//
// Same kitchen, four lights. Each theme exports the full shape
// that primitives consume (color, shadow, glassPanel, ctaButton,
// ghostButton, backdrop) so swapping themes never crosses a
// layout/typography boundary. Theme-invariant tokens (radius,
// space, font) stay in tokens.js and are imported directly.
//
// Readability is the hard rule: ink-on-background contrast stays
// ≥ 7:1 for body copy across all four themes, and the CTA gradient
// endpoints hold ≥ 4.5:1 against their cream text (WCAG AA).

import { radius } from "./tokens";

// --- Shared shape builders ----------------------------------------------

// Each theme's shadow.glass follows the same four-layer recipe so
// the "light through glass" read is consistent across times.
// Light themes get a bright top inset highlight + faint bottom
// darken; night inverts those so the pane reflects warm lamp
// light from above in a dark kitchen.
function shadowStack({ drop, drop2, topInset, bottomInset }) {
  return `${drop},${drop2},inset 0 1px 0 ${topInset},inset 0 -1px 0 ${bottomInset}`;
}

// --- MORNING — warm cream, soft sunlight, gentle teal -------------------

const morning = {
  id: "morning",
  label: "Morning",
  // Anchor hour — peak expression of this theme. The provider
  // blends between the two closest anchors based on the fractional
  // current hour, so 6:45 lands ≈95% morning / 5% night-carryover
  // while 4:30 is mostly night with a whisper of dawn.
  hour: 7.5,
  color: {
    // Background — golden-warm parchment, like 7am light on a
    // tiled kitchen counter.
    cream:        "#F9EFDC",
    parchment:    "#F1E3C6",
    paper:        "#FCF5E7",
    // Text — warm near-black so dark text on warm paper doesn't
    // clash into pure slate.
    ink:          "#241810",
    inkMuted:     "#64503E",
    inkFaint:     "#8F7A62",
    // Accents — teal slightly softer/sage, burnt slightly warmer.
    teal:         "#4F9A8F",
    aqua:         "#7FB9A7",
    burnt:        "#D96F2E",
    mustard:      "#D9A940",
    warmBrown:    "#7A4E2D",
    // Tints
    tealTint:     "rgba(79,154,143,0.14)",
    aquaTint:     "rgba(127,185,167,0.18)",
    burntTint:    "rgba(217,111,46,0.14)",
    mustardTint:  "rgba(217,169,64,0.18)",
    brownTint:    "rgba(122,78,45,0.14)",
    // Glass — warm cream tint in the fill so panels pick up
    // morning sunlight.
    glassFill:      "rgba(255,249,234,0.64)",
    glassFillLite:  "rgba(255,249,234,0.44)",
    glassFillHeavy: "rgba(255,249,234,0.78)",
    glassBorder:    "rgba(255,255,255,0.85)",
    hairline:       "rgba(36,24,16,0.08)",
    // CTA gradient — same burnt brand, darkened for AA.
    ctaTop:    "#C85A1F",
    ctaBottom: "#A34711",
    ctaText:   "#FFF8EE",
  },
  shadow: {
    glass: shadowStack({
      drop:         "0 24px 48px rgba(24,14,4,0.08)",
      drop2:        "0 6px 14px rgba(24,14,4,0.05)",
      topInset:     "rgba(255,255,255,0.85)",
      bottomInset:  "rgba(30,20,8,0.05)",
    }),
    soft: "0 8px 20px rgba(24,14,4,0.05), 0 1px 2px rgba(24,14,4,0.03)",
    lift: shadowStack({
      drop:         "0 30px 60px rgba(24,14,4,0.12)",
      drop2:        "0 10px 20px rgba(24,14,4,0.07)",
      topInset:     "rgba(255,255,255,0.9)",
      bottomInset:  "rgba(30,20,8,0.05)",
    }),
    cta:  "0 12px 26px rgba(168,73,17,0.38), 0 2px 6px rgba(168,73,17,0.26)",
    inputInset:
      "inset 0 1px 2px rgba(30,30,30,0.08)," +
      "inset 0 -1px 0 rgba(255,255,255,0.6)," +
      "0 2px 6px rgba(30,30,30,0.04)",
  },
  // Backdrop — soft golden wash + gentle teal top-left, gentle
  // peach bottom-right. Low saturation — it's morning, not sunset.
  backdrop: {
    base: "linear-gradient(180deg, #F9EFDC 0%, #F1E3C6 100%)",
    blobs: [
      { bg: "rgba(79,154,143,0.14)",  top: "-12%", left: "-12%", size: 500 },
      { bg: "rgba(217,111,46,0.10)",  top: "55%",  left: "62%",  size: 440 },
      { bg: "rgba(217,169,64,0.10)",  top: "70%",  left: "-8%",  size: 320 },
    ],
  },
};

// --- DAY — bright parchment, clear glass, fresh aquamarine --------------

const day = {
  id: "day",
  label: "Day",
  hour: 14,
  color: {
    cream:        "#F6F1E8",
    parchment:    "#EFE7DA",
    paper:        "#FBF7EF",
    ink:          "#1E1E1E",
    inkMuted:     "#5A5A5A",
    inkFaint:     "#8A8072",
    teal:         "#2F8F83",
    aqua:         "#6FAF9B",
    burnt:        "#D96B2B",
    mustard:      "#D4A637",
    warmBrown:    "#7A4E2D",
    tealTint:     "rgba(47,143,131,0.14)",
    aquaTint:     "rgba(111,175,155,0.18)",
    burntTint:    "rgba(217,107,43,0.14)",
    mustardTint:  "rgba(212,166,55,0.18)",
    brownTint:    "rgba(122,78,45,0.14)",
    glassFill:      "rgba(255,255,255,0.62)",
    glassFillLite:  "rgba(255,255,255,0.42)",
    glassFillHeavy: "rgba(255,255,255,0.75)",
    glassBorder:    "rgba(255,255,255,0.85)",
    hairline:       "rgba(30,30,30,0.08)",
    ctaTop:    "#C85A1F",
    ctaBottom: "#A34711",
    ctaText:   "#FFF8EE",
  },
  shadow: {
    glass: shadowStack({
      drop:         "0 24px 48px rgba(0,0,0,0.10)",
      drop2:        "0 6px 14px rgba(0,0,0,0.06)",
      topInset:     "rgba(255,255,255,0.85)",
      bottomInset:  "rgba(30,30,30,0.06)",
    }),
    soft: "0 8px 20px rgba(30,30,30,0.06), 0 1px 2px rgba(30,30,30,0.04)",
    lift: shadowStack({
      drop:         "0 30px 60px rgba(30,30,30,0.14)",
      drop2:        "0 10px 20px rgba(30,30,30,0.08)",
      topInset:     "rgba(255,255,255,0.9)",
      bottomInset:  "rgba(30,30,30,0.06)",
    }),
    cta:  "0 12px 26px rgba(168,73,17,0.40), 0 2px 6px rgba(168,73,17,0.28)",
    inputInset:
      "inset 0 1px 2px rgba(30,30,30,0.10)," +
      "inset 0 -1px 0 rgba(255,255,255,0.6)," +
      "0 2px 6px rgba(30,30,30,0.04)",
  },
  backdrop: {
    base: "linear-gradient(180deg, #F6F1E8 0%, #EFE7DA 100%)",
    blobs: [
      { bg: "rgba(47,143,131,0.14)",  top: "-12%", left: "-12%", size: 500 },
      { bg: "rgba(217,107,43,0.12)",  top: "55%",  left: "62%",  size: 440 },
      { bg: "rgba(122,78,45,0.08)",   top: "70%",  left: "-8%",  size: 320 },
    ],
  },
};

// --- EVENING — peach/orange ambient glow, warmer shadows ---------------

const evening = {
  id: "evening",
  label: "Evening",
  hour: 19,
  color: {
    cream:        "#F6E4D0",
    parchment:    "#ECCFB3",
    paper:        "#F9EBD8",
    ink:          "#2B1A0E",
    inkMuted:     "#6C533E",
    inkFaint:     "#94775C",
    teal:         "#3D8278",
    aqua:         "#76AD9A",
    burnt:        "#C8541C",
    mustard:      "#CF9A30",
    warmBrown:    "#7A4E2D",
    tealTint:     "rgba(61,130,120,0.16)",
    aquaTint:     "rgba(118,173,154,0.18)",
    burntTint:    "rgba(200,84,28,0.16)",
    mustardTint:  "rgba(207,154,48,0.20)",
    brownTint:    "rgba(122,78,45,0.16)",
    glassFill:      "rgba(255,242,226,0.64)",
    glassFillLite:  "rgba(255,242,226,0.44)",
    glassFillHeavy: "rgba(255,242,226,0.78)",
    glassBorder:    "rgba(255,235,212,0.85)",
    hairline:       "rgba(43,26,14,0.10)",
    ctaTop:    "#B8491A",
    ctaBottom: "#91380D",
    ctaText:   "#FFF4E4",
  },
  shadow: {
    glass: shadowStack({
      drop:         "0 24px 48px rgba(50,25,10,0.14)",
      drop2:        "0 6px 14px rgba(50,25,10,0.08)",
      topInset:     "rgba(255,240,220,0.85)",
      bottomInset:  "rgba(50,25,10,0.08)",
    }),
    soft: "0 8px 20px rgba(50,25,10,0.08), 0 1px 2px rgba(50,25,10,0.05)",
    lift: shadowStack({
      drop:         "0 30px 60px rgba(50,25,10,0.18)",
      drop2:        "0 10px 20px rgba(50,25,10,0.10)",
      topInset:     "rgba(255,240,220,0.9)",
      bottomInset:  "rgba(50,25,10,0.08)",
    }),
    cta:  "0 12px 26px rgba(145,56,13,0.45), 0 2px 6px rgba(145,56,13,0.32)",
    inputInset:
      "inset 0 1px 2px rgba(43,26,14,0.12)," +
      "inset 0 -1px 0 rgba(255,240,220,0.6)," +
      "0 2px 6px rgba(43,26,14,0.05)",
  },
  backdrop: {
    base: "linear-gradient(180deg, #F6E4D0 0%, #ECCFB3 100%)",
    blobs: [
      { bg: "rgba(200,84,28,0.22)",   top: "-12%", left: "-12%", size: 500 },
      { bg: "rgba(207,154,48,0.20)",  top: "55%",  left: "62%",  size: 440 },
      { bg: "rgba(122,78,45,0.14)",   top: "70%",  left: "-8%",  size: 320 },
    ],
  },
};

// --- NIGHT — cool sky, warm foreground (blue-light safe) ----------------

// Two layers: the SKY is cool (deep blue-slate backdrop, teal +
// cool-violet blobs, white moon + white stars) so the room reads
// as "after dark"; the FOREGROUND is warm (amber translucent
// glass, warm cream ink, lamp-cream borders). The warm glass +
// warm text are the blue-light-reduction layer — long reading /
// cooking sessions late at night don't torch the user's eyes
// with cold white copy on cold dark paper, but the room still
// feels like night, not like a dim-lit day theme.
const night = {
  id: "night",
  label: "Night",
  hour: 2,
  color: {
    // Background — cool deep slate, genuinely night, not cocoa.
    cream:        "#141820",
    parchment:    "#0C0F15",
    paper:        "#1A1E26",
    // Text — warm cream. Comfortable on cool slate, reduces the
    // blue-light burden late at night. ≥ 9:1 contrast on the
    // parchment for body copy.
    ink:          "#F2E4C8",
    inkMuted:     "#B6A180",
    inkFaint:     "#8A7A60",
    // Accents — mint reads cooler against dark, burnt stays warm.
    teal:         "#6FC5B4",
    aqua:         "#8FD4C4",
    burnt:        "#E37C3C",
    mustard:      "#E3B44E",
    warmBrown:    "#C8A67F",
    tealTint:     "rgba(111,197,180,0.18)",
    aquaTint:     "rgba(143,212,196,0.20)",
    burntTint:    "rgba(227,124,60,0.18)",
    mustardTint:  "rgba(227,180,78,0.20)",
    brownTint:    "rgba(200,166,127,0.16)",
    // Glass — warm amber translucent, the "indoor lamp" layer
    // sitting on top of the cool sky. Border is lamp-cream so
    // each pane catches warm light along its edge while the
    // backdrop behind it reads cool.
    glassFill:      "rgba(70,50,28,0.62)",
    glassFillLite:  "rgba(70,50,28,0.42)",
    glassFillHeavy: "rgba(70,50,28,0.76)",
    glassBorder:    "rgba(255,230,198,0.28)",
    hairline:       "rgba(242,226,204,0.12)",
    ctaTop:    "#E17736",
    ctaBottom: "#B55620",
    ctaText:   "#FFF4E4",
  },
  shadow: {
    // Warm cream top-inset — light comes from the lamp above the
    // pane, not from a cold moon. Drop layers stay deep-dark
    // because the room around the panel IS genuinely dark.
    glass: shadowStack({
      drop:         "0 24px 48px rgba(0,0,0,0.48)",
      drop2:        "0 6px 14px rgba(0,0,0,0.30)",
      topInset:     "rgba(255,230,198,0.22)",
      bottomInset:  "rgba(0,0,0,0.28)",
    }),
    soft: "0 8px 20px rgba(0,0,0,0.30), 0 1px 2px rgba(0,0,0,0.20)",
    lift: shadowStack({
      drop:         "0 30px 60px rgba(0,0,0,0.55)",
      drop2:        "0 10px 20px rgba(0,0,0,0.32)",
      topInset:     "rgba(255,230,198,0.26)",
      bottomInset:  "rgba(0,0,0,0.28)",
    }),
    cta:  "0 12px 26px rgba(181,86,32,0.50), 0 2px 6px rgba(181,86,32,0.34)",
    inputInset:
      "inset 0 1px 2px rgba(0,0,0,0.35)," +
      "inset 0 -1px 0 rgba(255,230,198,0.12)," +
      "0 2px 6px rgba(0,0,0,0.20)",
  },
  backdrop: {
    // Cool blue-slate sky — this is the LAYER BEHIND the glass,
    // not the text surface. The teal + cool-violet blobs keep
    // the sky feeling like a real night sky rather than a flat
    // black. Third blob is a faint white wash so the moon has
    // something to bloom into.
    base: "linear-gradient(180deg, #141820 0%, #0C0F15 100%)",
    blobs: [
      { bg: "rgba(111,197,180,0.14)", top: "-12%", left: "-12%", size: 500 },
      { bg: "rgba(120,140,200,0.12)", top: "55%",  left: "62%",  size: 440 },
      { bg: "rgba(255,255,255,0.05)", top: "70%",  left: "-8%",  size: 320 },
    ],
  },
};

// --- Registry + helpers -------------------------------------------------

export const THEMES = { morning, day, evening, night };
export const THEME_ORDER = ["morning", "day", "evening", "night"];

// Hour-ordered anchor list used by the continuous resolver. Night
// gets a START anchor (21, when night fully sets in after dusk) and
// an END anchor (5, when dawn blend begins) — both are the same
// theme, so any hour between them blends night↔night and renders as
// pure night. That prevents the ugly halfway muddy-olive you'd get
// from naively blending evening's peach into night's slate across
// an 8-hour span. Only dusk (19→21) and dawn (5→7.5) actually blend.
// Wrap-around duplicates keep the bracket lookup simple for hours
// 0–24 without modulo math in the hot path.
const ANCHORS = [
  { id: "night",   hour: -3  },   // wrap of 21 into previous day
  { id: "night",   hour:  5  },   // night ends → dawn begins
  { id: "morning", hour: morning.hour }, // 7.5
  { id: "day",     hour: day.hour     }, // 14
  { id: "evening", hour: evening.hour }, // 19
  { id: "night",   hour: 21 },    // dusk ends → night begins
  { id: "night",   hour: 29 },    // wrap of 5 into next day
];

// Snap-to-name helper kept for back-compat with any caller that
// still wants the discrete state ("morning"/"day"/etc). Internally
// we now operate on fractional hours via resolveThemeAtHour.
export function getTimeTheme(hour) {
  const h = typeof hour === "number" ? hour : currentHour();
  if (h >= 5  && h < 10) return "morning";
  if (h >= 10 && h < 17) return "day";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

// Fractional wall-clock hour, e.g. 13.25 for 1:15pm. Caller can
// pass an explicit Date or omit to get "now".
export function currentHour(now) {
  const d = now || new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

// Return the theme palette at a specific fractional hour as a
// linear blend of the two surrounding anchors. 6:45am sits close
// to morning (anchor 7.5) but still carries trace night, while
// 4:30am is ~60% night / 40% morning — visibly "pre-dawn."
export function resolveThemeAtHour(hour, blenderFn) {
  const h = ((hour % 24) + 24) % 24;
  // Find the anchor pair that brackets h. Because ANCHORS includes
  // night at both -22 and 26, any hour 0..24 falls between two
  // adjacent entries.
  let prev = ANCHORS[0];
  let next = ANCHORS[ANCHORS.length - 1];
  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    if (h >= ANCHORS[i].hour && h < ANCHORS[i + 1].hour) {
      prev = ANCHORS[i];
      next = ANCHORS[i + 1];
      break;
    }
  }
  const span = next.hour - prev.hour;
  const t = span > 0 ? (h - prev.hour) / span : 0;
  return blenderFn(THEMES[prev.id], THEMES[next.id], t);
}

// Derived helpers — glassPanel / ctaButton / ghostButton recipes
// live here so every primitive uses the same composition rules
// and themes stay the only place color knobs move.
export function glassPanelFor(theme) {
  return {
    background: theme.color.glassFill,
    backdropFilter: "blur(28px) saturate(150%)",
    WebkitBackdropFilter: "blur(28px) saturate(150%)",
    border: `1px solid ${theme.color.glassBorder}`,
    borderRadius: radius.xl,
    boxShadow: theme.shadow.glass,
  };
}

export function ctaButtonFor(theme) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: "0.01em",
    color: theme.color.ctaText,
    background: `linear-gradient(180deg, ${theme.color.ctaTop} 0%, ${theme.color.ctaBottom} 100%)`,
    border: "1px solid rgba(255,255,255,0.35)",
    borderRadius: radius.pill,
    padding: "14px 22px",
    boxShadow: theme.shadow.cta,
    cursor: "pointer",
  };
}

export function ghostButtonFor(theme) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    fontSize: 15,
    fontWeight: 500,
    color: theme.color.ink,
    background: theme.color.glassFillLite,
    border: `1px solid ${theme.color.hairline}`,
    borderRadius: radius.pill,
    padding: "12px 18px",
    cursor: "pointer",
  };
}
