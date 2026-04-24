// Showcase shell for the MCM cooking-app experiment.
// Lives at URL hash `#mcm-cooking` (wired in src/App.jsx). Hosts
// the Pantry screen as the default entry point and layers the
// Cook screen + Unit picker modal on top as the user navigates.
//
// Wraps everything in ThemeProvider so the three screens pick
// up morning / day / evening / night from the wall clock. A
// tiny floating override picker in the corner lets us scrub
// between themes for design review.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import PantryScreen from "./PantryScreen";
import CookScreen from "./CookScreen";
import UnitPickerModal from "./UnitPickerModal";
import {
  ThemeProvider, useTheme, THEME_ORDER, THEMES, getTimeTheme,
  THEME_TRANSITION,
} from "./theme";
import { withAlpha } from "./primitives";
import { font, radius } from "./tokens";

export default function Showcase() {
  return (
    <ThemeProvider initial="auto">
      <ShowcaseInner />
    </ThemeProvider>
  );
}

function ShowcaseInner() {
  const [screen, setScreen] = useState("pantry"); // "pantry" | "cook"
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);

  const openUnitPicker  = () => setUnitPickerOpen(true);
  const closeUnitPicker = () => setUnitPickerOpen(false);

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <AnimatePresence mode="wait">
        {screen === "pantry" && (
          <motion.div
            key="pantry"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{    opacity: 0 }}
            transition={{ duration: 0.28 }}
          >
            <PantryScreen
              onStartCooking={() => setScreen("cook")}
              onOpenUnitPicker={openUnitPicker}
            />
          </motion.div>
        )}

        {screen === "cook" && (
          <motion.div
            key="cook"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{    opacity: 0 }}
            transition={{ duration: 0.28 }}
          >
            <CookScreen
              onBack={() => setScreen("pantry")}
              onOpenUnitPicker={openUnitPicker}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <UnitPickerModal
        open={unitPickerOpen}
        onClose={closeUnitPicker}
        onApply={() => {}}
      />

      <ThemePicker />
    </div>
  );
}

// --- Theme override picker ----------------------------------------------

// Floating glass pill in the top-right that cycles auto → morning
// → day → evening → night and back. "Auto" shows the resolved
// theme in parentheses so the reviewer can see what the clock
// picked. Uses theme tokens so the picker itself cross-fades with
// the rest of the UI.
function ThemePicker() {
  const { theme, themeId, setThemeId } = useTheme();
  const options = ["auto", ...THEME_ORDER];

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 20,
        display: "flex",
        gap: 4,
        padding: 4,
        borderRadius: radius.pill,
        background: theme.color.glassFill,
        border: `1px solid ${theme.color.glassBorder}`,
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        boxShadow: theme.shadow.soft,
        ...THEME_TRANSITION,
      }}
    >
      {options.map((id) => {
        const active = id === themeId;
        const label = id === "auto" ? "Auto" : THEMES[id].label;
        return (
          <button
            key={id}
            onClick={() => setThemeId(id)}
            style={{
              border: "none",
              cursor: "pointer",
              padding: "6px 10px",
              borderRadius: radius.pill,
              background: active
                ? `linear-gradient(180deg, ${theme.color.teal} 0%, ${withAlpha(theme.color.teal, 1)} 100%)`
                : "transparent",
              color: active ? theme.color.ctaText : theme.color.ink,
              fontFamily: font.sans,
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              boxShadow: active
                ? `0 4px 10px ${withAlpha(theme.color.teal, 0.30)}`
                : "none",
              ...THEME_TRANSITION,
            }}
          >
            {label}
            {id === "auto" && (
              <span
                style={{
                  marginLeft: 4,
                  opacity: 0.6,
                  fontFamily: font.mono,
                  fontSize: 9,
                }}
              >
                {THEMES[getTimeTheme()].label.toLowerCase()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
