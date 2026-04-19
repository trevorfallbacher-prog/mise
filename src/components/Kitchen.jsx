import { useState, useRef, useMemo, useEffect } from "react";
import {
  INGREDIENTS, HUBS,
  findIngredient, findHub, hubForIngredient,
  membersOfHub, standaloneIngredients,
  unitLabel, inferUnitsForScanned, toBase,
  estimatePriceCents, getIngredientInfo, estimateExpirationDays,
  stateLabel, statesForIngredient, statesForItem, detectStateFromText,
  inferCanonicalFromName, fuzzyMatchIngredient, parseIdentity,
} from "../data/ingredients";
import { supabase } from "../lib/supabase";
import { useMonthlySpend } from "../lib/useMonthlySpend";
import { defaultLocationForCategory } from "../lib/usePantry";
import { compressImage } from "../lib/compressImage";
import { DAYS_MS, daysUntilExpiration, expirationColor, formatDaysUntil, formatPrice, groupByIdentity, isDiscreteInstance, isStackLow, isStackCritical, DISCRETE_COUNT_UNITS } from "../lib/pantryFormat";
import { addInstance as addStackInstance, removeInstance as removeStackInstance, sortedInstances } from "../lib/useStackEdits";
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
import { FOOD_TYPES, findFoodType, inferFoodTypeFromName, canonicalIdForType, typeIdForCanonical } from "../data/foodTypes";
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
import { useProfile } from "../lib/useProfile";
import { useIngredientInfo, slugifyIngredientName } from "../lib/useIngredientInfo";
import { useBrandNutrition } from "../lib/useBrandNutrition";
import { lookupBarcode } from "../lib/lookupBarcode";
import BarcodeScanner from "./BarcodeScanner";
import CanonicalSuggestionCard from "./CanonicalSuggestionCard";
import {
  resolveCanonicalFromScan,
  parsePackageSize,
  parseStateFromText,
  stateForCanonical,
} from "../lib/canonicalResolver";
import { enrichIngredient } from "../lib/enrichIngredient";
import { usePopularPackages } from "../lib/usePopularPackages";
import { LABELS, LABEL_KICKER } from "../lib/schemaLabels";
import AddItemOutcome from "./AddItemOutcome";
import FieldExplainer from "./FieldExplainer";
import {
  findScanCorrections,
  rememberScanCorrection,
  normalizeScanText,
} from "../lib/userScanCorrections";

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

// Fill percent for the tile gauge. Only meaningful when the row has
// a declared package size (max > 0); returns null otherwise so the
// caller can hide the gauge instead of fabricating a full bar.
const pct = item => {
  const max = Number(item.max);
  if (!(max > 0)) return null;
  return Math.min((Number(item.amount) || 0) / max * 100, 100);
};
const hasPackage = item => Number(item.max) > 0;
const isLow      = item => item.amount <= item.lowThreshold;
const isCritical = item => item.amount <= item.lowThreshold * 0.5;
const barColor   = item => isCritical(item) ? "#ef4444" : isLow(item) ? "#f59e0b" : "#4ade80";

// Scan-merge identity gate — two rows share an "identity" when their
// user-visible identity axes agree. Used when deciding whether a
// freshly scanned item should fold into an existing pantry row or
// stand as its own row. Without this gate, "sushi nori" (just nori)
// and "wasabi nori" (nori + wasabi) collapse because they share the
// primary `ingredientId`, losing the second one's composition.
//
// Per CLAUDE.md identity hierarchy, the axes that distinguish an item
// are: CUSTOM NAME → CANONICAL → STATE → INGREDIENTS composition.
// The caller has already confirmed the CANONICAL matches, so this
// helper only checks the other three.
//
// Returns true when the rows are safe to merge.
function sameIdentity(a, b) {
  // Name — if both sides have a non-empty custom name and they
  // disagree, treat as different identities. An empty-name row
  // (free-text waiting to be enriched) matches anything with the
  // same canonical, so the name-backfill path still works.
  const an = (a.name || "").toLowerCase().trim();
  const bn = (b.name || "").toLowerCase().trim();
  if (an && bn && an !== bn) return false;

  // State — loaf vs slices vs crumbs are physically different and
  // shouldn't merge. One side missing state is fine (pre-migration
  // rows, or scans that didn't capture it).
  if (a.state && b.state && a.state !== b.state) return false;

  // Composition — if either side carries a multi-tag ingredientIds
  // array, both must carry the same set. Plain-canonical rows
  // (length ≤ 1) are the common case and fall through unchanged.
  const aIds = Array.isArray(a.ingredientIds) ? a.ingredientIds.filter(Boolean) : [];
  const bIds = Array.isArray(b.ingredientIds) ? b.ingredientIds.filter(Boolean) : [];
  if (aIds.length > 1 || bIds.length > 1) {
    if (aIds.length !== bIds.length) return false;
    const aSet = new Set(aIds);
    for (const id of bIds) if (!aSet.has(id)) return false;
  }
  return true;
}

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

// Curated emoji grid for scan-row emoji swap. Food-first, same palette
// TypePicker and IdentifiedAsPicker use for their CREATE NEW forms so
// the visual vocabulary stays consistent across the app. 🏷️ is the
// explicit "no idea" default.
const SCAN_EMOJI_OPTIONS = [
  "🏷️", "🍕", "🥪", "🧀", "🥛", "🥩", "🍗",
  "🐟", "🦐", "🥚", "🍞", "🍝", "🍚", "🥗",
  "🌮", "🥟", "🍲", "🥡", "🍎", "🍌", "🥕",
  "🌶️", "🌿", "🧂", "🍯", "🍫", "🍰", "🍦",
  "🥫", "🥤", "☕", "🍺", "🍷", "🌭", "🍔",
];

