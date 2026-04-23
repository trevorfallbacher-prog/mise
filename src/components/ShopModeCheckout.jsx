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

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { supabase } from "../lib/supabase";
import { compressImage } from "../lib/compressImage";
import { findIngredient } from "../data/ingredients";
import { parsePackageSize } from "../lib/canonicalResolver";
import { defaultLocationForCategory } from "../lib/usePantry";
import { useIngredientInfo } from "../lib/useIngredientInfo";
import { tagHintsToAxes } from "../lib/tagHintsToAxes";
import LinkIngredient from "./LinkIngredient";
import ModalSheet from "./ModalSheet";
import { FRIDGE_TILES } from "../lib/fridgeTiles";
import { PANTRY_TILES } from "../lib/pantryTiles";
import { FREEZER_TILES } from "../lib/freezerTiles";
import TypePicker from "./TypePicker";
import { findFoodType, inferFoodTypeFromName } from "../data/foodTypes";
import { rememberBarcodeCorrection, findBarcodeCorrection } from "../lib/barcodeCorrections";
import { usePopularPackages } from "../lib/usePopularPackages";
import { useProfile } from "../lib/useProfile";

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

// Normalize barcodes so printing variants of the same product match.
// UPC-A (12 digits) vs EAN-13 (UPC-A with an extra leading "0" for
// US/Canada country prefix) vs 11-digit short-form (leading zero
// dropped on some thermal printers) should all compare equal. The
// safest way to do that without a full checksum rebuild: strip all
// non-digits, then strip ALL leading zeros. "0070038000563" ↔
// "070038000563" ↔ "70038000563" all normalize to the same run.
function normalizeBarcode(b) {
  const digits = String(b || "").replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 14) return "";
  const stripped = digits.replace(/^0+/, "");
  return stripped || digits; // guard against all-zeros sentinels
}

// Walmart (and a few other US retailers) print the item code on
// receipts as "0" + first 11 digits of the manufacturer UPC-A,
// effectively dropping the check digit AND right-shifting:
//   manufacturer UPC-A: 073420000110  (Daisy Sour Cream, 16oz)
//   Walmart receipt:    007342000011
//
// These differ under direct equality AND under leading-zero strip
// (the Walmart form starts with "00", the manufacturer form starts
// with "0"). The common ground is an 11-digit substring shared by
// both. Pull every 11-char window of digits from each side; if any
// window appears on both sides, treat as equivalent. 11 = the data
// portion of UPC-A (12 minus the check digit). False-positive risk
// for valid UPCs is low — UPC-A data portions are essentially
// unique per product.
function upcSubstrings11(b) {
  const d = String(b || "").replace(/\D+/g, "");
  if (d.length < 11) return [];
  const out = [];
  for (let i = 0; i + 11 <= d.length; i++) out.push(d.slice(i, i + 11));
  return out;
}

function upcsEquivalent(a, b) {
  const an = normalizeBarcode(a);
  const bn = normalizeBarcode(b);
  if (an && bn && an === bn) return true;
  const aSubs = upcSubstrings11(a);
  if (aSubs.length === 0) return false;
  const bSubs = new Set(upcSubstrings11(b));
  for (const s of aSubs) if (bSubs.has(s)) return true;
  return false;
}

// Match a trip_scan to a receipt line. UPC direct match wins (the
// receipt prompt now asks the model to pluck the UPC off each line,
// typically printed between the item text and the price on US
// receipts). Falls through to productName/brand ↔ rawText token
// overlap for lines where the UPC wasn't printed or wasn't read.
//
// VERBOSE DIAGNOSTIC LOGGING — every match attempt prints the full
// state so a missed pair has a complete trail: scan UPC + all
// receipt UPCs (raw + normalized + claimed), scan text + tokens,
// every line's text + tokens + shared count, final reason for
// match or no-match. Trade off console noise for diagnosability.
// Match a trip_scan to a receipt line. Two-tier strategy:
//   1. UPC equivalence — direct match after leading-zero strip
//      OR shared 11-digit substring (handles Walmart's POS shift
//      that prepends "0" + drops the manufacturer's check digit).
//   2. Token overlap — productName + brand + paired list slot name
//      tokens vs receipt rawText + name tokens. The list slot name
//      is critical because OFF often returns brand-only productName
//      ("Daisy") and the receipt is product-only ("SOUR CREAM"),
//      so the user's pair intent ("Sour cream" list slot) bridges
//      the vocabularies.
// FOOD CATEGORY uses the USDA-rooted WWEIA food-type system (see
// src/data/foodTypes.js). Scan-draft flow in Kitchen.jsx uses
// TypePicker for this axis; Shop Mode does the same so the two
// surfaces stay aligned. Each typeId maps to a defaultTileId for
// STORED IN inference and (via canonicalIdForType) to a default
// canonical.

const LOCATION_OPTIONS = [
  { id: "fridge",  label: "Fridge",  emoji: "❄️" },
  { id: "pantry",  label: "Pantry",  emoji: "🫙" },
  { id: "freezer", label: "Freezer", emoji: "🧊" },
];

// Tile options for STORED IN — the specific shelf within a location
// (DAIRY, PRODUCE, MEAT & POULTRY, etc.). Keyed by location so the
// picker can narrow to tiles that make sense for the chosen location.
const TILES_BY_LOCATION = {
  fridge:  FRIDGE_TILES,
  pantry:  PANTRY_TILES,
  freezer: FREEZER_TILES,
};
function tileById(id) {
  if (!id) return null;
  return [...FRIDGE_TILES, ...PANTRY_TILES, ...FREEZER_TILES]
    .find(t => t.id === id) || null;
}

// Tile id → broad category string for pantry_items.category. Keeps
// the Kitchen surface's filters / low-stock alerts / recipe match
// working against the existing category enum (dairy / produce /
// meat / dry / pantry / frozen / beverage) while Shop Mode stores
// the finer typeId + tileId axes.
function tileToCategory(tileId) {
  if (!tileId) return "pantry";
  if (/^frozen_/.test(tileId))     return "frozen";
  if (tileId === "dairy")          return "dairy";
  if (tileId === "produce" || tileId === "fresh_herbs") return "produce";
  if (tileId === "meat_poultry" || tileId === "seafood") return "meat";
  if (tileId === "drinks")         return "beverage";
  if (tileId === "condiments" || tileId === "bread_baked" || tileId === "leftovers") return "pantry";
  return "pantry";
}

// Reusable chip styles matching the scan-draft / ItemCard pattern
// (DM Mono 9px, letter-spaced, emoji + UPPERCASE when set, dashed
// grey "+ set <axis>" when unset). Keyed by axis color.
const SET_CHIP = (tone) => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  fontFamily: "'DM Mono',monospace", fontSize: 9,
  color: tone.fg, background: tone.bg,
  border: `1px solid ${tone.border}`,
  borderRadius: 4, padding: "2px 6px",
  letterSpacing: "0.08em", cursor: "pointer",
});
const UNSET_CHIP = {
  fontFamily: "'DM Mono',monospace", fontSize: 9,
  color: "#666", background: "transparent",
  border: "1px dashed #2a2a2a",
  borderRadius: 4, padding: "1px 6px",
  letterSpacing: "0.08em", cursor: "pointer",
};
const CHIP_TONES = {
  canonical:     { fg: "#b8a878", bg: "#1a1508", border: "#3a2f10" }, // tan
  category:      { fg: "#e07a3a", bg: "#1a0f08", border: "#3a1f0e" }, // orange
  location:      { fg: "#7eb8d4", bg: "#0f1620", border: "#1f3040" }, // blue (STORED IN tile)
  locationMuted: { fg: "#7eb8d4aa", bg: "#0d1218", border: "#1a2430" }, // muted blue (LOCATION — fridge/pantry/freezer)
};

// Verbose match-attempt logging is gated behind a localStorage flag.
// Was previously unconditional — every commit emitted N × M log
// groups (N scans × M receipt lines) plus a top-level group per
// scan. Turn on with `localStorage.setItem("debug_receipt_match", "1")`
// when diagnosing a missed pair.
const DEBUG_RECEIPT_MATCH = typeof localStorage !== "undefined"
  && localStorage.getItem("debug_receipt_match") === "1";
const dbgLog      = DEBUG_RECEIPT_MATCH ? console.log.bind(console)      : () => {};
const dbgGroup    = DEBUG_RECEIPT_MATCH ? console.group.bind(console)    : () => {};
const dbgGroupEnd = DEBUG_RECEIPT_MATCH ? console.groupEnd.bind(console) : () => {};

