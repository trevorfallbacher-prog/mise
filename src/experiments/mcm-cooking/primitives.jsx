// Shared visual primitives for the MCM cooking-app experiment —
// warm background, glass panels, starburst accent, CTA + ghost
// buttons, status dot. Kept intentionally small so screens compose
// from the same vocabulary.

import { motion } from "framer-motion";
import {
  color, radius, shadow, font,
  glassPanel, ctaButton, ghostButton,
} from "./tokens";

// --- Background ----------------------------------------------------------

// Warm parchment canvas with two soft MCM color blobs drifting
// behind the glass. Absolutely positioned so it always fills the
// nearest positioned parent.
export function WarmBackdrop({ variant = "pantry" }) {
  // With glass fills dropped to ~0.48 the backdrop now shows
  // through the panels strongly, so the blobs can run warmer
  // saturation without clobbering readability — more color to
  // bend = more "glass" on top. Teal top-left + burnt-orange
  // bottom-right stays the compositional axis; the third blob
  // is a warm mustard/brown to keep the parchment grounded.
  const blobs = variant === "cook"
    ? [
        { bg: "rgba(47,143,131,0.22)",  top: "-12%", left: "-15%", size: 520 },
        { bg: "rgba(217,107,43,0.20)",  top: "55%",  left: "60%",  size: 460 },
        { bg: "rgba(212,166,55,0.14)",  top: "10%",  left: "60%",  size: 320 },
      ]
    : [
        { bg: "rgba(47,143,131,0.20)",  top: "-12%", left: "-12%", size: 500 },
        { bg: "rgba(217,107,43,0.18)",  top: "55%",  left: "62%",  size: 440 },
        { bg: "rgba(122,78,45,0.12)",   top: "70%",  left: "-8%",  size: 320 },
      ];

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: `linear-gradient(180deg, ${color.cream} 0%, ${color.parchment} 100%)`,
        pointerEvents: "none",
      }}
    >
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: b.top,
            left: b.left,
            width: b.size,
            height: b.size,
            background: b.bg,
            borderRadius: "50%",
            filter: "blur(80px)",
          }}
        />
      ))}
      <Starburst
        size={160}
        color="rgba(122,78,45,0.10)"
        style={{ position: "absolute", top: 40, right: -30 }}
      />
      <Starburst
        size={90}
        color="rgba(47,143,131,0.14)"
        style={{ position: "absolute", bottom: 80, left: 16 }}
      />
    </div>
  );
}

// --- Starburst (MCM / Googie motif) --------------------------------------

// A 12-ray starburst rendered as SVG. Used sparingly as a decorative
// flourish — corner of the backdrop, inside the Cook-complete card,
// etc. Kept at ~10-14% opacity so it never competes with content.
export function Starburst({ size = 96, color: c = "rgba(122,78,45,0.14)", style }) {
  const rays = Array.from({ length: 12 });
  const cx = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={style}
      aria-hidden
    >
      {rays.map((_, i) => {
        const angle = (i / rays.length) * 360;
        const long = i % 2 === 0;
        const h = long ? size * 0.48 : size * 0.32;
        return (
          <rect
            key={i}
            x={cx - 2}
            y={cx - h}
            width={4}
            height={h}
            rx={2}
            fill={c}
            transform={`rotate(${angle} ${cx} ${cx})`}
          />
        );
      })}
      <circle cx={cx} cy={cx} r={size * 0.07} fill={c} />
    </svg>
  );
}

// --- Glass panel ---------------------------------------------------------

