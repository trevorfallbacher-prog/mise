// MCM + Liquid-Glass cooking-app design tokens.
// Single source of truth for the experimental light-mode UI.
// Mid-Century-Modern palette on warm parchment, Apple-style glass
// panels, confident serif headers.
//
// ── Layout philosophy ─────────────────────────────────────────────
// The bones (color, font, glass) are kept; the layout primitives
// have been redesigned around how they're USED, not how big they
// are. The previous scale was a doubling power-of-two ladder —
// xs / sm / md / lg / xl — which produced monotony because every
// surface reached for `md` and `lg` by reflex.
//
// New rhythm scale is named by relationship: a `tight` chip-inner
// gap looks deliberately different from a `flow` in-section gap or
// a `gap` between groups, so authors think "what relationship am I
// spacing?" instead of "what number do I want?". Same applies to
// radius (`chip` / `field` / `card` / `panel` / `sheet`) and shadow
// (`surface.sunken` / `flat` / `lifted` / `float` / `soar`).
//
// Cards are the lazy default; impeccable layouts use stack-and-rule
// composition. `stack()` / `inline()` give gap-presets without a
// container, and `divider` provides separation without a card. Use
// them. Reach for `glassPanel` only when the surface genuinely needs
// to isolate from the page (sheets, the dock, the search bar).

import { CHIP_TONES } from "../../lib/tokens";

// ── Color ─────────────────────────────────────────────────────────
// Unchanged. Theme-blender (theme.jsx) varies the BACKDROP across
// the day; these palette anchors are stable.
export const color = {
  // Parchment backgrounds — warm, sunlit, never pure white.
  cream:        "#F6F1E8",
  parchment:    "#EFE7DA",
  paper:        "#FBF7EF",

  // Text.
  ink:          "#1E1E1E",
  inkMuted:     "#5A5A5A",
  inkFaint:     "#8A8072",

  // MCM accents.
  teal:         "#2F8F83",
  aqua:         "#6FAF9B",
  burnt:        "#D96B2B",
  mustard:      "#D4A637",
  warmBrown:    "#7A4E2D",

  // Tints — soft fills for matched-ingredient bubbles, etc.
  tealTint:     "rgba(47,143,131,0.14)",
  aquaTint:     "rgba(111,175,155,0.18)",
  burntTint:    "rgba(217,107,43,0.14)",
  mustardTint:  "rgba(212,166,55,0.18)",
  brownTint:    "rgba(122,78,45,0.14)",

  // Glass primitives. Fill holds enough white to read as a distinct
  // surface (airy cream, not translucent haze) while the
  // backdrop-filter blur + bright edge highlight do the
  // light-bending work. Border is near-opaque white to catch light
  // along the glass edge.
  glassFill:      "rgba(255,255,255,0.62)",
  glassFillLite:  "rgba(255,255,255,0.42)",
  glassFillHeavy: "rgba(255,255,255,0.75)",
  glassBorder:    "rgba(255,255,255,0.85)",
  hairline:       "rgba(30,30,30,0.08)",
};

// ── Reserved axis colors ──────────────────────────────────────────
// CLAUDE.md identity-axis hexes. Re-exported from CHIP_TONES so
// there's one source of truth app-wide.
export const axis = {
  canonical:    CHIP_TONES.canonical.fg,
  cut:          CHIP_TONES.cut.fg,
  foodCategory: CHIP_TONES.category.fg,
  storedIn:     CHIP_TONES.location.fg,
  state:        CHIP_TONES.state.fg,
  ingredients:  CHIP_TONES.ingredients.fg,
};

// ── Spacing — named by relationship ───────────────────────────────
// nudge   — optical alignment (italic lead-in, baseline tweaks)
// tight   — chip inner / icon-text pairing
// inline  — adjacent elements in a row (button + button)
// flow    — default vertical gap inside one group (label → input)
// gap     — between groups inside a section (input bar → field bar)
// block   — between sections on a page (form → CTA strip)
// region  — between page zones (header → body → dock)
//
// Ratios between steps are ≥1.25 so hierarchy reads at a glance.
// Old size keys (xs / sm / md / lg / xl / xxl / huge) stay as
// aliases for the existing call sites. New code reaches for the
// relationship name.
export const space = {
  nudge:   2,
  tight:   6,
  inline: 10,
  flow:   14,
  gap:    22,
  block:  36,
  region: 64,
  // legacy aliases (frozen at prior values so existing surfaces
  // don't shift)
  xs:   4,
  sm:   8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
  huge: 48,
};

// ── Radius — named by surface role ────────────────────────────────
// Each name maps to a physical scale: a chip is small, a field is
// settled, a card is lifted, a panel floats, a sheet is the page
// edge. Picking the role-name commits the author to the right
// scale instead of "is this a 16 or a 20?".
export const radius = {
  chip:   8,
  field: 12,
  card:  18,
  panel: 28,
  sheet: 36,
  pill:  999,
  // legacy aliases
  sm: 10,
  md: 16,
  lg: 20,
  xl: 24,
};

