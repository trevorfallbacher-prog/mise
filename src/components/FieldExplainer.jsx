// Per-field validation reminder row. Emoji + uppercase mono label +
// one-line explanation. Rendered inside AddItemOutcome's FieldExplainer
// column for warning / exit / confirm overlays.
//
// Props:
//   emoji   — the kicker icon on the left
//   label   — uppercase mono kicker string (e.g. "CATEGORY")
//   body    — sans-serif explainer paragraph

export default function FieldExplainer({ emoji, label, body }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "8px 10px",
      background: "#0f0606", border: "1px solid #2a1010",
      borderRadius: 8,
    }}>
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 9,
          color: "#d98a8a", letterSpacing: "0.12em",
          marginBottom: 3,
        }}>
          {label}
        </div>
        <div style={{
          fontFamily: "'DM Sans',sans-serif", fontSize: 11.5,
          color: "#c4a8a8", lineHeight: 1.4,
        }}>
          {body}
        </div>
      </div>
    </div>
  );
}
