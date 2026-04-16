import { useState, useRef, useMemo, useEffect } from "react";
import {
  INGREDIENTS, HUBS,
  findIngredient, findHub, hubForIngredient,
  membersOfHub, standaloneIngredients,
  unitLabel, inferUnitsForScanned, toBase,
  estimatePriceCents, getIngredientInfo, estimateExpirationDays,
  stateLabel, statesForIngredient, detectStateFromText,
  inferCanonicalFromName,
} from "../data/ingredients";
import { supabase } from "../lib/supabase";
import { useMonthlySpend } from "../lib/useMonthlySpend";
import { defaultLocationForCategory } from "../lib/usePantry";
import { compressImage } from "../lib/compressImage";
import { daysUntilExpiration, expirationColor, formatDaysUntil, formatPrice } from "../lib/pantryFormat";
import { CONFIDENCE_STYLES, SCAN_MODES, confidenceStyle } from "../lib/scanModes";
import { useToast } from "../lib/toast";
import { FRIDGE_TILES, tileIdForItem as fridgeTileIdForItem } from "../lib/fridgeTiles";
import { PANTRY_TILES, pantryTileIdForItem } from "../lib/pantryTiles";
import { FREEZER_TILES, freezerTileIdForItem } from "../lib/freezerTiles";

// Tab → ({ tiles, classify }) dispatch. One place to add a new tile set
// — the render path below reads entirely off this.
function tilesForTab(tab) {
  if (tab === "fridge")  return { tiles: FRIDGE_TILES,  classify: fridgeTileIdForItem };
  if (tab === "pantry")  return { tiles: PANTRY_TILES,  classify: pantryTileIdForItem };
  if (tab === "freezer") return { tiles: FREEZER_TILES, classify: freezerTileIdForItem };
  return { tiles: null, classify: null };
}
import IdentifiedAsPicker from "./IdentifiedAsPicker";
import TypePicker from "./TypePicker";
import { FOOD_TYPES, findFoodType, inferFoodTypeFromName, canonicalIdForType } from "../data/foodTypes";
import { bumpTypeUse } from "../lib/userTypes";
import IngredientCard from "./IngredientCard";
import ItemCard from "./ItemCard";
import LinkIngredient from "./LinkIngredient";
import ModalSheet from "./ModalSheet";
import ReceiptView from "./ReceiptView";
import ReceiptHistoryModal from "./ReceiptHistoryModal";
import { Z } from "../lib/tokens";
import { bumpTileUse } from "../lib/userTiles";
import { inferTileFromName } from "../lib/tileKeywords";
import {
  setComponentsForParent,
  componentsFromIngredientIds,
  kindForTagCount,
} from "../lib/pantryComponents";
import {
  saveTemplateFromCustomAdd,
  setComponentsForTemplate,
  findTemplateMatch,
  bumpTemplateUse,
} from "../lib/userTemplates";
import { useUserTemplates } from "../lib/useUserTemplates";

// Compact registry shape we send to the scan-receipt Edge Function. The model
// needs just enough to emit correct `ingredientId` + unit values; units are
// stringified to their ids only (the Claude prompt doesn't need toBase math).
const INGREDIENTS_FOR_SCAN = INGREDIENTS.map(i => ({
  id: i.id,
  name: i.name,
  category: i.category,
  units: i.units.map(u => u.id),
}));

// Order in which category sections appear in the picker's hub grid.
const CATEGORY_ORDER = ["meat", "dairy", "produce", "pantry", "dry", "frozen"];
// Display labels — raw category IDs aren't always friendly ("produce" →
// "Fruits & Veggies"). Falls back to the uppercased id.
const CATEGORY_LABELS = {
  meat:    "MEAT",
  dairy:   "DAIRY",
  produce: "FRUITS & VEGGIES",
  pantry:  "PANTRY",
  dry:     "DRY",
  frozen:  "FROZEN",
};

// Category options used in the "Add item" form.
const ADD_CATEGORIES = [
  { id:"dairy",   label:"🥛 Dairy"   },
  { id:"produce", label:"🥬 Produce" },
  { id:"dry",     label:"🌾 Dry"     },
  { id:"pantry",  label:"🫙 Pantry"  },
  { id:"meat",    label:"🍗 Meat"    },
  { id:"frozen",  label:"🧊 Frozen"  },
];

const DEDUCTION_EXAMPLE = {
  dish: "Brown Butter Pasta", emoji: "🍝",
  deductions: [
    { name:"Unsalted Butter", used:0.5, unit:"sticks" },
    { name:"Parmesan",        used:0.25,unit:"cup" },
    { name:"Spaghetti",       used:8,   unit:"oz" },
  ]
};

const pct  = item => Math.min((item.amount / item.max) * 100, 100);
const isLow      = item => item.amount <= item.lowThreshold;
const isCritical = item => item.amount <= item.lowThreshold * 0.5;
const barColor   = item => isCritical(item) ? "#ef4444" : isLow(item) ? "#f59e0b" : "#4ade80";

// ── Expiration meter helpers (Phase 5a) ────────────────────────────────────
// The pantry shows a second, thinner bar underneath the amount bar — a
// running-time meter that fills from the day of purchase down to expiration.
// Colors are absolute by days-remaining (not percent): home cooks care about
// "is this still good THIS WEEK", not "is this at 60% of its shelf life".
// daysUntilExpiration, formatDaysUntil, expirationColor — moved to
// src/lib/pantryFormat.js so the extracted Scanner component (and any
// future modules) can import them instead of duplicating. Legacy
// DAYS_MS constant lives there too.
// Meter fill percentage: days-remaining as fraction of total shelf life. Uses
// purchasedAt when available; falls back to a 14-day window so the bar still
// tells SOME story (decays visibly as the date approaches) when older rows
// only have expires_at but no purchase date.
const expirationPct = item => {
  const days = daysUntilExpiration(item);
  if (days == null) return 0;
  if (days < 0)     return 100; // past-due bar reads full-red
  const purchased = item.purchasedAt instanceof Date ? item.purchasedAt
                  : item.purchasedAt ? new Date(item.purchasedAt) : null;
  if (purchased && !Number.isNaN(purchased.getTime()) && item.expiresAt) {
    const total = (new Date(item.expiresAt).getTime() - purchased.getTime()) / DAYS_MS;
    if (total > 0) return Math.max(2, Math.min(100, (days / total) * 100));
  }
  // No purchase date to anchor against — show days remaining capped at 14.
  return Math.max(2, Math.min(100, (days / 14) * 100));
};
// Render a human-friendly unit string. For canonical items (with ingredientId)
// we map the stored unit id → label from the registry; for free-text items
// the stored unit is already a label.
const displayUnit = item => {
  const ing = findIngredient(item.ingredientId);
  return ing ? unitLabel(ing, item.unit) : item.unit;
};
const fmt = item => {
  const v = item.amount;
  return `${Math.round(v * 10) / 10} ${displayUnit(item)}`;
};

// Small price formatter: 429 → "$4.29", null → "".
// formatPrice moved to src/lib/pantryFormat.js alongside the
// expiration helpers so every renderer shares one source of truth.

// CONFIDENCE_STYLES, confidenceStyle, and SCAN_MODES all live in
// src/lib/scanModes.js now — imported at the top of this file.
// Keeping them in a separate module prepares the ground for the
// eventual Scanner component extraction.