function matchScanToReceiptLine(scan, receiptLines, claimed, pairedListName = null) {
  const scanUpc = normalizeBarcode(scan.barcodeUpc);
  const scanLabel = scan.productName || scan.brand || `UPC ${scan.barcodeUpc}`;

  dbgGroup(`[shop-checkout] match attempt: ${scanLabel}`);
  dbgLog("scan", {
    id: scan.id,
    barcodeUpc: scan.barcodeUpc,
    barcodeUpcNormalized: scanUpc,
    productName: scan.productName,
    brand: scan.brand,
    pairedListName,
  });

  // ── Tier 1: UPC equivalence ─────────────────────────────────
  const upcAttempts = receiptLines.map((l, i) => ({
    i,
    rawText: l?.rawText,
    barcodeRaw: l?.barcode,
    barcodeNormalized: normalizeBarcode(l?.barcode),
    claimed: claimed.has(i),
    upcMatches: !!scanUpc && !claimed.has(i)
      && upcsEquivalent(l?.barcode, scan.barcodeUpc),
  }));
  const receiptHadAnyUpc = upcAttempts.some(a => a.barcodeRaw);
  dbgLog("UPC tier", { scanUpc, lines: upcAttempts });

  if (scanUpc) {
    const byUpc = upcAttempts.findIndex(a => a.upcMatches);
    if (byUpc >= 0) {
      dbgLog(`✅ MATCH via UPC at line ${byUpc}: "${upcAttempts[byUpc].rawText}"`);
      dbgGroupEnd();
      return { idx: byUpc, reason: "upc", diagnostic: null };
    }
  }

  // ── Tier 2: token overlap (productName + brand + list slot) ──
  const scanText = [scan.productName, scan.brand, pairedListName].filter(Boolean).join(" ");
  const scanToks = new Set(
    normalizeName(scanText).split(" ").filter(t => t.length >= 2),
  );
  const tokenAttempts = receiptLines.map((line, i) => {
    const lineText = [line?.rawText, line?.name].filter(Boolean).join(" ");
    const lineToks = normalizeName(lineText).split(" ").filter(t => t.length >= 2);
    let shared = [];
    for (const t of lineToks) if (scanToks.has(t)) shared.push(t);
    return {
      i,
      rawText: line?.rawText,
      lineTokens: lineToks,
      sharedTokens: shared,
      sharedCount: shared.length,
      claimed: claimed.has(i),
    };
  });
  dbgLog("Token tier", { scanText, scanTokens: Array.from(scanToks), lines: tokenAttempts });

  // Require >= 2 shared tokens for a token-fuzzy match to count.
  // Single-word overlaps (e.g. Danish scan tokens {cream, cheese,
  // danish} sharing only "cream" with SOUR CREAM) wrongly pair
  // Danish to sour cream while the actual CHEEZ DANIS receipt
  // line has zero overlap because Walmart truncated both words.
  // Pushing the bar to 2 means matches must have enough signal
  // to really mean the same product. Unpaired scans get fixed
  // manually on the ItemCard.
  const MIN_SHARED_TOKENS = 2;
  let best = -1;
  let bestShared = 0;
  let bestSharedTokens = [];
  if (scanToks.size > 0) {
    for (const a of tokenAttempts) {
      if (a.claimed) continue;
      if (a.sharedCount > bestShared) {
        bestShared = a.sharedCount;
        best = a.i;
        bestSharedTokens = a.sharedTokens;
      }
    }
    if (best >= 0 && bestShared >= MIN_SHARED_TOKENS) {
      dbgLog(`✅ MATCH via tokens at line ${best} (shared ${bestShared}: ${tokenAttempts[best].sharedTokens.join(", ")}): "${tokenAttempts[best].rawText}"`);
      dbgGroupEnd();
      return { idx: best, reason: "tokens", diagnostic: null };
    }
    if (best >= 0 && bestShared > 0) {
      dbgLog(`⚠ token match for line ${best} had only ${bestShared} shared token(s) — below the ${MIN_SHARED_TOKENS} threshold, skipping (generic tokens like "cream" cause false pairs).`);
    }
  }

  dbgLog(`❌ NO MATCH for ${scanLabel}.`);
  dbgGroupEnd();
  // Build a human-readable diagnostic so the review-screen UI can
  // tell the user WHY this scan didn't pair, instead of just
  // showing it priceless and silent.
  const diagnostic = {
    scanUpc,
    scanText,
    scanTokens: Array.from(scanToks),
    receiptHadAnyUpc,
    bestFuzzyLineIdx: best,
    bestFuzzySharedCount: bestShared,
    bestFuzzySharedTokens: bestSharedTokens,
    bestFuzzyRawText: best >= 0 ? tokenAttempts[best].rawText : null,
    minSharedRequired: MIN_SHARED_TOKENS,
  };
  return { idx: -1, reason: "no-match", diagnostic };
}

