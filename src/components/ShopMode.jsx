// Shop Mode — persistent barcode scanner + interactive pair-to-list
// sheet during a shopping trip. The flow:
//
//   1. User opens Shop Mode from the shopping list view.
//   2. useShopMode creates a 'active' shopping_trips row (or reuses one
//      if the user already has an open trip).
//   3. BarcodeScanner mounts in mode="rapid" — the stream stays open
//      across detects so the user can fire item after item without
//      closing/reopening the camera.
//   4. Each detect:
//        a) lookupBarcode → OFF (with brand_nutrition cache)
//        b) resolveCanonicalFromScan → classify green / yellow / red
//        c) upsertScan on useShopMode (stacks qty on re-scan)
//        d) flash overlay (~600ms) + pair-to-list sheet
//        e) user taps a list item → pairScanToList → sheet dismisses,
//           scanner re-arms automatically
//   5. User taps DONE SHOPPING → onCheckoutRequest hands off to the
//      parent (Kitchen) to launch the receipt scan; Kitchen commits
//      pantry rows once the receipt arrives.
//
// The three flash colors intentionally sit OUTSIDE the six reserved
// identity axes (CLAUDE.md) — forest green, warm amber, brick red, all
// different enough from tan / rust / orange / blue / purple / yellow
// that they don't read as "new axis color".

import { useEffect, useMemo, useRef, useState } from "react";
import BarcodeScanner from "./BarcodeScanner";
import { useShopMode } from "../lib/useShopMode";
import { lookupBarcode } from "../lib/lookupBarcode";
import { findIngredient } from "../data/ingredients";
import { resolveCanonicalFromScan } from "../lib/canonicalResolver";

const FLASH_COLORS = {
  green:  { bg: "#1f6b3a", label: "MATCHED" },       // forest — clear win
  yellow: { bg: "#b88a1f", label: "NEEDS IDENTITY" }, // amber — fix at home
  red:    { bg: "#8a3030", label: "NO DATA" },       // brick — manual later
};

const FLASH_MS = 900; // enough to read the status, short enough to feel snappy