// ── Scanner (fridge / pantry / receipt) ───────────────────────────────────────
function Scanner({ userId, onItemsScanned, onClose }) {
  const [mode, setMode] = useState("receipt");
  const [phase, setPhase] = useState("upload");

  // Family's user templates for scan-side matching (chunk 17b). When
  // the scanner returns a raw name that matches a template, we use
  // the template's identity (name, emoji, category, tile_id,
  // ingredient_ids) instead of the generic canonical registry match.
  // Templates win because they carry brand context + tile memory
  // the user already decided once.
  const [userTemplatesForScan] = useUserTemplates(userId);
  const [imageData, setImageData] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [scannedItems, setScannedItems] = useState([]);
  const [receiptMeta, setReceiptMeta] = useState({ store: null, date: null, totalCents: null });
  const [editingIdx, setEditingIdx] = useState(null);
  // Per-row editors for the confirm phase — each targets a single scan-item
  // index, null when closed. Name, expiration, and canonical-link pickers
  // don't stack (only one editor open at a time) but they're independent of
  // editingIdx (amount editor) so users can rapid-fire corrections.
  const [editingNameIdx, setEditingNameIdx] = useState(null);
  const [editingExpiryScanIdx, setEditingExpiryScanIdx] = useState(null);
  const [linkingScanIdx, setLinkingScanIdx] = useState(null);
  // Per-row pickers for FOOD CATEGORY (type) and STORED IN (tile)
  // during scan-confirm. OCR + heuristics are going to misfire — the
  // user needs to tap a chip and override without having to wait until
  // after STOCK → find the row in pantry → tap its chip there. Each
  // holds the index of the row being edited; null = closed.
  const [typingScanIdx, setTypingScanIdx] = useState(null);
  const [tilingScanIdx, setTilingScanIdx] = useState(null);
  // One-at-a-time "are you sure?" confirm on the ✕ reject button. Without
  // this gate a stray tap on "M&Ms" would quietly vaporize the row you
  // actually bought. Holds the id (not idx — idx drifts as siblings get
  // removed) of the row currently awaiting confirmation.
  const [confirmingRemoveId, setConfirmingRemoveId] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef();
  const activeMode = SCAN_MODES.find(m => m.id === mode) || SCAN_MODES[2];

  // One-shot patch helper for scan items. Same semantics as updatePantryItem
  // in the main component — shallow merge by index.
  const updateScanItem = (idx, patch) => setScannedItems(prev =>
    prev.map((item, i) => i === idx ? { ...item, ...patch } : item)
  );

  // Destructive remove — physically splices the row out of scannedItems so
  // the user's list visibly shrinks as they prune non-grocery lines
  // (batteries, gum, etc.). Paired with a two-tap confirm to prevent
  // accidentally nuking a row they actually bought.
  const removeScanItem = id => setScannedItems(prev => prev.filter(it => it.id !== id));

  // Propagate name / link corrections to other scan rows with the same
  // raw scanner read. Example: receipt shows "ACQUAMAR FLA" twice. User
  // relinks row 0 to Imitation Crab — row 1 should inherit the same
  // name + ingredient link + canonical id. Quantities (amount/unit) and
  // expiration are NEVER propagated — they're per-row even when the
  // same product repeats.
  const IDENTITY_KEYS = [
    "name", "ingredientId", "ingredientIds", "canonicalId",
    "emoji", "category", "tileId", "typeId", "kind",
  ];
  const propagateCorrection = (sourceIdx, patch) => setScannedItems(prev => {
    const source = prev[sourceIdx];
    if (!source) return prev;
    const rawKey = (source.scanRaw?.raw_name || source.name || "").trim().toLowerCase();
    const safePatch = {};
    for (const k of IDENTITY_KEYS) {
      if (k in patch) safePatch[k] = patch[k];
    }
    return prev.map((item, i) => {
      if (i === sourceIdx) return { ...item, ...patch };
      if (!rawKey) return item;
      const rowRaw = (item.scanRaw?.raw_name || item.name || "").trim().toLowerCase();
      if (rowRaw !== rawKey) return item;
      return { ...item, ...safePatch };
    });
  });

  const handleFile = async file => {
    if (!file) return;
    // Compress before anything else: the vision API call uses it, the
    // storage upload uses it, and the inline preview uses it. One
    // compression pass covers all three. A 3 MB phone photo typically
    // drops to 200-400 KB — a ~90% reduction — without visibly affecting
    // receipt OCR quality.
    //
    // Best-effort: if compression fails (old browser, corrupted image),
    // fall back to the raw file via FileReader so the scan still works,
    // just at full size.
    try {
      const compressed = await compressImage(file);
      if (compressed?.base64) {
        setImagePreview(`data:${compressed.mediaType};base64,${compressed.base64}`);
        setImageData({ base64: compressed.base64, mediaType: compressed.mediaType });
        setPhase("ready");
        const kb = Math.round((compressed.size || 0) / 1024);
        if (kb > 0) console.debug(`[scan] compressed image to ~${kb} KB`);
        return;
      }
    } catch (e) {
      console.warn("[handleFile] compression threw, falling back to raw:", e?.message || e);
    }
    // Fallback — raw FileReader path (the original behavior).
    const reader = new FileReader();
    reader.onload = e => {
      setImagePreview(e.target.result);
      setImageData({ base64: e.target.result.split(",")[1], mediaType: file.type });
      setPhase("ready");
    };
    reader.readAsDataURL(file);
  };

  const runScan = async () => {
    setPhase("scanning"); setError(null);
    try {
      // Server-side call: Supabase forwards the caller's JWT, and the Edge
      // Function holds ANTHROPIC_API_KEY so it never ships to the browser.
      // Receipts go to scan-receipt (OCR + price extraction); fridge / pantry
      // photos go to scan-shelf (vision-based inventory + confidence tags).
      const fnName = activeMode.id === "receipt" ? "scan-receipt" : "scan-shelf";
      const { data, error: fnError } = await supabase.functions.invoke(fnName, {
        body: {
          image: imageData.base64,
          mediaType: imageData.mediaType,
          ingredients: INGREDIENTS_FOR_SCAN,
          // scan-shelf branches its system prompt on this; scan-receipt
          // ignores it but accepts it silently.
          location: activeMode.location,
        },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) {
        setError(
          activeMode.id === "receipt"
            ? "No grocery items found. Try a clearer photo."
            : `Couldn't make out anything in the ${activeMode.label.toLowerCase()}. Try a brighter photo.`
        );
        setPhase("ready");
        return;
      }

      setReceiptMeta({
        store: data?.store ?? null,
        date: data?.date ?? null,
        totalCents: typeof data?.totalCents === "number" ? data.totalCents : null,
      });

      // If the model matched a canonical ingredient, overlay the registry's
      // name/emoji/category so the confirm UI is consistent with the rest of
      // the app (and we know the unit is one of the valid ids).
      //
      // For items that DIDN'T match, the model sometimes falls back to
      // "1 count" for things that should be weighed (cheese, deli meat, etc.).
      // We lean on inferUnitsForScanned to pick sane units from emoji +
      // category and replace a nonsense "count" with oz/lb/fl_oz as appropriate.
      const normalized = items.map((item, i) => {
        // Template match first (chunk 17b). If the family has a
        // template whose normalized name matches this scan row, the
        // template's identity wins over the canonical registry match:
        // brand name preserved, tile_id inherited, ingredient_ids
        // carried forward. Canonical fuzzy falls through when no
        // template matches.
        const templateMatch = findTemplateMatch(item.name, userTemplatesForScan);
        const canon = findIngredient(item.ingredientId);
        const cat = canon ? canon.category : (item.category || "pantry");
        // Fridge/pantry scans force every item to that physical location.
        // Receipt scans don't know — prefer the ingredient registry's
        // storage.location when we have a canonical match (butter→fridge,
        // flour→pantry), then fall back to a category default.
        const regLocation = canon ? getIngredientInfo(canon)?.storage?.location : null;
        const location = activeMode.location || regLocation || defaultLocationForCategory(cat);
        // Confidence comes off the wire for scan-shelf; receipts don't carry
        // it (OCR is deterministic enough), so we treat them as "high" so the
        // confirm UI doesn't ask the user to second-guess every receipt row.
        const rawConf = item.confidence;
        const confidence =
          rawConf === "high" || rawConf === "medium" || rawConf === "low"
            ? rawConf
            : (activeMode.id === "receipt" ? "high" : "medium");
        // State detection — grocery receipts abbreviate heavily ("SHRD
        // MOZZ", "SLCD PROV"), and the scan text is the only place we can
        // recover that information before the canonical name substitution
        // wipes it out. Detection happens against the ORIGINAL scanner
        // name before we replace it with canon.name. The detected state
        // must match the ingredient's own state vocabulary — "WHL MILK"
        // won't set state=whole because milk has no state vocabulary,
        // just gets dropped as noise.
        const detectedState = canon
          ? detectStateFromText(item.name, canon)
          : null;
        // Provenance tag — activeMode.id is 'receipt' for receipt scans,
        // 'fridge' / 'pantry' / 'freezer' for pantry-shelf scans.
        const sourceKind = activeMode.id === "receipt" ? "receipt_scan" : "pantry_scan";
        // Raw scanner read — the text and metadata EXACTLY as the vision
        // API returned it, BEFORE canonical substitution / unit
        // inference / anything else. Stored verbatim so the ItemCard
        // can render "raw scan: SHRD MOZZ 8OZ" for sanity-checking.
        const scanRaw = {
          raw_name: item.name,
          confidence: rawConf || confidence,
          mode: activeMode.id,
          detected_state: detectedState || null,
          price_cents: typeof item.priceCents === "number" ? item.priceCents : null,
          amount_raw: item.amount != null ? String(item.amount) + (item.unit ? ` ${item.unit}` : "") : null,
          scanned_at: new Date().toISOString(),
        };
        const base = {
          ...item,
          name: canon ? canon.name : item.name,
          emoji: canon ? canon.emoji : (item.emoji || "🥫"),
          category: cat,
          location,
          confidence,
          priceCents: typeof item.priceCents === "number" ? item.priceCents : null,
          id: i,
          selected: true,
          sourceKind,
          scanRaw,
          ...(detectedState ? { state: detectedState } : {}),
        };
        if (!canon) {
          const inferred = inferUnitsForScanned(base);
          const validIds = inferred.units.map(u => u.id);
          // Keep the model's unit if it's in our inferred list; otherwise use default.
          if (!validIds.includes(base.unit)) base.unit = inferred.defaultUnit;
        }
        // Apply template override LAST — after canonical + unit
        // inference so we cleanly overwrite with the user's blessed
        // identity. The _templateId marker persists through scan
        // confirm so addScannedItems can bump use_count after
        // committing the pantry_items INSERT.
        if (templateMatch) {
          base.name = templateMatch.name;  // preserve user's brand casing
          if (templateMatch.emoji)    base.emoji    = templateMatch.emoji;
          if (templateMatch.category) base.category = templateMatch.category;
          if (templateMatch.tileId)   base.tileId   = templateMatch.tileId;
          if (templateMatch.defaultLocation) {
            base.location = templateMatch.defaultLocation;
          }
          if (Array.isArray(templateMatch.ingredientIds)
              && templateMatch.ingredientIds.length > 0) {
            base.ingredientIds = [...templateMatch.ingredientIds];
            base.ingredientId = templateMatch.ingredientIds[0];
            // Composed template -> scanned item will be kind='meal'
            // when it lands in pantry_items (kindForTagCount rule)
            base.kind = templateMatch.ingredientIds.length >= 2 ? "meal" : "ingredient";
          }
          if (templateMatch.defaultUnit && (!base.unit || base.unit === "count")) {
            base.unit = templateMatch.defaultUnit;
          }
          base._templateId = templateMatch.id;
          // Template propagates type_id too — user already picked it
          // before, inherit on every subsequent scan.
          if (templateMatch.typeId) base.typeId = templateMatch.typeId;
        }

        // IDENTIFIED AS + STORED IN auto-inference (chunk 18h). For
        // every scan row, infer a type from the name and (if the
        // type has a defaultTileId) a tile too. User confirms or
        // overrides on the scan-confirm screen via inline chips.
        // Template match takes priority — if base.typeId is already
        // set, don't overwrite.
        if (!base.typeId) {
          const inferredTypeId = inferFoodTypeFromName(base.name);
          if (inferredTypeId) {
            base.typeId = inferredTypeId;
            // Propagate type's default tile when the row has no tile
            // yet. Doesn't overwrite a template-set or context-set
            // tile.
            if (!base.tileId) {
              const td = findFoodType(inferredTypeId);
              if (td?.defaultTileId) base.tileId = td.defaultTileId;
            }
          }
        }
        return base;
      });
      setScannedItems(normalized);
      setPhase("confirm");
    } catch (err) {
      setError(err?.message || "Couldn't read the receipt. Try again.");
      setPhase("ready");
    }
  };

  const updateAmount = (idx,val) => setScannedItems(prev => prev.map((item,i) => i===idx ? {...item,amount:parseFloat(val)||0} : item));
  const updateUnit = (idx,val) => setScannedItems(prev => prev.map((item,i) => i===idx ? {...item,unit:val} : item));

  return (
    <div style={{ position:"fixed", inset:0, background:"#080808", zIndex:200, maxWidth:480, margin:"0 auto", display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>
      <div style={{ height:2, background:"#1a1a1a" }}>
        <div style={{ height:"100%", background:"#f5c842", width:`${({upload:5,ready:20,scanning:60,confirm:90,done:100}[phase]||5)}%`, transition:"width 0.4s ease" }} />
      </div>
      <div style={{ padding:"20px 20px 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#555", fontSize:20, cursor:"pointer" }}>←</button>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em" }}>{activeMode.badge}</div>
        <div style={{ width:28 }} />
      </div>

      {(phase === "upload" || phase === "ready") && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"24px 20px 40px" }}>
          {/* Mode picker — picking an icon determines what we're scanning,
              where the items will land, and (eventually) which prompt the
              edge function uses. Disabled while a photo is queued so the
              user can't accidentally re-bucket what they already lined up. */}
          <div style={{ display:"flex", gap:10, marginBottom:22 }}>
            {SCAN_MODES.map(m => {
              const active = m.id === mode;
              return (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  disabled={!!imagePreview}
                  style={{
                    flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6,
                    padding:"14px 6px",
                    background: active ? "#1e1a0e" : "#0f0f0f",
                    border: `1px solid ${active ? "#f5c842" : "#1e1e1e"}`,
                    borderRadius:14,
                    cursor: imagePreview ? "not-allowed" : "pointer",
                    opacity: imagePreview && !active ? 0.4 : 1,
                    transition:"all 0.2s",
                  }}
                >
                  <span style={{ fontSize:26 }}>{m.icon}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:600, letterSpacing:"0.08em", color: active ? "#f5c842" : "#666" }}>
                    {m.label.toUpperCase()}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ marginBottom:28 }}>
            <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:32, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>{activeMode.title}</h2>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#666" }}>{activeMode.blurb}</p>
          </div>
          <div onClick={() => fileRef.current?.click()} style={{ flex:1, border:`2px dashed ${imagePreview?"#f5c84255":"#2a2a2a"}`, borderRadius:20, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", background: imagePreview?"#0f0d08":"#0f0f0f", overflow:"hidden", position:"relative", minHeight:280, transition:"all 0.3s" }}>
            {imagePreview ? (
              <>
                <img src={imagePreview} alt="Receipt" style={{ width:"100%", height:"100%", objectFit:"contain", maxHeight:400 }} />
                <div style={{ position:"absolute", bottom:12, right:12, background:"#f5c842", borderRadius:8, padding:"6px 12px", fontFamily:"'DM Mono',monospace", fontSize:10, color:"#111", fontWeight:600 }}>TAP TO CHANGE</div>
              </>
            ) : (
              <>
                <div style={{ fontSize:48, marginBottom:16 }}>{activeMode.icon}</div>
                <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:"#555", fontStyle:"italic" }}>
                  Tap to upload {activeMode.id === "receipt" ? "receipt" : "photo"}
                </div>
                <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#444", marginTop:4 }}>Photo or screenshot works</div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])} />
          {error && <div style={{ marginTop:12, padding:"12px 14px", background:"#1a0f0f", border:"1px solid #3a1a1a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#f87171" }}>{error}</div>}
          <button onClick={imagePreview ? runScan : ()=>fileRef.current?.click()} style={{ marginTop:20, width:"100%", padding:"16px", background: imagePreview?"#f5c842":"#1a1a1a", color: imagePreview?"#111":"#444", border:"none", borderRadius:14, fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer", transition:"all 0.3s", boxShadow: imagePreview?"0 0 30px #f5c84233":"none" }}>
            {imagePreview ? activeMode.cta : "CHOOSE PHOTO"}
          </button>
        </div>
      )}

      {phase === "scanning" && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:40, textAlign:"center" }}>
          {imagePreview && (
            <div style={{ width:120, height:160, borderRadius:12, overflow:"hidden", marginBottom:28, position:"relative", border:"1px solid #2a2a2a" }}>
              <img src={imagePreview} alt="Scan" style={{ width:"100%", height:"100%", objectFit:"cover", filter:"brightness(0.4)" }} />
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div style={{ width:40, height:40, borderRadius:"50%", border:"3px solid #f5c842", borderTopColor:"transparent", animation:"spin 0.8s linear infinite" }} />
              </div>
            </div>
          )}
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:24, color:"#f0ece4", fontStyle:"italic", marginBottom:8 }}>
            {activeMode.id === "receipt" ? "Reading your receipt..." : `Reading your ${activeMode.label.toLowerCase()}...`}
          </div>
          <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#555" }}>
            {activeMode.id === "receipt" ? "Claude is scanning every item" : "Claude is cataloging what's in the photo"}
          </div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {phase === "confirm" && (() => {
        // Sort: low confidence first → medium → high. The user lands on the
        // rows that most need their attention without scrolling. Stable
        // within a confidence bucket so the receipt's natural order survives.
        const orderedItems = scannedItems
          .map((item, originalIdx) => ({ item, originalIdx }))
          .sort((a, b) => confidenceStyle(a.item.confidence).order - confidenceStyle(b.item.confidence).order);
        const lowCount = scannedItems.filter(i => i.confidence === "low").length;
        const medCount = scannedItems.filter(i => i.confidence === "medium").length;
        return (
        <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"20px 20px 40px", minHeight:0 }}>
          <div style={{ marginBottom:20, flexShrink:0 }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4ade80", letterSpacing:"0.15em", marginBottom:6 }}>✓ FOUND {scannedItems.length} ITEMS</div>
            <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:26, fontWeight:300, fontStyle:"italic", color:"#f0ece4" }}>Look right?</h2>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginTop:4 }}>
              {lowCount > 0
                ? `${lowCount} item${lowCount === 1 ? "" : "s"} need a closer look — start at the top.`
                : medCount > 0
                  ? "Yellow rows are best-guesses — tap to fix amount or unit."
                  : "Deselect anything wrong. Tap amounts to edit."}
            </p>
            {(receiptMeta.store || receiptMeta.date || receiptMeta.totalCents != null) && (
              <div style={{ marginTop:10, padding:"8px 12px", background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:8, display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                {receiptMeta.store && <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#f0ece4" }}>{receiptMeta.store}</span>}
                {receiptMeta.date && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>{receiptMeta.date}</span>}
                {receiptMeta.totalCents != null && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#f5c842", marginLeft:"auto" }}>{formatPrice(receiptMeta.totalCents)}</span>}
              </div>
            )}
            {/* Inline legend so users learn what the colors mean without us
                having to spell it out in copy on every row. */}
            <div style={{ marginTop:10, display:"flex", gap:8, flexWrap:"wrap" }}>
              {(["high","medium","low"]).map(level => {
                const s = confidenceStyle(level);
                const count = scannedItems.filter(i => (i.confidence || "medium") === level).length;
                if (count === 0) return null;
                return (
                  <span key={level} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 8px", background:s.bg, border:`1px solid ${s.border}`, borderRadius:20, fontFamily:"'DM Mono',monospace", fontSize:9, color:s.color, letterSpacing:"0.08em" }}>
                    <span style={{ width:6, height:6, borderRadius:"50%", background:s.color, display:"inline-block" }} />
                    {count} {s.label}
                  </span>
                );
              })}
            </div>
          </div>
          <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, minHeight:0, WebkitOverflowScrolling:"touch" }}>
            {orderedItems.map(({ item, originalIdx }) => {
              const idx = originalIdx;
              const canon = findIngredient(item.ingredientId);
              const unitDisplay = canon ? unitLabel(canon, item.unit) : item.unit;
              const conf = confidenceStyle(item.confidence);
              return (
                <div key={idx} style={{ position:"relative", display:"flex", alignItems:"stretch", gap:0, borderRadius:12, background: item.selected?"#161616":"#0f0f0f", border:`1px solid ${item.selected ? conf.border : "#1a1a1a"}`, opacity: item.selected?1:0.4, transition:"all 0.2s", overflow:"hidden", flexShrink:0 }}>
                  {/* Confidence accent stripe — reads at a glance whether to
                      trust the row, even before you read the name. */}
                  <div style={{ width:4, background: item.selected ? conf.color : "#222", flexShrink:0 }} />
                  {/* Remove ✕ — top-right, destructive. First tap arms a
                      confirm prompt; second tap on the red ✓ physically
                      splices the row out so the list shrinks. Cancel with
                      the gray ✕. The two-tap gate prevents a stray tap on
                      "M&Ms" from vaporizing a row the user actually
                      bought. */}
                  {confirmingRemoveId === item.id ? (
                    <div style={{ position:"absolute", top:6, right:6, display:"flex", alignItems:"center", gap:4, zIndex:3 }}>
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#ef4444", letterSpacing:"0.08em", marginRight:2 }}>REMOVE?</span>
                      <button
                        onClick={() => { removeScanItem(item.id); setConfirmingRemoveId(null); }}
                        aria-label={`Confirm remove ${item.name}`}
                        title="Yes, remove"
                        style={{ width:26, height:26, borderRadius:"50%", border:"none", background:"#ef4444", color:"#fff", fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, lineHeight:1, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
                      >✓</button>
                      <button
                        onClick={() => setConfirmingRemoveId(null)}
                        aria-label="Cancel remove"
                        title="Cancel"
                        style={{ width:26, height:26, borderRadius:"50%", border:"1px solid #333", background:"#0f0f0f", color:"#888", fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, lineHeight:1, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
                      >✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingRemoveId(item.id)}
                      aria-label={`Remove ${item.name}`}
                      title="Remove from list"
                      style={{ position:"absolute", top:6, right:6, width:24, height:24, borderRadius:"50%", border:"none", background:"transparent", color:"#777", fontFamily:"'DM Mono',monospace", fontSize:14, fontWeight:600, lineHeight:1, cursor:"pointer", zIndex:2, display:"flex", alignItems:"center", justifyContent:"center" }}
                    >✕</button>
                  )}
                  <div style={{ flex:1, display:"flex", alignItems:"flex-start", gap:12, padding:"14px 40px 14px 14px", minWidth:0 }}>
                  <span style={{ fontSize:28, flexShrink:0, lineHeight:1 }}>{item.emoji}</span>
                  <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:6 }}>
                    {/* Name — tap to rename. When editing, becomes a full-
                        width text input so you can retype the receipt's
                        garbled "ZITS CRACKERS" → "Ritz Crackers" or match
                        the canonical. Wraps when read-only. */}
                    {editingNameIdx === idx ? (
                      <input
                        type="text"
                        value={item.name}
                        autoFocus
                        onChange={e => updateScanItem(idx, { name: e.target.value })}
                        onBlur={() => {
                          // On commit, fan the rename out to any sibling rows
                          // with the same raw scanner read. Only applies the
                          // name (not amount/unit).
                          propagateCorrection(idx, { name: item.name });
                          setEditingNameIdx(null);
                        }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingNameIdx(null); }}
                        style={{ background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"6px 10px", color:"#f5c842", fontFamily:"'DM Sans',sans-serif", fontSize:16, outline:"none", width:"100%", boxSizing:"border-box" }}
                      />
                    ) : (
                      <button
                        onClick={() => setEditingNameIdx(idx)}
                        aria-label={`Rename ${item.name}`}
                        style={{ background:"transparent", border:"none", padding:0, textAlign:"left", fontFamily:"'DM Sans',sans-serif", fontSize:16, color:"#f0ece4", fontWeight:500, lineHeight:1.35, wordBreak:"break-word", cursor:"text" }}
                      >
                        {item.name}
                      </button>
                    )}

                    {/* Chip row — status + tappable corrections. LINK/RELINK
                        opens the fuzzy-match picker so misidentified rows
                        get fixed BEFORE landing in the pantry. Expiration
                        chip lets you type the date off the carton inline. */}
                    <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                      {canon ? (
                        <button
                          onClick={() => setLinkingScanIdx(idx)}
                          title="Tap to change which canonical ingredient this links to"
                          style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#4ade80", background:"#0f1a0f", border:"1px solid #1e3a1e", borderRadius:4, padding:"2px 6px", letterSpacing:"0.08em", cursor:"pointer" }}
                        >
                          ✓ {canon.name.toUpperCase()}
                        </button>
                      ) : (
                        <button
                          onClick={() => setLinkingScanIdx(idx)}
                          title="Tap to match this with a canonical ingredient"
                          style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#a3c9e0", background:"#0f1420", border:"1px solid #1e2a3a", borderRadius:4, padding:"2px 6px", letterSpacing:"0.08em", cursor:"pointer" }}
                        >
                          🔗 LINK
                        </button>
                      )}
                      <span
                        title={
                          item.confidence === "low"
                            ? "Low confidence — please double-check"
                            : item.confidence === "medium"
                              ? "Medium confidence — verify if needed"
                              : "High confidence"
                        }
                        style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:conf.color, background:conf.bg, border:`1px solid ${conf.border}`, borderRadius:4, padding:"2px 6px", letterSpacing:"0.08em" }}
                      >
                        {conf.label}
                      </span>

                      {/* Expiration — inline date picker when open, tappable
                          chip / "+ set expires" button otherwise. Saving
                          here persists through addScannedItems' merge — the
                          user-set date wins over the auto-estimate. */}
                      {editingExpiryScanIdx === idx ? (
                        <span
                          style={{ display:"inline-flex", alignItems:"center", gap:4 }}
                          onClick={e => e.stopPropagation()}
                        >
                          <input
                            type="date"
                            autoFocus
                            defaultValue={item.expiresAt
                              ? new Date(item.expiresAt).toISOString().slice(0, 10)
                              : ""}
                            onChange={e => {
                              const v = e.target.value;
                              if (!v) return;
                              updateScanItem(idx, { expiresAt: new Date(`${v}T12:00:00Z`) });
                            }}
                            onBlur={() => setEditingExpiryScanIdx(null)}
                            onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingExpiryScanIdx(null); }}
                            style={{ background:"#222", border:"1px solid #f5c842", borderRadius:4, padding:"1px 4px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:10, outline:"none" }}
                          />
                          {item.expiresAt && (
                            <button
                              onClick={() => { updateScanItem(idx, { expiresAt: null }); setEditingExpiryScanIdx(null); }}
                              aria-label="Clear expiration date"
                              style={{ background:"transparent", border:"none", color:"#666", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer", padding:"0 2px" }}
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ) : (() => {
                        const days = daysUntilExpiration(item);
                        if (days != null) {
                          const label = formatDaysUntil(days);
                          const color = expirationColor(days);
                          return (
                            <button
                              onClick={() => setEditingExpiryScanIdx(idx)}
                              aria-label={`Edit expiration date for ${item.name}`}
                              style={{ background:`${color}22`, border:"none", color, fontFamily:"'DM Mono',monospace", fontSize:9, padding:"2px 6px", borderRadius:4, cursor:"pointer", letterSpacing:"0.08em" }}
                            >
                              ⏳ {label}
                            </button>
                          );
                        }
                        return (
                          <button
                            onClick={() => setEditingExpiryScanIdx(idx)}
                            aria-label={`Set expiration date for ${item.name}`}
                            style={{ background:"transparent", border:"1px dashed #2a2a2a", color:"#666", fontFamily:"'DM Mono',monospace", fontSize:9, padding:"1px 6px", borderRadius:4, cursor:"pointer", letterSpacing:"0.08em" }}
                          >
                            + set expires
                          </button>
                        );
                      })()}

                      {/* FOOD CATEGORY chip — auto-inferred type, now
                          tappable. OCR and keyword inference will misfire
                          often (receipt says "ZITS CRACKERS" → auto-picks
                          Snack Chips when the user actually wants
                          Crackers); the user must be able to override
                          BEFORE stocking, not after. Tap opens TypePicker
                          in a ModalSheet. If no type was inferred, still
                          show a "+ set category" affordance so the user
                          isn't silently forced into a category. */}
                      {(() => {
                        const typeEntry = item.typeId ? findFoodType(item.typeId) : null;
                        return (
                          <button
                            onClick={() => setTypingScanIdx(idx)}
                            aria-label={typeEntry ? `Change food category (currently ${typeEntry.label})` : "Set food category"}
                            title={typeEntry ? `Food category: ${typeEntry.label} — tap to change` : "Tap to set food category"}
                            style={typeEntry ? {
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              color: "#f5c842", background: "#1a1608",
                              border: "1px solid #3a2f10",
                              borderRadius: 4, padding: "2px 6px",
                              letterSpacing: "0.08em", cursor: "pointer",
                            } : {
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              color: "#888", background: "transparent",
                              border: "1px dashed #2a2a2a",
                              borderRadius: 4, padding: "1px 6px",
                              letterSpacing: "0.08em", cursor: "pointer",
                            }}
                          >
                            {typeEntry
                              ? <>{typeEntry.emoji} {typeEntry.label.toUpperCase()}</>
                              : "+ set category"}
                          </button>
                        );
                      })()}

                      {/* STORED IN chip — tappable. Tile placement is
                          the single most likely thing to be wrong (OCR
                          doesn't know your fridge layout, and the
                          auto-classifier defaults to obvious tiles
                          like MEAT & POULTRY that may not match how
                          your family actually stores things). Tap
                          opens IdentifiedAsPicker in a ModalSheet.
                          Also shows a "+ set location" affordance
                          when nothing is inferred so the user can
                          place the row explicitly. User-created tiles
                          fall through to a generic label — resolved
                          at pantry-render time by the full lookup. */}
                      {(() => {
                        const allBuiltIns = [...FRIDGE_TILES, ...PANTRY_TILES, ...FREEZER_TILES];
                        const tileEntry = item.tileId ? allBuiltIns.find(t => t.id === item.tileId) : null;
                        return (
                          <button
                            onClick={() => setTilingScanIdx(idx)}
                            aria-label={tileEntry ? `Change location (currently ${tileEntry.label})` : item.tileId ? "Change location" : "Set location"}
                            title={tileEntry ? `Stored in ${tileEntry.label} — tap to change` : item.tileId ? "Tap to change location" : "Tap to set location"}
                            style={item.tileId ? {
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              color: "#7eb8d4", background: "#0f1620",
                              border: "1px solid #1f3040",
                              borderRadius: 4, padding: "2px 6px",
                              letterSpacing: "0.08em", cursor: "pointer",
                            } : {
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              color: "#888", background: "transparent",
                              border: "1px dashed #2a2a2a",
                              borderRadius: 4, padding: "1px 6px",
                              letterSpacing: "0.08em", cursor: "pointer",
                            }}
                          >
                            {item.tileId
                              ? <>→ {tileEntry ? `${tileEntry.emoji} ${tileEntry.label.toUpperCase()}` : "MY LOCATION"}</>
                              : "+ set location"}
                          </button>
                        );
                      })()}
                    </div>

                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#666", display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
                      <span>{(item.category || "").toUpperCase()}</span>
                      {item.priceCents != null && <span style={{ color:"#7ec87e" }}>{formatPrice(item.priceCents)}</span>}
                      {/* State picker — only surfaces when the canonical
                          ingredient has a state vocabulary (cheese, bread,
                          chicken, etc.). Pre-selects any code the scanner
                          detected from the receipt label (SHRD → shredded).
                          "—" is the explicit "no state" option. */}
                      {(() => {
                        const canonForState = findIngredient(item.ingredientId);
                        const states = statesForIngredient(canonForState);
                        if (!states || states.length === 0) return null;
                        return (
                          <select
                            value={item.state || ""}
                            onChange={e => updateScanItem(idx, { state: e.target.value || null })}
                            title="Physical state / form"
                            style={{
                              background: item.state ? "#0f1620" : "transparent",
                              border: `1px solid ${item.state ? "#1f3040" : "#2a2a2a"}`,
                              color: item.state ? "#7eb8d4" : "#888",
                              borderRadius: 4, padding: "1px 4px",
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              letterSpacing: "0.05em", cursor: "pointer",
                              outline: "none",
                            }}
                          >
                            <option value="" style={{ background: "#141414" }}>— STATE</option>
                            {states.map(s => (
                              <option key={s} value={s} style={{ background: "#141414" }}>
                                {stateLabel(s).toUpperCase()}
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </div>
                  </div>
                  {editingIdx === idx ? (
                    <div
                      style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0, marginTop:2 }}
                      onBlur={e => {
                        // Only close when focus leaves the entire editor — otherwise
                        // tapping the unit select kills the editor before it registers.
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          setEditingIdx(null);
                        }
                      }}
                    >
                      <input type="number" value={item.amount} onChange={e=>updateAmount(idx,e.target.value)} autoFocus
                        style={{ width:58, background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"6px 8px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:13, textAlign:"right", outline:"none" }} />
                      {(() => {
                        // Canonical items use their registry units; everything
                        // else gets category/emoji-inferred units so the user
                        // actually has something to pick from.
                        const units = canon ? canon.units : inferUnitsForScanned(item).units;
                        return (
                          <select value={item.unit} onChange={e=>updateUnit(idx,e.target.value)}
                            style={{ background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"6px 6px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:12, outline:"none", appearance:"none", cursor:"pointer" }}>
                            {units.map(u => (
                              <option key={u.id} value={u.id} style={{ background:"#141414" }}>{u.label}</option>
                            ))}
                          </select>
                        );
                      })()}
                    </div>
                  ) : (
                    <button onClick={()=>setEditingIdx(idx)} style={{ background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:8, padding:"6px 12px", fontFamily:"'DM Mono',monospace", fontSize:12, color:"#f5c842", cursor:"pointer", flexShrink:0, marginTop:2 }}>
                      {item.amount} {unitDisplay}
                    </button>
                  )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:16, padding:"12px 14px", background:"#0f1a0f", border:"1px solid #1e3a1e", borderRadius:10, flexShrink:0 }}>
            <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#7ec87e" }}>
              {scannedItems.length} item{scannedItems.length === 1 ? "" : "s"} will be added to your kitchen
            </span>
          </div>
          <button onClick={() => {
            // Pass imageData along so addScannedItems can upload the
            // original scan to Storage and link it to the receipt row.
            // Without this, the receipt row lands with image_path=null
            // and "TAP TO VIEW RECEIPT" has nothing to render.
            // Everything still in scannedItems is accepted — rejected rows
            // were physically spliced out via removeScanItem. No selection
            // filter needed.
            onItemsScanned(scannedItems, { ...receiptMeta, imageData });
            setPhase("done");
          }} style={{ marginTop:12, width:"100%", padding:"16px", background:"#f5c842", color:"#111", border:"none", borderRadius:14, fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer", flexShrink:0 }}>
            STOCK MY PANTRY →
          </button>
        </div>
        );
      })()}

      {phase === "done" && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:40, textAlign:"center" }}>
          <div style={{ fontSize:64, marginBottom:20, animation:"pop 0.5s ease" }}>🛒</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4ade80", letterSpacing:"0.15em", marginBottom:8 }}>PANTRY UPDATED</div>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:8 }}>All stocked up</h2>
          <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#666", marginBottom:40 }}>We'll track everything as you cook.</p>
          <button onClick={onClose} style={{ width:"100%", padding:"16px", background:"#f5c842", color:"#111", border:"none", borderRadius:14, fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, cursor:"pointer" }}>SEE MY PANTRY →</button>
          <style>{`@keyframes pop{0%{transform:scale(0.5);opacity:0}70%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}`}</style>
        </div>
      )}

      {/* Link-to-canonical picker for a scanned item. Same modal used in
          the pantry row, just sourced from the scan-item state instead of
          a persisted row. Linking here: sets ingredientId, adopts the
          canonical emoji + category so the row immediately reflects the
          correction. Name stays the user's typed text. */}
      {linkingScanIdx != null && scannedItems[linkingScanIdx] && (
        <LinkIngredient
          item={scannedItems[linkingScanIdx]}
          onLink={ids => {
            // Scan-draft commit. The row doesn't exist in pantry_items
            // yet — addScannedItems creates it on scan-confirm — so we
            // can't write component rows here (no parent id to point
            // at). We DO stamp kind='meal' | 'ingredient' onto the
            // draft so the user sees the Meal identity on the confirm
            // screen, and the flat ingredient_ids[] gets persisted as
            // usual on confirm. Component-row writes for
            // scan-originating Meals land in a follow-up once the
            // addScannedItems pipeline can surface the inserted row
            // ids back to a components-write step.
            const primaryId = ids[0] || null;
            const canon = primaryId ? findIngredient(primaryId) : null;
            // Propagate identity fields to sibling rows with the same
            // raw scanner read. Receipt "2 × ACQUAMAR FLA" → correcting
            // one row to Imitation Crab corrects the other automatically.
            // Amount/unit stay per-row.
            //
            // NAME is intentionally NOT overwritten. "Frank's Best Cheese
            // Dogs" stays as the display name after you link it to the
            // canonical hot_dog — the ItemCard already shows the canonical
            // as an IS-A subline, so the user's branded name survives the
            // correction. (Previous behavior stomped on the user's text
            // and was flagged as a bug.)
            propagateCorrection(linkingScanIdx, {
              ingredientId: primaryId,
              ingredientIds: ids,
              kind: kindForTagCount(ids.length),
              emoji:    canon?.emoji    || scannedItems[linkingScanIdx].emoji,
              category: canon?.category || scannedItems[linkingScanIdx].category,
            });
            setLinkingScanIdx(null);
          }}
          onClose={() => setLinkingScanIdx(null)}
        />
      )}

      {/* FOOD CATEGORY picker — wraps TypePicker in a ModalSheet so
          it can be reopened per scan row. Reuses the same picker the
          AddItemModal uses, so the UX is familiar from elsewhere.
          On pick we auto-fill STORED IN / location from the type's
          defaults ONLY when the row doesn't already have them set —
          same non-overwrite rule the add-item flow uses. Identity
          (canonical) auto-fills too unless the user already linked. */}
      {typingScanIdx != null && scannedItems[typingScanIdx] && (
        <ModalSheet onClose={() => setTypingScanIdx(null)} maxHeight="86vh">
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:10 }}>
            FOOD CATEGORY
          </div>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontStyle:"italic", color:"#f0ece4", fontWeight:400, margin:"0 0 14px", lineHeight:1.2 }}>
            What kind of thing is {scannedItems[typingScanIdx].name}?
          </h2>
          <TypePicker
            userId={userId}
            selectedTypeId={scannedItems[typingScanIdx].typeId}
            suggestedTypeId={inferFoodTypeFromName(scannedItems[typingScanIdx].name)}
            onPick={(typeId, defaultTileId, defaultLocation) => {
              const row = scannedItems[typingScanIdx];
              const patch = { typeId };
              if (defaultTileId && !row.tileId) patch.tileId = defaultTileId;
              if (defaultLocation && !row.location) patch.location = defaultLocation;
              if (!row.ingredientId) {
                const fromType = canonicalIdForType(typeId);
                if (fromType) {
                  patch.ingredientId = fromType;
                  patch.ingredientIds = [fromType];
                }
              }
              propagateCorrection(typingScanIdx, patch);
              setTypingScanIdx(null);
            }}
          />
        </ModalSheet>
      )}

      {/* STORED IN picker — same pattern, IdentifiedAsPicker wrapped
          in a ModalSheet. Tile placement propagates to sibling rows
          with the same raw scanner read (receipt "3 × CHOBANI" all
          land in the same fridge tile) but only when the user hasn't
          explicitly moved one of them already. */}
      {tilingScanIdx != null && scannedItems[tilingScanIdx] && (
        <ModalSheet onClose={() => setTilingScanIdx(null)} maxHeight="86vh">
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#7eb8d4", letterSpacing:"0.12em", marginBottom:10 }}>
            STORED IN
          </div>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontStyle:"italic", color:"#f0ece4", fontWeight:400, margin:"0 0 14px", lineHeight:1.2 }}>
            Where does {scannedItems[tilingScanIdx].name} live?
          </h2>
          <IdentifiedAsPicker
            userId={userId}
            locationHint={scannedItems[tilingScanIdx].location}
            selectedTileId={scannedItems[tilingScanIdx].tileId}
            suggestedTileId={inferTileFromName(scannedItems[tilingScanIdx].name)}
            onPick={(tileId, location) => {
              const patch = { tileId };
              if (location) patch.location = location;
              propagateCorrection(tilingScanIdx, patch);
              setTilingScanIdx(null);
            }}
          />
        </ModalSheet>
      )}
    </div>
  );
}

// Single-row picker button used in the AddItem modal's ingredient lists.
// `useShortName` is set when we're inside a hub drill so the row reads
// "Breast" / "Thigh" instead of "Chicken Breast" / "Chicken Thighs".
function IngredientRow({ ing, onPick, useShortName = false }) {
  const label = useShortName && ing.shortName ? ing.shortName : ing.name;
  return (
    <button
      onClick={() => onPick(ing)}
      style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"transparent", border:"none", borderBottom:"1px solid #1a1a1a", textAlign:"left", cursor:"pointer", color:"#ddd" }}
    >
      <span style={{ fontSize:20 }}>{ing.emoji}</span>
      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, flex:1 }}>{label}</span>
      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.08em" }}>{ing.category.toUpperCase()}</span>
    </button>
  );
}

