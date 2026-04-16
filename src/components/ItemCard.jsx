import { useEffect, useMemo, useState } from "react";
import { findIngredient, inferUnitsForScanned, stateLabel, statesForIngredient, unitLabel } from "../data/ingredients";
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
//   item           — the pantry row being viewed
//   pantry         — full pantry array (for IngredientCard's "also in stock" lookups)
//   onUpdate(patch)— called when the user edits a field; parent merges the
//                    patch into the row (same pattern as updatePantryItem).
//                    Optional — if absent, the card renders read-only.
//   onClose()      — dismiss the card
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

export default function ItemCard({ item, pantry = [], onUpdate, onClose }) {
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

  // Which field is currently being edited inline. null = read-only view.
  // One field open at a time matches the existing pantry-row edit UX.
  const [editingField, setEditingField] = useState(null);

  if (!item) return null;

  const readOnly = !onUpdate;
  const startEdit = (field) => { if (!readOnly) setEditingField(field); };
  const commit = (patch) => { onUpdate?.(patch); setEditingField(null); };

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
              {editingField === "name" ? (
                <input
                  type="text"
                  autoFocus
                  defaultValue={item.name}
                  onBlur={e => commit({ name: e.target.value.trim() || item.name })}
                  onKeyDown={e => {
                    if (e.key === "Enter") e.target.blur();
                    if (e.key === "Escape") setEditingField(null);
                  }}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                    color: "#f5c842", fontWeight: 400, lineHeight: 1.2,
                    background: "#0a0a0a", border: "1px solid #f5c842",
                    borderRadius: 8, padding: "4px 10px", outline: "none",
                  }}
                />
              ) : (
                <h2
                  onClick={() => startEdit("name")}
                  style={{
                    fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                    color: "#f0ece4", fontWeight: 400, margin: 0, lineHeight: 1.2,
                    overflow: "hidden", textOverflow: "ellipsis",
                    cursor: readOnly ? "default" : "text",
                  }}
                >
                  {item.name}
                </h2>
              )}
              {canonical && item.name?.toLowerCase() !== canonical.name?.toLowerCase() && (
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.08em", marginTop: 3 }}>
                  IDENTIFIED AS: <span style={{ color: "#f5c842" }}>{canonical.name.toUpperCase()}</span>
                </div>
              )}
              {/* STATE line — tappable when the canonical ingredient has a
                  state vocabulary (bread: loaf/slices/crumbs; cheese: block
                  /grated/shredded; chicken: raw/cooked/shredded_cooked).
                  Ingredients without states stay hidden. */}
              {(() => {
                const states = statesForIngredient(canonical);
                if (!states || states.length === 0) return null;
                const label = stateText || "SET STATE";
                return (
                  <div
                    onClick={e => { e.stopPropagation(); startEdit("state"); }}
                    style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      color: stateText ? "#7eb8d4" : "#555",
                      letterSpacing: "0.08em", marginTop: 3,
                      textTransform: "uppercase",
                      cursor: readOnly ? "default" : "pointer",
                    }}
                  >
                    STATE: <span style={{
                      color: stateText ? "#7eb8d4" : "#888",
                      borderBottom: readOnly ? "none" : "1px dashed #7eb8d444",
                    }}>{label}</span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* State picker — expands inline when the STATE chip is tapped.
              Grid of options pulled from statesForIngredient(). Tap to
              commit; tap the current state again to clear. */}
          {editingField === "state" && (() => {
            const states = statesForIngredient(canonical) || [];
            return (
              <div style={{
                padding: "10px 12px", marginBottom: 12,
                background: "#0a0a0a", border: "1px solid #1f3040",
                borderRadius: 10,
              }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7eb8d4", letterSpacing: "0.1em", marginBottom: 8 }}>
                  PICK A STATE
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {states.map(s => {
                    const active = item.state === s;
                    return (
                      <button
                        key={s}
                        onClick={() => commit({ state: active ? null : s })}
                        style={{
                          padding: "8px 6px",
                          background: active ? "#0f1620" : "#141414",
                          color: active ? "#7eb8d4" : "#ccc",
                          border: `1px solid ${active ? "#7eb8d4" : "#2a2a2a"}`,
                          borderRadius: 8,
                          fontFamily: "'DM Mono',monospace", fontSize: 10,
                          letterSpacing: "0.05em", cursor: "pointer",
                          textTransform: "uppercase",
                        }}
                      >
                        {stateLabel(s)}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => setEditingField(null)}
                    style={{
                      flex: 1, padding: "8px",
                      background: "transparent", border: "1px solid #2a2a2a",
                      color: "#888", borderRadius: 6,
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      cursor: "pointer",
                    }}
                  >
                    CANCEL
                  </button>
                  {item.state && (
                    <button
                      onClick={() => commit({ state: null })}
                      style={{
                        flex: 1, padding: "8px",
                        background: "transparent", border: "1px solid #3a1a1a",
                        color: "#ef4444", borderRadius: 6,
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      CLEAR STATE
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Quantity / Location / Expiration. Tap any card to edit inline.
              One editor is open at a time — opening a second closes the
              first (same pattern as the pantry-row edit UX). Escape
              cancels; Enter (or blur) commits. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
            {/* QUANTITY */}
            <div
              onClick={() => startEdit("qty")}
              style={{
                padding: "10px 12px",
                background: editingField === "qty" ? "#1a1608" : "#0f0f0f",
                border: `1px solid ${editingField === "qty" ? "#f5c842" : "#1e1e1e"}`,
                borderRadius: 10,
                cursor: readOnly ? "default" : "pointer",
              }}
            >
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>QUANTITY</div>
              {editingField === "qty" ? (() => {
                const units = canonical ? canonical.units : inferUnitsForScanned(item).units;
                const hasCurrent = units.some(u => u.id === item.unit);
                const opts = hasCurrent ? units : [{ id: item.unit, label: item.unit || "—", toBase: 1 }, ...units];
                return (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="number" inputMode="decimal" min="0" step="any"
                      autoFocus
                      defaultValue={item.amount}
                      onBlur={e => {
                        const v = parseFloat(e.target.value);
                        commit({ amount: Number.isFinite(v) && v >= 0 ? v : item.amount });
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter") e.target.blur();
                        if (e.key === "Escape") setEditingField(null);
                      }}
                      style={{
                        width: 60, padding: "3px 6px",
                        background: "#0a0a0a", border: "1px solid #f5c842",
                        color: "#f5c842", borderRadius: 6,
                        fontFamily: "'DM Mono',monospace", fontSize: 13, outline: "none",
                      }}
                    />
                    <select
                      defaultValue={item.unit}
                      onChange={e => onUpdate?.({ unit: e.target.value })}
                      style={{
                        padding: "3px 2px",
                        background: "#0a0a0a", border: "1px solid #f5c842",
                        color: "#f5c842", borderRadius: 6,
                        fontFamily: "'DM Mono',monospace", fontSize: 10, outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      {opts.map(u => (
                        <option key={u.id} value={u.id} style={{ background: "#141414" }}>{u.label}</option>
                      ))}
                    </select>
                  </div>
                );
              })() : (
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: "#f0ece4", marginTop: 2 }}>
                  {Number(item.amount || 0).toFixed(Number.isInteger(item.amount) ? 0 : 2)} {canonical ? unitLabel(canonical, item.unit) : (item.unit || "")}
                </div>
              )}
            </div>

            {/* LOCATION */}
            <div
              onClick={() => startEdit("location")}
              style={{
                padding: "10px 12px",
                background: editingField === "location" ? "#1a1608" : "#0f0f0f",
                border: `1px solid ${editingField === "location" ? "#f5c842" : "#1e1e1e"}`,
                borderRadius: 10,
                cursor: readOnly ? "default" : "pointer",
              }}
            >
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>LOCATION</div>
              {editingField === "location" ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}
                  onClick={e => e.stopPropagation()}
                >
                  {LOCATIONS.map(l => (
                    <button
                      key={l.id}
                      onClick={() => commit({ location: l.id })}
                      style={{
                        padding: "3px 6px", textAlign: "left",
                        background: currentLocation === l.id ? "#1a1608" : "transparent",
                        color: currentLocation === l.id ? "#f5c842" : "#aaa",
                        border: "1px solid transparent",
                        borderRadius: 4,
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      {l.emoji} {l.label.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#f0ece4", marginTop: 2 }}>
                  {LOCATIONS.find(l => l.id === currentLocation)?.emoji || "🥫"} {(LOCATIONS.find(l => l.id === currentLocation)?.label || "Pantry").toUpperCase()}
                </div>
              )}
            </div>

            {/* EXPIRATION */}
            <div
              onClick={() => startEdit("exp")}
              style={{
                padding: "10px 12px",
                background: editingField === "exp" ? "#1a1608" : "#0f0f0f",
                border: `1px solid ${editingField === "exp" ? "#f5c842" : "#1e1e1e"}`,
                borderRadius: 10,
                cursor: readOnly ? "default" : "pointer",
              }}
            >
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>EXPIRES</div>
              {editingField === "exp" ? (
                <div onClick={e => e.stopPropagation()} style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="date"
                    autoFocus
                    defaultValue={item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 10) : ""}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) return;
                      // Pin to noon UTC to dodge DST edge cases.
                      onUpdate?.({ expiresAt: new Date(`${v}T12:00:00Z`) });
                    }}
                    onBlur={() => setEditingField(null)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingField(null); }}
                    style={{
                      background: "#0a0a0a", border: "1px solid #f5c842",
                      color: "#f5c842", borderRadius: 6, padding: "2px 4px",
                      fontFamily: "'DM Mono',monospace", fontSize: 11, outline: "none",
                    }}
                  />
                  {item.expiresAt && (
                    <button
                      onClick={() => commit({ expiresAt: null, purchasedAt: null })}
                      aria-label="Clear expiration"
                      style={{
                        background: "transparent", border: "none",
                        color: "#666", cursor: "pointer",
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: expColor, marginTop: 2 }}>
                  {expLabel ? expLabel.toUpperCase() : "— TAP TO SET"}
                </div>
              )}
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

        {/* ─── INGREDIENT (canonical deep-dive) ───
            Singular "INGREDIENT" for today's one-tag-per-item world.
            Pluralizes to "INGREDIENTS" with a tab switcher when Chunk 5
            ships the multi-canonical (ingredient_ids[]) model — a pizza
            tagged with bbq_sauce + pineapple + mozzarella + dough shows
            one tab per ingredient, each with its own deep dive. */}
        {canonical ? (
          <>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              margin: "8px 0 4px", color: "#444",
            }}>
              <div style={{ flex: 1, height: 1, background: "#242424" }} />
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7eb8d4", letterSpacing: "0.15em" }}>
                INGREDIENT
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