// ── Shadow / surface ──────────────────────────────────────────────
// `shadow` keys are kept as-is (they're heavily used). `surface` is
// the new hierarchical view: pick the surface LEVEL the thing
// occupies relative to the page, not the recipe by name.
export const shadow = {
  // glass — four-layer recipe (ambient + contact + top highlight +
  // bottom inset) so the pane reads as a thick piece of glass with
  // light entering the top, shadow pooling at the bottom.
  glass:
    "0 24px 48px rgba(0,0,0,0.10)," +
    "0 6px 14px rgba(0,0,0,0.06)," +
    "inset 0 1px 0 rgba(255,255,255,0.85)," +
    "inset 0 -1px 0 rgba(30,30,30,0.06)",
  soft:  "0 8px 20px rgba(30,30,30,0.06), 0 1px 2px rgba(30,30,30,0.04)",
  lift:
    "0 30px 60px rgba(30,30,30,0.14)," +
    "0 10px 20px rgba(30,30,30,0.08)," +
    "inset 0 1px 0 rgba(255,255,255,0.9)," +
    "inset 0 -1px 0 rgba(30,30,30,0.06)",
  cta:   "0 12px 26px rgba(168,73,17,0.40), 0 2px 6px rgba(168,73,17,0.28)",
  // Sunken — faint top inset, no bottom highlight. Paired with a
  // slightly warmer fill to separate it from the panels around it.
  inputInset:
    "inset 0 1px 2px rgba(30,30,30,0.10)," +
    "inset 0 -1px 0 rgba(255,255,255,0.6)," +
    "0 2px 6px rgba(30,30,30,0.04)",
};

export const surface = {
  sunken:  shadow.inputInset,           // input rests below the plane
  flat:    "0 0 0 1px rgba(30,30,30,0.05)",  // hairline only
  lifted:  shadow.soft,                 // settled card
  float:   shadow.glass,                // full glass panel
  soar:    shadow.lift,                 // sheet / overlay
  cta:     shadow.cta,                  // burnt-gradient button
};

// ── Fonts ─────────────────────────────────────────────────────────
// Unchanged. The four-voice stack — Pale Martini (display shout),
// Filmotype Honey (item-card cursive), Instrument Serif (editorial
// quiet), DM Sans/Mono (utility) — is a deliberate choice; do not
// re-roll on a new surface. Read the memory note about typography
// reuse before introducing a fifth face.
export const font = {
  serif:    "'Fraunces', 'Iowan Old Style', Georgia, serif",
  display:  "'Pale Martini', 'Truculenta', 'Futura', 'Trade Gothic', system-ui, sans-serif",
  itemName: "'filmotype-honey', 'Fraunces', 'Iowan Old Style', Georgia, serif",
  itemSub:  "'beverly-drive-right', 'Fraunces', 'Iowan Old Style', Georgia, serif",
  sans:     "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono:     "'DM Mono', 'SF Mono', ui-monospace, Menlo, monospace",
  detail:   "'instrument-serif', 'Fraunces', 'Iowan Old Style', Georgia, serif",
};

// ── Layout helpers ────────────────────────────────────────────────
// Spread these into a div to get a flex stack/inline with the right
// gap, without re-typing flex props or wrapping in a container.
// Encourages stack-and-rule composition over card-grid composition.
//
//   <div style={{ ...stack(space.flow) }}>
//     <Label />
//     <Input />
//     <hr style={divider} />
//     <Label />
//     <Input />
//   </div>
export const stack = (gap = space.flow) => ({
  display: "flex",
  flexDirection: "column",
  gap,
});

export const inline = (gap = space.inline) => ({
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap,
});

// Hairline rule — vertical separation without a card. Drop into a
// stack between two groups when the layout wants breath but a card
// would be heavy.
export const divider = {
  height: 1,
  width: "100%",
  background: color.hairline,
  border: 0,
  margin: 0,
};

// Body-text width cap — keeps measure inside the 65–75ch comfort
// band. Apply to long-form prose containers; not for chips or
// labels.
export const prose = {
  measure: "62ch",
};

// Optical alignment — Pale Martini caps and Fraunces italic both
// sit visually shifted right of their bounding box (the left-side
// bearing eats character width). Apply marginLeft: optical.italicLead
// to a heading wrapper to align an italic word with body text below.
export const optical = {
  italicLead: -3,
};