// Full-height sheet shown when the user taps an ingredient from a drill-down.
// Gives them a chance to read up (description, flavor, pairings, recipes)
// before committing to add it. The yellow CTA at the bottom is the "pick"
// action — we promote detailIngredient → picked in the parent modal.
function IngredientDetailSheet({ ingredient, onClose, onAdd }) {
  const info = getIngredientInfo(ingredient);
  const hasContent = info && (info.description || info.flavorProfile || info.winePairings.length || info.recipes.length);
  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"#000000e6", zIndex:180, display:"flex", alignItems:"flex-end", maxWidth:480, margin:"0 auto" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width:"100%", background:"#141414", borderRadius:"20px 20px 0 0", padding:"24px 24px 32px", maxHeight:"90vh", overflowY:"auto", display:"flex", flexDirection:"column" }}
      >
        <div style={{ width:36, height:4, background:"#2a2a2a", borderRadius:2, margin:"0 auto 20px", flexShrink:0 }} />
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:18 }}>
          <span style={{ fontSize:52 }}>{ingredient.emoji}</span>
          <div style={{ flex:1, minWidth:0 }}>
            {ingredient.subcategory && (
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:4 }}>
                {ingredient.subcategory.toUpperCase()}
              </div>
            )}
            <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:26, color:"#f0ece4", fontWeight:300, fontStyle:"italic", margin:0 }}>
              {ingredient.name}
            </h2>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#666", fontSize:24, cursor:"pointer", padding:0, lineHeight:1 }}>×</button>
        </div>

        <div style={{ flex:1, overflowY:"auto", marginBottom:16 }}>
          {info?.description && (
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#bbb", lineHeight:1.55, marginTop:0, marginBottom:18 }}>
              {info.description}
            </p>
          )}

          {info?.flavorProfile && (
            <div style={{ marginBottom:18 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:8 }}>
                FLAVOR PROFILE
              </div>
              <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#ccc", lineHeight:1.5, margin:0 }}>
                {info.flavorProfile}
              </p>
            </div>
          )}

          {info?.winePairings?.length > 0 && (
            <div style={{ marginBottom:18 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:8 }}>
                WINE PAIRINGS
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {info.winePairings.map(w => (
                  <span key={w} style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#e7c9b0", background:"#2a1e18", border:"1px solid #3d2a20", borderRadius:20, padding:"5px 11px" }}>
                    🍷 {w}
                  </span>
                ))}
              </div>
            </div>
          )}

          {info?.recipes?.length > 0 && (
            <div style={{ marginBottom:18 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:8 }}>
                POPULAR RECIPES
              </div>
              <ul style={{ listStyle:"none", padding:0, margin:0, display:"flex", flexDirection:"column", gap:6 }}>
                {info.recipes.map(r => (
                  <li key={r} style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#ccc", padding:"8px 12px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:8 }}>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!hasContent && (
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", fontStyle:"italic", textAlign:"center", padding:"20px 0" }}>
              No details yet — but you can still add it to your kitchen.
            </p>
          )}
        </div>

        <button
          onClick={() => onAdd(ingredient)}
          style={{ width:"100%", padding:"16px", background:"#f5c842", color:"#111", border:"none", borderRadius:14, fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer", flexShrink:0 }}
        >
          + ADD TO KITCHEN
        </button>
      </div>
    </div>
  );
}

// ── Add Item Modal ────────────────────────────────────────────────────────────
// Two modes:
//   1. Canonical (default): pick a known ingredient from a searchable list.
//      Emoji/category auto-fill; the unit picker is the subset of units that
//      actually make sense for this ingredient. Saved with ingredientId so
//      recipes can match against it.
//   2. Custom: free-text fallback for ingredients not in the registry. These
//      save with ingredientId: null and won't be matched by any recipe.
// Short "last used" label for template rows in the recents list.
// "2h", "3d", "2w", "4mo" — compact enough to fit next to the
// use-count chip without wrapping. Returns empty string for null
// dates (new templates with no recency yet).
function formatAgo(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks}w`;
  const months = Math.round(days / 30);
  return `${months}mo`;
}

function AddItemModal({ target, tileContext, userId, onClose, onAdd }) {
  const [amount, setAmount] = useState("");

  // Tile-context boost: when the modal opens from a specific tile, we
  // prefer suggestions that classify into that tile. The filter is a
  // sort boost, not a hard filter — users can still pick anything, the
  // tile's items just float to the top.
  const fitsTile = (ing) => {
    if (!tileContext) return true;
    const fakeItem = { ingredientId: ing.id, category: ing.category };
    return tileContext.classify(fakeItem, { findIngredient, hubForIngredient }) === tileContext.tileId;
  };

  // Tile placement memory (migration 0036). When the modal opens from
  // a specific tile, we seed customTileId from the tileContext so the
  // save stamps the user's intent onto both the pantry item and the
  // template. Filling from a template overrides with the template's
  // remembered tile (so re-adds go where they went before, even if
  // the user opened from a different tile). fillFromCanonical leaves
  // it untouched — canonicals have no memory.
  const [customTileId, setCustomTileId] = useState(tileContext?.tileId || null);
  // Location override set alongside the tile pick. Tiles are inherently
  // scoped to a location (Pasta & Grains is pantry; Dairy & Eggs is
  // fridge); picking one via IdentifiedAsPicker sets both. Null falls
  // back to defaultLocationForCategory at save time.
  const [customLocation, setCustomLocation] = useState(tileContext?.tabId || null);
  // IDENTIFIED AS picker open/close — renders inline when expanded.
  const [tilePickerOpen, setTilePickerOpen] = useState(false);
  // IDENTIFIED AS (type) state — the "what kind of thing is this"
  // layer, separate from STORED IN (tile). Initialized from tileContext
  // when provided — some tile-contexts carry an implicit type hint
  // (Frozen Meals tab = plausibly Pizza/Meal items), but tile-to-type
  // is many-to-many so we don't force-seed. Primary seeding happens
  // via name-inference (18f inferFoodTypeFromName) as the user types.
  const [customTypeId, setCustomTypeId] = useState(null);
  // Canonical identity (0039) — the "final resting name" of the
  // thing. Separate from ingredient_ids[] composition. Auto-derived
  // on save if null (name-first, type-fallback); user can override
  // here via the CHANGE chip on the canonical line.
  const [customCanonicalId, setCustomCanonicalId] = useState(null);
  // Type picker expand/collapse state.
  const [typePickerOpen, setTypePickerOpen] = useState(false);

  // Custom-item fields. Name is the user's typed display name; unit +
  // category + components fill the rest of the identity. Picking a
  // canonical from the unified typeahead writes into these too.
  const [customName, setCustomName] = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const [customCategory, setCustomCategory] = useState("pantry");
  // Optional components for the custom item. Lets the user build a
  // "curry ketchup" inline by picking [ketchup, curry_powder] instead
  // of having to save the free-text row first and then link it later.
  // Zero-length = pure free-text ingredient; one = single-tagged
  // ingredient with a canonical reference for recipe matching; 2+ =
  // promotes to a composed Meal (kind='meal') on save with one
  // pantry_item_components row per canonical, same write path as 6c's
  // LinkIngredient commit.
  const [customComponents, setCustomComponents] = useState([]);
  // Whether the LinkIngredient picker is layered over the custom-add
  // flow. Scoped local because the picker needs to seed from
  // customComponents (so re-opening shows the current selection) and
  // commit back into this same state — the parent Pantry-level
  // linkingItem path isn't the right fit here since the item doesn't
  // exist yet.
  const [customComponentsOpen, setCustomComponentsOpen] = useState(false);

  // Family-shared user templates, newest-first. Empty until the user
  // (or any family member) saves their first custom item; grows as
  // real-life usage populates the recents ladder.
  const [userTemplates] = useUserTemplates(userId);
  // YOUR RECENTS search box (18i). Filters the family's templates by
  // substring match across name + components when present; otherwise
  // the list shows starred (useCount >= 2) pinned to top + a cap of
  // 5 total so users don't scroll through 30 rows to find last week's
  // "Mama Bear's Garden Fresh Green Onion". Typing bypasses the cap.
  const [recentsQuery, setRecentsQuery] = useState("");

  // Fill the custom form from a template. Called when the user taps
  // a row in "YOUR RECENTS". Name/emoji/category/unit/ingredientIds
  // land immediately; amount stays whatever the user had typed (if
  // anything) OR falls back to the template's default_amount — the
  // user almost always needs to type their actual count ("how many
  // Home Run Inn Pizzas did I actually buy this week?") so pre-
  // filling default_amount saves a tap but doesn't replace intent.
  // Components rebuild from the template's flat ingredient_ids via
  // componentsFromIngredientIds — position/amount/unit on individual
  // components resets to the defaults; the edge-level precision (if
  // the user wants to tweak "I used 30% of the salt jar") is a
  // per-cook concern, not a per-template one.
  // Fill the form from a canonical ingredient pick. The unified
  // typeahead offers both templates AND canonicals; this is the
  // canonical side. Sets the user's customName to the canonical's
  // display name, slots the canonical as the single component (so
  // the save path records it as a tagged ingredient with a valid
  // ingredient_id), and inherits the emoji + category + default unit.
  // Amount stays whatever the user had typed — they still need to
  // enter count even when the identity is resolved.
  const fillFromCanonical = (ing) => {
    if (!ing) return;
    setCustomName(ing.name || "");
    setCustomCategory(ing.category || "pantry");
    if (ing.defaultUnit) setCustomUnit(ing.defaultUnit);
    setCustomComponents([{ id: ing.id, canonical: ing }]);
  };

  const fillFromTemplate = (tpl) => {
    if (!tpl) return;
    setCustomName(tpl.name || "");
    if (tpl.defaultUnit)     setCustomUnit(tpl.defaultUnit);
    if (tpl.category)        setCustomCategory(tpl.category);
    if (tpl.defaultAmount != null && amount === "") {
      setAmount(String(tpl.defaultAmount));
    }
    // Inherit remembered tile (migration 0036). User's past
    // placement wins over whatever tile the modal opened from —
    // "I put Home Run Inn Pizza in Frozen Meals last time" carries
    // forward even if they're adding from a different tile today.
    if (tpl.tileId) setCustomTileId(tpl.tileId);
    if (tpl.typeId) setCustomTypeId(tpl.typeId);
    if (tpl.canonicalId) setCustomCanonicalId(tpl.canonicalId);
    // Rebuild the selected-components chips from the flat ingredient_ids.
    // findIngredient is imported at module scope.
    const rebuilt = (tpl.ingredientIds || [])
      .map(id => ({ id, canonical: findIngredient(id) }))
      .filter(c => c.canonical);
    setCustomComponents(rebuilt);
  };

  // Top-level picker view. If the user has typed a search, flatten everything
  // Save predicate. With the unified single flow, a save is valid
  // when there's a name, an amount, and a unit — the pieces of a
  // minimally-complete pantry row.
  const canSave = customName.trim() && amount !== "" && customUnit.trim();

  const save = async () => {
    if (!canSave) return;
    const amt = parseFloat(amount) || 0;

    // Custom-mode component scaffolding. When the user picked one or
    // more canonicals during the custom-add flow, promote the item
    // accordingly: single component -> tagged ingredient (ingredientId
    // set so recipes match); 2+ components -> Meal (kind='meal') with
    // an ingredient_ids[] union and component rows written after
    // insert (same write path as 6c's re-link).
    const compIds = customComponents.map(c => c.id);
    const primaryComp = customComponents[0] || null;

    // ── Canonical identity (18j — replaces 18h's ingredient_ids
    //    pollution). canonical_id is SEPARATE from composition —
    //    user-free ingredient_ids[] stays what's INSIDE the thing,
    //    canonical_id is WHAT THE THING IS. "Franks Best Cheese
    //    Dogs" has canonical_id='hot_dog' (identity) while
    //    ingredient_ids might be [cheddar, ground_pork] (composition).
    //    Pick the most-specific canonical we can derive:
    //      1. Name-based match beats type default — "Oscar Mayer
    //         Bratwurst" would prefer 'bratwurst' over wweia_sausages'
    //         default of 'sausage' (once bratwurst canonical exists)
    //      2. Type default as fallback — Food Category = Hot dogs
    //         → canonical_id = 'hot_dog' when the name has no
    //         more-specific token
    const canonicalId = customCanonicalId
      || inferCanonicalFromName(customName.trim())
      || canonicalIdForType(customTypeId)
      || null;

    // Unified save shape. Single-canonical picks, multi-canonical
    // composed meals, and pure free-text all land in the same payload —
    // components.length drives whether ingredientId is set, kind flips
    // to meal, or the row stays free-text.
    const item = {
      id: crypto.randomUUID(),
      // First picked component (if any) becomes the primary tag so the
      // legacy ingredient_id scalar stays useful. Zero components = pure
      // free-text.
      ingredientId: primaryComp?.id || null,
      // ingredientIds is the user's picked composition — what's
      // INSIDE the item. Identity (hot_dog) lands on canonical_id
      // below, not here.
      ingredientIds: compIds,
      canonicalId,
      // 2+ components promotes the item to a Meal on save; single or
      // zero stays an ingredient (either free-text or canonical-tagged).
      kind: compIds.length >= 2 ? "meal" : "ingredient",
      name: customName.trim(),
      // Inherit emoji from the primary canonical when one exists —
      // the 🥫 fallback is fine for truly un-tagged free text but
      // "Heinz Ketchup" reading as 🥫 when ketchup is in the registry
      // feels wrong.
      emoji: primaryComp?.canonical?.emoji || "🥫",
      amount: amt,
      unit: customUnit.trim(),
      max: Math.max(amt * 2, 1),
      category: customCategory,
      lowThreshold: Math.max(amt * 0.25, 0.25),
      // User's STORED IN (tile) placement — seeded from tileContext
      // on modal open, inherited from a filled template, set via the
      // STORED IN picker, or auto-suggested when a TYPE was picked
      // (type.defaultTileId applies). Classifier prefers this over
      // the heuristic at render time.
      tileId: customTileId || null,
      // IDENTIFIED AS (type) — what kind of thing this is. Can hold
      // a bundled WWEIA id ('wweia_pizza') or a user_types uuid.
      typeId: customTypeId || null,
      // Location paired with the tile pick. Null falls through to
      // Pantry's onAdd handler which derives from registry +
      // category. Setting it here gives picker-based placement
      // authority over the heuristic.
      ...(customLocation ? { location: customLocation } : {}),
    };

    onAdd(item);

    // Write the structured components tree after onAdd has kicked the
    // parent pantry_items INSERT. setComponentsForParent retries on
    // FK-violation so the race with the parent INSERT is self-healing.
    if (compIds.length >= 2) {
      await setComponentsForParent(item.id, componentsFromIngredientIds(compIds));
    }

    // Auto-save a user template. Strict per-family dedup: if a family
    // member already saved this name, the write upserts onto the
    // existing template (bumping use_count + refreshing last_used_at)
    // instead of creating a duplicate. Fire-and-forget from the user's
    // perspective — any failure logs but doesn't block the pantry_items
    // write, which is the user-facing intent.
    if (userId) {
      const { id: templateId, error: tmplErr } = await saveTemplateFromCustomAdd({
        userId: userId,
        name: customName.trim(),
        emoji: primaryComp?.canonical?.emoji || null,
        category: customCategory,
        unit: customUnit.trim(),
        amount: amt,
        location: customLocation || defaultLocationForCategory(customCategory),
        // Persist the tile (STORED IN) + type (IDENTIFIED AS) on the
        // template too. Next family member who types this name on
        // ANY tile context inherits the original author's placement
        // AND identification.
        tileId: customTileId || null,
        typeId: customTypeId || null,
        canonicalId,
        // Template composition == what the user actually picked.
        // Identity rides on canonical_id above, separate.
        ingredientIds: compIds,
      });
      if (!tmplErr && templateId && compIds.length > 0) {
        await setComponentsForTemplate(
          templateId,
          componentsFromIngredientIds(compIds)
        );
      }
    }

    // Bump use_count on user-created tiles + types. Built-in tiles
    // use string slugs ('pasta_grains') and built-in types use
    // 'wweia_*' slugs — both have no DB row. uuid-regex is the
    // discriminator. Fire-and-forget (bumpTypeUse is also internally
    // guarded; this check is for symmetry + early return).
    if (customTileId && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(customTileId)) {
      bumpTileUse(customTileId);
    }
    if (customTypeId) {
      bumpTypeUse(customTypeId);
    }

    onClose();
  };

  return (
    <>
    {/* CANCEL button at the bottom is the explicit dismiss, so we
        suppress ModalSheet's ✕. Form content scrolls inside the
        sheet; swipe-down-to-dismiss only activates at scrollTop=0
        (ModalSheet handles that guard internally). */}
    <ModalSheet
      onClose={onClose}
      zIndex={Z.modal}
      showClose={false}
      maxHeight="85vh"
    >
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:6 }}>
          {target === "shopping"
            ? "+ TO SHOPPING LIST"
            : tileContext
              ? `+ TO ${tileContext.tabId.toUpperCase()} · ${tileContext.tileLabel.toUpperCase()}`
              : "+ TO KITCHEN"}
        </div>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:24, color:"#f0ece4", fontWeight:300, fontStyle:"italic", marginBottom:14 }}>
          {tileContext
            ? `Add ${/^[aeiou]/i.test(tileContext.tileLabel) ? "an" : "a"} ${tileContext.tileLabel.toLowerCase()}`
            : "Add an ingredient"}
        </h3>

        {/* Tile-context banner — shown when the modal opened from a
            specific tile. Suggestions that classify into the tile float
            to the top of the search results; everything else is still
            fully searchable (no hard filter). */}
        {tileContext && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px",
            background: "#1e1a0e",
            border: "1px solid #f5c84233",
            borderRadius: 10,
            marginBottom: 14,
          }}>
            <span style={{ fontSize: 18 }}>{tileContext.tileEmoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize: 12, color: "#f0ece4" }}>
                Adding to {tileContext.tileLabel.toLowerCase()}
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.06em", marginTop: 2 }}>
                MATCHES FROM THIS TILE FLOAT TO THE TOP · STILL SEARCHABLE
              </div>
            </div>
          </div>
        )}

        {/* Mode toggle deleted in chunk 13a — AddItemModal became a
            single unified flow. Typeahead on the name input surfaces
            user templates AND canonical ingredients together, with
            tile-context boost. Canonical-browse drill-down is gone;
            search is the only discovery surface. */}
        <>
            {/* Custom mode — emoji is auto-assigned (🥫) since the picker
                rarely worked on iOS keyboards anyway. Users can change the
                name freely; the emoji stays consistent for custom items. */}

            {/* YOUR RECENTS — family-shared user templates. Layout (18i):
                  * Starred (useCount ≥ 2 — items the family actually
                    reaches for) pin to the top with a ⭐ badge
                  * Recents (everything else) fill under, newest first
                  * Capped at 5 visible rows when idle so the picker
                    doesn't become a wall of noise; typing in the
                    search box lifts the cap and filters across ALL
                    templates by name + component ids
                Hidden when the family has no templates yet (first-ever
                custom add on an account — a fresh home-kitchen). */}
            {userTemplates.length > 0 && (() => {
              const q = recentsQuery.trim().toLowerCase();
              const isSearching = q.length > 0;

              // Filter first if searching. Match against the display
              // name AND the component id slugs so "hot dog" finds
              // "Franks Best Cheese Dogs" via hot_dog in components.
              const matches = isSearching
                ? userTemplates.filter(tpl => {
                    const name = (tpl.name || "").toLowerCase();
                    if (name.includes(q)) return true;
                    const compHit = (tpl.ingredientIds || []).some(id =>
                      id.replace(/_/g, " ").toLowerCase().includes(q)
                    );
                    return compHit;
                  })
                : userTemplates;

              // Starred = used 2+ times. Lightweight heuristic for
              // "family staple" without a schema change — if the
              // family pulled it out of the recents ladder more than
              // once, it earned the pin. Sort starred by useCount desc,
              // tiebreak on recency (already sorted by last_used_at).
              const starred = matches
                .filter(t => (t.useCount || 0) >= 2)
                .sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
              const starredIds = new Set(starred.map(t => t.id));
              const rest = matches.filter(t => !starredIds.has(t.id));
              // Idle cap — 5 total across starred + rest. Searching
              // removes the cap (user is actively hunting).
              const ordered = [...starred, ...rest];
              const visible = isSearching ? ordered : ordered.slice(0, 5);
              const hiddenCount = ordered.length - visible.length;

              const renderRow = (tpl) => {
                const isStarred = (tpl.useCount || 0) >= 2;
                return (
                  <button
                    key={tpl.id}
                    onClick={() => fillFromTemplate(tpl)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px",
                      background: isStarred ? "#1a150a" : "transparent",
                      border: `1px solid ${isStarred ? "#f5c84233" : "transparent"}`,
                      borderRadius: 8, cursor: "pointer", textAlign: "left",
                    }}
                    onMouseOver={e => { e.currentTarget.style.background = "#141414"; e.currentTarget.style.borderColor = "#2a2a2a"; }}
                    onMouseOut={e => {
                      e.currentTarget.style.background = isStarred ? "#1a150a" : "transparent";
                      e.currentTarget.style.borderColor = isStarred ? "#f5c84233" : "transparent";
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{tpl.emoji || "🥫"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                        color: "#f0ece4",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        display: "flex", alignItems: "center", gap: 6,
                      }}>
                        {isStarred && <span style={{ fontSize: 11, flexShrink: 0 }}>⭐</span>}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tpl.name}
                        </span>
                      </div>
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 9,
                        color: "#666", letterSpacing: "0.06em", marginTop: 2,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {tpl.ingredientIds.length > 0
                          ? tpl.ingredientIds.slice(0, 4).map(id => id.replace(/_/g, " ").toUpperCase()).join(" · ")
                          : "NO COMPONENTS"}
                        {tpl.ingredientIds.length > 4 && ` · +${tpl.ingredientIds.length - 4}`}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 9,
                        color: "#f5c842", letterSpacing: "0.08em",
                      }}>
                        {tpl.useCount}×
                      </div>
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 8,
                        color: "#555", letterSpacing: "0.06em", marginTop: 1,
                      }}>
                        {formatAgo(tpl.lastUsedAt)}
                      </div>
                    </div>
                  </button>
                );
              };

              return (
                <div style={{ marginBottom: 14 }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: 8,
                  }}>
                    <div style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      color: "#7eb8d4", letterSpacing: "0.12em",
                    }}>
                      YOUR RECENTS · {userTemplates.length}
                    </div>
                    {starred.length > 0 && (
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 9,
                        color: "#f5c842", letterSpacing: "0.08em",
                      }}>
                        ⭐ {starred.length} STARRED
                      </div>
                    )}
                  </div>

                  {/* Search — filters across name + component ids.
                      Only shown when the family has enough templates
                      that scrolling starts to hurt. */}
                  {userTemplates.length > 3 && (
                    <div style={{ position: "relative", marginBottom: 6 }}>
                      <input
                        value={recentsQuery}
                        onChange={e => setRecentsQuery(e.target.value)}
                        placeholder="Search your recents…"
                        style={{
                          width: "100%", padding: "8px 12px",
                          background: "#0a0a0a",
                          border: "1px solid #1e1e1e",
                          borderRadius: 8,
                          fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                          color: "#f0ece4", outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                      {isSearching && (
                        <button
                          onClick={() => setRecentsQuery("")}
                          style={{
                            position: "absolute", right: 8, top: "50%",
                            transform: "translateY(-50%)",
                            background: "transparent", border: "none",
                            color: "#666", fontSize: 14, cursor: "pointer",
                            padding: "2px 6px",
                          }}
                          aria-label="Clear search"
                        >✕</button>
                      )}
                    </div>
                  )}

                  <div style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    maxHeight: isSearching ? 320 : 260,
                    overflowY: "auto",
                    padding: 4, background: "#0a0a0a",
                    border: "1px solid #1e1e1e", borderRadius: 10,
                  }}>
                    {visible.length === 0 ? (
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: "#555", letterSpacing: "0.08em",
                        padding: "14px 10px", textAlign: "center",
                      }}>
                        NO MATCHES FOR "{recentsQuery}"
                      </div>
                    ) : (
                      visible.map(renderRow)
                    )}
                  </div>

                  <div style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 9,
                    color: "#444", letterSpacing: "0.06em",
                    marginTop: 6, textAlign: "center",
                  }}>
                    {isSearching
                      ? `${visible.length} of ${userTemplates.length} templates`
                      : hiddenCount > 0
                        ? `SHOWING 5 · SEARCH TO FIND ${hiddenCount} MORE`
                        : "TAP A RECENT TO AUTO-FILL · OR KEEP TYPING FOR SOMETHING NEW"}
                  </div>
                </div>
              );
            })()}

            {/* Name input + typeahead. As the user types, filter the
                family's templates by substring match and surface a
                dropdown. Tap a suggestion -> fillFromTemplate (same
                handler as RECENTS). Exact-match gets a subtle
                "WILL MERGE INTO EXISTING" hint so the user knows
                saving bumps the existing template instead of making
                a dup — transparency around the strict-dedup rule. */}
            <div style={{ marginBottom:12, position:"relative" }}>
              <input
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="Name (e.g. Capers, Home Run Inn Pizza)"
                style={{ width:"100%", padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", outline:"none", boxSizing:"border-box" }}
              />

              {/* Live canonical preview (0039). Shows the derived
                  "thing" identity right under the user's custom
                  name so the distinction sinks in —
                    "Frank's Best Cheese Dogs"
                       → 🌭 Hot Dog
                  Name-match > type-default > nothing. Updates live
                  as the user types + picks a Food Category. Hidden
                  when there's no canonical yet (no need to surface
                  the absence). */}
              {(() => {
                const derived = customCanonicalId
                  || inferCanonicalFromName(customName.trim())
                  || canonicalIdForType(customTypeId)
                  || null;
                if (!derived) return null;
                const canon = findIngredient(derived);
                if (!canon) return null;
                return (
                  <div style={{
                    marginTop: 6,
                    display: "flex", alignItems: "center", gap: 8,
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#888", letterSpacing: "0.06em",
                  }}>
                    <span style={{ color: "#555" }}>→</span>
                    <span style={{ fontSize: 13 }}>{canon.emoji || "🏷️"}</span>
                    <span style={{
                      color: "#d4c9ac", fontFamily: "'Fraunces',serif",
                      fontSize: 13, fontStyle: "italic",
                    }}>
                      {canon.name}
                    </span>
                    <span style={{ color: "#444", fontSize: 9 }}>· IS-A</span>
                  </div>
                );
              })()}
              {(() => {
                const typed = (customName || "").trim().toLowerCase();
                if (!typed) return null;

                // Unified typeahead: merge user templates (family-shared
                // recurring items) AND canonical ingredients from the
                // bundled registry into one ranked list.
                //
                //   1. Template substring matches (family recurring
                //      items — highest priority, personal/social signal
                //      beats generic data)
                //   2. Canonical substring matches (the bundled
                //      registry; name OR shortName matches)
                //
                // Within each band, tile-context matches float first
                // (items that classify into the tile the user is
                // adding from). Exact normalized-name matches get an
                // EXACT MATCH hint regardless of band — tells the user
                // the save will merge into an existing template.
                const templateMatches = userTemplates
                  .filter(t => t.name.toLowerCase().includes(typed))
                  .slice(0, 8);
                const alreadyCovered = new Set(
                  templateMatches.flatMap(t => t.ingredientIds || [])
                );
                const canonicalMatches = INGREDIENTS
                  .filter(i =>
                    !alreadyCovered.has(i.id) &&
                    (i.name.toLowerCase().includes(typed) ||
                     (i.shortName && i.shortName.toLowerCase().includes(typed)))
                  );
                // Tile-context boost: sort matches that fit the tile
                // first within their band. Stable within each partition
                // so the registry's natural ordering is preserved.
                const canonicalSorted = [
                  ...canonicalMatches.filter(i => fitsTile(i)),
                  ...canonicalMatches.filter(i => !fitsTile(i)),
                ].slice(0, 8);

                const exactMatchTpl = templateMatches.find(t =>
                  t.nameNormalized === typed.replace(/\s+/g, " ")
                );
                const exactMatchCanon = !exactMatchTpl && canonicalSorted.find(i =>
                  i.name.toLowerCase() === typed
                );

                if (templateMatches.length === 0 && canonicalSorted.length === 0) {
                  return null;
                }

                return (
                  <div style={{
                    marginTop: 6,
                    background: "#0a0a0a", border: "1px solid #2a2a2a",
                    borderRadius: 10, padding: 4,
                    maxHeight: 320, overflowY: "auto",
                  }}>
                    {templateMatches.map(tpl => {
                      const isExact = exactMatchTpl && exactMatchTpl.id === tpl.id;
                      return (
                        <button
                          key={`tpl-${tpl.id}`}
                          onClick={() => fillFromTemplate(tpl)}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            width: "100%", padding: "7px 10px",
                            background: "transparent",
                            border: `1px solid ${isExact ? "#3a2f10" : "transparent"}`,
                            borderRadius: 8, cursor: "pointer", textAlign: "left",
                          }}
                          onMouseOver={e => { if (!isExact) e.currentTarget.style.background = "#141414"; }}
                          onMouseOut={e => { if (!isExact) e.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ fontSize: 16, flexShrink: 0 }}>{tpl.emoji || "🥫"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                              color: isExact ? "#f5c842" : "#f0ece4",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {tpl.name}
                            </div>
                            <div style={{
                              fontFamily: "'DM Mono',monospace", fontSize: 8,
                              color: "#7eb8d4", letterSpacing: "0.06em", marginTop: 1,
                            }}>
                              👤 YOURS · {isExact
                                ? "EXACT MATCH · WILL MERGE INTO THIS"
                                : `USED ${tpl.useCount}× · ${formatAgo(tpl.lastUsedAt)}`}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {/* Band separator — subtle hairline between the
                        personal (templates) and global (canonical)
                        bands. Skipped when either band is empty. */}
                    {templateMatches.length > 0 && canonicalSorted.length > 0 && (
                      <div style={{ height: 1, background: "#1a1a1a", margin: "4px 10px" }} />
                    )}
                    {canonicalSorted.map(ing => {
                      const isExact = exactMatchCanon && exactMatchCanon.id === ing.id;
                      const tileFit = tileContext ? fitsTile(ing) : false;
                      return (
                        <button
                          key={`ing-${ing.id}`}
                          onClick={() => fillFromCanonical(ing)}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            width: "100%", padding: "7px 10px",
                            background: "transparent",
                            border: `1px solid ${isExact ? "#3a2f10" : "transparent"}`,
                            borderRadius: 8, cursor: "pointer", textAlign: "left",
                          }}
                          onMouseOver={e => { if (!isExact) e.currentTarget.style.background = "#141414"; }}
                          onMouseOut={e => { if (!isExact) e.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ fontSize: 16, flexShrink: 0 }}>{ing.emoji || "🥫"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                              color: isExact ? "#f5c842" : "#f0ece4",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {ing.name}
                            </div>
                            <div style={{
                              fontFamily: "'DM Mono',monospace", fontSize: 8,
                              color: "#888", letterSpacing: "0.06em", marginTop: 1,
                            }}>
                              📖 INGREDIENT · {(ing.category || "").toUpperCase()}
                              {ing.subcategory && ` · ${ing.subcategory.toUpperCase()}`}
                              {tileFit && <span style={{ color: "#f5c842" }}>  · IN TILE</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div style={{ display:"flex", gap:10, marginBottom:12 }}>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Amount"
                style={{ flex:1, padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:14, color:"#f0ece4", outline:"none" }}
              />
              <input
                value={customUnit}
                onChange={e => setCustomUnit(e.target.value)}
                placeholder="Unit (oz, cup…)"
                style={{ flex:1, padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:14, color:"#f0ece4", outline:"none" }}
              />
            </div>

            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:20 }}>
              {ADD_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCustomCategory(c.id)}
                  style={{ background: customCategory===c.id?"#f5c842":"#1a1a1a", border:`1px solid ${customCategory===c.id?"#f5c842":"#2a2a2a"}`, borderRadius:20, padding:"7px 12px", fontFamily:"'DM Sans',sans-serif", fontSize:12, color: customCategory===c.id?"#111":"#888", cursor:"pointer" }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* IDENTIFIED AS section — what KIND of thing this is.
                Separate from STORED IN below which answers WHERE it
                lives. Most items have a clean type-to-tile mapping
                (Pizza → Frozen Meals, Cheese → Dairy) so picking a
                type here auto-suggests the tile below, BUT user can
                override either independently — the axes are
                orthogonal (Italian Blend is Cheese but might be
                stored in Frozen). */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  color: "#f5c842", letterSpacing: "0.12em",
                }}>
                  FOOD CATEGORY {customTypeId ? "" : "(OPTIONAL)"}
                </div>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setTypePickerOpen(v => !v)}
                  style={{
                    background: "transparent",
                    border: "1px solid #3a2f10",
                    padding: "4px 10px",
                    color: "#f5c842", cursor: "pointer",
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    letterSpacing: "0.1em", borderRadius: 6,
                  }}
                >
                  {typePickerOpen ? "HIDE" : (customTypeId ? "CHANGE" : "PICK")}
                </button>
              </div>

              {/* Current pick preview — bundled lookup is O(1); user
                  types show a generic label until the full picker
                  opens (rare; users usually see their own types). */}
              {!typePickerOpen && customTypeId && (() => {
                const bundled = findFoodType(customTypeId);
                const label = bundled?.label || "Custom type";
                const emoji = bundled?.emoji || "🏷️";
                return (
                  <div style={{
                    padding: "8px 12px",
                    background: "#1a1608", border: "1px solid #3a2f10",
                    borderRadius: 10,
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <span style={{ fontSize: 18 }}>{emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f5c842" }}>
                        {label}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {!typePickerOpen && !customTypeId && (
                <div style={{
                  padding: "10px 12px",
                  background: "#0a0a0a", border: "1px dashed #242424",
                  borderRadius: 10,
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666",
                  fontStyle: "italic", lineHeight: 1.5,
                }}>
                  What kind of thing is this? Pizza, Cheese, Sausages…
                  Helps recipes and drill-into-type later.
                </div>
              )}

              {typePickerOpen && (
                <TypePicker
                  userId={userId}
                  selectedTypeId={customTypeId}
                  suggestedTypeId={inferFoodTypeFromName(customName)}
                  onPick={(typeId, defaultTileId, defaultLocation) => {
                    setCustomTypeId(typeId);
                    // Auto-suggest STORED IN from the type's default
                    // UNLESS the user has already explicitly set a
                    // tile (don't overwrite their intent). Same for
                    // location.
                    if (defaultTileId && !customTileId) {
                      setCustomTileId(defaultTileId);
                    }
                    if (defaultLocation && !customLocation) {
                      setCustomLocation(defaultLocation);
                    }
                    // Auto-derive canonical identity from the type's
                    // default UNLESS the user already explicitly set
                    // one (name-match may have found something more
                    // specific). Name-match still wins at save time.
                    if (!customCanonicalId) {
                      const fromType = canonicalIdForType(typeId);
                      if (fromType) setCustomCanonicalId(fromType);
                    }
                    setTypePickerOpen(false);
                  }}
                />
              )}
            </div>

            {/* STORED IN section. Shows current tile placement
                (via built-in classifier for canonical picks, or
                user's explicit choice). Tap to expand the full
                picker inline. Users can also create new tiles from
                the picker's + CREATE NEW affordance. Purely optional —
                leaving untouched falls through to the heuristic
                classifier at render time, same as before tile memory
                existed. */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  color: "#f5c842", letterSpacing: "0.12em",
                }}>
                  STORED IN {customTileId ? "" : "(OPTIONAL)"}
                </div>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setTilePickerOpen(v => !v)}
                  style={{
                    background: "transparent",
                    border: "1px solid #3a2f10",
                    padding: "4px 10px",
                    color: "#f5c842", cursor: "pointer",
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    letterSpacing: "0.1em", borderRadius: 6,
                  }}
                >
                  {tilePickerOpen ? "HIDE" : (customTileId ? "CHANGE" : "PICK")}
                </button>
              </div>

              {/* Current pick preview — when a tile is chosen and the
                  picker is collapsed. Gives the user a read at a glance
                  without forcing expand. */}
              {!tilePickerOpen && customTileId && (() => {
                // Look up the label/emoji for a tile id. Built-ins are
                // in the three *_TILES arrays imported at module scope;
                // user tiles would require the hook which we don't want
                // inside a preview closure. Fall through to a generic
                // "✓ TILE SET" when we can't resolve (user tile, live
                // picker has the real data).
                const allBuiltIns = [...FRIDGE_TILES, ...PANTRY_TILES, ...FREEZER_TILES];
                const found = allBuiltIns.find(t => t.id === customTileId);
                return (
                  <div style={{
                    padding: "8px 12px",
                    background: "#1a1608", border: "1px solid #3a2f10",
                    borderRadius: 10,
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <span style={{ fontSize: 18 }}>{found?.emoji || "🗂️"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f5c842" }}>
                        {found?.label || "Custom tile"}
                      </div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#888", letterSpacing: "0.06em", marginTop: 2 }}>
                        {customLocation ? customLocation.toUpperCase() : "LOCATION TBD"}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Collapsed + no pick = quiet invitation. The heuristic
                  classifier will route at render time — this is just
                  an affordance to override when the user knows better. */}
              {!tilePickerOpen && !customTileId && (
                <div style={{
                  padding: "10px 12px",
                  background: "#0a0a0a", border: "1px dashed #242424",
                  borderRadius: 10,
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666",
                  fontStyle: "italic", lineHeight: 1.5,
                }}>
                  We'll route this to a tile based on components. Tap PICK to place it somewhere specific.
                </div>
              )}

              {/* Expanded picker — inline, scrollable list of tiles +
                  CREATE NEW. Picking auto-collapses so the form stays
                  focused on what's next. */}
              {tilePickerOpen && (
                <IdentifiedAsPicker
                  userId={userId}
                  locationHint={customLocation}
                  selectedTileId={customTileId}
                  // Keyword-inferred suggestion. Recomputed inline from
                  // the current customName so the highlighted chip
                  // updates as the user types. Nothing auto-selects —
                  // the user still taps, we just rank the most likely
                  // tile first with a ⭐ SUGGESTED treatment.
                  suggestedTileId={inferTileFromName(customName)}
                  onPick={(tileId, location) => {
                    setCustomTileId(tileId);
                    if (location) setCustomLocation(location);
                    setTilePickerOpen(false);
                  }}
                />
              )}
            </div>

            {/* Components builder. Lets the user construct a composed
                custom item ("Curry Ketchup" = [ketchup, curry_powder,
                coriander]) inline during add, instead of saving a
                free-text row first and linking it after. Optional —
                zero components keeps the row free-text. */}
            <div style={{ marginBottom: 16 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
              }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#7eb8d4", letterSpacing:"0.12em" }}>
                  COMPONENTS · {customComponents.length}
                </div>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setCustomComponentsOpen(true)}
                  style={{
                    background: "transparent", border: "1px solid #3a2f10",
                    padding: "4px 10px",
                    color: "#f5c842", cursor: "pointer",
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    letterSpacing: "0.1em", borderRadius: 6,
                  }}
                >
                  {customComponents.length > 0 ? "+ EDIT" : "+ ADD"}
                </button>
              </div>

              {customComponents.length === 0 ? (
                <div style={{
                  padding: "12px 14px",
                  background: "#0a0a0a", border: "1px dashed #242424", borderRadius: 10,
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666",
                  fontStyle: "italic", lineHeight: 1.5,
                }}>
                  Optional. Pick canonical ingredients this item is made from —
                  e.g. a "Curry Ketchup" = [ketchup, curry_powder]. One pick =
                  tagged ingredient; two or more = a composed Meal with a tree.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {customComponents.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setCustomComponents(prev => prev.filter(x => x.id !== c.id))}
                      aria-label={`Remove ${c.canonical.name}`}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "5px 9px",
                        background: "#0a0a0a", border: "1px solid #3a2f10",
                        borderRadius: 16, cursor: "pointer",
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: "#f5c842", letterSpacing: "0.04em",
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{c.canonical.emoji || "🥣"}</span>
                      <span>{c.canonical.name}</span>
                      <span style={{ color: "#888", marginLeft: 2, fontSize: 11 }}>✕</span>
                    </button>
                  ))}
                </div>
              )}

              {customComponents.length >= 2 && (
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7ec87e", letterSpacing:"0.08em", marginTop: 8 }}>
                  ✓ WILL BE SAVED AS A MEAL · {customComponents.length} COMPONENTS
                </div>
              )}
              {customComponents.length === 1 && (
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7eb8d4", letterSpacing:"0.08em", marginTop: 8 }}>
                  TAGGED AS {customComponents[0].canonical.name.toUpperCase()} · RECIPES MATCH
                </div>
              )}
            </div>

        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose} style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, color:"#666", cursor:"pointer", letterSpacing:"0.08em" }}>CANCEL</button>
          <button
            onClick={save}
            disabled={!canSave}
            style={{ flex:2, padding:"14px", background: canSave?"#f5c842":"#1a1a1a", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color: canSave?"#111":"#444", cursor: canSave?"pointer":"not-allowed", letterSpacing:"0.08em" }}
          >
            ADD →
          </button>
        </div>
        </>
    </ModalSheet>

    {/* Components picker, rendered as a SIBLING of ModalSheet so its
        fixed positioning isn't contained by ModalSheet's swipe
        transform (transform on an ancestor contains position:fixed
        descendants — which would anchor LinkIngredient to the sheet
        instead of the viewport and drag it along with the swipe).
        LinkIngredient has its own zIndex higher than AddItemModal's
        so it layers correctly. */}
    {customComponentsOpen && (
      <LinkIngredient
        item={{
          name: customName.trim() || "(new custom item)",
          emoji: "🥫",
          ingredientIds: customComponents.map(c => c.id),
        }}
        onLink={(ids) => {
          const resolved = ids
            .map(id => ({ id, canonical: findIngredient(id) }))
            .filter(x => x.canonical);
          setCustomComponents(resolved);
          setCustomComponentsOpen(false);
        }}
        onClose={() => setCustomComponentsOpen(false)}
      />
    )}
    </>
  );
}

// ── ConvertStateModal ────────────────────────────────────────────────────
//
// Opens when the user taps "⇌ CONVERT" on any pantry row whose ingredient
// has a state vocabulary. Lets them turn a loaf into crumbs, a block of
// cheese into shreds, raw chicken into cooked, etc. The yield is
// user-entered (no hard-coded ratios) because reality varies — one loaf
// gives you 20 slices one day and 16 the next depending on how you cut.
//
// Props:
//   item                — the source pantry row
//   onCancel()
//   onConfirm({         — caller applies the writes
//     targetState,      new state ("crumbs", "grated", …)
//     yieldAmount,      the user-entered amount produced
//     yieldUnit,        unit for yieldAmount (picked from the ingredient's units)
//     sourceUsed        how much of the source row was consumed
//   })
function ConvertStateModal({ item, onCancel, onConfirm }) {
  const canon = findIngredient(item.ingredientId);
  const states = statesForIngredient(canon) || [];
  const unitOptions = canon?.units || [{ id: item.unit, label: item.unit || "—", toBase: 1 }];
  // Exclude the source's own state from the target list — converting
  // "loaf → loaf" is meaningless. Also drop any states that don't exist
  // in the ingredient's vocabulary (defensive for data drift).
  const targetCandidates = states.filter(s => s !== (item.state || null));

  const [targetState, setTargetState] = useState(targetCandidates[0] || "");
  const [sourceUsed, setSourceUsed] = useState(() => {
    // Default the source-used amount to the full row. Users who only
    // grated half a block can tune down.
    const v = Number(item.amount);
    return Number.isFinite(v) ? v : 1;
  });
  const [yieldAmount, setYieldAmount] = useState(1);
  const [yieldUnit, setYieldUnit] = useState(() =>
    canon?.defaultUnit || unitOptions[0]?.id || item.unit || ""
  );

  const canConfirm = targetState && Number(yieldAmount) > 0 && Number(sourceUsed) > 0;

  return (
    <div
      onClick={onCancel}
      style={{ position:"fixed", inset:0, background:"#000c", zIndex:260, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width:"100%", maxWidth:480, maxHeight:"88vh", overflowY:"auto", background:"#0a0a0a", borderTop:"1px solid #2a2a2a", borderTopLeftRadius:18, borderTopRightRadius:18, padding:"24px 20px 20px" }}
      >
        <div style={{ width:42, height:4, background:"#2a2a2a", borderRadius:2, margin:"0 auto 16px" }} />
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#7eb8d4", letterSpacing:"0.15em", marginBottom:6 }}>
          ⇌ CONVERT STATE
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:24, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:4 }}>
          {canon?.name || item.name}
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:18 }}>
          From <span style={{ color:"#f5c842" }}>{item.state ? stateLabel(item.state) : "current"}</span> to …
        </p>

        {/* Target state picker — grid of chips, one per candidate. */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, marginBottom:18 }}>
          {targetCandidates.map(s => {
            const active = targetState === s;
            return (
              <button
                key={s}
                onClick={() => setTargetState(s)}
                style={{
                  padding:"12px 8px",
                  background: active ? "#0f1620" : "#141414",
                  border: `1px solid ${active ? "#7eb8d4" : "#2a2a2a"}`,
                  borderRadius:10,
                  fontFamily:"'DM Mono',monospace", fontSize:10,
                  color: active ? "#7eb8d4" : "#f0ece4",
                  letterSpacing:"0.08em",
                  cursor:"pointer",
                  textTransform:"uppercase",
                }}
              >
                {stateLabel(s)}
              </button>
            );
          })}
        </div>

        {/* Source used. Tells us how much of the original row to decrement. */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#888", letterSpacing:"0.1em", marginBottom:6 }}>
            USED FROM SOURCE
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <input
              type="number" min="0" step="any"
              value={sourceUsed}
              onChange={e => setSourceUsed(e.target.value === "" ? 0 : Number(e.target.value))}
              style={{ flex:1, padding:"10px 12px", background:"#141414", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:15, color:"#f0ece4", outline:"none" }}
            />
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#888", minWidth:56 }}>
              {canon ? unitLabel(canon, item.unit) : item.unit} of {stateLabel(item.state || "current")}
            </span>
          </div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.08em", marginTop:4 }}>
            HAVE: {item.amount} {canon ? unitLabel(canon, item.unit) : item.unit}
          </div>
        </div>

        {/* Yield — how much the conversion produced. User-entered because
            ratios vary; we don't pretend to know. */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#888", letterSpacing:"0.1em", marginBottom:6 }}>
            YIELDED
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <input
              type="number" min="0" step="any"
              value={yieldAmount}
              onChange={e => setYieldAmount(e.target.value === "" ? 0 : Number(e.target.value))}
              style={{ flex:1, padding:"10px 12px", background:"#141414", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:15, color:"#f0ece4", outline:"none" }}
            />
            <select
              value={yieldUnit}
              onChange={e => setYieldUnit(e.target.value)}
              style={{ padding:"10px 10px", background:"#141414", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:12, color:"#f0ece4", outline:"none", minWidth:90, cursor:"pointer" }}
            >
              {unitOptions.map(u => (
                <option key={u.id} value={u.id} style={{ background:"#141414" }}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.08em", marginTop:4 }}>
            OF {stateLabel(targetState || "target")}
          </div>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <button
            onClick={onCancel}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}
          >
            CANCEL
          </button>
          <button
            onClick={() => onConfirm({ targetState, yieldAmount, yieldUnit, sourceUsed })}
            disabled={!canConfirm}
            style={{ flex:2, padding:"14px", background: canConfirm ? "#7eb8d4" : "#1a1a1a", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color: canConfirm ? "#0a0a0a" : "#444", cursor: canConfirm ? "pointer" : "not-allowed", letterSpacing:"0.08em" }}
          >
            ⇌ CONVERT
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pantry Screen ─────────────────────────────────────────────────────────────
export default function Kitchen({ userId, pantry, setPantry, shoppingList, setShoppingList, view = "stock", setView, deepLink, onDeepLinkConsumed }) {
  const [scanning, setScanning] = useState(false);
  // Search replaces the old category filter pills — one input searches item
  // names, hub names, and categories.
  const [search, setSearch] = useState("");
  // Hub rows collapse by default; track which ones the user has opened.
  const [expandedHubs, setExpandedHubs] = useState(() => new Set());
  const toggleHub = id => setExpandedHubs(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const [showDeduction, setShowDeduction] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [addingTo, setAddingTo] = useState(null); // "pantry" | "shopping" | null
  // When the add modal is opened from inside a tile drill-down, this carries
  // the active tile so the picker can pre-filter to that category. Null
  // for the generic top-of-tab "Add an ingredient" CTA — that opens an
  // unfiltered picker. Cleared alongside addingTo on modal close.
  const [addingToTile, setAddingToTile] = useState(null);
  // Inline amount+unit editor on a pantry card. Null when nothing is being
  // edited; otherwise holds the id of the row the user tapped.
  const [editingItemId, setEditingItemId] = useState(null);
  // Inline expiration-date editor. Separate from editingItemId because the
  // two editors can be open on different rows, and the chip/amount
  // affordances live in different spots on the row. Null = none open;
  // otherwise the id of the row whose date picker is showing.
  const [editingExpiryId, setEditingExpiryId] = useState(null);
  // Free-text row being relinked to a canonical ingredient. Null = picker
  // closed; otherwise the pantry row object (we need emoji + name to show
  // in the picker header).
  const [linkingItem, setLinkingItem] = useState(null);
  // Row the user tapped the ✕ on — held pending confirmation. Null =
  // no delete in progress. The actual removePantryItem only fires when
  // the user taps REMOVE inside the confirmation sheet. Cheap
  // protection against the fat-finger "oh no I just deleted my
  // groceries" scenario and the "kid grabbed the phone" scenario.
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  // Row currently showing the "move to other location" inline picker.
  // Null = closed; otherwise the row's id. Only one moving picker open
  // at a time — mirrors the edit/expiry single-editor pattern.
  const [movingItemId, setMovingItemId] = useState(null);
  // Tapping a pantry row opens a card. Two kinds:
  //   - openItem: the full ItemCard — this specific pantry row at top + the
  //     canonical deep-dive embedded below. Primary entry point for row taps.
  //   - cardIng:  the bare IngredientCard opened from secondary places
  //     (add-item flow, hub drill-down) where there's no specific row yet.
  const [openItem, setOpenItem] = useState(null);
  const [cardIng, setCardIng] = useState(null);
  // Receipt-view modal. Set to a receipt uuid to open; null to close.
  // Driven by ItemCard's provenance line (onOpenProvenance callback)
  // and by a bell notification tap (deepLink prop, routed from App).
  const [openReceiptId, setOpenReceiptId] = useState(null);
  // Receipt-history modal — browse every receipt ever scanned. Opened
  // by tapping the GROCERIES THIS MONTH banner so users who want to
  // re-inspect a prior scan don't have to remember what they bought or
  // drill in through a specific item.
  const [historyOpen, setHistoryOpen] = useState(false);

  // Consume a deep link from a notification tap. App.jsx routes
  // target_kind='receipt' / 'pantry_scan' here by switching to the
  // Kitchen tab and setting deepLink = { kind, id }. We open the
  // matching ReceiptView modal and tell App to clear the pointer so
  // re-rendering doesn't re-open the modal if the user dismisses it.
  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.kind === "receipt" && deepLink.id) {
      setOpenReceiptId({ receiptId: deepLink.id });
      onDeepLinkConsumed?.();
    } else if (deepLink.kind === "pantry_scan" && deepLink.id) {
      setOpenReceiptId({ scanId: deepLink.id });
      onDeepLinkConsumed?.();
    }
  }, [deepLink, onDeepLinkConsumed]);
  // Convert-state modal. Set to a pantry item to open; null to close.
  // Drives the "Make crumbs from loaf" / "Shred this block" flow — the
  // user picks a target state + enters how much it yielded, we decrement
  // the source row and insert a new row with the target state.
  const [convertingItem, setConvertingItem] = useState(null);
  // Bumped after each successful scan so the monthly-spend banner re-queries.
  const [spendRefresh, setSpendRefresh] = useState(0);
  const monthlySpend = useMonthlySpend(userId, spendRefresh);
  const { push: pushToast } = useToast();

  // +$X pulse on the monthly groceries banner. When monthlySpend.cents
  // jumps (user just scanned a new receipt) we float a "+$4.99" pill
  // next to the total and pulse the number green. Delta lives in state
  // so the animation replays only on real changes, not on every render.
  // We key off a ref holding the previous cents so the first real load
  // (undefined → 0 or 0 → 4212) doesn't fire a bogus pulse.
  const prevSpendRef = useRef(null);
  const [spendPulse, setSpendPulse] = useState(null); // { delta:number, nonce:number }
  useEffect(() => {
    if (monthlySpend.loading) return;
    const prev = prevSpendRef.current;
    prevSpendRef.current = monthlySpend.cents;
    if (prev == null) return; // first settled value — no baseline to diff
    const delta = monthlySpend.cents - prev;
    if (delta <= 0) return;
    setSpendPulse({ delta, nonce: Date.now() });
  }, [monthlySpend.cents, monthlySpend.loading]);
  useEffect(() => {
    if (!spendPulse) return;
    const t = setTimeout(() => setSpendPulse(null), 2400);
    return () => clearTimeout(t);
  }, [spendPulse]);

  // Fridge / Pantry / Freezer tab. Default to fridge — the tab users hit
  // most often. `drilledTile` holds the fridge-tile id the user has tapped
  // into (null = tile grid view; string = tile detail view). Switching
  // tabs always resets the drill-down.
  const [storageTab, setStorageTabRaw] = useState("fridge");
  const [drilledTile, setDrilledTile] = useState(null);
  // Global-search state for the tile-grid view. Scoped ACROSS all three
  // storage tabs so a user looking for "tortillas" finds them whether they
  // landed in Pantry / Bread or Fridge / Bread & Baked or wherever. Clearing
  // the input returns to the normal tile grid view.
  const [tileSearch, setTileSearch] = useState("");
  const setStorageTab = (next) => {
    setStorageTabRaw(next);
    setDrilledTile(null);
    setTileSearch("");
  };

  // Effective location for an item — respects the stored value, falls back
  // to the category heuristic. Older rows without a location end up where
  // they logically belong (dairy/produce/meat → fridge, frozen → freezer,
  // else pantry). Keeps all tab filtering honest.
  const effectiveLocation = (item) =>
    item.location || defaultLocationForCategory(item.category);

  const lowItems = pantry.filter(isLow);

  // Current tab's tile set + classifier. Null when the tab has no tiles
  // wired yet (freezer) — the render path falls back to a flat list.
  const { tiles: currentTiles, classify: currentClassify } = tilesForTab(storageTab);

  // Global search — runs when tileSearch is non-empty AND we're on the tile
  // grid (not drilled into a tile). Matches across the WHOLE pantry (all
  // three storage tabs), not just the active tab, so a user hunting for
  // "tortillas" finds them even if they're in a tile on a different tab
  // than the one they started on. Each result carries its resolved location
  // + tile id/label so the row can show a "FROM PANTRY · BREAD" origin tag.
  const trimmedSearch = tileSearch.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!trimmedSearch) return [];
    const out = [];
    for (const p of pantry) {
      const loc = effectiveLocation(p);
      const { tiles: locTiles, classify: locClassify } = tilesForTab(loc);
      const tileId = (locTiles && locClassify)
        ? locClassify(p, { findIngredient, hubForIngredient })
        : null;
      const tile = tileId ? (locTiles?.find(t => t.id === tileId) || null) : null;
      // Match against everything textual we carry on the row: name, emoji,
      // ingredient id, canonical name, category, and the tile's own label
      // so searching "bread" surfaces tortillas / pita / naan via the tile.
      const hay = [
        p.name,
        p.emoji,
        p.ingredientId || "",
        p.category || "",
        tile?.label || "",
      ].join(" ").toLowerCase();
      if (hay.includes(trimmedSearch)) {
        out.push({ item: p, location: loc, tile });
      }
    }
    return out;
  }, [trimmedSearch, pantry]);

  // Count items per tile (regardless of drill state) for the active tab
  // — powers the grid's badge numbers and the "empty tile" greyed-out
  // treatment. Returns {} when the tab has no tile set.
  const tileCounts = useMemo(() => {
    if (!currentTiles || !currentClassify) return {};
    const counts = {};
    for (const p of pantry) {
      if (effectiveLocation(p) !== storageTab) continue;
      const tid = currentClassify(p, { findIngredient, hubForIngredient });
      counts[tid] = (counts[tid] || 0) + 1;
    }
    return counts;
  }, [pantry, storageTab, currentTiles, currentClassify]);

  // Items visible in the current tab/drill context. The grouped list below
  // renders from this subset instead of the whole pantry.
  const visibleItems = useMemo(() => {
    let v = pantry.filter(p => effectiveLocation(p) === storageTab);
    if (currentClassify && drilledTile) {
      v = v.filter(p => currentClassify(p, { findIngredient, hubForIngredient }) === drilledTile);
    }
    return v;
  }, [pantry, storageTab, drilledTile, currentClassify]);

  // Group visible items under their ingredient hub (Chicken, Cheese, …) when
  // they have one — otherwise they render as standalone rows. `search` filters
  // both the hub name and each item's name. A hub shows if its name matches OR
  // any of its items match. Driven off `visibleItems` so the grouping respects
  // the current Fridge/Pantry/Freezer tab and any fridge-tile drill-down.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Null-safe: legacy rows may have null category/name fields.
    const matchesSearch = (text) => !q || (text && String(text).toLowerCase().includes(q));

    const groups = new Map(); // hubId → { hub, items }
    const loose = [];

    for (const item of visibleItems) {
      const ing = findIngredient(item.ingredientId);
      const hub = hubForIngredient(ing);
      if (hub) {
        if (!groups.has(hub.id)) groups.set(hub.id, { hub, items: [] });
        groups.get(hub.id).items.push(item);
      } else {
        loose.push(item);
      }
    }

    const out = [];
    for (const { hub, items } of groups.values()) {
      const hubMatches = matchesSearch(hub.name);
      const matchedItems = items.filter(i => matchesSearch(i.name));
      if (hubMatches || matchedItems.length > 0) {
        // When the hub name matches, include all items; otherwise just matches.
        const shown = hubMatches ? items : matchedItems;
        // Sum member amounts in grams via toBase, so we can show a single
        // "2.4 lb" or "14 oz" header regardless of each item's unit.
        let totalBase = 0;
        let totalCents = 0;
        let totalCount = 0;
        for (const item of items) {
          const ing = findIngredient(item.ingredientId);
          const b = ing ? toBase({ amount: item.amount, unit: item.unit }, ing) : NaN;
          if (Number.isFinite(b)) totalBase += b;
          if (typeof item.priceCents === "number") totalCents += item.priceCents;
          totalCount += 1;
        }
        out.push({
          type: "hub",
          hub,
          items: shown,
          totalBase,
          totalCents,
          totalCount,
          anyLow: items.some(isLow),
        });
      }
    }
    for (const item of loose) {
      if (matchesSearch(item.name) || matchesSearch(item.category)) {
        out.push({ type: "item", item });
      }
    }
    return out;
  }, [visibleItems, search]);

  // Merge scanned items into the pantry. When the scanner matched a canonical
  // ingredient we merge by ingredientId (so "2 sticks butter" stacks with an
  // existing butter row even if the other has id null). Units only add when
  // they match — otherwise we just bump to the larger amount and let the user
  // sort it out in the UI. Last-paid priceCents is always overwritten with
  // the freshest receipt price.
  const addScannedItems = async (items, meta = {}) => {
    // Persist the receipt FIRST (and await it) so the DB-side suppression
    // window in notify_family_pantry() is open before the per-item pantry
    // inserts land. Otherwise a 12-item receipt would fan out 12 individual
    // "Trevor added X" notifications on top of the receipt summary one.
    //
    // Capture the receipt's id so we can stamp source_receipt_id on every
    // item that came from this scan — that's what powers the ItemCard's
    // "Scanned from receipt Apr 15 · TAP TO VIEW" deep link.
    //
    // Only receipt-mode scans create a receipts row today. Fridge/pantry/
    // freezer scans get their own table in a future chunk (E); here they
    // just land with sourceKind='pantry_scan' and no receipt link.
    let receiptId = null;
    let scanId = null;
    // Detect which batch-artifact table to write into from the sourceKind
    // the Scanner stamped on every item during normalization.
    const firstKind = items[0]?.sourceKind;
    const isReceiptScan = firstKind === "receipt_scan";
    const isPantryScan  = firstKind === "pantry_scan";

    if (userId && isReceiptScan) {
      // Postgres DATE parsing is strict — anything the model returned that
      // isn't YYYY-MM-DD would fail the insert and silently drop the whole
      // receipt. Coerce to null for anything non-conforming.
      const safeDate = typeof meta.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.date)
        ? meta.date
        : null;
      const payload = {
        user_id: userId,
        store_name: meta.store || null,
        receipt_date: safeDate,
        total_cents: typeof meta.totalCents === "number" ? meta.totalCents : null,
        item_count: items.length,
      };
      const { data, error } = await supabase.from("receipts").insert(payload).select("id").single();
      if (error) {
        console.warn("[receipts] insert failed:", error.message, { payload, details: error });
        // Surface the failure so the user knows the receipt didn't save
        // (vs. the old silent console-only warn that made "receipts aren't
        // storing" look like a ghost bug). Pantry items still get inserted
        // below — the user can always re-scan to capture the totals.
        pushToast(`Receipt didn't save: ${error.message}`, { emoji: "⚠️", kind: "warn", ttl: 6000 });
      } else {
        receiptId = data?.id || null;
        setSpendRefresh(k => k + 1);
      }
    }

    // Pantry-shelf scans (fridge/pantry/freezer) get their own row in
    // pantry_scans so the DB-side notify_family_pantry_scan trigger fires
    // ONE rollup ("Marissa scanned the fridge and added 8 items") instead
    // of per-item pings. Also gives source_scan_id on the resulting
    // pantry items a real FK target.
    if (userId && isPantryScan) {
      // Infer the kind from the first item's location — Scanner already
      // pushed activeMode.location onto each item during normalization.
      const scanKind = items[0]?.location || "pantry";
      const { data, error } = await supabase.from("pantry_scans").insert({
        user_id: userId,
        kind: scanKind,
        item_count: items.length,
      }).select("id").single();
      if (error) {
        console.warn("[pantry_scans] insert failed:", error.message, error);
        pushToast(`Scan didn't save: ${error.message}`, { emoji: "⚠️", kind: "warn", ttl: 6000 });
      } else {
        scanId = data?.id || null;
      }
    }

    // Upload the scan image to Storage so the ItemCard provenance deep
    // link has something to render. Works for BOTH receipt scans and
    // pantry-shelf scans — same 'scans' bucket, same path convention:
    //   scans/<userId>/<receiptId-or-scanId>.ext
    // Best-effort — pantry items are already persisted, so a failed
    // upload just means the image isn't viewable.
    const batchId = receiptId || scanId;
    const batchTable = receiptId ? "receipts" : (scanId ? "pantry_scans" : null);
    if (batchId && batchTable && meta.imageData?.base64) {
      try {
        const { base64, mediaType } = meta.imageData;
        const ext = (mediaType || "image/jpeg").split("/")[1]?.split(";")[0] || "jpg";
        const path = `${userId}/${batchId}.${ext}`;
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: mediaType || "image/jpeg" });
        const { error: upErr } = await supabase.storage
          .from("scans")
          .upload(path, blob, { contentType: mediaType, upsert: true });
        if (upErr) {
          console.warn("[scans storage] upload failed:", upErr.message);
        } else {
          const { error: pathErr } = await supabase
            .from(batchTable)
            .update({ image_path: path })
            .eq("id", batchId);
          if (pathErr) console.warn(`[${batchTable}] image_path update failed:`, pathErr.message);
        }
      } catch (e) {
        console.warn("[scans] image upload exception:", e?.message || e);
      }
    }

    // Purchased-on date — receipt date when the scanner found one, else now.
    // Used as the anchor for expiration estimation and as the row's
    // purchasedAt (most-recent wins on merge, so the gauge always shows the
    // freshest batch's baseline).
    const purchasedAt = meta.date ? new Date(meta.date) : new Date();

    // Summary counters for the single post-batch toast. Per-item toasts
    // don't scale for a 15-line receipt; one "added X new · merged Y"
    // message is more useful than 15 separate animations.
    let addedCount = 0;
    let mergedCount = 0;
    let unitMismatchCount = 0;
    const mergedNames = [];  // for a second toast when short

    setPantry(prev => {
      const next = prev.map(p => ({ ...p }));
      items.forEach(s => {
        // Default expiration for this scanned item = purchased_at +
        // estimateExpirationDays(storage, location). Returns null when the
        // ingredient has no structured storage info — in which case we leave
        // expiresAt null rather than fabricate a number.
        const canon = findIngredient(s.ingredientId);
        const info  = canon ? getIngredientInfo(canon) : null;
        const loc   = canon?.category
          ? defaultLocationForCategory(canon.category)
          : (s.category ? defaultLocationForCategory(s.category) : null);
        const days  = info?.storage ? estimateExpirationDays(info.storage, loc) : null;
        // User-set expiration (typed off the carton in the confirm UI) wins
        // over the auto-estimate. If they didn't set one, fall back to
        // purchasedAt + shelfLife days; if no shelf-life data either, leave
        // null rather than fabricate.
        const newExpiresAt = s.expiresAt
          ? (s.expiresAt instanceof Date ? s.expiresAt : new Date(s.expiresAt))
          : (days != null
              ? new Date(purchasedAt.getTime() + days * 24 * 60 * 60 * 1000)
              : null);

        // Price fallback: if the scanner didn't capture a receipt price but
        // the ingredient has a registry estimate (estCentsPerBase), compute
        // one so monthly-spend totals stay accurate and rows don't go
        // permanently price-less. Real scan prices always win.
        const scanPriceCents = s.priceCents != null
          ? s.priceCents
          : (canon ? estimatePriceCents({ amount: s.amount, unit: s.unit, ingredient: canon }) : null);

        // Find the existing pantry row to merge the scan into, walking
        // three levels of fuzziness so user-renamed rows don't get
        // orphaned by a subsequent scan:
        //
        //   1. Exact ingredientId match — the normal case.
        //   2. Case-insensitive exact name match — handles scans that
        //      duplicate an un-linked free-text row.
        //   3. Fuzzy name match — when the scan has a canonical AND
        //      there's a free-text row whose name contains the canonical
        //      name or shortName (e.g., user's "Tillamook Pepper Jack"
        //      vs scan's "Pepper Jack"), merge into it. The existing
        //      ingredientId-backfill below then upgrades that free-text
        //      row to canonical. Preserves the user's custom name.
        let ex = null;
        if (s.ingredientId) {
          ex = next.find(p => p.ingredientId === s.ingredientId);
        }
        if (!ex) {
          const scanLow = (s.name || "").toLowerCase();
          ex = next.find(p => (p.name || "").toLowerCase() === scanLow);
        }
        if (!ex && s.ingredientId) {
          const scanCanon = findIngredient(s.ingredientId);
          const needle = (scanCanon?.shortName || scanCanon?.name || "").toLowerCase().trim();
          if (needle.length >= 3) {
            ex = next.find(p => {
              if (p.ingredientId) return false;
              const n = (p.name || "").toLowerCase();
              return n && (n.includes(needle) || needle.includes(n));
            });
          }
        }
        if (ex) {
          mergedCount++;
          if (mergedNames.length < 3) mergedNames.push(s.name);

          // Unit merge: if units already match, direct sum. If they don't
          // but both convert via toBase (canonical ingredient + known
          // units), sum in base units and express the result back in the
          // existing row's unit — "2 sticks + 4 tbsp" → "2.33 sticks" rather
          // than silently dropping the tbsp addition.
          const exCanon = findIngredient(ex.ingredientId) || canon;
          if (ex.unit === s.unit) {
            ex.amount = ex.amount + s.amount;
          } else if (exCanon) {
            const haveBase = toBase({ amount: ex.amount, unit: ex.unit }, exCanon);
            const addBase  = toBase({ amount: s.amount,  unit: s.unit },  exCanon);
            const exUnitFactor = exCanon.units.find(u => u.id === ex.unit)?.toBase;
            if (Number.isFinite(haveBase) && Number.isFinite(addBase) && exUnitFactor) {
              ex.amount = (haveBase + addBase) / exUnitFactor;
            } else {
              // Fallback — one side doesn't convert. Prefer the larger
              // number and flag it so we can warn the user.
              unitMismatchCount++;
              ex.amount = Math.max(ex.amount, s.amount);
            }
          } else {
            // Free-text row on both sides, no registry to convert through.
            unitMismatchCount++;
            ex.amount = Math.max(ex.amount, s.amount);
          }
          ex.max = Math.max(ex.max, ex.amount);

          // Backfill ingredientId + ingredientIds if the existing row
          // was free-text — lets a fresh scan "upgrade" an older
          // untagged row to canonical, and attach a richer multi-tag
          // set (via a blend preset) in one shot.
          if (!ex.ingredientId && s.ingredientId) ex.ingredientId = s.ingredientId;
          if ((!Array.isArray(ex.ingredientIds) || ex.ingredientIds.length === 0) &&
              Array.isArray(s.ingredientIds) && s.ingredientIds.length) {
            ex.ingredientIds = s.ingredientIds;
          }
          if (scanPriceCents != null) ex.priceCents = scanPriceCents;
          // Earliest-wins on expiration: the row tells the user when the
          // OLDEST batch in the pile goes bad. Most-recent-wins on
          // purchasedAt so the meter anchors off the freshest purchase.
          if (newExpiresAt) {
            ex.expiresAt = ex.expiresAt
              ? new Date(Math.min(new Date(ex.expiresAt).getTime(), newExpiresAt.getTime()))
              : newExpiresAt;
          }
          ex.purchasedAt = ex.purchasedAt
            ? new Date(Math.max(new Date(ex.purchasedAt).getTime(), purchasedAt.getTime()))
            : purchasedAt;
          // Point the merged row at the MOST RECENT receipt that touched
          // it — "tap to view receipt" opens whichever one the user just
          // did. Earlier receipts can still be found via a history view
          // once a receipt-detail page exists. First-wins would leave
          // stale pointers; last-wins matches the user's mental model.
          if (receiptId) ex.sourceReceiptId = receiptId;
          if (scanId)    ex.sourceScanId    = scanId;
          if (s.sourceKind) ex.sourceKind = s.sourceKind;
          // scan_raw also takes last-wins — most recent scan's read is
          // what the user is currently verifying.
          if (s.scanRaw) ex.scanRaw = s.scanRaw;
        } else {
          addedCount++;
          next.push({
            id: crypto.randomUUID(),
            ingredientId: s.ingredientId || null,
            name: s.name,
            emoji: s.emoji,
            amount: s.amount,
            unit: s.unit,
            max: Math.max(s.amount * 2, 1),
            category: s.category,
            lowThreshold: Math.max(s.amount * 0.25, 0.25),
            priceCents: scanPriceCents,
            expiresAt:   newExpiresAt,
            purchasedAt,
            // Provenance + physical state — forwarded from the Scanner
            // normalization (which tagged every item with its sourceKind
            // and any detectable state code). Conditional spread so
            // fields stay undefined when the scanner didn't set them.
            ...(s.sourceKind ? { sourceKind: s.sourceKind } : {}),
            ...(s.state      ? { state: s.state           } : {}),
            ...(s.scanRaw    ? { scanRaw: s.scanRaw       } : {}),
            // Multi-canonical tag array (0033). The Scanner's LinkIngredient
            // picker emits a full ingredientIds array — preset taps
            // land a 4-element array; single matches land a 1-element
            // array. This is COMPOSITION — what's inside the thing,
            // not identity. Identity rides on canonical_id below.
            ...(Array.isArray(s.ingredientIds) && s.ingredientIds.length
                ? { ingredientIds: s.ingredientIds }
                : {}),
            // Canonical identity (0039). Derived name-first, type-
            // fallback. Scanner normalization may have set it
            // already (s.canonicalId); otherwise derive from the
            // scanner's inferred type + raw name.
            ...(function() {
              const derived = s.canonicalId
                || inferCanonicalFromName(s.name)
                || canonicalIdForType(s.typeId)
                || null;
              return derived ? { canonicalId: derived } : {};
            })(),
            // Food Category + STORED IN placement (0036, 0038).
            // Scanner normalization inferred + set these; forward
            // them so the classifier short-circuits at render time
            // and users see the expected placement without tapping.
            ...(s.tileId ? { tileId: s.tileId } : {}),
            ...(s.typeId ? { typeId: s.typeId } : {}),
            // Back-link to the scan artifact that created this row —
            // either a receipts row (receipt scans) or a pantry_scans
            // row (fridge/pantry/freezer scans). At most one is set.
            // Both feed ItemCard's provenance deep-link.
            ...(receiptId ? { sourceReceiptId: receiptId } : {}),
            ...(scanId    ? { sourceScanId: scanId       } : {}),
          });
        }
      });
      return next;
    });

    // Summary toast — sits above the bottom nav for 4.5s. Keep it short:
    // small receipts (1–3 items) get the name roll-call; big receipts
    // collapse to counts so the UI doesn't scream at the user.
    if (items.length <= 3) {
      items.forEach(s => {
        pushToast(`Added ${s.amount} ${s.unit} of ${s.name}`, { emoji: s.emoji || "🛒", kind: "success", ttl: 3500 });
      });
    } else {
      const parts = [];
      if (addedCount)  parts.push(`${addedCount} new`);
      if (mergedCount) parts.push(`${mergedCount} merged`);
      pushToast(`Stocked ${items.length} items · ${parts.join(" · ")}`, { emoji: "🛒", kind: "success" });
    }
    if (unitMismatchCount > 0) {
      pushToast(`${unitMismatchCount} item${unitMismatchCount === 1 ? "" : "s"} had a unit mismatch — check your kitchen`, { emoji: "⚠️", kind: "warn" });
    }

    // Bump use_count on every template that matched a scan row
    // (chunk 17b). Dedup by template id so scanning 3 boxes of the
    // same item counts as 3 reuses. Fire-and-forget; errors log.
    const templateHits = items
      .map(it => it._templateId)
      .filter(Boolean);
    // Count occurrences so one bump per scanned row
    for (const tid of templateHits) {
      bumpTemplateUse(tid);
    }

    setScanning(false);
  };

  const confirmDeduction = () => {
    setPantry(prev => prev.map(item => {
      const d = DEDUCTION_EXAMPLE.deductions.find(d => d.name === item.name);
      if (!d) return item;
      return { ...item, amount: Math.max(0, item.amount - d.used) };
    }));
    setShowDeduction(false);
  };

  // Push low-stock items onto the shopping list, preserving ingredientId so
  // recipes still match; de-dupe by ingredientId when possible, else by name.
  const addLowStockToList = () => {
    setShoppingList(prev => {
      const existing = new Set(prev.map(i => i.ingredientId || i.name.toLowerCase()));
      const toAdd = lowItems
        .filter(l => !existing.has(l.ingredientId || l.name.toLowerCase()))
        .map(l => ({
          id: crypto.randomUUID(),
          ingredientId: l.ingredientId || null,
          name: l.name,
          emoji: l.emoji,
          amount: Math.max(l.max - l.amount, 1),
          unit: l.unit,
          category: l.category,
          source: "low-stock",
        }));
      return [...prev, ...toAdd];
    });
    setAlertDismissed(true);
  };

  // "Got it" on a shopping list item → move to pantry and remove from list.
  // Matches an existing pantry row by ingredientId when available (so the new
  // "2 tbsp butter" merges into an existing "1.5 sticks" row), else by name.
  const checkOffShoppingItem = sItem => {
    setPantry(prev => {
      const ex = sItem.ingredientId
        ? prev.find(p => p.ingredientId === sItem.ingredientId)
        : prev.find(p => p.name.toLowerCase() === sItem.name.toLowerCase());
      if (ex) {
        // If units match we can do a direct sum; if not, just keep the existing
        // amount (the user can reconcile in the UI).
        const sameUnit = ex.unit === sItem.unit;
        const nextAmount = sameUnit
          ? Math.min(ex.amount + sItem.amount, Math.max(ex.max, ex.amount + sItem.amount))
          : ex.amount;
        return prev.map(p => p.id === ex.id ? { ...p, amount: nextAmount } : p);
      }
      return [...prev, {
        id: crypto.randomUUID(),
        ingredientId: sItem.ingredientId || null,
        name: sItem.name,
        emoji: sItem.emoji || "🥫",
        amount: sItem.amount,
        unit: sItem.unit,
        max: Math.max(sItem.amount * 2, 1),
        category: sItem.category || "pantry",
        lowThreshold: Math.max(sItem.amount * 0.25, 0.25),
      }];
    });
    setShoppingList(prev => prev.filter(i => i.id !== sItem.id));
  };

  const removeShoppingItem = id => setShoppingList(prev => prev.filter(i => i.id !== id));
  const removePantryItem = id => setPantry(prev => prev.filter(i => i.id !== id));

  // Patch a pantry row in place. Also bump `max` up if the user set an amount
  // bigger than the current max (otherwise the progress bar caps at 100% and
  // lies about how much they have).
  const updatePantryItem = (id, patch) => setPantry(prev => prev.map(p => {
    if (p.id !== id) return p;
    const next = { ...p, ...patch };
    if (typeof patch.amount === "number") {
      next.max = Math.max(p.max, next.amount);
      next.lowThreshold = Math.max(next.max * 0.25, 0.25);
    }
    return next;
  }));

  // Render one pantry-item row. Used both for standalone items and for items
  // nested inside an expanded hub card.
  const renderItemCard = item => {
    const canon = findIngredient(item.ingredientId);
    const isEditing = editingItemId === item.id;
    // Name display:
    //   * User-custom name is the primary label ("DelDuca Proscuitto").
    //     Never replaced by canonical — the user's brand/identifier wins.
    //   * When the canonical exists AND its short name differs from the
    //     user's text, append " · Prosciutto" in grey so the scan order is
    //     still obvious at a glance ("what specific item + what kind").
    //   * Inside a hub (parentId set) we prefer the canonical shortName
    //     for the grey suffix ("Breast" not "Chicken Breast") because the
    //     hub header already shows the family.
    const displayName = item.name;
    const canonicalLabel = canon?.shortName && canon.parentId ? canon.shortName : canon?.name;
    const showCanonical = canonicalLabel && canonicalLabel.toLowerCase() !== (item.name || "").toLowerCase();
    // Row taps open the ItemCard — which works for ANY row (canonical or
    // free-text) since an item is a first-class thing independent of any
    // ingredient tag. Free-text rows render without the canonical deep-
    // dive; canonical rows get the full view. The inline edit/trash
    // controls stop propagation so they still work normally.
    const tappable = !isEditing;
    const openCard = () => setOpenItem(item);
    return (
      <div
        key={item.id}
        onClick={tappable ? openCard : undefined}
        role={tappable ? "button" : undefined}
        tabIndex={tappable ? 0 : undefined}
        onKeyDown={tappable ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(); } } : undefined}
        style={{ background:"#141414", border:`1px solid ${isCritical(item)?"#ef444422":isLow(item)?"#f59e0b22":"#1e1e1e"}`, borderRadius:14, padding:"14px 16px", cursor: tappable ? "pointer" : "default" }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
          <span style={{ fontSize:26, flexShrink:0 }}>{item.emoji}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
              <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
                <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>
                  {displayName}
                  {showCanonical && (
                    <span style={{ color:"#666", fontWeight:400 }}> · {canonicalLabel}</span>
                  )}
                </span>
                {item.state && (
                  <span
                    title={`State: ${stateLabel(item.state)}`}
                    style={{
                      fontFamily:"'DM Mono',monospace", fontSize:9,
                      color:"#7eb8d4",
                      background:"#0f1620",
                      border:"1px solid #1f3040",
                      borderRadius:4,
                      padding:"1px 6px",
                      letterSpacing:"0.08em",
                      flexShrink:0,
                      textTransform:"uppercase",
                    }}
                  >
                    {stateLabel(item.state)}
                  </span>
                )}
                {/* ⓘ button removed — row tap is the sole entry point into
                    the ItemCard now, making this icon redundant UI noise.
                    The whole row reads as tappable via cursor + hover; no
                    glyph needed to advertise it. */}
              </span>
              {isEditing ? (
                <div
                  style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setEditingItemId(null);
                    }
                  }}
                >
                  <input
                    type="number"
                    inputMode="decimal"
                    value={item.amount}
                    autoFocus
                    onChange={e => updatePantryItem(item.id, { amount: parseFloat(e.target.value) || 0 })}
                    onKeyDown={e => { if (e.key === "Enter") setEditingItemId(null); }}
                    style={{ width:56, background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"4px 6px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:12, textAlign:"right", outline:"none" }}
                  />
                  {(() => {
                    const units = canon ? canon.units : inferUnitsForScanned(item).units;
                    const hasCurrent = units.some(u => u.id === item.unit);
                    const opts = hasCurrent ? units : [{ id: item.unit, label: item.unit || "—", toBase: 1 }, ...units];
                    return (
                      <select
                        value={item.unit}
                        onChange={e => updatePantryItem(item.id, { unit: e.target.value })}
                        style={{ background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"4px 4px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:11, outline:"none", appearance:"none", cursor:"pointer" }}
                      >
                        {opts.map(u => (
                          <option key={u.id} value={u.id} style={{ background:"#141414" }}>{u.label}</option>
                        ))}
                      </select>
                    );
                  })()}
                </div>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); setEditingItemId(item.id); }}
                  aria-label={`Edit amount of ${item.name}`}
                  style={{ background:"transparent", border:"1px dashed #2a2a2a", borderRadius:8, padding:"2px 8px", fontFamily:"'DM Mono',monospace", fontSize:12, color:barColor(item), cursor:"pointer", flexShrink:0 }}
                >
                  {fmt(item)}
                </button>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2, flexWrap:"wrap" }}>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#444" }}>{(item.category || "").toUpperCase()}</span>
              {item.priceCents != null && (
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7ec87e" }} title="Last paid price">
                  {formatPrice(item.priceCents)}
                </span>
              )}
              {/* ADDED chip — small at-a-glance reminder of when this item
                  entered the pantry. Uses purchasedAt (set by scan / manual
                  add / cook-complete). Provenance (scanned from which
                  receipt / which cook) is the richer version, lands with
                  2b's source_kind + source_*_id columns. */}
              {item.purchasedAt && (() => {
                const d = item.purchasedAt instanceof Date ? item.purchasedAt : new Date(item.purchasedAt);
                if (Number.isNaN(d.getTime())) return null;
                const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                return (
                  <span
                    style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666" }}
                    title={`Added ${d.toLocaleDateString()}`}
                  >
                    ADDED {label.toUpperCase()}
                  </span>
                );
              })()}
              {isLow(item) && (
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color: isCritical(item)?"#ef4444":"#f59e0b", background: isCritical(item)?"#ef444422":"#f59e0b22", padding:"1px 6px", borderRadius:4 }}>
                  {isCritical(item)?"ALMOST OUT":"RUNNING LOW"}
                </span>
              )}
              {/* Expiration countdown chip — the running-time meter below
                  tells the same story graphically; this chip gives you the
                  "5 days" without squinting AND is the handle for editing.
                  Tap it to open a date picker (always overrideable; never
                  fabricated for rows that don't have one). When the row
                  has no date, we show a small "+ set expires" affordance
                  instead so manual entry is a first-class option — not
                  an override. */}
              {editingExpiryId === item.id ? (
                <span
                  style={{ display:"inline-flex", alignItems:"center", gap:4 }}
                  onClick={e => e.stopPropagation()}
                >
                  <input
                    type="date"
                    autoFocus
                    defaultValue={item.expiresAt
                      ? new Date(item.expiresAt).toISOString().slice(0, 10)
                      : ""}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) return;
                      // Pin to noon UTC to dodge DST edge-cases that would
                      // nudge "Apr 22" to "Apr 21 23:00" in some zones.
                      updatePantryItem(item.id, { expiresAt: new Date(`${v}T12:00:00Z`) });
                    }}
                    onBlur={() => setEditingExpiryId(null)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingExpiryId(null); }}
                    style={{ background:"#222", border:"1px solid #f5c842", borderRadius:4, padding:"1px 4px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:10, outline:"none" }}
                  />
                  {item.expiresAt && (
                    <button
                      onClick={e => { e.stopPropagation(); updatePantryItem(item.id, { expiresAt: null, purchasedAt: null }); setEditingExpiryId(null); }}
                      aria-label="Clear expiration date"
                      style={{ background:"transparent", border:"none", color:"#666", fontFamily:"'DM Mono',monospace", fontSize:9, cursor:"pointer", padding:"0 2px" }}
                    >
                      ✕
                    </button>
                  )}
                </span>
              ) : (() => {
                const days = daysUntilExpiration(item);
                if (days != null) {
                  const label = formatDaysUntil(days);
                  const color = expirationColor(days);
                  return (
                    <button
                      onClick={e => { e.stopPropagation(); setEditingExpiryId(item.id); }}
                      aria-label={`Edit expiration date for ${item.name}`}
                      style={{ background:`${color}22`, border:"none", color, fontFamily:"'DM Mono',monospace", fontSize:9, padding:"1px 6px", borderRadius:4, cursor:"pointer" }}
                    >
                      ⏳ {label}
                    </button>
                  );
                }
                return (
                  <button
                    onClick={e => { e.stopPropagation(); setEditingExpiryId(item.id); }}
                    aria-label={`Set expiration date for ${item.name}`}
                    style={{ background:"transparent", border:"1px dashed #2a2a2a", color:"#555", fontFamily:"'DM Mono',monospace", fontSize:9, padding:"0 6px", borderRadius:4, cursor:"pointer" }}
                  >
                    + set expires
                  </button>
                );
              })()}
              {/* CONVERT chip — only surfaces for ingredients that have
                  a state vocabulary (bread, cheese, chicken, onion, etc.).
                  Opens the convert modal where the user picks a target
                  state + enters the resulting yield. */}
              {(() => {
                if (!canon) return null;
                const states = statesForIngredient(canon);
                if (!states || states.length < 2) return null;
                return (
                  <button
                    onClick={e => { e.stopPropagation(); setConvertingItem(item); }}
                    aria-label={`Convert ${item.name} to a different form`}
                    title="Turn this into another form (slice, grate, shred, …)"
                    style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7eb8d4", background:"transparent", border:"1px dashed #1f3040", padding:"0 6px", borderRadius:4, cursor:"pointer" }}
                  >
                    ⇌ CONVERT
                  </button>
                );
              })()}
              {/* MOVE chip — opens the inline location picker below. We
                  suppress this when the row is already being moved (the
                  picker panel itself has a Cancel). */}
              {movingItemId !== item.id && (
                <button
                  onClick={e => { e.stopPropagation(); setMovingItemId(item.id); }}
                  aria-label={`Move ${item.name} to a different storage location`}
                  title="Move this item between fridge, pantry, and freezer"
                  style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#888", background:"transparent", border:"1px dashed #2a2a2a", padding:"0 6px", borderRadius:4, cursor:"pointer" }}
                >
                  ↔ MOVE
                </button>
              )}
            </div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); setDeleteCandidate(item); }}
            aria-label={`Remove ${item.name}`}
            style={{ background:"none", border:"none", color:"#333", fontSize:16, cursor:"pointer", padding:4, flexShrink:0 }}
            onMouseOver={e => e.currentTarget.style.color = "#ef4444"}
            onMouseOut={e => e.currentTarget.style.color = "#333"}
          >
            ✕
          </button>
        </div>
        {/* Inline location-move picker — expands under the main row when
            the user taps the MOVE chip. Shows the two OTHER locations
            (never the current one) plus a cancel. Tapping a target calls
            updatePantryItem with the new location; the row disappears
            from the current tab and re-appears under its tile in the
            destination tab, and we show a confirmation toast. */}
        {movingItemId === item.id && (() => {
          const current = effectiveLocation(item);
          const options = [
            { id: "fridge",  emoji: "🧊", label: "Fridge"  },
            { id: "pantry",  emoji: "🥫", label: "Pantry"  },
            { id: "freezer", emoji: "❄️", label: "Freezer" },
          ].filter(o => o.id !== current);
          return (
            <div
              onClick={e => e.stopPropagation()}
              style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:10, padding:"8px 10px", background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:10 }}
            >
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666", letterSpacing:"0.08em", marginRight:4 }}>
                MOVE TO
              </span>
              {options.map(o => (
                <button
                  key={o.id}
                  onClick={() => {
                    updatePantryItem(item.id, { location: o.id });
                    setMovingItemId(null);
                    pushToast(`Moved ${item.name} to ${o.label.toLowerCase()}`, { emoji: o.emoji, kind: "success", ttl: 3500 });
                  }}
                  style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 10px", background:"#1a1a1a", border:"1px solid #f5c84244", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f5c842", cursor:"pointer", letterSpacing:"0.06em" }}
                >
                  <span style={{ fontSize:13 }}>{o.emoji}</span>
                  → {o.label.toUpperCase()}
                </button>
              ))}
              <button
                onClick={() => setMovingItemId(null)}
                style={{ padding:"6px 10px", background:"transparent", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#666", cursor:"pointer", letterSpacing:"0.06em", marginLeft:"auto" }}
              >
                CANCEL
              </button>
            </div>
          );
        })()}
        <div style={{ height:4, background:"#1e1e1e", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", borderRadius:2, width:`${pct(item)}%`, background:barColor(item), boxShadow:`0 0 8px ${barColor(item)}66`, transition:"width 0.6s ease" }} />
        </div>
        {/* Running-time meter — only rendered when the row carries an
            expiration date. Thinner than the amount bar so it reads as a
            secondary signal; empties as time runs out (gas-gauge mental
            model). Past-due rows lock red at full width so they can't be
            missed. */}
        {(() => {
          const days = daysUntilExpiration(item);
          if (days == null) return null;
          const color = expirationColor(days);
          const width = expirationPct(item);
          return (
            <div style={{ height:2, background:"#1e1e1e", borderRadius:2, overflow:"hidden", marginTop:4 }}>
              <div style={{ height:"100%", borderRadius:2, width:`${width}%`, background:color, transition:"width 0.6s ease" }} />
            </div>
          );
        })()}
      </div>
    );
  };

  // Render a hub group card: tap to expand and show its items. The summary row
  // shows combined weight (in the hub's aggregateUnit) + summed last-paid
  // prices so the user can see "I have 14 oz of cheese worth $28" at a glance.
  const renderHubCard = ({ hub, items, totalBase, totalCents, totalCount, anyLow }) => {
    const expanded = expandedHubs.has(hub.id) || search.trim() !== "";
    const totalInUnit = hub.aggregateBase ? (totalBase / hub.aggregateBase) : NaN;
    const totalDisplay = Number.isFinite(totalInUnit)
      ? `${totalInUnit < 10 ? totalInUnit.toFixed(1) : Math.round(totalInUnit)} ${hub.aggregateLabel}`
      : `${totalCount} item${totalCount === 1 ? "" : "s"}`;
    return (
      <div key={hub.id} style={{ background:"#141414", border:`1px solid ${anyLow?"#f59e0b22":"#1e1e1e"}`, borderRadius:14, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
        <button
          onClick={() => toggleHub(hub.id)}
          style={{ display:"flex", alignItems:"center", gap:12, background:"transparent", border:"none", cursor:"pointer", padding:0, color:"inherit", textAlign:"left" }}
        >
          <span style={{ fontSize:28, flexShrink:0 }}>{hub.emoji}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
              <span style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:"#f0ece4", fontStyle:"italic" }}>{hub.name}</span>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#f5c842" }}>{totalDisplay}</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:2 }}>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666" }}>{totalCount} TYPE{totalCount === 1 ? "" : "S"}</span>
              {totalCents > 0 && (
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7ec87e" }}>{formatPrice(totalCents)}</span>
              )}
              {anyLow && (
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f59e0b", background:"#f59e0b22", padding:"1px 6px", borderRadius:4 }}>SOMETHING LOW</span>
              )}
              <span style={{ marginLeft:"auto", fontFamily:"'DM Mono',monospace", fontSize:11, color:"#555" }}>{expanded ? "▾" : "▸"}</span>
            </div>
          </div>
        </button>
        {expanded && (
          <div style={{ display:"flex", flexDirection:"column", gap:8, borderTop:"1px solid #1e1e1e", paddingTop:10 }}>
            {items.map(renderItemCard)}
          </div>
        )}
      </div>
    );
  };

  if (scanning) return <Scanner userId={userId} onItemsScanned={addScannedItems} onClose={() => setScanning(false)} />;

  return (
    <div style={{ minHeight:"100vh", paddingBottom:100 }}>
      <div style={{ padding:"24px 20px 0" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em", marginBottom:6 }}>YOUR</div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
          <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:38, fontWeight:300, fontStyle:"italic", color:"#f0ece4", letterSpacing:"-0.03em" }}>
            {view === "shopping" ? "Shopping" : "Kitchen"}
          </h1>
          <div style={{ textAlign:"right" }}>
            {view === "shopping" ? (
              <>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:18, color:"#f5c842" }}>{shoppingList.length}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555" }}>TO BUY</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:18, color:"#f5c842" }}>{pantry.filter(i=>pct(i)>50).length}/{pantry.length}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555" }}>STOCKED</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Monthly groceries — only when there's been any spend recorded.
          Pulses green + floats a "+$X.XX" pill over the total when a new
          receipt lands, so the user sees the jump register in realtime
          instead of wondering whether their scan actually stuck.
          Whole banner is tappable — opens ReceiptHistoryModal so users
          can browse every receipt (including family members') without
          drilling in through a specific item. */}
      {!monthlySpend.loading && monthlySpend.cents > 0 && (
        <button
          onClick={() => setHistoryOpen(true)}
          aria-label="View all receipts"
          style={{ margin:"14px 20px 0", padding:"10px 14px", background:"#0f140f", border:"1px solid #1e3a1e", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"space-between", position:"relative", overflow:"visible", width:"calc(100% - 40px)", cursor:"pointer", textAlign:"left", fontFamily:"inherit" }}
        >
          <style>{`
            @keyframes spendFloat {
              0%   { transform: translateY(0) scale(0.9); opacity: 0; }
              15%  { transform: translateY(-4px) scale(1.05); opacity: 1; }
              70%  { transform: translateY(-18px) scale(1); opacity: 1; }
              100% { transform: translateY(-28px) scale(0.95); opacity: 0; }
            }
            @keyframes spendPulse {
              0%   { color: #7ec87e; text-shadow: none; }
              20%  { color: #b6f5c2; text-shadow: 0 0 14px rgba(126,200,126,0.7); }
              100% { color: #7ec87e; text-shadow: none; }
            }
          `}</style>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#4ade80", letterSpacing:"0.12em" }}>GROCERIES THIS MONTH</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#666", marginTop:2 }}>{monthlySpend.receiptCount} receipt{monthlySpend.receiptCount === 1 ? "" : "s"}</div>
          </div>
          <div style={{ position:"relative" }}>
            <div
              key={spendPulse?.nonce ?? "static"}
              style={{
                fontFamily:"'Fraunces',serif", fontSize:22, color:"#7ec87e", fontStyle:"italic",
                animation: spendPulse ? "spendPulse 2.2s ease-out" : undefined,
              }}
            >
              ${(monthlySpend.cents / 100).toFixed(2)}
            </div>
            {spendPulse && (
              <span
                key={`pill-${spendPulse.nonce}`}
                style={{
                  position:"absolute", right:0, top:-4,
                  fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:700,
                  color:"#111", background:"#b6f5c2",
                  padding:"3px 8px", borderRadius:10,
                  letterSpacing:"0.04em", whiteSpace:"nowrap",
                  pointerEvents:"none",
                  animation:"spendFloat 2.2s ease-out forwards",
                }}
              >
                +${(spendPulse.delta / 100).toFixed(2)}
              </span>
            )}
          </div>
        </button>
      )}

      {/* View toggle */}
      <div style={{ display:"flex", gap:0, margin:"18px 20px 0", padding:4, background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:12 }}>
        <button
          onClick={() => setView && setView("stock")}
          style={{ flex:1, padding:"10px", background: view==="stock"?"#1e1e1e":"transparent", border:"none", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600, color: view==="stock"?"#f5c842":"#666", cursor:"pointer", letterSpacing:"0.08em", transition:"all 0.2s" }}
        >
          IN STOCK
        </button>
        <button
          onClick={() => setView && setView("shopping")}
          style={{ flex:1, padding:"10px", background: view==="shopping"?"#1e1e1e":"transparent", border:"none", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600, color: view==="shopping"?"#f5c842":"#666", cursor:"pointer", letterSpacing:"0.08em", transition:"all 0.2s", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
        >
          SHOPPING LIST
          {shoppingList.length > 0 && (
            <span style={{ background:"#f5c842", color:"#111", borderRadius:10, padding:"1px 7px", fontSize:10, fontWeight:700 }}>{shoppingList.length}</span>
          )}
        </button>
      </div>

      {view === "stock" && (
        <>
          {/* Low stock */}
          {!alertDismissed && lowItems.length > 0 && (
            <div style={{ margin:"12px 20px 0", padding:"14px 16px", background:"#1a0f00", border:"1px solid #f59e0b44", borderRadius:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f59e0b", letterSpacing:"0.12em" }}>⚠ RUNNING LOW</div>
                <button onClick={()=>setAlertDismissed(true)} style={{ background:"none", border:"none", color:"#555", fontSize:14, cursor:"pointer" }}>×</button>
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
                {lowItems.map(item => (
                  <span key={item.id} style={{ display:"inline-flex", alignItems:"center", gap:4, background:"#241a00", border:"1px solid #f59e0b33", borderRadius:20, padding:"4px 10px", fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#f59e0b" }}>
                    {item.emoji} {item.name}
                  </span>
                ))}
              </div>
              <button onClick={addLowStockToList} style={{ width:"100%", padding:"10px", background:"#f59e0b22", border:"1px solid #f59e0b44", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f59e0b", cursor:"pointer", letterSpacing:"0.08em" }}>
                ADD ALL TO SHOPPING LIST →
              </button>
            </div>
          )}

          {/* Scan CTA — opens the unified scanner. The user picks fridge,
              pantry, or receipt at the top of that flow. */}
          <div onClick={()=>setScanning(true)} style={{ margin:"16px 20px 0", padding:"18px 20px", background:"linear-gradient(135deg,#1e1a0e 0%,#141008 100%)", border:"1px solid #f5c84233", borderRadius:16, cursor:"pointer", display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ fontSize:36, display:"flex", gap:2 }}>
              <span>🥬</span><span>🥫</span><span>🧾</span>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:"#f0ece4", fontWeight:400, marginBottom:3 }}>Scan something</div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666" }}>Fridge, pantry shelf, or grocery receipt</div>
            </div>
            <div style={{ fontSize:20, color:"#f5c842" }}>→</div>
          </div>

          {/* Manual add CTA */}
          <div onClick={() => setAddingTo("pantry")} style={{ margin:"10px 20px 0", padding:"14px 18px", background:"#141414", border:"1px solid #222", borderRadius:14, cursor:"pointer", display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ fontSize:24 }}>➕</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#ccc" }}>Add an ingredient</div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#555" }}>Manually track what you have</div>
            </div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842" }}>ADD →</div>
          </div>

          {/* Deduction CTA */}
          <div onClick={()=>setShowDeduction(true)} style={{ margin:"10px 20px 0", padding:"14px 18px", background:"#141414", border:"1px solid #222", borderRadius:14, cursor:"pointer", display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ fontSize:28 }}>🍝</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#ccc" }}>Just finished cooking?</div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#555" }}>Log it and we'll deduct ingredients</div>
            </div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>TRY IT →</div>
          </div>

          {/* Fridge / Pantry / Freezer tab strip. Default is Fridge — the
              tab most users open by reflex. Selecting a tab resets any
              active tile drill-down (handled in setStorageTab). */}
          <div style={{ padding:"18px 20px 0" }}>
            <div style={{ display:"flex", gap:6, background:"#0b0b0b", border:"1px solid #1e1e1e", borderRadius:12, padding:4 }}>
              {[
                { id: "fridge",  label: "Fridge",  emoji: "🧊" },
                { id: "pantry",  label: "Pantry",  emoji: "🥫" },
                { id: "freezer", label: "Freezer", emoji: "❄️" },
              ].map(t => {
                const active = storageTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setStorageTab(t.id)}
                    style={{
                      flex: 1,
                      padding: "10px 8px",
                      background: active ? "#1a1a1a" : "transparent",
                      border: active ? "1px solid #f5c84244" : "1px solid transparent",
                      borderRadius: 9,
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      color: active ? "#f5c842" : "#888",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{t.emoji}</span>
                    {t.label.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tile grid — any tab that has a tile set (fridge, pantry), no
              drill-down active. Tapping a tile enters a drill-down view
              of items in that tile. Empty tiles render greyed-out but
              remain tappable — the drill-down's empty state surfaces
              an "Add your first" affordance. */}
          {currentTiles && drilledTile === null && (
            <div style={{ padding:"14px 20px 0" }}>
              {/* Sticky tile-grid search. Kept above the grid so it stays
                  reachable while the tiles are visible; hitting the ✕ or
                  clearing the text brings the grid back. Typing anything
                  collapses the grid and shows a flat results list below. */}
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, padding:"10px 14px", background:"#0a0a0a", border:"1px solid #242424", borderRadius:12 }}>
                <span style={{ fontSize:14, color:"#666" }}>🔍</span>
                <input
                  type="text"
                  value={tileSearch}
                  onChange={e => setTileSearch(e.target.value)}
                  placeholder="Search your whole kitchen…"
                  style={{ flex:1, background:"transparent", border:"none", outline:"none", color:"#f0ece4", fontFamily:"'DM Sans',sans-serif", fontSize:14 }}
                />
                {tileSearch && (
                  <button
                    onClick={() => setTileSearch("")}
                    aria-label="Clear search"
                    style={{ background:"transparent", border:"none", color:"#666", fontFamily:"'DM Mono',monospace", fontSize:14, cursor:"pointer" }}
                  >
                    ✕
                  </button>
                )}
              </div>
            {trimmedSearch ? (
              // Cross-tile results view. Grouped by STORAGE tab so the user
              // reads them the way they'd walk the kitchen: fridge items
              // together, pantry items together, freezer last. Each row's
              // origin tag tells them where they'd tap to get there the
              // normal way.
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {searchResults.length === 0 ? (
                  <div style={{ padding:"32px 12px", textAlign:"center", color:"#555", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontStyle:"italic" }}>
                    Nothing in your kitchen matches “{tileSearch}”.
                  </div>
                ) : (
                  ["fridge", "pantry", "freezer"].map(loc => {
                    const rowsAtLoc = searchResults.filter(r => r.location === loc);
                    if (rowsAtLoc.length === 0) return null;
                    return (
                      <div key={loc}>
                        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.15em", margin:"10px 4px 6px" }}>
                          {loc.toUpperCase()}  ·  {rowsAtLoc.length}
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                          {rowsAtLoc.map(({ item, tile }) => (
                            <button
                              key={item.id}
                              onClick={() => {
                                // Jump straight to the storage tab + drill
                                // into the tile the result actually lives
                                // in. Clears the search so the tile view
                                // renders clean.
                                if (item.location && item.location !== storageTab) {
                                  setStorageTabRaw(item.location);
                                }
                                setDrilledTile(tile?.id || null);
                                setTileSearch("");
                              }}
                              style={{
                                display:"flex", alignItems:"center", gap:10,
                                padding:"10px 12px",
                                background:"#141414",
                                border:"1px solid #242424",
                                borderRadius:10,
                                cursor:"pointer", textAlign:"left",
                              }}
                            >
                              <span style={{ fontSize:22, flexShrink:0 }}>{item.emoji || "🫙"}</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontFamily:"'Fraunces',serif", fontSize:15, color:"#f0ece4", fontStyle:"italic", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                  {item.name}
                                </div>
                                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", marginTop:2, letterSpacing:"0.05em" }}>
                                  {tile ? `${loc.toUpperCase()} · ${tile.label.toUpperCase()}` : loc.toUpperCase()}
                                </div>
                              </div>
                              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", flexShrink:0 }}>
                                {item.amount} {item.unit}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {currentTiles.map(tile => {
                  const count = tileCounts[tile.id] || 0;
                  const empty = count === 0;
                  return (
                    <button
                      key={tile.id}
                      onClick={() => setDrilledTile(tile.id)}
                      style={{
                        textAlign: "left",
                        padding: "16px 14px",
                        background: empty ? "#0c0c0c" : "#141414",
                        border: `1px solid ${empty ? "#1a1a1a" : "#242424"}`,
                        borderRadius: 14,
                        cursor: "pointer",
                        opacity: empty ? 0.45 : 1,
                        filter: empty ? "grayscale(0.85)" : "none",
                        transition: "transform 0.12s, border-color 0.12s",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        minHeight: 110,
                      }}
                      onMouseOver={e => { e.currentTarget.style.borderColor = empty ? "#222" : "#f5c84244"; }}
                      onMouseOut={e =>  { e.currentTarget.style.borderColor = empty ? "#1a1a1a" : "#242424"; }}
                    >
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <span style={{ fontSize: 30 }}>{tile.emoji}</span>
                        <span style={{
                          fontFamily:"'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing:"0.08em",
                          color: empty ? "#444" : "#f5c842",
                          background: empty ? "transparent" : "#1a1a1a",
                          padding: empty ? 0 : "2px 8px",
                          borderRadius: 10,
                        }}>
                          {empty ? "EMPTY" : `${count} ITEM${count === 1 ? "" : "S"}`}
                        </span>
                      </div>
                      <div style={{
                        fontFamily:"'Fraunces',serif",
                        fontSize: 16,
                        color:"#f0ece4",
                        fontWeight: 400,
                        marginTop: 4,
                      }}>
                        {tile.label}
                      </div>
                      <div style={{
                        fontFamily:"'DM Sans',sans-serif",
                        fontSize: 11,
                        color:"#666",
                        lineHeight: 1.35,
                      }}>
                        {tile.blurb}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </div>
          )}

          {/* Drill-down header — shown when the user has tapped into a
              specific tile (fridge or pantry). Back arrow returns to the
              tile grid. */}
          {currentTiles && drilledTile !== null && (() => {
            const tile = currentTiles.find(t => t.id === drilledTile);
            if (!tile) return null;
            return (
              <div style={{ padding:"18px 20px 0", display:"flex", alignItems:"center", gap:12 }}>
                <button
                  onClick={() => setDrilledTile(null)}
                  aria-label={`Back to ${storageTab} overview`}
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    background:"#141414", border:"1px solid #222",
                    color:"#f0ece4", fontSize: 18, cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    flexShrink: 0,
                  }}
                >←</button>
                <div style={{ flex:1, minWidth: 0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize: 22 }}>{tile.emoji}</span>
                    <div style={{ fontFamily:"'Fraunces',serif", fontSize: 20, color:"#f0ece4", fontWeight: 400 }}>
                      {tile.label}
                    </div>
                  </div>
                  <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize: 11, color:"#666", marginTop: 2 }}>
                    {tile.blurb}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Search + items list. Hidden on the tile-grid view (drilledTile
              === null and the tab has tiles); shown once the user drills
              into a tile, and on tabs without a tile set (freezer). */}
          {!(currentTiles && drilledTile === null) && (
            <>
              {/* Search — matches item names, category, and hub names,
                  scoped to the current tab/tile. */}
              <div style={{ padding:"14px 20px 0" }}>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={
                    currentTiles && drilledTile
                      ? `Search ${currentTiles.find(t => t.id === drilledTile)?.label.toLowerCase() || "this section"}…`
                      : `Search your ${storageTab}…`
                  }
                  style={{ width:"100%", padding:"11px 14px", background:"#0f0f0f", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#f0ece4", outline:"none", boxSizing:"border-box" }}
                />
              </div>

              {/* Items — grouped under hubs where applicable */}
              <div style={{ padding:"14px 20px 0", display:"flex", flexDirection:"column", gap:8 }}>
                {grouped.length === 0 && visibleItems.length === 0 && (
                  <div style={{ padding:"28px 18px", textAlign:"center", background:"#0c0c0c", border:"1px dashed #222", borderRadius:14 }}>
                    <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.7 }}>
                      {currentTiles && drilledTile
                        ? currentTiles.find(t => t.id === drilledTile)?.emoji
                        : storageTab === "pantry" ? "🥫" : storageTab === "freezer" ? "❄️" : "🧊"}
                    </div>
                    <div style={{ fontFamily:"'Fraunces',serif", fontStyle:"italic", fontSize: 18, color:"#888", marginBottom: 6 }}>
                      {currentTiles && drilledTile
                        ? `No ${currentTiles.find(t => t.id === drilledTile)?.label.toLowerCase()} yet`
                        : `Nothing in your ${storageTab} yet`}
                    </div>
                    <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize: 12, color:"#555", lineHeight: 1.5, marginBottom: 14 }}>
                      Scan a receipt or tap the button below to get started.
                    </div>
                    <button
                      onClick={() => {
                        // Pre-seed the modal with the current tile context so
                        // the picker filters to just this category.
                        if (currentTiles && drilledTile) {
                          const tile = currentTiles.find(t => t.id === drilledTile);
                          if (tile) setAddingToTile({ tabId: storageTab, tileId: tile.id, tileLabel: tile.label, tileEmoji: tile.emoji, classify: currentClassify });
                        } else {
                          setAddingToTile(null);
                        }
                        setAddingTo("pantry");
                      }}
                      style={{ padding:"10px 18px", background:"#1a1a1a", border:"1px solid #f5c84244", borderRadius: 10, fontFamily:"'DM Mono',monospace", fontSize: 11, color:"#f5c842", letterSpacing:"0.08em", cursor:"pointer" }}
                    >
                      {currentTiles && drilledTile
                        ? `+ ADD ${currentTiles.find(t => t.id === drilledTile)?.label.toUpperCase()}`
                        : "+ ADD AN INGREDIENT"}
                    </button>
                  </div>
                )}
                {grouped.length === 0 && visibleItems.length > 0 && (
                  <div style={{ padding:"18px", color:"#555", fontFamily:"'DM Sans',sans-serif", fontSize:13, textAlign:"center" }}>
                    Nothing matches "{search}".
                  </div>
                )}
                {grouped.map(g =>
                  g.type === "hub" ? renderHubCard(g) : renderItemCard(g.item)
                )}
                {/* Inline "+ Add X" CTA at the bottom of a populated tile
                    drill-down. Users in the Condiments tile who want to add
                    another condiment get a button that's exactly that — not
                    a generic "add an ingredient" dropped at the top of the
                    tab. Pre-filters the picker to the current tile. */}
                {currentTiles && drilledTile && visibleItems.length > 0 && (() => {
                  const tile = currentTiles.find(t => t.id === drilledTile);
                  if (!tile) return null;
                  return (
                    <button
                      onClick={() => {
                        setAddingToTile({ tabId: storageTab, tileId: tile.id, tileLabel: tile.label, tileEmoji: tile.emoji, classify: currentClassify });
                        setAddingTo("pantry");
                      }}
                      style={{
                        marginTop: 6,
                        padding: "14px 16px",
                        background: "#0f0f0f",
                        border: "1px dashed #2a2a2a",
                        borderRadius: 12,
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 11,
                        color: "#888",
                        letterSpacing: "0.08em",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                      onMouseOver={e => { e.currentTarget.style.borderColor = "#f5c84244"; e.currentTarget.style.color = "#f5c842"; }}
                      onMouseOut={e =>  { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#888"; }}
                    >
                      <span style={{ fontSize: 14 }}>{tile.emoji}</span>
                      + ADD {tile.label.toUpperCase()}
                    </button>
                  );
                })()}
              </div>
            </>
          )}
        </>
      )}

      {view === "shopping" && (
        <>
          {/* Manual add CTA */}
          <div onClick={() => setAddingTo("shopping")} style={{ margin:"16px 20px 0", padding:"18px 20px", background:"linear-gradient(135deg,#1e1a0e 0%,#141008 100%)", border:"1px solid #f5c84233", borderRadius:16, cursor:"pointer", display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ fontSize:32 }}>➕</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:"#f0ece4", fontWeight:400, marginBottom:3 }}>Add to list</div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666" }}>Need something? Jot it down.</div>
            </div>
            <div style={{ fontSize:20, color:"#f5c842" }}>→</div>
          </div>

          {shoppingList.length === 0 ? (
            <div style={{ margin:"30px 20px 0", padding:"40px 20px", textAlign:"center", background:"#0f0f0f", border:"1px dashed #222", borderRadius:16 }}>
              <div style={{ fontSize:40, marginBottom:12, opacity:0.6 }}>🛒</div>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontStyle:"italic", color:"#888", marginBottom:6 }}>Your list is empty</div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#555", lineHeight:1.5 }}>
                Add items manually, or tap a recipe to add missing ingredients automatically.
              </div>
            </div>
          ) : (
            <div style={{ padding:"18px 20px 0", display:"flex", flexDirection:"column", gap:8 }}>
              {shoppingList.map(item => (
                <div key={item.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:"#141414", border:"1px solid #1e1e1e", borderRadius:14 }}>
                  <button
                    onClick={() => checkOffShoppingItem(item)}
                    aria-label={`Mark ${item.name} as bought`}
                    style={{ width:26, height:26, borderRadius:8, flexShrink:0, border:"2px solid #333", background:"transparent", cursor:"pointer", transition:"all 0.2s", display:"flex", alignItems:"center", justifyContent:"center", color:"#4ade80", fontSize:14, fontWeight:900 }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = "#4ade80"; e.currentTarget.style.background = "#4ade8022"; }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.background = "transparent"; }}
                  >
                    ✓
                  </button>
                  <span style={{ fontSize:22, flexShrink:0 }}>{item.emoji || "🥫"}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#f0ece4", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</div>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", marginTop:2 }}>
                      {item.amount} {displayUnit(item)}
                      {item.source === "low-stock" && <span style={{ color:"#f59e0b", marginLeft:8 }}>• LOW STOCK</span>}
                      {item.source === "recipe" && <span style={{ color:"#7eb8d4", marginLeft:8 }}>• FROM RECIPE</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => removeShoppingItem(item.id)}
                    aria-label={`Remove ${item.name}`}
                    style={{ background:"none", border:"none", color:"#333", fontSize:16, cursor:"pointer", padding:4, flexShrink:0 }}
                    onMouseOver={e => e.currentTarget.style.color = "#ef4444"}
                    onMouseOut={e => e.currentTarget.style.color = "#333"}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div style={{ marginTop:8, fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", textAlign:"center", letterSpacing:"0.08em" }}>
                TAP ✓ WHEN YOU'VE PICKED IT UP — IT'LL MOVE TO YOUR KITCHEN
              </div>
            </div>
          )}
        </>
      )}

      {addingTo && (
        <AddItemModal
          target={addingTo}
          tileContext={addingTo === "pantry" ? addingToTile : null}
          userId={userId}
          onClose={() => { setAddingTo(null); setAddingToTile(null); }}
          onAdd={item => {
            if (addingTo === "shopping") {
              setShoppingList(prev => [...prev, { ...item, source: "manual" }]);
            } else {
              // Suggest a location: registry's storage.location wins
              // (butter→fridge, flour→pantry), then the current tab the
              // user is viewing, then the category heuristic. Everything
              // honors an explicit location the modal may have set.
              // When the modal was opened from a tile drill-down, the
              // caller's tab is what we want — if they're in the Fridge
              // tab's Condiments tile adding mustard, it goes in the
              // fridge even though mustard's registry location is pantry.
              const canon = findIngredient(item.ingredientId);
              const regLocation = canon ? getIngredientInfo(canon)?.storage?.location : null;
              const location = item.location || (addingToTile ? addingToTile.tabId : null) || regLocation || storageTab;
              setPantry(prev => [...prev, { ...item, location }]);
            }
          }}
        />
      )}

      {/* Deduction modal */}
      {showDeduction && (
        <div style={{ position:"fixed", inset:0, background:"#000000cc", zIndex:150, display:"flex", alignItems:"flex-end", maxWidth:480, margin:"0 auto" }}>
          <div style={{ width:"100%", background:"#141414", borderRadius:"20px 20px 0 0", padding:"28px 24px 48px" }}>
            <div style={{ width:36, height:4, background:"#2a2a2a", borderRadius:2, margin:"0 auto 24px" }} />
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#e07a3a", letterSpacing:"0.12em", marginBottom:8 }}>PANTRY DEDUCTION</div>
            <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:24, color:"#f0ece4", fontWeight:300, fontStyle:"italic", marginBottom:6 }}>You just cooked {DEDUCTION_EXAMPLE.dish}</h3>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:20 }}>Deduct these from your kitchen?</p>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
              {DEDUCTION_EXAMPLE.deductions.map((d,i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:"#1a1a1a", borderRadius:10 }}>
                  <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#ccc" }}>{d.name}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#e07a3a" }}>− {d.used} {d.unit}</span>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setShowDeduction(false)} style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, color:"#666", cursor:"pointer" }}>SKIP</button>
              <button onClick={confirmDeduction} style={{ flex:2, padding:"14px", background:"#e07a3a", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color:"#fff", cursor:"pointer" }}>YES, DEDUCT →</button>
            </div>
          </div>
        </div>
      )}
      {openReceiptId && (
        <ReceiptView
          receiptId={openReceiptId.receiptId}
          scanId={openReceiptId.scanId}
          pantry={pantry}
          onOpenItem={(item) => setOpenItem(item)}
          onClose={() => setOpenReceiptId(null)}
        />
      )}
      {historyOpen && (
        <ReceiptHistoryModal
          userId={userId}
          onOpenReceipt={(id) => {
            // Stack the ReceiptView over the history modal rather than
            // replacing it — when the user dismisses the view they land
            // back on the history list, which is the behavior they'd
            // expect from a "browse receipts" flow.
            setOpenReceiptId({ receiptId: id });
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {openItem && (() => {
        // Resolve the open item freshly from the current pantry array so
        // realtime updates + inline edits land inside the card without a
        // close+reopen. If the item was deleted while open, render nothing
        // — the stale openItem pointer will be cleared next time the user
        // opens another card or dismisses explicitly.
        const fresh = pantry.find(p => p.id === openItem.id);
        if (!fresh) return null;
        return (
          <ItemCard
            item={fresh}
            pantry={pantry}
            userId={userId}
            onUpdate={(patch) => updatePantryItem(fresh.id, patch)}
            onEditTags={() => setLinkingItem(fresh)}
            onOpenProvenance={(link) => {
              // kind: 'receipt' and 'scan' both route through ReceiptView
              // (it handles both artifact kinds based on which prop is
              // passed). 'cook' will route to a cook-log detail view
              // when that ships.
              if (link?.kind === "receipt" && link.id) {
                setOpenReceiptId({ receiptId: link.id });
              } else if (link?.kind === "scan" && link.id) {
                setOpenReceiptId({ scanId: link.id });
              }
            }}
            onClose={() => setOpenItem(null)}
          />
        );
      })()}
      {cardIng && (
        <IngredientCard
          ingredientId={cardIng.ingredientId}
          fallbackName={cardIng.fallbackName}
          fallbackEmoji={cardIng.fallbackEmoji}
          pantry={pantry}
          onClose={() => setCardIng(null)}
        />
      )}
      {convertingItem && (
        <ConvertStateModal
          item={convertingItem}
          onCancel={() => setConvertingItem(null)}
          onConfirm={({ targetState, yieldAmount, yieldUnit, sourceUsed }) => {
            const sourceCanon = findIngredient(convertingItem.ingredientId);
            setPantry(prev => {
              const byId = new Map(prev.map(r => [r.id, r]));
              // Decrement the source row. Source-used is in the source
              // row's own unit, clamped to not go negative. If it hits
              // 0 we delete the row entirely (same pattern as the
              // cook-complete removal flow).
              const src = byId.get(convertingItem.id);
              if (src) {
                const nextAmount = Math.max(0, Number(src.amount) - Number(sourceUsed));
                if (nextAmount === 0) byId.delete(src.id);
                else byId.set(src.id, { ...src, amount: Number(nextAmount.toFixed(4)) });
              }
              // Insert (or merge) the target-state row. Same
              // ingredientId + same location + same target state →
              // one row, additive amount. Otherwise new row.
              const existingTarget = [...byId.values()].find(r =>
                r.ingredientId === convertingItem.ingredientId &&
                (r.location || "pantry") === (convertingItem.location || "pantry") &&
                (r.state || null) === targetState &&
                (r.kind || "ingredient") === "ingredient"
              );
              if (existingTarget) {
                byId.set(existingTarget.id, {
                  ...existingTarget,
                  amount: Number(existingTarget.amount) + Number(yieldAmount),
                });
              } else {
                const newId = typeof crypto !== "undefined" && crypto.randomUUID
                  ? crypto.randomUUID()
                  : `convert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                byId.set(newId, {
                  id: newId,
                  ingredientId: convertingItem.ingredientId,
                  name: sourceCanon?.name || convertingItem.name,
                  emoji: sourceCanon?.emoji || convertingItem.emoji,
                  amount: Number(yieldAmount),
                  unit: yieldUnit,
                  max: Number(yieldAmount),
                  category: convertingItem.category,
                  lowThreshold: 0.25,
                  priceCents: null,
                  location: convertingItem.location || "pantry",
                  // Converted rows inherit source expiration — a loaf
                  // turned into crumbs doesn't become fresher. User
                  // can override via the date picker after.
                  expiresAt: convertingItem.expiresAt || null,
                  purchasedAt: convertingItem.purchasedAt || null,
                  kind: "ingredient",
                  state: targetState,
                  ownerId: userId,
                });
              }
              return [...byId.values()];
            });
            setConvertingItem(null);
          }}
        />
      )}
      {linkingItem && (
        <LinkIngredient
          item={linkingItem}
          onLink={async (ids) => {
            // Multi-tag commit. 2+ tags promotes the item to kind='meal'
            // and writes one ingredient-kind Component row per tag so the
            // Meal/Ingredient tier model (migration 0034) has its
            // structured truth. 0-1 tag demotes back to kind='ingredient'
            // and wipes any prior components. The flat ingredient_ids[]
            // array stays authoritative for recipe matching in either
            // case (GIN-indexed).
            //
            // Name stays the user's — linking never overwrites what they
            // typed. Emoji adopts the primary canonical only when the
            // user hadn't set a custom one already.
            const primaryId = ids[0] || null;
            const canon = primaryId ? findIngredient(primaryId) : null;
            const nextKind = kindForTagCount(ids.length);

            const parentId = linkingItem.id;
            updatePantryItem(parentId, {
              ingredientId: primaryId,
              ingredientIds: ids,
              kind: nextKind,
              emoji: canon?.emoji || linkingItem.emoji,
            });
            setLinkingItem(null);

            // Components write happens off the render path — the item
            // update above is what the UI reflects immediately; the
            // structured components are a secondary truth the
            // ItemCard's COMPONENTS tree reads on next open. A write
            // failure logs + retries on the next link event; the item
            // still functions as a Meal by way of its ingredient_ids[].
            const components = nextKind === "meal"
              ? componentsFromIngredientIds(ids)
              : [];
            await setComponentsForParent(parentId, components);
          }}
          onClose={() => setLinkingItem(null)}
        />
      )}

      {/* Delete-confirmation sheet. One modal used for every row's ✕
          — the ✕ just sets deleteCandidate and this reads from it.
          REMOVE actually fires the delete; CANCEL / backdrop-tap
          dismisses without touching pantry state. No destructive
          keyboard shortcut (Enter on the sheet focuses CANCEL, not
          REMOVE) — intentional; accidental Return-key deletes were
          part of the motivation for this flow. */}
      {deleteCandidate && (
        <div
          onClick={() => setDeleteCandidate(null)}
          style={{
            position: "fixed", inset: 0, background: "#000000dd",
            zIndex: 350, display: "flex", alignItems: "flex-end",
            maxWidth: 480, margin: "0 auto",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%", background: "#141414",
              borderRadius: "20px 20px 0 0",
              padding: "22px 22px 28px",
            }}
          >
            <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 18px" }} />
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#ef4444", letterSpacing: "0.15em", marginBottom: 6 }}>
              REMOVE FROM KITCHEN?
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 36, flexShrink: 0 }}>{deleteCandidate.emoji || "🥫"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{
                  fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                  color: "#f0ece4", fontWeight: 400, margin: 0, lineHeight: 1.2,
                  overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {deleteCandidate.name}
                </h2>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.08em", marginTop: 3 }}>
                  {Number(deleteCandidate.amount || 0)} {deleteCandidate.unit || ""} · {(deleteCandidate.location || "pantry").toUpperCase()}
                </div>
              </div>
            </div>
            <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.5, margin: "0 0 18px" }}>
              This removes the item from your kitchen entirely. If you're
              just using it up, let the cook flow decrement it — that way
              history, provenance, and cook-log references stay intact.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setDeleteCandidate(null)}
                autoFocus
                style={{
                  flex: 1, padding: "13px",
                  background: "#1a1a1a", border: "1px solid #2a2a2a",
                  color: "#ccc", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 12,
                  letterSpacing: "0.08em", cursor: "pointer", fontWeight: 600,
                }}
              >
                CANCEL
              </button>
              <button
                onClick={() => {
                  const id = deleteCandidate.id;
                  setDeleteCandidate(null);
                  removePantryItem(id);
                }}
                style={{
                  flex: 1, padding: "13px",
                  background: "#2a0a0a", border: "1px solid #5a1a1a",
                  color: "#ef4444", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 12,
                  letterSpacing: "0.08em", cursor: "pointer", fontWeight: 600,
                }}
              >
                REMOVE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
