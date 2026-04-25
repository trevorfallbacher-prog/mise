// Showcase shell for the MCM cooking-app experiment.
// Lives at URL hash `#mcm-cooking` (wired in src/App.jsx). Hosts
// the Pantry screen as the default entry point and layers the
// Cook screen + Unit picker modal on top as the user navigates.
//
// Wraps everything in ThemeProvider so the three screens pick up
// a fractional-hour blend of morning / day / evening / night. A
// fine-grained slider in the top-right scrubs through the day at
// 15-minute steps — 6:45am and 4:30am render visibly differently
// because the theme is a continuous blend, not four discrete
// snapshots.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import KitchenScreen from "./KitchenScreen";
import CookScreen from "./CookScreen";
import UnitPickerModal from "./UnitPickerModal";
import {
  ThemeProvider, useTheme, THEMES, currentHour, THEME_TRANSITION,
} from "./theme";
import { withAlpha } from "./primitives";
import { font, radius } from "./tokens";

export default function Showcase() {
  return (
    <ThemeProvider>
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
            <KitchenScreen
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

      <ThemeScrubber />
    </div>
  );
}

// --- Theme scrubber -----------------------------------------------------

// Floating glass panel in the top-right. Auto follows the wall
// clock; drag the slider to pin a fractional hour (0–24, 15-min
// steps) and the theme continuously blends through all four
// anchors as you scrub — 6:45am and 4:30am produce visibly
// different rendered states because they sit at different
// fractional positions between the night/morning anchor pair.
//
// Track + thumb are styled via a scoped <style> block reading
// theme tokens through CSS custom properties, so the control
// itself cross-fades with everything else on the page.
function ThemeScrubber() {
  const { theme, hour, isAuto, setHour, clearHour } = useTheme();

  const displayHour = Math.max(0, Math.min(23.999, hour));
  const sliderValue = Math.round(displayHour * 4); // quarter-hour units (0..95)

  const handleScrub = (e) => {
    const quarters = Number(e.target.value);
    setHour(quarters / 4);
  };

  const onAuto = () => clearHour();
  const nearestLabel = nearestAnchorLabel(displayHour);
  const timeLabel = formatHour(displayHour);

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
            "--mcm-track-fill":   theme.color.teal,
            "--mcm-track-empty":  theme.color.hairline,
            "--mcm-thumb-bg":     theme.color.glassFillHeavy,
            "--mcm-thumb-border": theme.color.glassBorder,
            "--mcm-thumb-accent": theme.color.teal,
            "--mcm-progress":     `${(displayHour / 23.999) * 100}%`,
            display: "flex",
            alignItems: "center",
          }}
        >
          <input
            type="range"
            min="0"
            max="95"
            step="1"
            value={sliderValue}
            onChange={handleScrub}
            aria-label="Time of day"
            style={{ width: 200 }}
          />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            lineHeight: 1.1,
            minWidth: 68,
          }}
        >
          <span style={{
            fontFamily: font.mono, fontSize: 10,
            color: theme.color.inkMuted, letterSpacing: "0.06em",
            ...THEME_TRANSITION,
          }}>
            {timeLabel}
          </span>
          <span style={{
            fontFamily: font.serif, fontStyle: "italic",
            fontSize: 14, fontWeight: 400,
            color: theme.color.ink,
            ...THEME_TRANSITION,
          }}>
            {nearestLabel}
          </span>
        </div>
      </div>
    </>
  );
}

// --- helpers -----------------------------------------------------------

// 6.75 → "6:45am". Rounds to the nearest minute for readability.
function formatHour(h) {
  const hrInt = Math.floor(h);
  const mins  = Math.round((h - hrInt) * 60);
  const period = hrInt < 12 ? "am" : "pm";
  const hr12 = hrInt === 0 ? 12 : hrInt > 12 ? hrInt - 12 : hrInt;
  const mm = String(mins).padStart(2, "0");
  return `${hr12}:${mm}${period}`;
}

// Which anchor is closest to this hour? Used for the "Morning"/
// "Day"/"Evening"/"Night" label line under the clock time.
function nearestAnchorLabel(h) {
  let best = null;
  let bestDist = Infinity;
  for (const id of Object.keys(THEMES)) {
    const anchor = THEMES[id];
    const d1 = Math.abs(h - anchor.hour);
    const d2 = Math.abs(h - anchor.hour + 24); // wrap
    const d3 = Math.abs(h - anchor.hour - 24);
    const d  = Math.min(d1, d2, d3);
    if (d < bestDist) {
      bestDist = d;
      best = anchor;
    }
  }
  return best ? best.label : "—";
}

// Scoped range-input styling. Browsers don't expose thumb/track
// to inline styles, so we inject a small rule set that reads
// theme values through CSS custom properties set on the wrapper.
// Keeps everything on the same cross-fade timeline.
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
