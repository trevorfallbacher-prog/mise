// Shop Mode checkout — the dedicated receipt step that closes a trip.
//
// Replaces the generic Scanner that used to mount when the user hit
// DONE in ShopMode. That flow treated the receipt OCR as the source
// of truth for WHAT was bought, then tried to back-fill OFF identity
// from the trip scans. Now it's flipped: the trip scans ARE the
// source (they carry OFF brand + canonical + UPC from real-time
// scanning), and the receipt only contributes price + store +
// receipt_id provenance.
//
// Phases:
//   summary    — review trip scans, choose to attach a receipt or skip
//   capturing  — native file picker fires; waits for an image
//   parsing    — scan-receipt edge fn is resolving store/lines/total
//   review     — show scans with receipt prices attached, total
//   committing — writing receipts, pantry_items, shopping list, trip
//   done       — caller (Kitchen) tears the component down
//
// Skip-receipt path is always available — pantry rows still land with
// full identity, just without prices.

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { compressImage } from "../lib/compressImage";

const FLASH_COLORS = {
  green:  { bg: "#1f6b3a", label: "MATCHED" },
  yellow: { bg: "#b88a1f", label: "NEEDS IDENTITY" },
  red:    { bg: "#8a3030", label: "NO DATA" },
};

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return new Set(normalizeName(s).split(" ").filter(t => t.length >= 3));
}

