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

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { compressImage } from "../lib/compressImage";
import { findIngredient } from "../data/ingredients";
import LinkIngredient from "./LinkIngredient";

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

// Normalize barcodes to a pure digit string so leading zeros, spaces,
// or hyphens from OCR don't prevent equality matches. "00070038000563"
// vs "70038000563" compare equal after normalization (strip leading
// zeros after the length check — UPC-A is 12 digits, EAN-13 is 13, an
// 8-digit EAN-8 is 8; receipts sometimes pad with leading zeros).
function normalizeBarcode(b) {
  const digits = String(b || "").replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 14) return "";
  // Align UPC-A ↔ EAN-13 — EAN-13 is just a country-code-prefixed
  // UPC-A. Stripping a leading "0" from a 13-digit code yields the
  // UPC-A representation of the same product.
  if (digits.length === 13 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

// Match a trip_scan to a receipt line. UPC direct match wins (the
// receipt prompt now asks the model to pluck the UPC off each line,
// typically printed between the item text and the price on US
// receipts). Falls through to productName/brand ↔ rawText token
// overlap for lines where the UPC wasn't printed or wasn't read.
function matchScanToReceiptLine(scan, receiptLines, claimed) {
  const scanUpc = normalizeBarcode(scan.barcodeUpc);
  if (scanUpc) {
    const byUpc = receiptLines.findIndex(
      (line, i) => !claimed.has(i) && normalizeBarcode(line?.barcode) === scanUpc,
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
  scans: initialScans = [],
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
  // Local editable copy of the scans array. Edits in the summary
  // phase (name, brand, qty, unpair, delete) write through to DB
  // AND mutate this state so the commit pass + re-renders pick up
  // the fresh values. Initialized once from the snapshot Kitchen
  // handed us when the user tapped DONE in ShopMode.
  const [scans, setScans] = useState(initialScans);
  // Which scan, if any, has its inline editor open. null = closed.
  const [editingScanId, setEditingScanId] = useState(null);

  async function handlePhotoSelect(e) {
    const file = e?.target?.files?.[0];
    if (e?.target) e.target.value = "";
    if (!file) return;
    // scan-receipt expects jpeg/png/webp — reject PDFs and weird
    // formats up-front with a human message instead of sending
    // unusable bytes to the edge fn.
    if (!/^image\/(jpeg|png|webp|heic|heif)/i.test(file.type)) {
      setError("Upload an image (jpg, png, or webp). For PDFs, screenshot them and try again.");
      return;
    }
    setError(null);
    setPhase("parsing");
    try {
      // compressImage returns { base64, mediaType, size }. Use the
      // compressed output directly — previously we were pulling
      // .blob off it which doesn't exist, so the raw file was being
      // re-encoded every time.
      const compressed = await compressImage(file).catch(() => null);
      let base64;
      let mediaType;
      if (compressed?.base64) {
        base64 = compressed.base64;
        mediaType = compressed.mediaType || "image/jpeg";
      } else {
        // Compression failed (unusual codec, corrupted image) — fall
        // back to the raw file.
        base64 = await fileToBase64(file);
        mediaType = file.type || "image/jpeg";
      }
      setImageData({ base64, mediaType });

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
      const insertErrors = [];
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
        // Trace the UPC end-to-end so mismatches between what the
        // scanner read and what lands in pantry_items are visible
        // in the console without firing up the DB client.
        console.log("[shop-checkout] insert pantry row", {
          scanId: scan.id,
          scannedUpc: scan.barcodeUpc,
          writingUpc: row.barcode_upc,
          canonical: row.canonical_id,
          brand: row.brand,
          qty: row.amount,
          price: row.price_cents,
          listSlot: row.source_shopping_list_item_id,
        });
        const { error: piErr } = await supabase.from("pantry_items").insert(row);
        if (piErr) {
          console.error("[shop-checkout] pantry insert FAILED", piErr.message, { scan, row });
          insertErrors.push({ scan, message: piErr.message });
        } else {
          newPantryIds.set(scan.id, id);
        }
      }

      // If any pantry row failed to insert, surface it visibly instead
      // of pretending the commit succeeded. The most likely cause
      // during rollout: migrations 0127/0128 not applied yet, so the
      // source_shopping_list_item_id / purchased_* columns don't exist.
      if (insertErrors.length > 0) {
        const firstMsg = insertErrors[0].message;
        const hasMigrationHint = /column .* does not exist/i.test(firstMsg);
        throw new Error(
          `${insertErrors.length} of ${scans.length} items failed to stock.\n\n` +
          (hasMigrationHint
            ? "Looks like a database column is missing — run `supabase db push` to apply migrations 0126, 0127, and 0128.\n\n"
            : "") +
          `First error: ${firstMsg}`
        );
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

  // Edit handlers — write through to DB first, then mutate local
  // state. On error, local state is untouched so the user can retry.
  async function patchScan(scanId, patch) {
    const { data, error: e } = await supabase
      .from("trip_scans")
      .update(patch)
      .eq("id", scanId)
      .select("*")
      .single();
    if (e) {
      console.warn("[shop-checkout] patchScan failed:", e.message, patch);
      return false;
    }
    setScans(prev => prev.map(s => s.id === scanId ? { ...s, ...remapFromDb(data) } : s));
    return true;
  }

  async function deleteScan(scanId) {
    const ok = window.confirm("Remove this scan from the trip? It won't be stocked on commit.");
    if (!ok) return;
    const { error: e } = await supabase.from("trip_scans").delete().eq("id", scanId);
    if (e) {
      console.warn("[shop-checkout] deleteScan failed:", e.message);
      return;
    }
    setScans(prev => prev.filter(s => s.id !== scanId));
    setEditingScanId(prev => prev === scanId ? null : prev);
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
            {pairedCount} of {scans.length} paired to your list.
            Tap any row to fix the name or brand, adjust qty, or drop it
            from the trip. Then attach a receipt for prices — or skip.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {scans.map(s => (
              <EditableScanLine
                key={s.id}
                scan={s}
                listName={nameForListId(shoppingList, s.pairedShoppingListItemId)}
                isOpen={editingScanId === s.id}
                onToggle={() => setEditingScanId(prev => prev === s.id ? null : s.id)}
                onPatch={(patch) => patchScan(s.id, patch)}
                onDelete={() => deleteScan(s.id)}
                onUnpair={() => patchScan(s.id, { paired_shopping_list_item_id: null })}
              />
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
            <label style={{ flex: 1 }}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoSelect}
                style={{ display: "none" }}
              />
              <div style={primaryBtn}>📸 SCAN</div>
            </label>
            {/* Gallery / file upload — no `capture` attribute, so
                mobile shows the native picker (photos + files) and
                desktop gets a regular file dialog. Covers the
                screenshot-of-an-email-receipt case. */}
            <label style={{ flex: 1 }}>
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                style={{ display: "none" }}
              />
              <div style={primaryBtn}>📁 UPLOAD</div>
            </label>
          </div>
          <button
            onClick={() => doCommit({ withReceipt: false })}
            style={{ ...secondaryBtn, marginTop: 10, flex: "none", width: "100%" }}
          >SKIP — commit without prices</button>
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

// DB → in-memory scan shape. Mirrors the one in useShopMode but
// local since checkout doesn't import that hook.
function remapFromDb(row) {
  return {
    id:                       row.id,
    tripId:                   row.trip_id,
    userId:                   row.user_id,
    scannedAt:                row.scanned_at,
    barcodeUpc:               row.barcode_upc,
    offPayload:               row.off_payload || null,
    status:                   row.status,
    canonicalId:              row.canonical_id,
    brand:                    row.brand,
    productName:              row.product_name,
    qty:                      row.qty ?? 1,
    pairedShoppingListItemId: row.paired_shopping_list_item_id,
    pairedPantryItemId:       row.paired_pantry_item_id,
    pairedReceiptLineIndex:   row.paired_receipt_line_index,
  };
}

// Inline-editable scan row for the checkout summary. Collapsed
// state = same single-line read view as TripScanLine. Expanded
// state = name + brand text inputs, qty stepper, unpair + delete
// actions. Edits write through to the DB; parent updates local
// state on success.
function EditableScanLine({ scan, listName, isOpen, onToggle, onPatch, onDelete, onUnpair }) {
  const [name, setName]   = useState(scan.productName || "");
  const [brand, setBrand] = useState(scan.brand || "");
  // LinkIngredient picker — embedded as a full-screen modal on tap.
  // Covers bundled fuzzy match + admin-approved synthetics + the
  // ⭐ create-new-canonical flow. Picked id writes to trip_scans.canonical_id.
  const [pickerOpen, setPickerOpen] = useState(false);

  // Reset the text fields when the scan identity changes under us
  // (realtime tick from a different client, for instance).
  useEffect(() => { setName(scan.productName || ""); setBrand(scan.brand || ""); }, [scan.productName, scan.brand]);

  const color = FLASH_COLORS[scan.status]?.bg || "#444";
  const label = scan.productName || scan.brand || `UPC ${scan.barcodeUpc.slice(-6)}`;

  // Resolve the current canonical for display. findIngredient covers
  // bundled; for synthetic (admin-approved user slugs) we degrade to
  // showing the raw slug — LinkIngredient handles the full lookup.
  const currentCanonical = scan.canonicalId ? findIngredient(scan.canonicalId) : null;
  const canonicalLabel = currentCanonical
    ? `${currentCanonical.emoji || ""} ${currentCanonical.shortName || currentCanonical.name}`
    : scan.canonicalId
      ? scan.canonicalId
      : null;

  async function saveTextFields() {
    const patch = {};
    if ((name || "") !== (scan.productName || "")) patch.product_name = name.trim() || null;
    if ((brand || "") !== (scan.brand || ""))     patch.brand        = brand.trim() || null;
    if (Object.keys(patch).length === 0) return;
    await onPatch(patch);
  }

  async function bumpQty(delta) {
    const next = Math.max(1, (scan.qty || 1) + delta);
    if (next === scan.qty) return;
    await onPatch({ qty: next });
  }

  // LinkIngredient picked a canonical (single-mode → first id is the
  // pick). Write it + re-classify status: if we now have a canonical,
  // status goes green; cleared canonical demotes to yellow (unless
  // there was never OFF data — stays red).
  async function onCanonicalPicked(ids) {
    const next = Array.isArray(ids) && ids.length ? ids[0] : null;
    const patch = {
      canonical_id: next,
    };
    if (next) patch.status = "green";
    else if (scan.offPayload) patch.status = "yellow";
    await onPatch(patch);
    setPickerOpen(false);
  }

  return (
    <div style={{
      background: "#141414",
      border: `1px solid ${color}55`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <button
        onClick={onToggle}
        style={{
          display: "flex", width: "100%", alignItems: "center", gap: 10,
          padding: "10px 12px",
          background: "transparent", border: "none",
          color: "#f0ece4", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ color, fontSize: 14 }}>●</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {label}{scan.qty > 1 ? `  ×${scan.qty}` : ""}
          </div>
          <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>
            {listName ? `→ ${listName}` : "unpaired"}
            {scan.brand && scan.productName ? ` · ${scan.brand}` : ""}
            {canonicalLabel ? ` · ${canonicalLabel}` : ""}
          </div>
        </div>
        <span style={{ color: "#666", fontSize: 11 }}>{isOpen ? "▲" : "EDIT ▼"}</span>
      </button>

      {isOpen && (
        <div style={{
          padding: "4px 12px 12px",
          borderTop: "1px solid #222",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, letterSpacing: 1.1, color: "#888" }}>WHAT IS IT? (NAME)</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={saveTextFields}
              placeholder="Display name"
              style={textInput}
            />
          </label>

          {/* Canonical picker — tan chip to match the CANONICAL axis
              color (CLAUDE.md). Tapping opens LinkIngredient in
              single mode: bundled fuzzy + admin synthetics + ⭐
              create-new, same picker every other scan correction
              surface uses. */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, letterSpacing: 1.1, color: "#b8a878" }}>CANONICAL</span>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px",
                background: canonicalLabel ? "#1a1710" : "#0d0d0d",
                border: `1px ${canonicalLabel ? "solid" : "dashed"} #b8a87888`,
                borderRadius: 8,
                color: canonicalLabel ? "#b8a878" : "#888",
                fontSize: 13, fontStyle: "italic",
                cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{ flex: 1 }}>
                {canonicalLabel || "Tap to link a canonical or ⭐ create new"}
              </span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {canonicalLabel ? "CHANGE ▶" : "PICK ▶"}
              </span>
            </button>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, letterSpacing: 1.1, color: "#888" }}>BRAND</span>
            <input
              type="text"
              value={brand}
              onChange={e => setBrand(e.target.value)}
              onBlur={saveTextFields}
              placeholder="Brand (optional)"
              style={textInput}
            />
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
            <span style={{ fontSize: 10, letterSpacing: 1.1, color: "#888", flex: 1 }}>QTY</span>
            <button onClick={() => bumpQty(-1)} style={qtyBtn} aria-label="Decrease">−</button>
            <span style={{ minWidth: 30, textAlign: "center", color: "#f0ece4", fontSize: 15 }}>×{scan.qty || 1}</span>
            <button onClick={() => bumpQty(1)} style={qtyBtn} aria-label="Increase">+</button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {scan.pairedShoppingListItemId && (
              <button onClick={onUnpair} style={editBtn}>UNPAIR FROM LIST</button>
            )}
            <button onClick={onDelete} style={{ ...editBtn, color: "#f8c7c7", borderColor: "#5a2a2a" }}>
              DELETE SCAN
            </button>
          </div>
        </div>
      )}

      {pickerOpen && (
        <LinkIngredient
          item={{
            name:  scan.productName || scan.brand || "",
            emoji: "🛒",
            ingredientIds: scan.canonicalId ? [scan.canonicalId] : [],
          }}
          mode="single"
          onLink={onCanonicalPicked}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

const textInput = {
  background: "#0d0d0d",
  border: "1px solid #2a2a2a",
  color: "#f0ece4",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 14,
  outline: "none",
  fontFamily: "'DM Sans',sans-serif",
};

const qtyBtn = {
  width: 30, height: 30,
  background: "#0d0d0d",
  border: "1px solid #2a2a2a",
  color: "#f0ece4",
  borderRadius: 6,
  fontSize: 16,
  cursor: "pointer",
};

const editBtn = {
  flex: 1,
  padding: "8px 10px",
  background: "transparent",
  border: "1px solid #333",
  color: "#aaa",
  borderRadius: 8,
  fontSize: 11,
  letterSpacing: 1,
  cursor: "pointer",
};

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
