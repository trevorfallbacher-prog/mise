// Theme provider for the MCM cooking-app experiment.
//
// Wraps the showcase tree. Resolves the active theme either from
// the current hour (auto) or a manual override for demo/testing.
// Primitives consume `useTheme()` to read theme-derived colors,
// shadows, and the composed glass/CTA/ghost recipes — nothing
// hardcoded in screens.
//
// Smooth cross-fade between themes is handled in one place: we
// paint `transition: background-color/color/border-color/box-shadow
// 600ms ease` on the root wrapper, so when React re-renders
// primitives with new inline styles after a theme swap, the
// browser interpolates between the old and new computed values.
// No per-element framer-motion animation needed.

import {
  createContext, useContext, useEffect, useMemo, useState,
} from "react";
import {
  THEMES, THEME_ORDER, getTimeTheme,
  glassPanelFor, ctaButtonFor, ghostButtonFor,
} from "./themes";

const ThemeCtx = createContext(null);

export function ThemeProvider({
  children,
  // One of "auto" | "morning" | "day" | "evening" | "night".
  // Default "auto" follows the wall clock; a specific id pins
  // the theme for the life of the provider (or until setThemeId
  // is called from a child via useThemeControl).
  initial = "auto",
}) {
  const [themeId, setThemeId] = useState(initial);
  // When auto, re-resolve the active theme every five minutes so
  // a long session naturally rolls morning → day → evening → night
  // without a reload. 5min is coarse enough that it never fires
  // mid-interaction but fine enough to catch a boundary crossing.
  // We store the "now" timestamp in state so the interval forces
  // a re-render + fresh getTimeTheme() call.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (themeId !== "auto") return;
    const id = setInterval(() => setNow(Date.now()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [themeId]);

  const activeId = themeId === "auto" ? getTimeTheme() : themeId;
  const theme = THEMES[activeId] || THEMES.day;

  // Memoize derived recipes so primitive style objects stay stable
  // between renders when the theme hasn't changed.
  const value = useMemo(() => ({
    theme,
    activeId,
    themeId,
    setThemeId,
    glassPanel: glassPanelFor(theme),
    ctaButton:  ctaButtonFor(theme),
    ghostButton: ghostButtonFor(theme),
  }), [theme, activeId, themeId]);

  return (
    <ThemeCtx.Provider value={value}>
      <ThemeTransitionShell theme={theme}>
        {children}
      </ThemeTransitionShell>
    </ThemeCtx.Provider>
  );
}

// --- Cross-fade wrapper -------------------------------------------------

// Paints the background fill on a full-height root. Any descendant
// element that declares `transition: <prop> 600ms` (see the shared
// style object below) animates between themes automatically when
// React re-renders with new inline values.
function ThemeTransitionShell({ theme, children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.backdrop.base,
        color: theme.color.ink,
        transition:
          "background 700ms ease, color 700ms ease",
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
    // Allow primitives to be used outside the provider (e.g. in
    // isolated design tests) by falling back to the day theme.
    const fallback = THEMES.day;
    return {
      theme: fallback,
      activeId: "day",
      themeId: "day",
      setThemeId: () => {},
      glassPanel: glassPanelFor(fallback),
      ctaButton:  ctaButtonFor(fallback),
      ghostButton: ghostButtonFor(fallback),
    };
  }
  return ctx;
}

// --- Shared transition rule ---------------------------------------------

// Every primitive that paints theme-dependent color props spreads
// this into its inline style so the browser knows which props to
// animate when React swaps the computed values. Keep in one place
// so the transition duration/curve stays uniform.
export const THEME_TRANSITION = {
  transition:
    "background 700ms ease," +
    "background-color 700ms ease," +
    "color 700ms ease," +
    "border-color 700ms ease," +
    "box-shadow 700ms ease",
};

// --- Re-exports for ergonomics -----------------------------------------

export { THEMES, THEME_ORDER, getTimeTheme };
