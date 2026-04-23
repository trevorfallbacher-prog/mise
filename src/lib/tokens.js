// Design tokens — single source of truth for fonts, colors, spacing,
// radii, and z-indexes used across the app. Previously every inline
// `style={{...}}` hardcoded these as string/number literals (hundreds
// of repetitions); that made global changes — swap a font, shift a
// theme, retune modal layering — a codebase-wide find/replace with
// real risk of missing cases.
//
// How to use these:
//
//   import { FONT, COLOR, RADIUS, SPACE, Z } from "../lib/tokens";
//   <div style={{
//     fontFamily: FONT.mono,
//     color: COLOR.gold,
//     borderRadius: RADIUS.md,
//     padding: SPACE.md,
//   }} />
//
// The values intentionally resolve to the exact same strings/numbers
// the codebase was already using, so adopting tokens in a new file
// produces byte-identical output. Existing files can migrate at
// their own pace without visual drift — an `#f5c842` literal and
// `COLOR.gold` render the same pixel.
//
// When to add a new token vs use a literal:
//   - If the value appears in 2+ places across different files, add
//     a token. Grep first; you'll usually find the pattern already
//     has a name.
//   - One-offs (a single accent color for a specific toast, a
//     specific animation delay) can stay literal — tokens exist to
//     deduplicate, not to enforce uniformity.
//   - Component-scoped constants belong in the component, not here.
//     This file is for values that cross component boundaries.

// ── FONTS ───────────────────────────────────────────────────────────
// Three families, consistently used:
//   * mono  — uppercase labels, chips, metadata (DM Mono)
//   * serif — headlines, identity text, italic flourish (Fraunces)
//   * sans  — body copy, descriptions, input text (DM Sans)
export const FONT = {
  mono:  "'DM Mono',monospace",
  serif: "'Fraunces',serif",
  sans:  "'DM Sans',sans-serif",
};

// ── COLORS ──────────────────────────────────────────────────────────
// Semantic names preferred over hex names — "gold" describes the role
// the color plays, "f5c842" describes what it looks like. Roles
// survive theme changes; hex codes don't.
//
// Grouped by intent. If you're adding a color, first check whether an
// existing semantic covers it — "warm yellow accent" is `gold`, not a
// new `sunlight`.
export const COLOR = {
  // Neutrals — the page's gray ladder.
  night:  "#080808",  // deepest bg (below all modals)
  deep:   "#0a0a0a",  // nested surface bg (inside cards)
  ground: "#141414",  // card bg
  soil:   "#161616",  // subtly elevated from ground
  edge:   "#1e1e1e",  // subtle divider
  border: "#2a2a2a",  // standard border
  sub:    "#444",     // low-contrast text
  muted:  "#666",     // mid-contrast text / disabled
  dim:    "#888",     // inactive label text
  ink:    "#f0ece4",  // primary body text (warm off-white)

  // Accents — the semantic palette for interactivity + state.
  gold:      "#f5c842",  // primary accent — CTAs, selected states
  goldDim:   "#3a2f10",  // gold border / gold-adjacent surface
  goldDeep:  "#1a1608",  // gold selected-bg inside cards
  sky:       "#7eb8d4",  // secondary accent — links, "item" concept
  skyDeep:   "#0f1620",  // sky-selected-bg
  skyBorder: "#1f3040",  // sky border
  leaf:      "#4ade80",  // success, "cook ready", fresh
  leafMuted: "#7ec87e",  // calmer success text
  leafDim:   "#1e3a1e",  // success border
  leafDeep:  "#0f1a0f",  // success-selected-bg
  rose:      "#ef4444",  // destructive, expired, urgent
  roseDim:   "#3a1a1a",  // destructive border
  roseDeep:  "#2a0a0a",  // destructive-selected-bg
  amber:     "#f59e0b",  // warning, running low
  plum:      "#d4a8c7",  // flavor accent (currently flavor rollup only)
};

// ── SPACE ───────────────────────────────────────────────────────────
// The spacing scale the codebase uses. 4pt-like, though not strictly.
// Reach for these instead of new numbers — if a design needs 13px
// padding, either round to the nearest scale step or add a new token
// with a semantic name (e.g. `cardGutter`).
export const SPACE = {
  xs:  4,
  sm:  6,
  md:  8,
  lg:  10,
  xl:  12,
  xxl: 14,
  section: 18,
  hero: 22,
};

// ── RADIUS ──────────────────────────────────────────────────────────
// Corner radii. Cards are `lg`, chips are `sm`, the bottom-sheet
// modals are `xl` (only on the top two corners).
export const RADIUS = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
  sheet: 20,   // bottom-sheet top corners
  pill: 9999,  // full-pill chips
};

// ── Z-INDEX LAYERS ──────────────────────────────────────────────────
// Every modal competes for z-index. Without a layer system, stacking
// bugs are inevitable: a picker layered under its own card, a
// confirmation buried behind a sheet. These values define the stack.
//
// Higher number = on top. Leave gaps (10s) so one-off overrides can
// slot between layers without renumbering.
export const Z = {
  nav:      100,  // bottom tab bar
  backdrop: 150,  // modal backdrop base
  modal:    160,  // AddItemModal, scan confirm
  sheet:    180,  // IngredientDetailSheet, scan picker sheets
  card:     320,  // ItemCard (primary drill)
  picker:   340,  // LinkIngredient (over cards)
  confirm:  350,  // delete confirmation (over everything user-destructive)
  toast:    400,  // toast notifications
};

