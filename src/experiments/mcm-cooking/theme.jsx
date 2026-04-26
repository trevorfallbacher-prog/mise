// Theme provider for the MCM cooking-app experiment.
//
// The provider resolves the active palette by CONTINUOUSLY
// interpolating between the four hour-anchored themes in
// themes.js. A fractional hour (e.g. 6.75 for 6:45am) drives the
// blend, so every minute of the day produces a slightly different
// rendered theme — 6:45 doesn't look identical to 4:30.
//
// Modes:
//   - "auto"   → follow the wall clock, re-resolve every minute
//   - "hour"   → override to a specific fractional hour (slider)
//
// Primitives consume `useTheme()` to read the fully-blended
// { color, shadow, glassPanel, ctaButton, ghostButton, backdrop }
// — none of the interpolation logic leaks into screens.
//
// Smooth cross-fades between successive blended values still
// flow through the shared THEME_TRANSITION CSS rule. With
// continuous blending the transition mostly smooths out the
// minute-tick updates on auto mode; during slider drag the
// per-frame re-renders happen faster than the transition and
// the browser just keeps up.

import {
  createContext, useContext, useEffect, useMemo, useState,
} from "react";
import {
  THEMES, THEME_ORDER, currentHour, resolveThemeAtHour,
  glassPanelFor, ctaButtonFor, ghostButtonFor,
} from "./themes";
import { blendThemes } from "./blend";

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  // override: null → auto (wall clock); number → pinned fractional hour
  const [override, setOverride] = useState(null);
  // Tick state used to force a re-resolve on auto mode. Value is
  // irrelevant — setting it triggers the render that recomputes
  // the hour from the fresh Date.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (override !== null) return;
    // Re-resolve once a minute so the auto theme drifts with the
    // clock. One minute is fine-grained enough for the blend to
    // feel alive without wasting cycles.
    const id = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(id);
  }, [override]);

  const hour = override == null ? currentHour() : override;
  const theme = useMemo(
    () => resolveThemeAtHour(hour, blendThemes),
    [hour]
  );

  const value = useMemo(() => ({
    theme,
    hour,
    isAuto:     override == null,
    setHour:    (h) => setOverride(h),
    clearHour:  () => setOverride(null),
    glassPanel: glassPanelFor(theme),
    ctaButton:  ctaButtonFor(theme),
    ghostButton: ghostButtonFor(theme),
  }), [theme, hour, override]);

  return (
    <ThemeCtx.Provider value={value}>
      <ThemeTransitionShell theme={theme}>
        {children}
      </ThemeTransitionShell>
    </ThemeCtx.Provider>
  );
}

// --- Cross-fade wrapper -------------------------------------------------

function ThemeTransitionShell({ theme, children }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: theme.backdrop.base,
        color: theme.color.ink,
        transition: "background 700ms ease, color 700ms ease",
      }}
    >
      {children}
    </div>
  );
}

// --- Consumer hook ------------------------------------------------------

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) {
    // Fallback for isolated renders — resolve at the wall clock
    // using the day theme as a safe anchor pair. Primitives still
    // render something sensible even without a provider.
    const fallback = THEMES.day;
    return {
      theme: fallback,
      hour: currentHour(),
      isAuto: true,
      setHour: () => {},
      clearHour: () => {},
      glassPanel: glassPanelFor(fallback),
      ctaButton:  ctaButtonFor(fallback),
      ghostButton: ghostButtonFor(fallback),
    };
  }
  return ctx;
}

// --- Shared transition rule ---------------------------------------------

// Spread into every primitive that paints theme-dependent color
// props. With continuous blending the rule mostly smooths between
// auto-mode minute ticks; during slider scrub React re-renders
// faster than the transition, so the browser interpolates each
// successive value naturally.
export const THEME_TRANSITION = {
  transition:
    "background 700ms ease," +
    "background-color 700ms ease," +
    "color 700ms ease," +
    "border-color 700ms ease," +
    "box-shadow 700ms ease",
};

// --- Re-exports --------------------------------------------------------

export { THEMES, THEME_ORDER, currentHour, resolveThemeAtHour };
