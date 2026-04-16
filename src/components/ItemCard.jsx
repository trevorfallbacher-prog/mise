import { useEffect, useMemo, useState } from "react";
import { findIngredient, stateLabel, unitLabel } from "../data/ingredients";
import IngredientCard from "./IngredientCard";

// ItemCard — card for a SPECIFIC pantry item.
//
// An item is a physical thing on your shelf (a Tillamook pepper jack block,
// a DiGiorno frozen pizza, a jar of Ritz crackers). It has brand, state,
// quantity, expiration, provenance, and zero-to-many ingredient tags.
// This card shows all of that at the top, then embeds IngredientCard below
// for the canonical deep-dive on whatever ingredient(s) the item is tagged
// with.
//
// Props:
//   item        — the pantry row being viewed
//   pantry      — full pantry array (for IngredientCard's "also in stock" lookups)
//   onClose()   — dismiss the card
//
// When the item has no ingredientId (pure free-text row), the card still
// renders — just without the canonical deep-dive below.

// ── formatting helpers ────────────────────────────────────────────────
function formatDateShort(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Math.ceil((date.getTime() - Date.now()) / (86400000));
  return diff;
}

function provenanceLine(item) {
  // Chunk 2b will flesh this out with source_kind + source_*_id. For now,
  // infer the best we can from the existing purchasedAt and sourceCookLogId
  // (from migration 0026 — cook-complete leftovers already set this).
  const added = formatDateShort(item.purchasedAt);
  if (item.sourceCookLogId && item.sourceRecipeSlug) {
    return { icon: "🍝", text: `COOKED FROM ${item.sourceRecipeSlug.toUpperCase()}${added ? ` · ${added}` : ""}` };
  }
  if (added) {
    return { icon: "🛒", text: `ADDED · ${added}` };
  }
  return null;
}

// ── location chip ────────────────────────────────────────────────────
const LOCATIONS = [
  { id: "fridge",  emoji: "🧊", label: "Fridge"  },
  { id: "pantry",  emoji: "🥫", label: "Pantry"  },
  { id: "freezer", emoji: "❄️", label: "Freezer" },
];

export default function ItemCard({ item, pantry = [], onClose }) {
  // Close on Escape for keyboard users — mirrors other modals in the app.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canonical = useMemo(
    () => item?.ingredientId ? findIngredient(item.ingredientId) : null,
    [item?.ingredientId]
  );

  if (!item) return null;

  const prov = provenanceLine(item);
  const exp = daysUntil(item.expiresAt);
  const expLabel = item.expiresAt
    ? (exp == null ? null : exp < 0 ? `${Math.abs(exp)}d past` : exp === 0 ? "today" : `${exp}d left`)
    : null;
  const expColor = exp == null ? "#888"
    : exp <= 1 ? "#ef4444"
    : exp <= 3 ? "#f59e0b"
    : "#4ade80";

  const stateText = item.state ? stateLabel(item.state) : null;
  const currentLocation = item.location || "pantry";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 320,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "18px 22px 36px",
        maxHeight: "92vh", overflowY: "auto",
        position: "relative",
      }}>
        {/* Close button, top-right. Dismiss gesture + drag handle come in
            chunk 1d. */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: 12, right: 14,
            width: 32, height: 32,
            background: "#0a0a0a", border: "1px solid #2a2a2a",
            color: "#aaa", borderRadius: 16,
            fontFamily: "'DM Mono',monospace", fontSize: 14,
            cursor: "pointer", zIndex: 1,
          }}
        >
          ✕
        </button>

        {/* ─── ITEM SECTION (this specific row) ─── */}
        <div style={{ paddingTop: 12 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.12em", marginBottom: 4 }}>
            ITEM
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 40, flexShrink: 0 }}>{item.emoji || "🥫"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{
                fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                color: "#f0ece4", fontWeight: 400, margin: 0, lineHeight: 1.2,
                overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {item.name}
              </h2>
              {canonical && item.name?.toLowerCase() !== canonical.name?.toLowerCase() && (
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.08em", marginTop: 3 }}>
                  IDENTIFIED AS: <span style={{ color: "#f5c842" }}>{canonical.name.toUpperCase()}</span>
                </div>
              )}
              {stateText && (
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.08em", marginTop: 3, textTransform: "uppercase" }}>
                  STATE: {stateText}
                </div>
              )}
            </div>
          </div>

          {/* Quantity / Location / Expiration readout row. Read-only in 1a;
              chunk 1b swaps these for inline edit controls. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
            <div style={{ padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>QUANTITY</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: "#f0ece4", marginTop: 2 }}>
                {Number(item.amount || 0).toFixed(Number.isInteger(item.amount) ? 0 : 2)} {canonical ? unitLabel(canonical, item.unit) : (item.unit || "")}
              </div>
            </div>
            <div style={{ padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>LOCATION</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#f0ece4", marginTop: 2 }}>
                {LOCATIONS.find(l => l.id === currentLocation)?.emoji || "🥫"} {(LOCATIONS.find(l => l.id === currentLocation)?.label || "Pantry").toUpperCase()}
              </div>
            </div>
            <div style={{ padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>EXPIRES</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: expColor, marginTop: 2 }}>
                {expLabel ? expLabel.toUpperCase() : "—"}
              </div>
            </div>
          </div>

          {/* Provenance line. Deep-link to receipt/scan/cook-log in chunk 2b. */}
          {prov && (
            <div style={{
              padding: "10px 12px", marginBottom: 14,
              background: "#0a0a0a", border: "1px dashed #242424", borderRadius: 10,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 16 }}>{prov.icon}</span>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#888", letterSpacing: "0.08em" }}>
                {prov.text}
              </span>
            </div>
          )}
        </div>

        {/* ─── THE DEEP DIVE (canonical ingredient info) ─── */}
        {canonical ? (
          <>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              margin: "8px 0 4px", color: "#444",
            }}>
              <div style={{ flex: 1, height: 1, background: "#242424" }} />
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.15em" }}>
                THE DEEP DIVE
              </div>
              <div style={{ flex: 1, height: 1, background: "#242424" }} />
            </div>
            <IngredientCard
              ingredientId={item.ingredientId}
              fallbackName={item.name}
              fallbackEmoji={item.emoji}
              pantry={pantry}
              onClose={onClose}
              embedded
            />
          </>
        ) : (
          <div style={{
            padding: "18px", textAlign: "center",
            background: "#0a0a0a", border: "1px dashed #242424", borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", fontStyle: "italic",
          }}>
            Free-text row — no canonical ingredient tagged. Link it to unlock the deep-dive content.
          </div>
        )}
      </div>
    </div>
  );
}