// ── Glass surfaces ────────────────────────────────────────────────
// Unchanged. Reach for these when the surface NEEDS to isolate from
// the page — sheets, dock, search-bar, picker. A chip on a panel
// inside another panel inside a glass sheet is glass-on-glass-on-
// glass; that reads broken even when each layer is correct.
export const glassPanel = {
  background: color.glassFill,
  backdropFilter: "blur(28px) saturate(150%)",
  WebkitBackdropFilter: "blur(28px) saturate(150%)",
  border: `1px solid ${color.glassBorder}`,
  borderRadius: radius.panel,
  boxShadow: shadow.glass,
};

export const glassPanelLight = {
  ...glassPanel,
  background: color.glassFillLite,
};

// ── Component recipes ─────────────────────────────────────────────

// CHIP — flat fill, hairline border, no blur. The default chip.
// Glass-on-glass blur stacking made every chip-row read like a
// translucent fog; the impeccable laws call out glassmorphism-as-
// default as a ban. Glass chips are still available as `glassChip`
// for the rare case a chip floats over photographic content.
export const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: space.tight,
  fontFamily: font.sans,
  fontSize: 12,
  fontWeight: 500,
  color: color.ink,
  background: "rgba(30,30,30,0.04)",
  border: `1px solid ${color.hairline}`,
  borderRadius: radius.chip,
  padding: `${space.tight}px ${space.inline}px`,
  letterSpacing: "0.02em",
  cursor: "pointer",
  userSelect: "none",
};

// GLASS CHIP — opt-in only. Reserve for chips that float over
// photographic / saturated backgrounds where the flat tint would
// disappear. On glass panels, use `chip` instead.
export const glassChip = {
  ...chip,
  background: color.glassFillHeavy,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: `1px solid ${color.glassBorder}`,
};

// LEGACY — old `pillChip` was the glass version. Keep the name
// aliased so existing imports still work; new code should pick
// `chip` (default) or `glassChip` (opt-in) explicitly.
export const pillChip = glassChip;

// CTA — burnt-gradient with serif-italic copy. Editorial voice
// over generic SaaS bold.
//
// Gradient endpoints darkened from brand burnt so cream text
// clears WCAG AA (≥4.5:1) across the surface: top stop #C85A1F →
// cream = 4.93:1, bottom #A34711 → cream = 7.03:1. The brand
// `color.burnt` token is unchanged so accent tints / text uses
// keep the original hue.
export const ctaButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: space.tight,
  fontFamily: font.serif,
  fontStyle: "italic",
  fontWeight: 400,
  fontSize: 17,
  letterSpacing: "0.005em",
  color: "#FFF8EE",
  background: "linear-gradient(180deg, #C85A1F 0%, #A34711 100%)",
  border: "1px solid rgba(255,255,255,0.35)",
  borderRadius: radius.pill,
  padding: `${space.flow}px ${space.gap}px`,
  boxShadow: shadow.cta,
  cursor: "pointer",
};

// GHOST — quieter twin. Same italic voice so primary / secondary
// actions read as the same hand.
export const ghostButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: space.tight,
  fontFamily: font.serif,
  fontStyle: "italic",
  fontWeight: 400,
  fontSize: 16,
  color: color.ink,
  background: "rgba(255,255,255,0.55)",
  border: `1px solid ${color.hairline}`,
  borderRadius: radius.pill,
  padding: `${space.flow}px ${space.gap}px`,
  cursor: "pointer",
};

// FIELD — input layout recipe. Sunken surface, settled radius,
// generous padding. Replaces inline `inputBase` re-implementations.
export const field = {
  width: "100%",
  fontFamily: font.sans,
  fontSize: 16,
  color: color.ink,
  background: color.paper,
  border: `1px solid ${color.hairline}`,
  borderRadius: radius.field,
  padding: `${space.flow}px ${space.gap}px`,
  boxShadow: shadow.inputInset,
  outline: "none",
};

// HEADERS ─────────────────────────────────────────────────────────
//
// Two registers, used for two different jobs:
//   displayHead   — Pale Martini, hero / tile labels, the line that
//                   should SHOUT brand identity.
//   editorialHead — Fraunces italic 300, support headings inside
//                   forms, sheets, cards. Quieter book voice.
//
// Reach for the one whose JOB matches; don't pick by file location.
export const displayHead = {
  fontFamily: font.display,
  fontWeight: 400,
  letterSpacing: "0.01em",
  textTransform: "none",
  color: color.ink,
};

export const editorialHead = {
  fontFamily: font.serif,
  fontStyle: "italic",
  fontWeight: 300,
  letterSpacing: "-0.02em",
  color: color.ink,
};

// LEGACY — old name kept for any unmigrated callers.
export const headerSerif = editorialHead;

// KICKER — DM Mono uppercase, generous tracking for breath above
// a header. The tracking is deliberately wide; tight kickers read
// as caps-lock noise.
export const kicker = {
  fontFamily: font.mono,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: color.inkMuted,
};
