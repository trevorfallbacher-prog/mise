import { useState, useRef, useMemo } from "react";
import {
  INGREDIENTS, HUBS,
  findIngredient, findHub, hubForIngredient,
  membersOfHub, standaloneIngredients,
  unitLabel, inferUnitsForScanned, toBase,
  estimatePriceCents, getIngredientInfo, estimateExpirationDays,
  stateLabel, statesForIngredient,
} from "../data/ingredients";
import { supabase } from "../lib/supabase";
import { useMonthlySpend } from "../lib/useMonthlySpend";
import { defaultLocationForCategory } from "../lib/usePantry";
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
import IngredientCard from "./IngredientCard";
import LinkIngredient from "./LinkIngredient";

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
const DAYS_MS = 1000 * 60 * 60 * 24;
// How many days until `expiresAt`; negative if past. Null when the item
// doesn't carry an expiration date (free-text, unknown ingredient).
const daysUntilExpiration = item => {
  if (!item?.expiresAt) return null;
  const exp = item.expiresAt instanceof Date ? item.expiresAt : new Date(item.expiresAt);
  if (Number.isNaN(exp.getTime())) return null;
  return Math.floor((exp.getTime() - Date.now()) / DAYS_MS);
};
// Short countdown label: "5 days" / "1 day" / "today" / "expired" / "2d ago".
const formatDaysUntil = days => {
  if (days == null) return null;
  if (days < -1)  return `expired ${-days}d ago`;
  if (days === -1) return "expired yesterday";
  if (days === 0) return "expires today";
  if (days === 1) return "1 day left";
  if (days < 14)  return `${days} days left`;
  if (days < 60)  return `${Math.round(days / 7)} weeks left`;
  return `${Math.round(days / 30)} months left`;
};
// Same palette as the amount bar, gated on days remaining:
//   expired  → deep red      (< 0)
//   urgent   → red           (0–2)
//   warn     → amber         (3–7)
//   fresh    → green         (> 7)
const expirationColor = days => {
  if (days == null) return "#333";
  if (days < 0)     return "#991b1b";
  if (days <= 2)    return "#ef4444";
  if (days <= 7)    return "#f59e0b";
  return "#4ade80";
};
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
const formatPrice = cents =>
  typeof cents === "number" && Number.isFinite(cents)
    ? `$${(cents / 100).toFixed(2)}`
    : "";

// Color + label + ordering for the confidence tag a scanned item carries.
// Receipts get treated as "high" by default — OCR is deterministic enough
// that we don't want every receipt row screaming for review. Shelf scans
// (scan-shelf) supply their own tag per item, since opaque containers and
// frosted-over labels are exactly the kinds of things the user needs to
// double-check.
const CONFIDENCE_STYLES = {
  high:   { label: "HIGH",  color: "#4ade80", bg: "#0f1a0f", border: "#1e3a1e", order: 2 },
  medium: { label: "MED",   color: "#f5c842", bg: "#1a1608", border: "#3a2f10", order: 1 },
  low:    { label: "LOW",   color: "#f59e0b", bg: "#1a0f00", border: "#3a2810", order: 0 },
};
const confidenceStyle = c => CONFIDENCE_STYLES[c] || CONFIDENCE_STYLES.medium;

// One scanner, three contexts. The user picks an icon at the top — that
// determines (a) the label/copy shown throughout the flow, (b) the location
// new items will land in (fridge / pantry / freezer), and (c) which edge
// function we'll eventually invoke. For this chunk every mode still routes
// to scan-receipt; the dedicated scan-shelf function lands in a follow-up.
const SCAN_MODES = [
  {
    id: "fridge",
    icon: "🥬",
    label: "Fridge",
    location: "fridge",
    title: "What's in the fridge?",
    blurb: "Snap a shot of the open fridge — we'll catalog what we see.",
    cta: "SCAN FRIDGE →",
    badge: "FRIDGE SCAN",
  },
  {
    id: "pantry",
    icon: "🥫",
    label: "Pantry",
    location: "pantry",
    title: "What's on the shelf?",
    blurb: "Photo of a pantry shelf or open cabinet — we'll count what's there.",
    cta: "SCAN SHELF →",
    badge: "PANTRY SCAN",
  },
  {
    id: "receipt",
    icon: "🧾",
    label: "Receipt",
    // null → fall back to category-based default per item.
    location: null,
    title: "Got groceries?",
    blurb: "Photo your receipt and we'll stock your pantry automatically.",
    cta: "SCAN RECEIPT →",
    badge: "RECEIPT SCAN",
  },
];