export default function ShopMode({
  userId,
  shoppingList = [],
  setShoppingList,
  brandNutritionRows = [],
  learnedTagLookup = null,
  onClose,
  onCheckoutRequest,
}) {
  const {
    activeTrip,
    scans,
    loading,
    startTrip,
    upsertScan,
    adjustScanQty,
    pairScanToList,
    checkoutTrip,
    cancelTrip,
  } = useShopMode(userId);

  // lastScan = { scan, flashColor, shown: true } — the transient state
  // that drives the flash + pair sheet. Clears on pair or dismiss.
  const [lastScan, setLastScan] = useState(null);
  const [flashVisible, setFlashVisible] = useState(false);
  const flashTimerRef = useRef(null);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
  }, []);

  // Unpurchased list items sorted by the order they were added, with
  // the most-recently-added on top so fresh entries ("I just remembered
  // we need butter") don't get buried.
  const listTargets = useMemo(() => {
    return (shoppingList || [])
      .filter(item => !item.purchasedAt)
      .slice()
      .reverse();
  }, [shoppingList]);

  // Pairing map keyed by list item id → array of trip_scans that
  // bound to it. Used to render the purple "paired" chip on each
  // tapped list row.
  const pairedByListId = useMemo(() => {
    const m = new Map();
    for (const scan of scans) {
      if (!scan.pairedShoppingListItemId) continue;
      if (!m.has(scan.pairedShoppingListItemId)) m.set(scan.pairedShoppingListItemId, []);
      m.get(scan.pairedShoppingListItemId).push(scan);
    }
    return m;
  }, [scans]);

  async function handleDetected(upc) {
    if (!activeTrip?.id || !upc) return;
    setLooking(true);
    let off = null;
    try {
      off = await lookupBarcode(upc, { brandNutritionRows });
    } catch (e) {
      console.warn("[shop-mode] lookupBarcode threw:", e);
    }
    setLooking(false);

    // Classify
    let flashColor = "red";
    let canonicalId = null;
    let brand = null;
    let productName = null;
    let offPayload = null;

    if (off?.found) {
      brand = off.brand || null;
      productName = off.productName || null;
      offPayload = {
        brand:         off.brand,
        productName:   off.productName,
        categoryHints: off.categoryHints || [],
        nutrition:     off.nutrition || null,
        quantity:      off.quantity || null,
        source:        off.source || null,
        sourceId:      off.sourceId || null,
        offUrl:        off.offUrl || null,
      };
      // Resolver — tier 1 (learned corrections) → tier 2 (fuzzy).
      const match = resolveCanonicalFromScan({
        brand:         off.brand,
        productName:   off.productName,
        categoryHints: off.categoryHints || [],
        learnedTagLookup,
        findIngredient,
      });
      if (match?.canonical?.id) {
        canonicalId = match.canonical.id;
        flashColor = "green";
      } else {
        flashColor = "yellow";
      }
    }

    const scan = await upsertScan({
      upc,
      offPayload,
      canonicalId,
      brand,
      productName,
      status: flashColor,
    });

    // Flash + pair sheet.
    setLastScan({ scan, flashColor });
    setFlashVisible(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashVisible(false), FLASH_MS);
  }

  // Pair the most recent scan to a chosen list item. Dismisses the
  // sheet + re-arms the scanner (it's still mounted; the sheet is
  // just an overlay).
  async function handlePairToList(listItemId) {
    if (!lastScan?.scan?.id) return;
    await pairScanToList(lastScan.scan.id, listItemId);
    setLastScan(null);
  }

  // "NOT ON MY LIST" path — silent-list-add: append a new
  // shopping_list_items row with source='trip_impulse', use its id
  // for the pair. Keeps pair model uniform downstream.
  async function handleImpulse() {
    if (!lastScan?.scan) return;
    const scan = lastScan.scan;
    const name = scan.productName || scan.brand || `Scanned item (${scan.barcodeUpc.slice(-4)})`;
    // Generate the id OUTSIDE the functional updater — React StrictMode
    // calls the updater twice in dev, and a fresh randomUUID() in each
    // invocation would leak two ids (same bug as the scan-commit loop
    // in Kitchen.jsx, see stableNewIds comment there).
    const newItemId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      setShoppingList?.(prev => ([
        ...prev,
        {
          id: newItemId,
          name,
          emoji: "🛒",
          amount: scan.qty || 1,
          unit: "",
          category: "pantry",
          source: "trip_impulse",
          ingredientId: scan.canonicalId || null,
          priceCents: null,
        },
      ]));
    } catch (e) {
      console.warn("[shop-mode] impulse add failed:", e);
    }
    await pairScanToList(scan.id, newItemId);
    setLastScan(null);
  }

  async function handleUnpair(scanId) {
    await pairScanToList(scanId, null);
  }

  async function handleCheckout() {
    if (!activeTrip?.id) return;
    onCheckoutRequest?.({ trip: activeTrip, scans });
  }

  async function handleCancel() {
    if (!activeTrip) {
      onClose?.();
      return;
    }
    const ok = window.confirm(
      "Cancel this shopping trip? Your scans will be archived and nothing will be stocked.",
    );
    if (!ok) return;
    await cancelTrip();
    onClose?.();
  }

  if (loading) {
    return (
      <div style={overlayStyle}>
        <div style={{ color: "#fff", padding: 32 }}>Loading trip…</div>
      </div>
    );
  }

  // No active trip — show the start screen.
  if (!activeTrip) {
    return (
      <div style={overlayStyle}>
        <div style={headerStyle}>
          <button onClick={() => onClose?.()} style={iconBtn}>←</button>
          <div style={headerTitle}>SHOP MODE</div>
        </div>
        <div style={{ padding: 32, color: "#eee", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontStyle: "italic", fontSize: 22 }}>Ready to shop?</div>
          <div style={{ opacity: 0.8, lineHeight: 1.5 }}>
            Open the scanner. Every item you scan pairs to a row on your
            list with one tap. At checkout, scan the receipt and
            everything commits to your pantry with full brand + canonical
            data AND accurate prices.
          </div>
          <div style={{ opacity: 0.7, fontSize: 14 }}>
            {listTargets.length
              ? `${listTargets.length} item${listTargets.length === 1 ? "" : "s"} on your list ready to pair.`
              : `Your list is empty. Add a few items first — 'corn', 'apples', 'beer' — then come back.`}
          </div>
          <button
            onClick={startTrip}
            style={primaryBtn}
          >START TRIP</button>
        </div>
      </div>
    );
  }

  // Active trip — render the scanner + overlays.
  const flash = lastScan && flashVisible ? FLASH_COLORS[lastScan.flashColor] : null;

  return (
    <div style={{ ...overlayStyle, background: "#000" }}>
      {/* Scanner (full-screen, z=348). Overlays mount ABOVE at z=360+. */}
      <BarcodeScanner
        mode="rapid"
        onDetected={handleDetected}
        onCancel={handleCancel}
      />

      {/* Flash overlay — brief colored band that names the result. */}
      {flash && (
        <div style={{
          position: "fixed", top: 64, left: 16, right: 16, zIndex: 361,
          padding: "14px 18px",
          background: flash.bg,
          color: "#fff",
          fontWeight: 700,
          letterSpacing: 1.2,
          fontSize: 16,
          textAlign: "center",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          animation: "shop-mode-flash 900ms ease-out",
        }}>
          {flash.label}
          {looking ? " — LOOKING UP" : null}
        </div>
      )}

      {/* Pair-to-list sheet — slides up from the bottom after each
          scan. Stays until the user taps a list item or NOT ON MY
          LIST. While it's open the scanner keeps running but the
          1500ms dedupe window + sheet z-index mean the same UPC
          can't re-fire and steal the user's tap. */}
      {lastScan?.scan && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 360,
          background: "#121212",
          borderTop: "1px solid #333",
          maxHeight: "65vh",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "14px 20px 8px", borderBottom: "1px solid #222" }}>
            <div style={{ fontSize: 12, letterSpacing: 1.5, color: "#c7a8d4" }}>
              WHAT DID YOU JUST SCAN?
            </div>
            <div style={{ fontSize: 20, fontStyle: "italic", color: "#fff", marginTop: 4 }}>
              {lastScan.scan.productName || lastScan.scan.brand || `UPC ${lastScan.scan.barcodeUpc}`}
            </div>
            {lastScan.scan.brand && lastScan.scan.productName && (
              <div style={{ fontSize: 13, color: "#b8a878", marginTop: 2 }}>
                {lastScan.scan.brand}
              </div>
            )}
          </div>

          <div style={{ overflow: "auto", padding: "8px 12px 12px" }}>
            {listTargets.length === 0 && (
              <div style={{ padding: 16, color: "#888", fontStyle: "italic" }}>
                Nothing on your list — tap NOT ON MY LIST to log an impulse buy.
              </div>
            )}
            {listTargets.map(item => {
              const paired = pairedByListId.get(item.id) || [];
              const isPairedHere = paired.some(s => s.id === lastScan.scan.id);
              return (
                <button
                  key={item.id}
                  onClick={() => handlePairToList(item.id)}
                  style={{
                    display: "flex", width: "100%", alignItems: "center", gap: 10,
                    padding: "10px 12px",
                    background: isPairedHere ? "#2a1f3a" : "#1a1a1a",
                    border: `1px solid ${paired.length ? "#c7a8d4" : "#2a2a2a"}`,
                    borderRadius: 8,
                    marginBottom: 6,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 20 }}>{item.emoji || "🛒"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#fff", fontSize: 15 }}>{item.name}</div>
                    {paired.length > 0 && (
                      <div style={{ fontSize: 11, color: "#c7a8d4", marginTop: 2 }}>
                        ✓ PAIRED ({paired.length} scan{paired.length === 1 ? "" : "s"})
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

            <button
              onClick={handleImpulse}
              style={{
                display: "block", width: "100%",
                padding: "10px 12px",
                background: "#1a1a1a",
                border: "1px dashed #555",
                color: "#ddd",
                borderRadius: 8,
                marginTop: 8,
                cursor: "pointer",
                fontSize: 14,
                letterSpacing: 0.8,
              }}
            >+ NOT ON MY LIST (impulse buy)</button>

            <button
              onClick={() => setLastScan(null)}
              style={{
                display: "block", width: "100%",
                padding: "8px 12px",
                background: "transparent",
                border: "none",
                color: "#888",
                marginTop: 4,
                cursor: "pointer",
                fontSize: 13,
              }}
            >Skip — pair later</button>
          </div>
        </div>
      )}

      {/* Bottom action bar — visible only when the pair sheet is NOT
          open, so the DONE button can't accidentally be tapped while
          the user is looking for a list match. */}
      {!lastScan?.scan && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 355,
          background: "#0b0b0b",
          borderTop: "1px solid #222",
          padding: "10px 16px 18px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ flex: 1, color: "#aaa", fontSize: 13 }}>
            {scans.length === 0 ? "Point at a barcode to scan." : (
              <span>
                {scans.length} scan{scans.length === 1 ? "" : "s"} · {pairedCount(scans)} paired
              </span>
            )}
          </div>
          <button
            onClick={handleCheckout}
            disabled={scans.length === 0}
            style={{
              ...primaryBtn,
              opacity: scans.length === 0 ? 0.5 : 1,
              padding: "8px 18px",
              fontSize: 14,
            }}
          >DONE — SCAN RECEIPT →</button>
        </div>
      )}

      {/* Scan history strip — horizontal list of stacked scans
          across the top, under the scanner header. Shows qty and the
          paired list slot name if bound. Tapping a chip opens a
          mini-editor to adjust qty or unpair. */}
      {scans.length > 0 && (
        <div style={{
          position: "fixed", left: 0, right: 0, top: 120, zIndex: 349,
          display: "flex", gap: 6, overflowX: "auto",
          padding: "8px 12px",
          background: "rgba(0,0,0,0.6)",
          pointerEvents: lastScan?.scan ? "none" : "auto",
        }}>
          {scans.slice().reverse().map(scan => (
            <ScanChip
              key={scan.id}
              scan={scan}
              listName={nameForListId(shoppingList, scan.pairedShoppingListItemId)}
              onAdjust={(next) => adjustScanQty(scan.id, next)}
              onUnpair={() => handleUnpair(scan.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function pairedCount(scans) {
  return scans.filter(s => s.pairedShoppingListItemId).length;
}

function nameForListId(list, id) {
  if (!id) return null;
  return (list || []).find(i => i.id === id)?.name || null;
}

function ScanChip({ scan, listName, onAdjust, onUnpair }) {
  const [open, setOpen] = useState(false);
  const color = FLASH_COLORS[scan.status]?.bg || "#444";
  const label = scan.productName || scan.brand || scan.barcodeUpc.slice(-6);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          flex: "none",
          background: "#1a1a1a",
          color: "#eee",
          border: `1px solid ${color}`,
          borderRadius: 999,
          padding: "4px 10px",
          fontSize: 12,
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        <span style={{ color }}>●</span>{" "}
        {label}
        {scan.qty > 1 ? ` ×${scan.qty}` : ""}
        {listName ? ` → ${listName}` : ""}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: 28, left: 0, zIndex: 365,
          background: "#0d0d0d",
          border: "1px solid #333",
          borderRadius: 6,
          padding: 8,
          display: "flex", gap: 6, alignItems: "center",
        }}>
          <button onClick={() => onAdjust(Math.max(1, (scan.qty || 1) - 1))} style={pillBtn}>−</button>
          <span style={{ color: "#eee", minWidth: 24, textAlign: "center" }}>{scan.qty || 1}</span>
          <button onClick={() => onAdjust((scan.qty || 1) + 1)} style={pillBtn}>+</button>
          {scan.pairedShoppingListItemId && (
            <button onClick={() => { onUnpair(); setOpen(false); }} style={{ ...pillBtn, background: "#2a1f1f" }}>
              UNPAIR
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const overlayStyle = {
  position: "fixed", inset: 0, zIndex: 340,
  background: "#050505",
  display: "flex", flexDirection: "column",
};

const headerStyle = {
  padding: "20px 18px 10px",
  display: "flex", alignItems: "center", gap: 10,
  borderBottom: "1px solid #1e1e1e",
  background: "#0b0b0b",
};

const headerTitle = {
  color: "#fff", fontSize: 16, fontStyle: "italic", letterSpacing: 1.2,
};

const iconBtn = {
  background: "transparent", border: "1px solid #333", color: "#eee",
  width: 36, height: 36, borderRadius: 8, cursor: "pointer",
};

const primaryBtn = {
  background: "#b8a878", color: "#111", border: "none",
  borderRadius: 10, padding: "14px 20px",
  fontSize: 16, fontWeight: 700, letterSpacing: 1.2,
  cursor: "pointer",
};

const pillBtn = {
  background: "#1a1a1a", color: "#eee",
  border: "1px solid #333", borderRadius: 6,
  padding: "2px 10px", cursor: "pointer", fontSize: 13,
};
