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

// Muted backgrounds for list rows that have paired scans. Same hue
// family as the flash banners above, cranked way down in saturation
// so a list full of greens doesn't blind the user. Border still uses
// the strong FLASH_COLORS.bg so the status reads at a glance.
const STATUS_TILE_BG = {
  green:  "#152b1f",
  yellow: "#2b2415",
  red:    "#2b1818",
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

  // lastScan = { scan, flashColor } — drives the flash banner (brief).
  // armedListItemId = the list item the user has pre-tapped as the
  // pair target for the NEXT scan. Tap-ahead model: pick what you're
  // about to scan, then scan, and the pair lands instantly. Stays
  // armed across scans so 6 apples → arm "apples" once, scan 6 times.
  // Tapping the same item again disarms; tapping a different item
  // re-arms. 'impulse' is the magic value that routes scans into the
  // silent-list-add path.
  const [lastScan, setLastScan] = useState(null);
  const [flashVisible, setFlashVisible] = useState(false);
  const flashTimerRef = useRef(null);
  const [looking, setLooking] = useState(false);
  const [armedListItemId, setArmedListItemId] = useState(null);
  // armedRef mirrors armedListItemId so handleDetected (captured in
  // onDetected closure) always reads the freshest value even across
  // rapid scans that don't re-render between each.
  const armedRef = useRef(null);
  useEffect(() => { armedRef.current = armedListItemId; }, [armedListItemId]);
  // setShoppingList mirrored for the same reason — impulse-add path
  // needs the freshest setter.
  const setShoppingListRef = useRef(setShoppingList);
  useEffect(() => { setShoppingListRef.current = setShoppingList; }, [setShoppingList]);

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

    // Tap-ahead pair. If the user pre-armed a list item, the scan
    // auto-pairs to it immediately — no sheet, no extra tap. Armed
    // stays on (so 6 apple scans all pair to "apples" without re-
    // tapping). The special 'impulse' sentinel routes through the
    // silent-list-add path instead.
    const armed = armedRef.current;
    if (scan?.id && armed) {
      if (armed === "__impulse__") {
        await doImpulseAdd(scan);
      } else {
        await pairScanToList(scan.id, armed);
      }
    }

    // Flash banner — always fires; confirms the pair status.
    setLastScan({ scan, flashColor });
    setFlashVisible(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashVisible(false), FLASH_MS);
  }

  // Silent-list-add: builds a fresh shopping_list_items row from the
  // scan's OFF data (or UPC fallback) and pairs the scan to it. Used
  // when the user has armed "impulse mode" on the bottom half.
  async function doImpulseAdd(scan) {
    const name = scan.productName || scan.brand || `Scanned item (${scan.barcodeUpc.slice(-4)})`;
    const newItemId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      setShoppingListRef.current?.(prev => ([
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
  }

  // Tap a list item to arm it as the pair target for the next scan.
  // Same item tapped again disarms; different item re-arms.
  function toggleArm(listItemId) {
    setArmedListItemId(prev => (prev === listItemId ? null : listItemId));
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

  // Active trip — split layout: scanner on top half, shopping list
  // on bottom half (always visible, tap-to-arm).
  const flash = lastScan && flashVisible ? FLASH_COLORS[lastScan.flashColor] : null;

  // statusByListId — for each list item, the worst-case status of
  // its paired scans (green > yellow > red → so the MOST urgent
  // wins). Used to color the list row itself. Unpaired rows render
  // in the neutral style.
  const statusByListId = new Map();
  for (const [id, pairedScans] of pairedByListId.entries()) {
    // Pick the "worst" status so a yellow or red scan isn't hidden
    // by a sibling green. Precedence: red > yellow > green.
    let worst = "green";
    for (const s of pairedScans) {
      if (s.status === "red")   { worst = "red";    break; }
      if (s.status === "yellow") worst = "yellow";
    }
    statusByListId.set(id, worst);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 340,
      background: "#000",
      display: "flex", flexDirection: "column",
    }}>
      {/* ── TOP HALF — scanner (embedded) ───────────────────────────── */}
      <div style={{
        flex: "1 1 50%",
        minHeight: 0,
        position: "relative",
        borderBottom: "1px solid #222",
      }}>
        <BarcodeScanner
          embedded
          mode="rapid"
          onDetected={handleDetected}
          onCancel={handleCancel}
        />

        {/* Flash overlay — brief colored band on top of the scanner
            panel. Sits at absolute to scope it to the scanner half. */}
        {flash && (
          <div style={{
            position: "absolute", top: 10, left: 10, right: 10, zIndex: 5,
            padding: "10px 14px",
            background: flash.bg,
            color: "#fff",
            fontWeight: 700,
            letterSpacing: 1.2,
            fontSize: 14,
            textAlign: "center",
            borderRadius: 8,
            boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
            animation: "shop-mode-flash 900ms ease-out",
            pointerEvents: "none",
          }}>
            {flash.label}{looking ? " — LOOKING UP" : null}
          </div>
        )}

        {/* Armed banner — shows the user what their next scan will
            pair to, so they can confidently fire the scanner. Sits
            pinned at the bottom of the scanner half so it's close to
            the list (which is RIGHT below it). Sits above flash via
            its own zIndex. */}
        {armedListItemId && !flashVisible && (() => {
          const armedItem = armedListItemId === "__impulse__"
            ? { name: "Impulse buy (adds to list on scan)", emoji: "🛒" }
            : listTargets.find(i => i.id === armedListItemId);
          if (!armedItem) return null;
          return (
            <div style={{
              position: "absolute", bottom: 10, left: 10, right: 10, zIndex: 5,
              padding: "10px 12px",
              background: "rgba(20, 16, 8, 0.94)",
              border: "1px solid #f5c842",
              borderRadius: 8,
              display: "flex", alignItems: "center", gap: 10,
              backdropFilter: "blur(4px)",
            }}>
              <span style={{ fontSize: 18 }}>{armedItem.emoji || "🛒"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, letterSpacing: 1.2, color: "#f5c842" }}>
                  NEXT SCAN → {armedListItemId === "__impulse__" ? "IMPULSE ADD" : "PAIRS TO"}
                </div>
                <div style={{
                  fontSize: 14, fontStyle: "italic", color: "#fff",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {armedItem.name}
                </div>
              </div>
              <button
                onClick={() => setArmedListItemId(null)}
                style={{
                  background: "transparent", border: "none",
                  color: "#888", fontSize: 18, cursor: "pointer",
                  padding: "0 4px",
                }}
                aria-label="Disarm"
              >✕</button>
            </div>
          );
        })()}
      </div>

      {/* ── BOTTOM HALF — shopping list (always visible) ────────────── */}
      <div style={{
        flex: "1 1 50%",
        minHeight: 0,
        display: "flex", flexDirection: "column",
        background: "#0b0b0b",
      }}>
        {/* Sticky summary / action bar */}
        <div style={{
          padding: "10px 14px",
          display: "flex", alignItems: "center", gap: 10,
          borderBottom: "1px solid #1e1e1e",
          background: "#0d0d0d",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, color: "#f5c842" }}>
              SHOPPING LIST · {listTargets.length} TO GO
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
              {armedListItemId
                ? "NEXT SCAN WILL AUTO-PAIR"
                : scans.length === 0
                  ? "Tap an item to arm it for the next scan."
                  : `${scans.length} scan${scans.length === 1 ? "" : "s"} · ${pairedCount(scans)} paired`}
            </div>
          </div>
          <button
            onClick={handleCheckout}
            disabled={scans.length === 0}
            style={{
              background: scans.length === 0 ? "#1a1a1a" : "#b8a878",
              color: scans.length === 0 ? "#555" : "#111",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: scans.length === 0 ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >DONE →</button>
        </div>

        {/* Scrollable list body */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 10px 12px" }}>
          {listTargets.length === 0 && (
            <div style={{ padding: 20, color: "#666", fontSize: 13, fontStyle: "italic", textAlign: "center" }}>
              Your list is empty. Arm IMPULSE BUY below and every scan becomes a new entry.
            </div>
          )}
          {listTargets.map(item => {
            const status = statusByListId.get(item.id);         // "green" | "yellow" | "red" | undefined
            const paired = pairedByListId.get(item.id) || [];
            const isArmed = armedListItemId === item.id;
            const bg = isArmed
              ? "#2a2410"
              : status
                ? STATUS_TILE_BG[status]
                : "#141414";
            const border = isArmed
              ? "#f5c842"
              : status
                ? FLASH_COLORS[status].bg
                : "#1e1e1e";
            return (
              <button
                key={item.id}
                onClick={() => toggleArm(item.id)}
                style={{
                  display: "flex", width: "100%", alignItems: "center", gap: 10,
                  padding: "10px 12px",
                  background: bg,
                  border: `${isArmed ? 2 : 1}px solid ${border}`,
                  borderRadius: 10,
                  marginBottom: 6,
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <div style={{ fontSize: 20 }}>{item.emoji || "🛒"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#f0ece4", fontSize: 14 }}>{item.name}</div>
                  {paired.length > 0 && (
                    <div style={{ fontSize: 10, color: border, marginTop: 2, letterSpacing: 0.6 }}>
                      ✓ {paired.reduce((n, s) => n + (s.qty || 1), 0)} PAIRED · {FLASH_COLORS[status]?.label || status?.toUpperCase()}
                    </div>
                  )}
                </div>
                {isArmed && (
                  <div style={{ fontSize: 10, color: "#f5c842", letterSpacing: 1.2 }}>
                    ARMED
                  </div>
                )}
              </button>
            );
          })}

          {/* IMPULSE BUY arm — always available. Armed → next scan
              silently appends a new list row for the scanned item. */}
          <button
            onClick={() => toggleArm("__impulse__")}
            style={{
              display: "flex", width: "100%", alignItems: "center", gap: 10,
              padding: "10px 12px",
              background: armedListItemId === "__impulse__" ? "#2a2410" : "#141414",
              border: `${armedListItemId === "__impulse__" ? 2 : 1}px ${armedListItemId === "__impulse__" ? "solid" : "dashed"} ${armedListItemId === "__impulse__" ? "#f5c842" : "#555"}`,
              color: "#ddd",
              borderRadius: 10,
              marginTop: 4,
              cursor: "pointer",
              fontSize: 13,
              letterSpacing: 0.6,
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: 18 }}>🛒</span>
            <span style={{ flex: 1 }}>
              IMPULSE BUY — next scan adds as a new list entry
            </span>
            {armedListItemId === "__impulse__" && (
              <span style={{ fontSize: 10, color: "#f5c842", letterSpacing: 1.2 }}>ARMED</span>
            )}
          </button>

          {/* Scan history — stacked at the bottom of the list body so
              users can scroll down to review/adjust qty without a
              floating chip strip competing for scanner focus. */}
          {scans.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid #1a1a1a" }}>
              <div style={{ fontSize: 10, letterSpacing: 1.2, color: "#555", margin: "0 2px 6px" }}>
                RECENT SCANS
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
            </div>
          )}
        </div>
      </div>
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
