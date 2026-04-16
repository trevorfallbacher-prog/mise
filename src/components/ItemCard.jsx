import { useEffect, useMemo, useRef, useState } from "react";
import { findIngredient, getIngredientInfo, inferUnitsForScanned, stateLabel, statesForIngredient, unitLabel } from "../data/ingredients";
import IngredientCard from "./IngredientCard";
import { useIngredientInfo } from "../lib/useIngredientInfo";

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
//   item                  — the pantry row being viewed
//   pantry                — full pantry array (for IngredientCard's "also in stock" lookups)
//   onUpdate(patch)       — called when the user edits a field; parent merges
//                           the patch into the row (same pattern as
//                           updatePantryItem). Optional — if absent, the
//                           card renders read-only.
//   onOpenProvenance(link)— optional; called when the user taps a tappable
//                           provenance line. `link` is { kind, id } where
//                           kind is 'receipt' | 'cook' | etc. Parent routes.
//   onClose()             — dismiss the card
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

// Build the provenance banner for an item. Returns { icon, text, linkTo }
// where linkTo is a "deep link descriptor" the card uses to route the tap.
// linkTo is null when there's nothing to open (e.g. manual adds).
function provenanceLine(item) {
  const added = formatDateShort(item.purchasedAt);

  // Cook-complete output (migration 0026 columns). Takes priority over
  // source_kind because the cook-log reference is the most specific.
  if (item.sourceCookLogId) {
    const slug = item.sourceRecipeSlug
      ? item.sourceRecipeSlug.replace(/_/g, " ").toUpperCase()
      : "A PAST COOK";
    return {
      icon: "🍝",
      text: `COOKED FROM ${slug}${added ? ` · ${added}` : ""}`,
      linkTo: { kind: "cook", id: item.sourceCookLogId },
    };
  }

  // Receipt scan (migration 0029). Deep-linkable.
  if (item.sourceKind === "receipt_scan" && item.sourceReceiptId) {
    return {
      icon: "🧾",
      text: `SCANNED FROM RECEIPT${added ? ` · ${added}` : ""}`,
      linkTo: { kind: "receipt", id: item.sourceReceiptId },
    };
  }

  // Pantry-shelf scan (fridge/pantry/freezer). Deep-linkable when we
  // captured a scan id — the pantry_scans table (migration 0032) is
  // the source of truth for these, same pattern as receipts.
  if (item.sourceKind === "pantry_scan") {
    return {
      icon: "📱",
      text: `ADDED VIA PANTRY SCAN${added ? ` · ${added}` : ""}`,
      linkTo: item.sourceScanId ? { kind: "scan", id: item.sourceScanId } : null,
    };
  }

  // State-conversion output (when we eventually set source_kind here).
  if (item.sourceKind === "conversion") {
    return { icon: "⇌", text: `CONVERTED FROM SOURCE${added ? ` · ${added}` : ""}`, linkTo: null };
  }

  // Explicitly manual, or inferred from presence of purchasedAt alone.
  if (item.sourceKind === "manual" || added) {
    return { icon: "✎", text: `ADDED MANUALLY${added ? ` · ${added}` : ""}`, linkTo: null };
  }

  return null;
}

// ── location chip ────────────────────────────────────────────────────
const LOCATIONS = [
  { id: "fridge",  emoji: "🧊", label: "Fridge"  },
  { id: "pantry",  emoji: "🥫", label: "Pantry"  },
  { id: "freezer", emoji: "❄️", label: "Freezer" },
];