// The fundamental liquid-glass surface. Accepts a tone prop so
// screens can vary the chroma — default is neutral white-glass,
// "warm" tints slightly mustard for hero cards.
export function GlassPanel({
  children, style, tone = "neutral", variant = "elevated",
  padding = 20, interactive = false, onClick,
}) {
  // Tone sets the chroma of the glass (neutral / warm cream /
  // cool eucalyptus / sunken input tint). Variant sets the depth
  // treatment — "elevated" floats with a top-edge light reflection,
  // "input" sinks with an inset shadow so inputs read as surfaces
  // you type INTO, not panels that sit beside everything else.
  const toneTint = {
    neutral: color.glassFill,
    warm:    "rgba(255,247,232,0.70)",
    cool:    "rgba(232,244,242,0.70)",
    input:   "rgba(246,241,232,0.78)",
  }[tone] || color.glassFill;

  const depthShadow = variant === "input" ? shadow.inputInset : shadow.glass;

  const base = {
    ...glassPanel,
    background: toneTint,
    boxShadow: depthShadow,
    padding,
    cursor: interactive ? "pointer" : "default",
    ...style,
  };

  if (interactive) {
    return (
      <motion.div
        role="button"
        tabIndex={0}
        onClick={onClick}
        whileHover={{ y: -2, boxShadow: shadow.lift }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        style={base}
      >
        {children}
      </motion.div>
    );
  }
  return <div style={base}>{children}</div>;
}

// --- Buttons -------------------------------------------------------------

export function PrimaryButton({ children, onClick, style, disabled }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={!disabled && { scale: 1.02, boxShadow: "0 16px 32px rgba(217,107,43,0.42)" }}
      whileTap={!disabled && { scale: 0.97 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{
        ...ctaButton,
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

export function GhostButton({ children, onClick, style }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ background: "rgba(255,255,255,0.78)" }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.18 }}
      style={{ ...ghostButton, ...style }}
    >
      {children}
    </motion.button>
  );
}

// --- Status dot ----------------------------------------------------------

// Small colored dot for pantry status / step progress. Defaults to
// teal ("you have this / good"). Pass tone="warn" for subtle orange.
export function StatusDot({ tone = "ok", size = 8, style }) {
  const c = tone === "ok" ? color.teal
          : tone === "warn" ? color.burnt
          : tone === "pending" ? color.mustard
          : color.inkFaint;
  // Warn dots get a slightly larger ring + a soft outer glow so
  // the "expiring soon" signal actually catches the eye without
  // turning alarming. Other tones keep the quieter treatment.
  const boxShadow = tone === "warn"
    ? `0 0 0 4px ${c}22, 0 0 10px ${c}66`
    : `0 0 0 3px ${c}22`;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: c,
        boxShadow,
        ...style,
      }}
    />
  );
}

// --- Checkmark (teal confirmation) ---------------------------------------

