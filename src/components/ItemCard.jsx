import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { INGREDIENTS, findIngredient, getIngredientInfo, inferUnitsForScanned, stateLabel, statesForIngredient, statesForItem, unitLabel, inferCanonicalFromName } from "../data/ingredients";
import IdentifiedAsPicker from "./IdentifiedAsPicker";
import IngredientCard from "./IngredientCard";
import ModalSheet from "./ModalSheet";
import { useIngredientInfo, slugifyIngredientName, isMeaningfullyEnriched } from "../lib/useIngredientInfo";
import { useBrandNutrition } from "../lib/useBrandNutrition";
import { lookupBarcode } from "../lib/lookupBarcode";
import BarcodeScanner from "./BarcodeScanner";
import { useToast } from "../lib/toast";
import { usePopularPackages } from "../lib/usePopularPackages";
import { useItemComponents } from "../lib/useItemComponents";
import { useUserTiles } from "../lib/useUserTiles";
import { FRIDGE_TILES } from "../lib/fridgeTiles";
import { PANTRY_TILES } from "../lib/pantryTiles";
import { FREEZER_TILES } from "../lib/freezerTiles";
import { inferTileFromName } from "../lib/tileKeywords";
import EnrichmentButton from "./EnrichmentButton";
import { Z } from "../lib/tokens";
import TypePicker from "./TypePicker";
import { findFoodType, inferFoodTypeFromName, canonicalIdForType, typeIdForCanonical } from "../data/foodTypes";
import { useUserTypes } from "../lib/useUserTypes";
import { LABELS, LABEL_KICKER } from "../lib/schemaLabels";
import AddItemOutcome from "./AddItemOutcome";
import { pantryItemNutrition, formatMacros, sourceBadge } from "../lib/nutrition";

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