// ── Scanner (fridge / pantry / receipt) ───────────────────────────────────────
function Scanner({ onItemsScanned, onClose }) {
  const [mode, setMode] = useState("receipt");
  const [phase, setPhase] = useState("upload");
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
  const [error, setError] = useState(null);
  const fileRef = useRef();
  const activeMode = SCAN_MODES.find(m => m.id === mode) || SCAN_MODES[2];

  // One-shot patch helper for scan items. Same semantics as updatePantryItem
  // in the main component — shallow merge by index.
  const updateScanItem = (idx, patch) => setScannedItems(prev =>
    prev.map((item, i) => i === idx ? { ...item, ...patch } : item)
  );

  const handleFile = file => {
    if (!file) return;
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
        };
        if (!canon) {
          const inferred = inferUnitsForScanned(base);
          const validIds = inferred.units.map(u => u.id);
          // Keep the model's unit if it's in our inferred list; otherwise use default.
          if (!validIds.includes(base.unit)) base.unit = inferred.defaultUnit;
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

  const toggleItem = idx => setScannedItems(prev => prev.map((item,i) => i===idx ? {...item,selected:!item.selected} : item));
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
                <div key={idx} style={{ display:"flex", alignItems:"stretch", gap:0, borderRadius:12, background: item.selected?"#161616":"#0f0f0f", border:`1px solid ${item.selected ? conf.border : "#1a1a1a"}`, opacity: item.selected?1:0.4, transition:"all 0.2s", overflow:"hidden" }}>
                  {/* Confidence accent stripe — reads at a glance whether to
                      trust the row, even before you read the name. */}
                  <div style={{ width:4, background: item.selected ? conf.color : "#222", flexShrink:0 }} />
                  <div style={{ flex:1, display:"flex", alignItems:"flex-start", gap:12, padding:"14px 14px", minWidth:0 }}>
                  <button onClick={()=>toggleItem(idx)} style={{ width:24, height:24, borderRadius:6, flexShrink:0, border:`2px solid ${item.selected?"#4ade80":"#333"}`, background: item.selected?"#4ade80":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"#111", fontWeight:900, cursor:"pointer", transition:"all 0.2s", marginTop:2 }}>{item.selected?"✓":""}</button>
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
                        onBlur={() => setEditingNameIdx(null)}
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
                    </div>

                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#666", display:"flex", gap:10, flexWrap:"wrap" }}>
                      <span>{(item.category || "").toUpperCase()}</span>
                      {item.priceCents != null && <span style={{ color:"#7ec87e" }}>{formatPrice(item.priceCents)}</span>}
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
              {scannedItems.filter(i=>i.selected).length} items will be added to your pantry
            </span>
          </div>
          <button onClick={() => { onItemsScanned(scannedItems.filter(i=>i.selected), receiptMeta); setPhase("done"); }} style={{ marginTop:12, width:"100%", padding:"16px", background:"#f5c842", color:"#111", border:"none", borderRadius:14, fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer", flexShrink:0 }}>
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
          onLink={canonicalId => {
            const canon = findIngredient(canonicalId);
            updateScanItem(linkingScanIdx, {
              ingredientId: canonicalId,
              emoji:    canon?.emoji    || scannedItems[linkingScanIdx].emoji,
              category: canon?.category || scannedItems[linkingScanIdx].category,
            });
            setLinkingScanIdx(null);
          }}
          onClose={() => setLinkingScanIdx(null)}
        />
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
              No details yet — but you can still add it to your pantry.
            </p>
          )}
        </div>

        <button
          onClick={() => onAdd(ingredient)}
          style={{ width:"100%", padding:"16px", background:"#f5c842", color:"#111", border:"none", borderRadius:14, fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer", flexShrink:0 }}
        >
          + ADD TO PANTRY
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
function AddItemModal({ target, tileContext, onClose, onAdd }) {
  const [mode, setMode] = useState("canonical"); // "canonical" | "custom"
  const [search, setSearch] = useState("");
  // When the user taps a hub (Chicken, Cheese, …) we drill into it and show
  // just its members. `drillHub` is null on the top-level tile grid.
  const [drillHub, setDrillHub] = useState(null);
  // When the modal was opened from a tile drill-down, the picker pre-filters
  // to ingredients that classify into that tile. The user can override
  // with "Show all ingredients" — useful when an ingredient is misclassified
  // or when the user knows exactly what they want.
  const [showAllFromTile, setShowAllFromTile] = useState(false);
  const activeTileFilter = tileContext && !showAllFromTile ? tileContext : null;
  // Wraps an ingredient in a fake pantry-item shape so the tile classifier
  // (which operates on pantry rows) can route it. Only the fields the
  // classifier actually reads are populated — ingredientId + category.
  const fitsTile = (ing) => {
    if (!activeTileFilter) return true;
    const fakeItem = { ingredientId: ing.id, category: ing.category };
    return activeTileFilter.classify(fakeItem, { findIngredient, hubForIngredient }) === activeTileFilter.tileId;
  };
  // A hub fits the tile if any of its members do — so the Cheese hub shows
  // up on the Dairy tile (all cheeses fit) but not on Meat & Poultry.
  const hubFitsTile = (hub) => {
    if (!activeTileFilter) return true;
    return membersOfHub(hub.id).some(fitsTile);
  };
  const [picked, setPicked] = useState(null); // ingredient from registry
  const [unitId, setUnitId] = useState("");
  const [amount, setAmount] = useState("");
  // Which subcategory tiles are expanded inside the drill view. Drill-downs
  // with lots of members (cheese has 75+) are overwhelming as a flat list, so
  // we show one tile per subcategory and only reveal its ingredients on tap.
  const [expandedSubs, setExpandedSubs] = useState(() => new Set());
  const toggleSub = (key) => setExpandedSubs(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  // An ingredient the user tapped (not picked yet) — shows the detail sheet
  // with description, flavor profile, wine pairings, recipes. `Add to Pantry`
  // in the sheet is what actually promotes it to `picked`.
  const [detailIngredient, setDetailIngredient] = useState(null);

  // Custom-mode fields (only used when mode === "custom"). Custom items
  // always get the generic 🥫 emoji — the on-screen emoji input was a bad
  // affordance on mobile keyboards and rarely produced anything sensible.
  const [customName, setCustomName] = useState("");
  const [customUnit, setCustomUnit] = useState("");
  const [customCategory, setCustomCategory] = useState("pantry");

  // Top-level picker view. If the user has typed a search, flatten everything
  // so "cheddar" still finds cheddar even though it's hidden under Cheese.
  // Otherwise show hub tiles + standalone ingredients as their own rows.
  // When a tile filter is active (user came from a tile drill-down), all
  // three branches apply it so the picker only offers ingredients that
  // classify into the current tile.
  const pickerView = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (drillHub) {
      const members = membersOfHub(drillHub.id);
      const matching = q ? members.filter(m => m.name.toLowerCase().includes(q)) : members;
      return {
        kind: "drill",
        hub: drillHub,
        members: matching.filter(fitsTile),
      };
    }
    if (q) {
      // Flat search across all ingredients AND hub names.
      const matchedHubs = HUBS.filter(h => h.name.toLowerCase().includes(q)).filter(hubFitsTile);
      const matchedIngredients = INGREDIENTS.filter(i =>
        (i.name.toLowerCase().includes(q) || (i.shortName && i.shortName.toLowerCase().includes(q))) &&
        fitsTile(i)
      );
      return { kind: "search", hubs: matchedHubs, ingredients: matchedIngredients };
    }
    return {
      kind: "top",
      hubs: HUBS.filter(hubFitsTile),
      ingredients: standaloneIngredients().filter(fitsTile),
    };
  }, [search, drillHub, activeTileFilter]);

  const pickIngredient = (ing) => {
    setPicked(ing);
    setUnitId(ing.defaultUnit);
  };

  const canSaveCanonical = picked && amount !== "" && unitId;
  const canSaveCustom = customName.trim() && amount !== "" && customUnit.trim();
  const canSave = mode === "canonical" ? canSaveCanonical : canSaveCustom;

  // Live price estimate based on the picked ingredient's estCentsPerBase
  // (or the category fallback). Shown below the amount/unit inputs so the
  // user can see what manual entries will contribute to monthly spend.
  const estCents = useMemo(() => {
    if (mode !== "canonical" || !picked || !amount || !unitId) return null;
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) return null;
    return estimatePriceCents({ amount: amt, unit: unitId, ingredient: picked });
  }, [mode, picked, amount, unitId]);

  const save = () => {
    if (!canSave) return;
    const amt = parseFloat(amount) || 0;

    const item = mode === "canonical"
      ? {
          id: crypto.randomUUID(),
          ingredientId: picked.id,
          name: picked.name,
          emoji: picked.emoji,
          amount: amt,
          unit: unitId,
          max: Math.max(amt * 2, 1),
          category: picked.category,
          lowThreshold: Math.max(amt * 0.25, 0.25),
          // Manually-added items don't have a receipt price — estimate from
          // the ingredient's typical $/base-unit so they still show up in
          // spend totals and the monthly view.
          priceCents: estCents,
        }
      : {
          id: crypto.randomUUID(),
          ingredientId: null,
          name: customName.trim(),
          emoji: "🥫",
          amount: amt,
          unit: customUnit.trim(),
          max: Math.max(amt * 2, 1),
          category: customCategory,
          lowThreshold: Math.max(amt * 0.25, 0.25),
        };

    onAdd(item);
    onClose();
  };

  const unitOptions = picked?.units || [];

  return (
    <div style={{ position:"fixed", inset:0, background:"#000000cc", zIndex:160, display:"flex", alignItems:"flex-end", maxWidth:480, margin:"0 auto" }}>
      <div style={{ width:"100%", background:"#141414", borderRadius:"20px 20px 0 0", padding:"24px 24px 40px", maxHeight:"85vh", overflowY:"auto" }}>
        <div style={{ width:36, height:4, background:"#2a2a2a", borderRadius:2, margin:"0 auto 20px" }} />
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:6 }}>
          {target === "shopping"
            ? "+ TO SHOPPING LIST"
            : tileContext
              ? `+ TO ${tileContext.tabId.toUpperCase()} · ${tileContext.tileLabel.toUpperCase()}`
              : "+ TO PANTRY"}
        </div>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:24, color:"#f0ece4", fontWeight:300, fontStyle:"italic", marginBottom:14 }}>
          {tileContext
            ? `Add ${/^[aeiou]/i.test(tileContext.tileLabel) ? "an" : "a"} ${tileContext.tileLabel.toLowerCase()}`
            : "Add an ingredient"}
        </h3>

        {/* Tile-filter banner — shown when we're pre-filtering to a specific
            tile. Gives the user a way to escape the filter ("show all
            ingredients") in case what they want is misclassified or they
            just want the full picker. */}
        {tileContext && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px",
            background: showAllFromTile ? "#0f0f0f" : "#1e1a0e",
            border: `1px solid ${showAllFromTile ? "#2a2a2a" : "#f5c84233"}`,
            borderRadius: 10,
            marginBottom: 14,
          }}>
            <span style={{ fontSize: 18 }}>{tileContext.tileEmoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize: 12, color: "#f0ece4" }}>
                {showAllFromTile ? "Showing all ingredients" : `Showing ${tileContext.tileLabel.toLowerCase()}`}
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.06em", marginTop: 2 }}>
                {showAllFromTile ? "TAP BELOW TO FILTER BACK TO TILE" : "DON'T SEE WHAT YOU WANT?"}
              </div>
            </div>
            <button
              onClick={() => { setShowAllFromTile(v => !v); setDrillHub(null); setSearch(""); }}
              style={{
                padding:"6px 10px",
                background:"transparent",
                border:`1px solid ${showAllFromTile ? "#f5c84244" : "#2a2a2a"}`,
                borderRadius: 8,
                fontFamily:"'DM Mono',monospace",
                fontSize: 10,
                color: showAllFromTile ? "#f5c842" : "#888",
                letterSpacing:"0.06em",
                cursor:"pointer",
                flexShrink: 0,
              }}
            >
              {showAllFromTile ? "FILTER" : "SHOW ALL"}
            </button>
          </div>
        )}

        {/* Mode toggle */}
        <div style={{ display:"flex", gap:0, padding:3, background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:10, marginBottom:16 }}>
          <button
            onClick={() => setMode("canonical")}
            style={{ flex:1, padding:"8px", background: mode==="canonical"?"#1e1e1e":"transparent", border:"none", borderRadius:7, fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:600, color: mode==="canonical"?"#f5c842":"#666", cursor:"pointer", letterSpacing:"0.08em" }}
          >
            FROM LIST
          </button>
          <button
            onClick={() => setMode("custom")}
            style={{ flex:1, padding:"8px", background: mode==="custom"?"#1e1e1e":"transparent", border:"none", borderRadius:7, fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:600, color: mode==="custom"?"#f5c842":"#666", cursor:"pointer", letterSpacing:"0.08em" }}
          >
            CUSTOM
          </button>
        </div>

        {mode === "canonical" ? (
          <>
            {/* Search / picked ingredient */}
            {picked ? (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, marginBottom:12 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:24 }}>{picked.emoji}</span>
                  <div>
                    <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4" }}>{picked.name}</div>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666", letterSpacing:"0.08em" }}>{picked.category.toUpperCase()}</div>
                  </div>
                </div>
                <button onClick={() => { setPicked(null); setUnitId(""); setSearch(""); }} style={{ background:"none", border:"none", color:"#666", fontSize:18, cursor:"pointer" }}>×</button>
              </div>
            ) : (
              <>
                {/* Breadcrumb when drilled into a hub */}
                {drillHub && (
                  <button
                    onClick={() => { setDrillHub(null); setSearch(""); setExpandedSubs(new Set()); }}
                    style={{ display:"flex", alignItems:"center", gap:6, background:"transparent", border:"none", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:11, letterSpacing:"0.08em", cursor:"pointer", marginBottom:10, padding:0 }}
                  >
                    ← ALL INGREDIENTS
                  </button>
                )}

                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={
                    drillHub ? `Filter ${drillHub.name.toLowerCase()}…`
                    : activeTileFilter ? `Search ${activeTileFilter.tileLabel.toLowerCase()}…`
                    : "Search ingredients…"
                  }
                  autoFocus
                  style={{ width:"100%", padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", outline:"none", marginBottom:10, boxSizing:"border-box" }}
                />

                {/* Top-level view: each category gets its own section with
                    hub tiles up top and loose ingredients as rows below. */}
                {pickerView.kind === "top" && (
                  <div style={{ marginBottom:14 }}>
                    {CATEGORY_ORDER.map(cat => {
                      const hubs = pickerView.hubs.filter(h => h.category === cat);
                      const loose = pickerView.ingredients.filter(i => i.category === cat);
                      if (hubs.length === 0 && loose.length === 0) return null;
                      return (
                        <div key={cat} style={{ marginBottom:18 }}>
                          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:8 }}>
                            {CATEGORY_LABELS[cat] || cat.toUpperCase()}
                          </div>
                          {hubs.length > 0 && (
                            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom: loose.length > 0 ? 8 : 0 }}>
                              {hubs.map(h => (
                                <button
                                  key={h.id}
                                  onClick={() => setDrillHub(h)}
                                  style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"14px 6px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, cursor:"pointer" }}
                                >
                                  <span style={{ fontSize:26 }}>{h.emoji}</span>
                                  <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#f0ece4" }}>{h.name}</span>
                                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555" }}>{membersOfHub(h.id).length} types</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {loose.length > 0 && (
                            <div style={{ border:"1px solid #1e1e1e", borderRadius:10 }}>
                              {loose.map(i => (
                                <IngredientRow key={i.id} ing={i} onPick={pickIngredient} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Filtered-to-nothing empty state — kicks in when the
                        current tile has no canonical ingredients in the
                        registry yet. Points the user at Custom mode or
                        the "Show all" escape hatch in the banner above. */}
                    {activeTileFilter && pickerView.hubs.length === 0 && pickerView.ingredients.length === 0 && (
                      <div style={{ padding:"22px 18px", textAlign:"center", background:"#0c0c0c", border:"1px dashed #222", borderRadius:12 }}>
                        <div style={{ fontSize: 30, marginBottom: 8, opacity: 0.7 }}>{activeTileFilter.tileEmoji}</div>
                        <div style={{ fontFamily:"'Fraunces',serif", fontStyle:"italic", fontSize: 16, color:"#888", marginBottom: 6 }}>
                          No {activeTileFilter.tileLabel.toLowerCase()} in the library yet
                        </div>
                        <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize: 12, color:"#555", lineHeight: 1.5 }}>
                          Switch to <b>Custom</b> to add your own, or tap <b>Show all</b> above to browse every ingredient.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Drilled into a specific hub. If the hub's members carry a
                    `subcategory` (Cheese does — Fresh / Soft Ripened / Blue /
                    etc.), group them under those headers; otherwise show a
                    flat list. */}
                {pickerView.kind === "drill" && (() => {
                  if (pickerView.members.length === 0) {
                    return (
                      <div style={{ padding:"14px", color:"#666", fontFamily:"'DM Sans',sans-serif", fontSize:13, textAlign:"center", border:"1px solid #1e1e1e", borderRadius:10, marginBottom:14 }}>
                        No match in {pickerView.hub.name.toLowerCase()}.
                      </div>
                    );
                  }
                  const hasSubs = pickerView.members.some(m => m.subcategory);
                  // When the user is typing a filter, flatten — they're
                  // looking for something specific, not browsing categories.
                  const q = search.trim().toLowerCase();
                  if (!hasSubs || q) {
                    return (
                      <div style={{ maxHeight:340, overflowY:"auto", border:"1px solid #1e1e1e", borderRadius:10, marginBottom:14 }}>
                        {pickerView.members.map(m => (
                          <IngredientRow key={m.id} ing={m} onPick={setDetailIngredient} useShortName />
                        ))}
                      </div>
                    );
                  }
                  // Group by subcategory, preserving registry order.
                  const groups = [];
                  const bySub = new Map();
                  for (const m of pickerView.members) {
                    const key = m.subcategory || "Other";
                    if (!bySub.has(key)) {
                      bySub.set(key, []);
                      groups.push(key);
                    }
                    bySub.get(key).push(m);
                  }
                  return (
                    <div style={{ maxHeight:420, overflowY:"auto", marginBottom:14, display:"flex", flexDirection:"column", gap:8 }}>
                      {groups.map(sub => {
                        const members = bySub.get(sub);
                        const open = expandedSubs.has(sub);
                        const sample = members.slice(0, 3).map(m => m.emoji).join(" ");
                        return (
                          <div key={sub} style={{ border:`1px solid ${open?"#2a2a2a":"#1e1e1e"}`, borderRadius:12, background:"#141414", overflow:"hidden" }}>
                            <button
                              onClick={() => toggleSub(sub)}
                              style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"14px 14px", background: open?"#1a1a1a":"transparent", border:"none", textAlign:"left", cursor:"pointer", color:"#ddd" }}
                            >
                              <span style={{ fontSize:22, flexShrink:0 }}>{sample}</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontFamily:"'Fraunces',serif", fontSize:16, color:"#f0ece4", fontWeight:400 }}>{sub}</div>
                                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", letterSpacing:"0.08em", marginTop:2 }}>
                                  {members.length} {members.length === 1 ? "type" : "types"}
                                </div>
                              </div>
                              <span style={{ color:"#f5c842", fontSize:16, transition:"transform 0.15s", transform: open?"rotate(90deg)":"rotate(0deg)" }}>›</span>
                            </button>
                            {open && (
                              <div style={{ borderTop:"1px solid #1e1e1e" }}>
                                {members.map(m => (
                                  <IngredientRow key={m.id} ing={m} onPick={setDetailIngredient} useShortName />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Free-text search across everything (including hub children) */}
                {pickerView.kind === "search" && (
                  <div style={{ maxHeight:260, overflowY:"auto", border:"1px solid #1e1e1e", borderRadius:10, marginBottom:14 }}>
                    {pickerView.hubs.map(h => (
                      <button
                        key={h.id}
                        onClick={() => { setDrillHub(h); setSearch(""); }}
                        style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"transparent", border:"none", borderBottom:"1px solid #1a1a1a", textAlign:"left", cursor:"pointer", color:"#ddd" }}
                      >
                        <span style={{ fontSize:20 }}>{h.emoji}</span>
                        <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, flex:1 }}>{h.name}</span>
                        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.08em" }}>{membersOfHub(h.id).length} TYPES →</span>
                      </button>
                    ))}
                    {pickerView.ingredients.map(i => (
                      <IngredientRow key={i.id} ing={i} onPick={pickIngredient} />
                    ))}
                    {pickerView.hubs.length === 0 && pickerView.ingredients.length === 0 && (
                      <div style={{ padding:"14px", color:"#666", fontFamily:"'DM Sans',sans-serif", fontSize:13, textAlign:"center" }}>
                        No match. Try Custom →
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Amount + Unit (only visible once an ingredient is picked) */}
            {picked && (
              <>
                <div style={{ display:"flex", gap:10, marginBottom:10 }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="Amount"
                    autoFocus
                    style={{ flex:1, padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:14, color:"#f0ece4", outline:"none", boxSizing:"border-box" }}
                  />
                  <select
                    value={unitId}
                    onChange={e => setUnitId(e.target.value)}
                    style={{ flex:1, padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:14, color:"#f0ece4", outline:"none", appearance:"none", cursor:"pointer" }}
                  >
                    {unitOptions.map(u => (
                      <option key={u.id} value={u.id} style={{ background:"#141414" }}>{u.label}</option>
                    ))}
                  </select>
                </div>
                {estCents != null && (
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#888", letterSpacing:"0.08em", marginBottom:20 }}>
                    EST. ${(estCents/100).toFixed(2)} — typical retail
                  </div>
                )}
                {estCents == null && <div style={{ marginBottom:20 }} />}
              </>
            )}
          </>
        ) : (
          <>
            {/* Custom mode — emoji is auto-assigned (🥫) since the picker
                rarely worked on iOS keyboards anyway. Users can change the
                name freely; the emoji stays consistent for custom items. */}
            <div style={{ marginBottom:12 }}>
              <input
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="Name (e.g. Capers)"
                style={{ width:"100%", padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", outline:"none", boxSizing:"border-box" }}
              />
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

            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#666", marginBottom:16, fontStyle:"italic" }}>
              Custom items won't match recipes — pick from the list when possible.
            </p>
          </>
        )}

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
      </div>

      {/* Detail sheet sits on top of the picker modal. "+ Add to Pantry" here
          promotes the ingredient to `picked` so the amount/unit step appears
          behind it when the sheet closes. */}
      {detailIngredient && (
        <IngredientDetailSheet
          ingredient={detailIngredient}
          onClose={() => setDetailIngredient(null)}
          onAdd={(ing) => { pickIngredient(ing); setDetailIngredient(null); }}
        />
      )}
    </div>
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
export default function Pantry({ userId, pantry, setPantry, shoppingList, setShoppingList, view = "stock", setView }) {
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
  // Row currently showing the "move to other location" inline picker.
  // Null = closed; otherwise the row's id. Only one moving picker open
  // at a time — mirrors the edit/expiry single-editor pattern.
  const [movingItemId, setMovingItemId] = useState(null);
  // Tapping a pantry row opens IngredientCard with rich metadata. Null when
  // the card is closed; otherwise { ingredientId, fallbackName, fallbackEmoji }.
  const [cardIng, setCardIng] = useState(null);
  // Convert-state modal. Set to a pantry item to open; null to close.
  // Drives the "Make crumbs from loaf" / "Shred this block" flow — the
  // user picks a target state + enters how much it yielded, we decrement
  // the source row and insert a new row with the target state.
  const [convertingItem, setConvertingItem] = useState(null);
  // Bumped after each successful scan so the monthly-spend banner re-queries.
  const [spendRefresh, setSpendRefresh] = useState(0);
  const monthlySpend = useMonthlySpend(userId, spendRefresh);
  const { push: pushToast } = useToast();

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
    if (userId) {
      const { error } = await supabase.from("receipts").insert({
        user_id: userId,
        store_name: meta.store || null,
        receipt_date: meta.date || null,
        total_cents: typeof meta.totalCents === "number" ? meta.totalCents : null,
        item_count: items.length,
      });
      if (error) console.warn("[receipts] insert failed:", error.message);
      else setSpendRefresh(k => k + 1);
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

        const ex = s.ingredientId
          ? next.find(p => p.ingredientId === s.ingredientId)
          : next.find(p => p.name.toLowerCase() === s.name.toLowerCase());
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

          // Backfill ingredientId if the existing row was free-text — lets a
          // fresh scan "upgrade" an older untagged row to canonical.
          if (!ex.ingredientId && s.ingredientId) ex.ingredientId = s.ingredientId;
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
      pushToast(`${unitMismatchCount} item${unitMismatchCount === 1 ? "" : "s"} had a unit mismatch — check the pantry`, { emoji: "⚠️", kind: "warn" });
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
    // Inside a hub we already know the "family" (🍗 Chicken), so show the
    // ingredient's short name ("Breast") instead of the full "Chicken Breast".
    const displayName = canon?.shortName && canon.parentId ? canon.shortName : item.name;
    // Only canonical-id rows are tappable — free-text rows have no metadata
    // to show in IngredientCard. Tapping anywhere on the row body opens the
    // card; the inline edit/trash controls stop propagation so they still
    // work normally.
    const tappable = !!item.ingredientId && !isEditing;
    const openCard = () => setCardIng({
      ingredientId: item.ingredientId,
      fallbackName: item.name,
      fallbackEmoji: item.emoji,
    });
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
                <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{displayName}</span>
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
                {tappable && <span style={{ color:"#444", fontSize:11 }}>ⓘ</span>}
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
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#444" }}>{(item.category || "").toUpperCase()}</span>
              {item.priceCents != null && (
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7ec87e" }} title="Last paid price">
                  {formatPrice(item.priceCents)}
                </span>
              )}
              {!item.ingredientId && (
                <button
                  onClick={e => { e.stopPropagation(); setLinkingItem(item); }}
                  aria-label={`Link ${item.name} to a canonical ingredient`}
                  title="Tap to match this with a canonical ingredient — free-text rows don't match recipes"
                  style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#a3c9e0", background:"#0f1420", border:"1px solid #1e2a3a", padding:"1px 6px", borderRadius:4, cursor:"pointer" }}
                >
                  🔗 LINK
                </button>
              )}
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
            onClick={e => { e.stopPropagation(); removePantryItem(item.id); }}
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

  if (scanning) return <Scanner onItemsScanned={addScannedItems} onClose={() => setScanning(false)} />;

  return (
    <div style={{ minHeight:"100vh", paddingBottom:100 }}>
      <div style={{ padding:"24px 20px 0" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em", marginBottom:6 }}>YOUR</div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
          <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:38, fontWeight:300, fontStyle:"italic", color:"#f0ece4", letterSpacing:"-0.03em" }}>
            {view === "shopping" ? "Shopping" : "Pantry"}
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

      {/* Monthly groceries — only when there's been any spend recorded */}
      {!monthlySpend.loading && monthlySpend.cents > 0 && (
        <div style={{ margin:"14px 20px 0", padding:"10px 14px", background:"#0f140f", border:"1px solid #1e3a1e", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#4ade80", letterSpacing:"0.12em" }}>GROCERIES THIS MONTH</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#666", marginTop:2 }}>{monthlySpend.receiptCount} receipt{monthlySpend.receiptCount === 1 ? "" : "s"}</div>
          </div>
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, color:"#7ec87e", fontStyle:"italic" }}>
            ${(monthlySpend.cents / 100).toFixed(2)}
          </div>
        </div>
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
                TAP ✓ WHEN YOU'VE PICKED IT UP — IT'LL MOVE TO YOUR PANTRY
              </div>
            </div>
          )}
        </>
      )}

      {addingTo && (
        <AddItemModal
          target={addingTo}
          tileContext={addingTo === "pantry" ? addingToTile : null}
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
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:20 }}>Deduct these from your pantry?</p>
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
          onLink={canonicalId => {
            // Link sets the ingredientId + adopts the canonical emoji so the
            // row visibly snaps into place. Name stays the user's (don't
            // overwrite what they typed). category too — linking is about
            // recipe-matching, not relabeling.
            const canon = findIngredient(canonicalId);
            updatePantryItem(linkingItem.id, {
              ingredientId: canonicalId,
              emoji: canon?.emoji || linkingItem.emoji,
            });
            setLinkingItem(null);
          }}
          onClose={() => setLinkingItem(null)}
        />
      )}
    </div>
  );
}