// Match a trip_scan to a receipt line. UPC direct match wins; else
// productName/brand ↔ rawText token overlap.
function matchScanToReceiptLine(scan, receiptLines, claimed) {
  // UPC first — some US receipts (Costco, Target) DO include UPCs.
  if (scan.barcodeUpc) {
    const byUpc = receiptLines.findIndex(
      (line, i) => !claimed.has(i) && line?.barcode === scan.barcodeUpc,
    );
    if (byUpc >= 0) return byUpc;
  }
  // Token overlap on productName + brand vs receipt rawText + name.
  const scanText = [scan.productName, scan.brand].filter(Boolean).join(" ");
  const scanToks = tokens(scanText);
  if (scanToks.size === 0) return -1;
  let best = -1;
  let bestShared = 0;
  for (let i = 0; i < receiptLines.length; i++) {
    if (claimed.has(i)) continue;
    const line = receiptLines[i];
    const lineToks = tokens([line?.rawText, line?.name].filter(Boolean).join(" "));
    let shared = 0;
    for (const t of lineToks) if (scanToks.has(t)) shared++;
    if (shared > bestShared) {
      bestShared = shared;
      best = i;
    }
  }
  return bestShared > 0 ? best : -1;
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export default function ShopModeCheckout({
  trip,
  scans = [],
  userId,
  shoppingList = [],
  setShoppingList,
  onDone,
  onCancel,
}) {
  const [phase, setPhase] = useState("summary"); // summary | capturing | parsing | review | committing | done
  const [error, setError] = useState(null);
  const [imageData, setImageData] = useState(null); // { base64, mediaType, previewUrl }
  const [receiptMeta, setReceiptMeta] = useState({ store: null, date: null, totalCents: null });
  const [receiptLines, setReceiptLines] = useState([]);
  // Map<scanId, { priceCents, lineIndex }> — which receipt line
  // each scan paired to, and what price to stamp on the pantry row.
  const [priceByScan, setPriceByScan] = useState(new Map());

  async function handlePhotoSelect(e) {
    const file = e?.target?.files?.[0];
    if (e?.target) e.target.value = "";
    if (!file) return;
    setError(null);
    setPhase("parsing");
    try {
      const compressed = await compressImage(file);
      const mediaType = compressed?.blob?.type || file.type || "image/jpeg";
      const blob = compressed?.blob || file;
      const base64 = await fileToBase64(blob);
      const previewUrl = URL.createObjectURL(blob);
      setImageData({ base64, mediaType, previewUrl });

      // Invoke scan-receipt. Pass a minimal ingredients registry — the
      // edge fn expects one but we don't rely on its canonical
      // matching (trip scans already carry canonicals from OFF). A
      // tiny stub keeps the prompt shape happy.
      const { data, error: fnErr } = await supabase.functions.invoke("scan-receipt", {
        body: {
          image: base64,
          mediaType,
          ingredients: [],
        },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);

      const lines = Array.isArray(data?.items) ? data.items : [];
      setReceiptLines(lines);
      setReceiptMeta({
        store:      data?.store ?? null,
        date:       data?.date ?? null,
        totalCents: typeof data?.totalCents === "number" ? data.totalCents : null,
      });

      // Pair trip_scans to receipt lines for price attachment.
      const claimed = new Set();
      const prices = new Map();
      for (const scan of scans) {
        const idx = matchScanToReceiptLine(scan, lines, claimed);
        if (idx >= 0) {
          claimed.add(idx);
          prices.set(scan.id, {
            priceCents: typeof lines[idx].priceCents === "number" ? lines[idx].priceCents : null,
            lineIndex:  idx,
          });
        }
      }
      setPriceByScan(prices);
      setPhase("review");
    } catch (e) {
      console.warn("[shop-checkout] parse failed:", e);
      setError(e?.message || "Couldn't read that receipt. Try another photo.");
      setPhase("summary");
    }
  }

  async function doCommit({ withReceipt }) {
    if (!trip?.id || !userId) return;
    setPhase("committing");
    setError(null);

    let receiptId = null;
    try {
      // 1. Insert the receipts row (when we have an image).
      if (withReceipt && imageData) {
        const scanItemsSnapshot = scans.map(s => ({
          name:          s.productName || s.brand || s.barcodeUpc,
          rawText:       s.productName,
          brand:         s.brand,
          barcode:       s.barcodeUpc,
          canonicalId:   s.canonicalId,
          ingredientIds: s.canonicalId ? [s.canonicalId] : [],
          priceCents:    priceByScan.get(s.id)?.priceCents ?? null,
        }));
        const { data: rec, error: recErr } = await supabase.from("receipts").insert({
          user_id: userId,
          store_name: receiptMeta.store,
          receipt_date: /^\d{4}-\d{2}-\d{2}$/.test(String(receiptMeta.date || ""))
            ? receiptMeta.date
            : null,
          total_cents: typeof receiptMeta.totalCents === "number" ? receiptMeta.totalCents : null,
          item_count: scans.length,
          scan_items: scanItemsSnapshot,
        }).select("id").single();
        if (recErr) throw recErr;
        receiptId = rec?.id || null;

        // Upload image into scans bucket (best-effort).
        if (receiptId) {
          try {
            const ext = (imageData.mediaType || "image/jpeg").split("/")[1]?.split(";")[0] || "jpg";
            const path = `${userId}/${receiptId}.${ext}`;
            const bin = atob(imageData.base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: imageData.mediaType });
            const { error: upErr } = await supabase.storage
              .from("scans")
              .upload(path, blob, { contentType: imageData.mediaType, upsert: true });
            if (!upErr) {
              await supabase.from("receipts").update({ image_path: path }).eq("id", receiptId);
            }
          } catch (e) {
            console.warn("[shop-checkout] image upload failed:", e);
          }
        }
      }

      // 2a. Cache brand_nutrition rows for green scans so future
      //     scans of the same (brand, canonical) hit the local cache
      //     instead of round-tripping OFF. One row per unique
      //     (brand, canonical) in this trip — upsert is keyed on
      //     that pair so re-writes are safe.
      const brandCacheSeen = new Set();
      for (const scan of scans) {
        if (!scan.canonicalId || !scan.brand) continue;
        const off = scan.offPayload || {};
        const nutrition = off.nutrition;
        if (!nutrition || Object.keys(nutrition).length === 0) continue;
        const key = `${scan.canonicalId}::${String(scan.brand).toLowerCase()}`;
        if (brandCacheSeen.has(key)) continue;
        brandCacheSeen.add(key);
        try {
          await supabase.from("brand_nutrition").upsert({
            canonical_id:  scan.canonicalId,
            brand:         String(scan.brand).trim().toLowerCase(),
            display_brand: scan.brand,
            nutrition,
            barcode:       scan.barcodeUpc || null,
            source:        off.source || "openfoodfacts",
            source_id:     off.sourceId || null,
            confidence:    80,
          }, { onConflict: "canonical_id,brand" });
        } catch (e) {
          console.warn("[shop-checkout] brand_nutrition upsert skipped:", e?.message || e);
        }
      }

      // 2b. Create pantry_items from trip_scans (one row per scan,
      //     amount = qty). trip_scans are the identity source here.
      const nowIso = new Date().toISOString();
      const newPantryIds = new Map(); // scanId → pantry_items.id
      for (const scan of scans) {
        const priceInfo = priceByScan.get(scan.id);
        const id = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const row = {
          id,
          user_id: userId,
          name:           scan.productName || scan.brand || `UPC ${scan.barcodeUpc}`,
          emoji:          "🛒",
          amount:         scan.qty || 1,
          unit:           "package",
          max:            null,
          category:       "pantry",
          low_threshold:  null,
          // Composition array (migration 0056 renamed ingredient_ids
          // → components). ingredient_id stays as the scalar mirror
          // so legacy readers still resolve identity.
          ingredient_id:  scan.canonicalId || null,
          components:     scan.canonicalId ? [scan.canonicalId] : null,
          canonical_id:   scan.canonicalId || null,
          brand:          scan.brand || null,
          barcode_upc:    scan.barcodeUpc || null,
          price_cents:    priceInfo?.priceCents ?? null,
          source_receipt_id: receiptId,
          source_shopping_list_item_id: scan.pairedShoppingListItemId || null,
          location:       "pantry",
          purchased_at:   nowIso,
        };
        const { error: piErr } = await supabase.from("pantry_items").insert(row);
        if (piErr) {
          console.warn("[shop-checkout] pantry insert failed:", piErr.message, { scan });
          // Continue — one failed row shouldn't break the rest of the commit.
        } else {
          newPantryIds.set(scan.id, id);
        }
      }

      // 3. Update trip_scans with paired_pantry_item_id +
      //    paired_receipt_line_index for audit.
      for (const scan of scans) {
        const patch = {};
        const pid = newPantryIds.get(scan.id);
        if (pid) patch.paired_pantry_item_id = pid;
        const priceInfo = priceByScan.get(scan.id);
        if (priceInfo) patch.paired_receipt_line_index = priceInfo.lineIndex;
        if (Object.keys(patch).length === 0) continue;
        await supabase.from("trip_scans").update(patch).eq("id", scan.id);
      }

      // 4. Mark shopping list items purchased.
      for (const scan of scans) {
        if (!scan.pairedShoppingListItemId) continue;
        const pid = newPantryIds.get(scan.id);
        await supabase.from("shopping_list_items").update({
          purchased_at: nowIso,
          purchased_pantry_item_id: pid || null,
          purchased_trip_id: trip.id,
        }).eq("id", scan.pairedShoppingListItemId);
      }

      // 5. Checkout trip.
      await supabase.from("shopping_trips").update({
        status: "checked_out",
        ended_at: nowIso,
        receipt_id: receiptId,
        store_name: receiptMeta.store,
      }).eq("id", trip.id);

      setPhase("done");
      onDone?.({ receiptId, pantryCount: newPantryIds.size });
    } catch (e) {
      console.warn("[shop-checkout] commit failed:", e);
      setError(e?.message || "Something went wrong committing the trip.");
      setPhase(withReceipt ? "review" : "summary");
    }
  }

  const pairedCount = scans.filter(s => s.pairedShoppingListItemId).length;
  const totalQty    = scans.reduce((n, s) => n + (s.qty || 1), 0);

  // ── Rendering ──────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 342,
      background: "#0b0b0b",
      display: "flex", flexDirection: "column",
    }}>
      <div style={headerStyle}>
        <button onClick={() => onCancel?.()} style={iconBtn} aria-label="Back">←</button>
        <div style={headerTitle}>TRIP CHECKOUT</div>
      </div>

      {phase === "summary" && (
        <div style={{ flex: 1, overflow: "auto", padding: "16px 18px 24px" }}>
          <div style={{ color: "#f5c842", fontSize: 11, letterSpacing: 1.2, marginBottom: 6 }}>
            YOUR TRIP · {scans.length} UNIQUE ITEM{scans.length === 1 ? "" : "S"} · {totalQty} TOTAL
          </div>
          <div style={{ color: "#aaa", fontSize: 13, marginBottom: 16 }}>
            {pairedCount} of {scans.length} paired to your list. Attach a receipt
            to stamp prices on every row — or skip and commit without prices.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {scans.map(s => (
              <TripScanLine key={s.id} scan={s}
                listName={nameForListId(shoppingList, s.pairedShoppingListItemId)} />
            ))}
          </div>

          {error && (
            <div style={{
              marginTop: 14, padding: "10px 12px",
              background: "#2b1818", border: "1px solid #8a3030",
              borderRadius: 8, color: "#f8c7c7", fontSize: 13,
            }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <label style={{ flex: 2 }}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoSelect}
                style={{ display: "none" }}
              />
              <div style={primaryBtn}>📸 SCAN RECEIPT</div>
            </label>
            <button
              onClick={() => doCommit({ withReceipt: false })}
              style={secondaryBtn}
            >SKIP — commit without prices</button>
          </div>
        </div>
      )}

      {phase === "parsing" && (
        <div style={centerPanel}>
          <div style={{ fontSize: 20, fontStyle: "italic", color: "#fff" }}>Reading your receipt…</div>
          <div style={{ fontSize: 13, color: "#888", marginTop: 8 }}>Matching prices to your scans.</div>
        </div>
      )}

      {phase === "review" && (
        <div style={{ flex: 1, overflow: "auto", padding: "16px 18px 24px" }}>
          <div style={{ color: "#f5c842", fontSize: 11, letterSpacing: 1.2, marginBottom: 6 }}>
            RECEIPT PAIRED {receiptMeta.store ? `· ${receiptMeta.store.toUpperCase()}` : ""}
          </div>
          <div style={{ color: "#aaa", fontSize: 13, marginBottom: 14 }}>
            {priceByScan.size} of {scans.length} scan{scans.length === 1 ? "" : "s"} got a price from the receipt.
            {typeof receiptMeta.totalCents === "number" && (
              <span> Receipt total ${(receiptMeta.totalCents / 100).toFixed(2)}.</span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {scans.map(s => {
              const price = priceByScan.get(s.id)?.priceCents;
              return (
                <TripScanLine
                  key={s.id}
                  scan={s}
                  listName={nameForListId(shoppingList, s.pairedShoppingListItemId)}
                  priceCents={price ?? null}
                />
              );
            })}
          </div>

          {error && (
            <div style={{
              marginTop: 14, padding: "10px 12px",
              background: "#2b1818", border: "1px solid #8a3030",
              borderRadius: 8, color: "#f8c7c7", fontSize: 13,
            }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              onClick={() => { setImageData(null); setPriceByScan(new Map()); setReceiptLines([]); setPhase("summary"); }}
              style={secondaryBtn}
            >← Retake</button>
            <button
              onClick={() => doCommit({ withReceipt: true })}
              style={{ ...primaryBtn, flex: 2 }}
            >COMMIT {scans.length} TO KITCHEN →</button>
          </div>
        </div>
      )}

      {phase === "committing" && (
        <div style={centerPanel}>
          <div style={{ fontSize: 20, fontStyle: "italic", color: "#fff" }}>Stocking your kitchen…</div>
        </div>
      )}

      {phase === "done" && (
        <div style={centerPanel}>
          <div style={{ fontSize: 46, marginBottom: 8 }}>🛒</div>
          <div style={{ fontSize: 20, fontStyle: "italic", color: "#fff" }}>All stocked.</div>
          <button onClick={() => onDone?.()} style={{ ...primaryBtn, marginTop: 20 }}>
            BACK TO KITCHEN
          </button>
        </div>
      )}
    </div>
  );
}

function nameForListId(list, id) {
  if (!id) return null;
  return (list || []).find(i => i.id === id)?.name || null;
}

function TripScanLine({ scan, listName, priceCents }) {
  const color = FLASH_COLORS[scan.status]?.bg || "#444";
  const label = scan.productName || scan.brand || `UPC ${scan.barcodeUpc.slice(-6)}`;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px",
      background: "#141414",
      border: `1px solid ${color}55`,
      borderRadius: 10,
    }}>
      <span style={{ color, fontSize: 14 }}>●</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#f0ece4", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {label}{scan.qty > 1 ? `  ×${scan.qty}` : ""}
        </div>
        <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>
          {listName ? `→ ${listName}` : "unpaired"}
          {scan.brand && scan.productName ? ` · ${scan.brand}` : ""}
        </div>
      </div>
      {typeof priceCents === "number" && (
        <div style={{ color: "#f5c842", fontSize: 13, fontFamily: "'DM Mono',monospace" }}>
          ${(priceCents / 100).toFixed(2)}
        </div>
      )}
    </div>
  );
}

const headerStyle = {
  padding: "18px 18px 10px",
  display: "flex", alignItems: "center", gap: 10,
  borderBottom: "1px solid #1e1e1e",
  background: "#0b0b0b",
};

const headerTitle = {
  color: "#fff", fontSize: 15, fontStyle: "italic", letterSpacing: 1.2,
};

const iconBtn = {
  background: "transparent", border: "1px solid #333", color: "#eee",
  width: 36, height: 36, borderRadius: 8, cursor: "pointer",
};

const primaryBtn = {
  flex: 1,
  background: "#b8a878", color: "#111", border: "none",
  borderRadius: 10, padding: "14px 18px",
  fontSize: 14, fontWeight: 700, letterSpacing: 1,
  cursor: "pointer", textAlign: "center",
};

const secondaryBtn = {
  flex: 1,
  background: "transparent", color: "#aaa",
  border: "1px solid #333",
  borderRadius: 10, padding: "14px 12px",
  fontSize: 12, fontWeight: 600, letterSpacing: 1,
  cursor: "pointer", textAlign: "center",
};

const centerPanel = {
  flex: 1,
  display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  padding: 32,
};
