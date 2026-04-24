// Showcase shell for the MCM cooking-app experiment.
// Lives at URL hash `#mcm-cooking` (wired in src/App.jsx). Hosts
// the Pantry screen as the default entry point and layers the
// Cook screen + Unit picker modal on top as the user navigates.
//
// Wraps everything in ThemeProvider so the three screens pick
// up morning / day / evening / night from the wall clock. A
// tiny floating override picker in the corner lets us scrub
// between themes for design review.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import PantryScreen from "./PantryScreen";
import CookScreen from "./CookScreen";
import UnitPickerModal from "./UnitPickerModal";
import {
  ThemeProvider, useTheme, THEMES, getTimeTheme,
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

// --- Theme scrubber -----------------------------------------------------

// Floating glass panel in the top-right with an hour slider
// (0–23) + auto toggle. Dragging the slider sets a fake "now",
// feeds it through getTimeTheme(), and pushes the resolved
// morning/day/evening/night id into the provider — so the browser's
// 700ms cross-fade (THEME_TRANSITION) kicks in at each boundary
// and the reviewer sees the progression smoothly as they scrub.
//
// "Auto" releases the override and lets the provider re-resolve
// from the wall clock.
function ThemePicker() {
  const { theme, themeId, setThemeId } = useTheme();

  // Local slider hour. When `isAuto` is true we just mirror the
  // real clock hour so the thumb stays where "now" is. When the
  // user drags, we flip to manual and drive the theme from hour.
  const [sliderHour, setSliderHour] = useState(() => new Date().getHours());
  const isAuto = themeId === "auto";

  // Keep the thumb tracking the clock while in auto.
  useEffect(() => {
    if (!isAuto) return;
    const id = setInterval(() => setSliderHour(new Date().getHours()), 60 * 1000);
    return () => clearInterval(id);
  }, [isAuto]);

  const shownHour = isAuto ? new Date().getHours() : sliderHour;
  const resolvedId = getTimeTheme(shownHour);
  const resolvedLabel = THEMES[resolvedId].label;

  const handleScrub = (e) => {
    const h = Number(e.target.value);
    setSliderHour(h);
    setThemeId(getTimeTheme(h));
  };

  const onAuto = () => {
    setThemeId("auto");
    setSliderHour(new Date().getHours());
  };

  // Format 0–23 as "7am / 2pm / 12am" for the live label.
  const hourLabel = formatHour(shownHour);

  // Inject a tiny scoped stylesheet so the native <input type="range">
  // picks up our thumb + track styling. Scoped by class so it can't
  // leak into any other sliders that might land on the page later.
  return (
    <>
      <style>{RANGE_CSS}</style>
      <div
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderRadius: radius.pill,
          background: theme.color.glassFill,
          border: `1px solid ${theme.color.glassBorder}`,
          backdropFilter: "blur(20px) saturate(150%)",
          WebkitBackdropFilter: "blur(20px) saturate(150%)",
          boxShadow: theme.shadow.soft,
          ...THEME_TRANSITION,
        }}
      >
        <button
          onClick={onAuto}
          style={{
            border: "none",
            cursor: "pointer",
            padding: "5px 10px",
            borderRadius: radius.pill,
            background: isAuto
              ? `linear-gradient(180deg, ${theme.color.teal} 0%, ${withAlpha(theme.color.teal, 1)} 100%)`
              : "transparent",
            color: isAuto ? theme.color.ctaText : theme.color.ink,
            fontFamily: font.sans,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            boxShadow: isAuto
              ? `0 4px 10px ${withAlpha(theme.color.teal, 0.30)}`
              : "none",
            ...THEME_TRANSITION,
          }}
          title="Follow wall clock"
        >
          Auto
        </button>

        <div
          className="mcm-slider"
          style={{
            // CSS custom props drive the track colors so the same
            // rules in RANGE_CSS theme themselves.
            "--mcm-track-fill":   theme.color.teal,
            "--mcm-track-empty":  theme.color.hairline,
            "--mcm-thumb-bg":     theme.color.glassFillHeavy,
            "--mcm-thumb-border": theme.color.glassBorder,
            "--mcm-thumb-accent": theme.color.teal,
            // Fill the track up to the current value.
            "--mcm-progress":     `${(shownHour / 23) * 100}%`,
            display: "flex",
            alignItems: "center",
          }}
        >
          <input
            type="range"
            min="0"
            max="23"
            step="1"
            value={shownHour}
            onChange={handleScrub}
            aria-label="Time of day"
            style={{ width: 180 }}
          />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            lineHeight: 1.1,
            minWidth: 56,
          }}
        >
          <span style={{
            fontFamily: font.mono, fontSize: 10,
            color: theme.color.inkMuted, letterSpacing: "0.06em",
            ...THEME_TRANSITION,
          }}>
            {hourLabel}
          </span>
          <span style={{
            fontFamily: font.serif, fontStyle: "italic",
            fontSize: 14, fontWeight: 400,
            color: theme.color.ink,
            ...THEME_TRANSITION,
          }}>
            {resolvedLabel}
          </span>
        </div>
      </div>
    </>
  );
}

function formatHour(h) {
  const period = h < 12 ? "am" : "pm";
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hr}${period}`;
}

// Scoped range-input styling. Browsers don't let us style the
// thumb/track from inline styles, so we inject a small rule set
// that reads theme values through CSS custom props set on the
// wrapper. Keeps everything on the same cross-fade timeline.
const RANGE_CSS = `
.mcm-slider input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  height: 22px;
  cursor: pointer;
  margin: 0;
  padding: 0;
}
.mcm-slider input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--mcm-track-fill) 0%,
    var(--mcm-track-fill) var(--mcm-progress),
    var(--mcm-track-empty) var(--mcm-progress),
    var(--mcm-track-empty) 100%
  );
  transition: background 700ms ease;
}
.mcm-slider input[type="range"]::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: var(--mcm-track-empty);
  transition: background 700ms ease;
}
.mcm-slider input[type="range"]::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: var(--mcm-track-fill);
  transition: background 700ms ease;
}
.mcm-slider input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border-radius: 50%;
  background: var(--mcm-thumb-bg);
  border: 1.5px solid var(--mcm-thumb-accent);
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
  cursor: grab;
  transition: background 700ms ease, border-color 700ms ease, transform 120ms ease;
}
.mcm-slider input[type="range"]:active::-webkit-slider-thumb { cursor: grabbing; transform: scale(1.12); }
.mcm-slider input[type="range"]::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--mcm-thumb-bg);
  border: 1.5px solid var(--mcm-thumb-accent);
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
  cursor: grab;
  transition: background 700ms ease, border-color 700ms ease, transform 120ms ease;
}
.mcm-slider input[type="range"]:active::-moz-range-thumb { cursor: grabbing; transform: scale(1.12); }
.mcm-slider input[type="range"]:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--mcm-thumb-accent);
  outline-offset: 2px;
}
`;
