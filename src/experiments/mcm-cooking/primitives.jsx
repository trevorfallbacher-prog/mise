// Shared visual primitives for the MCM cooking-app experiment.
//
// Every theme-dependent value (color, shadow, glass recipe) flows
// through `useTheme()` — screens never hardcode color. Theme-
// invariant tokens (radius, font) still come from tokens.js since
// they don't change with time-of-day.
//
// Each primitive that paints color props spreads THEME_TRANSITION
// into its inline style so the browser interpolates between
// themes when React re-renders with new values.

import { motion } from "framer-motion";
import { radius, font } from "./tokens";
import { useTheme, THEME_TRANSITION } from "./theme";

// --- Background ---------------------------------------------------------

// Warm parchment canvas with soft MCM color blobs drifting behind
// the glass. Theme owns the base gradient + blob list, so the
// backdrop naturally shifts with the time-of-day blend.
//
// The sun and moon both trace an east→west arc across the top of
// the frame, driven by the fractional hour rather than a discrete
// isNight swap. Sun is visible from dawn (5h) to dusk (21h), peaking
// at midday; the moon inherits the sky from dusk through dawn. At
// the horizon each fades out; during the pure-day / pure-night
// plateaus the celestial body sits near the peak of its arc.
// Secondary sky decorations (teal daytime starburst and scattered
// white stars) cross-fade by the same hour-based opacity curves.
// Slow drift keyframes for the three backdrop blobs. Each blob
// gets a different orbit period + path so the sky never lines up
// the same way twice; at night this reads as gentle cosmic drift,
// during the day it's imperceptible movement behind the glass.
// Hoisted as a single <style> block so we're not re-parsing on
// every re-render.
const SKY_DRIFT_CSS = `
@keyframes mcm-drift-0 {
  0%   { transform: translate(0, 0); }
  33%  { transform: translate(36px, -24px); }
  66%  { transform: translate(-18px, 30px); }
  100% { transform: translate(0, 0); }
}
@keyframes mcm-drift-1 {
  0%   { transform: translate(0, 0); }
  50%  { transform: translate(-44px, 28px); }
  100% { transform: translate(0, 0); }
}
@keyframes mcm-drift-2 {
  0%   { transform: translate(0, 0); }
  40%  { transform: translate(28px, 36px); }
  80%  { transform: translate(-22px, -14px); }
  100% { transform: translate(0, 0); }
}
`;
// Seconds-long periods — slow enough that you never consciously
// notice the motion, fast enough that coming back after a minute
// the sky has visibly shifted.
const DRIFT_DURATIONS = [96, 124, 152];