// Render-side helper: turn a diagnostic object into a one-sentence
// human explanation for the review screen. Keeps the matcher pure
// while still giving the UI a single source of "why didn't this
// pair?" copy.
function explainMissedMatch(diag) {
  if (!diag) return "Couldn't auto-pair this scan to any receipt line.";
  if (diag.scanUpc && !diag.receiptHadAnyUpc) {
    return "Receipt didn't print barcodes on any line, so we couldn't UPC-match. Tap below to pair manually.";
  }
  if (diag.scanUpc && diag.receiptHadAnyUpc) {
    return `Scan UPC ${diag.scanUpc} didn't appear on any receipt line${
      diag.bestFuzzySharedCount > 0
        ? `, and the closest fuzzy match shared only ${diag.bestFuzzySharedCount}/${diag.minSharedRequired} tokens ("${diag.bestFuzzySharedTokens.join(", ")}" with "${diag.bestFuzzyRawText}").`
        : "."
    }`;
  }
  if (diag.bestFuzzySharedCount > 0) {
    return `No UPC on this scan, and the closest fuzzy match shared only ${diag.bestFuzzySharedCount}/${diag.minSharedRequired} tokens ("${diag.bestFuzzySharedTokens.join(", ")}" with "${diag.bestFuzzyRawText}").`;
  }
  return "No UPC and no fuzzy text overlap with any receipt line.";
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
  // Map<scanId, { priceCents, lineIndex, reason }> — which receipt
  // line each scan paired to, and what price to stamp on the pantry
  // row. `reason` is "upc" | "tokens" | "manual".
  const [priceByScan, setPriceByScan] = useState(new Map());
  // Map<scanId, diagnostic> — for scans the auto-matcher COULDN'T
  // pair, the diagnostic explains why. Surfaced inline in the
  // review UI so the user sees the failure reason and can pick a
  // line manually instead of opening devtools to debug.
  const [matchDiagnostics, setMatchDiagnostics] = useState(() => new Map());

  // Manual-pair entry. Tap an unmatched scan in the review screen
  // → state = { scanId } → modal opens listing every unclaimed
  // receipt line. Tap a line → pair the two; close the modal.
  const [manualPairScanId, setManualPairScanId] = useState(null);
  const claimedLineSet = useMemo(() => {
    const s = new Set();
    for (const v of priceByScan.values()) s.add(v.lineIndex);
    return s;
  }, [priceByScan]);
  const pairScanToLine = useCallback((scanId, lineIdx) => {
    setPriceByScan(prev => {
      const next = new Map(prev);
      const line = receiptLines[lineIdx];
      next.set(scanId, {
        priceCents: typeof line?.priceCents === "number" ? line.priceCents : null,
        lineIndex: lineIdx,
        reason: "manual",
      });
      return next;
    });
    // Clear the diagnostic for this scan since it's now paired.
    setMatchDiagnostics(prev => {
      if (!prev.has(scanId)) return prev;
      const next = new Map(prev);
      next.delete(scanId);
      return next;
    });
    setManualPairScanId(null);
  }, [receiptLines]);
  const unpairScan = useCallback((scanId) => {
    setPriceByScan(prev => {
      if (!prev.has(scanId)) return prev;
      const next = new Map(prev);
      next.delete(scanId);
      return next;
    });
  }, []);
  // ingredient_info dbMap — used to pull synthetic canonical info
  // (storage, category, units) for family-created canonicals that
  // aren't in the bundled INGREDIENTS registry.
  const { dbMap: ingredientDbMap } = useIngredientInfo();
  // Admin role drives whether corrections land in the global table
  // or family-scoped. Same gate the main Scanner / AdminPanel uses.
  const { profile } = useProfile(userId);
  const isAdmin = profile?.role === "admin";
  // Local editable copy of the scans array. Edits in the summary
  // phase (name, brand, qty, unpair, delete) write through to DB
  // AND mutate this state so the commit pass + re-renders pick up
  // the fresh values. Initialized once from the snapshot Kitchen
  // handed us when the user tapped DONE in ShopMode.
  const [scans, setScans] = useState(initialScans);
  // Which scan, if any, has its inline editor open. null = closed.
  const [editingScanId, setEditingScanId] = useState(null);
  // Per-scan field overrides the user sets in the inline editor
  // before commit. Keyed by scan id → { amount, unit, category,
  // location }. Overrides win over OFF / canonical defaults when
  // the pantry row is built in doCommit. Kept in local state (not
  // persisted) — edits are lost if the user backs out of checkout.
  const [packageOverrides, setPackageOverrides] = useState(() => new Map());

  // scansRef lets handlePackageChange read the latest scan without
  // becoming identity-unstable on every scan state change. The
  // callback identity has to stay stable because EditableScanLine is
  // React.memo'd — a fresh closure every render would bust the memo
  // and defeat the whole perf rewrite.
  const scansRef = useRef(scans);
  useEffect(() => { scansRef.current = scans; }, [scans]);

  // Per-scan-axis teach error tracker. Keyed by `${scanId}:${axis}`
  // → error message. Surfaces in a top-level toast so the user
  // sees when a chip pick FAILED to save instead of guessing.
  // Cleared automatically on the next successful teach for that key.
  const [teachErrors, setTeachErrors] = useState(() => new Map());

  // teachUpc — the central identity-correction write. Fires
  // rememberBarcodeCorrection for whatever axes the caller passes,
  // surfaces failures into teachErrors so the UI can show a banner.
  // Both handlePackageChange (chip picks) and onCanonicalPicked
  // (LinkIngredient) route through here — no caller writes
  // corrections directly.
  const teachUpc = useCallback((scanId, teach) => {
    const scan = scansRef.current.find(s => s.id === scanId);
    if (!scan?.barcodeUpc) return;
    if (!teach || Object.keys(teach).length === 0) return;
    const errKey = `${scanId}:${Object.keys(teach).join("+")}`;
    rememberBarcodeCorrection({
      userId, isAdmin,
      barcodeUpc: scan.barcodeUpc,
      ...teach,
      ingredientIds: teach.canonicalId
        ? [teach.canonicalId]
        : (scan.canonicalId ? [scan.canonicalId] : []),
      categoryHints: scan.offPayload?.categoryHints || null,
    })
      .then(r => {
        if (r?.error) {
          const msg = r.error.message || String(r.error);
          console.warn("[shop-checkout] teach-on-edit DB error:", msg);
          setTeachErrors(prev => {
            const next = new Map(prev);
            next.set(errKey, msg);
            return next;
          });
        } else {
          setTeachErrors(prev => {
            if (!prev.has(errKey)) return prev;
            const next = new Map(prev);
            next.delete(errKey);
            return next;
          });
        }
      })
      .catch(e => {
        const msg = e?.message || String(e);
        console.warn("[shop-checkout] teach-on-edit threw:", msg);
        setTeachErrors(prev => {
          const next = new Map(prev);
          next.set(errKey, msg);
          return next;
        });
      });
  }, [userId, isAdmin]);

  // CENTRAL edit handler — local override state + teach via teachUpc.
  // Per CLAUDE.md minimal-data-entry rule: every identity-axis edit
  // teaches. Commit-time is too late for UX.
  const handlePackageChange = useCallback((scanId, patch) => {
    setPackageOverrides(prev => {
      const next = new Map(prev);
      const current = next.get(scanId) || {};
      next.set(scanId, { ...current, ...patch });
      return next;
    });
    const teach = {};
    if (patch.typeId)   teach.typeId   = patch.typeId;
    if (patch.tileId)   teach.tileId   = patch.tileId;
    if (patch.location) teach.location = patch.location;
    // Carry the canonical so the teach also stamps it (a chip pick
    // for a row that already has a green canonical should keep that
    // pairing in memory too — defensive against partial rows where
    // typeId teaches without a canonical anchor).
    const scan = scansRef.current.find(s => s.id === scanId);
    if (scan?.canonicalId) teach.canonicalId = scan.canonicalId;
    teachUpc(scanId, teach);
  }, [teachUpc]);

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
      // compressImage returns { base64, mediaType, size }. Receipt
      // mode passes higher fidelity than the default item-label
      // settings: 2000px / quality 0.92. Receipts are text-heavy
      // and the UPCs are printed at ~6-7pt; default 1600/0.72 was
      // turning the digits into a smear that Vision couldn't OCR.
      // Token cost on Haiku 4.5 goes from ~$0.0036 to ~$0.0058
      // per receipt — negligible against the value of an actual
      // UPC pairing. Higher imageSmoothingQuality is set inside
      // compressImage so the canvas downscale doesn't undo the
      // win on the way through.
      const compressed = await compressImage(file, {
        maxDimension: 2000,
        jpegQuality:  0.92,
      }).catch(() => null);
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

      // Pair trip_scans to receipt lines for price attachment AND
      // pull the receipt-line qty multiplier across when it's larger
      // than what the user scanned in-aisle. The receipt is the
      // ground truth for "how many did you actually buy" — if you
      // scanned ONE jar in the aisle but the receipt shows "3 @"
      // then you bought three. Defensive: only ever bump UP, never
      // down (so a user who manually set qty=5 on a row before
      // scanning the receipt isn't trampled by a misread "QTY 1").
      const claimed = new Set();
      const prices = new Map();
      const diags = new Map(); // scanId → diagnostic { reason, ... }
      const qtyBumps = []; // [{ scanId, fromQty, toQty }]
      for (const scan of scans) {
        // Pass the paired list slot's name so the matcher can use
        // its tokens too — fixes the "scan productName is brand-
        // only, receipt rawText is product-only" mismatch.
        const pairedListName = nameForListId(shoppingList, scan.pairedShoppingListItemId);
        const result = matchScanToReceiptLine(scan, lines, claimed, pairedListName);
        if (result.idx >= 0) {
          claimed.add(result.idx);
          prices.set(scan.id, {
            priceCents: typeof lines[result.idx].priceCents === "number" ? lines[result.idx].priceCents : null,
            lineIndex:  result.idx,
            reason:     result.reason,
          });
          const lineQty = Number(lines[result.idx].qty);
          const currentQty = scan.qty || 1;
          if (Number.isFinite(lineQty) && lineQty > currentQty) {
            qtyBumps.push({ scanId: scan.id, fromQty: currentQty, toQty: lineQty });
          }
        } else {
          diags.set(scan.id, result.diagnostic);
        }
      }
      setPriceByScan(prices);
      setMatchDiagnostics(diags);
      // Apply qty bumps in parallel — each is a small DB write, and
      // patchScan is optimistic so the UI updates immediately. Don't
      // await: by the time the user reviews the receipt, the bumps
      // have already landed locally; the DB write catches up.
      if (qtyBumps.length > 0) {
        console.log("[shop-checkout] receipt qty multipliers found:", qtyBumps);
        Promise.all(qtyBumps.map(b => patchScan(b.scanId, { qty: b.toQty })))
          .catch(e => console.warn("[shop-checkout] qty bump failed:", e?.message || e));
      }
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
      // Pre-fetch correction memory per UPC so taught typeId /
      // tileId / location flow into the cascade below. Parallel
      // fetch keeps the commit pass snappy even when the trip has
      // 10+ scans.
      const correctionByUpc = new Map();
      await Promise.all(scans.map(async s => {
        if (!s.barcodeUpc) return;
        try {
          const corr = await findBarcodeCorrection(s.barcodeUpc);
          if (corr) correctionByUpc.set(s.barcodeUpc, corr);
        } catch { /* best-effort */ }
      }));
      // Build every pantry_items row synchronously first, then fan
      // out the inserts in parallel. Was previously a serial
      // for-await loop — N round-trips at network latency before the
      // user got past "Stocking…". Per-row build is still inline
      // (the cascade is per-scan and references closed-over
      // ingredientDbMap / packageOverrides etc.), but the awaits
      // now stack up on the network instead of the JS thread.
      const builtRows = scans.map(scan => {
        const priceInfo = priceByScan.get(scan.id);
        const taught = correctionByUpc.get(scan.barcodeUpc) || null;
        const id = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        // Display name: prefer the canonical's shortName (so the
        // HEADER renders "Butter" not "Kerrygold Unsalted Butter
        // 8oz"), then fall back to OFF productName, then UPC. The
        // brand goes into the BRAND column where the ItemCard
        // header derives "Kerrygold Butter" — falling back to
        // scan.brand for `name` was forcing brand into the display
        // name slot AND duplicating it once HEADER tried to derive
        // brand+name. CLAUDE.md identity hierarchy: brand is its
        // own axis, never inline-prefixed into name.
        const canon = scan.canonicalId ? findIngredient(scan.canonicalId) : null;
        const synthInfo = !canon && scan.canonicalId ? ingredientDbMap?.[scan.canonicalId] : null;
        const displayName = canon?.shortName
          || canon?.name
          || scan.productName
          || `UPC ${scan.barcodeUpc}`;

        // Package size cascade. User override (typed in the review
        // screen's inline editor) wins over everything so the user
        // can correct OFF misses without post-commit edits. Then OFF
        // parsed quantity, then canonical defaults. qty multiplier
        // applies to whichever package size we land on — 2 × 16oz
        // packages → amount = 32.
        const offQty = scan.offPayload?.quantity || null;
        const offPkg = parsePackageSize(offQty);
        const override = packageOverrides.get(scan.id) || null;
        const qtyCount = scan.qty || 1;
        const pkgAmount = (override?.amount != null && override.amount > 0)
          ? override.amount
          : (offPkg?.amount != null ? offPkg.amount : null);
        const pkgUnit = override?.unit
          || offPkg?.unit
          || canon?.defaultUnit
          || (Array.isArray(canon?.units) && canon.units[0]?.id)
          || "package";
        const amount = pkgAmount != null ? pkgAmount * qtyCount : qtyCount;
        const unit = pkgUnit;
        // max (the "full package" baseline the consumption slider
        // walks down from) = the amount we just decided. User
        // adjusts later as they eat.
        const maxValue = amount;

        // Category — cascade:
        //   0. user override from the review-screen picker (wins)
        //   1. bundled canonical.category
        //   2. synthetic canonical info (family-created, enriched)
        //   3. OFF categoryHints → tagHintsToAxes (dairy / produce /
        //      meat / frozen / beverage inference from OFF's tag
        //      family — critical when the canonical is BRAND NEW
        //      and has no enrichment yet)
        //   4. "pantry" default (satisfies NOT NULL constraint)
        const offAxes = tagHintsToAxes(scan.offPayload?.categoryHints || []);
        const category = override?.category
          || canon?.category
          || synthInfo?.info?.category
          || offAxes.category
          || "pantry";

        // Storage location cascade:
        //   0. user override from the review-screen picker (wins)
        //   1. taught correction (family or global memory)
        //   2. canonical.storage.location (bundled)
        //   3. synthetic canonical info
        //   4. defaultLocationForCategory(category) — derived above
        const canonStorage = canon?.storage?.location
          || synthInfo?.info?.storage?.location
          || null;
        const location = override?.location
          || taught?.location
          || canonStorage
          || defaultLocationForCategory(category);

        // STORED IN tile (specific shelf within the location).
        // Cascade: override → taught correction → canonical storage
        // → OFF axes → null.
        const canonTileId = canon?.storage?.tileId
          || synthInfo?.info?.storage?.tileId
          || null;
        const tileId = override?.tileId
          || taught?.tileId
          || canonTileId
          || offAxes.tileId
          || null;

        const row = {
          id,
          user_id: userId,
          name:           displayName,
          emoji:          canon?.emoji || "🛒",
          amount,
          unit,
          max:            maxValue,
          category,
          low_threshold:  0.25,
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
          location,
          tile_id: tileId,
          type_id: override?.typeId
            || taught?.typeId
            || offAxes.typeId
            || inferFoodTypeFromName(displayName || scan.productName || scan.brand || "")
            || null,
          purchased_at:   nowIso,
        };
        return { scan, row, id };
      });

      // Fan out the inserts in parallel. Each insert is independent
      // (no FK between rows in this batch), so this is safe and
      // takes max(latency) instead of sum(latency).
      const insertResults = await Promise.all(builtRows.map(({ scan, row, id }) =>
        supabase.from("pantry_items").insert(row).then(
          res => ({ scan, row, id, error: res.error }),
          err => ({ scan, row, id, error: err })
        )
      ));
      // Per-row settle pass: collect successes into newPantryIds and
      // failures into insertErrors. Then queue every successful row's
      // teach in parallel (rememberBarcodeCorrection is fire-and-
      // forget; the .catch() surfaces failures into teachErrors and
      // the console).
      const teachQueue = [];
      for (const { scan, row, id, error } of insertResults) {
        if (error) {
          console.error("[shop-checkout] pantry insert FAILED", error.message, { scan, row });
          insertErrors.push({ scan, message: error.message });
          continue;
        }
        newPantryIds.set(scan.id, id);
        // Teach UPC → identity memory for EVERY committed pantry
        // row, not just the ones where the user explicitly overrode
        // an axis. The cascade above has already resolved the best
        // value we know for typeId/tileId/location; that resolved
        // answer IS what the next scanner should see. teach-on-edit
        // in handlePackageChange covers in-flight chip picks; this
        // covers commit-time finalization for rows the user never
        // touched.
        const correctionPatch = {};
        if (row.type_id)      correctionPatch.typeId      = row.type_id;
        if (row.tile_id)      correctionPatch.tileId      = row.tile_id;
        if (row.location)     correctionPatch.location    = row.location;
        if (scan.canonicalId) correctionPatch.canonicalId = scan.canonicalId;
        if (scan.barcodeUpc && Object.keys(correctionPatch).length > 0) {
          teachQueue.push(
            rememberBarcodeCorrection({
              userId,
              isAdmin,
              barcodeUpc: scan.barcodeUpc,
              ...correctionPatch,
              emoji: row.emoji,
              ingredientIds: row.components || (scan.canonicalId ? [scan.canonicalId] : []),
              categoryHints: scan.offPayload?.categoryHints || null,
            })
              .then(r => {
                if (r?.error) console.warn("[shop-checkout] rememberBarcodeCorrection DB error:", r.error.message || r.error);
              })
              .catch(e => console.warn("[shop-checkout] rememberBarcodeCorrection threw:", e?.message || e))
          );
        }
      }
      // Don't await the teach queue — it's fire-and-forget by
      // design (CLAUDE.md: "Fire-and-forget with a `.catch`. A
      // correction write failing should never block the user's
      // main flow"). Just hold the references so console output
      // sequences correctly within this commit.
      void teachQueue;

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

      // 3 + 4. Fan out trip_scans audit updates and shopping list
      // mark-purchased updates in parallel. Was previously two
      // sequential await-per-scan loops (so a 10-item trip = 20
      // round-trips serially), turning the "Stocking your kitchen…"
      // pause into something that felt frozen on cellular. Each
      // update still keys on a single id, so RLS + indexes are
      // unchanged — only the wall-clock improves.
      const tripScanUpdates = scans
        .map(scan => {
          const patch = {};
          const pid = newPantryIds.get(scan.id);
          if (pid) patch.paired_pantry_item_id = pid;
          const priceInfo = priceByScan.get(scan.id);
          if (priceInfo) patch.paired_receipt_line_index = priceInfo.lineIndex;
          if (Object.keys(patch).length === 0) return null;
          return supabase.from("trip_scans").update(patch).eq("id", scan.id);
        })
        .filter(Boolean);
      const listItemUpdates = scans
        .filter(scan => scan.pairedShoppingListItemId)
        .map(scan => {
          const pid = newPantryIds.get(scan.id);
          return supabase.from("shopping_list_items").update({
            purchased_at: nowIso,
            purchased_pantry_item_id: pid || null,
            purchased_trip_id: trip.id,
          }).eq("id", scan.pairedShoppingListItemId);
        });
      await Promise.all([...tripScanUpdates, ...listItemUpdates]);

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

  // Edit handlers — OPTIMISTIC. The previous version awaited the
  // round-trip before the UI moved, so qty bumps and chip picks
  // felt laggy on cellular and made the screen feel "stuck." Now:
  // apply the patch to local state immediately, fire the DB write,
  // roll back if it fails. Wrapped in useCallback so React.memo on
  // EditableScanLine catches.
  const patchScan = useCallback(async (scanId, patch) => {
    // Translate DB-shape patch (snake_case) into the camelCase local
    // scan shape so the optimistic apply matches the eventual DB
    // round-trip. Keep this list in sync with remapFromDb if more
    // fields become editable.
    const localPatch = {};
    if ("product_name" in patch)                  localPatch.productName              = patch.product_name;
    if ("brand" in patch)                         localPatch.brand                    = patch.brand;
    if ("qty" in patch)                           localPatch.qty                      = patch.qty;
    if ("canonical_id" in patch)                  localPatch.canonicalId              = patch.canonical_id;
    if ("status" in patch)                        localPatch.status                   = patch.status;
    if ("paired_shopping_list_item_id" in patch)  localPatch.pairedShoppingListItemId = patch.paired_shopping_list_item_id;

    const snapshot = scansRef.current;
    setScans(prev => prev.map(s => s.id === scanId ? { ...s, ...localPatch } : s));

    const { data, error: e } = await supabase
      .from("trip_scans")
      .update(patch)
      .eq("id", scanId)
      .select("*")
      .single();
    if (e) {
      console.warn("[shop-checkout] patchScan failed, rolling back:", e.message, patch);
      setScans(snapshot);
      setError(`Couldn't save change: ${e.message}`);
      return false;
    }
    // Reconcile with server (server may apply defaults/triggers).
    setScans(prev => prev.map(s => s.id === scanId ? { ...s, ...remapFromDb(data) } : s));
    return true;
  }, []);

  const deleteScan = useCallback(async (scanId) => {
    const ok = window.confirm("Remove this scan from the trip? It won't be stocked on commit.");
    if (!ok) return;
    // Optimistic remove: hide the row immediately so the tap feels
    // instant. Roll back on DB failure.
    const snapshot = scansRef.current;
    setScans(prev => prev.filter(s => s.id !== scanId));
    setEditingScanId(prev => prev === scanId ? null : prev);
    const { error: e } = await supabase.from("trip_scans").delete().eq("id", scanId);
    if (e) {
      console.warn("[shop-checkout] deleteScan failed, rolling back:", e.message);
      setScans(snapshot);
      setError(`Couldn't delete scan: ${e.message}`);
    }
  }, []);

  const handleToggleEdit = useCallback((scanId) => {
    setEditingScanId(prev => prev === scanId ? null : scanId);
  }, []);

  const handleUnpair = useCallback((scanId) => {
    return patchScan(scanId, { paired_shopping_list_item_id: null });
  }, [patchScan]);

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
                onToggle={handleToggleEdit}
                onPatch={patchScan}
                onDelete={deleteScan}
                onUnpair={handleUnpair}
                packageOverride={packageOverrides.get(s.id) || null}
                onPackageChange={handlePackageChange}
                onTeach={teachUpc}
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
          {teachErrors.size > 0 && (
            <div style={{
              marginTop: 14, padding: "10px 12px",
              background: "#2b2418", border: "1px solid #8a6a30",
              borderRadius: 8, color: "#f8e0a0", fontSize: 12,
              fontFamily: "'DM Sans',sans-serif",
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {teachErrors.size} pairing{teachErrors.size === 1 ? "" : "s"} didn't save to memory
              </div>
              <div style={{ fontSize: 11, color: "#d8c890", lineHeight: 1.5 }}>
                The pantry rows will still commit with the values you chose, but
                the UPC won't auto-resolve next time. Most common cause: a database
                migration hasn't been applied. First error: <span style={{ fontFamily: "'DM Mono',monospace" }}>
                {Array.from(teachErrors.values())[0]}
                </span>
              </div>
            </div>
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
            {matchDiagnostics.size > 0 && (
              <span style={{ display: "block", marginTop: 6, color: "#f8c87a" }}>
                {matchDiagnostics.size} unpaired — tap "PAIR" on each to fix.
              </span>
            )}
          </div>

          {/* Claude Vision UPC report — shows EXACTLY what Vision
              returned for each receipt line's barcode field. This is
              the answer to "why don't UPCs match?" — if this list is
              all `null` then Vision didn't read the digits off the
              receipt at all (prompt issue or photo quality), and no
              amount of matcher tuning will help. If digits ARE here
              but they don't match a scan UPC, the issue is
              normalization / Walmart-shift handling. <details> to
              keep it folded by default; tap to expand. */}
          {receiptLines.length > 0 && (
            <details style={{
              marginBottom: 14,
              background: "#101010",
              border: "1px solid #2a2a2a",
              borderRadius: 8,
              padding: "8px 12px",
            }}>
              <summary style={{
                cursor: "pointer",
                fontFamily: "'DM Mono',monospace",
                fontSize: 11,
                color: "#aaa",
                letterSpacing: "0.08em",
              }}>
                CLAUDE VISION UPC REPORT · {receiptLines.filter(l => l?.barcode).length}/{receiptLines.length} LINES HAD UPCS
              </summary>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {receiptLines.map((line, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#aaa", padding: "3px 0",
                    borderBottom: i < receiptLines.length - 1 ? "1px solid #1a1a1a" : "none",
                  }}>
                    <span style={{ color: "#666", width: 24, flexShrink: 0 }}>#{i}</span>
                    <span style={{
                      width: 110, flexShrink: 0,
                      color: line?.barcode ? "#9bd89b" : "#5a3030",
                    }}>
                      {line?.barcode || "(no UPC)"}
                    </span>
                    <span style={{
                      flex: 1, minWidth: 0,
                      color: "#888",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {line?.rawText || line?.name || "(blank)"}
                    </span>
                    {typeof line?.priceCents === "number" && (
                      <span style={{ color: "#f5c842", flexShrink: 0 }}>
                        ${(line.priceCents / 100).toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{
                marginTop: 8, fontSize: 10, color: "#666",
                fontFamily: "'DM Sans',sans-serif", lineHeight: 1.4,
              }}>
                Green = Vision extracted a UPC. Red = Vision returned no UPC for that line.
                Compare against your scan UPCs above. Mostly red means Vision didn't read
                the digits; redeploy <code style={{ color: "#888" }}>scan-receipt</code> after
                a prompt change or try a sharper photo.
              </div>
            </details>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {scans.map(s => {
              const priceInfo = priceByScan.get(s.id);
              const diag = matchDiagnostics.get(s.id);
              return (
                <TripScanLine
                  key={s.id}
                  scan={s}
                  listName={nameForListId(shoppingList, s.pairedShoppingListItemId)}
                  priceCents={priceInfo?.priceCents ?? null}
                  reason={priceInfo?.reason || null}
                  matchedRawText={
                    priceInfo
                      ? receiptLines[priceInfo.lineIndex]?.rawText || null
                      : null
                  }
                  diagnostic={diag || null}
                  onManualPair={() => setManualPairScanId(s.id)}
                  onUnpair={priceInfo ? () => unpairScan(s.id) : null}
                />
              );
            })}
          </div>

          {/* Unclaimed receipt lines — every line that didn't pair to a
              scan. Useful for: (a) confirming the receipt parser got
              everything, (b) spotting items the user bought without
              scanning in-aisle. Read-only for now; the manual-pair
              flow lives on each unmatched scan. */}
          {(() => {
            const unclaimed = receiptLines
              .map((line, i) => ({ line, i }))
              .filter(({ i }) => !claimedLineSet.has(i));
            if (unclaimed.length === 0) return null;
            return (
              <div style={{ marginTop: 20 }}>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  color: "#888", letterSpacing: "0.12em", marginBottom: 6,
                }}>
                  RECEIPT LINES NOT PAIRED · {unclaimed.length}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {unclaimed.map(({ line, i }) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 10px",
                      background: "#101010",
                      border: "1px dashed #2a2a2a",
                      borderRadius: 8,
                      fontSize: 12, color: "#aaa",
                    }}>
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {line.rawText || line.name || "(blank)"}
                        {line.barcode && (
                          <span style={{ marginLeft: 8, fontFamily: "'DM Mono',monospace", color: "#666", fontSize: 10 }}>
                            {line.barcode}
                          </span>
                        )}
                      </span>
                      {typeof line.priceCents === "number" && (
                        <span style={{ fontFamily: "'DM Mono',monospace", color: "#f5c842", fontSize: 12 }}>
                          ${(line.priceCents / 100).toFixed(2)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {error && (
            <div style={{
              marginTop: 14, padding: "10px 12px",
              background: "#2b1818", border: "1px solid #8a3030",
              borderRadius: 8, color: "#f8c7c7", fontSize: 13,
            }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              onClick={() => { setImageData(null); setPriceByScan(new Map()); setMatchDiagnostics(new Map()); setReceiptLines([]); setPhase("summary"); }}
              style={secondaryBtn}
            >← Retake</button>
            <button
              onClick={() => doCommit({ withReceipt: true })}
              style={{ ...primaryBtn, flex: 2 }}
            >COMMIT {scans.length} TO KITCHEN →</button>
          </div>

          {/* Manual-pair picker — open when the user taps PAIR on any
              unmatched scan in the list above. Shows every receipt
              line that hasn't been claimed yet, ordered by index. */}
          {manualPairScanId && (() => {
            const targetScan = scans.find(s => s.id === manualPairScanId);
            const unclaimed = receiptLines
              .map((line, i) => ({ line, i }))
              .filter(({ i }) => !claimedLineSet.has(i));
            return (
              <ModalSheet onClose={() => setManualPairScanId(null)} maxHeight="80vh">
                <div style={pickerKicker("#f5c842")}>PAIR TO RECEIPT LINE</div>
                <h2 style={pickerTitle}>
                  Which receipt line is "{targetScan?.productName || targetScan?.brand || `UPC ${targetScan?.barcodeUpc}`}"?
                </h2>
                <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.5, margin: "0 0 14px" }}>
                  {unclaimed.length === 0
                    ? "All receipt lines are already paired. Unpair another scan first."
                    : `Showing ${unclaimed.length} unpaired line${unclaimed.length === 1 ? "" : "s"}. Tap one.`}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {unclaimed.map(({ line, i }) => (
                    <button
                      key={i}
                      onClick={() => pairScanToLine(manualPairScanId, i)}
                      style={pickerOptionStyle(false, { fg: "#f5c842", bg: "#1e1a0e", border: "#3a3010" })}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, color: "#f0ece4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {line.rawText || line.name || "(blank line)"}
                        </div>
                        {line.barcode && (
                          <div style={{ fontSize: 10, color: "#888", marginTop: 2, fontFamily: "'DM Mono',monospace" }}>
                            {line.barcode}
                          </div>
                        )}
                      </div>
                      {typeof line.priceCents === "number" && (
                        <span style={{ color: "#f5c842", fontSize: 13, fontFamily: "'DM Mono',monospace" }}>
                          ${(line.priceCents / 100).toFixed(2)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </ModalSheet>
            );
          })()}
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
const EditableScanLine = memo(function EditableScanLine({
  scan, listName, isOpen, onToggle, onPatch, onDelete, onUnpair,
  packageOverride = null, onPackageChange, onTeach,
}) {
  // Name + brand are UNCONTROLLED — defaultValue + ref + onBlur. Was
  // previously controlled (useState + onChange) but every keystroke
  // triggered a full row re-render, which on a 10-item trip with all
  // the chip JSX still mounted made typing feel like wading through
  // mud. The browser handles per-keystroke text natively here; React
  // only sees the value on blur, so mid-typing renders are zero.
  const nameRef  = useRef(null);
  const brandRef = useRef(null);
  // Package size — default to OFF-parsed when blank. offParsed is
  // memoized below so the useState initializer doesn't recompute.
  const offParsed = useMemo(
    () => parsePackageSize(scan.offPayload?.quantity || null),
    [scan.offPayload],
  );
  // Package size inputs use the same uncontrolled pattern as name/
  // brand. The popular-size chips below need to programmatically
  // overwrite these inputs (tap-to-fill), which is why we hold refs.
  const pkgAmountRef = useRef(null);
  const pkgUnitRef   = useRef(null);
  // LinkIngredient picker — embedded as a full-screen modal on tap.
  // Covers bundled fuzzy match + admin-approved synthetics + the
  // ⭐ create-new-canonical flow. Picked id writes to trip_scans.canonical_id.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Axis picker ModalSheets. null = closed; "category" / "location"
  // opens the respective list. Matches the scan-draft pattern in
  // Kitchen.jsx where tapping a chip swaps to a ModalSheet-wrapped
  // picker rather than revealing inline dropdowns.
  const [axisPicker, setAxisPicker] = useState(null);

  // Uncontrolled inputs reset only when their `key` changes (we
  // re-key on scan.id so a different scan replaces the input
  // instances entirely). Within the same scan, realtime updates
  // from a different client are extremely unlikely during checkout
  // — the prior controlled-input sync was overkill for the cost.

  const color = FLASH_COLORS[scan.status]?.bg || "#444";
  const label = scan.productName || scan.brand || `UPC ${scan.barcodeUpc.slice(-6)}`;

  // The full resolve cascade — memoized on the real inputs so we
  // don't re-run findIngredient / tagHintsToAxes /
  // inferFoodTypeFromName / findFoodType / tileById on every parent
  // render. This was the main heat source: N rows × 6 lookups × every
  // keystroke anywhere in the checkout = phone hot enough to fry an
  // egg.
  const resolved = useMemo(() => {
    const currentCanonical = scan.canonicalId ? findIngredient(scan.canonicalId) : null;
    const canonicalLabel = currentCanonical
      ? `${currentCanonical.emoji || ""} ${currentCanonical.shortName || currentCanonical.name}`
      : scan.canonicalId || null;

    let offCategoryAxes;
    try { offCategoryAxes = tagHintsToAxes(scan.offPayload?.categoryHints || []); }
    catch { offCategoryAxes = { category: null, tileId: null, typeId: null }; }

    const inferredTypeId = inferFoodTypeFromName(scan.productName || scan.brand || "") || null;
    const effectiveTypeId = packageOverride?.typeId
      || offCategoryAxes.typeId
      || inferredTypeId
      || null;
    const effectiveType = effectiveTypeId ? findFoodType(effectiveTypeId) : null;
    const effectiveCategory = effectiveType?.defaultTileId
      ? tileToCategory(effectiveType.defaultTileId)
      : (currentCanonical?.category
        || offCategoryAxes.category
        || "pantry");
    const effectiveLocation = packageOverride?.location
      || currentCanonical?.storage?.location
      || defaultLocationForCategory(effectiveCategory);
    const effectiveTileId = packageOverride?.tileId
      || currentCanonical?.storage?.tileId
      || offCategoryAxes.tileId
      || null;
    const effectiveTile = tileById(effectiveTileId);

    return {
      currentCanonical, canonicalLabel,
      inferredTypeId,
      effectiveTypeId, effectiveType,
      effectiveCategory, effectiveLocation,
      effectiveTileId, effectiveTile,
    };
  }, [
    scan.canonicalId,
    scan.offPayload,
    scan.productName,
    scan.brand,
    packageOverride?.typeId,
    packageOverride?.tileId,
    packageOverride?.location,
  ]);
  const {
    currentCanonical, canonicalLabel,
    inferredTypeId,
    effectiveTypeId, effectiveType,
    effectiveLocation,
    effectiveTileId, effectiveTile,
  } = resolved;

  // Effective package size for the collapsed preview.
  const effectiveSize = useMemo(() => {
    if (packageOverride?.amount != null && packageOverride.amount > 0) {
      return {
        amount: packageOverride.amount,
        unit: packageOverride.unit || offParsed?.unit || currentCanonical?.defaultUnit || "",
      };
    }
    if (offParsed?.amount != null) return offParsed;
    return null;
  }, [packageOverride?.amount, packageOverride?.unit, offParsed, currentCanonical]);
  const sizeLabel = effectiveSize
    ? `${effectiveSize.amount}${effectiveSize.unit ? " " + effectiveSize.unit : ""}`
    : "";

  // Popular package sizes for this (brand, canonical). Cached one
  // minute in usePopularPackages. Surfaced as tap-to-fill chips below
  // the amount/unit inputs — turns a typing chore into a tap. Gated
  // on isOpen: the chips only render inside the expanded editor, so
  // there's no point firing the RPC for collapsed rows. With 10
  // items in a trip that's the difference between 10 fetches on
  // mount and 0; the hook re-fires the instant the user taps in.
  const { rows: popularRows } = usePopularPackages(
    isOpen ? (scan.brand || null) : null,
    isOpen ? (scan.canonicalId || null) : null,
    5,
  );
  const top3 = useMemo(() => (popularRows || []).slice(0, 3), [popularRows]);

  const saveTextFields = useCallback(async () => {
    const nextName  = nameRef.current?.value  ?? "";
    const nextBrand = brandRef.current?.value ?? "";
    const patch = {};
    if (nextName  !== (scan.productName || "")) patch.product_name = nextName.trim()  || null;
    if (nextBrand !== (scan.brand || ""))       patch.brand        = nextBrand.trim() || null;
    if (Object.keys(patch).length === 0) return;
    await onPatch(scan.id, patch);
  }, [scan.id, scan.productName, scan.brand, onPatch]);

  const bumpQty = useCallback(async (delta) => {
    const next = Math.max(1, (scan.qty || 1) + delta);
    if (next === scan.qty) return;
    await onPatch(scan.id, { qty: next });
  }, [scan.id, scan.qty, onPatch]);

  // LinkIngredient picked a canonical (single-mode → first id is the
  // pick). Write it + re-classify status + teach the UPC immediately
  // so the next scan of the same product auto-resolves. Was previously
  // only taught at commit-time; if the user picked a canonical and
  // backed out before commit, the teaching never happened.
  const onCanonicalPicked = useCallback(async (ids) => {
    const next = Array.isArray(ids) && ids.length ? ids[0] : null;
    const patch = { canonical_id: next };
    if (next) patch.status = "green";
    else if (scan.offPayload) patch.status = "yellow";
    await onPatch(scan.id, patch);
    setPickerOpen(false);
    if (next) onTeach?.(scan.id, { canonicalId: next });
  }, [scan.id, scan.offPayload, onPatch, onTeach]);

  return (
    <div style={{
      background: "#141414",
      border: `1px solid ${color}55`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <button
        onClick={() => onToggle(scan.id)}
        style={{
          display: "flex", width: "100%", alignItems: "center", gap: 10,
          padding: "10px 12px",
          background: "transparent", border: "none",
          color: "#f0ece4", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ color, fontSize: 14, flexShrink: 0 }}>●</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Row 1: name + package-size badge inline so the user
              can see "Sour Cream · 16 oz" at a glance without
              opening the editor. The ×qty multiplier shows after
              the size when > 1 so "×2" reads as "two of the 16oz
              packages" not "two of the product." */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <div style={{
              fontSize: 15, color: "#f0ece4",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              flex: "1 1 auto", minWidth: 0,
            }}>
              {label}
            </div>
            {sizeLabel && (
              <div style={{
                flex: "0 0 auto",
                fontSize: 11,
                color: "#b8a878",
                fontFamily: "'DM Mono',monospace",
                letterSpacing: 0.3,
              }}>
                {sizeLabel}{scan.qty > 1 ? ` ×${scan.qty}` : ""}
              </div>
            )}
            {!sizeLabel && scan.qty > 1 && (
              <div style={{ flex: "0 0 auto", fontSize: 11, color: "#888" }}>
                ×{scan.qty}
              </div>
            )}
          </div>
          {/* Row 2: pair + identity metadata in a single muted line.
              list slot · brand · canonical. Falls through gracefully
              when pieces are null. */}
          <div style={{ color: "#888", fontSize: 11, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {listName ? `→ ${listName}` : "unpaired"}
            {scan.brand ? ` · ${scan.brand}` : ""}
            {canonicalLabel ? ` · ${canonicalLabel}` : ""}
          </div>
          {/* Row 3: axis chips — CATEGORY (orange) + STORED IN tile
              (blue) + LOCATION (muted blue). All directly tappable
              — no need to open the full editor. stopPropagation
              so the tap doesn't also toggle the editor. */}
          <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
            {effectiveType ? (
              <button
                onClick={e => { e.stopPropagation(); setAxisPicker("category"); }}
                style={SET_CHIP(CHIP_TONES.category)}
                aria-label="Change food category"
              >
                {effectiveType.emoji} {effectiveType.label.toUpperCase()}
              </button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); setAxisPicker("category"); }}
                style={UNSET_CHIP}
                aria-label="Set food category"
              >
                + set category
              </button>
            )}
            {effectiveTile ? (
              <button
                onClick={e => { e.stopPropagation(); setAxisPicker("tile"); }}
                style={SET_CHIP(CHIP_TONES.location)}
                aria-label="Change stored-in shelf"
              >
                {effectiveTile.emoji} {effectiveTile.label.toUpperCase()}
              </button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); setAxisPicker("tile"); }}
                style={UNSET_CHIP}
                aria-label="Set stored-in shelf"
              >
                + set stored in
              </button>
            )}
            {(() => {
              const entry = LOCATION_OPTIONS.find(o => o.id === effectiveLocation);
              return (
                <button
                  onClick={e => { e.stopPropagation(); setAxisPicker("location"); }}
                  style={SET_CHIP(CHIP_TONES.locationMuted)}
                  aria-label="Change location"
                >
                  {entry?.emoji || "🫙"} {(entry?.label || effectiveLocation).toUpperCase()}
                </button>
              );
            })()}
          </div>
          {/* Row 4: UPC, mono, very muted — verification signal
              rather than primary content. */}
          <div style={{
            color: "#666", fontSize: 10,
            fontFamily: "'DM Mono',monospace",
            marginTop: 4, letterSpacing: 0.4,
          }}>
            {scan.barcodeUpc}
          </div>
        </div>
        <span style={{ color: "#666", fontSize: 11, flexShrink: 0 }}>{isOpen ? "▲" : "EDIT ▼"}</span>
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
              ref={nameRef}
              defaultValue={scan.productName || ""}
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
              ref={brandRef}
              defaultValue={scan.brand || ""}
              onBlur={saveTextFields}
              placeholder="Brand (optional)"
              style={textInput}
            />
          </label>

          {/* Package size — overrides whatever OFF returned for
              this UPC. Typing here is the way to fix "no quantity
              came back from OFF" cases without dropping into the
              ItemCard after commit. Blur commits to the top-level
              packageOverrides map and flows into doCommit. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
            <span style={{ fontSize: 10, letterSpacing: 1.1, color: "#888" }}>
              PACKAGE SIZE {offParsed && <span style={{ color: "#555" }}>· OFF says {offParsed.amount} {offParsed.unit}</span>}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                min="0"
                step="0.1"
                ref={pkgAmountRef}
                defaultValue={
                  packageOverride?.amount != null ? String(packageOverride.amount)
                    : (offParsed?.amount != null ? String(offParsed.amount) : "")
                }
                onBlur={() => {
                  const v = pkgAmountRef.current?.value ?? "";
                  const n = Number(v);
                  if (Number.isFinite(n) && n > 0) {
                    onPackageChange?.(scan.id, { amount: n });
                  } else if (!v) {
                    onPackageChange?.(scan.id, { amount: null });
                  }
                }}
                placeholder="16"
                style={{ ...textInput, flex: "0 0 90px" }}
              />
              <input
                type="text"
                ref={pkgUnitRef}
                defaultValue={packageOverride?.unit || offParsed?.unit || ""}
                onBlur={() => {
                  const v = pkgUnitRef.current?.value ?? "";
                  onPackageChange?.(scan.id, { unit: v.trim() || null });
                }}
                placeholder="oz / ml / count"
                style={{ ...textInput, flex: 1 }}
              />
            </div>
            {/* Top-3 popular package sizes for this (brand, canonical).
                Tap-to-fill — one tap replaces typing both amount+unit.
                Sourced from popular_package_sizes RPC (migration 0063)
                with AI typicalSizes as the cold-start fallback. */}
            {top3.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <span style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  color: "#666", letterSpacing: "0.1em",
                  alignSelf: "center",
                }}>POPULAR:</span>
                {top3.map((p, i) => {
                  // Active = the override (or OFF baseline) currently
                  // matches this chip. Reading from packageOverride is
                  // fine because we update it on tap. Avoids relying
                  // on the now-uncontrolled input refs at render time.
                  const currentAmount = packageOverride?.amount != null
                    ? packageOverride.amount
                    : offParsed?.amount;
                  const currentUnit   = packageOverride?.unit ?? offParsed?.unit;
                  const active = currentAmount === p.amount && currentUnit === p.unit;
                  return (
                    <button
                      key={`${p.amount}-${p.unit}-${i}`}
                      type="button"
                      onClick={() => {
                        if (pkgAmountRef.current) pkgAmountRef.current.value = String(p.amount);
                        if (pkgUnitRef.current)   pkgUnitRef.current.value   = p.unit;
                        onPackageChange?.(scan.id, { amount: p.amount, unit: p.unit });
                      }}
                      style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: active ? "#111" : "#b8a878",
                        background: active ? "#b8a878" : "#1a1508",
                        border: `1px solid ${active ? "#b8a878" : "#3a2f10"}`,
                        borderRadius: 4, padding: "4px 8px",
                        letterSpacing: "0.05em", cursor: "pointer",
                      }}
                    >
                      {p.amount} {p.unit}{p.brand ? ` · ${p.brand}` : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
            <span style={{ fontSize: 10, letterSpacing: 1.1, color: "#888", flex: 1 }}>QTY (how many packages)</span>
            <button onClick={() => bumpQty(-1)} style={qtyBtn} aria-label="Decrease">−</button>
            <span style={{ minWidth: 30, textAlign: "center", color: "#f0ece4", fontSize: 15 }}>×{scan.qty || 1}</span>
            <button onClick={() => bumpQty(1)} style={qtyBtn} aria-label="Increase">+</button>
          </div>

          {/* Category / STORED IN / Location axes are now chip
              buttons on the collapsed row itself — see the preview
              above this editor. Kept the editor focused on fields
              that need typing (name, brand, package size, qty)
              rather than duplicating the tappable axis chips. */}

          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {scan.pairedShoppingListItemId && (
              <button onClick={() => onUnpair(scan.id)} style={editBtn}>UNPAIR FROM LIST</button>
            )}
            <button onClick={() => onDelete(scan.id)} style={{ ...editBtn, color: "#f8c7c7", borderColor: "#5a2a2a" }}>
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

      {/* Category + Stored-in pickers — ModalSheet wraps a list of
          tap targets matching the TypePicker / IdentifiedAsPicker
          style used in Kitchen.jsx. No dropdowns. */}
      {axisPicker === "category" && (
        <ModalSheet onClose={() => setAxisPicker(null)} maxHeight="86vh">
          <div style={pickerKicker(CHIP_TONES.category.fg)}>CATEGORY</div>
          <h2 style={pickerTitle}>
            What category does {scan.productName || scan.brand || "this"} belong to?
          </h2>
          <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.5, margin: "0 0 14px" }}>
            USDA-rooted food categories. Picking one suggests a default shelf for STORED IN and a default canonical if this scan didn't resolve one.
          </p>
          <TypePicker
            userId={null}
            selectedTypeId={effectiveTypeId}
            suggestedTypeId={inferredTypeId}
            onPick={(typeId, defaultTileId, defaultLocation) => {
              const patch = { typeId };
              // Auto-fill tile + location when the user hasn't
              // explicitly set them — same non-overwrite rule the
              // scan-draft flow uses in Kitchen.jsx.
              if (defaultTileId && !packageOverride?.tileId) patch.tileId = defaultTileId;
              if (defaultLocation && !packageOverride?.location) patch.location = defaultLocation;
              onPackageChange?.(scan.id, patch);
              setAxisPicker(null);
            }}
          />
        </ModalSheet>
      )}

      {axisPicker === "location" && (
        <ModalSheet onClose={() => setAxisPicker(null)} maxHeight="60vh">
          <div style={pickerKicker(CHIP_TONES.locationMuted.fg)}>LOCATION</div>
          <h2 style={pickerTitle}>
            Fridge, pantry, or freezer?
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {LOCATION_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => {
                  // When the user moves a row to a new location AND
                  // the current tileId belongs to a different one,
                  // clear the tile override so the picker re-opens
                  // fresh for the new location. Otherwise the blue
                  // STORED IN chip can show a "Dairy" tile with the
                  // row now in the freezer — nonsensical.
                  const patch = { location: opt.id };
                  if (effectiveTileId) {
                    const currentTileLocation = (FRIDGE_TILES.some(t => t.id === effectiveTileId) && "fridge")
                      || (PANTRY_TILES.some(t => t.id === effectiveTileId) && "pantry")
                      || (FREEZER_TILES.some(t => t.id === effectiveTileId) && "freezer")
                      || null;
                    if (currentTileLocation && currentTileLocation !== opt.id) {
                      patch.tileId = null;
                    }
                  }
                  onPackageChange?.(scan.id, patch);
                  setAxisPicker(null);
                }}
                style={pickerOptionStyle(opt.id === effectiveLocation, CHIP_TONES.location)}
              >
                <span style={{ fontSize: 20 }}>{opt.emoji}</span>
                <span style={{ flex: 1, fontSize: 14, color: "#f0ece4" }}>{opt.label}</span>
                {opt.id === effectiveLocation && (
                  <span style={{ color: CHIP_TONES.location.fg, fontSize: 11 }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </ModalSheet>
      )}

      {axisPicker === "tile" && (
        <ModalSheet onClose={() => setAxisPicker(null)} maxHeight="80vh">
          <div style={pickerKicker(CHIP_TONES.location.fg)}>STORED IN</div>
          <h2 style={pickerTitle}>
            Which shelf does {scan.productName || scan.brand || "this"} live on?
          </h2>
          <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.5, margin: "0 0 14px" }}>
            Showing {effectiveLocation} tiles. Change the LOCATION chip to see shelves in the fridge / pantry / freezer instead.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {(TILES_BY_LOCATION[effectiveLocation] || []).map(tile => (
              <button
                key={tile.id}
                onClick={() => { onPackageChange?.(scan.id, { tileId: tile.id }); setAxisPicker(null); }}
                style={pickerOptionStyle(tile.id === effectiveTileId, CHIP_TONES.location)}
              >
                <span style={{ fontSize: 20 }}>{tile.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "#f0ece4" }}>{tile.label}</div>
                  {tile.blurb && (
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{tile.blurb}</div>
                  )}
                </div>
                {tile.id === effectiveTileId && (
                  <span style={{ color: CHIP_TONES.location.fg, fontSize: 11 }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </ModalSheet>
      )}
    </div>
  );
});

// Shared ModalSheet picker styles — mirror the scan-draft pickers
// in Kitchen.jsx so CATEGORY / STORED IN pickers here feel like the
// same component.
const pickerKicker = (color) => ({
  fontFamily: "'DM Mono',monospace", fontSize: 10,
  color, letterSpacing: "0.12em",
  marginBottom: 10,
});
const pickerTitle = {
  fontFamily: "'Fraunces',serif", fontSize: 20,
  fontStyle: "italic", color: "#f0ece4",
  fontWeight: 400, margin: "0 0 6px", lineHeight: 1.2,
};
function pickerOptionStyle(active, tone) {
  return {
    display: "flex", alignItems: "center", gap: 10,
    padding: "12px 14px",
    background: active ? tone.bg : "#141414",
    border: `1px solid ${active ? tone.border : "#1e1e1e"}`,
    borderRadius: 10,
    textAlign: "left", cursor: "pointer",
    fontFamily: "'DM Sans',sans-serif",
  };
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

function TripScanLine({
  scan, listName, priceCents,
  reason = null, matchedRawText = null,
  diagnostic = null,
  onManualPair, onUnpair,
}) {
  const color = FLASH_COLORS[scan.status]?.bg || "#444";
  const label = scan.productName || scan.brand || `UPC ${scan.barcodeUpc.slice(-6)}`;
  const offParsed = parsePackageSize(scan.offPayload?.quantity || null);
  const sizeLabel = offParsed
    ? `${offParsed.amount}${offParsed.unit ? " " + offParsed.unit : ""}`
    : "";
  const isUnmatched = typeof priceCents !== "number";
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 6,
      padding: "10px 12px",
      background: "#141414",
      border: `1px solid ${isUnmatched ? "#5a3030" : color + "55"}`,
      borderRadius: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color, fontSize: 14, flexShrink: 0 }}>●</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <div style={{
              color: "#f0ece4", fontSize: 14,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              flex: "1 1 auto", minWidth: 0,
            }}>
              {label}
            </div>
            {sizeLabel && (
              <div style={{
                flex: "0 0 auto", fontSize: 11,
                color: "#b8a878",
                fontFamily: "'DM Mono',monospace",
                letterSpacing: 0.3,
              }}>
                {sizeLabel}{scan.qty > 1 ? ` ×${scan.qty}` : ""}
              </div>
            )}
            {!sizeLabel && scan.qty > 1 && (
              <div style={{ flex: "0 0 auto", fontSize: 11, color: "#888" }}>
                ×{scan.qty}
              </div>
            )}
          </div>
          <div style={{ color: "#888", fontSize: 11, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {listName ? `→ ${listName}` : "unpaired"}
            {scan.brand ? ` · ${scan.brand}` : ""}
          </div>
          {/* Always show the scan UPC so it can be compared against
              the receipt-line UPC the matcher was working with. */}
          {scan.barcodeUpc && (
            <div style={{
              color: "#666", fontSize: 10, marginTop: 2,
              fontFamily: "'DM Mono',monospace", letterSpacing: 0.4,
            }}>
              scan UPC: {scan.barcodeUpc}
            </div>
          )}
        </div>
        {typeof priceCents === "number" && (
          <div style={{ color: "#f5c842", fontSize: 13, fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
            ${(priceCents / 100).toFixed(2)}
          </div>
        )}
      </div>
      {/* Matched: show which receipt line + how it matched (UPC vs
          fuzzy vs manual) so the user can spot a wrong auto-pair
          and fix it via UNPAIR. */}
      {!isUnmatched && matchedRawText && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 11, color: "#9bb89b",
          paddingLeft: 24,
        }}>
          <span style={{
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            background: reason === "upc" ? "#1f3a1f" : reason === "manual" ? "#3a2f1f" : "#1f2f3a",
            color: reason === "upc" ? "#9bd89b" : reason === "manual" ? "#d8c89b" : "#9bb8d8",
            padding: "2px 6px", borderRadius: 3, letterSpacing: "0.06em",
          }}>
            {reason === "upc" ? "UPC ✓" : reason === "manual" ? "MANUAL" : "FUZZY"}
          </span>
          <span style={{
            flex: 1, minWidth: 0,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            ↪ {matchedRawText}
          </span>
          {onUnpair && (
            <button
              onClick={onUnpair}
              style={{
                background: "transparent", border: "1px solid #444",
                color: "#aaa", borderRadius: 4,
                padding: "2px 8px", fontSize: 10,
                fontFamily: "'DM Mono',monospace", letterSpacing: 0.4,
                cursor: "pointer", flexShrink: 0,
              }}
            >UNPAIR</button>
          )}
        </div>
      )}
      {/* Unmatched: show WHY (the diagnostic) + a manual-pair button.
          The diagnostic tells the user whether the receipt had any
          UPCs at all, which UPC was on the scan, and what the closest
          fuzzy match was — answers "why didn't this pair?" without
          devtools. */}
      {isUnmatched && (
        <div style={{
          paddingLeft: 24,
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ fontSize: 11, color: "#f8c87a", lineHeight: 1.4 }}>
            {explainMissedMatch(diagnostic)}
          </div>
          {/* Vision UPC inventory — show what Claude actually returned
              for receipt-line UPCs so the user can compare against
              the scan UPC and see whether Vision read the digits or
              dropped them entirely. The first time you spot "Vision
              returned no UPCs at all" you know the prompt or the
              receipt photo quality is the issue, not the matcher. */}
          {diagnostic && diagnostic.scanUpc && (
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 10,
              color: diagnostic.receiptHadAnyUpc ? "#888" : "#d88a8a",
              lineHeight: 1.4,
            }}>
              {diagnostic.receiptHadAnyUpc
                ? "Vision read UPCs on other lines but not a match for this scan."
                : "Vision returned NO UPCs on this receipt — the digits weren't extracted from any line."}
            </div>
          )}
          {onManualPair && (
            <button
              onClick={onManualPair}
              style={{
                alignSelf: "flex-start",
                background: "#1e1a0e",
                border: "1px solid #3a3010",
                color: "#f5c842", borderRadius: 6,
                padding: "6px 12px", fontSize: 11,
                fontFamily: "'DM Mono',monospace", letterSpacing: 0.6,
                cursor: "pointer",
              }}
            >+ PAIR TO RECEIPT LINE</button>
          )}
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
