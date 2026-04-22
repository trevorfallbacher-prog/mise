// Quick-add sheet for the shopping list. The old path opened the full
// AddItemModal (brand / category / location / state / ingredients /
// package size / expiry — all the pantry-stocking fields), which is
// way too much friction for "corn, apples, beer." Shop Mode's pitch
// depends on the list being brainless to populate.
//
// This component gives back just: text field + optional qty + ADD.
// Everything else (canonical id, category defaults, units) gets
// inferred at pair-time during Shop Mode, or stays null until the
// row graduates into the pantry after checkout.

import { useEffect, useRef, useState } from "react";

export default function ShoppingQuickAdd({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [qty, setQty]   = useState(1);
  const inputRef = useRef(null);

  useEffect(() => {
    // Autofocus so the user can just start typing.
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  function submit() {
    const cleaned = name.trim();
    if (!cleaned) return;
    // Generate a client-side id. useSyncedList requires it (persist
    // diff builds a Map keyed by id; id-less rows collapse into one
    // slot and every subsequent tap compares equal downstream —
    // that's what made Shop Mode's ARM highlight light up every row
    // at once).
    const id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    onAdd?.({
      id,
      name: cleaned,
      emoji: "🛒",
      amount: qty,
      unit: "",
      category: "pantry",
      source: "manual",
      ingredientId: null,
      priceCents: null,
    });
    onClose?.();
  }

  function handleKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 160,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 520,
        background: "#0d0d0d",
        borderTop: "1px solid #222",
        borderRadius: "16px 16px 0 0",
        padding: "18px 20px 28px",
        boxShadow: "0 -8px 30px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
            + TO SHOPPING LIST
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30, height: 30,
              background: "#141414", border: "1px solid #2a2a2a",
              color: "#aaa", borderRadius: 15,
              fontFamily: "'DM Mono',monospace", fontSize: 14,
              cursor: "pointer",
            }}
          >✕</button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKey}
          placeholder="corn, apples, beer…"
          style={{
            width: "100%",
            padding: "14px 16px",
            background: "#141414",
            border: "1px solid #2a2a2a",
            borderRadius: 12,
            color: "#f0ece4",
            fontFamily: "'Fraunces',serif",
            fontStyle: "italic",
            fontSize: 20,
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          margin: "14px 2px 0",
        }}>
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 10,
            color: "#666", letterSpacing: "0.1em",
          }}>HOW MANY?</div>
          <button
            onClick={() => setQty(q => Math.max(1, q - 1))}
            style={qtyBtn}
            aria-label="Decrease"
          >−</button>
          <div style={{
            minWidth: 30, textAlign: "center",
            fontFamily: "'DM Mono',monospace", fontSize: 18,
            color: "#f0ece4",
          }}>×{qty}</div>
          <button
            onClick={() => setQty(q => q + 1)}
            style={qtyBtn}
            aria-label="Increase"
          >+</button>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "14px",
              background: "transparent",
              border: "1px solid #2a2a2a",
              color: "#aaa",
              borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12,
              letterSpacing: "0.1em",
              cursor: "pointer",
            }}
          >CANCEL</button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            style={{
              flex: 2,
              padding: "14px",
              background: name.trim() ? "#f5c842" : "#2a2a2a",
              border: "none",
              color: name.trim() ? "#111" : "#666",
              borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.1em",
              cursor: name.trim() ? "pointer" : "not-allowed",
            }}
          >ADD →</button>
        </div>

        <div style={{
          marginTop: 10,
          fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: "#555", letterSpacing: "0.08em",
          textAlign: "center",
        }}>
          NO NEED TO FILL OUT ANYTHING ELSE — SHOP MODE HANDLES THE REST AT THE STORE
        </div>
      </div>
    </div>
  );
}

const qtyBtn = {
  width: 34, height: 34,
  background: "#141414",
  border: "1px solid #2a2a2a",
  color: "#f0ece4",
  borderRadius: 8,
  fontFamily: "'DM Mono',monospace", fontSize: 18,
  cursor: "pointer",
};
