import { useEffect, useMemo, useState } from "react";
import { findIngredient, getIngredientInfo, inferUnitsForScanned, stateLabel, statesForIngredient, unitLabel } from "../data/ingredients";
import IdentifiedAsPicker from "./IdentifiedAsPicker";
import IngredientCard from "./IngredientCard";
import ModalSheet from "./ModalSheet";
import { useIngredientInfo } from "../lib/useIngredientInfo";
import { useItemComponents } from "../lib/useItemComponents";
import { useUserTiles } from "../lib/useUserTiles";
import { FRIDGE_TILES } from "../lib/fridgeTiles";
import { PANTRY_TILES } from "../lib/pantryTiles";
import { FREEZER_TILES } from "../lib/freezerTiles";
import { inferTileFromName } from "../lib/tileKeywords";
import { Z } from "../lib/tokens";
import TypePicker from "./TypePicker";
import { findFoodType, inferFoodTypeFromName } from "../data/foodTypes";
import { useUserTypes } from "../lib/useUserTypes";

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
//   onEditTags()          — optional; called when the user taps any of the
//                           "+ EDIT TAGS" / "+ ADD" affordances on the card.
//                           Parent opens LinkIngredient against this item
//                           (layered on top at a higher z-index). Absent
//                           = button is hidden (read-only embeds).
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

