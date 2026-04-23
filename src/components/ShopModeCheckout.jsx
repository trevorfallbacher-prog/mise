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

function matchScanToReceiptLine(scan, receiptLines, claimed, pairedListName = null) {
  const scanUpc = normalizeBarcode(scan.barcodeUpc);
  const scanLabel = scan.productName || scan.brand || `UPC ${scan.barcodeUpc}`;

  console.group(`[shop-checkout] match attempt: ${scanLabel}`);
  console.log("scan", {
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
  console.log("UPC tier", { scanUpc, lines: upcAttempts });

  if (scanUpc) {
    const byUpc = upcAttempts.findIndex(a => a.upcMatches);
    if (byUpc >= 0) {
      console.log(`✅ MATCH via UPC at line ${byUpc}: "${upcAttempts[byUpc].rawText}"`);
      console.groupEnd();
      return byUpc;
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
  console.log("Token tier", { scanText, scanTokens: Array.from(scanToks), lines: tokenAttempts });

  // Require >= 2 shared tokens for a token-fuzzy match to count.
  // Single-word overlaps (e.g. Danish scan tokens {cream, cheese,
  // danish} sharing only "cream" with SOUR CREAM) wrongly pair
  // Danish to sour cream while the actual CHEEZ DANIS receipt
  // line has zero overlap because Walmart truncated both words.
  // Pushing the bar to 2 means matches must have enough signal
  // to really mean the same product. Unpaired scans get fixed
  // manually on the ItemCard.
  const MIN_SHARED_TOKENS = 2;
  if (scanToks.size > 0) {
    let best = -1;
    let bestShared = 0;
    for (const a of tokenAttempts) {
      if (a.claimed) continue;
      if (a.sharedCount > bestShared) {
        bestShared = a.sharedCount;
        best = a.i;
      }
    }
    if (best >= 0 && bestShared >= MIN_SHARED_TOKENS) {
      console.log(`✅ MATCH via tokens at line ${best} (shared ${bestShared}: ${tokenAttempts[best].sharedTokens.join(", ")}): "${tokenAttempts[best].rawText}"`);
      console.groupEnd();
      return best;
    }
    if (best >= 0 && bestShared > 0) {
      console.log(`⚠ token match for line ${best} had only ${bestShared} shared token(s) — below the ${MIN_SHARED_TOKENS} threshold, skipping (generic tokens like "cream" cause false pairs).`);
    }
  }

  console.log(`❌ NO MATCH for ${scanLabel}.`);
  console.groupEnd();
  return -1;
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
  function setPackageOverride(scanId, patch) {
    setPackageOverrides(prev => {
      const next = new Map(prev);
      const current = next.get(scanId) || {};
      next.set(scanId, { ...current, ...patch });
      return next;
    });
  }

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
        // Pass the paired list slot's name so the matcher can use
        // its tokens too — fixes the "scan productName is brand-
        // only, receipt rawText is product-only" mismatch.
        const pairedListName = nameForListId(shoppingList, scan.pairedShoppingListItemId);
        const idx = matchScanToReceiptLine(scan, lines, claimed, pairedListName);
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
      for (const scan of scans) {
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

          // Teach the UPC → identity correction memory when the
          // user explicitly overrode any axis on the checkout
          // editor (typeId, tileId, location, OR canonical picked
          // via LinkIngredient). Same pattern used by the main
          // Scanner's correction flow — admin writes go to the
          // global tier, everyone else to the family tier. Next
          // scan of this UPC auto-resolves to the taught values.
          const correctionPatch = {};
          if (override?.typeId)   correctionPatch.typeId     = override.typeId;
          if (override?.tileId)   correctionPatch.tileId     = override.tileId;
          if (override?.location) correctionPatch.location   = override.location;
          if (scan.canonicalId)   correctionPatch.canonicalId = scan.canonicalId;
          // Only write when at least one identity field would land
          // AND the scan has a UPC to key on (red scans without OFF
          // data already have correctionPatch.canonicalId via the
          // user's in-aisle rename, so they teach too).
          if (scan.barcodeUpc && Object.keys(correctionPatch).length > 0) {
            rememberBarcodeCorrection({
              userId,
              isAdmin,
              barcodeUpc: scan.barcodeUpc,
              ...correctionPatch,
              emoji: row.emoji,
              ingredientIds: row.components || (scan.canonicalId ? [scan.canonicalId] : []),
              categoryHints: scan.offPayload?.categoryHints || null,
            }).catch(e => console.warn("[shop-checkout] rememberBarcodeCorrection failed:", e?.message || e));
          }
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
                packageOverride={packageOverrides.get(s.id) || null}
                onPackageChange={(patch) => setPackageOverride(s.id, patch)}
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
function EditableScanLine({
  scan, listName, isOpen, onToggle, onPatch, onDelete, onUnpair,
  packageOverride = null, onPackageChange,
}) {
  const [name, setName]   = useState(scan.productName || "");
  const [brand, setBrand] = useState(scan.brand || "");
  // Package size user overrides — default to the OFF-parsed value
  // when available, else blank. Typing commits back via
  // onPackageChange, which threads through to the top-level
  // packageOverrides map and is consumed at commit time in doCommit.
  const offParsed = parsePackageSize(scan.offPayload?.quantity || null);
  const [pkgAmount, setPkgAmount] = useState(() =>
    packageOverride?.amount != null ? String(packageOverride.amount)
      : (offParsed?.amount != null ? String(offParsed.amount) : "")
  );
  const [pkgUnit, setPkgUnit] = useState(() =>
    packageOverride?.unit || offParsed?.unit || ""
  );
  // LinkIngredient picker — embedded as a full-screen modal on tap.
  // Covers bundled fuzzy match + admin-approved synthetics + the
  // ⭐ create-new-canonical flow. Picked id writes to trip_scans.canonical_id.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Axis picker ModalSheets. null = closed; "category" / "location"
  // opens the respective list. Matches the scan-draft pattern in
  // Kitchen.jsx where tapping a chip swaps to a ModalSheet-wrapped
  // picker rather than revealing inline dropdowns.
  const [axisPicker, setAxisPicker] = useState(null);

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

  // Effective package size for the collapsed preview — mirrors the
  // cascade doCommit uses: user override > OFF parsed > canonical
  // default. Empty string when nothing's resolved (preview hides it).
  const effectiveSize = (() => {
    if (packageOverride?.amount != null && packageOverride.amount > 0) {
      return { amount: packageOverride.amount, unit: packageOverride.unit || offParsed?.unit || currentCanonical?.defaultUnit || "" };
    }
    if (offParsed?.amount != null) return offParsed;
    return null;
  })();
  const sizeLabel = effectiveSize
    ? `${effectiveSize.amount}${effectiveSize.unit ? " " + effectiveSize.unit : ""}`
    : "";

  // Effective category + location — same cascade doCommit uses.
  // Category is a USDA-rooted WWEIA typeId (src/data/foodTypes.js),
  // resolved via override → canonical match → name inference → null.
  const offCategoryAxes = (() => {
    try { return tagHintsToAxes(scan.offPayload?.categoryHints || []); }
    catch { return { category: null, tileId: null, typeId: null }; }
  })();
  const effectiveTypeId = packageOverride?.typeId
    || offCategoryAxes.typeId
    || inferFoodTypeFromName(scan.productName || scan.brand || "")
    || null;
  const effectiveType = effectiveTypeId ? findFoodType(effectiveTypeId) : null;
  // Broad category string (dairy / produce / meat / …) still used
  // for the pantry_items.category NOT NULL column. Derived from the
  // food type's default tile when we have one, else from OFF axes,
  // else canonical, else "pantry".
  const effectiveCategory = effectiveType?.defaultTileId
    ? tileToCategory(effectiveType.defaultTileId)
    : (currentCanonical?.category
      || offCategoryAxes.category
      || "pantry");
  const canonStorage = currentCanonical?.storage?.location || null;
  const effectiveLocation = packageOverride?.location
    || canonStorage
    || defaultLocationForCategory(effectiveCategory);
  // STORED IN — the specific tile within the location. Cascade:
  //   1. user override (tile picker)
  //   2. canonical's storage.tile / tileId
  //   3. tagHintsToAxes from OFF (best-effort)
  //   4. null — preview renders "+ set stored in"
  const effectiveTileId = packageOverride?.tileId
    || currentCanonical?.storage?.tileId
    || offCategoryAxes.tileId
    || null;
  const effectiveTile = tileById(effectiveTileId);

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
                value={pkgAmount}
                onChange={e => setPkgAmount(e.target.value)}
                onBlur={() => {
                  const n = Number(pkgAmount);
                  if (Number.isFinite(n) && n > 0) {
                    onPackageChange?.({ amount: n });
                  } else if (!pkgAmount) {
                    onPackageChange?.({ amount: null });
                  }
                }}
                placeholder="16"
                style={{ ...textInput, flex: "0 0 90px" }}
              />
              <input
                type="text"
                value={pkgUnit}
                onChange={e => setPkgUnit(e.target.value)}
                onBlur={() => onPackageChange?.({ unit: pkgUnit.trim() || null })}
                placeholder="oz / ml / count"
                style={{ ...textInput, flex: 1 }}
              />
            </div>
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
            suggestedTypeId={inferFoodTypeFromName(scan.productName || scan.brand || "")}
            onPick={(typeId, defaultTileId, defaultLocation) => {
              const patch = { typeId };
              // Auto-fill tile + location when the user hasn't
              // explicitly set them — same non-overwrite rule the
              // scan-draft flow uses in Kitchen.jsx.
              if (defaultTileId && !packageOverride?.tileId) patch.tileId = defaultTileId;
              if (defaultLocation && !packageOverride?.location) patch.location = defaultLocation;
              onPackageChange?.(patch);
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
                  onPackageChange?.(patch);
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
                onClick={() => { onPackageChange?.({ tileId: tile.id }); setAxisPicker(null); }}
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
}

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

function TripScanLine({ scan, listName, priceCents }) {
  const color = FLASH_COLORS[scan.status]?.bg || "#444";
  const label = scan.productName || scan.brand || `UPC ${scan.barcodeUpc.slice(-6)}`;
  const offParsed = parsePackageSize(scan.offPayload?.quantity || null);
  const sizeLabel = offParsed
    ? `${offParsed.amount}${offParsed.unit ? " " + offParsed.unit : ""}`
    : "";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px",
      background: "#141414",
      border: `1px solid ${color}55`,
      borderRadius: 10,
    }}>
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
      </div>
      {typeof priceCents === "number" && (
        <div style={{ color: "#f5c842", fontSize: 13, fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
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
