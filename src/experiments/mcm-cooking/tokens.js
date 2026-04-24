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

  // Glass primitives.
  glassFill:      "rgba(255,255,255,0.65)",
  glassFillLite:  "rgba(255,255,255,0.45)",
  glassFillHeavy: "rgba(255,255,255,0.80)",
  glassBorder:    "rgba(255,255,255,0.60)",
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
  // `glass` stacks three layers: a soft ambient drop, a closer
  // contact shadow, and an inset highlight along the top edge so
  // the panel reads as "light passing through" instead of a flat
  // white card. Every GlassPanel inherits this; keep it consistent.
  glass:
    "0 20px 40px rgba(0,0,0,0.08)," +
    "0 4px 10px rgba(0,0,0,0.05)," +
    "inset 0 1px 0 rgba(255,255,255,0.55)",
  soft:  "0 8px 20px rgba(30,30,30,0.06), 0 1px 2px rgba(30,30,30,0.04)",
  lift:
    "0 24px 50px rgba(30,30,30,0.12)," +
    "0 6px 14px rgba(30,30,30,0.06)," +
    "inset 0 1px 0 rgba(255,255,255,0.55)",
  cta:   "0 12px 26px rgba(217,107,43,0.35), 0 2px 6px rgba(217,107,43,0.25)",
  // Search-field / input surface — reads "sunken" via a faint top
  // inset instead of the top highlight. Paired with a slightly
  // warmer fill to separate it from the panels around it.
  inputInset:
    "inset 0 1px 2px rgba(30,30,30,0.08)," +
    "0 1px 1px rgba(255,255,255,0.4)",
};

export const font = {
  serif: "'Fraunces', 'Iowan Old Style', Georgia, serif",
  sans:  "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono:  "'DM Mono', 'SF Mono', ui-monospace, Menlo, monospace",
};

// Composed helpers so screens don't re-implement the glass recipe.
export const glassPanel = {
  background: color.glassFill,
  backdropFilter: "blur(24px) saturate(140%)",
  WebkitBackdropFilter: "blur(24px) saturate(140%)",
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

export const ctaButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontFamily: font.sans,
  fontSize: 16,
  fontWeight: 500,
  letterSpacing: "0.01em",
  color: "#FFF8EE",
  background: `linear-gradient(180deg, ${color.burnt} 0%, #C95A20 100%)`,
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
