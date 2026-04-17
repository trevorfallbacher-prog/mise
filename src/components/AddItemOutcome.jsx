// Shared full-screen outcome overlay. Used by:
//   * AddItemModal → save validation warning, save success, exit warning
//   * ItemCard     → move confirmation, move success
//
// One shell, multiple tones via `kind`:
//   "warning"       — red, required action (no backdrop dismiss)
//   "success"       — green, completed action
//   "exit_warning"  — yellow, dirty-incomplete close attempt
//   "confirm"       — blue, stage-before-commit (e.g. location move)
//
// Props:
//   kind           — tone key above
//   title          — big Fraunces headline
//   body           — DM Sans paragraph below title
//   fields         — optional [{emoji, label, body}] rendered as
//                    FieldExplainer rows (see components/FieldExplainer)
//   destination    — optional "Fridge → Dairy & Eggs" string for the
//                    📍 chip under the body
//   primary        — { label, onClick, tone: "confirm"|"danger"|"neutral" }
//   secondary      — optional { label, onClick }
//   onBackdropTap  — optional dismiss behavior; warnings skip this
//                    so tapping the backdrop doesn't bypass the gate

import FieldExplainer from "./FieldExplainer";

export default function AddItemOutcome({
  kind,
  title,
  body,
  fields = null,
  destination = null,
  primary,
  secondary = null,
  onBackdropTap = null,
}) {
  const palette = kind === "success"
    ? { accent: "#7ec87e", accentBg: "#0f1a0f", accentBorder: "#1e3a1e", icon: "✓", kicker: "ADDED" }
    : kind === "exit_warning"
      ? { accent: "#f5c842", accentBg: "#1a1608", accentBorder: "#3a2f10", icon: "⚠", kicker: "HOLD ON" }
      : kind === "confirm"
        ? { accent: "#7eb8d4", accentBg: "#0f1620", accentBorder: "#1f3040", icon: "?", kicker: "CONFIRM" }
        : { accent: "#d98a8a", accentBg: "#1a0a0a", accentBorder: "#3a1a1a", icon: "!", kicker: "ALMOST THERE" };
  return (
    <div
      onClick={onBackdropTap || undefined}
      style={{
        position: "fixed", inset: 0, zIndex: 400,
        background: "rgba(0,0,0,0.92)",
        maxWidth: 480, margin: "0 auto",
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "32px 22px 28px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{
          width: 72, height: 72, borderRadius: 36,
          background: palette.accentBg, border: `2px solid ${palette.accent}`,
          color: palette.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 40, lineHeight: 1, margin: "0 auto 6px",
          fontFamily: "'DM Mono',monospace", fontWeight: 600,
        }}>
          {palette.icon}
        </div>
        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: palette.accent, letterSpacing: "0.16em",
          textAlign: "center",
        }}>
          {palette.kicker}
        </div>
        <h2 style={{
          fontFamily: "'Fraunces',serif", fontSize: 26,
          fontStyle: "italic", fontWeight: 400, color: "#f0ece4",
          textAlign: "center", lineHeight: 1.2,
          margin: "0 0 4px",
        }}>
          {title}
        </h2>
        {body && (
          <p style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 14,
            color: "#aaa", lineHeight: 1.55,
            textAlign: "center", margin: "0 auto",
            maxWidth: 360,
          }}>
            {body}
          </p>
        )}
        {destination && (
          <div style={{
            margin: "6px auto 0", padding: "10px 16px",
            background: palette.accentBg, border: `1px solid ${palette.accentBorder}`,
            borderRadius: 12, display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 18 }}>📍</span>
            <span style={{
              fontFamily: "'DM Mono',monospace", fontSize: 11,
              color: palette.accent, letterSpacing: "0.1em",
            }}>
              {destination}
            </span>
          </div>
        )}
        {fields && fields.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {fields.map((f, i) => (
              <FieldExplainer key={i} emoji={f.emoji} label={f.label} body={f.body} />
            ))}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          <button
            onClick={primary.onClick}
            style={{
              padding: "14px 16px",
              background: primary.tone === "danger"
                ? "#5a1818"
                : primary.tone === "neutral"
                  ? "#1a1a1a"
                  : palette.accent,
              border: primary.tone === "neutral" ? "1px solid #2a2a2a" : "none",
              color: primary.tone === "danger" || primary.tone === "confirm"
                ? "#fff"
                : (primary.tone === "neutral" ? "#aaa" : "#111"),
              borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
              letterSpacing: "0.1em", cursor: "pointer",
            }}
          >
            {primary.label}
          </button>
          {secondary && (
            <button
              onClick={secondary.onClick}
              style={{
                padding: "12px 16px",
                background: "transparent",
                border: "1px solid #2a2a2a",
                color: "#888",
                borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 11,
                letterSpacing: "0.1em", cursor: "pointer",
              }}
            >
              {secondary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