// ── TRANSITIONS ─────────────────────────────────────────────────────
// Shared motion timings. Matching these across components makes the
// app feel cohesive (fast things feel fast, slow things feel
// intentional).
export const MOTION = {
  fast:   "0.12s ease",
  normal: "0.18s ease",
  slow:   "0.30s ease",
};

// Framer-motion friendly spring/tween presets. Use the token rather
// than hand-rolling `{ type: "spring", stiffness: 400, ... }` in each
// component — it drifts fast and the app stops feeling cohesive.
export const SPRING = {
  // snappy press feedback (chip taps, button press)
  tap:    { type: "spring", stiffness: 520, damping: 32, mass: 0.6 },
  // default sheet / modal enter
  sheet:  { type: "spring", stiffness: 360, damping: 34, mass: 0.9 },
  // list items mounting in
  stagger:{ type: "spring", stiffness: 300, damping: 28, mass: 0.8 },
  // soft, gentle settle (toasts, overlays)
  soft:   { type: "spring", stiffness: 220, damping: 26, mass: 1 },
};

// ── CHIP TONES (reserved color axis palette) ────────────────────────
// Every identity-axis chip in the app must pull its color from this
// map. Keys mirror the CLAUDE.md reserved-color hierarchy:
//   canonical → tan   | cut         → rust   | category → orange
//   location  → blue  | state       → purple | ingredient → yellow
// Never hand-roll a `background: "#e07a3a1a"` at the callsite — reach
// for `CHIP_TONES.category` instead. `locationMuted` is the muted
// LOCATION variant (fridge/pantry/freezer — the axis above STORED IN).
export const CHIP_TONES = {
  canonical:     { fg: "#b8a878", bg: "#1a1508", border: "#3a2f10" }, // tan
  cut:           { fg: "#a8553a", bg: "#1a0c07", border: "#3a1a10" }, // rust
  category:      { fg: "#e07a3a", bg: "#1a0f08", border: "#3a1f0e" }, // orange
  location:      { fg: "#7eb8d4", bg: "#0f1620", border: "#1f3040" }, // blue (STORED IN tile)
  locationMuted: { fg: "#7eb8d4aa", bg: "#0d1218", border: "#1a2430" }, // muted blue (LOCATION)
  state:         { fg: "#c7a8d4", bg: "#16101e", border: "#2f2440" }, // purple
  ingredients:   { fg: "#f5c842", bg: "#1e1a0e", border: "#3a3010" }, // yellow
};

// ── CHIP STYLES ─────────────────────────────────────────────────────
// Reusable chip styles matching the scan-draft / ItemCard reference
// pattern in Kitchen.jsx. DM Mono 9px, letter-spaced, emoji +
// UPPERCASE when set, dashed grey "+ set <axis>" when unset. Keyed by
// `CHIP_TONES` tone.
//
// USAGE:
//   import { SET_CHIP, UNSET_CHIP, CHIP_TONES } from "../lib/tokens";
//   <button style={SET_CHIP(CHIP_TONES.category)}>🍞 BREAD</button>
//   <button style={UNSET_CHIP}>+ set category</button>
//
// Do NOT hand-roll chip styles. If you need a new variant, extend
// this file, not the consumer.
export const SET_CHIP = (tone) => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  fontFamily: FONT.mono, fontSize: 9,
  color: tone.fg, background: tone.bg,
  border: `1px solid ${tone.border}`,
  borderRadius: RADIUS.sm, padding: "2px 6px",
  letterSpacing: "0.08em", cursor: "pointer",
  transition: `background ${MOTION.fast}, border-color ${MOTION.fast}, transform ${MOTION.fast}`,
});
export const UNSET_CHIP = {
  display: "inline-flex", alignItems: "center",
  fontFamily: FONT.mono, fontSize: 9,
  color: COLOR.muted, background: "transparent",
  border: `1px dashed ${COLOR.border}`,
  borderRadius: RADIUS.sm, padding: "1px 6px",
  letterSpacing: "0.08em", cursor: "pointer",
  transition: `border-color ${MOTION.fast}, color ${MOTION.fast}, background ${MOTION.fast}`,
};

// ── PICKER STYLES (ModalSheet picker content) ───────────────────────
// Every ModalSheet that functions as an axis picker (CANONICAL,
// CATEGORY, STORED IN, etc.) renders a kicker label in DM Mono tinted
// the axis color, a Fraunces italic title, and a list of option
// buttons. These styles keep all of them visually synchronized.
export const pickerKicker = (color) => ({
  fontFamily: FONT.mono, fontSize: 10,
  color, letterSpacing: "0.12em",
  marginBottom: 10,
});
export const pickerTitle = {
  fontFamily: FONT.serif, fontSize: 20,
  fontStyle: "italic", color: COLOR.ink,
  fontWeight: 400, margin: "0 0 6px", lineHeight: 1.2,
};
export function pickerOptionStyle(active, tone) {
  return {
    display: "flex", alignItems: "center", gap: 10,
    padding: "12px 14px",
    background: active ? tone.bg : COLOR.ground,
    border: `1px solid ${active ? tone.border : COLOR.edge}`,
    borderRadius: RADIUS.lg,
    textAlign: "left", cursor: "pointer",
    fontFamily: FONT.sans,
    transition: `background ${MOTION.fast}, border-color ${MOTION.fast}, transform ${MOTION.fast}`,
  };
}