// Compact number formatter for component amount labels. Drops trailing
// .00 on integers, keeps two decimals on fractions. "2", "0.25", "1.5"
// — never "2.00 cup" which reads as a typo.
function formatNumber(n) {
  if (n == null || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
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

export default function ItemCard({ item, pantry = [], userId, onUpdate, onOpenProvenance, onEditTags, onClose }) {
  // Shell concerns (Escape-to-close, swipe-down-to-dismiss, backdrop,
  // drag handle, top-right ✕) are owned by ModalSheet; this component
  // only describes the card's content.

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

  // IDENTIFIED-AS line collapse. Show the first 5 tags inline; long
  // tag lists (loaded burritos with 12 components, that platter with
  // 18) get a "+N MORE" toggle that expands the line. Avoids the wall
  // of text in the hero area while keeping all info one tap away.
  // No hard cap on the underlying data — purely a render concession.
  const TAGS_VISIBLE = 5;
  const [showAllTags, setShowAllTags] = useState(false);
  useEffect(() => { setShowAllTags(false); }, [item?.id]);

  // Family's custom tiles for tile-id resolution. RLS handles family
  // scope so we get self+family rows. Empty array when no user tiles
  // exist yet; built-in resolution still works fine.
  const [userTiles] = useUserTiles(userId);

  // Resolve a tile_id -> display info ({emoji, label, location, source}).
  // Checks built-ins first (FRIDGE/PANTRY/FREEZER_TILES), then user
  // tiles. Returns null when the id doesn't match either — which
  // happens for in-flight realtime writes or a tile a family member
  // deleted; UI falls back to a generic "Custom Tile" label.
  const currentTile = useMemo(() => {
    if (!item?.tileId) return null;
    const id = item.tileId;
    const fridgeHit  = FRIDGE_TILES.find(t => t.id === id);
    if (fridgeHit)  return { ...fridgeHit,  location: "fridge",  source: "builtin" };
    const pantryHit  = PANTRY_TILES.find(t => t.id === id);
    if (pantryHit)  return { ...pantryHit,  location: "pantry",  source: "builtin" };
    const freezerHit = FREEZER_TILES.find(t => t.id === id);
    if (freezerHit) return { ...freezerHit, location: "freezer", source: "builtin" };
    const userHit = userTiles.find(t => t.id === id);
    if (userHit)    return { ...userHit, source: "custom" };
    return null;
  }, [item?.tileId, userTiles]);

  // Stacked tile-picker state. Opened when the IDENTIFIED AS line is
  // tapped. Renders in its own ModalSheet over the ItemCard at a
  // higher z-index so the pick flow doesn't close the card.
  const [tilePickerOpen, setTilePickerOpen] = useState(false);

  // IDENTIFIED AS (type) resolution. Mirrors the tile resolver
  // above — bundled WWEIA types checked first (O(1) lookup),
  // user types via useUserTypes fallback. Null when the id doesn't
  // resolve (stale template referencing a deleted user_type, etc.).
  const [userTypes] = useUserTypes(userId);
  const currentType = useMemo(() => {
    if (!item?.typeId) return null;
    const bundled = findFoodType(item.typeId);
    if (bundled) return { ...bundled, source: "bundled" };
    const userHit = userTypes.find(t => t.id === item.typeId);
    if (userHit) return { ...userHit, source: "custom" };
    return null;
  }, [item?.typeId, userTypes]);

  // Stacked type picker — separate from tilePicker so both can
  // exist but don't step on each other.
  const [typePickerOpen, setTypePickerOpen] = useState(false);

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

  // Components tree (migration 0034). Loaded for every ItemCard open;
  // empty array for un-composed items so the section conditionally
  // renders. Realtime-synced so a family member re-linking the meal
  // updates the tree in place. The hook short-circuits when itemId is
  // falsy, so this stays cheap for free-text rows mid-creation.
  const [components] = useItemComponents(item?.id);

  // Precedence rule (per the Meal/Component design): when an item has
  // composed structure (kind='meal' AND component rows exist), the
  // tree is the authoritative deep-dive. The flat IDENTIFIED-AS-tags
  // strip stays as a quick reference at the top, but the bottom of
  // the card shows COMPONENTS instead of the per-tag tabs. Items
  // without components fall through to the legacy tabs view, which
  // covers atomic ingredients (one tab) and pre-6c multi-tagged
  // items (one tab per tag, no structured tree yet).
  const isComposed = (item?.kind === "meal") && components.length > 0;

  // Drill targets for the stacked-modal navigation. Tapping a
  // component opens either an ItemCard (sub-meal sub-tree) or an
  // IngredientCard (canonical deep-dive). At most one is open at a
  // time; closing returns the user to this card's COMPONENTS view.
  // drilledItem accepts a full pantry item shape (when the child
  // still exists in pantry[]) or a snapshot shape (built from the
  // component row's name_snapshot + ingredient_ids_snapshot when the
  // child has been consumed/deleted) — ItemCard renders both
  // identically, just with read-only mode for snapshots.
  const [drilledItem, setDrilledItem] = useState(null);
  const [drilledIngredientId, setDrilledIngredientId] = useState(null);
  const [snapshotMode, setSnapshotMode] = useState(false);

  // Open a component. For item-kind components, look up the live row
  // in pantry first; if the item has been consumed (lookup miss),
  // fall back to a snapshot shape so the card still renders with the
  // last-known identity. Snapshot mode disables editing — it's a
  // historical view, not a live one.
  const openComponent = (comp) => {
    if (comp.childKind === "ingredient" && comp.childIngredientId) {
      setDrilledIngredientId(comp.childIngredientId);
      return;
    }
    if (comp.childKind === "item" && comp.childItemId) {
      const live = (pantry || []).find(p => p.id === comp.childItemId);
      if (live) {
        setSnapshotMode(false);
        setDrilledItem(live);
      } else {
        setSnapshotMode(true);
        setDrilledItem({
          id: comp.childItemId,
          name: comp.nameSnapshot || "(consumed)",
          emoji: "🥡",
          ingredientId: comp.ingredientIdsSnapshot[0] || null,
          ingredientIds: comp.ingredientIdsSnapshot || [],
          amount: 0,
          unit: "",
          kind: comp.ingredientIdsSnapshot.length >= 2 ? "meal" : "ingredient",
          location: "fridge",
        });
      }
    }
  };

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
    <>
      <ModalSheet onClose={onClose} zIndex={Z.card}>

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
              {/* IDENTIFIED AS — what KIND of thing this is (Pizza,
                  Cheese, Sausages). Separate from STORED IN below
                  which answers WHERE it lives. Tap to re-pick —
                  opens a stacked TypePicker modal. */}
              {onUpdate && (
                <div
                  onClick={(e) => { e.stopPropagation(); setTypePickerOpen(true); }}
                  style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: currentType ? "#f5c842" : "#666",
                    letterSpacing: "0.08em", marginTop: 3,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  <span style={{ color: "#888" }}>IDENTIFIED AS:</span>
                  {currentType ? (
                    <>
                      <span style={{ fontSize: 12 }}>{currentType.emoji}</span>
                      <span style={{
                        color: "#f5c842",
                        borderBottom: "1px dashed #f5c84244",
                      }}>
                        {currentType.label?.toUpperCase() || "CUSTOM TYPE"}
                      </span>
                    </>
                  ) : (
                    <span style={{
                      color: "#888",
                      borderBottom: "1px dashed #66666644",
                    }}>
                      TAP TO IDENTIFY
                    </span>
                  )}
                </div>
              )}
              {/* STORED IN — the item's tile placement (where it lives).
                  Distinct from MADE OF below which lists component
                  ingredients. Tap to re-pick — opens a stacked
                  IdentifiedAsPicker modal. Hidden entirely when
                  there's no onUpdate (read-only embeds). */}
              {onUpdate && (
                <div
                  onClick={(e) => { e.stopPropagation(); setTilePickerOpen(true); }}
                  style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: currentTile ? "#f5c842" : "#666",
                    letterSpacing: "0.08em", marginTop: 3,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  <span style={{ color: "#888" }}>STORED IN:</span>
                  {currentTile ? (
                    <>
                      <span style={{ fontSize: 12 }}>{currentTile.emoji}</span>
                      <span style={{
                        color: "#f5c842",
                        borderBottom: "1px dashed #f5c84244",
                      }}>
                        {currentTile.label?.toUpperCase() || "CUSTOM TILE"}
                      </span>
                    </>
                  ) : (
                    <span style={{
                      color: "#888",
                      borderBottom: "1px dashed #66666644",
                    }}>
                      TAP TO PLACE
                    </span>
                  )}
                </div>
              )}
              {/* MADE OF — lists every canonical tag on this item.
                  Renamed from IDENTIFIED AS in chunk 16d to separate
                  compositional identity ("what is this made from")
                  from organizational identity ("what kind of thing
                  is this", now the IDENTIFIED AS line above).
                  Single-tag items render exactly like before; multi-
                  tag items (Italian blend, frozen pizza, etc.) render
                  all their tags joined with "·" so the full identity
                  is visible at a glance before opening the deep-dive. */}
              {tags.length > 0 && (() => {
                // Skip the line if the ONLY tag's name matches the
                // user-typed name — avoids "Prosciutto · PROSCIUTTO"
                // redundancy. Multi-tag always shows.
                if (tags.length === 1 &&
                    item.name?.toLowerCase() === tags[0].canonical.name?.toLowerCase()) {
                  return null;
                }
                const overflowing = tags.length > TAGS_VISIBLE && !showAllTags;
                const visible = overflowing ? tags.slice(0, TAGS_VISIBLE) : tags;
                const hidden  = overflowing ? tags.length - TAGS_VISIBLE : 0;
                return (
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.08em", marginTop: 3, lineHeight: 1.5 }}>
                    MADE OF:{" "}
                    {visible.map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && <span style={{ color: "#444" }}> · </span>}
                        <span style={{ color: "#f5c842" }}>{t.canonical.name.toUpperCase()}</span>
                      </span>
                    ))}
                    {hidden > 0 && (
                      <>
                        <span style={{ color: "#444" }}> · </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowAllTags(true); }}
                          style={{
                            background: "transparent", border: "none", padding: 0,
                            color: "#7eb8d4", cursor: "pointer",
                            fontFamily: "'DM Mono',monospace", fontSize: 10,
                            letterSpacing: "0.08em", textDecoration: "underline dotted",
                            textUnderlineOffset: 2,
                          }}
                        >
                          +{hidden} MORE
                        </button>
                      </>
                    )}
                    {showAllTags && tags.length > TAGS_VISIBLE && (
                      <>
                        <span style={{ color: "#444" }}> · </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowAllTags(false); }}
                          style={{
                            background: "transparent", border: "none", padding: 0,
                            color: "#666", cursor: "pointer",
                            fontFamily: "'DM Mono',monospace", fontSize: 10,
                            letterSpacing: "0.08em", textDecoration: "underline dotted",
                            textUnderlineOffset: 2,
                          }}
                        >
                          SHOW LESS
                        </button>
                      </>
                    )}
                    {/* Edit-tags affordance inline with the IDENTIFIED AS
                        line. Opens LinkIngredient against this item via
                        the parent's onEditTags callback. Hidden when the
                        parent didn't wire it (read-only embeds, e.g. a
                        nested drill view). */}
                    {onEditTags && (
                      <>
                        <span style={{ color: "#444" }}> · </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditTags(); }}
                          style={{
                            background: "transparent", border: "1px solid #3a2f10",
                            padding: "1px 7px",
                            color: "#f5c842", cursor: "pointer",
                            fontFamily: "'DM Mono',monospace", fontSize: 9,
                            letterSpacing: "0.1em", borderRadius: 4,
                          }}
                        >
                          + EDIT
                        </button>
                      </>
                    )}
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

        {/* ─── COMPONENTS (Meals only, precedence over the flat tags) ───
            For composed items (kind='meal' with component rows in
            pantry_item_components, migration 0034), this section IS
            the deep-dive — a list of every constituent, drillable on
            tap. Item-kind components stack a new ItemCard for the
            sub-tree; ingredient-kind components stack an IngredientCard
            for the canonical's full info. The legacy IDENTIFIED-AS-tabs
            view below is suppressed when composed structure exists. */}
        {isComposed && (
          <>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              margin: "8px 0 4px", color: "#444",
            }}>
              <div style={{ flex: 1, height: 1, background: "#242424" }} />
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7eb8d4", letterSpacing: "0.15em" }}>
                COMPONENTS · {components.length}
              </div>
              <div style={{ flex: 1, height: 1, background: "#242424" }} />
              {onEditTags && (
                <button
                  onClick={onEditTags}
                  style={{
                    background: "transparent", border: "1px solid #3a2f10",
                    padding: "3px 9px",
                    color: "#f5c842", cursor: "pointer",
                    fontFamily: "'DM Mono',monospace", fontSize: 9,
                    letterSpacing: "0.12em", borderRadius: 5,
                  }}
                >
                  + EDIT
                </button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {components.map(comp => {
                // Resolve the live identity for ingredient-kind comps
                // from the canonical registry; for item-kind comps from
                // the pantry array (with snapshot fallback).
                const isItem = comp.childKind === "item";
                const liveItem = isItem
                  ? (pantry || []).find(p => p.id === comp.childItemId)
                  : null;
                const consumed = isItem && !liveItem;
                const canonical = !isItem
                  ? findIngredient(comp.childIngredientId)
                  : null;

                const emoji = isItem
                  ? (liveItem?.emoji || "🥡")
                  : (canonical?.emoji || "🥣");
                const name = isItem
                  ? (liveItem?.name || comp.nameSnapshot || "(consumed)")
                  : (canonical?.name || comp.nameSnapshot || comp.childIngredientId);

                // Right-side metadata: amount/unit when known, OR
                // proportion as a percentage when amount isn't recorded.
                // Both can render together for the "I used 2 tsp (10%)"
                // case from a future component editor.
                const amountLabel = (comp.amount != null && comp.unit)
                  ? `${formatNumber(comp.amount)} ${comp.unit}`
                  : null;
                const proportionLabel = comp.proportion != null
                  ? `${Math.round(comp.proportion * 100)}%`
                  : null;

                return (
                  <button
                    key={comp.id}
                    onClick={() => openComponent(comp)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 12px",
                      background: consumed ? "#0c0c0c" : (isItem ? "#0f1620" : "#161616"),
                      border: `1px solid ${consumed ? "#1a1a1a" : (isItem ? "#1f3040" : "#2a2a2a")}`,
                      borderRadius: 10,
                      cursor: "pointer", textAlign: "left", width: "100%",
                      opacity: consumed ? 0.65 : 1,
                    }}
                  >
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: "'DM Sans',sans-serif", fontSize: 14,
                        color: consumed ? "#888" : "#f0ece4",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {name}
                      </div>
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 9,
                        color: isItem ? "#7eb8d4" : "#666",
                        letterSpacing: "0.08em", marginTop: 2,
                        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                      }}>
                        <span>
                          {isItem
                            ? (consumed ? "CONSUMED · SNAPSHOT" : "MEAL · DRILL IN →")
                            : "INGREDIENT · CANONICAL →"}
                        </span>
                        {amountLabel && <span style={{ color: "#aaa" }}>· {amountLabel}</span>}
                        {proportionLabel && <span style={{ color: "#a3d977" }}>· {proportionLabel} OF SOURCE</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ─── INGREDIENT / INGREDIENTS (legacy flat-tag deep-dive) ───
            Singular label for single-tag items, plural + tab switcher for
            multi-tag items that pre-date the components tree (no
            pantry_item_components rows yet). Each tab swaps which
            canonical the embedded IngredientCard renders. Suppressed
            entirely for composed items — the COMPONENTS section above
            is authoritative for those. */}
        {isComposed ? null : activeTag ? (
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
              {/* Edit-tags on the legacy (pre-6c) section too. Re-linking
                  a multi-tagged item through LinkIngredient's new flow
                  writes component rows and flips kind='meal', promoting
                  the card to the COMPONENTS view on the next open. */}
              {onEditTags && (
                <button
                  onClick={onEditTags}
                  style={{
                    background: "transparent", border: "1px solid #3a2f10",
                    padding: "3px 9px",
                    color: "#f5c842", cursor: "pointer",
                    fontFamily: "'DM Mono',monospace", fontSize: 9,
                    letterSpacing: "0.12em", borderRadius: 5,
                  }}
                >
                  + EDIT
                </button>
              )}
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
            {onEditTags && (
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={onEditTags}
                  style={{
                    padding: "10px 16px",
                    background: "#1a1608", border: "1px solid #3a2f10",
                    color: "#f5c842", borderRadius: 8,
                    fontFamily: "'DM Mono',monospace", fontSize: 11,
                    letterSpacing: "0.1em", cursor: "pointer", fontWeight: 600,
                  }}
                >
                  + LINK INGREDIENTS
                </button>
              </div>
            )}
          </div>
        )}
      </ModalSheet>

      {/* ─── Stacked drill modals ───────────────────────────────────────
          Tapping a component opens a child card layered on top of this
          one. Closing the child returns the user here without
          dismissing the whole stack. Item-kind drills recurse through
          ItemCard (so a 3-level Meal tree is just 3 stacked cards);
          ingredient-kind drills land on IngredientCard's standard
          modal mode. Siblings of ModalSheet in the render tree so
          they're not affected by the parent sheet's swipe transform
          and render at their own z-index layer on top. */}
      {drilledItem && (
        <ItemCard
          item={drilledItem}
          pantry={pantry}
          userId={userId}
          onUpdate={snapshotMode ? undefined : onUpdate}
          onOpenProvenance={onOpenProvenance}
          onClose={() => { setDrilledItem(null); setSnapshotMode(false); }}
        />
      )}
      {drilledIngredientId && (
        <IngredientCard
          ingredientId={drilledIngredientId}
          pantry={pantry}
          onClose={() => setDrilledIngredientId(null)}
        />
      )}

      {/* IDENTIFIED AS picker — stacked modal over the ItemCard.
          Mounted as a sibling so its fixed positioning isn't contained
          by ModalSheet's swipe transform (same pattern as drilled
          modals). Writes via onUpdate so the parent's usePantry flow
          persists the new tile_id + location. */}
      {tilePickerOpen && (
        <ModalSheet
          onClose={() => setTilePickerOpen(false)}
          zIndex={Z.picker}
          label="STORED IN"
          maxHeight="85vh"
        >
          <h2 style={{
            fontFamily: "'Fraunces',serif", fontSize: 22,
            fontStyle: "italic", color: "#f0ece4",
            fontWeight: 400, margin: "2px 0 10px",
          }}>
            Where does this live?
          </h2>
          <p style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
            color: "#888", lineHeight: 1.5, margin: "0 0 14px",
          }}>
            Pick a tile to place {item.name} in your kitchen. Or
            create a new one at the bottom.
          </p>
          <IdentifiedAsPicker
            userId={userId}
            locationHint={item.location || currentTile?.location || null}
            selectedTileId={item.tileId || null}
            // Name-keyword suggestion using chunk 16e's dictionary.
            // Only fires when no tile is set yet — re-pickers have
            // an explicit intent, don't want the system second-
            // guessing them.
            suggestedTileId={!item.tileId ? inferTileFromName(item.name) : null}
            onPick={(tileId, location) => {
              onUpdate?.({
                tileId,
                // Honor the picker's location when it differs from
                // the item's current location (e.g. user re-placing
                // a fridge item to Pantry tile). Keeps the pantry
                // row consistent with its new tile assignment.
                ...(location && location !== item.location
                    ? { location }
                    : {}),
              });
              setTilePickerOpen(false);
            }}
          />
        </ModalSheet>
      )}

      {/* IDENTIFIED AS (type) picker — stacked modal over the
          ItemCard, sibling to the tile picker so both can exist
          independently. When the user picks a type, we do the
          auto-suggest-tile-on-empty dance here too: if item.tileId
          is null and the picked type has a defaultTileId, set both
          in one onUpdate call. */}
      {typePickerOpen && (
        <ModalSheet
          onClose={() => setTypePickerOpen(false)}
          zIndex={Z.picker}
          label="IDENTIFIED AS"
          maxHeight="85vh"
        >
          <h2 style={{
            fontFamily: "'Fraunces',serif", fontSize: 22,
            fontStyle: "italic", color: "#f0ece4",
            fontWeight: 400, margin: "2px 0 10px",
          }}>
            What kind of thing is this?
          </h2>
          <p style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
            color: "#888", lineHeight: 1.5, margin: "0 0 14px",
          }}>
            Pick a type for {item.name}. Default categories come from
            USDA's food classifications; you can also create your own.
          </p>
          <TypePicker
            userId={userId}
            selectedTypeId={item.typeId || null}
            // Keyword-inferred suggestion — only fires when no type
            // is set yet (re-pickers have explicit intent).
            suggestedTypeId={!item.typeId ? inferFoodTypeFromName(item.name) : null}
            onPick={(typeId, defaultTileId, defaultLocation) => {
              const patch = { typeId };
              // Cross-axis auto-fill: if the item has no tile yet
              // and the picked type defaults to one, set it. User can
              // still re-pick tile separately via the STORED IN line.
              if (defaultTileId && !item.tileId) {
                patch.tileId = defaultTileId;
              }
              if (defaultLocation && !item.location) {
                patch.location = defaultLocation;
              }
              onUpdate?.(patch);
              setTypePickerOpen(false);
            }}
          />
        </ModalSheet>
      )}
    </>
  );
}
