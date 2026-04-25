// MCMPickerSheet — chip → modal-sheet picker per the CLAUDE.md
// item-reference visual pattern. Bottom-anchored sheet, kicker
// + title, searchable list, tap-to-select with active-row tint
// in the axis accent color. Used by the AddDraftSheet's category
// chip; reused by upcoming Stored In + State pickers.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { withAlpha } from "./primitives";
import { useTheme, THEME_TRANSITION } from "./theme";
import { font } from "./tokens";

export function MCMPickerSheet({ kicker, title, options = [], value, onPick, onClose, accent }) {
  const { theme } = useTheme();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => {
      if ((o.label || "").toLowerCase().includes(q)) return true;
      if ((o.sub   || "").toLowerCase().includes(q)) return true;
      // Optional `keywords` array — callers attach extra search
      // tokens (canonical aliases, common alternate names) so
      // typing "cheddar" finds the broader cheese canonical even
      // when the canonical's label is just "Cheese".
      if (Array.isArray(o.keywords) && o.keywords.some(k => (k || "").toLowerCase().includes(q))) return true;
      return false;
    });
  }, [options, query]);

  // Esc closes — same keyboard pattern as the AddDraftSheet
  // itself.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(20,12,4,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
    >
      <motion.div
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "78vh",
          margin: "0 12px 24px",
          padding: "20px 18px 14px",
          borderRadius: 20,
          background: theme.color.glassFillHeavy,
          border: `1px solid ${theme.color.glassBorder}`,
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          boxShadow: "0 24px 60px rgba(20,12,4,0.40), 0 4px 16px rgba(20,12,4,0.20)",
          display: "flex", flexDirection: "column",
          ...THEME_TRANSITION,
        }}
      >
        <div style={{
          fontFamily: font.mono, fontSize: 11,
          letterSpacing: "0.16em", textTransform: "uppercase",
          color: accent || theme.color.inkMuted,
          fontWeight: 600,
        }}>
          {kicker}
        </div>
        <div style={{
          fontFamily: font.serif, fontStyle: "italic", fontWeight: 300,
          fontSize: 22, color: theme.color.ink,
          marginTop: 4, marginBottom: 14, letterSpacing: "-0.01em",
        }}>
          {title}
        </div>
        {options.length > 8 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            style={{
              width: "100%",
              border: `1px solid ${theme.color.hairline}`,
              background: theme.color.glassFillHeavy,
              color: theme.color.ink,
              borderRadius: 10,
              padding: "10px 12px",
              fontFamily: font.sans, fontSize: 14,
              outline: "none",
              boxShadow: theme.shadow.inputInset,
              marginBottom: 10,
            }}
          />
        )}
        <div style={{ overflowY: "auto", margin: "0 -4px" }}>
          {filtered.map(o => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                className="mcm-focusable"
                onClick={() => onPick && onPick(o.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  width: "100%",
                  padding: "10px 12px",
                  margin: "2px 0",
                  borderRadius: 12,
                  border: active
                    ? `1px solid ${withAlpha(accent || theme.color.ink, 0.45)}`
                    : "1px solid transparent",
                  background: active
                    ? `linear-gradient(${withAlpha(accent || theme.color.ink, 0.16)}, ${withAlpha(accent || theme.color.ink, 0.16)}), transparent`
                    : "transparent",
                  cursor: "pointer", textAlign: "left",
                  color: theme.color.ink,
                  transition: "background 160ms ease, border-color 160ms ease",
                }}
              >
                {o.emoji && (
                  <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{o.emoji}</span>
                )}
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontFamily: font.sans, fontSize: 15, fontWeight: 500,
                    color: theme.color.ink,
                  }}>
                    {o.label}
                  </span>
                  {o.sub && (
                    <span style={{
                      fontFamily: font.detail, fontStyle: "italic", fontWeight: 400,
                      fontSize: 13, color: theme.color.inkMuted, marginTop: 1,
                    }}>
                      {o.sub}
                    </span>
                  )}
                </span>
                {active && (
                  <span style={{ color: accent || theme.color.ink, fontSize: 16 }}>✓</span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{
              padding: "16px 12px",
              fontFamily: font.sans, fontSize: 13,
              color: theme.color.inkMuted, textAlign: "center",
            }}>
              Nothing matches "{query}".
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
