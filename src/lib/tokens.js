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