export function WarmBackdrop() {
  const { theme, hour } = useTheme();

  const sun  = sunArc(hour);
  const moon = moonArc(hour);
  const dayDecor   = daytimeOpacity(hour);
  const nightDecor = nighttimeOpacity(hour);

  // CSS transition on the celestial wrappers — lets the browser
  // interpolate each new transform/opacity from the previous frame.
  // Fast enough to feel responsive while slider-scrubbing, slow
  // enough to smooth the 1-minute auto-mode ticks.
  const celestialTransition =
    "transform 800ms cubic-bezier(0.22, 1, 0.36, 1)," +
    "opacity 800ms ease";

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: theme.backdrop.base,
        pointerEvents: "none",
        ...THEME_TRANSITION,
      }}
    >
      <style>{SKY_DRIFT_CSS}</style>
      {theme.backdrop.blobs.map((b, i) => (
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
            animation: `mcm-drift-${i % 3} ${DRIFT_DURATIONS[i % 3]}s ease-in-out infinite`,
            ...THEME_TRANSITION,
          }}
        />
      ))}

      {/* SUN — big warm starburst arcing east→west across the day. */}
      <div
        style={{
          position: "absolute",
          top: 40, right: -30,
          transform: `translate(${sun.x}px, ${sun.y}px) rotate(${sun.rotate}deg) scale(${sun.scale})`,
          opacity: sun.opacity,
          transition: celestialTransition,
        }}
      >
        <Starburst
          size={160}
          color={withAlpha(theme.color.warmBrown, 0.10)}
        />
      </div>

      {/* MOON — crescent arcing east→west across the night. */}
      <div
        style={{
          position: "absolute",
          top: 28, right: 10,
          transform: `translate(${moon.x}px, ${moon.y}px) rotate(${moon.rotate}deg) scale(${moon.scale})`,
          opacity: moon.opacity,
          transition: celestialTransition,
        }}
      >
        <CrescentMoon size={140} />
      </div>

      {/* SECONDARY STARBURST — small teal corner during the day. */}
      <div
        style={{
          position: "absolute",
          bottom: 80, left: 16,
          opacity: dayDecor,
          transform: `scale(${0.85 + dayDecor * 0.15})`,
          transition: celestialTransition,
        }}
      >
        <Starburst
          size={90}
          color={withAlpha(theme.color.teal, 0.14)}
        />
      </div>

      {/* STARS — constellation visible through the night. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: nightDecor,
          transition: "opacity 800ms ease",
        }}
      >
        <TwinkleStar size={20} style={{ position: "absolute", top: 120, left: 48 }} />
        <TwinkleStar size={14} style={{ position: "absolute", top: 260, left: 140 }} />
        <TwinkleStar size={16} style={{ position: "absolute", top: 200, right: 180 }} />
        <TwinkleStar size={12} style={{ position: "absolute", bottom: 280, right: 60 }} />
        <TwinkleStar size={18} style={{ position: "absolute", bottom: 180, left: 72 }} />
        <TwinkleStar size={10} style={{ position: "absolute", top: 400, right: 40 }} />
      </div>
    </div>
  );
}

// --- Celestial arc math -------------------------------------------------

// Map the fractional hour to a parabolic east→west arc. Sun is
// visible from dawn (5h) through dusk (21h); moon covers the
// wrap-around 21h → 5h. Both peak near the centerline of their
// arc and fade out near the horizon.
function sunArc(hour) {
  if (hour < 5 || hour > 21) return BELOW_HORIZON_RIGHT;
  const p = (hour - 5) / 16;  // 0 at dawn, 1 at dusk
  return arcPosition(p);
}

function moonArc(hour) {
  let p;
  if (hour >= 21)      p = (hour - 21) / 8;   // 21 → 24: first quarter of arc
  else if (hour <= 5)  p = (hour + 3) / 8;    // 0 → 5 : remaining arc
  else return BELOW_HORIZON_LEFT;
  return arcPosition(p);
}

// Shared arc shape — parabolic drop-and-rise across the horizontal
// axis. x sweeps from -120 (east) to +120 (west). y dips to 0 at
// the peak and reaches 260 at the horizons. Rotation drifts
// slightly for organic character.
function arcPosition(p) {
  const x       = -120 + 240 * p;
  const y       = 260  * (1 - Math.sin(Math.PI * p));
  const rotate  = -14  + 28  * p;
  const scale   = 0.88 + 0.12 * Math.sin(Math.PI * p);
  // Opacity: sharp fade inside the first/last 8% of the arc, full
  // visibility otherwise. Keeps the sun/moon crisp when they're in
  // the sky and prevents a ghosty half-visible state at horizons.
  let opacity = 1;
  if      (p < 0.08) opacity = p / 0.08;
  else if (p > 0.92) opacity = (1 - p) / 0.08;
  return { x, y, rotate, scale, opacity };
}

const BELOW_HORIZON_RIGHT = { x: 120, y: 360, rotate: 40,  scale: 0.8, opacity: 0 };
const BELOW_HORIZON_LEFT  = { x: -120, y: 360, rotate: -40, scale: 0.8, opacity: 0 };

// Daytime decorations (teal corner starburst) are visible from 7h
// to 19h, with 1-hour ramps at each edge. Mirror of nighttimeOpacity.
function daytimeOpacity(hour) {
  if (hour >= 7  && hour <= 19) return 1;
  if (hour > 6  && hour < 7)    return hour - 6;
  if (hour > 19 && hour < 20)   return 20 - hour;
  return 0;
}

// Nighttime decorations (stars) are visible from 21h through 5h
// with 30-min ramps. Full-on plateau matches the night-plateau
// anchor pair in themes.js (21 → 5).
function nighttimeOpacity(hour) {
  if (hour >= 21.5)                return 1;
  if (hour <= 4.5)                 return 1;
  if (hour >= 21 && hour < 21.5)   return (hour - 21) / 0.5;
  if (hour > 4.5 && hour < 5)      return (5 - hour) / 0.5;
  return 0;
}

// --- Starburst (MCM / Googie motif) -------------------------------------

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

// --- Crescent moon (MCM) ------------------------------------------------

// A classic mid-century crescent — full disk with a second disk
// masked out to carve the bite, a soft outer glow to suggest
// moonlight, and a tiny plus-star tucked into the concave curve.
// All cream/off-white so the moon reads quiet against a cool-dark
// sky (no warm cast).
export function CrescentMoon({ size = 140, style }) {
  const gid = `moonGlow-${size}`;
  const mid = `moonMask-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={style}
      aria-hidden
    >
      <defs>
        <radialGradient id={gid} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(255,250,232,0.30)" />
          <stop offset="55%"  stopColor="rgba(255,250,232,0.08)" />
          <stop offset="100%" stopColor="rgba(255,250,232,0)"    />
        </radialGradient>
        {/* The mask: white shows, black hides. The second circle
            bites a crescent out of the first. */}
        <mask id={mid} maskUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="black" />
          <circle cx="50" cy="50" r="26" fill="white" />
          <circle cx="61" cy="44" r="22" fill="black" />
        </mask>
      </defs>
      {/* Soft outer glow — a faint moonlit halo */}
      <circle cx="50" cy="50" r="46" fill={`url(#${gid})`} />
      {/* The crescent itself */}
      <g mask={`url(#${mid})`}>
        <circle cx="50" cy="50" r="26" fill="rgba(245,242,230,0.94)" />
      </g>
      {/* Subtle inner ring on the crescent face — atomic-age detail */}
      <circle
        cx="50" cy="50" r="20"
        fill="none"
        stroke="rgba(245,242,230,0.18)"
        strokeWidth="0.6"
        mask={`url(#${mid})`}
      />
      {/* Tiny MCM plus-star tucked in the concave curve */}
      <g transform="translate(72 54)">
        <path
          d="M0 -5 L0 5 M-5 0 L5 0"
          stroke="rgba(245,242,230,0.9)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle cx="0" cy="0" r="1.2" fill="rgba(245,242,230,0.95)" />
      </g>
    </svg>
  );
}