export default function ItemCard({ item: itemProp, pantry = [], userId, isAdmin = false, familyIds = [], onUpdate, onDelete, onDuplicate, onOpenProvenance, onEditTags, onClose }) {
  // Shell concerns (Escape-to-close, swipe-down-to-dismiss, backdrop,
  // drag handle, top-right ✕) are owned by ModalSheet; this component
  // only describes the card's content.

  // Staged-edits pattern. Every inline change gets merged into
  // pendingChanges instead of firing onUpdate immediately. The user
  // sees staged values in the UI (the merged `item` below uses
  // pending over prop), then taps UPDATE in the floating action bar
  // at the bottom to commit everything in one write. DISCARD reverts
  // to the pristine prop values. Declared up here so every other
  // hook in this component can close over the merged `item` without
  // a TDZ error.
  const [pendingChanges, setPendingChanges] = useState({});
  const item = useMemo(
    () => ({ ...(itemProp || {}), ...pendingChanges }),
    [itemProp, pendingChanges],
  );

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

  // Canonical identity resolution (0039). The "final resting name"
  // of the thing — a Frank's Best Cheese Dogs row has canonical_id
  // = 'hot_dog' pointing at the bundled Hot Dog canonical, which
  // surfaces its emoji + display name on a dedicated line above
  // Food Category / Stored In. Separate from composition (what's
  // INSIDE the thing — lives on ingredient_ids[]).
  const currentCanonical = useMemo(() => {
    if (!item?.canonicalId) return null;
    return findIngredient(item.canonicalId);
  }, [item?.canonicalId]);

  // Stacked type picker — separate from tilePicker so both can
  // exist but don't step on each other.
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  // Canonical picker — new in chunk 19a. Previously canonical_id was
  // derived-only (set via type pick or name match); users now tap the
  // golden canonical line to search the registry and swap it, or tap
  // the ✕ next to it to unlink. Orthogonal to the type picker — the
  // canonical IS the final-resting-name, the type is the WWEIA kind.
  const [canonicalPickerOpen, setCanonicalPickerOpen] = useState(false);
  const [canonicalSearch, setCanonicalSearch] = useState("");

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
  const { getInfo: getDbInfo, getPendingInfo, refreshDb } = useIngredientInfo();
  const { get: getBrandNutrition, upsert: upsertBrandNutrition, rows: brandNutritionRows } = useBrandNutrition();
  const { push: pushToast } = useToast();
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

  // Popular package sizes for this row — observation-learned chip
  // suggestions, replacing the old admin-curated
  // `ingredient_info.packaging.sizes` path. Keyed on (brand,
  // canonical_id) so Kerrygold Butter's 8oz bubbles up separately
  // from generic-butter aggregates. Hook must be called at component
  // top level; the returned rows get rendered inside the PACKAGE
  // section below.
  const popularPackages = usePopularPackages(
    itemProp?.brand || null,
    itemProp?.canonicalId || itemProp?.ingredientId || null,
    5
  );

  // Which field is currently being edited inline. null = read-only view.
  // One field open at a time matches the existing pantry-row edit UX.
  const [editingField, setEditingField] = useState(null);
  // "+ ADD BRAND" now opens a small chooser: type the brand manually
  // OR scan a barcode. Scanning also opportunistically patches name
  // when OFF gives us better data, and writes brand_nutrition so the
  // nutrition chip lights up. This lets users fill in receipt-imported
  // items post-hoc without being locked into typing.
  const [brandChooserOpen, setBrandChooserOpen] = useState(false);
  const [brandScannerOpen, setBrandScannerOpen] = useState(false);
  const [brandScanBusy,    setBrandScanBusy]    = useState(false);
  // Flips true when the user picks "+ custom…" in the unit dropdown.
  // Replaces the <select> with a free-text <input> so they can type a
  // unit that isn't in the canonical's ladder ("pack", "wheel",
  // etc). Cleared when editingField closes.
  const [customUnitOpen, setCustomUnitOpen] = useState(false);
  useEffect(() => { if (editingField !== "qty") setCustomUnitOpen(false); }, [editingField]);

  // Focus-aware input state for PACKAGE SIZE + QUANTITY.
  //
  // Not-focused: the render reads directly from the merged `item`
  //   (which includes `pendingChanges`), so the input is always in
  //   sync with commits, chip taps, slider drags, and parent
  //   realtime updates.
  //
  // Focused: the render switches to the local draft, so the user's
  //   in-progress keystrokes never get clobbered by a re-render.
  //
  // onFocus seeds the draft from the current merged value. onBlur
  // parses the draft, commits if it differs, and clears the focus
  // flag (flipping value back to the merged-source render).
  //
  // This replaces the old useState+useEffect-keyed-on-itemProp
  // pattern, which was reading stale `itemProp.max` (since commits
  // only touch `pendingChanges`) and producing the "input looks
  // empty" symptom.
  const [pkgFocused, setPkgFocused] = useState(false);
  const [pkgDraft,   setPkgDraft]   = useState("");
  const [amtFocused, setAmtFocused] = useState(false);
  const [amtDraft,   setAmtDraft]   = useState("");

  if (!itemProp) return null;

  const readOnly = !onUpdate;
  const startEdit = (field) => { if (!readOnly) setEditingField(field); };

  // Full-screen overlay state. Shape:
  //   null                                    — no overlay
  //   { kind: "update_success", changed: [] } — after UPDATE commits
  //   { kind: "exit_warning" }                — close attempt with pending drafts
  const [outcome, setOutcome] = useState(null);

  // Stage a patch into pendingChanges. Every inline edit calls this
  // via `commit()` — the pattern the rest of ItemCard already uses.
  // Zero auto-commits; the floating UPDATE bar at the bottom is
  // what actually writes.
  const commit = (patch) => {
    setPendingChanges(prev => ({ ...prev, ...patch }));
    setEditingField(null);
  };

  // Commit every staged change in a single onUpdate call, then swap
  // to the success overlay listing what changed.
  const applyChanges = () => {
    if (Object.keys(pendingChanges).length === 0) return;
    const changed = Object.keys(pendingChanges);
    onUpdate?.(pendingChanges);
    setPendingChanges({});
    setOutcome({ kind: "update_success", changed });
  };

  // Drop every staged change, revert the visual back to pristine.
  const discardChanges = () => {
    setPendingChanges({});
  };

  const hasPending = Object.keys(pendingChanges).length > 0;

  // Close interceptor. If the user has pending drafts, warn before
  // letting them walk away; otherwise close immediately. The
  // warning offers DISCARD AND CLOSE as an escape hatch (same
  // pattern as AddItemModal's exit warning — flagged temporary
  // until post-beta).
  const attemptClose = () => {
    if (!hasPending) { onClose?.(); return; }
    setOutcome({ kind: "exit_warning" });
  };



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
      <ModalSheet onClose={attemptClose} zIndex={Z.card}>

        {/* ─── ITEM SECTION (this specific row) ─── */}
        <div style={{ paddingTop: 12 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.12em", marginBottom: 4 }}>
            ITEM
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 40, flexShrink: 0 }}>{item.emoji || "🥫"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* + ADD BRAND affordance — only rendered when brand
                  is unset. Positioned ABOVE the big italic header so
                  we don't leave a weird empty slot inline when brand
                  is absent. Once a brand is set, this affordance
                  disappears and brand slots into the header as a
                  clickable prefix. Pattern per user design call:
                  "Canonical header if no brand name set. If brand
                  name set (click to add is above…) once brand is
                  set it appears on the inline block before canonical." */}
              {!readOnly && !item.brand && editingField !== "brand" && (
                <div
                  onClick={() => setBrandChooserOpen(true)}
                  style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 9,
                    color: "#555", letterSpacing: "0.12em",
                    cursor: "pointer", marginBottom: 4,
                    width: "fit-content",
                    borderBottom: "1px dashed #2a2a2a",
                  }}
                >
                  + ADD BRAND
                </div>
              )}

              {/* Big italic HEADER — derived from brand + canonical
                  when both are set ("DelDuca Prosciutto"), falls back
                  to canonical alone, then to the user-typed
                  item.name. Each segment is its own tap target:
                  brand → inline rename, canonical → opens
                  LinkIngredient picker, free-text name (no canonical)
                  → legacy tap-to-edit. Replaces the pure
                  item.name-driven header per user design call:
                  typos like "Proscuitto" no longer fossilize as the
                  row's title when the registry knows it's
                  "Prosciutto". item.name stays in the DB as the
                  fallback for pre-canonical / free-text rows. */}
              <h2
                style={{
                  fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                  color: "#f0ece4", fontWeight: 400, margin: 0, lineHeight: 1.2,
                  overflow: "hidden", textOverflow: "ellipsis",
                  display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap",
                }}
              >
                {/* BRAND segment — only when set. Clicking swaps
                    inline to a text input; blur commits or clears. */}
                {editingField === "brand" ? (
                  <input
                    type="text"
                    autoFocus
                    defaultValue={item.brand || ""}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      commit({ brand: v || null });
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingField(null);
                    }}
                    placeholder="Brand…"
                    style={{
                      fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                      color: "#f5c842", fontWeight: 400, lineHeight: 1.2,
                      background: "#0a0a0a", border: "1px solid #f5c842",
                      borderRadius: 8, padding: "2px 8px", outline: "none",
                      minWidth: 120, width: "40%",
                    }}
                  />
                ) : item.brand ? (
                  <span
                    onClick={() => !readOnly && startEdit("brand")}
                    style={{
                      cursor: readOnly ? "default" : "text",
                      color: "#d4c9ac",
                    }}
                    title={readOnly ? undefined : "Tap to edit brand"}
                  >
                    {item.brand}
                  </span>
                ) : null}

                {/* CANONICAL / fallback segment. When canonical is
                    set, tap opens the LinkIngredient picker, which
                    carries its own CLEAR CANONICAL button for
                    unlinks (LinkIngredient.jsx:731) — no inline ✕
                    needed in the header. Matches the brand segment's
                    pattern: tap to edit, clear inside the editor.
                    When no canonical, fall back to the user-typed
                    item.name with tap-to-rename (legacy path for
                    free-text rows). */}
                {currentCanonical ? (
                  <span
                    onClick={() => !readOnly && setCanonicalPickerOpen(true)}
                    style={{
                      cursor: readOnly ? "default" : "pointer",
                    }}
                    title={readOnly ? undefined : "Tap to change or clear canonical"}
                  >
                    {currentCanonical.name}
                  </span>
                ) : editingField === "name" ? (
                  <input
                    type="text"
                    autoFocus
                    defaultValue={item.name}
                    onBlur={e => commit({ name: e.target.value.trim() || item.name })}
                    onKeyDown={e => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingField(null);
                    }}
                    style={{
                      flex: 1, minWidth: 0,
                      fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                      color: "#f5c842", fontWeight: 400, lineHeight: 1.2,
                      background: "#0a0a0a", border: "1px solid #f5c842",
                      borderRadius: 8, padding: "2px 8px", outline: "none",
                    }}
                  />
                ) : (
                  <span
                    onClick={() => !readOnly && startEdit("name")}
                    style={{ cursor: readOnly ? "default" : "text" }}
                  >
                    {item.name || "Unnamed"}
                  </span>
                )}
              </h2>
              {/* CANONICAL — tan badge. Reserved color across the app
                  for the canonical-identity axis. When canonicalId is
                  set but the registry doesn't know about it (user-
                  created canonical pending enrichment), fall back to
                  a slug → "Title Case" display with a ✨ emoji so the
                  link still reads as a link, not as "+ SET CANONICAL"
                  (which would make it look like the save failed). */}
              {/* CANONICAL axis row DELETED — canonical now lives in
                  the big italic header above, so restating it here
                  was pure duplication. Preserved affordances:
                  - UNLINK (when canonical set) → small ✕ next to
                    the canonical word in the header
                  - SET CANONICAL (when unset) → small muted "+ LINK
                    CANONICAL" chip rendered below the header, only
                    when canonical is null and the row has a chance
                    of being upgradable. Empty-state affordance
                    doesn't compete with the axis rows because it's
                    sized + colored like the "+ ADD BRAND" kicker
                    above the header (same micro-scale, same gray,
                    same dashed border). */}
              {onUpdate && !item.canonicalId && !readOnly && (
                <div
                  onClick={(e) => { e.stopPropagation(); setCanonicalPickerOpen(true); }}
                  style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 9,
                    color: "#8a7f6e", letterSpacing: "0.12em",
                    cursor: "pointer", marginTop: 4,
                    width: "fit-content",
                    borderBottom: "1px dashed #3a2f1044",
                  }}
                >
                  + LINK CANONICAL
                </div>
              )}

              {/* FOOD CATEGORY — orange badge. Reserved color across
                  the app for the WWEIA "what kind of thing is this"
                  axis. Empty state stays in orange ("+ SET CATEGORY")
                  instead of greying, so you can visually identify the
                  field before tapping. */}
              {onUpdate && (
                <div
                  onClick={(e) => { e.stopPropagation(); setTypePickerOpen(true); }}
                  style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#e07a3a",
                    letterSpacing: "0.08em", marginTop: 3,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  <span style={{ color: "#e07a3a" }}>{LABEL_KICKER("category")}:</span>
                  {currentType ? (
                    <>
                      <span style={{ fontSize: 12 }}>{currentType.emoji}</span>
                      <span style={{
                        color: "#e07a3a",
                        borderBottom: "1px dashed #e07a3a44",
                      }}>
                        {currentType.label?.toUpperCase() || "CUSTOM TYPE"}
                      </span>
                    </>
                  ) : (
                    <span style={{
                      color: "#e07a3a",
                      borderBottom: "1px dashed #e07a3a44",
                    }}>
                      + SET CATEGORY
                    </span>
                  )}
                </div>
              )}
              {/* STORED IN — blue badge. Reserved color across the app
                  for tile placement / storage location. Empty state
                  stays blue ("+ SET LOCATION") for consistent visual
                  identification. */}
              {onUpdate && (
                <div
                  onClick={(e) => { e.stopPropagation(); setTilePickerOpen(true); }}
                  style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#7eb8d4",
                    letterSpacing: "0.08em", marginTop: 3,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  <span style={{ color: "#7eb8d4" }}>{LABEL_KICKER("storedIn")}:</span>
                  {currentTile ? (
                    <>
                      <span style={{ fontSize: 12 }}>{currentTile.emoji}</span>
                      <span style={{
                        color: "#7eb8d4",
                        borderBottom: "1px dashed #7eb8d444",
                      }}>
                        {currentTile.label?.toUpperCase() || "CUSTOM TILE"}
                      </span>
                    </>
                  ) : (
                    <span style={{
                      color: "#7eb8d4",
                      borderBottom: "1px dashed #7eb8d444",
                    }}>
                      + SET LOCATION
                    </span>
                  )}
                </div>
              )}
              {/* Identity stack order — UNIVERSAL (see CLAUDE.md):
                    1. CUSTOM NAME   (title above)
                    2. CANONICAL     (tan,    above this block)
                    3. FOOD CATEGORY (orange, above this block)
                    4. STORED IN     (blue,   above this block)
                    5. STATE         (purple)
                    6. INGREDIENTS   (yellow)
                  Never reorder. */}

              {/* STATE — muted purple (matches the AddItemModal +
                  scan-row chip). Tappable when the canonical OR the
                  food category has a state vocabulary (bread:
                  loaf/slices/crumbs; pork: whole/sliced/ground/...).
                  statesForItem falls back to typeId when the canonical
                  itself is user-created (no parent hub link) — that's
                  how "pepperoni" with food category=pork still shows
                  the pork cut/form state picker. */}
              {(() => {
                const states = statesForItem(item);
                if (!states || states.length === 0) return null;
                const label = stateText || "SET STATE";
                return (
                  <div
                    onClick={e => { e.stopPropagation(); startEdit("state"); }}
                    style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      color: stateText ? "#c7a8d4" : "#555",
                      letterSpacing: "0.08em", marginTop: 3,
                      textTransform: "uppercase",
                      cursor: readOnly ? "default" : "pointer",
                    }}
                  >
                    {LABEL_KICKER("state")}: <span style={{
                      color: stateText ? "#c7a8d4" : "#888",
                      borderBottom: readOnly ? "none" : "1px dashed #c7a8d444",
                    }}>{label}</span>
                  </div>
                );
              })()}

              {/* INGREDIENTS — yellow. Multi-tag composition. */}
              {(onEditTags || tags.length > 0) && (() => {
                const hideTagList = tags.length === 1 &&
                  item.name?.toLowerCase() === tags[0].canonical.name?.toLowerCase();
                const overflowing = tags.length > TAGS_VISIBLE && !showAllTags;
                const visible = overflowing ? tags.slice(0, TAGS_VISIBLE) : tags;
                const hidden  = overflowing ? tags.length - TAGS_VISIBLE : 0;
                return (
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.08em", marginTop: 3, lineHeight: 1.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span>{LABEL_KICKER("ingredients")}:</span>
                    {tags.length === 0 && onEditTags && (
                      <span style={{ color: "#555", fontStyle: "italic" }}>
                        nothing yet
                      </span>
                    )}
                    {!hideTagList && visible.map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && <span style={{ color: "#444" }}> · </span>}
                        <span style={{ color: "#f5c842" }}>{t.canonical.name.toUpperCase()}</span>
                      </span>
                    ))}
                    {!hideTagList && hidden > 0 && (
                      <>
                        <span style={{ color: "#444" }}>·</span>
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
                    {!hideTagList && showAllTags && tags.length > TAGS_VISIBLE && (
                      <>
                        <span style={{ color: "#444" }}>·</span>
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
                    {onEditTags && (
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
                    )}
                  </div>
                );
              })()}

              {/* FLAVOR roll-up — derived from the INGREDIENTS tags,
                  so it renders after them (multi-tag only). */}
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
            </div>
          </div>

          {/* NUTRITION — resolver-based macro chip. Sits as a neutral
              band below the six colored identity axes (not a new axis
              per CLAUDE.md: brand / nutrition / etc are metadata that
              ride along). Tapping expands to a compact macro grid with
              a source-of-signal badge. Hidden when no resolver tier
              returns numbers — the coverage story reads honestly
              instead of faking zeros. */}
          <NutritionChip
            item={item}
            getInfo={getDbInfo}
            getBrandNutrition={getBrandNutrition}
            onUpdate={onUpdate}
          />

          {/* Quantity / Location / Expiration. Tap any card to edit inline.
              One editor is open at a time — opening a second closes the
              first (same pattern as the pantry-row edit UX). Escape
              cancels; Enter (or blur) commits. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
            {/* PACKAGE SIZE tile — swapped in where QUANTITY used to
                live. PACKAGE SIZE is set once at add-time and rarely
                edited, so it belongs in a compact tile alongside
                LOCATION and EXPIRES. The big slider-driven control
                below is QUANTITY (the thing that changes constantly
                as the user eats through the package). Unit dropdown
                lives HERE — package size declares the unit, and
                QUANTITY inherits it as static text. */}
            <div
              style={{
                padding: "10px 12px",
                background: "#0f0f0f",
                border: "1px solid #1e1e1e",
                borderRadius: 10,
              }}
            >
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>
                PACKAGE SIZE
              </div>
              {readOnly ? (
                <div style={{ marginTop: 2, fontFamily: "'DM Mono',monospace", fontSize: 14, color: "#f0ece4" }}>
                  {Number(item.max) > 0
                    ? `${Number(item.max)} ${canonical ? unitLabel(canonical, item.unit) : (item.unit || "")}`
                    : "—"}
                </div>
              ) : (() => {
                const hasPackage = Number(item.max) > 0;
                const units = canonical ? canonical.units : inferUnitsForScanned(item).units;
                const hasCurrent = units.some(u => u.id === item.unit);
                const opts = hasCurrent ? units : [{ id: item.unit, label: item.unit || "—", toBase: 1 }, ...units];
                return (
                  // STACKED: number input on top, unit dropdown below.
                  // The side-by-side layout was squishing the number
                  // input in the narrow 3-col grid tile — "1000" was
                  // rendered but clipped off the visible area. Stacking
                  // gives the number its own full-width row so the
                  // package size is always readable at a glance.
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                    <input
                      type="number" inputMode="decimal" min="0" step="any"
                      value={pkgFocused
                        ? pkgDraft
                        : (hasPackage ? String(item.max) : "")}
                      onFocus={() => {
                        setPkgDraft(hasPackage ? String(item.max) : "");
                        setPkgFocused(true);
                      }}
                      onChange={e => setPkgDraft(e.target.value)}
                      placeholder="tap to set"
                      onBlur={() => {
                        setPkgFocused(false);
                        const v = pkgDraft;
                        if (v === "") {
                          if (hasPackage) commit({ max: 0 });
                          return;
                        }
                        const n = parseFloat(v);
                        if (!Number.isFinite(n) || n < 0) return;
                        if (n === Number(item.max)) return;
                        // Declaring a PACKAGE SIZE = declaring a
                        // fresh sealed package at 100%. amount =
                        // max, always. If the user wants to log a
                        // mid-package state, they edit QUANTITY
                        // afterward (that path writes amount only,
                        // never max).
                        commit({ max: n, amount: n });
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          setPkgDraft(hasPackage ? String(item.max) : "");
                          e.currentTarget.blur();
                        }
                      }}
                      onClick={e => e.stopPropagation()}
                      style={{
                        width: "100%",
                        padding: "5px 8px",
                        background: "#0a0a0a",
                        border: `1px solid ${hasPackage ? "#f5c842" : "#2a2a2a"}`,
                        color: hasPackage ? "#f5c842" : "#888",
                        borderRadius: 6,
                        fontFamily: "'DM Mono',monospace", fontSize: 14,
                        fontWeight: 500,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    {customUnitOpen ? (
                      <input
                        key={`unit-${item.id}`}
                        type="text"
                        autoFocus
                        defaultValue={item.unit || ""}
                        placeholder="unit"
                        onBlur={e => {
                          const v = e.target.value.trim();
                          if (v && v !== item.unit) commit({ unit: v });
                          setCustomUnitOpen(false);
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const v = e.target.value.trim();
                            if (v) commit({ unit: v });
                            setCustomUnitOpen(false);
                          }
                          if (e.key === "Escape") setCustomUnitOpen(false);
                        }}
                        onClick={e => e.stopPropagation()}
                        style={{
                          width: "100%",
                          padding: "4px 8px",
                          background: "#0a0a0a", border: "1px solid #2a2a2a",
                          color: "#f5c842", borderRadius: 6,
                          fontFamily: "'DM Mono',monospace", fontSize: 11, outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    ) : (
                      <select
                        key={`unit-sel-${item.id}-${item.unit}`}
                        value={opts.some(u => u.id === item.unit) ? item.unit : (opts[0]?.id || "")}
                        onChange={e => {
                          if (e.target.value === "__custom") {
                            setCustomUnitOpen(true);
                            return;
                          }
                          if (e.target.value !== item.unit) commit({ unit: e.target.value });
                        }}
                        onClick={e => e.stopPropagation()}
                        style={{
                          width: "100%",
                          padding: "4px 22px 4px 8px",
                          background: "#0a0a0a", border: "1px solid #2a2a2a",
                          color: "#aaa", borderRadius: 6,
                          fontFamily: "'DM Mono',monospace", fontSize: 11, outline: "none",
                          cursor: "pointer",
                          appearance: "none",
                          WebkitAppearance: "none",
                          MozAppearance: "none",
                          backgroundImage: "linear-gradient(45deg, transparent 50%, #888 50%), linear-gradient(135deg, #888 50%, transparent 50%)",
                          backgroundPosition: "calc(100% - 12px) 50%, calc(100% - 7px) 50%",
                          backgroundSize: "5px 5px, 5px 5px",
                          backgroundRepeat: "no-repeat",
                          boxSizing: "border-box",
                        }}
                      >
                        {opts.map(u => (
                          <option key={u.id} value={u.id} style={{ background: "#141414" }}>{u.label}</option>
                        ))}
                        <option value="__custom" style={{ background: "#141414", color: "#7eb8d4" }}>+ custom…</option>
                      </select>
                    )}
                  </div>
                );
              })()}
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
                      commit({ expiresAt: new Date(`${v}T12:00:00Z`) });
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

          {/* QUANTITY — the main interactive section, front-and-center.
              Swapped in where the PACKAGE SIZE big block used to
              live. Logic: PACKAGE SIZE is set once at add-time (tile
              above in the 3-col grid); QUANTITY is what changes
              constantly as the user eats through the package, so it
              gets the slider + status readout + prominent input.

              SEALED ⇄ OPENED is derived from amount vs max:
                amount == max  → SEALED   (green ●)
                amount <  max  → OPENED   (amber ◐)
                no package yet → no badge (we can't claim a state
                                           without a reference)

              OTHERS USE chip row lives here too — tapping a chip
              fills PACKAGE SIZE AND QUANTITY together (fresh sealed
              package at 100%). Observation-learned from the
              popular_package_sizes RPC (migration 0063), so the
              chips are "what real households with this (brand,
              canonical) have declared" rather than admin-curated. */}
          {!readOnly && (() => {
            const hasPackage = Number(item.max) > 0;
            const sizes      = popularPackages.rows || [];
            const maxVal     = hasPackage ? Number(item.max) : 0;
            const amtN       = Number(item.amount || 0);
            const ratio      = hasPackage ? Math.min(1, amtN / maxVal) : 0;
            const sliderColor = ratio <= 0.25 ? "#ef4444"
              : ratio <= 0.5 ? "#f59e0b"
              : "#7ec87e";
            const step = maxVal <= 10 ? 0.1 : maxVal <= 100 ? 1 : maxVal / 100;
            const pct = Math.round(ratio * 100);
            const sealed = hasPackage && amtN > 0 && amtN === maxVal;
            const opened = hasPackage && amtN > 0 && amtN < maxVal;
            const overflowed = hasPackage && amtN > maxVal;
            return (
              <div style={{
                padding: "14px 16px", marginBottom: 12,
                background: "#0f0f0f", border: "1px solid #1e1e1e",
                borderRadius: 10,
              }}>
                {/* Header — label + state badge inline. */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  <div style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#f5c842", letterSpacing: "0.08em",
                  }}>
                    QUANTITY
                  </div>
                  {sealed && (
                    <div style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      color: "#7ec87e", letterSpacing: "0.08em",
                    }}>
                      ● SEALED
                    </div>
                  )}
                  {opened && (
                    <div style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      color: "#f59e0b", letterSpacing: "0.08em",
                    }}>
                      ◐ OPENED
                    </div>
                  )}
                  <div style={{
                    fontFamily: "'DM Sans',sans-serif", fontSize: 11,
                    color: overflowed ? "#ef4444" : "#888",
                  }}>
                    {!hasPackage
                      ? "set PACKAGE SIZE above to enable the slider"
                      : overflowed
                        ? `${amtN} exceeds package (${maxVal}) — raise PACKAGE SIZE or lower QUANTITY`
                        : sealed
                          ? `${maxVal} ${item.unit || ""} · full`
                          : `${amtN.toFixed(Number.isInteger(amtN) ? 0 : 1)} of ${maxVal} left · ${pct}%`}
                  </div>
                </div>

                {/* PRIMARY INPUT — how much is on the shelf right now.
                    Number input + static unit (unit lives on PACKAGE
                    SIZE tile, inherited here). */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 12px",
                  background: "#0a0a0a",
                  border: `1px solid ${sealed ? "#7ec87e55" : opened ? "#f59e0b55" : "#3a3a3a"}`,
                  borderRadius: 8,
                  marginBottom: hasPackage ? 10 : (sizes.length > 0 ? 10 : 0),
                }}>
                  <input
                    type="number" inputMode="decimal" min="0" step="any"
                    value={amtFocused
                      ? amtDraft
                      : (amtN > 0 ? String(amtN) : "")}
                    onFocus={() => {
                      setAmtDraft(amtN > 0 ? String(amtN) : "");
                      setAmtFocused(true);
                    }}
                    onChange={e => setAmtDraft(e.target.value)}
                    placeholder="how much is left"
                    onBlur={() => {
                      setAmtFocused(false);
                      if (amtDraft === "") return;
                      const v = parseFloat(amtDraft);
                      if (Number.isFinite(v) && v >= 0 && v !== amtN) {
                        // QUANTITY edit writes amount only — never
                        // touches max. If amount > max the header
                        // warns; user can fix by raising PACKAGE SIZE.
                        commit({ amount: v });
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        setAmtDraft(amtN > 0 ? String(amtN) : "");
                        e.currentTarget.blur();
                      }
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      flex: 1, minWidth: 0,
                      background: "transparent", border: "none", outline: "none",
                      color: "#f5c842",
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 20, fontWeight: 500,
                      padding: 0,
                    }}
                  />
                  <span style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 14,
                    color: "#aaa", flexShrink: 0,
                  }}>
                    {item.unit || "—"}
                  </span>
                </div>

                {/* Slider — drag-to-estimate how much is left. Only
                    renders when a package size is declared so the
                    gauge has a reference for 100%. Half a bag is
                    eaten, nobody's weighing what's left; drag to
                    what looks right. */}
                {hasPackage && (
                  <input
                    type="range"
                    min="0" max={maxVal} step={step}
                    value={amtN}
                    onChange={e => commit({ amount: Number(e.target.value) })}
                    onClick={e => e.stopPropagation()}
                    aria-label={`Estimate ${item.name} remaining`}
                    style={{ width: "100%", accentColor: sliderColor, marginBottom: sizes.length > 0 ? 10 : 0 }}
                  />
                )}

                {/* OTHERS USE — observation-learned suggestion chips
                    for PACKAGE SIZE. Sourced from popular_package_sizes
                    RPC (migration 0063), keyed on (brand, canonical).
                    Tapping a chip fills PACKAGE SIZE *and* QUANTITY
                    to that size — opening a fresh sealed package in
                    one tap. The chips surface in the QUANTITY section
                    because this is where the user looks first when
                    they open the card; a nudge toward "set a size so
                    the gauge works." */}
                {sizes.length > 0 && (
                  <div>
                    <div style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 9,
                      color: "#666", letterSpacing: "0.08em", marginBottom: 6,
                    }}>
                      OTHERS USE THIS SIZE
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {sizes.map((s, i) => {
                        const active = Number(s.amount) === Number(item.max) && (s.unit || "") === (item.unit || "");
                        return (
                          <button
                            key={`${s.amount}-${s.unit}-${s.brand || "_"}-${i}`}
                            onClick={e => {
                              e.stopPropagation();
                              // Chip tap = "open a fresh package of
                              // this size." Fills PACKAGE SIZE
                              // (max), inherits unit, AND sets
                              // QUANTITY to the same value so the
                              // row lands sealed at 100%.
                              const patch = {
                                max: Number(s.amount),
                                unit: s.unit || item.unit,
                                amount: Number(s.amount),
                              };
                              commit(patch);
                            }}
                            style={{
                              padding: "4px 10px",
                              background: active ? "#1a1608" : "transparent",
                              border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                              color: active ? "#f5c842" : "#aaa",
                              borderRadius: 14,
                              fontFamily: "'DM Mono',monospace", fontSize: 10,
                              letterSpacing: "0.04em", cursor: "pointer", whiteSpace: "nowrap",
                            }}
                          >
                            {s.amount} {s.unit}
                            {s.brand ? <span style={{ color: "#7eb8d4", marginLeft: 4 }}>· {s.brand}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* + 1 PACKAGE — duplicate this row in place. The grid then
              renders the pair as a stacked card (×2 + fan). Hidden
              when no onDuplicate handler is wired (read-only embeds). */}
          {onDuplicate && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", marginBottom: 12,
              background: "#0f0f0f", border: "1px solid #1e1e1e",
              borderRadius: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  color: "#f5c842", letterSpacing: "0.08em",
                }}>
                  STACKING
                </div>
                <div style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                  color: "#888", marginTop: 2,
                }}>
                  Add another identical {item.name} as its own row
                </div>
              </div>
              <button
                onClick={() => onDuplicate()}
                aria-label={`Duplicate ${item.name}`}
                style={{
                  padding: "8px 12px",
                  background: "#1a1608",
                  border: "1px solid #f5c84244",
                  borderRadius: 8,
                  fontFamily: "'DM Mono',monospace", fontSize: 11,
                  color: "#f5c842", letterSpacing: "0.06em",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                + 1 PACKAGE
              </button>
            </div>
          )}

          {/* Item-level enrichment CTA — always visible so the user has
              an explicit, unambiguous "enrich THIS item" affordance
              distinct from the per-ingredient button inside the embedded
              IngredientCard below.

              Why always visible: composed items (Hot Dog with tags
              [ground_pork, bread]) have the embedded IngredientCard
              default to tags[0] — its bottom "Add AI Enrichment" button
              targets that tag (ground_pork), not the item. If a user
              wanted Hot Dog metadata and clicked the bottom button they
              got ground_pork instead. This top button always enriches
              the ITEM's identity (canonical_id or slugified source
              name), and stays visible even after enrichment lands so
              re-enrichment is obvious.

              Label includes the item's identity so there's no ambiguity
              about which entity is being enriched. */}
          {onUpdate && (() => {
            // Prefer canonicalId — that's the stable key the write
            // path (EnrichmentButton, which stamps canonicalId before
            // requesting) and the admin approval path both agree on.
            // Falling back to slugify(item.name) was the old behavior
            // that caused enrichments to "detach" when the user edited
            // the item's name after triggering the request.
            const slug = item.canonicalId || slugifyIngredientName(item.name || "");
            if (!slug) return null;
            const itemIdentityName = currentCanonical?.name || item.name || "this item";
            // Approved info: ingredient_info is keyed by ingredient_id
            // which the admin sets to the item's canonicalId on
            // approve — look up by canonicalId OR the fallback slug
            // so items that pre-date the canonical-stamp fix still
            // read their enrichment.
            // Four-state metadata machine (v0.13.0). Replaces the
            // old binary approved/pending/none that treated every
            // _meta-only stub as "fully approved" — which hid the
            // enrichment button and made the row look complete
            // despite carrying zero real data.
            //
            //   "enriched" — info has real fields beyond _meta, no stub flag
            //   "pending"  — pending_ingredient_info row exists
            //   "stub"     — info exists but is just _meta (or _meta.stub=true)
            //   "none"     — no info row at all
            //
            // Both "stub" and "none" keep the EnrichmentButton visible
            // so the user can fill in a ghost-approved canonical.
            const dbInfo = getDbInfo(slug);
            const hasReal = isMeaningfullyEnriched(dbInfo);
            const hasPending = !!getPendingInfo(slug);
            const state = hasReal
              ? "enriched"
              : hasPending ? "pending"
              : dbInfo ? "stub"
              : "none";
            return (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", marginBottom: 12,
                background: "#0f0f0f",
                border: state === "none"
                  ? "1px dashed #2a2a2a"
                  : "1px solid #1e1e1e",
                borderRadius: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: state === "enriched" ? "#7ec87e"
                         : state === "pending"  ? "#f5c842"
                         : state === "stub"     ? "#f59e0b"
                         : "#888",
                    letterSpacing: "0.08em",
                  }}>
                    {state === "enriched" ? "METADATA ✓ ENRICHED"
                     : state === "pending"  ? "METADATA ✨ PENDING"
                     : state === "stub"     ? "METADATA · NEEDS ENRICHMENT"
                     : "NO METADATA YET"}
                  </div>
                  <div style={{
                    fontFamily: "'DM Sans',sans-serif", fontSize: 11,
                    color: "#666", fontStyle: "italic", marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {state === "enriched"
                      ? `Enriched — locked in`
                      : state === "pending"
                        ? `Awaiting admin review`
                        : state === "stub"
                          ? `Stub only — fill in to enable packaging + grouping`
                          : item.canonicalId
                            ? `Enrich ${itemIdentityName}`
                            : `Link a canonical to enrich — item names aren't used`}
                  </div>
                </div>
                {/* Enrichment is a one-shot per canonical. We show the
                    button when there's NO info yet ("none") AND when
                    the row is a stub (exists but empty). Hide on
                    "pending" (already drafted, avoid clobbering) and
                    "enriched" (done; re-firing wastes credits).

                    IMPORTANT — enrichment is ONLY fired when the row
                    has a real canonical_id. The old sourceName
                    fallback slugified the user's display name into a
                    fake canonical ("Cane Sugar" → "cane_sugar") and
                    passed that to Claude, which then described the
                    ITEM NAME rather than a real canonical entity.
                    User-visible result: enrichment for "Cane Sugar
                    Organic Fair Trade" was literally about that exact
                    string, not the underlying sugar canonical. Per
                    user directive: item names should never be used to
                    calculate the AI summary.

                    Without a canonical, we show a "link first" CTA
                    instead of the enrich button. Tapping it opens the
                    LinkIngredient picker (via onEditTags) so the user
                    can bind a real canonical; enrichment auto-fires
                    when a new canonical is minted (see
                    LinkIngredient.createNewFromQuery), and when a
                    bundled canonical is picked, the bundled seed
                    already carries the description. */}
                {(state === "none" || state === "stub") && (
                  item.canonicalId ? (
                    <EnrichmentButton canonicalId={item.canonicalId} compact />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onEditTags?.()}
                      disabled={!onEditTags}
                      style={{
                        padding: "6px 12px",
                        background: "#1a1608",
                        border: "1px solid #f5c84244",
                        color: "#f5c842",
                        borderRadius: 8,
                        fontFamily: "'DM Mono',monospace", fontSize: 11,
                        letterSpacing: "0.06em",
                        cursor: onEditTags ? "pointer" : "not-allowed",
                        display: "inline-flex", alignItems: "center", gap: 6,
                      }}
                    >
                      🔗 LINK CANONICAL FIRST
                    </button>
                  )
                )}
              </div>
            );
          })()}


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
            // Tappable provenance chevron is gated on the VIEWER being
            // allowed to open the linked artifact. The check: is the
            // item's owner the viewer, in the viewer's family, or
            // unknown (legacy rows pre-ownerId). An out-of-scope owner
            // means we render the text but NO chevron and NO onClick —
            // the receipt must never enter the viewer's view of the
            // app, not even as a flashing "not yours" card.
            const ownerId = item?.ownerId;
            const ownerInScope = !ownerId
              || ownerId === userId
              || familyIds.includes(ownerId);
            const canOpen = !!(prov.linkTo && onOpenProvenance && ownerInScope);
            const As = canOpen ? "button" : "div";
            return (
              <As
                onClick={canOpen ? () => onOpenProvenance({ ...prov.linkTo, ownerId }) : undefined}
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
        {/* Embedded IngredientCard — now scoped STRICTLY to the item's
            CANONICAL identity (item.canonicalId) so the preview below
            is about the ITEM, not whichever tag happens to be first.
            Composed items still render the COMPONENTS section above
            instead. If there's no canonical yet, fall back to the old
            active-tag behavior so non-canonical items still get SOMETHING
            to look at. Rendered in `preview` mode — compact description
            + "SEE FULL DETAILS" toggle, heavy sections hidden until the
            user explicitly expands. Keeps the outer ItemCard focused
            on the item. */}
        {(() => {
          if (isComposed) return null;
          const isCanonicalEmbed = Boolean(item.canonicalId);
          const embedId = item.canonicalId
            || activeTag?.id
            || (item.name ? slugifyIngredientName(item.name) : null);
          if (!embedId) return null;
          const embedFallbackEmoji =
            currentCanonical?.emoji
            || activeTag?.canonical?.emoji
            || item.emoji
            || "🥫";
          return (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                margin: "8px 0 4px", color: "#444",
              }}>
                <div style={{ flex: 1, height: 1, background: "#242424" }} />
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7eb8d4", letterSpacing: "0.15em" }}>
                  INFORMATION
                </div>
                <div style={{ flex: 1, height: 1, background: "#242424" }} />
              </div>
              <IngredientCard
                key={embedId}
                ingredientId={embedId}
                fallbackName={item.name}
                fallbackEmoji={embedFallbackEmoji}
                pantry={pantry}
                onClose={onClose}
                embedded
                preview
                {...(!isCanonicalEmbed
                  ? { sourceName: item.name, pantryItemId: item.id }
                  : {})}
              />
            </>
          );
        })()}

        {/* Delete from kitchen — subtle red-outlined button at the very
            bottom of the card so it's easy to find but doesn't compete
            with primary actions. Protected rows (keepsakes flagged via
            migration 0044) hide the button entirely; the DB delete
            policy would reject anyway, but not rendering at all is
            clearer than tapping and getting nothing. Actual
            confirmation lives in Kitchen's deleteCandidate modal so
            the user sees name + amount + location before committing. */}
        {onDelete && !item?.protected && (
          <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px dashed #222" }}>
            <button
              onClick={onDelete}
              style={{
                width: "100%", padding: "12px",
                background: "transparent",
                border: "1px solid #3a1a1a",
                color: "#d77777", borderRadius: 10,
                fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
                letterSpacing: "0.1em",
                cursor: "pointer",
              }}
            >
              🗑  REMOVE FROM KITCHEN
            </button>
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
            // Existing items can fall BACK to the heuristic auto-
            // router — "I don't want to pick one, infer from the
            // canonical / components." Scan-confirm rows deliberately
            // don't expose this; the auto-router there would just
            // re-stamp the original guess.
            allowClear
            onPick={(tileId, location) => {
              // Clearing (tileId=null) is a valid outcome — sets
              // tile_id back to null so the renderer falls through
              // to the heuristic classifier. Location stays put
              // unless the picker handed back an explicit change.
              commit({
                tileId: tileId || null,
                ...(location && location !== item.location
                    ? { location }
                    : {}),
              });
              setTilePickerOpen(false);
            }}
          />
        </ModalSheet>
      )}

      {/* STATE picker — was an inline grid that pushed the quantity
          row down every time the user tapped STATE. Stacked sheet now;
          same write path (commit({state})) so clearing + re-picking
          stays atomic. */}
      {editingField === "state" && (() => {
        const states = statesForItem(item) || [];
        if (states.length === 0) return null;
        return (
          <ModalSheet
            onClose={() => setEditingField(null)}
            zIndex={Z.picker}
            label="STATE"
            maxHeight="60vh"
          >
            <h2 style={{
              fontFamily: "'Fraunces',serif", fontSize: 22,
              fontStyle: "italic", color: "#f0ece4",
              fontWeight: 400, margin: "2px 0 10px",
            }}>
              What form is it in?
            </h2>
            <p style={{
              fontFamily: "'DM Sans',sans-serif", fontSize: 12,
              color: "#888", lineHeight: 1.5, margin: "0 0 14px",
            }}>
              Pick the physical state of {item.name}. Tap the current
              state to clear it.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {states.map(s => {
                const active = item.state === s;
                return (
                  <button
                    key={s}
                    onClick={() => commit({ state: active ? null : s })}
                    style={{
                      padding: "12px 8px",
                      background: active ? "#0f1620" : "#141414",
                      color: active ? "#7eb8d4" : "#ccc",
                      border: `1px solid ${active ? "#7eb8d4" : "#2a2a2a"}`,
                      borderRadius: 10,
                      fontFamily: "'DM Mono',monospace", fontSize: 11,
                      letterSpacing: "0.05em", cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                  >
                    {stateLabel(s)}
                  </button>
                );
              })}
            </div>
            {item.state && (
              <button
                onClick={() => commit({ state: null })}
                style={{
                  width: "100%", padding: "12px", marginTop: 14,
                  background: "transparent", border: "1px solid #3a1a1a",
                  color: "#ef4444", borderRadius: 10,
                  fontFamily: "'DM Mono',monospace", fontSize: 11,
                  letterSpacing: "0.08em", cursor: "pointer",
                }}
              >
                CLEAR STATE
              </button>
            )}
          </ModalSheet>
        );
      })()}

      {/* CANONICAL picker — stacked modal over the ItemCard. Was an
          inline expander under the CANONICAL line; shifting the card's
          layout every time the user tapped the line killed eye-tracking
          on the other fields, so it moved into a sheet that stacks on
          top without displacing anything below. */}
      {canonicalPickerOpen && onUpdate && (
        <ModalSheet
          onClose={() => { setCanonicalPickerOpen(false); setCanonicalSearch(""); }}
          zIndex={Z.picker}
          label="CANONICAL"
          maxHeight="85vh"
        >
          {(() => {
            const q = canonicalSearch.trim().toLowerCase();
            const matches = q
              ? INGREDIENTS.filter(i =>
                  i.name.toLowerCase().includes(q) ||
                  (i.shortName && i.shortName.toLowerCase().includes(q)) ||
                  i.id.includes(q.replace(/\s+/g, "_"))
                ).slice(0, 60)
              : INGREDIENTS.slice(0, 24);
            const qTrim = canonicalSearch.trim();
            const exactInRegistry = qTrim && matches.some(m =>
              m.name.toLowerCase() === q ||
              m.id === slugifyIngredientName(qTrim)
            );
            const showCreate = qTrim.length >= 2 && !exactInRegistry;
            const createNew = () => {
              const slug = slugifyIngredientName(canonicalSearch);
              if (!slug) return;
              // Mirror canonical into components when empty (v0.13.0).
              // See the search-picker button above for rationale.
              const existing = Array.isArray(item.components)
                ? item.components.filter(Boolean)
                : [];
              const patch = { canonicalId: slug };
              if (existing.length === 0) patch.components = [slug];
              commit(patch);
              // v0.13.0: we used to write a bare {_meta} stub to
              // ingredient_info here so admins didn't see PENDING on
              // their own creations. That produced ghost-approved
              // rows downstream — the enrichment button hid, package
              // chips never rendered, hub grouping broke. No more
              // stubs. The pantry row's canonical_id stamp alone is
              // enough identity; the enrichment button stays visible
              // so the user can opt into filling the canonical's
              // info later.
              setCanonicalPickerOpen(false);
              setCanonicalSearch("");
            };
            return (
              <>
                <h2 style={{
                  fontFamily: "'Fraunces',serif", fontSize: 22,
                  fontStyle: "italic", color: "#f0ece4",
                  fontWeight: 400, margin: "2px 0 10px",
                }}>
                  What's the canonical?
                </h2>
                <p style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                  color: "#888", lineHeight: 1.5, margin: "0 0 14px",
                }}>
                  Pick the final-resting identity of {item.name}. Or
                  type a name that's not in the list to create your own.
                </p>
                <input
                  autoFocus
                  value={canonicalSearch}
                  onChange={(e) => setCanonicalSearch(e.target.value)}
                  placeholder="Search canonicals (avocado, garlic, nori…)"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 12px", marginBottom: 10,
                    background: "#0f0f0f", border: "1px solid #2a2a2a",
                    borderRadius: 10,
                    fontFamily: "'DM Sans',sans-serif", fontSize: 14,
                    color: "#f0ece4", outline: "none",
                  }}
                />
                {matches.length === 0 && !showCreate ? (
                  <div style={{
                    padding: "24px 6px", textAlign: "center",
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#555", letterSpacing: "0.08em",
                  }}>
                    NO MATCHES
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {showCreate && (
                      <button
                        onClick={createNew}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 12px", textAlign: "left",
                          background: "#1a1508",
                          border: "1px dashed #b8a878",
                          borderRadius: 10, cursor: "pointer",
                        }}
                      >
                        <span style={{ fontSize: 18 }}>✨</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontFamily: "'DM Mono',monospace", fontSize: 12,
                            color: "#b8a878", letterSpacing: "0.08em",
                          }}>
                            + CREATE “{qTrim}”
                          </div>
                          <div style={{
                            fontFamily: "'DM Mono',monospace", fontSize: 9,
                            color: "#6e6458", letterSpacing: "0.06em", marginTop: 2,
                          }}>
                            NEW CANONICAL — ENRICH LATER
                          </div>
                        </div>
                      </button>
                    )}
                    {matches.map(ing => {
                      const isCurrent = currentCanonical?.id === ing.id;
                      return (
                        <button
                          key={ing.id}
                          onClick={() => {
                            // Canonical-to-components mirror (v0.13.0).
                            // When the row has no composition tagged
                            // (the common "single-ingredient product"
                            // case), stamp the canonical into
                            // components too so the hub grouper +
                            // recipe matcher can both read from
                            // components without a second lookup.
                            // Multi-ingredient rows (user explicitly
                            // tagged) keep their existing composition
                            // untouched.
                            const existing = Array.isArray(item.components)
                              ? item.components.filter(Boolean)
                              : [];
                            const patch = { canonicalId: ing.id };
                            if (existing.length === 0) patch.components = [ing.id];
                            commit(patch);
                            setCanonicalPickerOpen(false);
                            setCanonicalSearch("");
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "10px 12px", textAlign: "left",
                            background: isCurrent ? "#1a1608" : "#0f0f0f",
                            border: `1px solid ${isCurrent ? "#f5c842" : "#1e1e1e"}`,
                            borderRadius: 10, cursor: "pointer",
                          }}
                        >
                          <span style={{ fontSize: 18 }}>{ing.emoji || "🏷️"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: "'Fraunces',serif", fontSize: 14,
                              fontStyle: "italic",
                              color: isCurrent ? "#f5c842" : "#d4c9ac",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {ing.name}
                            </div>
                            <div style={{
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              color: "#555", letterSpacing: "0.06em", marginTop: 2,
                            }}>
                              {ing.id}
                              {ing.category && ` · ${ing.category.toUpperCase()}`}
                            </div>
                          </div>
                          {isCurrent && (
                            <span style={{ fontSize: 11, color: "#f5c842", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em" }}>
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
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
          label="CATEGORY"
          maxHeight="85vh"
        >
          <h2 style={{
            fontFamily: "'Fraunces',serif", fontSize: 22,
            fontStyle: "italic", color: "#f0ece4",
            fontWeight: 400, margin: "2px 0 10px",
          }}>
            What category does {item.name} belong to?
          </h2>
          <p style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
            color: "#888", lineHeight: 1.5, margin: "0 0 14px",
          }}>
            We've loaded the largest USDA categories for you to choose from.
            Category drives the state picker (sliced / ground / whole / …)
            and the default tile — pick the one that best matches.
          </p>
          <TypePicker
            userId={userId}
            selectedTypeId={item.typeId || null}
            // Only star a suggestion when no type is set yet
            // (re-pickers have explicit intent). Bound canonical is
            // the authority — starrs via typeIdForCanonical first,
            // falls back to free-text name inference.
            suggestedTypeId={
              item.typeId
                ? null
                : typeIdForCanonical(item.canonicalId ? findIngredient(item.canonicalId) : null)
                  || inferFoodTypeFromName(item.name)
            }
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
              // Canonical stays untouched on a Food Category pick.
              // Category is the broad classification (Pasta), canonical
              // is the specific identity (Cavatappi) — they're
              // orthogonal. Picking "Pasta" as the category should NOT
              // rewrite a more-specific canonical already set by name
              // match or the user's explicit pick; changing canonical
              // is done via the CANONICAL tap line + inline picker.
              commit(patch);
              setTypePickerOpen(false);
            }}
          />
        </ModalSheet>
      )}

      {/* Floating UPDATE bar — appears any time the card has staged
          changes that haven't been applied yet. Sticks to the bottom
          of the viewport above the tab bar so it's always reachable
          while the user scrolls through the card. DISCARD is the
          escape hatch; UPDATE commits everything in one write.
          z-index picked to sit strictly between Z.card (the
          ItemCard itself) and Z.picker (LinkIngredient and other
          sub-pickers that open on top). Any sub-picker should cover
          this footer so its own content isn't clipped — previous
          zIndex: 350 let the footer bleed through a LinkIngredient
          sheet and hide its + CREATE row. */}
      {hasPending && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: Z.card + 1,
          maxWidth: 480, margin: "0 auto",
          padding: "10px 14px 14px",
          background: "linear-gradient(180deg, rgba(10,10,10,0) 0%, rgba(10,10,10,0.97) 30%)",
          display: "flex", gap: 8,
        }}>
          <button
            onClick={discardChanges}
            style={{
              flex: 1, padding: "14px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              color: "#888", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12,
              letterSpacing: "0.1em", cursor: "pointer",
            }}
          >
            DISCARD
          </button>
          <button
            onClick={applyChanges}
            style={{
              flex: 2, padding: "14px",
              background: "#7ec87e", border: "none",
              color: "#0a1a0a", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
              letterSpacing: "0.1em", cursor: "pointer",
            }}
          >
            UPDATE · {Object.keys(pendingChanges).length} CHANGE{Object.keys(pendingChanges).length === 1 ? "" : "S"}
          </button>
        </div>
      )}

      {/* Full-screen success after UPDATE commits. Lists every field
          that changed so the user confirms what they just approved
          was actually what they meant. Tap DONE to dismiss. */}
      {outcome && outcome.kind === "update_success" && (() => {
        const prettyLabel = (k) => {
          const map = {
            location: "LOCATION", tileId: "STORED IN", canonicalId: "CANONICAL",
            ingredientId: "CANONICAL", typeId: "CATEGORY", state: "STATE",
            amount: "QUANTITY", unit: "UNIT", expiresAt: "EXPIRES",
            ingredientIds: "INGREDIENTS", emoji: "EMOJI", name: "NAME",
          };
          return map[k] || k.toUpperCase();
        };
        const changedLabels = outcome.changed.map(prettyLabel);
        const locLabel = LOCATIONS.find(l => l.id === item.location)?.label || item.location;
        const locEmoji = LOCATIONS.find(l => l.id === item.location)?.emoji || "📦";
        return (
          <AddItemOutcome
            kind="success"
            title={`${item.name} updated`}
            body={`Saved: ${changedLabels.join(" · ")}`}
            destination={`${locEmoji} ${locLabel.toUpperCase()}`}
            primary={{
              label: "DONE",
              tone: "confirm",
              onClick: () => setOutcome(null),
            }}
          />
        );
      })()}

      {/* Exit warning on close-with-drafts. DISCARD AND CLOSE drops
          every staged change and closes; KEEP EDITING returns to
          the card so the user can commit properly. */}
      {outcome && outcome.kind === "exit_warning" && (
        <AddItemOutcome
          kind="exit_warning"
          title="You have unsaved changes"
          body={`${Object.keys(pendingChanges).length} edit${Object.keys(pendingChanges).length === 1 ? "" : "s"} staged on ${item.name}. Closing now drops them.`}
          primary={{
            label: "KEEP EDITING",
            tone: "confirm",
            onClick: () => setOutcome(null),
          }}
          secondary={{
            label: "DISCARD AND CLOSE",
            onClick: () => {
              setPendingChanges({});
              setOutcome(null);
              onClose?.();
            },
          }}
        />
      )}

      {/* Brand chooser sheet — opens when user taps "+ ADD BRAND".
          Two paths: type it manually (defers to the existing inline
          edit flow) or scan a barcode (opens BarcodeScanner, pulls
          brand + optional product name from OFF, writes the row's
          brand + the brand_nutrition row so the chip can resolve
          nutrition from the new brand tier). Backdrop dismisses. */}
      {brandChooserOpen && (
        <div
          onClick={() => setBrandChooserOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 220,
            background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 480,
              background: "#141414",
              borderTop: "1px solid #2a2a2a",
              borderRadius: "16px 16px 0 0",
              padding: "20px 20px 28px",
              display: "flex", flexDirection: "column", gap: 10,
            }}
          >
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 10,
              color: "#888", letterSpacing: "0.12em", marginBottom: 4,
            }}>
              ADD BRAND
            </div>
            <button
              type="button"
              disabled={brandScanBusy}
              onClick={() => { setBrandChooserOpen(false); startEdit("brand"); }}
              style={brandChooserBtnStyle}
            >
              <span style={{ fontSize: 20 }}>✏️</span>
              <span style={{ flex: 1, textAlign: "left" }}>
                <span style={brandChooserTitleStyle}>Type brand name</span>
                <span style={brandChooserBlurbStyle}>
                  Inline input. For when the brand's easy to read off the package.
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={brandScanBusy}
              onClick={() => { setBrandChooserOpen(false); setBrandScannerOpen(true); }}
              style={brandChooserBtnStyle}
            >
              <span style={{ fontSize: 20 }}>📷</span>
              <span style={{ flex: 1, textAlign: "left" }}>
                <span style={brandChooserTitleStyle}>Scan barcode</span>
                <span style={brandChooserBlurbStyle}>
                  Pulls brand + product name + nutrition from Open Food Facts.
                </span>
              </span>
            </button>
            <button
              onClick={() => setBrandChooserOpen(false)}
              style={{
                marginTop: 6, padding: "10px",
                background: "transparent", border: "1px solid #2a2a2a",
                color: "#888", borderRadius: 10,
                fontFamily: "'DM Mono',monospace", fontSize: 10,
                letterSpacing: "0.08em", cursor: "pointer",
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* BarcodeScanner overlay for the brand-scan path. On decode,
          patches the row's brand (always) and name (if current name
          reads as generic / short / looks receipt-auto-generated) and
          writes the brand_nutrition row when we have a canonical id
          to pin against. Skips the write path silently when canonical
          is null — user needs to set CANONICAL separately; toast
          explains. */}
      {brandScannerOpen && (
        <BarcodeScanner
          onCancel={() => setBrandScannerOpen(false)}
          onDetected={async (barcode) => {
            setBrandScannerOpen(false);
            setBrandScanBusy(true);
            try {
              const res = await lookupBarcode(barcode, { brandNutritionRows });
              if (!res?.found) {
                const msg = res?.reason === "edge_fn_not_deployed"
                  ? "Scan edge function isn't deployed. Run: supabase functions deploy lookup-barcode"
                  : res?.reason === "fetch_failed"
                    ? `Barcode lookup failed (${res?.status || "network"}).`
                    : res?.reason === "no_nutriments"
                      ? `Found ${barcode} but Open Food Facts has no nutrition data for it.`
                      : `No match for ${barcode} in Open Food Facts.`;
                pushToast(msg, { emoji: "🔍", kind: "warn", ttl: 5500 });
                return;
              }
              // Build the patch for the row. Brand always, name only
              // when the current name looks receipt-auto-generated
              // (short, all-caps, abbreviated — the typical
              // "ACQUAMAR FLA" receipt-scan read). Users who typed
              // a deliberate name keep it.
              const patch = {};
              if (res.brand) patch.brand = res.brand;
              if (res.productName && looksReceiptGenerated(item.name)) {
                patch.name = res.productName;
              }
              if (Object.keys(patch).length > 0) {
                onUpdate?.(patch);
              }
              // Write brand_nutrition when we can — needs a canonical
              // to pin against. If canonical is null, we still set
              // brand on the row above so the user can assign
              // canonical later and the nutrition will resolve from
              // brand_nutrition once both are set.
              const canonId = item.ingredientId || item.canonicalId || null;
              const brandForWrite = res.brand;
              if (res.cached) {
                pushToast("Already in the nutrition database.", { emoji: "💾", kind: "info", ttl: 3500 });
              } else if (canonId && brandForWrite && res.nutrition) {
                await upsertBrandNutrition({
                  canonicalId: canonId,
                  brand:       brandForWrite,
                  nutrition:   res.nutrition,
                  barcode:     res.barcode,
                  source:      res.source || "openfoodfacts",
                  sourceId:    res.sourceId || res.barcode,
                });
                pushToast(`Nutrition saved for ${brandForWrite}.`, { emoji: "✨", kind: "success", ttl: 3500 });
              } else if (!canonId) {
                pushToast(`Brand set to ${brandForWrite}. Assign a canonical to pin nutrition to it.`, { emoji: "🏷️", kind: "info", ttl: 5000 });
              } else {
                pushToast(`Brand set to ${brandForWrite}.`, { emoji: "✨", kind: "success", ttl: 3500 });
              }
            } catch (e) {
              console.error("[itemcard] brand scan failed:", e);
              pushToast("Scan lookup failed. Try again.", { emoji: "⚠️", kind: "warn", ttl: 4500 });
            } finally {
              setBrandScanBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

// Heuristic: does this pantry name look auto-generated by a receipt
// scanner rather than a human? Short + no lowercase + abbreviations
// are all signals. "ACQUAMAR FLA" / "CHOBANI YGT" / "KROGER CKN BRST"
// vs "Homemade pasta sauce" / "my leftover chicken". When true we
// feel OK overwriting with OFF's cleaner product_name; when false
// the user deliberately typed the name and we leave it alone.
function looksReceiptGenerated(name) {
  if (!name) return true;                  // null name → fill in
  const n = String(name).trim();
  if (!n) return true;
  if (n.length > 40) return false;         // long name → definitely user-typed
  // All-caps or near-all-caps is the strongest receipt tell.
  const lowerCount = (n.match(/[a-z]/g) || []).length;
  const upperCount = (n.match(/[A-Z]/g) || []).length;
  if (upperCount >= 3 && lowerCount === 0) return true;
  return false;
}

// Brand chooser sheet button styles — shared between the two options
// so they visually read as peers (type vs scan), not primary/secondary.
const brandChooserBtnStyle = {
  display: "flex", alignItems: "center", gap: 12,
  padding: "14px 14px",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  borderRadius: 12, cursor: "pointer",
  textAlign: "left",
};
const brandChooserTitleStyle = {
  display: "block",
  fontFamily: "'Fraunces',serif", fontSize: 16, fontStyle: "italic",
  color: "#f0ece4", fontWeight: 400,
};
const brandChooserBlurbStyle = {
  display: "block", marginTop: 2,
  fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888",
  lineHeight: 1.4,
};

// Nutrition chip — compact macro line + expandable detail. Runs
// through `pantryItemNutrition` so brand/override/canonical resolution
// stays consistent across every surface. When no resolver tier fires
// (unknown state), the chip simply hides — the scan affordance to
// fill the gap lives behind "+ ADD BRAND" in the identity stack, not
// as a standalone CTA here (keeps the nutrition band uncluttered and
// one discoverable entry point for data enrichment).
function NutritionChip({ item, getInfo, getBrandNutrition, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  // Wrap the brand-lookup function in a Map-like shape so the resolver
  // can stay signature-agnostic (accepts any `.get(key)`-shaped thing).
  const brandNutritionMap = useMemo(() => ({ get: (k) => getBrandNutrition?.(k) || null }), [getBrandNutrition]);
  const { nutrition, source, brand } = pantryItemNutrition(
    {
      ingredientId: item?.ingredientId || item?.canonicalId || null,
      brand: item?.brand || null,
      nutritionOverride: item?.nutritionOverride || null,
    },
    { getInfo, brandNutrition: brandNutritionMap },
  );
  if (!nutrition) return null;
  const badge = sourceBadge(source);
  const per = nutrition.per === "100g" ? "per 100g"
            : nutrition.per === "count" ? "per item"
            : nutrition.per === "serving" && nutrition.serving_g ? `per ${nutrition.serving_g}g serving`
            : "";
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        onClick={() => setExpanded(x => !x)}
        style={{
          width: "100%", padding: "10px 12px",
          background: "#141414",
          border: "1px solid #242424",
          borderRadius: 10,
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 16 }}>🔥</span>
        <span style={{
          flex: 1,
          fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4",
        }}>
          {formatMacros(nutrition)}
        </span>
        {per && (
          <span style={{
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            color: "#777", letterSpacing: "0.08em",
          }}>
            {per.toUpperCase()}
          </span>
        )}
        {badge.label && (
          <span style={{
            fontFamily: "'DM Mono',monospace", fontSize: 8, fontWeight: 700,
            color: badge.color, background: `${badge.color}15`,
            border: `1px solid ${badge.color}55`,
            padding: "2px 6px", borderRadius: 6,
            letterSpacing: "0.1em",
          }}>
            {badge.label}
            {brand ? ` · ${brand}` : ""}
          </span>
        )}
        <span style={{ color: "#555", fontFamily: "'DM Mono',monospace", fontSize: 11 }}>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div style={{
          marginTop: 6, padding: "10px 12px",
          background: "#0f0f0f", border: "1px solid #1e1e1e",
          borderRadius: 10,
          display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8,
        }}>
          <MacroCell label="CALORIES" value={nutrition.kcal}     unit="kcal" />
          <MacroCell label="PROTEIN"  value={nutrition.protein_g} unit="g" />
          <MacroCell label="CARBS"    value={nutrition.carb_g}    unit="g" />
          <MacroCell label="FAT"      value={nutrition.fat_g}     unit="g" />
          {typeof nutrition.fiber_g   === "number" && <MacroCell label="FIBER"  value={nutrition.fiber_g}   unit="g"  />}
          {typeof nutrition.sugar_g   === "number" && <MacroCell label="SUGAR"  value={nutrition.sugar_g}   unit="g"  />}
          {typeof nutrition.sodium_mg === "number" && <MacroCell label="SODIUM" value={nutrition.sodium_mg} unit="mg" />}
        </div>
      )}
    </div>
  );
}

function MacroCell({ label, value, unit }) {
  return (
    <div style={{
      padding: "6px 8px",
      background: "#161616", border: "1px solid #252525",
      borderRadius: 8,
    }}>
      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 8,
        color: "#666", letterSpacing: "0.1em",
      }}>
        {label}
      </div>
      <div style={{
        marginTop: 2,
        fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#f0ece4",
      }}>
        {typeof value === "number" ? Math.round(value * 10) / 10 : "—"}
        {typeof value === "number" && (
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", marginLeft: 4 }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
