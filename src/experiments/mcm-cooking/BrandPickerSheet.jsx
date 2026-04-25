// BrandPickerSheet — chip → modal-sheet picker for the brand axis
// of an item's identity, per the CLAUDE.md item-reference visual
// pattern. Brand is free-form (Kerrygold, Trader Joe's, etc.), so
// this sheet pairs a text input with a suggestion list seeded from
// the brands already living in the user's pantry — typing a few
// letters surfaces the matching brand without re-typing it,
// brand-new strings still go through fine when the user just hits
// "Use this name."
//
// Caller wires the chip → open path; this component fires
// `onPick(brand)` and `onClose()`. Caller is responsible for
// persisting via onUpdate (and for firing rememberBarcodeCorrection
// when a UPC is on the row, per CLAUDE.md's WRITE cascade).

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTheme, THEME_TRANSITION } from "./theme";
import { font } from "./tokens";

export function BrandPickerSheet({
  initialValue = "",
  suggestions = [],
  onPick,
  onClose,
}) {
  const { theme } = useTheme();
  const [query, setQuery] = useState(initialValue);
  const inputRef = useRef(null);

  // Auto-focus the input on mount so the user can start typing
  // immediately. Mobile keyboards open without a second tap.
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Esc closes — same keyboard pattern as the rest of the MCM
  // sheets. Enter commits whatever's in the input as the brand.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose && onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    const arr = q
      ? suggestions.filter(s => s.toLowerCase().includes(q))
      : suggestions.slice();
    return arr.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [suggestions, trimmed]);

  // True when the typed value would create a brand-new brand
  // (case-insensitive miss against suggestions). Drives the
  // "Use this name" CTA at the top of the list.
  const isNovel = trimmed && !suggestions.some(
    s => s.toLowerCase() === trimmed.toLowerCase()
  );

  const commit = (value) => {
    const v = (value ?? trimmed).trim();
    if (!v) return;
    onPick && onPick(v);
  };

  const accent = theme.color.ink;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add brand"
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
          color: theme.color.inkMuted,
          fontWeight: 600,
        }}>
          BRAND
        </div>
        <div style={{
          fontFamily: font.serif, fontStyle: "italic", fontWeight: 300,
          fontSize: 22, color: theme.color.ink,
          marginTop: 4, marginBottom: 14, letterSpacing: "-0.01em",
        }}>
          What brand?
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="Type a brand name…"
          style={{
            width: "100%",
            border: `1px solid ${theme.color.hairline}`,
            background: theme.color.glassFillHeavy,
            color: theme.color.ink,
            borderRadius: 10,
            padding: "10px 12px",
            fontFamily: font.sans, fontSize: 15,
            outline: "none",
            boxShadow: theme.shadow.inputInset,
            marginBottom: 10,
          }}
        />
        <div style={{ overflowY: "auto", margin: "0 -4px" }}>
          {/* "Use this name" row — only when the typed value
              isn't already in suggestions. Sits at the top so a
              user typing a brand-new brand can commit without
              scrolling past stale suggestions. */}
          {isNovel && (
            <button
              type="button"
              className="mcm-focusable"
              onClick={() => commit()}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%",
                padding: "10px 12px",
                margin: "2px 0",
                borderRadius: 12,
                border: `1px dashed ${theme.color.hairline}`,
                background: "transparent",
                cursor: "pointer", textAlign: "left",
                color: theme.color.ink,
              }}
            >
              <span style={{
                fontSize: 16, lineHeight: 1, color: theme.color.teal,
                fontWeight: 300,
              }}>+</span>
              <span style={{
                fontFamily: font.sans, fontSize: 14, fontWeight: 500,
              }}>
                Use “{trimmed}” as a new brand
              </span>
            </button>
          )}
          {filtered.map(name => (
            <button
              key={name}
              type="button"
              className="mcm-focusable"
              onClick={() => commit(name)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                width: "100%",
                padding: "10px 12px",
                margin: "2px 0",
                borderRadius: 12,
                border: "1px solid transparent",
                background: "transparent",
                cursor: "pointer", textAlign: "left",
                color: theme.color.ink,
                transition: "background 160ms ease",
              }}
            >
              <span style={{
                fontFamily: font.sans, fontSize: 15, fontWeight: 500,
                color: theme.color.ink,
              }}>
                {name}
              </span>
            </button>
          ))}
          {!isNovel && filtered.length === 0 && (
            <div style={{
              padding: "16px 12px",
              fontFamily: font.sans, fontSize: 13,
              color: theme.color.inkMuted, textAlign: "center",
            }}>
              {suggestions.length === 0
                ? "No brands yet — type one to start."
                : `Nothing matches "${trimmed}".`}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
