import { useState, useRef, useMemo } from "react";
import { INGREDIENTS, findIngredient, unitLabel } from "../data/ingredients";
import { supabase } from "../lib/supabase";
import { useMonthlySpend } from "../lib/useMonthlySpend";

// Compact registry shape we send to the scan-receipt Edge Function. The model
// needs just enough to emit correct `ingredientId` + unit values; units are
// stringified to their ids only (the Claude prompt doesn't need toBase math).
const INGREDIENTS_FOR_SCAN = INGREDIENTS.map(i => ({
  id: i.id,
  name: i.name,
  category: i.category,
  units: i.units.map(u => u.id),
}));

const CATEGORIES = [
  { id:"all", label:"All" }, { id:"dairy", label:"🥛 Dairy" },
  { id:"produce", label:"🥬 Produce" }, { id:"dry", label:"🌾 Dry" },
  { id:"meat", label:"🍗 Meat" }, { id:"pantry", label:"🫙 Pantry" },
  { id:"frozen", label:"🧊 Frozen" },
];

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

// ── Receipt Scanner ───────────────────────────────────────────────────────────
function ReceiptScanner({ onItemsScanned, onClose }) {
  const [phase, setPhase] = useState("upload");
  const [imageData, setImageData] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [scannedItems, setScannedItems] = useState([]);
  const [receiptMeta, setReceiptMeta] = useState({ store: null, date: null, totalCents: null });
  const [editingIdx, setEditingIdx] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef();

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

  const scanReceipt = async () => {
    setPhase("scanning"); setError(null);
    try {
      // Server-side call: Supabase forwards the caller's JWT, and the Edge
      // Function holds ANTHROPIC_API_KEY so it never ships to the browser.
      const { data, error: fnError } = await supabase.functions.invoke("scan-receipt", {
        body: {
          image: imageData.base64,
          mediaType: imageData.mediaType,
          ingredients: INGREDIENTS_FOR_SCAN,
        },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) { setError("No grocery items found. Try a clearer photo."); setPhase("ready"); return; }

      setReceiptMeta({
        store: data?.store ?? null,
        date: data?.date ?? null,
        totalCents: typeof data?.totalCents === "number" ? data.totalCents : null,
      });

      // If the model matched a canonical ingredient, overlay the registry's
      // name/emoji/category so the confirm UI is consistent with the rest of
      // the app (and we know the unit is one of the valid ids).
      const normalized = items.map((item, i) => {
        const canon = findIngredient(item.ingredientId);
        return {
          ...item,
          name: canon ? canon.name : item.name,
          emoji: canon ? canon.emoji : (item.emoji || "🥫"),
          category: canon ? canon.category : (item.category || "pantry"),
          priceCents: typeof item.priceCents === "number" ? item.priceCents : null,
          id: i,
          selected: true,
        };
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
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em" }}>SCAN RECEIPT</div>
        <div style={{ width:28 }} />
      </div>

      {(phase === "upload" || phase === "ready") && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"24px 20px 40px" }}>
          <div style={{ marginBottom:28 }}>
            <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:32, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>Got groceries?</h2>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#666" }}>Photo your receipt and we'll stock your pantry automatically.</p>
          </div>
          <div onClick={() => fileRef.current?.click()} style={{ flex:1, border:`2px dashed ${imagePreview?"#f5c84255":"#2a2a2a"}`, borderRadius:20, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", background: imagePreview?"#0f0d08":"#0f0f0f", overflow:"hidden", position:"relative", minHeight:280, transition:"all 0.3s" }}>
            {imagePreview ? (
              <>
                <img src={imagePreview} alt="Receipt" style={{ width:"100%", height:"100%", objectFit:"contain", maxHeight:400 }} />
                <div style={{ position:"absolute", bottom:12, right:12, background:"#f5c842", borderRadius:8, padding:"6px 12px", fontFamily:"'DM Mono',monospace", fontSize:10, color:"#111", fontWeight:600 }}>TAP TO CHANGE</div>
              </>
            ) : (
              <>
                <div style={{ fontSize:48, marginBottom:16 }}>🧾</div>
                <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:"#555", fontStyle:"italic" }}>Tap to upload receipt</div>
                <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#444", marginTop:4 }}>Photo or screenshot works</div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])} />
          {error && <div style={{ marginTop:12, padding:"12px 14px", background:"#1a0f0f", border:"1px solid #3a1a1a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#f87171" }}>{error}</div>}
          <button onClick={imagePreview ? scanReceipt : ()=>fileRef.current?.click()} style={{ marginTop:20, width:"100%", padding:"16px", background: imagePreview?"#f5c842":"#1a1a1a", color: imagePreview?"#111":"#444", border:"none", borderRadius:14, fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer", transition:"all 0.3s", boxShadow: imagePreview?"0 0 30px #f5c84233":"none" }}>
            {imagePreview ? "SCAN WITH AI →" : "CHOOSE PHOTO"}
          </button>
        </div>
      )}

      {phase === "scanning" && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:40, textAlign:"center" }}>
          {imagePreview && (
            <div style={{ width:120, height:160, borderRadius:12, overflow:"hidden", marginBottom:28, position:"relative", border:"1px solid #2a2a2a" }}>
              <img src={imagePreview} alt="Receipt" style={{ width:"100%", height:"100%", objectFit:"cover", filter:"brightness(0.4)" }} />
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div style={{ width:40, height:40, borderRadius:"50%", border:"3px solid #f5c842", borderTopColor:"transparent", animation:"spin 0.8s linear infinite" }} />
              </div>
            </div>
          )}
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:24, color:"#f0ece4", fontStyle:"italic", marginBottom:8 }}>Reading your receipt...</div>
          <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#555" }}>Claude is scanning every item</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {phase === "confirm" && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"20px 20px 40px", minHeight:0 }}>
          <div style={{ marginBottom:20, flexShrink:0 }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4ade80", letterSpacing:"0.15em", marginBottom:6 }}>✓ FOUND {scannedItems.length} ITEMS</div>
            <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:26, fontWeight:300, fontStyle:"italic", color:"#f0ece4" }}>Look right?</h2>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginTop:4 }}>Deselect anything wrong. Tap amounts to edit.</p>
            {(receiptMeta.store || receiptMeta.date || receiptMeta.totalCents != null) && (
              <div style={{ marginTop:10, padding:"8px 12px", background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:8, display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                {receiptMeta.store && <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#f0ece4" }}>{receiptMeta.store}</span>}
                {receiptMeta.date && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>{receiptMeta.date}</span>}
                {receiptMeta.totalCents != null && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#f5c842", marginLeft:"auto" }}>{formatPrice(receiptMeta.totalCents)}</span>}
              </div>
            )}
          </div>
          <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:8, minHeight:0, WebkitOverflowScrolling:"touch" }}>
            {scannedItems.map((item, idx) => {
              const canon = findIngredient(item.ingredientId);
              const unitDisplay = canon ? unitLabel(canon, item.unit) : item.unit;
              return (
                <div key={idx} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:12, background: item.selected?"#161616":"#0f0f0f", border:`1px solid ${item.selected?"#2a2a2a":"#1a1a1a"}`, opacity: item.selected?1:0.4, transition:"all 0.2s" }}>
                  <button onClick={()=>toggleItem(idx)} style={{ width:22, height:22, borderRadius:6, flexShrink:0, border:`2px solid ${item.selected?"#4ade80":"#333"}`, background: item.selected?"#4ade80":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:"#111", fontWeight:900, cursor:"pointer", transition:"all 0.2s" }}>{item.selected?"✓":""}</button>
                  <span style={{ fontSize:22, flexShrink:0 }}>{item.emoji}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#f0ece4", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</span>
                      {canon && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:8, color:"#4ade80", background:"#0f1a0f", border:"1px solid #1e3a1e", borderRadius:4, padding:"1px 5px", letterSpacing:"0.08em", flexShrink:0 }}>MATCHED</span>}
                    </div>
                    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", display:"flex", gap:8 }}>
                      <span>{item.category}</span>
                      {item.priceCents != null && <span style={{ color:"#7ec87e" }}>{formatPrice(item.priceCents)}</span>}
                    </div>
                  </div>
                  {editingIdx === idx ? (
                    <div
                      style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}
                      onBlur={e => {
                        // Only close when focus leaves the entire editor — otherwise
                        // tapping the unit select kills the editor before it registers.
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          setEditingIdx(null);
                        }
                      }}
                    >
                      <input type="number" value={item.amount} onChange={e=>updateAmount(idx,e.target.value)} autoFocus
                        style={{ width:52, background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"4px 6px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:12, textAlign:"right", outline:"none" }} />
                      {canon ? (
                        <select value={item.unit} onChange={e=>updateUnit(idx,e.target.value)}
                          style={{ background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"4px 6px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:11, outline:"none", appearance:"none", cursor:"pointer" }}>
                          {canon.units.map(u => (
                            <option key={u.id} value={u.id} style={{ background:"#141414" }}>{u.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input value={item.unit || ""} onChange={e=>updateUnit(idx,e.target.value)} placeholder="unit"
                          style={{ width:60, background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"4px 6px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:11, outline:"none" }} />
                      )}
                    </div>
                  ) : (
                    <button onClick={()=>setEditingIdx(idx)} style={{ background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:8, padding:"4px 10px", fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f5c842", cursor:"pointer", flexShrink:0 }}>
                      {item.amount} {unitDisplay}
                    </button>
                  )}
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
      )}

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
function AddItemModal({ target, onClose, onAdd }) {
  const [mode, setMode] = useState("canonical"); // "canonical" | "custom"
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(null); // ingredient from registry
  const [unitId, setUnitId] = useState("");
  const [amount, setAmount] = useState("");

  // Custom-mode fields (only used when mode === "custom")
  const [customName, setCustomName] = useState("");
  const [customEmoji, setCustomEmoji] = useState("🥫");
  const [customUnit, setCustomUnit] = useState("");
  const [customCategory, setCustomCategory] = useState("pantry");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return INGREDIENTS;
    return INGREDIENTS.filter(i => i.name.toLowerCase().includes(q));
  }, [search]);

  const pickIngredient = (ing) => {
    setPicked(ing);
    setUnitId(ing.defaultUnit);
  };

  const canSaveCanonical = picked && amount !== "" && unitId;
  const canSaveCustom = customName.trim() && amount !== "" && customUnit.trim();
  const canSave = mode === "canonical" ? canSaveCanonical : canSaveCustom;

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
        }
      : {
          id: crypto.randomUUID(),
          ingredientId: null,
          name: customName.trim(),
          emoji: customEmoji.trim() || "🥫",
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
          {target === "shopping" ? "+ TO SHOPPING LIST" : "+ TO PANTRY"}
        </div>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:24, color:"#f0ece4", fontWeight:300, fontStyle:"italic", marginBottom:14 }}>
          Add an ingredient
        </h3>

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
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search ingredients…"
                  autoFocus
                  style={{ width:"100%", padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", outline:"none", marginBottom:10, boxSizing:"border-box" }}
                />
                <div style={{ maxHeight:220, overflowY:"auto", border:"1px solid #1e1e1e", borderRadius:10, marginBottom:14 }}>
                  {filtered.length === 0 ? (
                    <div style={{ padding:"14px", color:"#666", fontFamily:"'DM Sans',sans-serif", fontSize:13, textAlign:"center" }}>
                      No match. Try Custom →
                    </div>
                  ) : filtered.map(i => (
                    <button
                      key={i.id}
                      onClick={() => pickIngredient(i)}
                      style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"transparent", border:"none", borderBottom:"1px solid #1a1a1a", textAlign:"left", cursor:"pointer", color:"#ddd" }}
                    >
                      <span style={{ fontSize:20 }}>{i.emoji}</span>
                      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, flex:1 }}>{i.name}</span>
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.08em" }}>{i.category.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Amount + Unit (only visible once an ingredient is picked) */}
            {picked && (
              <div style={{ display:"flex", gap:10, marginBottom:20 }}>
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
            )}
          </>
        ) : (
          <>
            {/* Custom mode */}
            <div style={{ display:"flex", gap:10, marginBottom:12 }}>
              <input
                value={customEmoji}
                onChange={e => setCustomEmoji(e.target.value)}
                maxLength={4}
                placeholder="🥫"
                style={{ width:56, textAlign:"center", padding:"12px 0", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontSize:22, color:"#f0ece4", outline:"none" }}
              />
              <input
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="Name (e.g. Capers)"
                style={{ flex:1, padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", outline:"none" }}
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
    </div>
  );
}

// ── Pantry Screen ─────────────────────────────────────────────────────────────
export default function Pantry({ userId, pantry, setPantry, shoppingList, setShoppingList, view = "stock", setView }) {
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState("all");
  const [showDeduction, setShowDeduction] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [addingTo, setAddingTo] = useState(null); // "pantry" | "shopping" | null
  // Inline amount+unit editor on a pantry card. Null when nothing is being
  // edited; otherwise holds the id of the row the user tapped.
  const [editingItemId, setEditingItemId] = useState(null);
  // Bumped after each successful scan so the monthly-spend banner re-queries.
  const [spendRefresh, setSpendRefresh] = useState(0);
  const monthlySpend = useMonthlySpend(userId, spendRefresh);

  const lowItems = pantry.filter(isLow);
  const filtered = pantry.filter(item => filter === "all" || item.category === filter);

  // Merge scanned items into the pantry. When the scanner matched a canonical
  // ingredient we merge by ingredientId (so "2 sticks butter" stacks with an
  // existing butter row even if the other has id null). Units only add when
  // they match — otherwise we just bump to the larger amount and let the user
  // sort it out in the UI. Last-paid priceCents is always overwritten with
  // the freshest receipt price.
  const addScannedItems = (items, meta = {}) => {
    setPantry(prev => {
      const next = prev.map(p => ({ ...p }));
      items.forEach(s => {
        const ex = s.ingredientId
          ? next.find(p => p.ingredientId === s.ingredientId)
          : next.find(p => p.name.toLowerCase() === s.name.toLowerCase());
        if (ex) {
          if (ex.unit === s.unit) {
            ex.amount = ex.amount + s.amount;
            ex.max = Math.max(ex.max, ex.amount);
          } else {
            // Unit mismatch — keep the receipt's fresher amount if larger.
            ex.amount = Math.max(ex.amount, s.amount);
          }
          // Backfill ingredientId if the existing row was free-text.
          if (!ex.ingredientId && s.ingredientId) ex.ingredientId = s.ingredientId;
          if (s.priceCents != null) ex.priceCents = s.priceCents;
        } else {
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
            priceCents: s.priceCents ?? null,
          });
        }
      });
      return next;
    });

    // Persist the receipt as its own record. Fire-and-forget — if it fails
    // we swallow it (the pantry update is the important part).
    if (userId) {
      supabase.from("receipts").insert({
        user_id: userId,
        store_name: meta.store || null,
        receipt_date: meta.date || null,
        total_cents: typeof meta.totalCents === "number" ? meta.totalCents : null,
        item_count: items.length,
      }).then(({ error }) => {
        if (error) console.warn("[receipts] insert failed:", error.message);
        else setSpendRefresh(k => k + 1);
      });
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

  if (scanning) return <ReceiptScanner onItemsScanned={addScannedItems} onClose={() => setScanning(false)} />;

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

          {/* Scan CTA */}
          <div onClick={()=>setScanning(true)} style={{ margin:"16px 20px 0", padding:"18px 20px", background:"linear-gradient(135deg,#1e1a0e 0%,#141008 100%)", border:"1px solid #f5c84233", borderRadius:16, cursor:"pointer", display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ fontSize:36 }}>🧾</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:"#f0ece4", fontWeight:400, marginBottom:3 }}>Scan a receipt</div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666" }}>Photo your grocery receipt → pantry auto-stocks</div>
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

          {/* Filters */}
          <div style={{ display:"flex", gap:8, padding:"18px 20px 0", overflowX:"auto", scrollbarWidth:"none" }}>
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={()=>setFilter(c.id)} style={{ background: filter===c.id?"#f5c842":"#161616", border:`1px solid ${filter===c.id?"#f5c842":"#2a2a2a"}`, borderRadius:20, padding:"7px 14px", whiteSpace:"nowrap", fontFamily:"'DM Sans',sans-serif", fontSize:12, color: filter===c.id?"#111":"#888", cursor:"pointer", transition:"all 0.2s", flexShrink:0 }}>{c.label}</button>
            ))}
          </div>

          {/* Items */}
          <div style={{ padding:"14px 20px 0", display:"flex", flexDirection:"column", gap:8 }}>
            {filtered.map(item => {
              const canon = findIngredient(item.ingredientId);
              const isEditing = editingItemId === item.id;
              return (
                <div key={item.id} style={{ background:"#141414", border:`1px solid ${isCritical(item)?"#ef444422":isLow(item)?"#f59e0b22":"#1e1e1e"}`, borderRadius:14, padding:"14px 16px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                    <span style={{ fontSize:26, flexShrink:0 }}>{item.emoji}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                        <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</span>
                        {isEditing ? (
                          <div
                            style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}
                            // Close the editor only when focus leaves the whole
                            // container — otherwise tabbing from the number
                            // input to the unit select kills the editor before
                            // the select can even open.
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
                            {canon ? (
                              <select
                                value={item.unit}
                                onChange={e => updatePantryItem(item.id, { unit: e.target.value })}
                                style={{ background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"4px 4px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:11, outline:"none", appearance:"none", cursor:"pointer" }}
                              >
                                {canon.units.map(u => (
                                  <option key={u.id} value={u.id} style={{ background:"#141414" }}>{u.label}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                value={item.unit}
                                onChange={e => updatePantryItem(item.id, { unit: e.target.value })}
                                placeholder="unit"
                                style={{ width:60, background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"4px 6px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:11, outline:"none" }}
                              />
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingItemId(item.id)}
                            aria-label={`Edit amount of ${item.name}`}
                            style={{ background:"transparent", border:"1px dashed #2a2a2a", borderRadius:8, padding:"2px 8px", fontFamily:"'DM Mono',monospace", fontSize:12, color:barColor(item), cursor:"pointer", flexShrink:0 }}
                          >
                            {fmt(item)}
                          </button>
                        )}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}>
                        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#444" }}>{item.category.toUpperCase()}</span>
                        {item.priceCents != null && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7ec87e" }} title="Last paid price">
                            {formatPrice(item.priceCents)}
                          </span>
                        )}
                        {!item.ingredientId && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666", background:"#1a1a1a", padding:"1px 6px", borderRadius:4 }} title="Not linked to the canonical ingredient list — won't match recipes">
                            FREE TEXT
                          </span>
                        )}
                        {isLow(item) && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color: isCritical(item)?"#ef4444":"#f59e0b", background: isCritical(item)?"#ef444422":"#f59e0b22", padding:"1px 6px", borderRadius:4 }}>
                            {isCritical(item)?"ALMOST OUT":"RUNNING LOW"}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removePantryItem(item.id)}
                      aria-label={`Remove ${item.name}`}
                      style={{ background:"none", border:"none", color:"#333", fontSize:16, cursor:"pointer", padding:4, flexShrink:0 }}
                      onMouseOver={e => e.currentTarget.style.color = "#ef4444"}
                      onMouseOut={e => e.currentTarget.style.color = "#333"}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ height:4, background:"#1e1e1e", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ height:"100%", borderRadius:2, width:`${pct(item)}%`, background:barColor(item), boxShadow:`0 0 8px ${barColor(item)}66`, transition:"width 0.6s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
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
          onClose={() => setAddingTo(null)}
          onAdd={item => {
            if (addingTo === "shopping") {
              setShoppingList(prev => [...prev, { ...item, source: "manual" }]);
            } else {
              setPantry(prev => [...prev, item]);
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
    </div>
  );
}