// ── Scanner (fridge / pantry / receipt) ───────────────────────────────────────
function Scanner({ userId, onItemsScanned, onClose }) {
  const [mode, setMode] = useState("receipt");
  const [phase, setPhase] = useState("upload");
  // Admin bypass for the PENDING status. Admins approve canonicals
  // themselves, so when they create one we auto-upsert the
  // ingredient_info stub (same shape AdminPanel.approveCustom writes)
  // and skip the visual "PENDING" badge — nothing to review, it's
  // already approved.
  const { profile } = useProfile(userId);
  const isAdmin = profile?.role === "admin";
  // dbMap from the ingredient_info context — we use it so auto-star-
  // link can match against admin-approved canonicals (e.g. a custom
  // "pepperoni" slug the admin already approved) not just the bundled
  // INGREDIENTS registry. Without this, scanning "PEPPERONI" after
  // approving pepperoni wouldn't auto-pair because fuzzyMatchIngredient
  // only iterates bundled.
  const { dbMap, refreshDb } = useIngredientInfo();

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
  // Scan-row link sheet mode. "canonical" = single pick (CANONICAL axis —
  // one tap commits). "tags" = multi-tag composition (ItemCard onEditTags).
  const [linkingScanMode, setLinkingScanMode] = useState("canonical");
  // Per-row pickers for FOOD CATEGORY (type) and STORED IN (tile)
  // during scan-confirm. OCR + heuristics are going to misfire — the
  // user needs to tap a chip and override without having to wait until
  // after STOCK → find the row in pantry → tap its chip there. Each
  // holds the index of the row being edited; null = closed.
  const [typingScanIdx, setTypingScanIdx] = useState(null);
  const [tilingScanIdx, setTilingScanIdx] = useState(null);
  // Emoji swap picker — tapping the big emoji on a scan row opens a
  // small ModalSheet with the curated EMOJI_OPTIONS grid. The OCR's
  // default pick is fine a lot of the time but wrong enough (🥫 as
  // the fallback when it has no idea) that the user should be able
  // to override without waiting until the row lands in pantry.
  const [emojiingScanIdx, setEmojiingScanIdx] = useState(null);
  // Full-card expand. Tap the chevron on a scan row to open the same
  // ItemCard surface you'd see in pantry — big canvas, the three
  // stacked left-column buttons (canonical / category / stored in) and
  // the fridge|pantry|freezer emoji row. All edits route through the
  // scan patcher so the confirm-list stays the source of truth until
  // the user taps STOCK.
  const [expandedScanIdx, setExpandedScanIdx] = useState(null);
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
    // Brand (migration 0062). Edits to the brand chip propagate
    // across duplicate raw-text rows same as name + canonicalId.
    "brand",
  ];
  const propagateCorrection = (sourceIdx, patch) => setScannedItems(prev => {
    const source = prev[sourceIdx];
    if (!source) return prev;
    const rawKey = (source.scanRaw?.raw_name || source.name || "").trim().toLowerCase();
    const safePatch = {};
    for (const k of IDENTITY_KEYS) {
      if (k in patch) safePatch[k] = patch[k];
    }
    // Persist the correction to user_scan_corrections so the next
    // scan of the same text auto-links. Best-effort, fire-and-forget —
    // the UI doesn't wait, and a memory-write failure can't block
    // the scan confirm. Only runs when we have a raw_name to key on
    // AND the patch touched an identity field (not just amount/unit).
    const rawText = source.scanRaw?.raw_name || source.name;
    if (userId && rawText && Object.keys(safePatch).length > 0) {
      const merged = { ...source, ...safePatch };
      rememberScanCorrection({
        userId,
        rawText,
        correctedName: merged.name,
        emoji: merged.emoji,
        typeId: merged.typeId,
        canonicalId: merged.canonicalId || merged.ingredientId,
        ingredientIds: merged.ingredientIds,
        brand: merged.brand,
      }).catch(() => {});
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
        // CONFIDENCE-GATED CANONICALIZATION
        //
        // New contract with the scan-receipt prompt: Claude returns
        // BOTH `rawText` (literal receipt text, OCR'd) AND `name`
        // (clean display — equal to rawText unless Claude is ≥90%
        // sure of the expansion). canonicalId is only set on "high"
        // confidence. We honor this end-to-end:
        //   - scanRaw.raw_name = rawText (always the literal receipt
        //     text so the revert-to-raw button always restores it)
        //   - item.name = Claude's display guess, but ONLY promoted
        //     to canon.name when confidence === "high"
        //   - item.canonicalId / ingredientId only respected when
        //     confidence === "high"
        // Medium / low items land with raw text preserved so the user
        // never sees a confabulated name they can't verify against
        // the physical receipt.
        const rawConf = item.confidence;
        const confidence =
          rawConf === "high" || rawConf === "medium" || rawConf === "low"
            ? rawConf
            : (activeMode.id === "receipt" ? "high" : "medium");
        const rawText = (typeof item.rawText === "string" && item.rawText.trim())
          ? item.rawText.trim()
          : item.name;
        // Only trust the canonical match when Claude is highly
        // confident. Medium/low matches get dropped so we don't tag
        // the user's pantry with a shaky interpretation.
        const trustCanonical = confidence === "high";
        const candidateCanonicalId = item.canonicalId ?? item.ingredientId ?? null;
        const canonicalIdToUse = trustCanonical ? candidateCanonicalId : null;

        // Template match first (chunk 17b). If the family has a
        // template whose normalized name matches this scan row, the
        // template's identity wins over the canonical registry match:
        // brand name preserved, tile_id inherited, ingredient_ids
        // carried forward. Canonical fuzzy falls through when no
        // template matches. Match on raw text since that's what
        // recurs scan-to-scan.
        const templateMatch = findTemplateMatch(rawText, userTemplatesForScan);
        const canon = findIngredient(canonicalIdToUse);
        const cat = canon ? canon.category : (item.category || "pantry");
        // Fridge/pantry scans force every item to that physical location.
        // Receipt scans don't know — prefer the ingredient registry's
        // storage.location when we have a canonical match (butter→fridge,
        // flour→pantry), then fall back to a category default.
        const regLocation = canon ? getIngredientInfo(canon)?.storage?.location : null;
        const location = activeMode.location || regLocation || defaultLocationForCategory(cat);
        // Three-layer parse: BRAND → STATE → CANONICAL. Pulls brand
        // tokens off the rawText BEFORE state / canonical detection so
        // "KG SHRD MOZZ" gets cleanly decomposed into brand Kerrygold
        // + state shredded + mozzarella cheese instead of the brand
        // tokens drowning out the downstream matches.
        //
        // Authority order for the resolved brand (migration 0062):
        //   1. item.brand    — Claude's scan-time extraction
        //   2. parsed.brand  — client-side BRAND_ALIASES fallback
        // Corrections (via applyCorrection below) can override both.
        const parsed = parseIdentity(rawText);
        const resolvedBrand = (typeof item.brand === "string" && item.brand.trim())
          ? item.brand.trim()
          : (parsed.brand || null);
        // State detection — grocery receipts abbreviate heavily ("SHRD
        // MOZZ", "SLCD PROV"), and the scan text is the only place we
        // can recover that information. Detect against rawText (the
        // actual receipt abbreviations), only apply when we have a
        // trusted canonical. parseIdentity's state layer is vocabulary-
        // agnostic; re-run detectStateFromText here so the match is
        // filtered against the canonical's state vocabulary (milk has
        // no state vocab → WHL MILK's 'whole' is correctly dropped).
        const detectedState = canon
          ? detectStateFromText(rawText, canon)
          : null;
        // Provenance tag — activeMode.id is 'receipt' for receipt scans,
        // 'fridge' / 'pantry' / 'freezer' for pantry-shelf scans.
        const sourceKind = activeMode.id === "receipt" ? "receipt_scan" : "pantry_scan";
        // Raw scanner read — preserves the literal receipt text.
        // Revert-to-raw on the scan row reads from here.
        const scanRaw = {
          raw_name: rawText,
          confidence: rawConf || confidence,
          mode: activeMode.id,
          detected_state: detectedState || null,
          // detected_brand preserves the resolved value (Claude or
          // fallback) so the ItemCard's "raw scan" panel can surface
          // it alongside detected_state for debug / trust.
          detected_brand: resolvedBrand,
          price_cents: typeof item.priceCents === "number" ? item.priceCents : null,
          amount_raw: item.amount != null ? String(item.amount) + (item.unit ? ` ${item.unit}` : "") : null,
          scanned_at: new Date().toISOString(),
        };
        // Display name resolution: trusted canonical wins → Claude's
        // interpreted name → rawText. The chain collapses to rawText
        // automatically for low-confidence items (Claude was told to
        // set name = rawText when confidence is low).
        const displayName = canon
          ? canon.name
          : (item.name && item.name.trim() ? item.name : rawText);
        const base = {
          ...item,
          rawText,
          name: displayName,
          emoji: canon ? canon.emoji : (item.emoji || "🥫"),
          category: cat,
          location,
          confidence,
          canonicalId: canonicalIdToUse,
          ingredientId: canonicalIdToUse,
          priceCents: typeof item.priceCents === "number" ? item.priceCents : null,
          id: i,
          selected: true,
          sourceKind,
          scanRaw,
          ...(detectedState ? { state: detectedState } : {}),
          ...(resolvedBrand ? { brand: resolvedBrand } : {}),
        };
        if (!canon) {
          const inferred = inferUnitsForScanned(base);
          const validIds = inferred.units.map(u => u.id);
          // Keep the model's unit if it's in our inferred list; otherwise use default.
          if (!validIds.includes(base.unit)) base.unit = inferred.defaultUnit;
        }
        // Apply template override LAST — after canonical + unit
        // inference. Per the item-first architecture (CLAUDE.md identity
        // stack) a template may only inherit ROUTING (emoji, category,
        // storage tile/location, food type, default unit). Identity
        // fields — name and ingredientIds (composition) — belong to the
        // scan itself; auto-applying a saved blend would collapse a
        // single-canonical "8oz Mozzarella" line into a prior
        // multi-canonical "Italian cheese" row. The _templateId marker
        // persists so addScannedItems can bump use_count after commit.
        if (templateMatch) {
          if (templateMatch.emoji)    base.emoji    = templateMatch.emoji;
          if (templateMatch.category) base.category = templateMatch.category;
          if (templateMatch.tileId)   base.tileId   = templateMatch.tileId;
          if (templateMatch.defaultLocation) {
            base.location = templateMatch.defaultLocation;
          }
          if (templateMatch.defaultUnit && (!base.unit || base.unit === "count")) {
            base.unit = templateMatch.defaultUnit;
          }
          if (templateMatch.typeId) base.typeId = templateMatch.typeId;
          base._templateId = templateMatch.id;
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

      // Scan-text memory overlay. "AQUAMARINE SL" → imitation crab
      // if the household has corrected that text before. Lookup is
      // one round-trip keyed on normalized raw_name; rows without a
      // hit fall through to the name-inference path above. The
      // learned identity stamps a `correction` tag on the row so
      // the UI can surface a ⭐ LEARNED badge.
      const rawTexts = normalized
        .map(r => r.scanRaw?.raw_name || r.name)
        .filter(Boolean);
      const corrections = await findScanCorrections(rawTexts);
      const applyCorrection = (row) => {
        const key = normalizeScanText(row.scanRaw?.raw_name || row.name);
        const c = key ? corrections.get(key) : null;
        if (!c) return row;
        // Per the item-first architecture: a scan correction may route
        // (emoji, typeId) and remap a SINGLE canonical tag (canonicalId),
        // but must not auto-apply name or multi-canonical composition.
        // Identity — name and ingredientIds — belongs to the scan itself.
        const patched = { ...row, learnedCorrectionId: c.id };
        if (c.emoji) patched.emoji = c.emoji;
        if (c.typeId) patched.typeId = c.typeId;
        if (c.canonicalId) {
          patched.canonicalId = c.canonicalId;
          patched.ingredientId = c.canonicalId;
        }
        // Brand (migration 0062). Correction memory overrides the
        // scan-time brand resolution — a household that taught
        // "HCF" → H-E-B wins over Claude's null / fallback regex.
        if (c.brand) patched.brand = c.brand;
        return patched;
      };
      // Auto-link on strong AND unambiguous match. Two gates:
      //
      //   1. Top score ≥ AUTO_LINK_SCORE — the match has to be
      //      meaningful at all. 70 covers the substring band plus
      //      strong token-overlap hits.
      //
      //   2. Top score must beat the runner-up by AUTO_LINK_GAP —
      //      if multiple canonicals tie at 80+ (e.g. "BREAST"
      //      matches turkey_breast, chicken_breast, pork_breast at
      //      identical scores because it's a substring of all of
      //      them), the needle is AMBIGUOUS and we do NOT auto-
      //      link. The user picks deliberately. Only exact-match
      //      (100) ties get a pass since those are rare and
      //      legitimate cross-type collisions are vanishingly few.
      //
      // This is why "MILK" → milk auto-links (milk=100, others
      // much lower) but "BREAST" doesn't (3 canonicals all score
      // 82, gap is 0).
      const AUTO_LINK_SCORE = 70;
      const AUTO_LINK_GAP   = 12;
      const approvedSynthetics = [];
      for (const [slug, info] of Object.entries(dbMap || {})) {
        if (!slug || findIngredient(slug)) continue;
        const displayOverride = info?.display_name;
        const name = (typeof displayOverride === "string" && displayOverride.trim())
          ? displayOverride.trim()
          : slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        approvedSynthetics.push({
          id: slug,
          name,
          emoji: info?.emoji || "✨",
          category: info?.category || "user",
          shortName: null,
        });
      }
      // Cheap substring scorer for synthetics — matches
      // LinkIngredient.scoreSynthetic so the picker and the auto-link
      // agree on what's "a match". Exact-name / exact-slug hits get
      // 100; substring either way 60-80.
      const scoreSyntheticForAuto = (needle, canon) => {
        const n = (needle || "").toLowerCase().trim();
        if (!n) return 0;
        const nameLow = canon.name.toLowerCase();
        const slugLow = canon.id.toLowerCase();
        if (nameLow === n || slugLow === n) return 100;
        if (slugLow === n.replace(/\s+/g, "_")) return 100;
        if (nameLow.startsWith(n) || slugLow.startsWith(n.replace(/\s+/g, "_"))) return 85;
        if (nameLow.includes(n) || slugLow.includes(n.replace(/\s+/g, "_"))) return 70;
        return 0;
      };
      const autoStar = (row) => {
        if (row.canonicalId || row.ingredientId) return row;
        const needle = (row.name || "").trim();
        if (!needle) return row;
        // Pool of bundled fuzzy + admin-approved synthetics — pull
        // the top TWO from the bundled side so we can measure the
        // score gap against the runner-up and skip auto-link when
        // multiple canonicals tie (the "BREAST" ambiguity case).
        //
        // shoppingList bias: canonicals that appear on the user's
        // active shopping list get +30 (ingredientId match) or +20
        // (free-text name match) added to their base score. This
        // shifts ambiguous cases toward what the user went shopping
        // for without overriding strong independent matches.
        const bundled = fuzzyMatchIngredient(needle, 5, shoppingList);
        const synthScored = [];
        for (const canon of approvedSynthetics) {
          const score = scoreSyntheticForAuto(needle, canon);
          if (score > 0) synthScored.push({ ingredient: canon, score });
        }
        // Merged, descending by score — top[0] is best, top[1] is
        // runner-up for the gap check.
        const merged = [...bundled, ...synthScored].sort((a, b) => b.score - a.score);
        const top = merged[0];
        const runnerUp = merged[1];
        if (!top || top.score < AUTO_LINK_SCORE) return row;
        // Exact-match free pass: a 100-score hit that another
        // canonical happens to match at 100 too is effectively a
        // duplicate entry in the registry, not real ambiguity. All
        // other cases require clear separation from the runner-up.
        const gap = runnerUp ? top.score - runnerUp.score : top.score;
        if (top.score < 100 && gap < AUTO_LINK_GAP) return row;
        const canon = top.ingredient;
        return {
          ...row,
          canonicalId: canon.id,
          ingredientId: canon.id,
          ingredientIds: [canon.id],
          emoji:    row.emoji    || canon.emoji,
          category: row.category || canon.category,
          autoLinked: true,
        };
      };
      setScannedItems(normalized.map(applyCorrection).map(autoStar));
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
                    <div onClick={e => e.stopPropagation()} style={{ position:"absolute", top:6, right:6, display:"flex", alignItems:"center", gap:4, zIndex:3 }}>
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#ef4444", letterSpacing:"0.08em", marginRight:2 }}>REMOVE?</span>
                      <button
                        onClick={e => { e.stopPropagation(); removeScanItem(item.id); setConfirmingRemoveId(null); }}
                        aria-label={`Confirm remove ${item.name}`}
                        title="Yes, remove"
                        style={{ width:26, height:26, borderRadius:"50%", border:"none", background:"#ef4444", color:"#fff", fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, lineHeight:1, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
                      >✓</button>
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmingRemoveId(null); }}
                        aria-label="Cancel remove"
                        title="Cancel"
                        style={{ width:26, height:26, borderRadius:"50%", border:"1px solid #333", background:"#0f0f0f", color:"#888", fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, lineHeight:1, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
                      >✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmingRemoveId(item.id); }}
                      aria-label={`Remove ${item.name}`}
                      title="Remove from list"
                      style={{ position:"absolute", top:6, right:6, width:24, height:24, borderRadius:"50%", border:"none", background:"transparent", color:"#777", fontFamily:"'DM Mono',monospace", fontSize:14, fontWeight:600, lineHeight:1, cursor:"pointer", zIndex:2, display:"flex", alignItems:"center", justifyContent:"center" }}
                    >✕</button>
                  )}
                  <div
                    onClick={() => setExpandedScanIdx(idx)}
                    role="button"
                    tabIndex={0}
                    style={{ flex:1, display:"flex", alignItems:"flex-start", gap:12, padding:"14px 40px 14px 14px", minWidth:0, cursor:"pointer" }}
                  >
                  <button
                    onClick={e => { e.stopPropagation(); setEmojiingScanIdx(idx); }}
                    aria-label={`Change emoji for ${item.name}`}
                    title="Tap to change emoji"
                    style={{ fontSize:28, flexShrink:0, lineHeight:1, background:"transparent", border:"none", padding:0, cursor:"pointer" }}
                  >
                    {item.emoji}
                  </button>
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
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateScanItem(idx, { name: e.target.value })}
                        onBlur={() => {
                          propagateCorrection(idx, { name: item.name });
                          setEditingNameIdx(null);
                        }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditingNameIdx(null); }}
                        style={{ background:"#0a0a0a", border:"1px solid #f5c842", borderRadius:8, padding:"4px 10px", color:"#f5c842", fontFamily:"'Fraunces',serif", fontSize:18, fontStyle:"italic", fontWeight:400, lineHeight:1.2, outline:"none", width:"100%", boxSizing:"border-box" }}
                      />
                    ) : (() => {
                      // Revert-to-raw ↺ button. Shows when the
                      // display name differs from the raw receipt
                      // text — meaning Claude or the user reinterpreted
                      // something. Tap to restore rawText. Matches
                      // the philosophy "raw text is source of truth":
                      // user can always see what's on the receipt.
                      const rawName = item.scanRaw?.raw_name || item.rawText || null;
                      const differs = rawName && rawName !== item.name;
                      return (
                        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                          <button
                            onClick={e => { e.stopPropagation(); setEditingNameIdx(idx); }}
                            aria-label={`Rename ${item.name}`}
                            style={{ background:"transparent", border:"none", padding:0, textAlign:"left", fontFamily:"'Fraunces',serif", fontSize:18, fontStyle:"italic", color:"#f0ece4", fontWeight:400, lineHeight:1.25, wordBreak:"break-word", cursor:"text" }}
                          >
                            {item.name}
                          </button>
                          {differs && (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                propagateCorrection(idx, { name: rawName });
                              }}
                              aria-label={`Revert name to receipt text: ${rawName}`}
                              title={`Restore receipt text: "${rawName}"`}
                              style={{
                                background:"transparent", border:"1px dashed #3a2f10",
                                borderRadius:4, padding:"1px 6px",
                                color:"#8a7f6e", cursor:"pointer",
                                fontFamily:"'DM Mono',monospace", fontSize:9,
                                letterSpacing:"0.08em", lineHeight:1,
                                display:"inline-flex", alignItems:"center", gap:3,
                              }}
                            >
                              ↺ RAW
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    {/* Chip row — reserved-color identity chips +
                        supporting fields. Tan = CANONICAL, orange =
                        FOOD CATEGORY, blue = STORED IN. Unset chips
                        render dashed grey. All sub-taps stopPropagation
                        so tapping a chip edits that field instead of
                        opening the full card. */}
                    <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                      {/* CANONICAL (tan) — reserved color for the
                          final-resting identity axis. Three render
                          states:
                            1. Linked to a BUNDLED canonical — registry
                               match, solid tan chip.
                            2. Linked to a PENDING (user-created) slug
                               — same tan chip but with a ✨ emoji and
                               "· PENDING" so the user knows enrichment
                               hasn't landed yet. Fixes the bug where
                               "+ CREATE mac_n_cheese" would render as
                               unset because findIngredient returns
                               null for user-created slugs.
                            3. Unset — grey dashed "+ set canonical". */}
                      {(() => {
                        const slug = item.canonicalId || item.ingredientId || null;
                        const isPending = !!slug && !canon;
                        const displayName = canon
                          ? canon.name
                          : (slug ? slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "");
                        const displayEmoji = canon?.emoji || (isPending ? "✨" : "🏷️");
                        if (!slug) {
                          return (
                            <button
                              onClick={e => { e.stopPropagation(); setLinkingScanMode("canonical"); setLinkingScanIdx(idx); }}
                              aria-label="Set canonical"
                              title="Tap to set canonical"
                              style={{
                                fontFamily:"'DM Mono',monospace", fontSize:9,
                                color:"#666", background:"transparent",
                                border:"1px dashed #2a2a2a",
                                borderRadius:4, padding:"1px 6px",
                                letterSpacing:"0.08em", cursor:"pointer",
                              }}
                            >
                              + set canonical
                            </button>
                          );
                        }
                        return (
                          <button
                            onClick={e => { e.stopPropagation(); setLinkingScanMode("canonical"); setLinkingScanIdx(idx); }}
                            aria-label={`Change canonical (currently ${displayName}${isPending ? ", pending" : ""})`}
                            title={isPending
                              ? `Canonical: ${displayName} — pending review. Tap to change.`
                              : `Canonical: ${displayName} — tap to change`}
                            style={{
                              display:"inline-flex", alignItems:"center", gap:4,
                              fontFamily:"'DM Mono',monospace", fontSize:9,
                              color:"#b8a878", background:"#1a1508",
                              border:"1px solid #3a2f10",
                              borderRadius:4, padding:"2px 6px",
                              letterSpacing:"0.08em", cursor:"pointer",
                            }}
                          >
                            <span>{displayEmoji} {displayName.toUpperCase()}</span>
                            {isPending && !isAdmin && (
                              <span style={{
                                marginLeft: 2,
                                color:"#d4c9ac", fontSize: 8,
                                background:"#2a2110",
                                border:"1px solid #3a2f10",
                                borderRadius: 3, padding:"1px 4px",
                                letterSpacing:"0.1em",
                              }}>
                                PENDING
                              </span>
                            )}
                          </button>
                        );
                      })()}
                      {/* ⭐ LEARNED — this row's identity came from a
                          prior correction keyed on the same raw OCR
                          text. Silent win: "AQUAMARINE SL → Imitation
                          Crab" once, and every future scan of that
                          text pre-fills. */}
                      {item.learnedCorrectionId && (
                        <span
                          title="Pre-filled from a prior correction you (or family) made. Tap any chip to override."
                          style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", background:"#1e1a0e", border:"1px solid #f5c842", borderRadius:4, padding:"2px 6px", letterSpacing:"0.08em" }}
                        >
                          ⭐ LEARNED
                        </span>
                      )}

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
                              onClick={e => { e.stopPropagation(); setEditingExpiryScanIdx(idx); }}
                              aria-label={`Edit expiration date for ${item.name}`}
                              style={{ background:`${color}22`, border:"none", color, fontFamily:"'DM Mono',monospace", fontSize:9, padding:"2px 6px", borderRadius:4, cursor:"pointer", letterSpacing:"0.08em" }}
                            >
                              ⏳ {label}
                            </button>
                          );
                        }
                        return (
                          <button
                            onClick={e => { e.stopPropagation(); setEditingExpiryScanIdx(idx); }}
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
                            onClick={e => { e.stopPropagation(); setTypingScanIdx(idx); }}
                            aria-label={typeEntry ? `Change food category (currently ${typeEntry.label})` : "Set food category"}
                            title={typeEntry ? `Food category: ${typeEntry.label} — tap to change` : "Tap to set food category"}
                            style={typeEntry ? {
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              color: "#e07a3a", background: "#1a0f08",
                              border: "1px solid #3a1f0e",
                              borderRadius: 4, padding: "2px 6px",
                              letterSpacing: "0.08em", cursor: "pointer",
                            } : {
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              color: "#666", background: "transparent",
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
                            onClick={e => { e.stopPropagation(); setTilingScanIdx(idx); }}
                            aria-label={tileEntry ? `Change stored-in shelf (currently ${tileEntry.label})` : "Set stored-in shelf"}
                            title={tileEntry ? `Stored in ${tileEntry.label} — tap to change` : "Tap to set a shelf"}
                            style={tileEntry ? {
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              color: "#7eb8d4", background: "#0f1620",
                              border: "1px solid #1f3040",
                              borderRadius: 4, padding: "2px 6px",
                              letterSpacing: "0.08em", cursor: "pointer",
                            } : {
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              color: "#666", background: "transparent",
                              border: "1px dashed #2a2a2a",
                              borderRadius: 4, padding: "1px 6px",
                              letterSpacing: "0.08em", cursor: "pointer",
                            }}
                          >
                            {tileEntry
                              ? <>{tileEntry.emoji} {tileEntry.label.toUpperCase()}</>
                              : "+ set stored in"}
                          </button>
                        );
                      })()}
                    </div>

                    {/* Fridge | Pantry | Freezer quick-pick — one tap
                        sends the row to that location without opening a
                        picker. Active location reads blue-highlighted;
                        others stay grey-muted until tapped. */}
                    <div style={{ display:"flex", gap:6 }} onClick={e => e.stopPropagation()}>
                      {[
                        { id: "fridge",  emoji: "🧊", label: "Fridge" },
                        { id: "pantry",  emoji: "🥫", label: "Pantry" },
                        { id: "freezer", emoji: "❄️", label: "Freezer" },
                      ].map(loc => {
                        const active = item.location === loc.id;
                        return (
                          <button
                            key={loc.id}
                            onClick={e => { e.stopPropagation(); propagateCorrection(idx, { location: loc.id }); }}
                            aria-label={`Place in ${loc.label}`}
                            title={loc.label}
                            style={{
                              flex: 1, padding: "6px 0",
                              fontSize: 16, lineHeight: 1,
                              background: active ? "#0f1620" : "#0a0a0a",
                              border: `1px ${active ? "solid" : "dashed"} ${active ? "#7eb8d4" : "#2a2a2a"}`,
                              borderRadius: 6, cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            {loc.emoji}
                          </button>
                        );
                      })}
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
                        // statesForItem falls back to food-category
                        // hub (pork → pork_hub, beef → beef_hub) when
                        // the canonical itself has no vocab — so a
                        // user-created pepperoni on a PORK-category
                        // row still gets the meat state picker.
                        const states = statesForItem(item);
                        if (!states || states.length === 0) return null;
                        return (
                          <select
                            value={item.state || ""}
                            onClick={e => e.stopPropagation()}
                            onChange={e => { e.stopPropagation(); updateScanItem(idx, { state: e.target.value || null }); }}
                            title="Physical state / form"
                            style={{
                              background: item.state ? "#0f1620" : "transparent",
                              border: `1px ${item.state ? "solid" : "dashed"} ${item.state ? "#1f3040" : "#2a2a2a"}`,
                              color: item.state ? "#7eb8d4" : "#666",
                              borderRadius: 4, padding: "1px 4px",
                              fontFamily: "'DM Mono',monospace", fontSize: 9,
                              letterSpacing: "0.05em", cursor: "pointer",
                              outline: "none",
                            }}
                          >
                            <option value="" style={{ background: "#141414" }}>+ SET STATE</option>
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
                      onClick={e => e.stopPropagation()}
                      style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0, marginTop:2 }}
                      onBlur={e => {
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          setEditingIdx(null);
                        }
                      }}
                    >
                      <input type="number" value={item.amount} onChange={e=>updateAmount(idx,e.target.value)} autoFocus
                        style={{ width:58, background:"#222", border:"1px solid #f5c842", borderRadius:6, padding:"6px 8px", color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:13, textAlign:"right", outline:"none" }} />
                      {(() => {
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
                    <button
                      onClick={e => { e.stopPropagation(); setEditingIdx(idx); }}
                      style={{ background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:8, padding:"6px 12px", fontFamily:"'DM Mono',monospace", fontSize:12, color:"#f5c842", cursor:"pointer", flexShrink:0, marginTop:2 }}
                    >
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
            // Implicit-confirmation bump. Any row that still carries a
            // learnedCorrectionId is a row the user accepted without
            // editing — bump correction_count so recurring corrections
            // build confidence. If they DID edit, propagateCorrection
            // already upserted a fresh memory and this bump is a no-op
            // on the new (now current) entry.
            if (userId) {
              for (const row of scannedItems) {
                if (!row.learnedCorrectionId) continue;
                const rawText = row.scanRaw?.raw_name || row.name;
                if (!rawText) continue;
                rememberScanCorrection({
                  userId,
                  rawText,
                  correctedName: row.name,
                  emoji: row.emoji,
                  typeId: row.typeId,
                  canonicalId: row.canonicalId || row.ingredientId,
                  ingredientIds: row.ingredientIds,
                  brand: row.brand,
                }).catch(() => {});
              }
            }
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
          mode={linkingScanMode === "canonical" ? "single" : "multi"}
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
            // In single mode (CANONICAL axis) the row's tags shouldn't
            // be disturbed — the user is picking the row's identity,
            // not its composition. In multi mode (ItemCard onEditTags)
            // the tags array IS the edit target.
            const isCanonicalAxis = linkingScanMode === "canonical";
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
            //
            // canonicalId is the single-identity axis (0039 column);
            // ingredientIds is the multi-tag composition. Canonical-axis
            // picks write both so the chip re-renders immediately and
            // the scan-confirm insert carries the slug. Emoji/category
            // fall back to the row's existing values when the user
            // creates a brand-new canonical (findIngredient returns null
            // for user-created slugs) — without that fallback the chip
            // would flash unset after save.
            const patch = {
              canonicalId: primaryId,
              emoji:    canon?.emoji    || scannedItems[linkingScanIdx].emoji,
              category: canon?.category || scannedItems[linkingScanIdx].category,
            };
            if (isCanonicalAxis) {
              patch.ingredientId = primaryId;
            } else {
              patch.ingredientId = primaryId;
              patch.ingredientIds = ids;
              patch.kind = kindForTagCount(ids.length);
            }
            propagateCorrection(linkingScanIdx, patch);
            // Admin auto-approve. When an admin mints a new slug via
            // "+ CREATE" the system immediately upserts an
            // ingredient_info stub so the canonical stops reading as
            // PENDING for the rest of the family — admins approve
            // their own creations implicitly. Non-admins: the slug
            // lands in pending territory and an admin reviews it in
            // the CANONICALS tab. `primaryId && !canon` is the
            // user-created-slug signal (bundled slugs resolve via
            // findIngredient).
            if (isAdmin && primaryId && !canon) {
              const stub = {
                _meta: {
                  reviewed: true,
                  reviewed_by: userId || null,
                  reviewed_at: new Date().toISOString(),
                  source: "admin_scan_create",
                },
              };
              supabase
                .from("ingredient_info")
                .upsert({ ingredient_id: primaryId, info: stub }, { onConflict: "ingredient_id" })
                .then(({ error }) => {
                  if (error) console.warn("[admin_auto_approve] upsert failed:", error.message);
                  // Refresh dbMap so the next scan's autoStar can
                  // see this new approval as a synthetic canonical.
                  else refreshDb?.();
                });
            }
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
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#e07a3a", letterSpacing:"0.12em", marginBottom:10 }}>
            CATEGORY
          </div>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontStyle:"italic", color:"#f0ece4", fontWeight:400, margin:"0 0 6px", lineHeight:1.2 }}>
            What category does {scannedItems[typingScanIdx].name} belong to?
          </h2>
          <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#888", lineHeight:1.5, margin:"0 0 14px" }}>
            We've loaded the largest USDA categories for you to choose from. Category drives the state picker (sliced / ground / whole / ...) and the default tile — pick the one that best matches.
          </p>
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

      {/* Emoji picker — tap the big emoji on a scan row. Same curated
          list TypePicker/IdentifiedAsPicker use for CREATE NEW, so the
          visual vocabulary stays consistent across the app. Propagates
          to sibling rows with the same raw read so "3 × CHOBANI" all
          get the same emoji in one tap. */}
      {emojiingScanIdx != null && scannedItems[emojiingScanIdx] && (
        <ModalSheet onClose={() => setEmojiingScanIdx(null)} maxHeight="60vh">
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:10 }}>
            PICK AN EMOJI
          </div>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontStyle:"italic", color:"#f0ece4", fontWeight:400, margin:"0 0 14px", lineHeight:1.2 }}>
            {scannedItems[emojiingScanIdx].name}
          </h2>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:8 }}>
            {SCAN_EMOJI_OPTIONS.map(em => {
              const selected = scannedItems[emojiingScanIdx].emoji === em;
              return (
                <button
                  key={em}
                  onClick={() => {
                    propagateCorrection(emojiingScanIdx, { emoji: em });
                    setEmojiingScanIdx(null);
                  }}
                  style={{
                    fontSize:24, lineHeight:1,
                    padding:"10px 0",
                    background: selected ? "#1a1608" : "#0f0f0f",
                    border: `1px solid ${selected ? "#f5c842" : "#242424"}`,
                    borderRadius:8, cursor:"pointer",
                  }}
                >
                  {em}
                </button>
              );
            })}
          </div>
        </ModalSheet>
      )}

      {/* Full-card editor for a scan row. Reuses ItemCard so the
          scan-confirm list gets the same three-stacked-buttons +
          fridge|pantry|freezer emoji row surface the pantry uses.
          Every field routes through updateScanItem so the scan
          draft stays the source of truth until STOCK. onEditTags
          opens LinkIngredient via the existing scan-linker. */}
      {expandedScanIdx != null && scannedItems[expandedScanIdx] && (
        <ItemCard
          item={scannedItems[expandedScanIdx]}
          pantry={[]}
          userId={userId}
          isAdmin={isAdmin}
          onUpdate={(patch) => {
            propagateCorrection(expandedScanIdx, patch);
          }}
          onEditTags={() => { setLinkingScanMode("tags"); setLinkingScanIdx(expandedScanIdx); }}
          onClose={() => setExpandedScanIdx(null)}
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


function AddItemModal({ target, tileContext, userId, isAdmin = false, shoppingList = [], onClose, onAdd }) {
  // Pulled for admin-approve writes so the session's dbMap updates
  // immediately after an admin mints a new canonical here. dbMap
  // also feeds the packaging-chip row below the quantity field —
  // when the picked canonical carries a packaging block in its
  // ingredient_info, we let the user tap a typical size instead of
  // typing amount+unit from scratch.
  const { refreshDb, dbMap } = useIngredientInfo();
  // Barcode scanner + brand-nutrition write path. Scanning prefills
  // brand + name from Open Food Facts; the nutrition payload is
  // stashed on a ref and written to `brand_nutrition` after the item
  // save resolves a canonical_id (brand_nutrition's PK requires it,
  // so we wait until we know what to key against).
  const { upsert: upsertBrandNutrition, rows: brandNutritionRows } = useBrandNutrition();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedPayload, setScannedPayload] = useState(null);
  //   { barcode, brand, nutrition, source, sourceId, productName } | null
  const [scanBusy, setScanBusy] = useState(false);
  // Canonical suggestion from the last scan. null = no active
  // suggestion (either nothing scanned, resolver missed, or user
  // already actioned it). When set, renders CanonicalSuggestionCard.
  const [canonicalSuggestion, setCanonicalSuggestion] = useState(null);
  //   { match, inferredState: {state} | null, packageSize: {amount, unit} | null } | null
  const { push: pushToastFromScan } = useToast();
  const [amount, setAmount] = useState("");
  // Optional "full package size" the user declares at add-time.
  // Empty string = undeclared (max stays null on save, slider hidden).
  // Any positive number = max gets stamped and slider becomes the
  // consumption gauge on ItemCard. Separate from amount so the user
  // can say "I have 9 cups out of an 18-cup bag" even when they
  // haven't opened the bag yet (amount == max = SEALED; amount < max
  // = OPENED). Keeping it a string here so the input can be blank.
  const [packageSize, setPackageSize] = useState("");

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
  // Brand (migration 0061). Parsed opportunistically off the typed
  // name via parseIdentity — "KERRYGOLD UNSALTED BUTTER" stamps
  // brand="Kerrygold" without the user reaching for a picker. Stays
  // sticky once set; a user who pastes over the name keeps their
  // prior brand until they explicitly clear it (matches how
  // customTypeId / customTileId behave).
  const [customBrand, setCustomBrand] = useState(null);
  // BRAND row inline-edit mode — flips true when the user taps the
  // BRAND row above the CANONICAL tap line. Input autofocuses,
  // blur commits + closes. Separate from customBrand so the row can
  // freely toggle between display and edit without losing the
  // stored value.
  const [customBrandOpen, setCustomBrandOpen] = useState(false);
  // Reserve-unit count (migration 0054). How many ADDITIONAL sealed
  // packages the user has beyond the one they're treating as "open"
  // (the amount field). Stays zero for liquid-mode rows; >0 flips
  // the row into package mode on save so the pantry can render
  // per-unit gauges and the cook-decrement can pop reserves instead
  // of deleting the row when the open unit hits zero.
  // How many physical packages the user is adding. Each one becomes
  // its own pantry_items row (so `Costco trip of 50 tuna` = 50 rows
  // the render layer stacks into one card). Supersedes `reserveCount`
  // from migration 0054 — instead of 1 open + N sealed, we now insert
  // N independent rows that share identity.
  const [instanceCount, setInstanceCount] = useState(1);
  // Flipped to true on a save attempt that hit missing fields — lights
  // up the per-field validation reminder panel. Stays latched so the
  // user can actually see which field is red while they fix it;
  // flipped back to false on a successful save.
  const [saveAttempted, setSaveAttempted] = useState(false);
  // Full-screen outcome overlay. null = none; otherwise one of:
  //   { kind: "warning", missing: string[] }       — save attempt with missing fields
  //   { kind: "success", item, location, tile }    — save landed
  //   { kind: "exit_warning" }                     — user tried to close with data dirty
  const [outcome, setOutcome] = useState(null);
  // Inline expiration + state — new in the ItemCard-styled add form.
  // Both optional. customExpiresAt is a Date (or null); customState is
  // one of the ingredient-specific state ids (e.g. "whole" | "diced"),
  // only meaningful once the item has a canonical match.
  const [customExpiresAt, setCustomExpiresAt] = useState(null);
  const [customState, setCustomState] = useState(null);
  const [statePickerOpen, setStatePickerOpen] = useState(false);
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
  // Single-pick CANONICAL sheet for the AddItemModal. Separate from
  // customComponentsOpen because the CANONICAL axis is one-of (identity)
  // and the components axis is many-of (composition).
  const [customCanonicalOpen, setCustomCanonicalOpen] = useState(false);

  // Observation-learned PACKAGE SIZE chips — replaces the admin-
  // curated ingredient_info.packaging.sizes bank. Keyed on the
  // live (brand, canonical) pair so the chips update as the user
  // types a brand-containing name or picks a canonical. Declared
  // AFTER customCanonicalId + customComponents so the closure sees
  // the initialized values (TDZ violation if declared above).
  const primaryCanonicalId = customCanonicalId
    || (customComponents[0]?.canonical?.id)
    || null;
  const popularPackages = usePopularPackages(customBrand, primaryCanonicalId, 5);

  // Family-shared user templates, newest-first. Empty until the user
  // (or any family member) saves their first custom item; grows as
  // real-life usage populates the recents ladder.
  const [userTemplates] = useUserTemplates(userId);

  // Fill the custom form from a template. Called from the name-input
  // typeahead when the user taps a matching template row — the big
  // bulky "YOUR RECENTS" idle-state block was removed because the
  // typeahead already covers template surfacing once the user starts
  // typing, and a full recents dump at the top dominated the modal.
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
  // Routing cascade fired when a canonical is picked — sets
  // category and, if the user hasn't already made explicit choices,
  // stored-in and tile. Keeping this separate from fillFromCanonical
  // means the LinkIngredient picker (where the user is confirming
  // identity only, not overwriting their custom name / unit / blend
  // composition) can still cascade to routing without touching
  // identity fields.
  const cascadeFromCanonical = (ing) => {
    if (!ing) return;
    const category = ing.category || "pantry";
    setCustomCategory(category);
    // Auto-pin WWEIA food type (orange CATEGORY row) the instant
    // we know the canonical. Per user directive: "the SECOND it
    // knows it's a category type it should pin — I shouldn't
    // have to click on the category to see a star then click
    // again." Works for bundled canonicals via the 1:1
    // canonicalId bridge and for synthetic (user-minted)
    // canonicals via name-alias inference ("apple cider vinegar"
    // → wweia_vinegars). Never clobbers an explicit user pick.
    const inferredType = typeIdForCanonical(ing);
    if (inferredType) {
      setCustomTypeId(prev => prev || inferredType);
    }
    // Unit inference — bind the canonical's defaultUnit when the
    // user hasn't already picked a unit. Otherwise leave their
    // pick alone. Vinegar → fl_oz, milk → gallon, butter → oz,
    // meats → lb, etc. — each bundled canonical carries its own
    // default that's more accurate than a category-wide guess.
    if (ing.defaultUnit) {
      setCustomUnit(prev => prev || ing.defaultUnit);
    }
    setCustomLocation(prev => {
      if (prev) return prev;
      const loc = defaultLocationForCategory(category);
      setCustomTileId(prevTile => {
        if (prevTile) return prevTile;
        const classify = loc === "fridge"  ? fridgeTileIdForItem
                       : loc === "freezer" ? freezerTileIdForItem
                       :                      pantryTileIdForItem;
        const fakeItem = { ingredientId: ing.id, ingredientIds: [ing.id], category };
        try {
          const tileId = classify(fakeItem, { findIngredient, hubForIngredient });
          return tileId || prevTile;
        } catch {
          return prevTile;
        }
      });
      return loc;
    });
  };

  // Amount stays whatever the user had typed — they still need to
  // enter count even when the identity is resolved.
  const fillFromCanonical = (ing) => {
    if (!ing) return;
    setCustomName(ing.name || "");
    if (ing.defaultUnit) setCustomUnit(ing.defaultUnit);
    setCustomComponents([{ id: ing.id, canonical: ing }]);
    // Cascade: category → location → tile. Only fills when the user
    // hasn't already made an explicit pick — we never clobber a
    // conscious choice (e.g., "I know penne is pantry category but
    // this box lives in the freezer"). Each step gates on the
    // previous so picking a canonical propagates as far as the
    // classifier knows, then stops.
    cascadeFromCanonical(ing);
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
  // Save predicate. A complete pantry row needs name + amount + unit
  // PLUS a food category AND a storage location — the two fields that
  // make a row findable later. Without category the row doesn't route
  // into a tile; without location it doesn't know which storage tab
  // to live under. The button stays bright-yellow on the happy path;
  // missing fields flip the button to a red-tinted "explain what's
  // wrong" state that lists each missing field with a friendly
  // reminder of what it's for.
  const trimmedName = customName.trim();
  const hasName     = !!trimmedName;
  const hasAmount   = amount !== "" && !isNaN(parseFloat(amount));
  const hasUnit     = !!customUnit.trim();
  const hasCategory = !!customTypeId;
  const hasLocation = !!customLocation;
  const hasTile     = !!customTileId;
  // Canonical counts as satisfied when the user explicitly picked
  // one OR when we can derive one from the typed name / category
  // default. The · AUTO chip on the CANONICAL tap line already
  // surfaces the derived value so the user can see what they're
  // committing to before they save.
  const derivedCanonicalId =
    customCanonicalId
    || inferCanonicalFromName(trimmedName)
    || canonicalIdForType(customTypeId)
    || null;
  const hasCanonical = !!derivedCanonicalId;
  const missing = [];
  if (!hasName)      missing.push("name");
  if (!hasAmount)    missing.push("amount");
  if (!hasUnit)      missing.push("unit");
  if (!hasCanonical) missing.push("canonical");
  if (!hasCategory)  missing.push("category");
  if (!hasTile)      missing.push("tile");
  if (!hasLocation)  missing.push("location");
  const canSave = missing.length === 0;

  // Close-attempt interceptor. If the user has started filling out
  // the form (typed a name) but hasn't completed every required
  // field, we show a full-screen exit warning explaining why each
  // missing field matters. They can still bail via SAVE ANYWAY (the
  // temporary escape hatch — will tighten post-beta per user spec)
  // or KEEP EDITING. If the form is pristine (no name typed) or
  // complete, close fires immediately.
  const isDirty  = hasName || hasAmount || hasUnit || hasCategory || hasLocation;
  const isComplete = canSave;
  const attemptClose = () => {
    if (!isDirty || isComplete) {
      onClose?.();
      return;
    }
    setOutcome({ kind: "exit_warning" });
  };

  const save = async () => {
    if (!canSave) {
      // Full-screen warning lists the missing fields with plain-
      // language explainers so the user learns WHY each is required.
      // Users shouldn't be able to save a half-configured row —
      // category + location + canonical drive state vocab, tile
      // routing, and future search. Missing them now creates
      // orphaned pantry items that are hard to recover later.
      setSaveAttempted(true);
      setOutcome({ kind: "warning", missing });
      return;
    }
    setSaveAttempted(false);
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
    // Canonical derivation at save time: explicit user pick first,
    // then name-match. We deliberately do NOT fall back to
    // canonicalIdForType(customTypeId) — the food category is a broad
    // classification (Pasta), not the item's specific identity
    // Canonical resolution on save:
    //   1. User's explicit pick (typeahead / suggestion card).
    //   2. Registry alias match on the typed name.
    //   3. null — better than a synthetic. Previous behavior slugified
    //      the display name into a fresh canonical when nothing else
    //      matched, which polluted the registry with one-off fake
    //      canonicals per scanned marketing name ("Ocean's Halo
    //      O'cean's Organic Sushi Nori Wasabi Style 40G" → a unique
    //      id per product, no clustering, no hub grouping, no recipe
    //      matches). Null is the honest answer when resolution fails;
    //      the hub "loose pile" filter already handles null.
    const canonicalId = customCanonicalId
      || inferCanonicalFromName(customName.trim())
      || null;

    // Mirror canonical into components when user hasn't tagged
    // composition (single-ingredient case). Multi-ingredient rows
    // with explicit composition already have compIds populated and
    // skip this fallback.
    const effectiveComponents = compIds.length > 0
      ? compIds
      : (canonicalId ? [canonicalId] : []);

    // Unified save shape. Single-canonical picks, multi-canonical
    // composed meals, and pure free-text all land in the same payload —
    // components.length drives whether ingredientId is set, kind flips
    // to meal, or the row stays free-text.
    const item = {
      id: crypto.randomUUID(),
      // First component (if any) becomes the primary tag so the
      // legacy ingredient_id scalar stays useful. Zero components =
      // pure free-text with no canonical (rare after the invariant
      // above — canonicalId is almost always set).
      ingredientId: primaryComp?.id || effectiveComponents[0] || null,
      // Composition array — v0.13.0 renamed the field to `components`
      // at the DB level (migration 0056). usePantry.js's toDb still
      // accepts either `components` or legacy `ingredientIds`.
      components: effectiveComponents,
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
      // `max` = the container's full size. Set ONLY when the user
      // explicitly declared a package in the PACKAGE SIZE input or
      // via a packaging chip. 0 = "not declared" (slider stays
      // hidden; hasPackage checks max > 0 everywhere). We send 0
      // instead of null because the DB column is NOT NULL default
      // 1 — null would get rejected, default would fire and lie.
      // Also powers SEALED vs OPENED: amount === max → sealed,
      // amount < max → opened.
      max: (() => {
        const n = parseFloat(packageSize);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })(),
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
      // Optional inline expiration + state — new in the ItemCard-styled
      // add form. Expiration is omitted when null so Pantry's onAdd
      // doesn't accidentally write a null into a column that expects
      // undefined-as-unset.
      ...(customExpiresAt ? { expiresAt: customExpiresAt } : {}),
      ...(customState ? { state: customState } : {}),
      ...(customBrand ? { brand: customBrand } : {}),
    };

    // Per-instance add: insert N independent rows sharing identity so
    // the render layer can stack them (×N badge + fan). Each row gets
    // its own uuid; composition (if multi-tag) is written per-row
    // below so every instance carries the same blend structure.
    const count = Math.max(1, Math.floor(Number(instanceCount) || 1));
    const instanceIds = [];
    for (let i = 0; i < count; i++) {
      const freshId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
      instanceIds.push(freshId);
      onAdd({ ...item, id: freshId });
    }
    setSaveAttempted(false);

    // Brand-nutrition upsert. Fires only when the user both (a)
    // scanned a barcode during this add AND (b) resolved a canonical
    // for the row — brand_nutrition's PK requires canonical_id. If the
    // canonical is still null we drop the payload silently rather than
    // writing a row that can't be looked up later. The write is fire-
    // and-forget; a transient failure just means the next household
    // member to scan the same UPC re-fetches from OFF.
    const resolvedCanonical = item.ingredientId || item.canonicalId || null;
    const brandForWrite = item.brand || scannedPayload?.brand;
    if (scannedPayload && resolvedCanonical && brandForWrite) {
      upsertBrandNutrition({
        canonicalId: resolvedCanonical,
        brand:       brandForWrite,
        nutrition:   scannedPayload.nutrition,
        barcode:     scannedPayload.barcode,
        source:      scannedPayload.source || "openfoodfacts",
        sourceId:    scannedPayload.sourceId || scannedPayload.barcode,
      }).catch((e) => {
        console.warn("[brand_nutrition] upsert after add failed:", e);
      });
    }
    setScannedPayload(null);
    // Full-screen success. User taps DONE to dismiss → onClose fires.
    // Gives them a beat to absorb "yes, it saved, here's where it
    // went" instead of the modal snapping shut. Destination string
    // is resolved from the same tile/location data we just persisted
    // so it matches exactly where the user will find the row.
    const tileLabel = (() => {
      const all = [...FRIDGE_TILES, ...PANTRY_TILES, ...FREEZER_TILES];
      return all.find(t => t.id === item.tileId)?.label || null;
    })();
    const locLabel = ({
      fridge:  "Fridge",
      pantry:  "Pantry",
      freezer: "Freezer",
    })[item.location] || item.location || "your kitchen";
    setOutcome({
      kind: "success",
      item,
      locationLabel: locLabel,
      tileLabel,
    });

    // Write the structured components tree after onAdd has kicked the
    // parent pantry_items INSERT. setComponentsForParent retries on
    // FK-violation so the race with the parent INSERT is self-healing.
    // Fan out to every instance so each stacked row carries the same
    // composition — 5 frozen pizzas = 5 rows, each linked to the full
    // blend.
    if (compIds.length >= 2) {
      const tree = componentsFromIngredientIds(compIds);
      await Promise.all(instanceIds.map(iid => setComponentsForParent(iid, tree)));
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
      onClose={attemptClose}
      zIndex={Z.modal}
      showClose={false}
      maxHeight="85vh"
    >
        {/* Close — absolutely positioned upper-right (ModalSheet's own
            close is suppressed via showClose={false}; we render our own
            so the visual matches ItemCard). */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: 12, right: 14,
            width: 36, height: 36,
            background: "#0a0a0a", border: "1px solid #2a2a2a",
            color: "#aaa", borderRadius: 18,
            fontFamily: "'DM Mono',monospace", fontSize: 16,
            cursor: "pointer", zIndex: 2,
          }}
        >✕</button>

        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:6 }}>
          {target === "shopping"
            ? "+ TO SHOPPING LIST"
            : tileContext
              ? `+ TO ${tileContext.tabId.toUpperCase()} · ${tileContext.tileLabel.toUpperCase()}`
              : "+ TO KITCHEN"}
        </div>

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
                name freely; the emoji stays consistent for custom items.

                The "YOUR RECENTS" idle-state dump used to live here — a
                bulky list of 5 rows + search box that dominated the top
                of the modal before the user had done anything. Deleted
                because the typeahead on the name input (below) already
                surfaces templates as the user types, making the idle
                dump redundant noise. fillFromTemplate is still wired
                through the typeahead row's onClick. */}
            {/* (removed — see comment above) */}

            {/* Barcode scan — fast path for packaged goods. Prefills
                brand + name from Open Food Facts and stashes the OFF
                nutrition payload; once the user picks a canonical and
                saves, the nutrition writes to brand_nutrition. If the
                product isn't in OFF or scanning isn't supported,
                user can type the number or just skip this and use
                the free-text name input below. */}
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              disabled={scanBusy}
              style={{
                width: "100%", padding: "11px 14px",
                background: "linear-gradient(135deg, #1a1a1a 0%, #141414 100%)",
                border: `1px solid ${scannedPayload ? "#c7a8d4" : "#2a2a2a"}`,
                borderRadius: 10, marginBottom: 14,
                display: "flex", alignItems: "center", gap: 10,
                cursor: scanBusy ? "wait" : "pointer",
                textAlign: "left",
                opacity: scanBusy ? 0.6 : 1,
              }}
            >
              <span style={{ fontSize: 18 }}>📷</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  color: scannedPayload ? "#c7a8d4" : "#aaa",
                  letterSpacing: "0.12em",
                }}>
                  {scanBusy ? "LOOKING UP…" : scannedPayload ? "SCANNED ✓" : "SCAN BARCODE"}
                </div>
                <div style={{
                  marginTop: 2,
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                  color: "#777", lineHeight: 1.4,
                }}>
                  {scannedPayload
                    ? `${scannedPayload.productName || "Product"}${scannedPayload.brand ? ` · ${scannedPayload.brand}` : ""}`
                    : "Open Food Facts has 2M+ products — one tap fills name + brand + nutrition."}
                </div>
              </div>
              <span style={{ color: "#555", fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
            </button>
            {scannerOpen && (
              <BarcodeScanner
                onCancel={() => setScannerOpen(false)}
                onDetected={async (barcode) => {
                  setScannerOpen(false);
                  setScanBusy(true);
                  try {
                    const res = await lookupBarcode(barcode, { brandNutritionRows });
                    if (!res?.found) {
                      // Distinguish failure modes so the user knows
                      // whether they have a deploy problem, a network
                      // problem, or just a barcode OFF doesn't know.
                      const msg = res?.reason === "edge_fn_not_deployed"
                        ? `Scan edge function isn't deployed. Run: supabase functions deploy lookup-barcode`
                        : res?.reason === "fetch_failed"
                          ? `Barcode lookup failed (${res?.status || "network"}). Check your connection.`
                          : res?.reason === "no_nutriments"
                            ? `Found ${barcode} but Open Food Facts has no nutrition data for it.`
                            : res?.reason === "off_unavailable"
                              ? `Open Food Facts is having a rough moment. Try again in a sec.`
                              : `No match for ${barcode} in Open Food Facts.`;
                      pushToastFromScan(msg, {
                        emoji: res?.reason === "edge_fn_not_deployed" ? "⚙️" : "🔍",
                        kind: "warn",
                        ttl: res?.reason === "edge_fn_not_deployed" ? 9000 : 5500,
                      });
                      setScanBusy(false);
                      return;
                    }
                    // Prefill the form. Don't blow away user-typed
                    // text if they already started — only fill empty
                    // slots so a mid-form scan is additive, not
                    // destructive. We keep productName as the raw
                    // name so grade / variant info ("sushi", "wasabi
                    // style") is preserved on the row even when the
                    // canonical snap strips them down to "nori".
                    setCustomBrand(prev => prev || res.brand || null);
                    setCustomName(prev => prev || res.productName || "");
                    // Resolve canonical from OFF data. Returns null
                    // when nothing above the confidence floor — in
                    // that case the user gets the existing canonical
                    // picker with productName as a search seed.
                    const match = resolveCanonicalFromScan({
                      brand:         res.brand,
                      productName:   res.productName,
                      categoryHints: res.categoryHints || [],
                      findIngredient,
                    });
                    // Extract state + package size opportunistically.
                    // State only applies when the resolved canonical
                    // actually supports it (ground beef = yes; ground
                    // bread = no).
                    const rawState = parseStateFromText(res.productName, res.categoryHints || []);
                    const inferredState = match?.canonical
                      ? { state: stateForCanonical(rawState, match.canonical) }
                      : null;
                    const packageSize = parsePackageSize(res.quantity);
                    if (match) {
                      setCanonicalSuggestion({
                        match,
                        inferredState: inferredState?.state ? inferredState : null,
                        packageSize,
                      });
                    } else if (packageSize) {
                      // No canonical match but we got a package size —
                      // apply it silently. Nothing to confirm; just
                      // helpful prefill.
                      setAmount(String(packageSize.amount));
                      setCustomUnit(packageSize.unit);
                    }
                    // Stash the payload for the post-save
                    // brand_nutrition upsert. If the scan was cached
                    // (same barcode seen before) the row already
                    // exists and we don't need to write again.
                    if (!res.cached) {
                      setScannedPayload({
                        barcode:     res.barcode,
                        brand:       res.brand,
                        productName: res.productName,
                        nutrition:   res.nutrition,
                        source:      res.source,
                        sourceId:    res.sourceId,
                        canonicalId: res.canonicalId || null,
                      });
                      pushToastFromScan(
                        `Found: ${res.productName || res.brand || res.barcode}`,
                        { emoji: "✨", kind: "success", ttl: 3500 },
                      );
                    } else {
                      pushToastFromScan(
                        "Pulled from cache — nutrition already known.",
                        { emoji: "💾", kind: "info", ttl: 3000 },
                      );
                    }
                  } catch (e) {
                    console.error("[barcode] lookup failed:", e);
                    pushToastFromScan(
                      "Barcode lookup failed. Fill in manually.",
                      { emoji: "⚠️", kind: "warn", ttl: 4500 },
                    );
                  } finally {
                    setScanBusy(false);
                  }
                }}
              />
            )}

            {/* Canonical suggestion card — renders after a scan when
                the resolver maps productName + categoryHints to a
                registry canonical. Always shown (per design: half-a-
                tap of friction for zero pollution risk). USE applies
                the canonical + state + package size; DIFFERENT opens
                the canonical picker and clears the suggestion. */}
            {canonicalSuggestion && (
              <CanonicalSuggestionCard
                match={canonicalSuggestion.match}
                inferredState={canonicalSuggestion.inferredState}
                packageSize={canonicalSuggestion.packageSize}
                onUse={() => {
                  const { match, inferredState, packageSize } = canonicalSuggestion;
                  setCustomCanonicalId(match.canonical.id);
                  if (inferredState?.state) setCustomState(inferredState.state);
                  if (packageSize) {
                    setAmount(String(packageSize.amount));
                    setCustomUnit(packageSize.unit);
                  }
                  setCanonicalSuggestion(null);
                }}
                onDifferent={() => {
                  setCanonicalSuggestion(null);
                  // Open the existing canonical picker surface —
                  // AddItemModal uses tilePickerOpen for IDENTIFIED AS
                  // (which flips both type + canonical). User can
                  // find the right canonical via search from there.
                  setTilePickerOpen(true);
                }}
              />
            )}

            {/* Name input + typeahead. As the user types, filter the
                family's templates by substring match and surface a
                dropdown. Tap a suggestion -> fillFromTemplate (same
                handler as RECENTS). Exact-match gets a subtle
                "WILL MERGE INTO EXISTING" hint so the user knows
                saving bumps the existing template instead of making
                a dup — transparency around the strict-dedup rule. */}
            {/* Header row — mirrors ItemCard's visual layout so the
                "Add" flow looks like the filled-out item it'll become.
                Emoji on the left, kicker + title-style name input + 3
                tap lines for FOOD CATEGORY / STORED IN / STATE on the
                right. The typeahead stays inside the name input's
                relative wrapper so the suggestion dropdown still
                positions correctly below. */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 44, lineHeight: 1, paddingTop: 18, flexShrink: 0 }}>
                {(() => {
                  const derived = customCanonicalId
                    || inferCanonicalFromName(customName.trim())
                    || canonicalIdForType(customTypeId);
                  return findIngredient(derived)?.emoji || "🥫";
                })()}
              </div>
              <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                {/* ITEM kicker removed — it did nothing for the
                    structure, and the big italic header below
                    (derived from brand + canonical) is already the
                    primary identity surface. No redundant label
                    needed. */}

                {/* Header MIRRORS ItemCard exactly:
                      - Big italic header = [Brand] [Canonical] derived
                      - Free-text fallback input when no canonical
                        (tan-tinted to signal "this is the canonical
                        slot — you're setting the thing's identity")
                      - "+ ADD BRAND" affordance BELOW the header (when
                        brand unset) — brand is secondary to canonical,
                        so its affordance sits subordinate
                    Same three-state rendering as ItemCard's header;
                    uses customBrandOpen / customCanonicalOpen toggles
                    the same way ItemCard uses editingField. */}

                {/* Big italic header — [Brand] [Canonical or free-text name] */}
                <div style={{
                  fontFamily: "'Fraunces',serif", fontSize: 26,
                  fontStyle: "italic", fontWeight: 300,
                  color: "#f0ece4", margin: "6px 0 0", lineHeight: 1.2,
                  display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap",
                }}>
                  {/* BRAND segment — inline editable on tap */}
                  {customBrandOpen ? (
                    <input
                      type="text"
                      autoFocus
                      defaultValue={customBrand || ""}
                      onBlur={e => {
                        const v = e.target.value.trim();
                        setCustomBrand(v || null);
                        setCustomBrandOpen(false);
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setCustomBrandOpen(false);
                      }}
                      placeholder="Brand…"
                      style={{
                        fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                        color: "#f5c842", fontWeight: 400, lineHeight: 1.2,
                        background: "#0a0a0a", border: "1px solid #f5c842",
                        borderRadius: 8, padding: "2px 8px", outline: "none",
                        minWidth: 120, width: "40%",
                      }}
                    />
                  ) : customBrand ? (
                    <span
                      onClick={() => setCustomBrandOpen(true)}
                      style={{ cursor: "pointer", color: "#d4c9ac" }}
                      title="Tap to edit brand"
                    >
                      {customBrand}
                    </span>
                  ) : null}

                  {/* CANONICAL / fallback segment — when canonical
                      bound, show its name (tap opens picker). When
                      unset, show an editable text input so user can
                      type what it is; blur tries inferCanonicalFromName
                      to auto-resolve. */}
                  {customCanonicalId ? (
                    <span
                      onClick={() => setCustomCanonicalOpen(true)}
                      style={{ cursor: "pointer" }}
                      title="Tap to change canonical"
                    >
                      {findIngredient(customCanonicalId)?.name
                        || customCanonicalId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  ) : (
                    <input
                      value={customName}
                      onChange={e => {
                        const next = e.target.value;
                        setCustomName(next);
                        if (!customBrand) {
                          const parsed = parseIdentity(next);
                          if (parsed.brand) setCustomBrand(parsed.brand);
                        }
                      }}
                      onBlur={e => {
                        // Defer the blur-resolution one tick so a tap
                        // on a canonical-typeahead row below can bind
                        // the canonical before this handler clears
                        // customName or runs inferCanonicalFromName.
                        // Without the defer, the onMouseDown on a
                        // dropdown row fires blur first and the tap's
                        // click event never registers.
                        const typed = e.target.value.trim();
                        setTimeout(() => {
                          if (!typed || customCanonicalId) return;
                          const inferredId = inferCanonicalFromName(typed);
                          if (inferredId) setCustomCanonicalId(inferredId);
                        }, 180);
                      }}
                      placeholder="What is it?"
                      style={{
                        flex: "1 1 auto", minWidth: 0,
                        background: "transparent",
                        border: "none", outline: "none",
                        fontFamily: "'Fraunces',serif",
                        fontSize: 26, fontStyle: "italic", fontWeight: 300,
                        color: "#b8a878",
                        padding: "2px 0 0",
                        boxSizing: "border-box",
                      }}
                    />
                  )}
                </div>

                {/* + ADD BRAND BELOW the header (moved from above).
                    Brand is secondary to canonical — canonical IS
                    the thing's identity, brand modifies it. Visual
                    order reflects that hierarchy: canonical header
                    first, optional brand affordance subordinate
                    below. Only renders when brand is unset; once
                    set, brand inlines into the header above as the
                    prefix segment. */}
                {!customBrand && !customBrandOpen && (
                  <div
                    onClick={() => setCustomBrandOpen(true)}
                    style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 9,
                      color: "#555", letterSpacing: "0.12em",
                      cursor: "pointer", marginTop: 6,
                      width: "fit-content",
                      borderBottom: "1px dashed #2a2a2a",
                    }}
                  >
                    + ADD BRAND
                  </div>
                )}

                {/* Canonical typeahead — only renders while the user
                    is typing into the "what is it?" fallback input
                    AND no canonical is bound yet. Shows up to 5
                    fuzzy-matched bundled canonicals. Tap → binds the
                    canonical (sets customCanonicalId, hides this
                    whole block since the input collapses to the tan
                    canonical display above). Shopping-list bias
                    passed in so items on the active list float to
                    the top — same +30 tier used by receipt scan
                    matching. */}
                {!customCanonicalId && customName.trim().length >= 2 && (() => {
                  const needle = customName.trim();
                  const bundled = fuzzyMatchIngredient(needle, 5, shoppingList);

                  // User-minted canonicals (Spam, Furikake, etc.) live
                  // in dbMap as admin-approved ingredient_info rows,
                  // NOT in the bundled INGREDIENTS array that
                  // fuzzyMatchIngredient searches. Mirror the merge
                  // Kitchen's autoStar does so synthetics surface in
                  // the typeahead alongside bundled canonicals.
                  const n = needle.toLowerCase();
                  const synthScored = [];
                  for (const [slug, info] of Object.entries(dbMap || {})) {
                    if (!slug || findIngredient(slug)) continue;
                    const displayOverride = info?.display_name;
                    const name = (typeof displayOverride === "string" && displayOverride.trim())
                      ? displayOverride.trim()
                      : slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                    const nameLow = name.toLowerCase();
                    const slugLow = slug.toLowerCase();
                    let score = 0;
                    if (nameLow === n || slugLow === n) score = 100;
                    else if (slugLow === n.replace(/\s+/g, "_")) score = 100;
                    else if (nameLow.startsWith(n) || slugLow.startsWith(n.replace(/\s+/g, "_"))) score = 85;
                    else if (nameLow.includes(n) || slugLow.includes(n.replace(/\s+/g, "_"))) score = 70;
                    if (score <= 0) continue;
                    synthScored.push({
                      ingredient: {
                        id: slug,
                        name,
                        emoji: info?.emoji || "✨",
                        category: info?.category || "user",
                      },
                      score,
                    });
                  }

                  const matches = [...bundled, ...synthScored]
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 5);

                  // "+ CREATE" row — always rendered so the user can
                  // mint a fresh canonical for anything the typeahead
                  // didn't surface. Exact-slug match suppresses the
                  // row so we don't show "+ CREATE prosciutto" when
                  // prosciutto is already bound / top hit.
                  const wouldSlug = slugifyIngredientName(needle);
                  const alreadyExists = matches.some(
                    m => m.ingredient.id === wouldSlug
                  );
                  const showCreate = wouldSlug && !alreadyExists;
                  if (matches.length === 0 && !showCreate) return null;
                  return (
                    <div style={{
                      marginTop: 6,
                      background: "#0a0a0a",
                      border: "1px solid #2a2a2a",
                      borderRadius: 10,
                      padding: 4,
                      display: "flex", flexDirection: "column", gap: 2,
                    }}>
                      {matches.map(m => (
                        <button
                          key={m.ingredient.id}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setCustomCanonicalId(m.ingredient.id);
                            setCustomName(m.ingredient.name || customName);
                            cascadeFromCanonical(m.ingredient);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "8px 10px",
                            background: "transparent",
                            border: "1px solid transparent",
                            color: "#f0ece4",
                            borderRadius: 8,
                            fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                            cursor: "pointer", textAlign: "left",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#141414"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ fontSize: 18, flexShrink: 0 }}>{m.ingredient.emoji || "✨"}</span>
                          <span style={{
                            flex: 1, overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {m.ingredient.name}
                          </span>
                          <span style={{
                            fontFamily: "'DM Mono',monospace", fontSize: 9,
                            color: "#555", letterSpacing: "0.08em",
                            flexShrink: 0,
                          }}>
                            TAP TO LINK
                          </span>
                        </button>
                      ))}

                      {/* + CREATE NEW CANONICAL — escape hatch when
                          the typeahead doesn't surface what the user
                          has in mind. Tap → slugify(typed) becomes
                          the new canonical id, set it on the row,
                          fire enrichment in the background (auto-
                          approves + lands in ingredient_info so
                          future users get the canonical for free).
                          Matches LinkIngredient's createNewFromQuery
                          semantics so both entry points mint
                          identical rows. */}
                      {showCreate && (
                        <button
                          key="__create"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            const id = wouldSlug;
                            setCustomCanonicalId(id);
                            setCustomName(needle);
                            // Synthesize a minimal canonical object
                            // for cascade (routing fields fall back
                            // to defaults since we don't know the
                            // category yet — enrichment will fill it).
                            cascadeFromCanonical({
                              id,
                              name: needle,
                              emoji: "✨",
                              category: "pantry",
                            });
                            // Fire-and-forget enrichment so Claude
                            // fills description/packaging/etc. behind
                            // the scenes. Mirrors
                            // LinkIngredient.createNewFromQuery.
                            if (!findIngredient(id)) {
                              enrichIngredient({ canonical_id: id })
                                .then(() => { refreshDb?.(); })
                                .catch(err => console.warn("[auto-enrich] failed for", id, err?.message));
                            }
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "8px 10px",
                            background: "transparent",
                            border: `1px dashed #f5c84244`,
                            color: "#f5c842",
                            borderRadius: 8,
                            fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                            cursor: "pointer", textAlign: "left",
                            marginTop: 4,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#1a1608"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ fontSize: 18, flexShrink: 0 }}>➕</span>
                          <span style={{
                            flex: 1, overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            Create <strong style={{ color: "#f5c842" }}>"{needle}"</strong> as a new canonical
                          </span>
                          <span style={{
                            fontFamily: "'DM Mono',monospace", fontSize: 9,
                            color: "#f5c842", letterSpacing: "0.08em",
                            flexShrink: 0,
                          }}>
                            TAP TO CREATE
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* + LINK CANONICAL removed — the typeahead above
                    already shows matching canonicals AND a "+ CREATE"
                    row for fresh slugs, so a duplicate below-header
                    affordance just added noise. User is already
                    performing the link via the typeahead. */}

              {/* Identity stack — per CLAUDE.md (updated). Row order:
                    1. HEADER (brand + canonical) — ABOVE this block
                    2. CATEGORIES  — orange
                    3. STORED IN   — blue
                    4. STATE       — purple
                    5. INGREDIENTS — yellow

                  Progressive color cascade: each row stays GREY until
                  either its predecessor is set OR the field itself
                  has been auto-filled. The second half matters —
                  canonical binding often cascades straight into
                  stored-in + location via cascadeFromCanonical, so
                  stored-in gets a value without the user ever
                  touching CATEGORY. Auto-filled values surface in
                  their own color to signal "this was linked from
                  the canonical" (per user directive: "if they auto
                  fill make sure to fill their color as well to
                  signify linkage"). Cascade order stays
                  canonical → (brand, optional) → category →
                  stored-in → state → ingredients. */}
              {(() => {
                const DISABLED_CLR = "#3a3a3a";
                const hasCan  = !!customCanonicalId;
                const hasCat  = !!customTypeId;
                const hasTile = !!customTileId;
                const hasSt   = !!customState;
                const hasIng  = (customComponents?.length || 0) > 0;
                // Color = axis color when (predecessor met) OR (self
                // already filled). The self-filled arm handles
                // auto-fills, which can skip steps — a tile bound by
                // cascadeFromCanonical stays blue even if the user
                // hasn't picked a CATEGORY above it.
                const colCat  = (hasCan  || hasCat)  ? "#e07a3a" : DISABLED_CLR;
                const colTile = (hasCat  || hasTile) ? "#7eb8d4" : DISABLED_CLR;
                const colSt   = (hasTile || hasSt)   ? "#c7a8d4" : DISABLED_CLR;
                const colIng  = (hasSt   || hasIng)  ? "#f5c842" : DISABLED_CLR;
                // Row is tappable when its color is live (colored,
                // not DISABLED_CLR). Any filled field is always
                // editable.
                const liveCat  = (hasCan  || hasCat);
                const liveTile = (hasCat  || hasTile);
                const liveSt   = (hasTile || hasSt);
                const liveIng  = (hasSt   || hasIng);
                const canClick = (enabled) => enabled ? "pointer" : "not-allowed";
                return (
                  <>
                    {/* FOOD CATEGORY — orange when canonical set OR
                        already filled; else grey. */}
                    <div
                      onClick={() => liveCat && setTypePickerOpen(v => !v)}
                      style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: colCat,
                        letterSpacing: "0.08em", marginTop: 3,
                        cursor: canClick(liveCat),
                        display: "flex", alignItems: "center", gap: 6,
                        opacity: liveCat ? 1 : 0.65,
                      }}
                    >
                      <span style={{ color: colCat }}>{LABEL_KICKER("category")}:</span>
                      {customTypeId ? (
                        <>
                          <span style={{ fontSize: 12 }}>{findFoodType(customTypeId)?.emoji || "🏷️"}</span>
                          <span style={{ color: colCat, borderBottom: `1px dashed ${colCat}44` }}>
                            {(findFoodType(customTypeId)?.label || "Custom").toUpperCase()}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: colCat, borderBottom: `1px dashed ${colCat}44` }}>
                          + SET CATEGORY
                        </span>
                      )}
                    </div>

                    {/* STORED IN — blue when category set OR already
                        filled (common via auto-cascade); else grey. */}
                    <div
                      onClick={() => liveTile && setTilePickerOpen(v => !v)}
                      style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: colTile,
                        letterSpacing: "0.08em", marginTop: 3,
                        cursor: canClick(liveTile),
                        display: "flex", alignItems: "center", gap: 6,
                        opacity: liveTile ? 1 : 0.65,
                      }}
                    >
                      <span style={{ color: colTile }}>{LABEL_KICKER("storedIn")}:</span>
                      {customTileId ? (() => {
                        const allBuiltIns = [...FRIDGE_TILES, ...PANTRY_TILES, ...FREEZER_TILES];
                        const found = allBuiltIns.find(t => t.id === customTileId);
                        return (
                          <>
                            <span style={{ fontSize: 12 }}>{found?.emoji || "🗂️"}</span>
                            <span style={{ color: colTile, borderBottom: `1px dashed ${colTile}44` }}>
                              {(found?.label || "CUSTOM TILE").toUpperCase()}
                            </span>
                          </>
                        );
                      })() : (
                        <span style={{ color: colTile, borderBottom: `1px dashed ${colTile}44` }}>
                          + SET LOCATION
                        </span>
                      )}
                    </div>

                    {/* STATE — purple when stored-in set OR already
                        filled; else grey. */}
                    <div
                      onClick={() => liveSt && setStatePickerOpen(v => !v)}
                      style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: colSt,
                        letterSpacing: "0.08em", marginTop: 3,
                        cursor: canClick(liveSt),
                        display: "flex", alignItems: "center", gap: 6,
                        opacity: liveSt ? 1 : 0.65,
                      }}
                    >
                      <span style={{ color: colSt }}>{LABEL_KICKER("state")}:</span>
                      {customState ? (
                        <span style={{ color: colSt, borderBottom: `1px dashed ${colSt}44` }}>
                          {customState.toUpperCase()}
                        </span>
                      ) : (
                        <span style={{ color: colSt, borderBottom: `1px dashed ${colSt}44` }}>
                          + SET STATE
                        </span>
                      )}
                    </div>

                    {/* INGREDIENTS — yellow when state set OR
                        already filled; else grey. Composition tags
                        (multi-tag items). */}
                    <div
                      onClick={() => liveIng && setCustomComponentsOpen(true)}
                      style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: colIng,
                        letterSpacing: "0.08em", marginTop: 3,
                        cursor: canClick(liveIng),
                        display: "flex", alignItems: "center", gap: 6,
                        flexWrap: "wrap",
                        opacity: liveIng ? 1 : 0.65,
                      }}
                    >
                      <span style={{ color: colIng }}>{LABEL_KICKER("ingredients")}:</span>
                      {customComponents.length === 0 ? (
                        <span style={{ color: colIng, borderBottom: `1px dashed ${colIng}44` }}>
                          + ADD
                        </span>
                      ) : (
                        <>
                          {customComponents.slice(0, 4).map((c, i) => (
                            <span key={c.id} style={{ color: colIng, borderBottom: `1px dashed ${colIng}44` }}>
                              {i > 0 && <span style={{ color: "#444", marginRight: 4 }}>·</span>}
                              {(c.canonical?.name || c.id).toUpperCase()}
                            </span>
                          ))}
                          {customComponents.length > 4 && (
                            <span style={{ color: "#888" }}>+{customComponents.length - 4}</span>
                          )}
                        </>
                      )}
                    </div>
                  </>
                );
              })()}

              {/* Typeahead suggestion dropdown REMOVED. It used to fan
                  out template + canonical substring matches below the
                  name input, but it was a firehose — showing 10+
                  cheese canonicals when the user typed "f" buries
                  the signal. Per user: "item names are the most
                  throw-away thing we have." Canonical binding now
                  happens via the explicit CANONICAL tap line which
                  opens LinkIngredient (targeted picker, not
                  dump-everything). Free-text name still lands as-is
                  if the user doesn't bind a canonical. The original
                  dropdown JSX below is kept as a short-circuited
                  no-op so the surrounding closure + braces still
                  balance; it renders nothing. */}
              {(() => {
                return null;
                // eslint-disable-next-line no-unreachable
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
            </div>

            {/* State picker — inline when STATE tap line is tapped.
                States are ingredient-specific; show options when the
                name resolves to a canonical, otherwise explain. */}
            {statePickerOpen && (() => {
              const derived = customCanonicalId
                || inferCanonicalFromName(customName.trim())
                || canonicalIdForType(customTypeId);
              // Synthesize a tiny item so statesForItem can fall back
              // to the food-category hub when the derived canonical
              // has no states of its own (e.g. brand-new pork slug).
              const states = statesForItem({
                canonicalId: derived,
                ingredientId: derived,
                typeId: customTypeId,
              }) || [];
              return (
                <div style={{ padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10, marginBottom: 14 }}>
                  {states.length === 0 ? (
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", fontStyle: "italic", lineHeight: 1.5 }}>
                      Pick a Food Category or type a name that matches a canonical ingredient first — states depend on what the item IS.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {states.map(s => (
                        <button
                          key={s}
                          onClick={() => { setCustomState(s); setStatePickerOpen(false); }}
                          style={{
                            padding: "6px 10px",
                            background: customState === s ? "#1a1322" : "transparent",
                            border: `1px solid ${customState === s ? "#c7a8d4" : "#2a2a2a"}`,
                            color: customState === s ? "#c7a8d4" : "#aaa",
                            borderRadius: 16, cursor: "pointer",
                            fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.08em",
                          }}
                        >
                          {stateLabel(s).toUpperCase()}
                        </button>
                      ))}
                      {customState && (
                        <button
                          onClick={() => { setCustomState(null); setStatePickerOpen(false); }}
                          style={{
                            padding: "6px 10px",
                            background: "transparent",
                            border: "1px solid #3a2f10",
                            color: "#d98a8a",
                            borderRadius: 16, cursor: "pointer",
                            fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.08em",
                          }}
                        >
                          ✕ CLEAR
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 3-col grid — PACKAGE SIZE | LOCATION | EXPIRES.
                Mirrors ItemCard exactly. PACKAGE SIZE is the compact
                setup control (set once, rarely changes). QUANTITY
                is the big slider-driven section below (changes
                constantly as the user eats through the package). */}
            {(() => {
              const gridPkgN   = parseFloat(packageSize);
              const gridHasPkg = Number.isFinite(gridPkgN) && gridPkgN > 0;
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
                  {/* PACKAGE SIZE tile — stacked input + unit input
                      so the number has room in the narrow column. */}
                  <div style={{
                    padding: "10px 12px",
                    background: "#0f0f0f",
                    border: "1px solid #1e1e1e",
                    borderRadius: 10,
                  }}>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>
                      PACKAGE SIZE
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0" step="any"
                        value={packageSize}
                        onChange={e => {
                          const v = e.target.value;
                          setPackageSize(v);
                          // Auto-fill QUANTITY to match a freshly
                          // declared package — sealed at 100%. Only
                          // fires when amount is empty or was equal
                          // to the old packageSize (sealed carry-
                          // over). Mid-package values stay put.
                          const n = parseFloat(v);
                          if (!Number.isFinite(n) || n <= 0) return;
                          const amtN = parseFloat(amount);
                          const prevN = parseFloat(packageSize);
                          const wasSealed = Number.isFinite(amtN) && Number.isFinite(prevN) && amtN === prevN;
                          if (amount === "" || !Number.isFinite(amtN) || wasSealed) {
                            setAmount(String(n));
                          }
                        }}
                        placeholder="tap to set"
                        style={{
                          width: "100%",
                          padding: "5px 8px",
                          background: "#0a0a0a",
                          border: `1px solid ${gridHasPkg ? "#f5c842" : "#2a2a2a"}`,
                          color: gridHasPkg ? "#f5c842" : "#888",
                          borderRadius: 6,
                          fontFamily: "'DM Mono',monospace", fontSize: 14,
                          fontWeight: 500,
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                      {/* Unit dropdown — derived from the bound
                          canonical's units ladder when set, else
                          inferred from emoji+category via the
                          existing inferUnitsForScanned helper. No
                          more free-text typing: vinegar → fl_oz /
                          bottle / ml; milk → gallon / quart / pint /
                          cup; meat → lb / oz / kg. Auto-pre-selects
                          the canonical's defaultUnit on bind so the
                          user just picks PACKAGE SIZE number and
                          saves. Falls through to a free-text input
                          only when the user picks "+ custom…" for
                          an off-ladder unit (pack, wheel, sleeve). */}
                      {(() => {
                        // Units derived from CATEGORY, not the
                        // canonical's bespoke ladder. Per user
                        // directive: "measurements based on
                        // category. Cause vinegars are probably
                        // gonna be fl oz." inferUnitsForScanned
                        // reads emoji + category and returns a
                        // category-appropriate ladder (cheese,
                        // dairy liquid, meat, bread, dry weight,
                        // etc.). Bound canonical contributes its
                        // emoji + category to the inference but
                        // its own per-ingredient units[] is
                        // intentionally NOT consulted — the unit
                        // set should stay consistent within a
                        // category so the user always sees the
                        // same options for similar items.
                        const canon = customCanonicalId ? findIngredient(customCanonicalId) : null;
                        const { units } = inferUnitsForScanned({
                          emoji: canon?.emoji || "",
                          category: canon?.category || customCategory || "pantry",
                          unit: customUnit,
                        });
                        const hasCurrent = units.some(u => u.id === customUnit);
                        const opts = hasCurrent
                          ? units
                          : customUnit
                            ? [{ id: customUnit, label: customUnit, toBase: 1 }, ...units]
                            : units;
                        return (
                          <select
                            value={customUnit || ""}
                            onChange={e => {
                              if (e.target.value === "__custom") {
                                const typed = window.prompt("Custom unit (pack, wheel, sleeve, …):");
                                const v = (typed || "").trim();
                                if (v) setCustomUnit(v);
                                return;
                              }
                              setCustomUnit(e.target.value);
                            }}
                            style={{
                              width: "100%",
                              padding: "4px 22px 4px 8px",
                              background: "#0a0a0a",
                              border: `1px solid ${customUnit ? "#f5c842" : "#2a2a2a"}`,
                              color: customUnit ? "#f5c842" : "#888",
                              borderRadius: 6,
                              fontFamily: "'DM Mono',monospace", fontSize: 11, outline: "none",
                              boxSizing: "border-box",
                              cursor: "pointer",
                              appearance: "none",
                              WebkitAppearance: "none",
                              MozAppearance: "none",
                              backgroundImage: "linear-gradient(45deg, transparent 50%, #888 50%), linear-gradient(135deg, #888 50%, transparent 50%)",
                              backgroundPosition: "calc(100% - 12px) 50%, calc(100% - 7px) 50%",
                              backgroundSize: "5px 5px, 5px 5px",
                              backgroundRepeat: "no-repeat",
                            }}
                          >
                            {!customUnit && <option value="" style={{ background: "#141414" }}>unit…</option>}
                            {opts.map(u => (
                              <option key={u.id} value={u.id} style={{ background: "#141414" }}>{u.label || u.id}</option>
                            ))}
                            <option value="__custom" style={{ background: "#141414", color: "#7eb8d4" }}>+ custom…</option>
                          </select>
                        );
                      })()}
                    </div>
                  </div>

              <div style={{ padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>LOCATION</div>
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  {[
                    { id: "fridge",  emoji: "🧊" },
                    { id: "pantry",  emoji: "🥫" },
                    { id: "freezer", emoji: "❄️" },
                  ].map(l => (
                    <button
                      key={l.id}
                      onClick={() => {
                        setCustomLocation(l.id);
                        // Mirror into customCategory so the existing save
                        // path (which writes `category`) doesn't regress:
                        //   fridge → dairy (most common fridge item),
                        //   pantry → pantry, freezer → frozen
                        setCustomCategory(l.id === "fridge" ? "dairy" : l.id === "freezer" ? "frozen" : "pantry");
                      }}
                      aria-label={l.id}
                      style={{
                        flex: 1, padding: "4px 0",
                        background: customLocation === l.id ? "#1a1608" : "transparent",
                        border: `1px solid ${customLocation === l.id ? "#f5c842" : "#2a2a2a"}`,
                        color: customLocation === l.id ? "#f5c842" : "#888",
                        borderRadius: 6, cursor: "pointer",
                        fontSize: 16, lineHeight: 1,
                      }}
                    >
                      {l.emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10 }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em" }}>EXPIRES</div>
                <input
                  type="date"
                  value={customExpiresAt ? new Date(customExpiresAt).toISOString().slice(0, 10) : ""}
                  onChange={e => {
                    const v = e.target.value;
                    setCustomExpiresAt(v ? new Date(`${v}T12:00:00Z`) : null);
                  }}
                  style={{
                    width: "100%",
                    background: "transparent", border: "none", outline: "none",
                    fontFamily: "'DM Mono',monospace", fontSize: customExpiresAt ? 12 : 11,
                    color: customExpiresAt ? "#f0ece4" : "#666",
                    padding: "4px 0 0", marginTop: 0,
                  }}
                />
              </div>
                </div>
              );
            })()}

            {/* PACKAGE — top-level section (no longer buried in
                QUANTITY). Defines what 100% means for this row's
                gauge; pairs with QUANTITY ("how much" I'm adding
                right now) as orthogonal concepts. Per-item value
                writes straight to pantry_items.max on save, no
                admin approval. Suggestion chips are observation-
                learned (popular_package_sizes RPC, migration 0063)
                keyed on (brand, canonical) so Barilla Penne's 16oz
                bubbles up separately from generic-penne aggregates.
                Free-text PACKAGE SIZE input accepts any value the
                user types. */}
            {/* QUANTITY — big slider-driven section. Swapped into
                where the old PACKAGE SIZE big block lived (mirroring
                the ItemCard swap). PACKAGE SIZE is now the compact
                setup tile in the grid above; QUANTITY gets the
                prominent slider + input + status + chips. */}
            {(() => {
              const sizes       = popularPackages.rows || [];
              const pkgN        = parseFloat(packageSize);
              const hasPkg      = Number.isFinite(pkgN) && pkgN > 0;
              const amtN        = parseFloat(amount);
              const hasAmt      = Number.isFinite(amtN) && amtN >= 0;
              const maxVal      = hasPkg ? pkgN : 0;
              const ratio       = hasPkg && hasAmt ? Math.min(1, amtN / maxVal) : 0;
              const sliderColor = ratio <= 0.25 ? "#ef4444" : ratio <= 0.5 ? "#f59e0b" : "#7ec87e";
              const step        = maxVal <= 10 ? 0.1 : maxVal <= 100 ? 1 : maxVal / 100;
              const pct         = Math.round(ratio * 100);
              const sealed      = hasPkg && hasAmt && amtN === maxVal;
              const opened      = hasPkg && hasAmt && amtN > 0 && amtN < maxVal;
              const overflowed  = hasPkg && hasAmt && amtN > maxVal;
              return (
                <div style={{
                  padding: "14px 16px", marginBottom: 14,
                  background: "#0f0f0f", border: "1px solid #1e1e1e",
                  borderRadius: 10,
                }}>
                  {/* Header: label + SEALED/OPENED badge + status */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                    <div style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      color: "#f5c842", letterSpacing: "0.08em",
                    }}>
                      QUANTITY
                    </div>
                    {sealed && (
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: "#7ec87e", letterSpacing: "0.08em",
                      }}>
                        ● SEALED
                      </div>
                    )}
                    {opened && (
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: "#f59e0b", letterSpacing: "0.08em",
                      }}>
                        ◐ OPENED
                      </div>
                    )}
                    <div style={{
                      fontFamily: "'DM Sans',sans-serif", fontSize: 11,
                      color: overflowed ? "#ef4444" : "#888",
                    }}>
                      {!hasPkg
                        ? "set PACKAGE SIZE above to enable the slider"
                        : overflowed
                          ? `${amtN} exceeds package (${maxVal}) — raise PACKAGE SIZE or lower QUANTITY`
                          : sealed
                            ? `${maxVal} ${customUnit || ""} · full`
                            : `${amtN} of ${maxVal} left · ${pct}%`}
                    </div>
                  </div>

                  {/* Primary input — big number + static unit */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "10px 12px",
                    background: "#0a0a0a",
                    border: `1px solid ${sealed ? "#7ec87e55" : opened ? "#f59e0b55" : "#3a3a3a"}`,
                    borderRadius: 8,
                    marginBottom: hasPkg ? 10 : (sizes.length > 0 ? 10 : 0),
                    opacity: hasPkg ? 1 : 0.55,
                  }}>
                    <input
                      type="number" inputMode="decimal" min="0" step="any"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder={hasPkg ? "how much is left" : "set PACKAGE SIZE first"}
                      disabled={!hasPkg}
                      style={{
                        flex: 1, minWidth: 0,
                        background: "transparent", border: "none", outline: "none",
                        color: "#f5c842",
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 20, fontWeight: 500,
                        padding: 0,
                        cursor: hasPkg ? "text" : "not-allowed",
                      }}
                    />
                    <span style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 14,
                      color: "#aaa", flexShrink: 0,
                    }}>
                      {customUnit || "—"}
                    </span>
                  </div>

                  {/* Slider — drag-to-estimate how much is left. Only
                      renders when a package size is declared. */}
                  {hasPkg && (
                    <input
                      type="range"
                      min="0" max={maxVal} step={step}
                      value={Number.isFinite(amtN) ? amtN : 0}
                      onChange={e => setAmount(String(Number(e.target.value)))}
                      aria-label="Estimate remaining"
                      style={{ width: "100%", accentColor: sliderColor, marginBottom: sizes.length > 0 ? 10 : 0 }}
                    />
                  )}

                  {/* OTHERS USE chips — tap fills PACKAGE SIZE + unit
                      + QUANTITY together (fresh sealed package at
                      100%). Source: popular_package_sizes RPC with
                      Tier 3 AI fallback. */}
                  {sizes.length > 0 && (
                    <div>
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 9,
                        color: "#666", letterSpacing: "0.08em", marginBottom: 6,
                      }}>
                        OTHERS USE THIS SIZE
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {sizes.map((s, i) => {
                          const active = Number(s.amount) === Number(packageSize)
                            && (s.unit || "") === (customUnit || "");
                          return (
                            <button
                              key={`${s.amount}-${s.unit}-${s.brand || "_"}-${i}`}
                              onClick={() => {
                                // Chip tap = "open a fresh package of
                                // this size." Fills PACKAGE SIZE + unit
                                // and sets QUANTITY to match so the
                                // row lands sealed at 100%.
                                setPackageSize(String(s.amount));
                                if (s.unit) setCustomUnit(s.unit);
                                setAmount(String(s.amount));
                              }}
                              style={{
                                padding: "4px 10px",
                                background: active ? "#1a1608" : "transparent",
                                border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                                color: active ? "#f5c842" : "#bbb",
                                borderRadius: 14,
                                fontFamily: "'DM Mono',monospace", fontSize: 10,
                                letterSpacing: "0.04em", cursor: "pointer", whiteSpace: "nowrap",
                              }}
                            >
                              {s.amount} {s.unit}
                              {s.brand ? <span style={{ color: "#7eb8d4", marginLeft: 4 }}>· {s.brand}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* STACKING — how many identical packages the save
                creates as sibling rows (the render layer groups
                them into one stacked card). Also moved out of
                QUANTITY — this is a different axis from "how much
                is in one package." */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 14px", marginBottom: 14,
              background: "#0f0f0f", border: "1px solid #1e1e1e",
              borderRadius: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  color: instanceCount > 1 ? "#f5c842" : "#888",
                  letterSpacing: "0.08em",
                }}>
                  STACKING
                </div>
                <div style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 11,
                  color: "#888", marginTop: 2,
                }}>
                  {instanceCount > 1
                    ? `Adding ×${instanceCount} identical packages as sibling rows`
                    : "Adding 1 package — tap + to add multiple (Costco run)"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => setInstanceCount(n => Math.max(1, n - 1))}
                  disabled={instanceCount <= 1}
                  aria-label="decrement packages"
                  style={{
                    width: 28, height: 28,
                    background: "transparent",
                    border: "1px solid #2a2a2a",
                    color: instanceCount <= 1 ? "#333" : "#bbb",
                    borderRadius: 6,
                    cursor: instanceCount <= 1 ? "not-allowed" : "pointer",
                    fontFamily: "'DM Mono',monospace", fontSize: 14,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    lineHeight: 1, padding: 0,
                  }}
                >−</button>
                <div style={{
                  minWidth: 32, padding: "0 6px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'DM Mono',monospace", fontSize: 12,
                  color: instanceCount > 1 ? "#f5c842" : "#aaa",
                }}>
                  ×{instanceCount}
                </div>
                <button
                  onClick={() => setInstanceCount(n => n + 1)}
                  aria-label="increment packages"
                  style={{
                    width: 28, height: 28,
                    background: "transparent",
                    border: "1px solid #2a2a2a",
                    color: "#bbb",
                    borderRadius: 6, cursor: "pointer",
                    fontFamily: "'DM Mono',monospace", fontSize: 14,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    lineHeight: 1, padding: 0,
                  }}
                >+</button>
              </div>
            </div>

            {/* FOOD CATEGORY + STORED IN pickers — wrapped in
                ModalSheet so they present as dimmed-backdrop overlays
                that pop up at eye-level instead of rendering inline
                at the bottom of the modal (where the user couldn't
                tell focus had moved and scrolled-off content was
                hidden). Mirrors the exact pattern used for the
                scan-confirm row pickers (Kitchen.jsx ~line 1476 and
                ~1515) so the interaction feels consistent across the
                two surfaces. Headline + purpose line above each
                picker tells the user why they're here and where to
                start typing. */}
            {typePickerOpen && (
              <ModalSheet onClose={() => setTypePickerOpen(false)} maxHeight="86vh">
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#e07a3a", letterSpacing:"0.12em", marginBottom:10 }}>
                  CATEGORY
                </div>
                <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontStyle:"italic", color:"#f0ece4", fontWeight:400, margin:"0 0 6px", lineHeight:1.2 }}>
                  What category does {customName.trim() || "this item"} belong to?
                </h2>
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#888", lineHeight:1.5, margin:"0 0 14px" }}>
                  Category drives the state picker (sliced / ground / whole / ...) and the default tile — pick the one that best matches.
                </p>
                <TypePicker
                  userId={userId}
                  selectedTypeId={customTypeId}
                  // Bound canonical is the authority when it exists —
                  // "Cheddar" canonical starrs wweia_cheese even if the
                  // user's typed name doesn't contain the word. Falls
                  // back to name-alias inference for free-text rows.
                  suggestedTypeId={
                    typeIdForCanonical(customCanonicalId ? findIngredient(customCanonicalId) : null)
                    || inferFoodTypeFromName(customName)
                  }
                  onPick={(typeId, defaultTileId, defaultLocation) => {
                    setCustomTypeId(typeId);
                    if (defaultTileId && !customTileId) setCustomTileId(defaultTileId);
                    if (defaultLocation && !customLocation) setCustomLocation(defaultLocation);
                    // Canonical stays untouched on a Food Category pick.
                    // Category is the broad classification (Pasta),
                    // canonical is the specific identity (Cavatappi) —
                    // orthogonal. User picks canonical explicitly via
                    // the CANONICAL tap line / picker, or name match
                    // derives it at save time.
                    setTypePickerOpen(false);
                  }}
                />
              </ModalSheet>
            )}

            {tilePickerOpen && (
              <ModalSheet onClose={() => setTilePickerOpen(false)} maxHeight="86vh">
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#7eb8d4", letterSpacing:"0.12em", marginBottom:10 }}>
                  STORED IN
                </div>
                <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontStyle:"italic", color:"#f0ece4", fontWeight:400, margin:"0 0 14px", lineHeight:1.2 }}>
                  Where does {customName.trim() || "this item"} live?
                </h2>
                <IdentifiedAsPicker
                  userId={userId}
                  locationHint={customLocation}
                  selectedTileId={customTileId}
                  suggestedTileId={inferTileFromName(customName)}
                  onPick={(tileId, location) => {
                    setCustomTileId(tileId);
                    if (location) setCustomLocation(location);
                    setTilePickerOpen(false);
                  }}
                />
              </ModalSheet>
            )}

        <div style={{ display:"flex", gap:10 }}>
          <button onClick={attemptClose} style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, color:"#666", cursor:"pointer", letterSpacing:"0.08em" }}>CANCEL</button>
          <button
            onClick={save}
            // Button stays tappable even when required fields are
            // missing — tapping surfaces the reminder panel instead
            // of being a dead pixel. The color still communicates
            // the state (yellow = ready; red-tinted = something's
            // missing; grey = no name typed yet so nothing to save).
            style={{
              flex:2, padding:"14px",
              background: canSave
                ? "#f5c842"
                : (hasName ? "#3a1a1a" : "#1a1a1a"),
              border:"none", borderRadius:12,
              fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600,
              color: canSave ? "#111" : (hasName ? "#f0d4d4" : "#444"),
              cursor: hasName ? "pointer" : "not-allowed",
              letterSpacing:"0.08em",
            }}
          >
            {canSave ? "ADD →" : (hasName ? `FIX ${missing.length} FIELD${missing.length === 1 ? "" : "S"}` : "ADD →")}
          </button>
        </div>
        </>
    </ModalSheet>

    {/* Full-screen outcome overlay — validation warning, save
        success, or exit warning. Sibling of ModalSheet so its fixed
        positioning isn't trapped by the sheet's transform, and so
        the backdrop covers the whole viewport including the nav. */}
    {outcome && outcome.kind === "warning" && (() => {
      const fields = [];
      if (!hasName)      fields.push({ emoji: "📝", label: LABEL_KICKER("name"),      body: LABELS.name.help });
      if (!hasAmount)    fields.push({ emoji: "🔢", label: LABEL_KICKER("quantity"),  body: LABELS.quantity.help });
      if (!hasUnit)      fields.push({ emoji: "📏", label: LABEL_KICKER("unit"),      body: LABELS.unit.help });
      if (!hasCanonical) fields.push({ emoji: "✨", label: LABEL_KICKER("canonical"), body: LABELS.canonical.help });
      if (!hasCategory)  fields.push({ emoji: "🧩", label: LABEL_KICKER("category"),  body: LABELS.category.help });
      if (!hasTile)      fields.push({ emoji: "🗂️", label: LABEL_KICKER("storedIn"),  body: LABELS.storedIn.help });
      if (!hasLocation)  fields.push({ emoji: "📍", label: LABEL_KICKER("location"),  body: LABELS.location.help });
      return (
        <AddItemOutcome
          kind="warning"
          title="A few fields still need your attention"
          body="Every item in your kitchen needs these so we can route it to the right tile, give it the right state options, and find it again later. Quick fixes below."
          fields={fields}
          primary={{
            label: "GOT IT · FIX THESE",
            tone: "confirm",
            onClick: () => setOutcome(null),
          }}
        />
      );
    })()}
    {outcome && outcome.kind === "success" && (() => {
      const dest = outcome.tileLabel
        ? `${outcome.locationLabel} → ${outcome.tileLabel}`
        : outcome.locationLabel;
      return (
        <AddItemOutcome
          kind="success"
          title={`${outcome.item.name} is in your kitchen`}
          body="We'll track its expiration, its state, and its location from here. Swipe into the tab below to find it."
          destination={dest}
          primary={{
            label: "DONE",
            tone: "confirm",
            onClick: () => { setOutcome(null); onClose?.(); },
          }}
        />
      );
    })()}
    {outcome && outcome.kind === "exit_warning" && (() => {
      const fields = [];
      if (!hasName)      fields.push({ emoji: "📝", label: LABEL_KICKER("name"),      body: LABELS.name.help });
      if (!hasCanonical) fields.push({ emoji: "✨", label: LABEL_KICKER("canonical"), body: LABELS.canonical.help });
      if (!hasCategory)  fields.push({ emoji: "🧩", label: LABEL_KICKER("category"),  body: LABELS.category.help });
      if (!hasTile)      fields.push({ emoji: "🗂️", label: LABEL_KICKER("storedIn"),  body: LABELS.storedIn.help });
      if (!hasLocation)  fields.push({ emoji: "📍", label: LABEL_KICKER("location"),  body: LABELS.location.help });
      if (!hasAmount || !hasUnit) fields.push({
        emoji: "🔢",
        label: `${LABEL_KICKER("quantity")} + ${LABEL_KICKER("unit")}`,
        body: "Without these we can't track restocking or tell you when you're running low.",
      });
      return (
        <AddItemOutcome
          kind="exit_warning"
          title="Hold on — this item isn't ready yet"
          body="Leaving now drops everything you've typed. Each field shapes how this item behaves in the app — here's what you'd be skipping."
          fields={fields}
          primary={{
            label: "KEEP EDITING",
            tone: "confirm",
            onClick: () => setOutcome(null),
          }}
          secondary={{
            label: "DISCARD AND CLOSE",
            onClick: () => { setOutcome(null); onClose?.(); },
          }}
        />
      );
    })()}

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

    {/* CANONICAL picker — single-select sibling of the components
        sheet. Seeds from the currently-picked customCanonicalId so
        re-opening shows the current identity; "+ CREATE <query>"
        inside LinkIngredient single mode commits + closes on tap. */}
    {customCanonicalOpen && (
      <LinkIngredient
        item={{
          name: customName.trim() || "(new custom item)",
          emoji: "🥫",
          ingredientIds: customCanonicalId ? [customCanonicalId] : [],
        }}
        mode="single"
        onLink={(ids, extra) => {
          // Empty array = CLEAR CANONICAL. Otherwise single id.
          const nextId = ids[0] || null;
          setCustomCanonicalId(nextId);
          setCustomCanonicalOpen(false);
          // Routing cascade — picking a canonical like `mozzarella`
          // implies a category (dairy) and a default stored-in tile
          // (cheese / fridge). Mirrors what the TypePicker already
          // does for category picks. User-created canonicals aren't
          // in the registry (findIngredient returns null); for those
          // we fall back to the hub declared via `extra.parentId`
          // from the create flow — the hub's category + default tile
          // then flow through the same classifier. No-op when we
          // can't resolve either (rare; only when a user creates a
          // canonical without picking a parent hub).
          if (nextId) {
            let canon = findIngredient(nextId);
            if (!canon && extra?.parentId) {
              const hub = findIngredient(extra.parentId);
              if (hub) canon = { id: nextId, category: hub.category, parentId: hub.id };
            }
            if (canon) cascadeFromCanonical(canon);
          }
          // Admin auto-approve on packaging / parentId writes was
          // retired alongside the PackagingStep removal. Package
          // sizes now come from the observation corpus
          // (popular_package_sizes RPC); parentId hub assignment
          // moves to a separate flow if needed. Empty creations
          // still leave ingredient_info untouched — the
          // canonical_id on the pantry row is enough for identity.
        }}
        onClose={() => setCustomCanonicalOpen(false)}
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
export default function Kitchen({ userId, pantry, setPantry, shoppingList, setShoppingList, familyIds = [], view = "stock", setView, deepLink, onDeepLinkConsumed, pendingPantryAction, onPendingActionConsumed }) {
  const [scanning, setScanning] = useState(false);
  // Admin bypass — viewer's role drives auto-approval on canonical
  // creation and hides the PENDING badge. Same signal Scanner reads.
  const { profile } = useProfile(userId);
  const isAdmin = profile?.role === "admin";
  // dbMap exposes ingredient_info for every approved canonical. The
  // hub-grouper consults it as a third fallback so user-created
  // canonicals (gemelli, my_special_pasta) wrap into the right hub
  // when their info row carries a parentId pointer.
  const { dbMap: kitchenDbMap } = useIngredientInfo();
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
  // Kitchen-row fill slider — holds the row id whose fill-chip was
  // tapped. Expanding under the row a slim range input + chip row
  // so the user can drag to set fill without opening the full
  // ItemCard editor. Tapping the chip again or any chip commit
  // closes. Null = none open.
  const [fillEditingId, setFillEditingId] = useState(null);
  // Tapping a pantry row opens a card. Two kinds:
  //   - openItem: the full ItemCard — this specific pantry row at top + the
  //     canonical deep-dive embedded below. Primary entry point for row taps.
  //   - cardIng:  the bare IngredientCard opened from secondary places
  //     (add-item flow, hub drill-down) where there's no specific row yet.
  const [openItem, setOpenItem] = useState(null);
  const [cardIng, setCardIng] = useState(null);
  // Stack drill-down — set to a bucket ({key, items}) to open, null to
  // close. Opened by tapping a StackedItemCard; shows each physical
  // instance as its own ItemCard-ish row so the user can edit per-can
  // expiration / price / provenance.
  const [stackDrilldown, setStackDrilldown] = useState(null);
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
  // Scope check for provenance opens. A receipt is only openable if
  // the OWNER is the viewer or in family_ids. Used both by the
  // ItemCard onOpenProvenance callback and the deepLink effect below
  // so a stale notification for an ex-family receipt can't reach
  // ReceiptView at all.
  const canOpenProvenance = (ownerId) => (
    !ownerId || ownerId === userId || familyIds.includes(ownerId)
  );
  useEffect(() => {
    if (!deepLink) return;
    // Resolve the deep link against the current pantry — a receipt /
    // scan deep link is in scope iff the viewer currently owns at
    // least one pantry row pointing at it (which by construction
    // means the artifact's owner is the viewer or in family). Any
    // other deep link (stale notification, ex-family receipt id)
    // gets silently consumed with no modal.
    if (deepLink.kind === "receipt" && deepLink.id) {
      const ownerHit = pantry.find(p => p.sourceReceiptId === deepLink.id);
      if (ownerHit && canOpenProvenance(ownerHit.ownerId)) {
        setOpenReceiptId({ receiptId: deepLink.id });
      }
      onDeepLinkConsumed?.();
    } else if (deepLink.kind === "pantry_scan" && deepLink.id) {
      const ownerHit = pantry.find(p => p.sourceScanId === deepLink.id);
      if (ownerHit && canOpenProvenance(ownerHit.ownerId)) {
        setOpenReceiptId({ scanId: deepLink.id });
      }
      onDeepLinkConsumed?.();
    }
  }, [deepLink, onDeepLinkConsumed, pantry, userId, familyIds]);

  // Consume a pendingPantryAction dispatched by CreateMenu's ADD TO
  // PANTRY branch. App.jsx flips the tab to "pantry" before setting
  // the flag, so by the time this effect runs we're already the
  // active tab. Flip the corresponding modal state open, then clear
  // the flag so a re-open doesn't double-fire.
  useEffect(() => {
    if (!pendingPantryAction) return;
    if (pendingPantryAction === "scan") setScanning(true);
    else if (pendingPantryAction === "add") setAddingTo("pantry");
    onPendingActionConsumed?.();
  }, [pendingPantryAction, onPendingActionConsumed]);

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

  // Fridge / Pantry / Freezer tab. Defaults to NULL (nothing
  // pre-selected) so the landing view isn't secretly filtered to
  // the fridge — users were reading the fridge tiles as their whole
  // kitchen and missing items that lived elsewhere. `drilledTile`
  // holds the tile id the user has tapped into (null = tile grid
  // view; string = tile detail view). Switching tabs always resets
  // the drill-down.
  const [storageTab, setStorageTabRaw] = useState(null);
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

  // Low-stock surface — now stack-aware. Each entry is the HEAD row
  // of a bucket that passes isStackLow (discrete stacks compare
  // instance count, fractional stacks sum amounts), with the full
  // bucket attached via _bucket for the restock math. Rendering the
  // banner chips and addLowStockToList both iterate this list as
  // one-per-identity rather than one-per-row, so a 5-can tuna stack
  // contributes one entry, not five.
  const lowItems = useMemo(() => {
    return groupByIdentity(pantry)
      .filter(isStackLow)
      .map(b => ({ ...b.items[0], _bucket: b }));
  }, [pantry]);

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
      // Single-source hub lookup (v0.13.0). canonical_id is now the
      // authoritative identity axis — migration 0056 guarantees every
      // row carries one. Two paths to the hub:
      //
      //   1. Bundled canonical (spaghetti, penne, cavatappi) →
      //      findIngredient(canonical_id) returns a registry object
      //      with parentId baked in.
      //   2. User-created canonical (gemelli, my_special_pasta) →
      //      findIngredient returns null, but dbMap may have
      //      ingredient_info.info.parentId set by the PackagingStep
      //      PARENT GROUP picker or AdminPanel's GROUP UNDER chip.
      //
      // If both lookups miss, the item lands in the loose pile — no
      // synthetic group is invented. The ingredient_id path from
      // migration 0033 has been retired.
      let hub = hubForIngredient(findIngredient(item.canonicalId));
      if (!hub && item.canonicalId) {
        const customParentId = kitchenDbMap?.[item.canonicalId]?.parentId;
        if (customParentId) hub = findHub(customParentId);
      }
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
      // Snapshot of the scanned items at scan-confirm time. This is
      // the HISTORICAL record of what came off the receipt, distinct
      // from the live pantry rows (which get merged, decremented, and
      // deleted as the user cooks). Without this snapshot, ReceiptView
      // would only show items whose pantry rows still point back at
      // the receipt — a receipt with 23 lines reads as "4 items" once
      // you've cooked through most of them. See migration 0050.
      const scanItemsSnapshot = items.map(it => ({
        name:          it.name || null,
        rawText:       it.rawText || it.scanRaw?.raw_name || null,
        emoji:         it.emoji || null,
        amount:        typeof it.amount === "number" ? it.amount : null,
        unit:          it.unit || null,
        priceCents:    typeof it.priceCents === "number" ? it.priceCents : null,
        category:      it.category || null,
        canonicalId:   it.canonicalId || it.ingredientId || null,
        ingredientId:  it.ingredientId || null,
        ingredientIds: Array.isArray(it.ingredientIds) ? it.ingredientIds : [],
        confidence:    it.confidence || null,
        state:         it.state || null,
        typeId:        it.typeId || null,
        tileId:        it.tileId || null,
        location:      it.location || null,
      }));
      const payload = {
        user_id: userId,
        store_name: meta.store || null,
        receipt_date: safeDate,
        total_cents: typeof meta.totalCents === "number" ? meta.totalCents : null,
        item_count: items.length,
        scan_items: scanItemsSnapshot,
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
      // Same scan_items snapshot shape as receipts — historical
      // record independent of live pantry state.
      const scanItemsSnapshot = items.map(it => ({
        name:          it.name || null,
        rawText:       it.rawText || it.scanRaw?.raw_name || null,
        emoji:         it.emoji || null,
        amount:        typeof it.amount === "number" ? it.amount : null,
        unit:          it.unit || null,
        priceCents:    typeof it.priceCents === "number" ? it.priceCents : null,
        category:      it.category || null,
        canonicalId:   it.canonicalId || it.ingredientId || null,
        ingredientId:  it.ingredientId || null,
        ingredientIds: Array.isArray(it.ingredientIds) ? it.ingredientIds : [],
        confidence:    it.confidence || null,
        state:         it.state || null,
        typeId:        it.typeId || null,
        tileId:        it.tileId || null,
        location:      it.location || null,
      }));
      const { data, error } = await supabase.from("pantry_scans").insert({
        user_id: userId,
        kind: scanKind,
        item_count: items.length,
        scan_items: scanItemsSnapshot,
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
          // Most common cause: the 'scans' Storage bucket hasn't been
          // created in the dashboard yet, or 0030's write policy hasn't
          // been applied. Surface loudly — Bella's Gummy Bear was lost
          // this way before anyone noticed it was happening.
          console.warn("[scans storage] upload failed:", upErr.message);
          pushToast(`Scan photo didn't save: ${upErr.message}`, { emoji: "📷", kind: "warn", ttl: 7000 });
        } else {
          // .select() lets us count returned rows so an RLS-silently-
          // rejected UPDATE doesn't look like success. Pre-0045 on
          // pantry_scans, this was the exact trap: no error thrown,
          // zero rows updated, image_path stayed null forever.
          const { data: updated, error: pathErr } = await supabase
            .from(batchTable)
            .update({ image_path: path })
            .eq("id", batchId)
            .select("id");
          if (pathErr) {
            console.warn(`[${batchTable}] image_path update failed:`, pathErr.message);
            pushToast(`Scan saved but photo link failed: ${pathErr.message}`, { emoji: "⚠️", kind: "warn", ttl: 7000 });
          } else if (!updated || updated.length === 0) {
            console.warn(`[${batchTable}] image_path update affected 0 rows — RLS policy missing?`);
            pushToast("Scan saved but photo didn't link. Apply migration 0045.", { emoji: "⚠️", kind: "warn", ttl: 8000 });
          }
        }
      } catch (e) {
        console.warn("[scans] image upload exception:", e?.message || e);
        pushToast(`Scan photo error: ${e?.message || e}`, { emoji: "📷", kind: "warn", ttl: 7000 });
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

    // Fan out discrete-count lines with amount > 1 into N instance
    // rows BEFORE the merge loop. This makes "2 CANS TUNA" (one OCR
    // line with amount=2) behave identically to two separate lines —
    // both paths land as 2 siblings the render layer stacks. Keeps
    // the downstream merge gate simple (isDiscreteInstance only fires
    // at amount === 1).
    //
    // Every FANNED row also gets a sequential receipt_line_index —
    // the position in the flattened post-expansion output. Migration
    // 0057's partial unique index keys off (user_id, receipt_id,
    // line_index) so a re-scanned receipt collides on the second
    // insert attempt and the client shows an "already imported"
    // toast instead of double-stacking.
    const fannedItems = [];
    let receiptLineCursor = 0;
    for (const s of (items || [])) {
      const isDiscrete = s && DISCRETE_COUNT_UNITS.has(s.unit);
      const qty = Math.max(1, Math.floor(Number(s.amount) || 1));
      if (isDiscrete && qty > 1) {
        for (let k = 0; k < qty; k++) {
          fannedItems.push({
            ...s,
            amount: 1,
            receiptLineIndex: isReceiptScan ? receiptLineCursor++ : undefined,
          });
        }
      } else {
        fannedItems.push({
          ...s,
          receiptLineIndex: isReceiptScan ? receiptLineCursor++ : undefined,
        });
      }
    }

    setPantry(prev => {
      const next = prev.map(p => ({ ...p }));
      fannedItems.forEach(s => {
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
        //   1. Exact ingredientId match — gated by identity. Per
        //      CLAUDE.md the identity stack is CUSTOM NAME + CANONICAL
        //      + STATE + INGREDIENTS composition; matching only on
        //      CANONICAL would collapse "sushi nori" (nori) into
        //      "wasabi nori" (nori + wasabi) since they share the
        //      primary ingredient tag. The gate keeps genuine
        //      variants separate.
        //   2. Case-insensitive exact name match — handles scans that
        //      duplicate an un-linked free-text row.
        //   3. Fuzzy name match — when the scan has a canonical AND
        //      there's a free-text row whose name contains the canonical
        //      name or shortName (e.g., user's "Tillamook Pepper Jack"
        //      vs scan's "Pepper Jack"), merge into it. The existing
        //      ingredientId-backfill below then upgrades that free-text
        //      row to canonical. Preserves the user's custom name.
        // Every match path must pass sameIdentity — a single-canonical
        // scan (e.g. [mozzarella]) and a multi-canonical blend row
        // (e.g. [mozz, parm, asiago, fontina]) are DIFFERENT items in
        // the item-first architecture, even if names happen to coincide
        // via a template or correction.
        //
        // Discrete-count gate — scanning 50 cans of tuna should produce
        // 50 rows (one per physical can) that the render layer groups
        // into a stacked card. Only merge fractional/mass/volume scans
        // (grams, tbsp, ml, etc.) where aggregation reads more
        // naturally than 50 "1 g butter" rows. Shared definition in
        // pantryFormat so check-off + scan + manual add all agree on
        // what counts as "a physical package."
        let ex = null;
        if (!isDiscreteInstance(s)) {
          if (s.ingredientId) {
            ex = next.find(p => p.ingredientId === s.ingredientId && sameIdentity(p, s));
          }
          if (!ex) {
            const scanLow = (s.name || "").toLowerCase();
            ex = next.find(p => (p.name || "").toLowerCase() === scanLow && sameIdentity(p, s));
          }
          if (!ex && s.ingredientId) {
            const scanCanon = findIngredient(s.ingredientId);
            const needle = (scanCanon?.shortName || scanCanon?.name || "").toLowerCase().trim();
            if (needle.length >= 3) {
              ex = next.find(p => {
                if (p.ingredientId) return false;
                const n = (p.name || "").toLowerCase();
                if (!n || (!n.includes(needle) && !needle.includes(n))) return false;
                return sameIdentity(p, s);
              });
            }
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
            // Packaging intentionally undefined — scans don't ask
            // about container size. 0 = slider stays hidden
            // (hasPackage check fails); DB column is NOT NULL so
            // we can't send literal null.
            max: 0,
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
            // Brand (migration 0061) — parseIdentity peeled this off
            // the raw scan text during normalization. Conditional so
            // un-branded rows stay undefined and hit toDb's skip path.
            ...(s.brand      ? { brand: s.brand           } : {}),
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
            // Location — explicit scan-confirm choice wins. User
            // flipped strawberries to Freezer via the picker's
            // JUST-USE shortcut? `s.location` is 'freezer' and we
            // forward it; usePantry serializes to pantry_items.location
            // and effectiveLocation() honors it at render time. Only
            // the falsy case falls through to the category heuristic.
            ...(s.location ? { location: s.location } : {}),
            // Back-link to the scan artifact that created this row —
            // either a receipts row (receipt scans) or a pantry_scans
            // row (fridge/pantry/freezer scans). At most one is set.
            // Both feed ItemCard's provenance deep-link.
            ...(receiptId ? { sourceReceiptId: receiptId } : {}),
            ...(scanId    ? { sourceScanId: scanId       } : {}),
            // Dedupe position (migration 0057). Only the receipt-scan
            // path stamps this; pantry-scans + manual + cook rows
            // sail past the partial unique index with NULL.
            ...(receiptId && typeof s.receiptLineIndex === "number"
              ? { receiptLineIndex: s.receiptLineIndex }
              : {}),
          });
        }
      });
      return next;
    });

    // Close the shopping-list loop. Any confirmed scan row whose
    // canonical_id matches a still-open shopping-list entry gets
    // that entry dropped. User typed "ricotta" onto their list for
    // a recipe → scanned the receipt → ricotta's in pantry → list
    // entry removed. No duplicate tap-to-check required. Only the
    // canonical-id match path fires here — free-text list entries
    // (e.g. "organic eggs from the farmer's market") stay put so a
    // receipt that generically matches "eggs" doesn't accidentally
    // delete them.
    const scannedCanonicalIds = new Set(
      fannedItems
        .map(s => s.canonicalId || s.ingredientId)
        .filter(Boolean)
    );
    if (scannedCanonicalIds.size > 0) {
      setShoppingList(prev =>
        prev.filter(s => !(s.ingredientId && scannedCanonicalIds.has(s.ingredientId)))
      );
    }

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

  // Push low-stock items onto the shopping list. Stack-aware: for a
  // discrete stack (5 cans, threshold 8 → low), target the threshold
  // count so the shopping entry says "need 3 more." For a fractional
  // stack (or a single row), fall back to "restock to max" using
  // summed amount across the bucket. Preserves ingredientId so
  // recipes still match; de-dupes by ingredientId when possible.
  const addLowStockToList = () => {
    setShoppingList(prev => {
      const existing = new Set(prev.map(i => i.ingredientId || i.name.toLowerCase()));
      const toAdd = lowItems
        .filter(l => !existing.has(l.ingredientId || l.name.toLowerCase()))
        .map(l => {
          const bucket = l._bucket;
          const items = bucket?.items || [l];
          const isDiscrete = DISCRETE_COUNT_UNITS.has(l.unit);
          let amount;
          if (isDiscrete) {
            const target = Math.max(1, Math.ceil(Number(l.lowThreshold) || 1));
            amount = Math.max(target - items.length, 1);
          } else {
            const stacked = items.reduce((s, p) => s + (Number(p.amount) || 0), 0);
            amount = Math.max(Number(l.max) - stacked, 1);
          }
          return {
            id: crypto.randomUUID(),
            ingredientId: l.ingredientId || null,
            name: l.name,
            emoji: l.emoji,
            amount,
            unit: l.unit,
            category: l.category,
            source: "low-stock",
          };
        });
      return [...prev, ...toAdd];
    });
    setAlertDismissed(true);
  };

  // "Got it" on a shopping list item → move to pantry and remove from list.
  // Fractional items (2 tbsp butter) still merge into the open row —
  // the user wants aggregate grams, not a second butter "instance." A
  // single discrete package (1 can, 1 box) skips the merge so
  // groupByIdentity stacks it as its own physical instance at render.
  const checkOffShoppingItem = sItem => {
    setPantry(prev => {
      const ex = isDiscreteInstance(sItem)
        ? null
        : sItem.ingredientId
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
        // 0 = packaging undeclared (slider hidden). See
        // addScannedItems comment for why not null.
        max: 0,
        category: sItem.category || "pantry",
        lowThreshold: Math.max(sItem.amount * 0.25, 0.25),
      }];
    });
    setShoppingList(prev => prev.filter(i => i.id !== sItem.id));
  };

  const removeShoppingItem = id => setShoppingList(prev => prev.filter(i => i.id !== id));
  const removePantryItem = id => setPantry(prev => prev.filter(i => i.id !== id));

  // Patch a pantry row in place. No implicit field coupling — the
  // patch writes exactly the fields the caller sent, nothing else.
  //
  // We used to auto-bump `max` to `amount` whenever amount was edited
  // ("so the progress bar doesn't cap at 100% and lie"), but that
  // silently clobbered the user's declared package size. Someone
  // types amount=1000 on a 500g package and the package flips to
  // 1000 behind their back. Now amount and max move independently.
  // If amount > max, the slider saturates at 100% — that's honest:
  // the user told us the package is 500g and they have 1000g; the
  // package number is the one to fix, not amount.
  //
  // lowThreshold also dropped out of auto-recompute; it's derived at
  // add-time in AddItemModal and stays stable after unless the user
  // edits it explicitly.
  const updatePantryItem = (id, patch) => setPantry(prev => prev.map(p => {
    if (p.id !== id) return p;
    return { ...p, ...patch };
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
                {/* BRAND tag — parallel to the STATE tag below. Uses
                    neutral gray styling since brand is orthogonal to
                    the six colored identity axes per CLAUDE.md. Keeps
                    "Butter · Kerrygold" scannable at the tile-card
                    level without opening the item. Hidden when brand
                    is null (most rows). */}
                {item.brand && (
                  <span
                    title={`Brand: ${item.brand}`}
                    style={{
                      fontFamily:"'DM Mono',monospace", fontSize:9,
                      color:"#aaa",
                      background:"#161616",
                      border:"1px solid #2a2a2a",
                      borderRadius:4,
                      padding:"1px 6px",
                      letterSpacing:"0.08em",
                      flexShrink:0,
                      textTransform:"uppercase",
                    }}
                  >
                    {item.brand}
                  </span>
                )}
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
          {item.protected ? (
            <span
              aria-label="Protected — cannot be deleted"
              title="Protected keepsake — tap to edit, but the ✕ is disabled on purpose"
              style={{ color:"#e2c77a", fontSize:14, padding:4, flexShrink:0, cursor:"default" }}
            >
              🔒
            </span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setDeleteCandidate(item); }}
              aria-label={`Remove ${item.name}`}
              style={{ background:"none", border:"none", color:"#333", fontSize:16, cursor:"pointer", padding:4, flexShrink:0 }}
              onMouseOver={e => e.currentTarget.style.color = "#ef4444"}
              onMouseOut={e => e.currentTarget.style.color = "#333"}
            >
              ✕
            </button>
          )}
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
        {/* Amount bar — tap to reveal an inline slider that drags the
            row's amount from 0 to max. No separate "fill level"
            concept; just drag to where the bag / jar / container looks
            now. Live commits through updatePantryItem so the bar
            color + width update as you slide. Tap the bar again to
            close. */}
        <button
          onClick={e => { e.stopPropagation(); setFillEditingId(prev => prev === item.id ? null : item.id); }}
          aria-label={`Adjust ${item.name} amount`}
          title="Tap and slide to estimate what's left"
          style={{ width:"100%", padding:0, background:"transparent", border:"none", cursor:"pointer" }}
        >
          {(() => {
            // Segmented gauge for package-mode rows (migration 0054).
            // Each segment is one physical unit: all reserve_count
            // sealed packages render full, plus one open segment
            // partially filled by amount / packageAmount. Gives the
            // user an at-a-glance "I have 5 cans, last one half-full"
            // visual instead of a single averaged bar.
            //
            // Liquid-mode rows (packageAmount === null) fall back to
            // the original single bar — unchanged behavior.
            const pkgAmt = Number(item.packageAmount);
            const hasPkg = Number.isFinite(pkgAmt) && pkgAmt > 0;
            const reserves = Math.max(0, Number(item.reserveCount) || 0);
            if (hasPkg && reserves > 0) {
              const openRatio = Math.max(0, Math.min(1, (Number(item.amount) || 0) / pkgAmt));
              const segments = reserves + 1;
              // Tiny visual margin between segments so each reads as a
              // discrete unit rather than one continuous bar. The
              // flex layout keeps everything scale-aware for any
              // reserve count, even big ones (20 cans of rice).
              return (
                <div style={{ display:"flex", gap:2, height:4 }}>
                  {Array.from({ length: segments }).map((_, i) => {
                    const isOpen = i === segments - 1;
                    const fill = isOpen ? openRatio * 100 : 100;
                    const segColor = isOpen ? barColor(item) : "#4ade80";
                    return (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          background: "#1e1e1e",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div style={{
                          height: "100%",
                          width: `${fill}%`,
                          background: segColor,
                          boxShadow: `0 0 6px ${segColor}66`,
                          transition: "width 0.6s ease",
                        }} />
                      </div>
                    );
                  })}
                </div>
              );
            }
            // No package declared → hide the gauge. Can't display a
            // fill percent against an undefined container size.
            const fill = pct(item);
            if (fill == null) return null;
            return (
              <div style={{ height:4, background:"#1e1e1e", borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:2, width:`${fill}%`, background:barColor(item), boxShadow:`0 0 8px ${barColor(item)}66`, transition:"width 0.6s ease" }} />
              </div>
            );
          })()}
        </button>
        {fillEditingId === item.id && hasPackage(item) && (() => {
          const maxVal = Number(item.max);
          const step = maxVal <= 10 ? 0.1 : maxVal <= 100 ? 1 : maxVal / 100;
          const sliderColor = barColor(item);
          return (
            <div
              onClick={e => e.stopPropagation()}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", marginTop:8, background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:10 }}
            >
              <input
                type="range"
                min="0" max={maxVal} step={step}
                value={Number(item.amount) || 0}
                onChange={e => updatePantryItem(item.id, { amount: Number(e.target.value) })}
                aria-label={`Estimate ${item.name} remaining`}
                style={{ flex:1, accentColor: sliderColor }}
              />
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#aaa", minWidth:68, textAlign:"right" }}>
                {Number(item.amount || 0).toFixed(Number.isInteger(item.amount) ? 0 : 1)} / {maxVal.toFixed(Number.isInteger(maxVal) ? 0 : 1)}
              </span>
              <button
                onClick={() => setFillEditingId(null)}
                aria-label="Close slider"
                style={{ width:22, height:22, background:"transparent", border:"1px solid #2a2a2a", color:"#666", borderRadius:11, fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", flexShrink:0 }}
              >
                ✕
              </button>
            </div>
          );
        })()}
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
        {/* + 1 PACKAGE — single-item "start stacking" affordance. Tapping
            duplicates the row; next render groupByIdentity collapses
            the pair into a StackedItemCard with ×2 + fan. stopPropagation
            so the click doesn't also open the ItemCard modal. */}
        <div
          onClick={e => e.stopPropagation()}
          style={{ display:"flex", alignItems:"center", gap:8, paddingTop:8, marginTop:8, borderTop:"1px solid #1e1e1e" }}
        >
          <button
            onClick={() => {
              addStackInstance(setPantry, { key: item.id, items: [item] });
              pushToast(`Added 1 ${item.name}`, { emoji: item.emoji || "🛒", kind: "success", ttl: 2800 });
            }}
            aria-label={`Duplicate ${item.name} — start stacking`}
            style={{ padding:"5px 10px", background:"#1a1608", border:"1px solid #f5c84244", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.06em", cursor:"pointer" }}
          >
            + 1 PACKAGE
          </button>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.06em" }}>
            START STACKING
          </span>
        </div>
      </div>
    );
  };

  // Render a stack card — multiple pantry rows sharing identity
  // (canonical + state + composition + name). The stack is a FIRST-
  // CLASS edit surface: inline + / − buttons add / remove one physical
  // instance, tap opens the per-instance drill-down modal, ✕ deletes
  // the LIFO top. The visual is a "card fan" — two offset cards behind
  // the main one — so the stack reads as more than one thing without
  // the count badge doing all the work.
  const renderStackCard = bucket => {
    const items = bucket.items;
    const top = items[0];
    const n = items.length;
    const canon = findIngredient(top.ingredientId);
    const canonicalLabel = canon?.shortName && canon.parentId ? canon.shortName : canon?.name;
    const showCanonical = canonicalLabel && canonicalLabel.toLowerCase() !== (top.name || "").toLowerCase();
    // Stack-aware low detection: discrete-count stacks compare INSTANCE
    // COUNT against the threshold (5 cans vs a restock-at-3 rule);
    // fractional stacks sum amounts and compare against the head row's
    // lowThreshold. Legacy per-row `isLow` only read individual
    // amounts, so a stack of 1-can instances never signaled low even
    // when the user was down to the last can.
    const anyLow = isStackLow(bucket);
    const anyCritical = isStackCritical(bucket);
    const earliestExpiry = items.reduce((min, p) => {
      if (!p.expiresAt) return min;
      const d = p.expiresAt instanceof Date ? p.expiresAt : new Date(p.expiresAt);
      if (Number.isNaN(d.getTime())) return min;
      return min == null || d < min ? d : min;
    }, null);
    const earliestDays = earliestExpiry ? Math.ceil((earliestExpiry.getTime() - Date.now()) / 86400000) : null;
    const totalPriceCents = items.reduce((s, p) => s + (typeof p.priceCents === "number" ? p.priceCents : 0), 0);
    const openDrilldown = () => setStackDrilldown(bucket);
    return (
      <div key={bucket.key} style={{ position:"relative", marginBottom:4 }}>
        {/* Fan layers — two offset cards peek from behind to signal depth. */}
        <div aria-hidden style={{ position:"absolute", inset:0, transform:"translate(4px,4px)", background:"#0f0f0f", border:"1px solid #1a1a1a", borderRadius:14, pointerEvents:"none" }} />
        <div aria-hidden style={{ position:"absolute", inset:0, transform:"translate(2px,2px)", background:"#121212", border:"1px solid #1c1c1c", borderRadius:14, pointerEvents:"none" }} />
        <div
          onClick={openDrilldown}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrilldown(); } }}
          style={{ position:"relative", background:"#141414", border:`1px solid ${anyCritical?"#ef444422":anyLow?"#f59e0b22":"#1e1e1e"}`, borderRadius:14, padding:"14px 16px", cursor:"pointer" }}
        >
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
            <span style={{ fontSize:26, flexShrink:0 }}>{top.emoji}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>
                    {top.name}
                    {showCanonical && (
                      <span style={{ color:"#666", fontWeight:400 }}> · {canonicalLabel}</span>
                    )}
                  </span>
                  {top.state && (
                    <span
                      title={`State: ${stateLabel(top.state)}`}
                      style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7eb8d4", background:"#0f1620", border:"1px solid #1f3040", borderRadius:4, padding:"1px 6px", letterSpacing:"0.08em", flexShrink:0, textTransform:"uppercase" }}
                    >
                      {stateLabel(top.state)}
                    </span>
                  )}
                </span>
                <span
                  title={`${n} identical items stacked`}
                  style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#f5c842", background:"#1a1608", border:"1px solid #f5c84244", borderRadius:6, padding:"2px 8px", letterSpacing:"0.06em", flexShrink:0 }}
                >
                  ×{n}
                </span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2, flexWrap:"wrap" }}>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#444" }}>{(top.category || "").toUpperCase()}</span>
                {totalPriceCents > 0 && (
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7ec87e" }} title="Summed last-paid price across the stack">
                    {formatPrice(totalPriceCents)}
                  </span>
                )}
                {anyLow && (
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color: anyCritical?"#ef4444":"#f59e0b", background: anyCritical?"#ef444422":"#f59e0b22", padding:"1px 6px", borderRadius:4 }}>
                    {anyCritical?"ALMOST OUT":"RUNNING LOW"}
                  </span>
                )}
                {earliestDays != null && (
                  <span
                    style={{ background:`${expirationColor(earliestDays)}22`, color:expirationColor(earliestDays), fontFamily:"'DM Mono',monospace", fontSize:9, padding:"1px 6px", borderRadius:4 }}
                    title="Earliest expiration in the stack"
                  >
                    ⏳ {formatDaysUntil(earliestDays)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* Stack-level controls. Stop propagation so the buttons don't
              trigger the drilldown. */}
          <div
            onClick={e => e.stopPropagation()}
            style={{ display:"flex", alignItems:"center", gap:8, paddingTop:8, borderTop:"1px solid #1e1e1e" }}
          >
            <button
              onClick={() => {
                removeStackInstance(setPantry, bucket, "lifo");
                pushToast(`Removed 1 ${top.name}`, { emoji: top.emoji || "🗑", kind: "info", ttl: 2800 });
              }}
              aria-label={`Remove one ${top.name} from the stack`}
              style={{ padding:"6px 12px", background:"#1a1a1a", border:"1px solid #333", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#aaa", letterSpacing:"0.06em", cursor:"pointer" }}
            >
              − 1 PACKAGE
            </button>
            <button
              onClick={() => {
                addStackInstance(setPantry, bucket);
                pushToast(`Added 1 ${top.name}`, { emoji: top.emoji || "🛒", kind: "success", ttl: 2800 });
              }}
              aria-label={`Add one ${top.name} to the stack`}
              style={{ padding:"6px 12px", background:"#1a1608", border:"1px solid #f5c84244", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f5c842", letterSpacing:"0.06em", cursor:"pointer" }}
            >
              + 1 PACKAGE
            </button>
            <span style={{ marginLeft:"auto", fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.06em" }}>
              TAP TO EDIT EACH
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Dispatch: single-instance → renderItemCard, multi-instance → renderStackCard.
  const renderBucket = bucket => (bucket.items.length > 1
    ? renderStackCard(bucket)
    : renderItemCard(bucket.items[0]));

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
            {groupByIdentity(items).map(renderBucket)}
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
          {/* LOW STOCK alert temporarily removed — the isStackLow /
              isLow heuristics are firing too aggressively (flagging
              nearly every row as low) and the banner became clutter
              instead of a useful signal. The underlying lowItems /
              addLowStockToList logic stays in place so we can re-
              mount the surface once the threshold math is right. */}

          {/* Scan / manual-add / deduction CTAs moved to the floating
              ➕ CreateMenu overlay. Kitchen is now inventory +
              maintenance only; creation flows live in one place. */}

          {/* Kitchen-wide search — lives ABOVE the location tabs so
              it's the first thing users reach for when they can't find
              something, and because it already searches every location
              regardless of which tab is active. Hidden once the user
              drills into a specific tile (that view carries its own
              filter context). */}
          {drilledTile === null && (
            <div style={{ padding:"14px 20px 0" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"#0a0a0a", border:"1px solid #242424", borderRadius:12 }}>
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
            </div>
          )}

          {/* Search results — cross-kitchen, grouped by location. When
              a query is active these REPLACE the location tabs + tile
              grid so the user focuses on matches. */}
          {trimmedSearch && (
            <div style={{ padding:"14px 20px 0" }}>
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
                              onClick={() => setOpenItem(item)}
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
            </div>
          )}

          {/* Fridge / Pantry / Freezer tab strip. Nothing is pre-
              selected so users read the landing page as "pick a
              location" rather than "here's the fridge." Selecting a
              tab resets any active tile drill-down (handled in
              setStorageTab). */}
          {!trimmedSearch && (
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
                    // Toggle behavior — tapping the ACTIVE tab closes
                    // it (null state). Makes the "no tab selected"
                    // landing reachable after exploring, not just on
                    // first load.
                    onClick={() => setStorageTab(active ? null : t.id)}
                    aria-pressed={active}
                    title={active ? `Close ${t.label}` : `Open ${t.label}`}
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
          )}

          {/* Empty state — no search, no tab selected. Not a silent
              blank space; cue the user that a location tab is needed
              to see their stocked items (search is the other
              navigator, right above). */}
          {!trimmedSearch && !storageTab && !drilledTile && (
            <div style={{ padding:"28px 24px 12px", textAlign:"center" }}>
              <div style={{ fontSize: 30, opacity: 0.6, marginBottom: 6 }}>🧊 🥫 ❄️</div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", lineHeight:1.55 }}>
                Tap a location above to see what's stocked — or search
                across your whole kitchen up top.
              </div>
            </div>
          )}

          {/* Tile grid — any tab that has a tile set (fridge, pantry), no
              drill-down active, no search active. Tapping a tile enters
              a drill-down view of items in that tile. Empty tiles
              render greyed-out but remain tappable — the drill-down's
              empty state surfaces an "Add your first" affordance. */}
          {!trimmedSearch && currentTiles && drilledTile === null && (
            <div style={{ padding:"14px 20px 0" }}>
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
              into a tile, and on tabs without a tile set (freezer).
              Also requires a tab to actually be selected — otherwise the
              "Search your ${storageTab}…" / "Nothing in your ${storageTab}"
              copy interpolates `null` into the placeholder. */}
          {storageTab && !(currentTiles && drilledTile === null) && (
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
                {(() => {
                  // Hubs come first, then loose items (per the grouped
                  // builder above). Bucketize the loose items by
                  // identity so 5 cans of tuna render as one stack
                  // card with ×5 instead of 5 individual cards.
                  const hubs = grouped.filter(g => g.type === "hub");
                  const looseBuckets = groupByIdentity(
                    grouped.filter(g => g.type === "item").map(g => g.item)
                  );
                  return (
                    <>
                      {hubs.map(renderHubCard)}
                      {looseBuckets.map(renderBucket)}
                    </>
                  );
                })()}
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
          isAdmin={isAdmin}
          shoppingList={shoppingList}
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

      {openReceiptId && (
        <ReceiptView
          receiptId={openReceiptId.receiptId}
          scanId={openReceiptId.scanId}
          pantry={pantry}
          userId={userId}
          familyIds={familyIds}
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
            isAdmin={isAdmin}
            familyIds={familyIds}
            onUpdate={(patch) => updatePantryItem(fresh.id, patch)}
            onDuplicate={() => {
              addStackInstance(setPantry, { key: fresh.id, items: [fresh] });
              pushToast(`Added 1 ${fresh.name}`, { emoji: fresh.emoji || "🛒", kind: "success", ttl: 2800 });
            }}
            onDelete={() => {
              // Hand off to the existing deleteCandidate confirmation
              // modal — that's the one surface that shows name + amount
              // + location in the confirm copy, so users don't
              // accidentally nuke the wrong row. It lives at the
              // Kitchen level because the Kitchen tile's ✕ also
              // triggers it; keeping one confirmation UI beats two.
              setOpenItem(null);
              setDeleteCandidate(fresh);
            }}
            onEditTags={() => setLinkingItem(fresh)}
            onOpenProvenance={(link) => {
              // Gate on ownership first — never route to ReceiptView
              // for an artifact the viewer can't access. The link
              // descriptor carries ownerId (stamped by ItemCard's
              // provenance renderer) so we can validate without
              // another round-trip. Silent drop on out-of-scope;
              // no toast, no card, no flash.
              if (!canOpenProvenance(link?.ownerId)) return;
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
      {stackDrilldown && (() => {
        // Re-compute the bucket from the live pantry so add/remove
        // edits inside the drilldown update the list without a close
        // + reopen. If every instance was deleted, close the modal.
        const fresh = groupByIdentity(
          pantry.filter(p => {
            // Match the bucket's identity key — simplest: reuse the
            // stored rows' ids set, fall back to re-grouping on the
            // fresh pantry and picking the bucket with the same key.
            return stackDrilldown.items.some(i => i.id === p.id);
          })
        );
        let bucket = fresh[0];
        if (!bucket) {
          // All instances deleted elsewhere — close and bail.
          setStackDrilldown(null);
          return null;
        }
        // Widen the bucket: any OTHER rows that share identity
        // (e.g. the user just tapped + PACKAGE and we want the new
        // row in the list) should show up here too. Walk the full
        // pantry, collect identity-matches via groupByIdentity on a
        // synthetic seed.
        const allBuckets = groupByIdentity(pantry);
        const match = allBuckets.find(b => b.key === stackDrilldown.key);
        if (match) bucket = match;
        const ordered = sortedInstances(bucket, "fifo");
        const top = ordered[0] || bucket.items[0];
        return (
          <ModalSheet
            onClose={() => setStackDrilldown(null)}
            label={`${top.emoji || ""} ${top.name} · ${ordered.length}`}
            zIndex={Z.sheet}
          >
            <div style={{ padding:"12px 16px 20px", display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <button
                  onClick={() => {
                    removeStackInstance(setPantry, bucket, "lifo");
                    pushToast(`Removed 1 ${top.name}`, { emoji: top.emoji || "🗑", kind: "info", ttl: 2800 });
                  }}
                  disabled={ordered.length === 0}
                  style={{ padding:"8px 14px", background:"#1a1a1a", border:"1px solid #333", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#aaa", letterSpacing:"0.06em", cursor: ordered.length === 0 ? "not-allowed" : "pointer", opacity: ordered.length === 0 ? 0.4 : 1 }}
                >
                  − 1 PACKAGE
                </button>
                <button
                  onClick={() => {
                    addStackInstance(setPantry, bucket);
                    pushToast(`Added 1 ${top.name}`, { emoji: top.emoji || "🛒", kind: "success", ttl: 2800 });
                  }}
                  style={{ padding:"8px 14px", background:"#1a1608", border:"1px solid #f5c84244", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f5c842", letterSpacing:"0.06em", cursor:"pointer" }}
                >
                  + 1 PACKAGE
                </button>
                <span style={{ marginLeft:"auto", fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", letterSpacing:"0.06em" }}>
                  ×{ordered.length}
                </span>
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7eb8d4", letterSpacing:"0.12em" }}>
                INSTANCES · FIFO BY EXPIRATION
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {ordered.map(inst => {
                  // Per-instance provenance chip. Each sibling carries
                  // its own source_receipt_id / source_scan_id /
                  // source_cook_log_id, so the drilldown can show
                  // "🧾 Apr 17" on one can and "🛒 Apr 22" on the next
                  // without requiring a second tap into ItemCard.
                  let provIcon = null;
                  let provText = null;
                  let provLink = null;
                  const addedShort = inst.purchasedAt
                    ? new Date(inst.purchasedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    : null;
                  if (inst.sourceCookLogId) {
                    provIcon = "🍝";
                    provText = `COOKED · ${addedShort || ""}`.trim();
                    provLink = { kind: "cook", id: inst.sourceCookLogId };
                  } else if (inst.sourceKind === "receipt_scan" && inst.sourceReceiptId) {
                    provIcon = "🧾";
                    provText = `RECEIPT · ${addedShort || ""}`.trim();
                    provLink = { kind: "receipt", id: inst.sourceReceiptId };
                  } else if (inst.sourceKind === "pantry_scan" && inst.sourceScanId) {
                    provIcon = "📱";
                    provText = `PANTRY SCAN · ${addedShort || ""}`.trim();
                    provLink = { kind: "scan", id: inst.sourceScanId };
                  } else if (inst.sourceKind === "manual") {
                    provIcon = "✏️";
                    provText = `MANUAL · ${addedShort || ""}`.trim();
                  } else if (addedShort) {
                    provText = `ADDED · ${addedShort}`;
                  }
                  // Out-of-scope provenance (stale cached row for an
                  // ex-family-member's artifact) drops the tappable
                  // chip — same rule as ItemCard's chevron.
                  const ownerInScope = canOpenProvenance(inst.ownerId);
                  const linkActive = !!(provLink && ownerInScope);
                  return (
                    <div key={`drill-${inst.id}`} style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      {renderItemCard(inst)}
                      {provText && (
                        <button
                          onClick={() => {
                            if (!linkActive) return;
                            if (provLink.kind === "receipt") setOpenReceiptId({ receiptId: provLink.id });
                            else if (provLink.kind === "scan") setOpenReceiptId({ scanId: provLink.id });
                          }}
                          disabled={!linkActive}
                          style={{
                            alignSelf:"flex-start",
                            display:"inline-flex", alignItems:"center", gap:6,
                            padding:"3px 10px",
                            background: linkActive ? "#0f1620" : "#0f0f0f",
                            border: `1px solid ${linkActive ? "#1f3040" : "#1a1a1a"}`,
                            borderRadius: 12,
                            fontFamily:"'DM Mono',monospace", fontSize: 9,
                            color: linkActive ? "#7eb8d4" : "#555",
                            letterSpacing:"0.08em",
                            cursor: linkActive ? "pointer" : "default",
                            marginLeft: 6,
                          }}
                        >
                          {provIcon && <span style={{ fontSize: 11 }}>{provIcon}</span>}
                          {provText}
                          {linkActive && <span style={{ color:"#7eb8d4aa" }}>→</span>}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </ModalSheet>
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
