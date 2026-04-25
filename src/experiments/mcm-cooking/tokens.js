// MCM + Liquid-Glass cooking-app design tokens.
// Single source of truth for the experimental light-mode UI.
// Mid-Century-Modern palette on warm parchment, Apple-style glass
// panels, confident serif headers.

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

  // Tints — used for soft fills, matched-ingredient bubbles, etc.
  tealTint:     "rgba(47,143,131,0.14)",
  aquaTint:     "rgba(111,175,155,0.18)",
  burntTint:    "rgba(217,107,43,0.14)",
  mustardTint:  "rgba(212,166,55,0.18)",
  brownTint:    "rgba(122,78,45,0.14)",

  // Glass primitives. Fill holds enough white to read as a
  // distinct surface (airy cream, not translucent haze) while
  // the backdrop-filter blur + bright edge highlight do the
  // light-bending work. Border is near-opaque white to catch
  // light along the glass edge.
  glassFill:      "rgba(255,255,255,0.62)",
  glassFillLite:  "rgba(255,255,255,0.42)",
  glassFillHeavy: "rgba(255,255,255,0.75)",
  glassBorder:    "rgba(255,255,255,0.85)",
  hairline:       "rgba(30,30,30,0.08)",
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 48,
};

export const shadow = {
  // `glass` stacks four layers: a soft ambient drop, a closer
  // contact shadow, a bright inset highlight along the top edge
  // so the pane catches light, and a faint inset bottom-shadow
  // so the glass reads as a thick pane (light enters top, shadow
  // pools at the bottom) rather than a flat white card.
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
  // Search-field / input surface — reads "sunken" via a faint top
  // inset instead of the top highlight. Paired with a slightly
  // warmer fill to separate it from the panels around it.
  inputInset:
    "inset 0 1px 2px rgba(30,30,30,0.10)," +
    "inset 0 -1px 0 rgba(255,255,255,0.6)," +
    "0 2px 6px rgba(30,30,30,0.04)",
};

export const font = {
  // Editorial serif for body-italic uses — card names, empty-state
  // lines, CTA copy. Fraunces is a soft, humanist serif with a
  // proper italic that reads beautifully at sub-24px.
  serif:   "'Fraunces', 'Iowan Old Style', Georgia, serif",
  // MCM display face — Pale Martini, a custom hand-drawn
  // mid-century display face self-hosted from
  // public/fonts/PaleMartini.woff2 (loaded via @font-face in
  // index.html). Used for the hero ("The Pantry") and tile /
  // drilled labels where the register wants to shout
  // "mid-century magazine cover" rather than "soft book
  // italic." Truculenta + Futura ride the fallback stack so
  // pre-load and old browsers degrade gracefully.
  display: "'Pale Martini', 'Truculenta', 'Futura', 'Trade Gothic', system-ui, sans-serif",
  // Item-name face — Beverly Drive Right (Adobe Fonts/Typekit,
  // loaded via the kit link in index.html). Used ONLY on
  // PantryCard item names so items read in a different
  // typographic register than tile cards. Fraunces italic
  // stays as the fallback ride: pre-load and old browsers
  // degrade to the prior look, unsupported devices to plain
  // serif.
  itemName: "'beverly-drive-right', 'Fraunces', 'Iowan Old Style', Georgia, serif",
  sans:    "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono:    "'DM Mono', 'SF Mono', ui-monospace, Menlo, monospace",
};

// Composed helpers so screens don't re-implement the glass recipe.
// Thick blur so backdrop color blooms — but saturation kept
// moderate so the pane reads as cream glass, not a stained-glass
// color wash of whatever's behind it.
export const glassPanel = {
  background: color.glassFill,
  backdropFilter: "blur(28px) saturate(150%)",
  WebkitBackdropFilter: "blur(28px) saturate(150%)",
  border: `1px solid ${color.glassBorder}`,
  borderRadius: radius.xl,
  boxShadow: shadow.glass,
};

export const glassPanelLight = {
  ...glassPanel,
  background: color.glassFillLite,
};

export const pillChip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: font.sans,
  fontSize: 12,
  fontWeight: 500,
  color: color.ink,
  background: color.glassFillHeavy,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: `1px solid ${color.glassBorder}`,
  borderRadius: radius.pill,
  padding: "6px 12px",
  letterSpacing: "0.02em",
  cursor: "pointer",
  userSelect: "none",
};

// Gradient endpoints darkened from the brand burnt so cream text
// clears WCAG AA (≥4.5:1) across the full surface: top stop
// #C85A1F → cream = 4.93:1, bottom #A34711 → cream = 7.03:1.
// Still reads burnt-orange; the brand token `color.burnt` is
// unchanged so accent tints / text uses keep the original hue.
export const ctaButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontFamily: font.sans,
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: "0.01em",
  color: "#FFF8EE",
  background: "linear-gradient(180deg, #C85A1F 0%, #A34711 100%)",
  border: "1px solid rgba(255,255,255,0.35)",
  borderRadius: radius.pill,
  padding: "14px 22px",
  boxShadow: shadow.cta,
  cursor: "pointer",
};

export const ghostButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  fontFamily: font.sans,
  fontSize: 15,
  fontWeight: 500,
  color: color.ink,
  background: "rgba(255,255,255,0.55)",
  border: `1px solid ${color.hairline}`,
  borderRadius: radius.pill,
  padding: "12px 18px",
  cursor: "pointer",
};

export const headerSerif = {
  fontFamily: font.serif,
  fontStyle: "italic",
  fontWeight: 300,
  letterSpacing: "-0.02em",
  color: color.ink,
};

export const kicker = {
  fontFamily: font.mono,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: color.inkMuted,
};