// Back-compat alias — primitives/screens that imported `Moon`
// continue working without a source change.
export const Moon = CrescentMoon;

// --- TwinkleStar --------------------------------------------------------

// A small plus-shaped star with a center dot — the MCM motif
// repeats across the night sky. Size-scaled so the same component
// renders believable sky-stars from 8px up to ~20px.
export function TwinkleStar({ size = 14, color: c = "rgba(255,255,255,0.85)", style }) {
  const cx = 10;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      style={style}
      aria-hidden
    >
      <path
        d={`M${cx} 1 L${cx} 19 M1 ${cx} L19 ${cx}`}
        stroke={c}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cx} r="1.6" fill={c} />
    </svg>
  );
}

// --- Glass panel --------------------------------------------------------

// The fundamental liquid-glass surface. Tone varies chroma
// (neutral / warm / cool / input); variant toggles depth treatment
// (elevated vs sunken). Theme supplies the glass recipe and all
// tone-specific tints.
export function GlassPanel({
  children, style, tone = "neutral", variant = "elevated",
  padding = 20, interactive = false, onClick,
}) {
  const { theme, glassPanel } = useTheme();

  // Tone tints are theme-aware: "warm" tilts cream, "cool" tilts
  // toward eucalyptus/teal, "input" uses a deeper inset fill.
  // Night theme's tones still read as warm-dark panels.
  const toneTint = toneFillFor(theme, tone);

  const depthShadow = variant === "input"
    ? theme.shadow.inputInset
    : theme.shadow.glass;

  const base = {
    ...glassPanel,
    background: toneTint,
    boxShadow: depthShadow,
    padding,
    cursor: interactive ? "pointer" : "default",
    ...THEME_TRANSITION,
    ...style,
  };

  if (interactive) {
    return (
      <motion.div
        role="button"
        tabIndex={0}
        onClick={onClick}
        whileHover={{ y: -2, boxShadow: theme.shadow.lift }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        style={base}
      >
        {children}
      </motion.div>
    );
  }
  return <div style={base}>{children}</div>;
}

// --- Buttons ------------------------------------------------------------

export function PrimaryButton({ children, onClick, style, disabled }) {
  const { ctaButton } = useTheme();
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={!disabled && { scale: 1.02 }}
      whileTap={!disabled && { scale: 0.97 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{
        ...ctaButton,
        opacity: disabled ? 0.5 : 1,
        ...THEME_TRANSITION,
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

export function GhostButton({ children, onClick, style }) {
  const { ghostButton, theme } = useTheme();
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ background: theme.color.glassFill }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.18 }}
      style={{
        ...ghostButton,
        ...THEME_TRANSITION,
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

// --- Status dot ---------------------------------------------------------

export function StatusDot({ tone = "ok", size = 8, style }) {
  const { theme } = useTheme();
  const c = tone === "ok"      ? theme.color.teal
          : tone === "warn"    ? theme.color.burnt
          : tone === "pending" ? theme.color.mustard
          : theme.color.inkFaint;
  const boxShadow = tone === "warn"
    ? `0 0 0 4px ${withAlpha(c, 0.13)}, 0 0 10px ${withAlpha(c, 0.40)}`
    : `0 0 0 3px ${withAlpha(c, 0.13)}`;
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
        ...THEME_TRANSITION,
        ...style,
      }}
    />
  );
}

// --- Checkmark ----------------------------------------------------------

export function CheckCircle({ size = 20, checked = true }) {
  const { theme } = useTheme();
  const fillOn = theme.color.teal;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle
        cx="12" cy="12" r="10"
        fill={checked ? fillOn : "transparent"}
        stroke={checked ? fillOn : theme.color.inkFaint}
        strokeWidth={checked ? 0 : 1.5}
      />
      {checked && (
        <path
          d="M7.5 12.3 L10.6 15.2 L16.5 9.2"
          fill="none"
          stroke={theme.color.ctaText}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

// --- Section labels -----------------------------------------------------

export function Kicker({ children, tone }) {
  const { theme } = useTheme();
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: tone || theme.color.inkMuted,
        ...THEME_TRANSITION,
      }}
    >
      {children}
    </div>
  );
}

export function SerifHeader({ children, size = 36, style }) {
  const { theme } = useTheme();
  return (
    <h1
      style={{
        fontFamily: font.serif,
        fontStyle: "italic",
        fontWeight: 300,
        letterSpacing: "-0.02em",
        fontSize: size,
        lineHeight: 1.05,
        color: theme.color.ink,
        margin: 0,
        ...THEME_TRANSITION,
        ...style,
      }}
    >
      {children}
    </h1>
  );
}

// --- Glass pill ---------------------------------------------------------

export function GlassPill({
  children, active = false, onClick, size = "md", style,
  as: Tag = motion.button,
}) {
  const { theme } = useTheme();
  const pad = size === "sm" ? "6px 12px" : "10px 16px";
  const fontSize = size === "sm" ? 12 : 13;

  const inactiveBoxShadow =
    "0 1px 2px rgba(30,30,30,0.05)," +
    `inset 0 1px 0 ${theme.color.glassBorder}`;
  const activeBoxShadow =
    `0 10px 22px ${withAlpha(theme.color.teal, 0.38)},` +
    `0 2px 5px ${withAlpha(theme.color.teal, 0.22)},` +
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
        border: `1px solid ${active ? theme.color.teal : theme.color.glassBorder}`,
        background: active
          ? `linear-gradient(180deg, ${theme.color.teal} 0%, ${darken(theme.color.teal, 0.18)} 100%)`
          : theme.color.glassFillLite,
        color: active ? theme.color.ctaText : theme.color.ink,
        boxShadow: active ? activeBoxShadow : inactiveBoxShadow,
        cursor: "pointer",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        ...THEME_TRANSITION,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// --- Tinted pill --------------------------------------------------------

export function TintedPill({
  children, tone = "teal", size = "md", mono = false, onClick, style,
}) {
  const { theme } = useTheme();
  const { fg, bg } = tintedPillTone(theme, tone);
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
        ...THEME_TRANSITION,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// --- Back chip ----------------------------------------------------------

export function BackChip({ children, onClick, style }) {
  const { theme } = useTheme();
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      transition={{ duration: 0.18 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${theme.color.glassBorder}`,
        background: theme.color.glassFillLite,
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        padding: "8px 14px",
        borderRadius: radius.pill,
        fontFamily: font.sans,
        fontSize: 13,
        color: theme.color.ink,
        cursor: "pointer",
        boxShadow: theme.shadow.soft,
        ...THEME_TRANSITION,
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

// --- Bottom dock --------------------------------------------------------

export function BottomDock({ tabs, activeId, onSelect, style }) {
  const { theme } = useTheme();
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
          background: theme.color.glassFill,
          backdropFilter: "blur(28px) saturate(150%)",
          WebkitBackdropFilter: "blur(28px) saturate(150%)",
          border: `1px solid ${theme.color.glassBorder}`,
          borderRadius: radius.pill,
          boxShadow: theme.shadow.glass,
          ...THEME_TRANSITION,
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
                  ? `linear-gradient(180deg, ${theme.color.teal} 0%, ${darken(theme.color.teal, 0.18)} 100%)`
                  : "transparent",
                color: active ? theme.color.ctaText : theme.color.ink,
                cursor: "pointer",
                boxShadow: active
                  ? `0 6px 14px ${withAlpha(theme.color.teal, 0.32)}`
                  : "none",
                ...THEME_TRANSITION,
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

// --- Status tint overlay ------------------------------------------------

// Subtle temperature wash applied to item-state cards (good / warn)
// so pantry tiles feel like different states of the same material.
// Colors derive from theme so the wash follows time-of-day.
export function statusTintOverlay(theme, status) {
  if (status === "warn") {
    return {
      background:
        `linear-gradient(160deg, ${withAlpha(theme.color.burnt, 0.10)} 0%,` +
        ` ${theme.color.glassFillLite} 55%)`,
    };
  }
  if (status === "ok") {
    return {
      background:
        `linear-gradient(160deg, ${withAlpha(theme.color.teal, 0.06)} 0%,` +
        ` ${theme.color.glassFillLite} 55%)`,
    };
  }
  return null;
}

// --- Soft divider -------------------------------------------------------

export function HairlineRule({ style }) {
  const { theme } = useTheme();
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        background: `linear-gradient(90deg, transparent 0%, ${theme.color.hairline} 50%, transparent 100%)`,
        ...THEME_TRANSITION,
        ...style,
      }}
    />
  );
}

// --- Fade-in ------------------------------------------------------------

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

// --- Internal helpers ---------------------------------------------------

function toneFillFor(theme, tone) {
  const base = theme.color.glassFill;
  if (tone === "neutral") return base;
  if (tone === "input")   return withAlpha(theme.color.paper, 0.85);
  // "warm" / "cool" nudge the glass tint; on night we keep them
  // as-is since the dark glass already has a warm cast.
  if (tone === "warm") {
    return theme.id === "night"
      ? theme.color.glassFillHeavy
      : withAlpha(theme.color.mustard, 0.18);
  }
  if (tone === "cool") {
    return theme.id === "night"
      ? theme.color.glassFill
      : withAlpha(theme.color.aqua, 0.22);
  }
  return base;
}

function tintedPillTone(theme, tone) {
  const c = theme.color;
  const tones = {
    teal:    { fg: c.teal,      bg: c.tealTint    },
    aqua:    { fg: c.aqua,      bg: c.aquaTint    },
    burnt:   { fg: c.burnt,     bg: c.burntTint   },
    mustard: { fg: c.warmBrown, bg: c.mustardTint },
    brown:   { fg: c.warmBrown, bg: c.brownTint   },
    muted:   { fg: c.inkMuted,  bg: withAlpha(c.ink, 0.06) },
  };
  return tones[tone] || tones.teal;
}

// Hex #RRGGBB → rgba with alpha. Accepts rgba()/rgb() strings
// too and rewrites their alpha channel. Keeps primitives free
// of color-math sprinkled inline.
export function withAlpha(colorStr, alpha) {
  if (!colorStr) return colorStr;
  if (colorStr.startsWith("#")) {
    const h = colorStr.slice(1);
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const m = colorStr.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((s) => s.trim());
    return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
  }
  return colorStr;
}

// Darken a hex color by `amount` (0..1) — used for the bottom
// stop of the teal pill/dock gradient so the recipe scales with
// whatever teal the active theme ships.
function darken(hex, amount) {
  if (!hex || !hex.startsWith("#")) return hex;
  const h = hex.slice(1);
  let r = parseInt(h.slice(0, 2), 16);
  let g = parseInt(h.slice(2, 4), 16);
  let b = parseInt(h.slice(4, 6), 16);
  r = Math.max(0, Math.round(r * (1 - amount)));
  g = Math.max(0, Math.round(g * (1 - amount)));
  b = Math.max(0, Math.round(b * (1 - amount)));
  return `rgb(${r},${g},${b})`;
}