export function CheckCircle({ size = 20, checked = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle
        cx="12" cy="12" r="10"
        fill={checked ? color.teal : "transparent"}
        stroke={checked ? color.teal : color.inkFaint}
        strokeWidth={checked ? 0 : 1.5}
      />
      {checked && (
        <path
          d="M7.5 12.3 L10.6 15.2 L16.5 9.2"
          fill="none"
          stroke="#FFF8EE"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

// --- Section labels ------------------------------------------------------

export function Kicker({ children, tone }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: tone || color.inkMuted,
      }}
    >
      {children}
    </div>
  );
}

export function SerifHeader({ children, size = 36, style }) {
  return (
    <h1
      style={{
        fontFamily: font.serif,
        fontStyle: "italic",
        fontWeight: 300,
        letterSpacing: "-0.02em",
        fontSize: size,
        lineHeight: 1.05,
        color: color.ink,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </h1>
  );
}

// --- Glass pill ----------------------------------------------------------

// Interactive glass chip used as filter button, nav tab, top-bar
// back/context pill. `active` paints the teal gradient + white text
// used across the app; `size="sm"` tightens padding for dense rows.
// Prefer this over re-rolling a button style block inline.
export function GlassPill({
  children,
  active = false,
  onClick,
  size = "md",
  style,
  as: Tag = motion.button,
}) {
  const pad = size === "sm" ? "6px 12px" : "10px 16px";
  const fontSize = size === "sm" ? 12 : 13;

  // Amped glass: thinner fill + heavy blur + saturation boost so
  // backdrop color blooms through the pill. Inactive pills get a
  // bright top-edge highlight + faint bottom inset so they read
  // as real glass, not flat white. Active pills layer a bigger
  // colored halo and an inner rim.
  const inactiveBoxShadow =
    "0 1px 2px rgba(30,30,30,0.05)," +
    "inset 0 1px 0 rgba(255,255,255,0.85)," +
    "inset 0 -1px 0 rgba(30,30,30,0.05)";
  const activeBoxShadow =
    "0 10px 22px rgba(47,143,131,0.38)," +
    "0 2px 5px rgba(47,143,131,0.22)," +
    "inset 0 1px 0 rgba(255,255,255,0.35)";

  return (
    <Tag
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        fontFamily: font.sans,
        fontSize,
        fontWeight: 500,
        letterSpacing: "0.02em",
        padding: pad,
        borderRadius: radius.pill,
        border: `1px solid ${active ? color.teal : "rgba(255,255,255,0.85)"}`,
        background: active
          ? `linear-gradient(180deg, ${color.teal} 0%, #277A6F 100%)`
          : "rgba(255,255,255,0.42)",
        color: active ? "#FFF8EE" : color.ink,
        boxShadow: active ? activeBoxShadow : inactiveBoxShadow,
        cursor: "pointer",
        backdropFilter: "blur(22px) saturate(180%)",
        WebkitBackdropFilter: "blur(22px) saturate(180%)",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// --- Tinted pill (display-only, axis-colored) ---------------------------

// Small rounded chip used to display axis data at-a-glance:
// location, quantity, timer, ingredient amount. `tone` maps into
// the token palette so screens don't redeclare tint pairs. Not
// interactive by default — pass `onClick` to make it tappable.
const TINTED_PILL_TONE = {
  teal:    { fg: color.teal,      bg: color.tealTint    },
  aqua:    { fg: color.aqua,      bg: color.aquaTint    },
  burnt:   { fg: color.burnt,     bg: color.burntTint   },
  mustard: { fg: color.warmBrown, bg: color.mustardTint },
  brown:   { fg: color.warmBrown, bg: color.brownTint   },
  muted:   { fg: color.inkMuted,  bg: "rgba(30,30,30,0.06)" },
};

export function TintedPill({
  children, tone = "teal", size = "md", mono = false, onClick, style,
}) {
  const { fg, bg } = TINTED_PILL_TONE[tone] || TINTED_PILL_TONE.teal;
  const pad = size === "sm" ? "3px 8px" : "4px 10px";
  const fontSize = size === "sm" ? 10 : 12;
  const clickable = typeof onClick === "function";

  return (
    <span
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: mono ? font.mono : font.sans,
        fontSize,
        fontWeight: 500,
        color: fg,
        background: bg,
        padding: pad,
        borderRadius: radius.pill,
        letterSpacing: mono ? "0.04em" : "0.03em",
        whiteSpace: "nowrap",
        cursor: clickable ? "pointer" : "default",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// --- Back chip (top-bar navigation pill) --------------------------------

// Glass-on-parchment back/context button used at the top of
// secondary screens. Separate from GlassPill because the visual
// weight (lighter background, softer shadow) is tuned for the
// nav-bar spot rather than interactive toggles.
export function BackChip({ children, onClick, style }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ background: "rgba(255,255,255,0.58)" }}
      whileTap={{ scale: 0.96 }}
      transition={{ duration: 0.18 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid rgba(255,255,255,0.85)`,
        background: "rgba(255,255,255,0.42)",
        backdropFilter: "blur(22px) saturate(180%)",
        WebkitBackdropFilter: "blur(22px) saturate(180%)",
        padding: "8px 14px",
        borderRadius: radius.pill,
        fontFamily: font.sans,
        fontSize: 13,
        color: color.ink,
        cursor: "pointer",
        boxShadow:
          "0 2px 6px rgba(30,30,30,0.06)," +
          "inset 0 1px 0 rgba(255,255,255,0.85)," +
          "inset 0 -1px 0 rgba(30,30,30,0.05)",
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

// --- Bottom dock (floating glass tab bar) -------------------------------

// The persistent nav dock floating above the bottom of the screen.
// Pass an array of tab objects and the id of the active one; the
// dock paints the active tab with the teal gradient used by
// GlassPill(active). Ids are stable so consumers can route on them.
export function BottomDock({ tabs, activeId, onSelect, style }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 5,
        ...style,
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          display: "flex",
          gap: 4,
          padding: 6,
          background: "rgba(255,255,255,0.48)",
          backdropFilter: "blur(32px) saturate(180%)",
          WebkitBackdropFilter: "blur(32px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.85)",
          borderRadius: radius.pill,
          boxShadow: shadow.glass,
        }}
      >
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <motion.button
              key={t.id}
              onClick={() => onSelect && onSelect(t.id)}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.18 }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: font.sans,
                fontSize: 13,
                fontWeight: 500,
                padding: "10px 16px",
                borderRadius: radius.pill,
                border: "none",
                background: active
                  ? `linear-gradient(180deg, ${color.teal} 0%, #277A6F 100%)`
                  : "transparent",
                color: active ? "#FFF8EE" : color.ink,
                cursor: "pointer",
                boxShadow: active ? "0 6px 14px rgba(47,143,131,0.30)" : "none",
              }}
            >
              <span style={{ fontSize: 15 }}>{t.glyph}</span> {t.label}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// --- Soft divider --------------------------------------------------------

export function HairlineRule({ style }) {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        background: `linear-gradient(90deg, transparent 0%, ${color.hairline} 50%, transparent 100%)`,
        ...style,
      }}
    />
  );
}

// --- Fade-in mount wrapper ----------------------------------------------

// Apple-style gentle mount — opacity 0→1, scale 0.98→1. Use around
// screen roots so every surface feels like it settles into place.
export function FadeIn({ children, delay = 0, style }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.42, delay, ease: [0.22, 1, 0.36, 1] }}
      style={style}
    >
      {children}
    </motion.div>
  );
}

export { color, radius, shadow, font };