export default function ItemCard({ item, pantry = [], onUpdate, onOpenProvenance, onClose }) {
  // Close on Escape for keyboard users — mirrors other modals in the app.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // All ingredient tags on this item (migration 0033's ingredient_ids
  // array), normalized to a list of canonical-ingredient objects plus
  // their ids. For single-tag items this is a 1-element array — same
  // thing the UI had before. For multi-tag items (pizza, Italian blend,
  // etc.) each tag gets its own tab in the INGREDIENT deep-dive.
  const tags = useMemo(() => {
    const ids = Array.isArray(item?.ingredientIds) && item.ingredientIds.length
      ? item.ingredientIds
      : (item?.ingredientId ? [item.ingredientId] : []);
    return ids
      .map(id => ({ id, canonical: findIngredient(id) }))
      .filter(t => t.canonical);
  }, [item?.ingredientIds, item?.ingredientId]);

  // Which tag's deep-dive is currently open. Resets when the item or
  // its tag list changes (opening a different item / the user adding
  // or removing a tag).
  const [activeTagIdx, setActiveTagIdx] = useState(0);
  useEffect(() => { setActiveTagIdx(0); }, [item?.id, tags.length]);

  // Safe bound — if the tag list shrinks below activeTagIdx (user
  // removed a tag via the LinkIngredient flow in 5d), snap back to 0.
  const safeIdx = Math.min(activeTagIdx, Math.max(0, tags.length - 1));
  const activeTag = tags[safeIdx] || null;
  // The legacy `canonical` variable still refers to the PRIMARY tag
  // (first element). Used for the top-section identity lines where
  // "primary" is the right anchor — the deep-dive below uses activeTag.
  const canonical = tags[0]?.canonical || null;

  // Flavor roll-up for multi-tag items. Union of each tag's
  // flavor.primary array, intensity = max across tags. A frozen
  // pizza tagged [mozz, sausage, bbq_sauce, pizza_dough] reads as
  // "UMAMI · FAT · SWEET · SALT" — the whole flavor footprint of
  // the composite product. Single-tag items skip this line since
  // the deep-dive already shows the same info.
  const { getInfo: getDbInfo } = useIngredientInfo();
  const rolledFlavor = useMemo(() => {
    if (tags.length < 2) return null;
    const intensityRank = { mild: 1, moderate: 2, intense: 3 };
    const primarySet = new Set();
    let maxIntensity = null;
    for (const t of tags) {
      const info = getIngredientInfo(t.canonical, getDbInfo(t.id));
      const f = info?.flavor;
      if (!f) continue;
      for (const p of f.primary || []) primarySet.add(p);
      const rank = intensityRank[f.intensity] || 0;
      if (!maxIntensity || rank > (intensityRank[maxIntensity] || 0)) {
        maxIntensity = f.intensity;
      }
    }
    if (primarySet.size === 0) return null;
    return { primary: [...primarySet], intensity: maxIntensity };
  }, [tags, getDbInfo]);

  // Which field is currently being edited inline. null = read-only view.
  // One field open at a time matches the existing pantry-row edit UX.
  const [editingField, setEditingField] = useState(null);

  // Swipe-down-to-dismiss state.
  //
  //   dragY        — current vertical offset the inner modal is translated
  //                  by. Tracks the finger while dragging, then either
  //                  snaps back to 0 (not dismissed) or animates out
  //                  past the viewport (dismissed).
  //   dragStartRef — ref holding the touch-start Y and whether the scroll
  //                  container was at its top when the drag began. The
  //                  gesture only activates at scrollTop === 0 so scrolling
  //                  through the deep-dive content never accidentally
  //                  triggers dismiss.
  const DISMISS_THRESHOLD = 100;
  const [dragY, setDragY] = useState(0);
  const dragStartRef = useRef(null);
  const scrollRef = useRef(null);

  const onTouchStart = (e) => {
    const el = scrollRef.current;
    if (!el) return;
    // Only arm the drag when the scroll is at the top. If the user has
    // scrolled down and starts a new touch, we assume they want to keep
    // scrolling, not dismiss.
    if (el.scrollTop > 0) return;
    dragStartRef.current = { y: e.touches[0].clientY };
  };
  const onTouchMove = (e) => {
    if (!dragStartRef.current) return;
    const diff = e.touches[0].clientY - dragStartRef.current.y;
    if (diff <= 0) { setDragY(0); return; } // upward drag: ignore
    setDragY(diff);
  };
  const onTouchEnd = () => {
    if (!dragStartRef.current) return;
    const finalY = dragY;
    dragStartRef.current = null;
    if (finalY >= DISMISS_THRESHOLD) {
      // Snap out + dismiss. Animation handles the motion; cleanup on unmount.
      setDragY(window.innerHeight);
      setTimeout(() => onClose?.(), 180);
    } else {
      setDragY(0); // snap back
    }
  };

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
      position: "fixed", inset: 0,
      // Fade the backdrop with the drag so the dismiss feels physical.
      background: `rgba(0,0,0,${0.87 * Math.max(0, 1 - dragY / 400)})`,
      zIndex: 320,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
      transition: dragStartRef.current ? "none" : "background 0.18s ease",
    }}>
      <div
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          width: "100%", background: "#141414",
          borderRadius: "20px 20px 0 0", padding: "18px 22px 36px",
          maxHeight: "92vh", overflowY: "auto",
          position: "relative",
          // Translate the card with the finger; snap-back and snap-out use
          // the same transition timing so they feel like the same gesture.
          transform: `translateY(${dragY}px)`,
          transition: dragStartRef.current ? "none" : "transform 0.18s ease",
          // Prevent overscroll-chaining on iOS when the user starts pulling
          // at the top of the scroll area — otherwise the whole page
          // bounces instead of the card translating.
          overscrollBehaviorY: "contain",
        }}
      >
        {/* Drag handle — visual affordance that the sheet can be swiped
            down. Centered at the top. */}
        <div style={{
          width: 44, height: 4, background: "#2a2a2a", borderRadius: 2,
          margin: "0 auto 14px", flexShrink: 0,
        }} />
        {/* Close button, top-right. */}
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
              {/* IDENTIFIED AS — lists every canonical tag on this item.
                  Single-tag items render exactly like before; multi-tag
                  items (Italian blend, frozen pizza, etc.) render all
                  their tags joined with "·" so the full identity is
                  visible at a glance before opening the deep-dive. */}
              {tags.length > 0 && (() => {
                // Skip the line if the ONLY tag's name matches the
                // user-typed name — avoids "Prosciutto · PROSCIUTTO"
                // redundancy. Multi-tag always shows.
                if (tags.length === 1 &&
                    item.name?.toLowerCase() === tags[0].canonical.name?.toLowerCase()) {
                  return null;
                }
                return (
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.08em", marginTop: 3 }}>
                    IDENTIFIED AS:{" "}
                    {tags.map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && <span style={{ color: "#444" }}> · </span>}
                        <span style={{ color: "#f5c842" }}>{t.canonical.name.toUpperCase()}</span>
                      </span>
                    ))}
                  </div>
                );
              })()}
              {/* FLAVOR roll-up — only renders for multi-tag items. A
                  pizza tagged with mozz + sausage + bbq + dough reads
                  as the UNION of their flavor primaries. Single-tag
                  items get the same info inside the deep-dive so
                  showing it here would be redundant. */}
              {rolledFlavor && (
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.08em", marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>FLAVOR:</span>
                  {rolledFlavor.primary.map((p, i) => (
                    <span key={p}>
                      {i > 0 && <span style={{ color: "#444" }}>·</span>}{" "}
                      <span style={{ color: "#d4a8c7", textTransform: "uppercase" }}>{p}</span>
                    </span>
                  ))}
                  {rolledFlavor.intensity && (
                    <span style={{ color: "#666" }}>· {rolledFlavor.intensity.toUpperCase()}</span>
                  )}
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

          {/* Raw scanner read — when the row came from a scan, show what
              Claude actually saw on the label before canonical substitution.
              Folded into a compact line so it doesn't dominate the card; if
              the user ever needs to verify "is this row actually the right
              item?" the raw text is the source of truth. */}
          {item.scanRaw && (
            <div style={{
              padding: "8px 12px", marginBottom: 10,
              background: "#0a0a0a", border: "1px solid #1f1f1f", borderRadius: 8,
              fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666",
              letterSpacing: "0.06em", display: "flex", gap: 10, flexWrap: "wrap",
            }}>
              <span style={{ color: "#444" }}>RAW SCAN:</span>
              <span style={{ color: "#aaa" }}>
                "{item.scanRaw.raw_name || "—"}"
              </span>
              {item.scanRaw.confidence && (
                <span style={{
                  color: item.scanRaw.confidence === "high" ? "#7ec87e"
                    : item.scanRaw.confidence === "medium" ? "#f59e0b"
                    : "#ef4444",
                }}>
                  · {String(item.scanRaw.confidence).toUpperCase()}
                </span>
              )}
              {item.scanRaw.detected_state && (
                <span style={{ color: "#7eb8d4" }}>
                  · DETECTED {String(item.scanRaw.detected_state).toUpperCase()}
                </span>
              )}
            </div>
          )}

          {/* Provenance line. Tap to open the source artifact (receipt /
              cook log) when there's a linkTo. Rendered as a button element
              when tappable so keyboard users get focus + Enter for free. */}
          {prov && (() => {
            const canOpen = !!(prov.linkTo && onOpenProvenance);
            const As = canOpen ? "button" : "div";
            return (
              <As
                onClick={canOpen ? () => onOpenProvenance(prov.linkTo) : undefined}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 12px", marginBottom: 14,
                  background: "#0a0a0a", border: "1px dashed #242424", borderRadius: 10,
                  display: "flex", alignItems: "center", gap: 10,
                  textAlign: "left",
                  color: "inherit",
                  cursor: canOpen ? "pointer" : "default",
                }}
              >
                <span style={{ fontSize: 16 }}>{prov.icon}</span>
                <span style={{ flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#888", letterSpacing: "0.08em" }}>
                  {prov.text}
                </span>
                {canOpen && (
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.1em" }}>
                    TAP TO VIEW →
                  </span>
                )}
              </As>
            );
          })()}
        </div>

        {/* ─── INGREDIENT / INGREDIENTS (canonical deep-dive) ───
            Singular label for single-tag items, plural + tab switcher for
            multi-tag items (frozen pizza, Italian blend, compound scratch
            recipes). Each tab swaps which canonical the embedded
            IngredientCard renders. */}
        {activeTag ? (
          <>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              margin: "8px 0 4px", color: "#444",
            }}>
              <div style={{ flex: 1, height: 1, background: "#242424" }} />
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7eb8d4", letterSpacing: "0.15em" }}>
                {tags.length > 1 ? "INGREDIENTS" : "INGREDIENT"}
              </div>
              <div style={{ flex: 1, height: 1, background: "#242424" }} />
            </div>
            {tags.length > 1 && (
              // Tab row — one chip per canonical tag. Tap to swap the
              // embedded IngredientCard's viewingId. Horizontally
              // scrollable on narrow viewports via the flex-wrap +
              // overflow combo.
              <div style={{
                display: "flex", gap: 6, marginBottom: 12,
                padding: 4, background: "#0a0a0a", border: "1px solid #1e1e1e",
                borderRadius: 10, overflowX: "auto",
              }}>
                {tags.map((t, i) => {
                  const active = i === safeIdx;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActiveTagIdx(i)}
                      style={{
                        flex: "0 0 auto",
                        padding: "7px 11px",
                        background: active ? "#1a1608" : "transparent",
                        border: `1px solid ${active ? "#f5c842" : "transparent"}`,
                        color: active ? "#f5c842" : "#888",
                        borderRadius: 7,
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        letterSpacing: "0.05em",
                        cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 6,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{t.canonical.emoji || "🥣"}</span>
                      <span>{t.canonical.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <IngredientCard
              key={activeTag.id /* force remount on tab change so
                                   internal viewingId + scroll reset */}
              ingredientId={activeTag.id}
              fallbackName={item.name}
              fallbackEmoji={activeTag.canonical.emoji}
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
