// Floating Fridge / Pantry / Freezer dock pinned to the bottom
// of the pantry screen. The LOCATION_DOT swatch palette is
// shared with surfaces that visually echo the dock (drilled-tile
// header, location-empty-state, AddDraftSheet's location row).

import { useState } from "react";
import { motion } from "framer-motion";
import { withAlpha } from "./primitives";
import { useTheme, THEME_TRANSITION } from "./theme";
import { font } from "./tokens";

// Swatch colors for the floating location dock. User-specified
// MCM palette: dark cool blue for the fridge (cold slate), MCM
// orange for the pantry (warm burnt), icy pale blue for the
// freezer. Kept out of the theme tokens because these are
// semantic-fixed (fridge is ALWAYS cold-blue regardless of time-
// of-day) rather than theme-variant.
export const LOCATION_DOT = {
  fridge:  "#2F5A85", // dark cool blue
  pantry:  "#D96B2B", // MCM burnt orange
  freezer: "#A8D8EA", // icy pale blue
};

// Floating location dock — Fridge / Pantry / Freezer switcher
// pinned to the bottom of the viewport instead of the old top-of-
// page segmented control. Three pill segments, each with a solid
// colored swatch dot (in place of the emoji icons it replaced)
// plus the label and a count chip. Sliding active indicator via
// framer-motion layoutId, identical to the previous segmented
// control so the tap interaction is physically familiar.
export function FloatingLocationDock({ locations, active, onSelect, totals }) {
  const { theme } = useTheme();
  const [hovered, setHovered] = useState(null);
  return (
    <motion.div
      role="tablist"
      aria-label="Pantry location"
      // Slide-up entrance. Pops in from below the viewport on
      // mount and on every remount (e.g. when search is cleared
      // and the dock comes back). Quick and springy so it feels
      // like an affordance appearing, not a full screen
      // transition.
      //
      // x: "-50%" is INSIDE the framer animate object (not in
      // CSS transform) because framer-motion writes a single
      // transform property based on its motion values, and any
      // CSS `transform` on the same element gets overwritten.
      // Putting -50% here means the dock stays centered through
      // every animation frame.
      initial={{ opacity: 0, x: "-50%", y: 24 }}
      animate={{ opacity: 1, x: "-50%", y: 0 }}
      exit={{ opacity: 0, x: "-50%", y: 24 }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
      style={{
      position: "fixed",
      left: "50%",
      // Sits above the app-level bottom nav. 96px leaves a ~16px
      // visual gap above a ~80px dark nav bar; bump if the nav is
      // taller on a given device.
      bottom: 96,
      zIndex: 20,
      display: "flex",
      gap: 4,
      padding: 5,
      borderRadius: 999,
      // Theme-aware surface: glassFillHeavy reads bright-cream
      // on morning/day/evening/dawn/dusk and warm-amber at night,
      // so the dock never looks like a stark white pill on a
      // dark backdrop. The border uses the theme's glassBorder
      // so the edge highlights match whatever time-of-day ink
      // the rest of the UI is using.
      background: theme.color.glassFillHeavy,
      border: `1px solid ${theme.color.glassBorder}`,
      backdropFilter: "blur(18px) saturate(160%)",
      WebkitBackdropFilter: "blur(18px) saturate(160%)",
      boxShadow: "0 14px 34px rgba(30,20,8,0.18), 0 3px 10px rgba(30,20,8,0.10)",
      ...THEME_TRANSITION,
    }}>
      {locations.map((loc) => {
        const isActive = active === loc.id;
        const total = totals[loc.id] || 0;
        const dotColor = LOCATION_DOT[loc.id] || theme.color.inkMuted;
        return (
          <button
            key={loc.id}
            onClick={() => onSelect(loc.id)}
            onMouseEnter={() => setHovered(loc.id)}
            onMouseLeave={() => setHovered(null)}
            className="mcm-focusable"
            style={{
              position: "relative",
              minWidth: 96,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 999,
              border: "none",
              background: !isActive && hovered === loc.id
                ? withAlpha(theme.color.ink, 0.04)
                : "transparent",
              cursor: "pointer",
              fontFamily: font.sans,
              fontSize: 13,
              fontWeight: 500,
              color: isActive || hovered === loc.id
                ? theme.color.ink
                : theme.color.inkMuted,
              transition: "color 220ms ease, background 220ms ease",
              whiteSpace: "nowrap",
            }}
          >
            {isActive && (
              <motion.div
                layoutId="location-tab-indicator"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  // Active pill is tinted with the location's own
                  // swatch hue rather than pure glassFillHeavy.
                  // Fixes the "invisible active pill" problem at
                  // night — both glassFillHeavy and the dock bg
                  // were amber-translucent, so the active
                  // indicator had zero contrast. Fridge active
                  // now reads cool-blue-ish, Pantry warm-orange-
                  // ish, Freezer icy-pale-ish regardless of
                  // time-of-day, while staying subtle enough
                  // (15% alpha + glassFillHeavy mix) that it
                  // reads as "tint" not "Fill."
                  background: `linear-gradient(${withAlpha(dotColor, 0.18)}, ${withAlpha(dotColor, 0.18)}), ${theme.color.glassFillHeavy}`,
                  border: `1px solid ${withAlpha(dotColor, 0.35)}`,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 8px rgba(30,30,30,0.10)`,
                  zIndex: 0,
                }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span style={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: 8 }}>
              {/* Colored swatch dot — replaces the old emoji icon.
                  Fridge = dark cool blue, Pantry = MCM burnt orange,
                  Freezer = icy pale blue. Active dot gets a colored
                  halo + bigger inner highlight so the selected
                  segment reads as a "lit pilot light" next to the
                  other two resting dots. Non-active dots stay
                  compact and matte. 200ms transition so the
                  swap between active/inactive looks mechanical
                  rather than flipped. */}
              <span style={{
                display: "inline-block",
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: `radial-gradient(circle at 30% 25%, ${withAlpha("#FFFFFF", isActive ? 0.55 : 0.28)} 0%, ${withAlpha("#FFFFFF", 0)} 55%), ${dotColor}`,
                boxShadow: isActive
                  ? `0 0 0 3px ${withAlpha(dotColor, 0.20)}, 0 1px 3px rgba(30,20,8,0.30)`
                  : `0 1px 2px rgba(30,20,8,0.25), inset 0 1px 0 rgba(255,255,255,0.30)`,
                flexShrink: 0,
                transition: "box-shadow 200ms ease, background 200ms ease",
              }} />
              <span>{loc.label}</span>
              {total > 0 && (
                <span style={{
                  fontFamily: font.mono, fontSize: 10,
                  fontWeight: 500,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: isActive
                    ? withAlpha(theme.color.ink, 0.08)
                    : "transparent",
                  color: isActive ? theme.color.inkMuted : theme.color.inkFaint,
                  letterSpacing: "0.04em",
                }}>
                  {total}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </motion.div>
  );
}
