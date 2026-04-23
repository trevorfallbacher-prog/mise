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
import { findBarcodeCorrection } from "../lib/barcodeCorrections";
import { supabase } from "../lib/supabase";

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
  // pendingPairScanId — when the user scanned WITHOUT arming first,
  // this holds the scan id waiting for a list-item tap to bind it.
  // Null when the last scan was already handled (armed auto-pair, or
  // manually dismissed). Cleared on pair, on dismiss, or when the
  // user fires a new scan (the new scan takes precedence).
  const [pendingPairScanId, setPendingPairScanId] = useState(null);
  // addAnotherPrompt — fires when the user re-scans a UPC that's
  // already on the trip. We don't silently bump qty; the user
  // explicitly confirms "+1" (another identical package in the
  // cart) or skips (e.g. they bumped the scanner against the same
  // item by accident). Null = no prompt. { scan } = the existing
  // trip_scan to bump on confirm.
  const [addAnotherPrompt, setAddAnotherPrompt] = useState(null);
  // redNameDraft — text the user is typing in the red-scan pick-
  // mode name field. Cleared when the pair completes. Required
  // before the pair goes through so dead-end rows don't stock as
  // "UPC 1234" gibberish.
  const [redNameDraft, setRedNameDraft] = useState("");
  // recentScanId — short (4s) correction window after ANY scan. The
  // next list-item tap within the window re-pairs that scan to the
  // tapped item (moving a wrong auto-pair, or pairing if the scan
  // hadn't auto-matched). Without this, taps after an auto-paired
  // scan would arm the list item instead of correcting the pair —
  // classic fat-finger surprise.
  const [recentScanId, setRecentScanId] = useState(null);
  const recentScanTimerRef = useRef(null);
  // armedRef mirrors armedListItemId so handleDetected (captured in
  // onDetected closure) always reads the freshest value even across
  // rapid scans that don't re-render between each.
  const armedRef = useRef(null);
  useEffect(() => { armedRef.current = armedListItemId; }, [armedListItemId]);
  // listTargets + already-paired-ids + scans mirrored for
  // handleDetected's closure. BarcodeScanner captures its onDetected
  // prop ONCE at mount (inside the polling tick closure), so a
  // plain reference to `scans` from handleDetected would always
  // read the empty-on-mount array — that's why duplicate-UPC
  // detection was silently missing: the re-scan gate found nothing
  // in an empty scans array. Refs are the way out.
  const listTargetsRef = useRef([]);
  const alreadyPairedListIdsRef = useRef(new Set());
  const scansRef = useRef([]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (recentScanTimerRef.current) clearTimeout(recentScanTimerRef.current);
    };
  }, []);

  // Mark the scan that JUST landed so the next list-item tap within
  // 4s re-pairs it (even if it already auto-paired — this is the
  // "oh wait, wrong list item" correction window). A fresh scan
  // resets the timer to point at the new scan.
  function markRecentScan(scanId) {
    setRecentScanId(scanId || null);
    if (recentScanTimerRef.current) clearTimeout(recentScanTimerRef.current);
    if (!scanId) return;
    recentScanTimerRef.current = setTimeout(() => {
      setRecentScanId(null);
    }, 4000);
  }

  // Search filter — live-narrow the list as the user types. Cheap
  // substring match on name (case-insensitive). Empty = pass-through.
  const [search, setSearch] = useState("");

  // Unpurchased list items sorted by the order they were added, with
  // the most-recently-added on top so fresh entries ("I just remembered
  // we need butter") don't get buried. Filtered by search.
  const listTargets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (shoppingList || [])
      .filter(item => !item.purchasedAt)
      .filter(item => !q || String(item.name || "").toLowerCase().includes(q))
      .slice()
      .reverse();
  }, [shoppingList, search]);

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

  // Mirror listTargets + already-paired ids + scans into refs so
  // handleDetected (a closure that's long-lived across scans) reads
  // the freshest values without needing to be re-bound on every tick.
  useEffect(() => { listTargetsRef.current = listTargets; }, [listTargets]);
  useEffect(() => { scansRef.current = scans; }, [scans]);
  useEffect(() => {
    const s = new Set();
    for (const id of pairedByListId.keys()) s.add(id);
    alreadyPairedListIdsRef.current = s;
  }, [pairedByListId]);

  async function handleDetected(rawUpc) {
    if (!activeTrip?.id || !rawUpc) return;
    // Store the raw scanner output verbatim — DO NOT trim leading
    // zeros. Different scanners / decoders return the same physical
    // code in 11/12/13-digit forms; we preserve whatever the
    // scanner actually saw so the database row matches the package
    // label visually. Equivalence across digit-counts is handled
    // at LOOKUP time (findBarcodeCorrection.in([variants]),
    // matchScanToReceiptLine via normalizeBarcode), not at write
    // time. Just sanitize away non-digits + length-validate.
    const upc = (() => {
      const d = String(rawUpc).replace(/\D+/g, "");
      if (d.length < 8 || d.length > 14) return String(rawUpc);
      return d;
    })();
    // Read via ref — BarcodeScanner captured handleDetected at mount
    // time, so `scans` from the closure scope is always the initial
    // empty array. scansRef.current stays in sync via the mirroring
    // effect above.
    const currentScans = scansRef.current || [];
    console.log("[shop-mode] handleDetected", {
      upc,
      upcType: typeof upc,
      upcLen: upc?.length,
      scansCount: currentScans.length,
      existingOnTrip: currentScans.some(s => s.barcodeUpc === upc),
    });
    // Re-scan gate: if this UPC is already on the trip, DON'T silently
    // bump qty. Prompt the user — are you adding another identical
    // package to the cart, or was this a bumped-scanner dupe? Flash
    // fires so they see the recognition, then the add-another sheet
    // takes over until they answer.
    //
    // Match across digit-count variants so re-scanning with a
    // different decoder (different leading-zero count) still
    // correctly identifies the duplicate.
    const upcKey = upcDigitsKey(upc);
    const existing = currentScans.find(s => upcDigitsKey(s.barcodeUpc) === upcKey);
    if (existing) {
      setAddAnotherPrompt({ scan: existing });
      setLastScan({ scan: existing, flashColor: existing.status });
      setFlashVisible(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashVisible(false), FLASH_MS);
      return;
    }

    setLooking(true);

    // Correction memory FIRST — global barcode_identity_corrections
    // then family-scoped user_scan_corrections. findBarcodeCorrection
    // walks both tiers in order and returns the first hit. A
    // correction short-circuits the canonical resolution (highest
    // confidence we have — someone already taught this exact UPC),
    // but we still hit OFF below so brand / productName / nutrition
    // come back fresh for brand_nutrition caching and the pair sheet
    // display. Same pattern the main Scanner uses.
    let correctionCanonicalId = null;
    try {
      const correction = await findBarcodeCorrection(upc);
      if (correction?.canonicalId) {
        correctionCanonicalId = correction.canonicalId;
        console.log("[shop-mode] correction hit", {
          upc,
          canonicalId: correction.canonicalId,
          source: correction.source, // 'global' | 'family'
        });
      }
    } catch (e) {
      console.warn("[shop-mode] findBarcodeCorrection failed:", e);
    }

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
      // Correction memory wins if it hit above — a UPC someone
      // already taught us is higher confidence than the resolver's
      // fuzzy guess. Otherwise fall through to the resolver's tier 1
      // (learned tag map) + tier 2 (fuzzy) path.
      if (correctionCanonicalId) {
        canonicalId = correctionCanonicalId;
        flashColor = "green";
      } else {
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
    } else if (correctionCanonicalId) {
      // OFF miss but we have a taught canonical for this UPC —
      // still green, even without OFF's brand/productName. The row
      // commits with just the canonical; user can add brand later.
      canonicalId = correctionCanonicalId;
      flashColor = "green";
    }

    const scan = await upsertScan({
      upc,
      offPayload,
      canonicalId,
      brand,
      productName,
      status: flashColor,
    });

    // Pair routing — three paths, in priority order:
    //   A) Armed flow: user pre-tapped a list item, scan auto-pairs
    //      to it. Wins over everything else so user intent is
    //      respected. Armed stays on so 6 apples → tap "apples"
    //      once, scan 6×.
    //   B) Green auto-match: scan resolved a canonical, and there's
    //      an unpaired list item that matches either by canonical
    //      id or by a name-level fuzzy hit. Binds silently — no
    //      reason to pester the user when the answer is unambiguous.
    //   C) Scan-first fallback: set pendingPairScanId so the next
    //      list-item tap binds this scan. Used when the scan was
    //      yellow/red (no canonical to match) OR green without a
    //      candidate on the list (impulse buy).
    // If upsertScan just bumped qty on an already-paired trip_scan
    // (user scanning apple #2, #3, …), respect the existing binding
    // and skip all pair routing. Flash still fires so the user sees
    // the status confirmation on every scan.
    if (scan?.id && scan.pairedShoppingListItemId) {
      setLastScan({ scan, flashColor });
      setFlashVisible(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashVisible(false), FLASH_MS);
      return;
    }

    const armed = armedRef.current;
    let autoPairedTo = null;
    if (scan?.id && armed) {
      if (armed === "__impulse__") {
        await doImpulseAdd(scan);
        autoPairedTo = "__impulse__";
      } else {
        await pairScanToList(scan.id, armed);
        autoPairedTo = armed;
      }
      // Consume the armed state on success — one pair per arm. If
      // the user wants to bind another UPC to the same list slot
      // (two brands of salmon → "salmon"), they re-tap. Sticky
      // arming across DIFFERENT upcs surprised users; duplicate
      // detection + the "+1 MORE" prompt covers the 6-apples case.
      setArmedListItemId(null);
      setPendingPairScanId(null);
      markRecentScan(scan.id);
    } else if (scan?.id && (flashColor === "green" || flashColor === "yellow")) {
      // Auto-match: green scans go through all three tiers
      // (canonical → canonical-name → productName). Yellow scans
      // skip the canonical tiers and fall straight to productName
      // token overlap, which still catches the common "corn" on
      // list + "Del Monte Sweet Corn" scan case.
      const match = findListMatchForScan({
        scan,
        listItems: listTargetsRef.current || [],
        alreadyPairedIds: alreadyPairedListIdsRef.current || new Set(),
      });
      if (match) {
        await pairScanToList(scan.id, match);
        autoPairedTo = match;
        setPendingPairScanId(null);
      } else {
        // Nothing on the list looks like this — needs user decision.
        setPendingPairScanId(scan.id);
      }
      markRecentScan(scan.id);
    } else if (scan?.id) {
      // Red — always fall through to pick-mode (no usable text).
      setPendingPairScanId(scan.id);
      markRecentScan(scan.id);
    }

    // Flash banner — always fires; confirms the status regardless of
    // whether a pair landed.
    setLastScan({ scan, flashColor });
    setFlashVisible(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashVisible(false), FLASH_MS);
  }

  // Silent-list-add: builds a fresh shopping_list_items row from the
  // scan's OFF data (or UPC fallback) and pairs the scan to it. Used
  // when the user has armed "impulse mode" on the bottom half.
  //
  // Direct supabase insert (not setShoppingList) so the row exists
  // in the DB BEFORE we try to stamp paired_shopping_list_item_id on
  // the trip_scan — the FK on that column would otherwise reject the
  // pair silently (useSyncedList persists asynchronously, so the
  // optimistic local row isn't in the DB yet when we pair). Realtime
  // subscription picks the row up and adds it to local state.
  async function doImpulseAdd(scan) {
    const name = scan.productName || scan.brand || `Scanned item (${scan.barcodeUpc.slice(-4)})`;
    const newItemId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { error } = await supabase.from("shopping_list_items").insert({
      id:            newItemId,
      user_id:       userId,
      name,
      emoji:         "🛒",
      amount:        scan.qty || 1,
      unit:          "",
      category:      "pantry",
      source:        "trip_impulse",
      ingredient_id: scan.canonicalId || null,
    });
    if (error) {
      console.warn("[shop-mode] impulse list insert failed:", error.message);
      return;
    }
    await pairScanToList(scan.id, newItemId);
  }

  // Re-scan prompt actions. +1 More bumps qty on the existing
  // trip_scan; Skip just closes the prompt.
  async function confirmAddAnother() {
    const target = addAnotherPrompt?.scan;
    if (!target?.id) { setAddAnotherPrompt(null); return; }
    const nextQty = (target.qty || 1) + 1;
    await adjustScanQty(target.id, nextQty);
    setAddAnotherPrompt(null);
  }

  function dismissAddAnother() {
    setAddAnotherPrompt(null);
  }

  // Unified tap handler — two-way flow:
  //   * If a scan is pending (scan-first flow), bind it to the tapped
  //     list item (or run impulse-add for __impulse__).
  //   * Otherwise, toggle ARM on the tapped item (tap-first flow).
  async function handleListTap(listItemId) {
    if (!listItemId) {
      console.warn("[shop-mode] handleListTap: ignoring tap on id-less list item");
      return;
    }
    // Trace what state we read at the moment of tap so we can
    // debug "tap arms instead of pairs" reports — covers the race
    // where a fresh scan landed mid-tap and cleared pendingPairScanId
    // before this handler observed it.
    console.log("[shop-mode] handleListTap", {
      listItemId,
      pendingPairScanId,
      recentScanId,
      armedListItemId,
      scansCount: scans.length,
    });
    // Scan-first flow — pair the pending scan.
    if (pendingPairScanId) {
      const pending = scans.find(s => s.id === pendingPairScanId);
      if (pending) {
        // Red scans need SOME identity before the pair fires — else
        // the pantry row commits as "UPC 34567". Two ways to supply it:
        //   * User typed a name in the pick-mode field (redNameDraft)
        //   * User tapped a real list item — we pull its name down
        // Only IMPULSE without a typed name fails the gate, since
        // impulse has no list target to borrow a name from.
        const isRed = pending.status === "red";
        const typedName = redNameDraft.trim();
        const targetListItem = listItemId === "__impulse__"
          ? null
          : (shoppingList || []).find(i => i.id === listItemId);
        const resolvedName = typedName
          || targetListItem?.name
          || "";
        if (isRed && !resolvedName) {
          // Only way to hit this: IMPULSE tap with no typed name.
          console.log("[shop-mode] red impulse scan still needs a name");
          return;
        }
        // Stamp the resolved name onto trip_scans so the commit pass
        // reads it as the pantry row's display name.
        if (isRed && resolvedName && resolvedName !== pending.productName) {
          try {
            await supabase
              .from("trip_scans")
              .update({ product_name: resolvedName })
              .eq("id", pending.id);
          } catch (e) {
            console.warn("[shop-mode] red-scan name write failed:", e);
          }
        }
        if (listItemId === "__impulse__") {
          await doImpulseAdd(pending);
        } else {
          await pairScanToList(pending.id, listItemId);
        }
      }
      setPendingPairScanId(null);
      setRedNameDraft("");
      markRecentScan(null);
      return;
    }
    // Post-scan correction window REMOVED. The window was set for
    // EVERY scan (including auto-paired ones), which meant a tap
    // intended to ARM a different list item for the next scan got
    // hijacked into "move the just-paired scan to this item." Net
    // effect: user-perceived "fewer scans pair" because their
    // tap-ahead arms got silently re-routed into pair-moves.
    //
    // If a scan auto-pairs to the wrong list item, the user can
    // still correct via the RECENT SCANS chips (UNPAIR) at the
    // bottom of the list, or on the checkout summary's inline
    // editor. pendingPairScanId still handles the in-aisle pickmode
    // case (scan with no auto-match → tap to pair).
    // Tap-first flow — arm / disarm.
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
  // Red-scan hard stop — when a scan came back with no OFF data
  // (status='red'), we pause the scanner and force the user to name
  // it + pair it. Otherwise dead-end rows stock as "UPC 1234"
  // garbage nobody can later cook with. scannerBlocked keys both
  // BarcodeScanner's paused prop and the dark scrim overlay.
  const pendingScan = pendingPairScanId ? scans.find(s => s.id === pendingPairScanId) : null;
  const scannerBlocked = !!(pendingScan && pendingScan.status === "red");

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
      {/* Keyframes for the scan visuals.
          shop-mode-flash       — quick text-banner punch (~900ms)
          shop-mode-panel-flash — quick full-panel wash (~900ms)
          shop-mode-cooldown    — slow fade matching the scanner's
                                  3s global cooldown so users can SEE
                                  when the scanner is ready again. */}
      <style>{`
        @keyframes shop-mode-flash {
          0%   { opacity: 0; transform: translateY(-4px); }
          15%  { opacity: 1; transform: translateY(0); }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes shop-mode-panel-flash {
          0%   { opacity: 0; }
          12%  { opacity: 0.65; }
          55%  { opacity: 0.45; }
          100% { opacity: 0; }
        }
        @keyframes shop-mode-cooldown {
          0%   { opacity: 0.45; }
          100% { opacity: 0; }
        }
      `}</style>

      {/* ── TOP HALF — scanner (embedded) ───────────────────────────── */}
      <div style={{
        flex: "1 1 50%",
        minHeight: 0,
        position: "relative",
        borderBottom: "1px solid #222",
      }}>
        {/* Scanner is paused while a red scan awaits pair + name.
            Forces the user to handle the dead-end scan before firing
            a new one. Stream stays alive so resume is instant. */}
        <BarcodeScanner
          embedded
          mode="rapid"
          paused={scannerBlocked}
          onDetected={handleDetected}
          onCancel={handleCancel}
        />

        {/* Full-panel flash — colored wash over the whole scanner
            pane for visceral "your scan landed" feedback. Keyed
            by lastScan.scan.id so a same-color re-scan still
            re-animates (React remounts the node when the key
            changes). Opacity animation defined as shop-mode-panel-
            flash keyframes below — fades in/out over the same
            FLASH_MS window as the text banner above. */}
        {flash && lastScan?.scan?.id && (
          <div
            key={`panel-flash-${lastScan.scan.id}-${flashVisible ? "on" : "off"}`}
            style={{
              position: "absolute", inset: 0, zIndex: 4,
              background: flash.bg,
              pointerEvents: "none",
              animation: "shop-mode-panel-flash 900ms ease-out",
              mixBlendMode: "screen",
            }}
          />
        )}

        {/* Cooldown overlay — slow fade from the last scan's status
            color to transparent over the full 3s scanner cooldown.
            Gives the user a visual countdown: while there's color
            on the pane, the scanner is dropping scans; when it's
            clear, the next scan will register. Sits under the quick
            flash via lower zIndex so the flash punch is still
            visible on top. */}
        {lastScan?.scan?.id && lastScan.flashColor && (
          <div
            key={`cooldown-${lastScan.scan.id}`}
            style={{
              position: "absolute", inset: 0, zIndex: 3,
              background: FLASH_COLORS[lastScan.flashColor]?.bg || "#444",
              pointerEvents: "none",
              animation: "shop-mode-cooldown 3000ms linear forwards",
              mixBlendMode: "screen",
            }}
          />
        )}

        {/* Blocked overlay — dark scrim over the scanner half when a
            red scan needs a name + pair. Tapping disabled (pointer-
            events), so the user's attention goes to the red prompt
            that sits above it. */}
        {scannerBlocked && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 3,
            background: "rgba(0,0,0,0.68)",
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{
              color: "#fff", fontSize: 13, fontStyle: "italic",
              padding: "8px 14px",
              background: "rgba(138,48,48,0.6)",
              borderRadius: 20,
              letterSpacing: 0.6,
            }}>
              SCANNER PAUSED — NAME + PAIR THE LAST SCAN
            </div>
          </div>
        )}

        {/* Flash overlay — brief colored band on top of the scanner
            panel. On green scans, show the resolved canonical name
            ("FOUND CORN") so the user sees the identity, not just
            the status word. Yellow/red keep their generic labels. */}
        {flash && (() => {
          const s = lastScan?.scan;
          const canonical = s?.canonicalId ? findIngredient(s.canonicalId) : null;
          const display = lastScan?.flashColor === "green"
            ? `FOUND ${(canonical?.shortName || canonical?.name || s?.productName || flash.label).toUpperCase()}`
            : flash.label;
          return (
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
              {display}{looking ? " — LOOKING UP" : null}
            </div>
          );
        })()}

        {/* Add-another prompt — fires when a UPC already on the trip
            is re-scanned. Wins precedence over every other banner
            since the user's mid-decision about qty. +1 bumps;
            SKIP dismisses without change. */}
        {addAnotherPrompt?.scan && !flashVisible && (() => {
          const s = addAnotherPrompt.scan;
          const statusBg = FLASH_COLORS[s.status]?.bg || "#444";
          return (
            <div style={{
              position: "absolute", bottom: 10, left: 10, right: 10, zIndex: 6,
              padding: "10px 12px",
              background: "rgba(22, 18, 10, 0.96)",
              border: `1px solid #f5c842`,
              borderRadius: 8,
              display: "flex", alignItems: "center", gap: 10,
              backdropFilter: "blur(4px)",
            }}>
              <span style={{ color: statusBg, fontSize: 18 }}>●</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, letterSpacing: 1.2, color: "#f5c842" }}>
                  DUPLICATE DETECTED — ALREADY ×{s.qty || 1}
                </div>
                <div style={{
                  fontSize: 14, fontStyle: "italic", color: "#fff",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  Add another {s.productName || s.brand || `item with UPC ${s.barcodeUpc}`}?
                </div>
              </div>
              <button
                onClick={confirmAddAnother}
                style={{
                  background: "#f5c842", color: "#111", border: "none",
                  borderRadius: 6, padding: "6px 12px",
                  fontSize: 12, fontWeight: 700, letterSpacing: 0.8,
                  cursor: "pointer",
                }}
              >YES, +1</button>
              <button
                onClick={dismissAddAnother}
                style={{
                  background: "transparent",
                  color: "#aaa", border: "1px solid #333",
                  borderRadius: 6, padding: "6px 10px",
                  fontSize: 12, letterSpacing: 0.8,
                  cursor: "pointer",
                }}
              >SKIP</button>
            </div>
          );
        })()}

        {/* Pick-mode banner — "scan-first" branch. Last scan is
            waiting for a list-item tap. Red scans (no OFF data) get
            an extra name input since the fallback label "UPC 12345"
            would stock as garbage. Yellow / green scans keep the
            simple "pick which list item this is" copy. */}
        {pendingPairScanId && !flashVisible && !addAnotherPrompt && (() => {
          const pending = scans.find(s => s.id === pendingPairScanId);
          if (!pending) return null;
          const isRed = pending.status === "red";
          const statusBg = FLASH_COLORS[pending.status]?.bg || "#444";
          return (
            <div style={{
              position: "absolute", bottom: 10, left: 10, right: 10, zIndex: 5,
              padding: "10px 12px",
              background: isRed ? "rgba(30, 14, 14, 0.97)" : "rgba(14, 10, 22, 0.94)",
              border: `1px solid ${statusBg}`,
              borderRadius: 8,
              display: "flex", flexDirection: "column", gap: 8,
              backdropFilter: "blur(4px)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ color: statusBg, fontSize: 18 }}>●</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.2, color: isRed ? "#f8c7c7" : "#c7a8d4" }}>
                    {isRed ? "NO DATA — TAP A LIST ITEM OR NAME IT" : "PICK WHICH LIST ITEM THIS IS"}
                  </div>
                  <div style={{
                    fontSize: 14, fontStyle: "italic", color: "#fff",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {pending.productName || pending.brand || `UPC ${pending.barcodeUpc}`}
                  </div>
                </div>
                <button
                  onClick={() => { setPendingPairScanId(null); setRedNameDraft(""); }}
                  style={{
                    background: "transparent", border: "none",
                    color: "#888", fontSize: 18, cursor: "pointer",
                    padding: "0 4px",
                  }}
                  aria-label="Skip"
                >✕</button>
              </div>
              {/* Optional name field for red scans — NOT required if
                  the user taps a list item (we pull the name from
                  that). Only required for an IMPULSE tap (no list
                  target to borrow a name from). */}
              {isRed && (
                <input
                  type="text"
                  value={redNameDraft}
                  onChange={e => setRedNameDraft(e.target.value)}
                  placeholder="Or type it here (needed for impulse buys)"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "#0d0d0d",
                    border: "1px solid #8a3030",
                    borderRadius: 6,
                    color: "#f0ece4",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              )}
            </div>
          );
        })()}

        {/* Armed banner — shows the user what their next scan will
            pair to, so they can confidently fire the scanner. Sits
            pinned at the bottom of the scanner half so it's close to
            the list (which is RIGHT below it). Sits above flash via
            its own zIndex. */}
        {armedListItemId && !flashVisible && !pendingPairScanId && !addAnotherPrompt && (() => {
          const armedItem = armedListItemId === "__impulse__"
            ? { name: "Impulse buy (adds to list on scan)", emoji: "🛒" }
            : listTargets.find(i => i.id === armedListItemId);
          if (!armedItem) return null;
          return (
            <div style={{
              position: "absolute", bottom: 10, left: 10, right: 10, zIndex: 5,
              padding: "10px 12px",
              background: "rgba(12, 22, 30, 0.94)",
              border: "1px solid #7eb8d4",
              borderRadius: 8,
              display: "flex", alignItems: "center", gap: 10,
              backdropFilter: "blur(4px)",
            }}>
              <span style={{ fontSize: 18 }}>{armedItem.emoji || "🛒"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, letterSpacing: 1.2, color: "#7eb8d4" }}>
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
          {/* Search bar — pinned above the list. Narrow by name as
              the user types. Sticky so it stays visible while
              scrolling a long list. */}
          <div style={{
            position: "sticky", top: 0, zIndex: 2,
            background: "#0b0b0b",
            padding: "4px 0 8px",
            marginBottom: 4,
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px",
              background: "#141414",
              border: "1px solid #242424",
              borderRadius: 10,
            }}>
              <span style={{ fontSize: 13, color: "#666" }}>🔍</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Find a list item…"
                style={{
                  flex: 1,
                  background: "transparent", border: "none", outline: "none",
                  color: "#f0ece4",
                  fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  style={{
                    background: "transparent", border: "none",
                    color: "#666", fontSize: 13, cursor: "pointer",
                  }}
                >✕</button>
              )}
            </div>
          </div>

          {/* IMPULSE BUY — pinned near the top so a first-time user
              doesn't have to scroll past the whole list to discover
              it. Same tap-to-arm model as list items; when pick-mode
              is active (pendingPairScanId set), tapping here routes
              to impulse-add for the pending scan. */}
          {(() => {
            const isArmedImpulse = armedListItemId === "__impulse__";
            const isPickMode = !!pendingPairScanId;
            return (
              <button
                onClick={() => handleListTap("__impulse__")}
                style={{
                  display: "flex", width: "100%", alignItems: "center", gap: 10,
                  padding: "10px 12px",
                  background: isArmedImpulse ? "#10202a" : "#141414",
                  border: `${isArmedImpulse ? 2 : 1}px ${isArmedImpulse ? "solid" : "dashed"} ${isArmedImpulse ? "#7eb8d4" : "#555"}`,
                  color: "#ddd",
                  borderRadius: 10,
                  marginBottom: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  letterSpacing: 0.6,
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 18 }}>🛒</span>
                <span style={{ flex: 1 }}>
                  {isPickMode
                    ? "IMPULSE BUY — tap here to add this scan as a new entry"
                    : "IMPULSE BUY — arm, then scan anything off-list"}
                </span>
                {isArmedImpulse && (
                  <span style={{ fontSize: 10, color: "#7eb8d4", letterSpacing: 1.2 }}>ARMED</span>
                )}
              </button>
            );
          })()}

          {listTargets.length === 0 && (
            <div style={{ padding: 20, color: "#666", fontSize: 13, fontStyle: "italic", textAlign: "center" }}>
              {search
                ? `No list items match “${search}”.`
                : "Your list is empty. Arm IMPULSE BUY above and every scan becomes a new entry."}
            </div>
          )}
          {listTargets.map(item => {
            const status = statusByListId.get(item.id);         // "green" | "yellow" | "red" | undefined
            const paired = pairedByListId.get(item.id) || [];
            // isArmed requires BOTH sides to have a concrete id — an
            // id-less item can't match armedListItemId=null (both ===
            // null would wrongly mark every id-less row armed).
            const isArmed = !!item.id && armedListItemId === item.id;
            const isPickMode = !!pendingPairScanId;
            const bg = isArmed
              ? "#10202a"
              : status
                ? STATUS_TILE_BG[status]
                : "#141414";
            const border = isArmed
              ? "#7eb8d4"
              : status
                ? FLASH_COLORS[status].bg
                : "#1e1e1e";
            return (
              <button
                key={item.id}
                onClick={() => handleListTap(item.id)}
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
                  // Pick-mode: dim all rows slightly so the user's
                  // attention goes to the callout telling them to
                  // pick one. Armed rows stay bright since they're
                  // the active focus.
                  opacity: isPickMode && !isArmed ? 0.78 : 1,
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
                  <div style={{ fontSize: 10, color: "#7eb8d4", letterSpacing: 1.2 }}>
                    ARMED
                  </div>
                )}
                {isPickMode && !isArmed && (
                  <div style={{ fontSize: 10, color: "#c7a8d4", letterSpacing: 1.2 }}>
                    PICK →
                  </div>
                )}
              </button>
            );
          })}

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

// Strip a UPC down to its non-zero digit run for duplicate-detection
// equality. "70038000563" / "070038000563" / "0070038000563" all
// reduce to the same key. Used purely for in-memory comparison; the
// stored barcode_upc keeps whatever form the scanner returned.
function upcDigitsKey(b) {
  const d = String(b || "").replace(/\D+/g, "");
  if (!d) return "";
  return d.replace(/^0+/, "") || d;
}

function pairedCount(scans) {
  return scans.filter(s => s.pairedShoppingListItemId).length;
}

function nameForListId(list, id) {
  if (!id) return null;
  return (list || []).find(i => i.id === id)?.name || null;
}

// Find a list-item candidate for a scan. Tries multiple tiers
// before giving up — green scans match via canonical, yellow scans
// (OFF hit but no canonical) still get a shot via productName
// overlap, red scans get nothing (no usable signal).
//
//   1. Canonical id exact match (list item added via picker).
//   2. Canonical name/shortName normalized overlap with list name
//      ("butter" on list, canonical=butter → match).
//   3. OFF productName / brand token overlap with list name —
//      covers the common case where canonicals don't exist ("corn"
//      on list, scan productName="Del Monte Sweet Corn" → the list
//      token 'corn' appears in the product name, match).
//
// Returns list item id or null. Skips items already bound to some
// scan so two scans don't stack onto one list row unless the user
// explicitly re-arms.
function findListMatchForScan({ scan, listItems, alreadyPairedIds }) {
  if (!scan) return null;
  const unpaired = (listItems || []).filter(i => i.id && !alreadyPairedIds.has(i.id));
  if (unpaired.length === 0) return null;

  // Tier 1 — canonical id exact match.
  if (scan.canonicalId) {
    const byCanonical = unpaired.find(i => i.ingredientId === scan.canonicalId);
    if (byCanonical) return byCanonical.id;
  }

  // Tier 2 — canonical name overlap. findIngredient covers bundled
  // canonicals; family-created synthetics aren't in the bundled
  // registry, so we ALSO derive a name from the slug itself
  // (kerrygold_butter → "kerrygold butter") as a safety net. That
  // way an exact match between a family canonical and a bare-text
  // list item ("butter") still pairs.
  if (scan.canonicalId) {
    const ing = findIngredient(scan.canonicalId);
    const slugAsName = scan.canonicalId.replace(/_/g, " ");
    const canonNorms = (ing
      ? [ing.shortName, ing.name, ing.id.replace(/_/g, " ")]
      : [slugAsName])
      .filter(Boolean)
      .map(normalizeName);
    for (const item of unpaired) {
      const itemNorm = normalizeName(item.name);
      if (!itemNorm) continue;
      for (const c of canonNorms) {
        if (!c) continue;
        if (itemNorm === c || itemNorm.includes(c) || c.includes(itemNorm)) {
          return item.id;
        }
      }
    }
  }

  // Tier 3 — productName / brand token overlap. The single-best
  // fallback when canonicals don't bridge. Splits both the list
  // item name and the scan text into tokens, requires a shared
  // non-trivial token (length >= 3 to skip "of", "to", etc.).
  const scanText = [scan.productName, scan.brand].filter(Boolean).join(" ");
  const scanTokens = new Set(
    normalizeName(scanText).split(" ").filter(t => t.length >= 3),
  );
  if (scanTokens.size === 0) return null;
  for (const item of unpaired) {
    const itemTokens = normalizeName(item.name).split(" ").filter(t => t.length >= 3);
    if (itemTokens.some(t => scanTokens.has(t))) return item.id;
  }

  return null;
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
