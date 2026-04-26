// MCMAddDraftSheet — manual-add (and scan-prefilled) entry surface.
// Mounted at App level when onOpenAdd fires; calls onSubmit(row)
// with a partial pantry-row shape that App.jsx wraps with id +
// purchasedAt before pushing into setPantry.
//
// Seed: { mode: "blank" } today; { mode: "scan", name, brand,
// amount, unit, ... } when scan re-seeds.

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PrimaryButton, Kicker, withAlpha } from "./primitives";
import { useTheme, THEME_TRANSITION } from "./theme";
import { font, axis } from "./tokens";
import { MCMPickerSheet } from "./MCMPickerSheet";
import {
  LOCATIONS, DEFAULT_UNIT_OPTIONS,
  defaultCategoryForLocation, shelfLifeFor,
} from "./helpers";
import { LOCATION_DOT } from "./FloatingLocationDock";
import {
  findIngredient, hubForIngredient, INGREDIENTS,
  inferCanonicalFromName, dbCanonicalsSnapshot,
  statesForIngredient, defaultStateFor, STATE_LABELS,
  getIngredientInfo,
} from "../../data/ingredients";
import { detectBrand } from "../../data/knownBrands";
import { useIngredientInfo } from "../../lib/useIngredientInfo";
import { usePopularPackages } from "../../lib/usePopularPackages";
import { findFoodType, FOOD_TYPES, inferFoodTypeFromName, typeIdForCanonical } from "../../data/foodTypes";
import { tagHintsToAxes } from "../../lib/tagHintsToAxes";
import { lookupBarcode } from "../../lib/lookupBarcode";
import { parsePackageSize } from "../../lib/canonicalResolver";
import BarcodeScanner from "../../components/BarcodeScanner";
import { rememberBarcodeCorrection, findBarcodeCorrection } from "../../lib/barcodeCorrections";
import { useBrandNutrition } from "../../lib/useBrandNutrition";
import { tileIconFor } from "../../lib/canonicalIcons";
import MemoryBookCapture from "./MemoryBookCapture";
import { AddDraftProgressStrip } from "./AddDraftProgressStrip";
import { AddDraftPickers } from "./AddDraftPickers";
import { ScanDataPanel } from "./ScanDataPanel";
import { enrichIngredient } from "../../lib/enrichIngredient";

// MCMAddDraftSheet — manual-add (and, in a follow-up commit,
// scan-prefilled) entry surface. Mounted at App level when
// onOpenAdd fires; calls onSubmit(row) with a partial pantry-
// row shape that App.jsx wraps with id + purchasedAt before
// pushing into setPantry.
//
// Seed: { mode: "blank" } today; { mode: "scan", name, brand,
// amount, unit, ... } once scan is wired in commit 2.
// ─────────────────────────────────────────────────────────────
export function MCMAddDraftSheet({ seed = { mode: "blank" }, userId, isAdmin, onClose, onSubmit }) {
  const { theme } = useTheme();
  // Form state — seeded from `seed` so the same component
  // works for empty (manual) and pre-filled (scan) entry. The
  // useState initializer runs once per mount; keying the sheet
  // on seed identity from the parent re-mounts when a fresh
  // scan lands (see App.jsx wiring).
  const [name,   setName]   = useState(seed.name   || "");
  const [brand,  setBrand]  = useState(seed.brand  || "");
  // Package size is the FULL container's amount (becomes
  // pantry_items.max). The remaining slider scales down from
  // there to express how much is actually left. amount === max
  // → SEALED; amount < max → OPENED.
  const [packageSize, setPackageSize] = useState(seed.amount != null ? String(seed.amount) : "");
  const [unit,        setUnit]        = useState(seed.unit   || "");
  // Slider state — fraction of the package still in the
  // container. Defaults to 1 (sealed) since most adds are
  // fresh-from-the-store; the user can drag it down to log
  // an item that's already been opened (e.g. a half-finished
  // jar of mustard moved over from another household).
  const [remaining,   setRemaining]   = useState(1);
  const [location, setLocation] = useState(seed.location || "fridge");
  // Override flag — set true the moment the user taps a location
  // segment, so the canonical-driven auto-resolve below stops
  // overriding their explicit choice. Initial true when the seed
  // already carries a location (the caller has already decided).
  const [locationOverridden, setLocationOverridden] = useState(!!seed.location);
  // Food category (CLAUDE.md "CATEGORIES" axis). Resolved
  // from name inference when no manual pick has been made;
  // the override flag locks the value once the user has tapped
  // a different option in the picker so further name typing
  // doesn't clobber their choice.
  const [typeId, setTypeId] = useState(seed.typeId || null);
  const [typeOverridden, setTypeOverridden] = useState(!!seed.typeId);
  // Canonical (CLAUDE.md axis 2 — tan). Same auto-resolve +
  // override pattern as the category axis so the user types
  // "cheddar" and the picker pre-selects the cheese canonical
  // without them digging.
  const [canonicalId, setCanonicalId] = useState(seed.canonicalId || null);
  const [canonicalOverridden, setCanonicalOverridden] = useState(!!seed.canonicalId);
  // Stored In (CLAUDE.md axis 5 — blue #7eb8d4). Resolved from
  // the location's tile classifier on every relevant input
  // change so the user sees where the row will land before
  // submitting. Override flag locks the value once the user
  // has picked from the tile picker.
  const [tileId, setTileId] = useState(seed.tileId || null);
  const [tileOverridden, setTileOverridden] = useState(!!seed.tileId);
  // STATE axis (CLAUDE.md axis 6 — soft purple #c7a8d4). Sits
  // between canonical and package size in the form because the
  // physical state of an item gates which units make sense
  // (block vs grated cheese, whole vs ground beef). Auto-fills
  // from the canonical's defaultStateFor when one is pinned;
  // override flag locks the user's pick against further
  // canonical changes.
  const [state, setState] = useState(seed.state || null);
  const [stateOverridden, setStateOverridden] = useState(!!seed.state);
  // Expiration — three states:
  //   "auto" sentinel — system computes the freshness window
  //     from the canonical's storage.shelfLife at submit time,
  //     anchored to "now" (the moment the item enters the
  //     kitchen). Default for new adds.
  //   null — explicit shelf-stable (no clock).
  //   Date — explicit user-picked date.
  // On submit, "auto" resolves to a Date or null based on what
  // the canonical's metadata can offer.
  const [expiresAt, setExpiresAt] = useState(
    seed.expiresAt instanceof Date ? seed.expiresAt
    : seed.expiresAt === null ? null
    : "auto"
  );
  const [pickerOpen, setPickerOpen] = useState(null); // null | "category" | "canonical" | "tile" | "unit" | "expires" | "state"
  // Typeahead — suggestions floated under the Name input as
  // the user types. Tapping a suggestion locks the canonical
  // axis AND swaps the typed text for the canonical's display
  // name in one move (so "cheddar" → canonical: cheese, name:
  // "Cheese"). suppressUntilBlur lets us hide suggestions
  // immediately after a pick without fighting the input's
  // continued focus.
  const [nameFocused, setNameFocused]           = useState(false);
  const [suppressTypeahead, setSuppressTypeahead] = useState(false);
  // Barcode lookup retains the UPC string when the user
  // scanned (vs typed manually) so the submit row carries it
  // — future scans of the same UPC pick up corrections via
  // findBarcodeCorrection. Null on manual entry.
  const [barcodeUpc, setBarcodeUpc] = useState(seed.barcodeUpc || null);
  // Scanner overlay state. When `scanning` is true, the
  // BarcodeScanner mounts full-screen over the sheet. Lookup
  // status surfaces in `scanStatus` so the user sees
  // "Looking up…" → "Got it" — "miss" / "error" never reach the
  // user as copy: they trigger the MemoryBookCapture flow instead.
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null); // null | "looking" | "found" | "miss" | "error"
  // OFF categoryHints from the failing lookup, stashed so the
  // MemoryBookCapture flow (and its categorize-product-photo edge
  // call) can bias Haiku with whatever weak signal OFF DID give us
  // even when the result didn't pair to a canonical.
  const [scanCategoryHints, setScanCategoryHints] = useState(null);
  // When true, the MemoryBookCapture sheet is mounted as a
  // full-cover overlay above this sheet. Replaces every "scan
  // failed" terminal — see feedback_scan_never_fails.md memory.
  const [memoryBookOpen, setMemoryBookOpen] = useState(false);
  // Latest scan's raw + computed payload — populated in handleScan,
  // consumed by the ScanDataPanel below the form so the user can
  // glance at nutrition / source / categoryHints / etc. without
  // digging into devtools.
  const [scanDebug, setScanDebug] = useState(null);
  // Terminal scan-status messages auto-dismiss after a few
  // seconds so they don't loiter while the user fills in the
  // form. "looking" stays until the lookup resolves; "found"
  // dismisses faster (it's a confirmation), "miss" / "error"
  // linger longer so the user has time to read the recovery
  // hint.
  useEffect(() => {
    if (!scanStatus || scanStatus === "looking") return;
    const ms = scanStatus === "found" ? 2400 : 5000;
    const t = setTimeout(() => setScanStatus(null), ms);
    return () => clearTimeout(t);
  }, [scanStatus]);
  // Household-curated brand nutrition rows. Passed into
  // lookupBarcode so a UPC matched only by the family's saved
  // brand entries (no OFF / no USDA hit) still resolves —
  // matches classic Kitchen's scanner behavior. The `loading`
  // flag gates the "ask for more info" trigger: until the cache
  // has hydrated we can't know whether a UPC truly missed every
  // tier or whether we just queried before brand_nutrition rows
  // arrived from Supabase.
  const {
    rows:    brandNutritionRows,
    loading: brandNutritionLoading,
    upsert:  upsertBrandNutrition,
  } = useBrandNutrition();
  // Hook into the IngredientInfoProvider so the canonical
  // typeahead and picker can see admin-approved + user-created
  // DB canonicals alongside the 400 bundled ones. dbMap is the
  // raw fetched table; dbCanonicalsSnapshot() reads the
  // synthetic-canonical Map that registerCanonicalsFromDb
  // populates from dbMap on every refresh, so we depend on the
  // map identity to invalidate the merged search list.
  const {
    dbMap,
    getInfo: getDbInfo,
    loading: ingredientInfoLoading,
    refreshPending,
  } = useIngredientInfo();
  // dbMap identity is the invalidation signal — when the
  // provider refreshes (initial fetch / admin approval /
  // realtime update), dbMap swaps reference and the snapshot
  // re-runs against the freshly-registered Map.
  const allCanonicals = useMemo(
    () => [...INGREDIENTS, ...dbCanonicalsSnapshot()],
    [dbMap]
  );
  // Top popular package sizes for the picked canonical. The
  // hook is brand-aware: when the user has typed a brand we
  // get brand-specific hits ranked first, with canonical-wide
  // observations filling the remainder. Idle (returns []) until
  // a canonical is set, which matches the cascade gate above.
  // Debounce the brand passed to usePopularPackages so we don't
  // refetch the brand-specific tier on every keystroke. 300ms
  // matches the threshold a user crosses when they pause between
  // brand fragments. canonicalId switches are immediate (the
  // typeahead already drove the user's intent).
  const [debouncedBrand, setDebouncedBrand] = useState(brand);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBrand(brand), 300);
    return () => clearTimeout(t);
  }, [brand]);
  const { rows: popularPackages } = usePopularPackages(
    debouncedBrand.trim() || null,
    canonicalId || null,
    3,
  );
  // Brand observations for the canonical-wide tier — same RPC,
  // null brand so we get every observation regardless of who
  // bought it. We dedupe + rank by count so the typeahead can
  // surface "Marketside" first when the household has bought a
  // watermelon under that brand before. Idle until the
  // canonical is pinned.
  const { rows: canonicalBrandObservations } = usePopularPackages(
    null,
    canonicalId || null,
    20,
  );
  const brandSuggestions = useMemo(() => {
    if (!canonicalId) return [];
    const counts = new Map();
    for (const r of canonicalBrandObservations) {
      const b = (r.brand || "").trim();
      if (!b) continue;
      counts.set(b, (counts.get(b) || 0) + (r.n || 1));
    }
    return Array.from(counts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([brand]) => brand);
  }, [canonicalId, canonicalBrandObservations]);
  const [brandFocused, setBrandFocused] = useState(false);
  const [suppressBrandTypeahead, setSuppressBrandTypeahead] = useState(false);
  // Auto-expiry preview — looks up the canonical's freshness
  // window. Indexes by location AND by sealed-vs-opened state:
  // when the user adds an item that's already partly open
  // (remaining < 1), we use the opened window so the clock
  // matches reality. Pill preview reflects the same value.
  const autoDays = useMemo(() => {
    if (!canonicalId) return null;
    const opened = remaining < 0.999;
    const dbOverride = getDbInfo(canonicalId);
    const days = shelfLifeFor(canonicalId, location, { opened, dbOverride });
    if (Number.isFinite(days)) return days;
    if (opened) return shelfLifeFor(canonicalId, location, { opened: false, dbOverride });
    return null;
  }, [canonicalId, location, remaining, getDbInfo]);

  const filteredBrandSuggestions = useMemo(() => {
    const q = brand.trim().toLowerCase();
    const list = q
      ? brandSuggestions.filter(b => b.toLowerCase().includes(q))
      : brandSuggestions;
    return list.slice(0, 6);
  }, [brand, brandSuggestions]);
  const nameSuggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (q.length < 2) return [];
    const exact = [];
    const starts = [];
    const includes = [];
    for (const ing of allCanonicals) {
      const lc = (ing.name || "").toLowerCase();
      if (!lc) continue;
      if (lc === q) exact.push(ing);
      else if (lc.startsWith(q)) starts.push(ing);
      else if (lc.includes(q))   includes.push(ing);
      if (exact.length + starts.length + includes.length >= 32) break;
    }
    return [...exact, ...starts, ...includes].slice(0, 6);
  }, [name, allCanonicals]);

  // Category cascade — runs only when the user hasn't manually
  // overridden. When a canonical is pinned, prefer the direct
  // canonicalId → typeId map (typeIdForCanonical) so canonicals
  // with explicit FOOD_TYPES bridges (mayo → wweia_mayo, pizza →
  // wweia_pizza, etc.) auto-pin even when the canonical's name
  // doesn't textually contain a food-type alias. Falls back to
  // name inference for the no-canonical / typed-only case.
  useEffect(() => {
    if (typeOverridden) return;
    const ing = canonicalId ? findIngredient(canonicalId) : null;
    // typeIdForCanonical does the two-pass: exact id-bridge
    // lookup first, then name-alias fallback. Without this,
    // canonicals whose display name doesn't alias-match any
    // FOOD_TYPES entry (the majority of bundled canonicals)
    // never resolved their category — the chip stayed unset
    // even though the canonical was pinned.
    const fromCanonical = ing ? typeIdForCanonical(ing) : null;
    const inferredId = fromCanonical || inferFoodTypeFromName(name);
    setTypeId(inferredId || null);
  }, [name, canonicalId, typeOverridden]);

  // Same pattern for the canonical chip — typing "cheddar"
  // resolves to the cheese / cheddar canonical so the chip
  // can pre-select. Override flag locks the picked value
  // against further typing.
  //
  // dbMap is a dep so the inference re-runs when DB-tier
  // canonicals finish loading (useIngredientInfo invalidates
  // inferCanonicalFromName's alias-map cache via
  // registerCanonicalsFromDb on every dbMap change). Without
  // this, a scan that landed `name` BEFORE the DB hydrated
  // would never pair its canonical even after the data arrived.
  useEffect(() => {
    if (canonicalOverridden) return;
    const id = inferCanonicalFromName(name);
    setCanonicalId(id || null);
  }, [name, canonicalOverridden, dbMap]);

  // Auto-resolve the State axis to the canonical's natural
  // default (block for cheese, whole for meats, etc.) whenever
  // the canonical changes and the user hasn't manually picked.
  useEffect(() => {
    if (stateOverridden) return;
    if (!canonicalId) { setState(null); return; }
    const def = defaultStateFor(canonicalId);
    setState(def || null);
  }, [canonicalId, stateOverridden]);

  // Auto-select the LOCATION (fridge / pantry / freezer) from
  // the canonical's storage.location when the user hasn't
  // manually picked a segment yet. Reads via getIngredientInfo
  // so admin-approved DB enrichment overrides bundled. Eggs are
  // shelf-stable when truly fresh, but 90% of households store
  // them in the fridge — the canonical's storage.location
  // captures that everyday-reality default so the user doesn't
  // have to fight the form.
  useEffect(() => {
    if (locationOverridden) return;
    if (!canonicalId) return;
    const ing = findIngredient(canonicalId);
    const info = getIngredientInfo(ing, getDbInfo(canonicalId));
    const home = info?.storage?.location;
    if (home === "fridge" || home === "pantry" || home === "freezer") {
      setLocation(home);
    }
  }, [canonicalId, locationOverridden, getDbInfo]);

  // Resolve the Stored In tile via the location's classifier.
  // Synthesizes a draft item from the current axis state and
  // hands it to fridgeTileFor / pantryTileFor / freezerTileFor
  // (whichever matches the active location). The classifier
  // expects `ingredientId` (legacy field name, predates the
  // canonical-axis rename) so we pass the canonical there.
  // Without that mapping every row would short-circuit to the
  // location's category fallback ("dairy" for fridge), which
  // is exactly what was happening before this fix.
  useEffect(() => {
    if (tileOverridden) return;
    const loc = LOCATIONS.find(l => l.id === location);
    if (!loc) return;
    const ing = canonicalId ? findIngredient(canonicalId) : null;
    const draft = {
      name: name.trim(),
      ingredientId: canonicalId || null,
      typeId: typeId || null,
      // Use the canonical's own category when we have one, so
      // the classifier's category-routing path (meat → meat_poultry,
      // produce → produce, etc.) fires for canonicals we know
      // about. Falls back to the location default only when no
      // canonical is set — at which point the pills are hidden
      // anyway per the canonical-pin gate above.
      category: ing?.category || defaultCategoryForLocation(location),
    };
    const id = loc.classify(draft, { findIngredient, hubForIngredient });
    setTileId(id || null);
  }, [name, canonicalId, typeId, location, tileOverridden]);

  // Cascading correction-write — whenever the resolver cascade
  // settles a downstream axis (typeId, tileId, location) on a
  // scanned UPC, persist it to barcode_identity_corrections so the
  // next scan rehydrates the full identity, not just the canonical.
  //
  // Debounced 600ms so a quick chain of cascade renders (e.g.
  // canonicalId → location → tileId all firing within one paint)
  // collapses into a single write. Fires only when:
  //   • A UPC was actually scanned (barcodeUpc is set)
  //   • A canonical landed (cascade succeeded)
  //   • Caller has a userId (write boundary)
  // The handleScan path does the initial canonical-only write at
  // scan time; this effect adds the downstream axes as they settle.
  useEffect(() => {
    if (!barcodeUpc || !canonicalId || !userId) return;
    const t = setTimeout(() => {
      rememberBarcodeCorrection({
        userId,
        isAdmin: !!isAdmin,
        barcodeUpc,
        canonicalId,
        typeId:   typeId   || null,
        tileId:   tileId   || null,
        location: location || null,
      }).catch(err =>
        console.warn("[mcm-add] cascade correction-write failed:", err?.message || err),
      );
    }, 600);
    return () => clearTimeout(t);
  }, [barcodeUpc, canonicalId, typeId, tileId, location, userId, isAdmin]);

  // Validation — required fields the row needs to be useful
  // downstream (recipe matching, freshness clock, fill gauge).
  //
  // Note: there's no separate "name" requirement because the
  // name IS the canonical in this app. Once a canonical is
  // committed (via typeahead pick, auto-resolve from typed
  // text, or the "+ Add canonical" escape hatch) the name is
  // necessarily set — every path through the form that lands
  // a canonical also lands a name. So checking canonicalId is
  // a strict superset of checking name.trim().length > 0.
  //
  // canonicalId acceptance is broad: any non-null value passes,
  // covering all three sources — bundled INGREDIENTS, admin-
  // approved DB canonicals (via useIngredientInfo's
  // dbCanonicals), and user-typed slugs from the "+ Add
  // canonical" escape hatch.
  const validationErrors = useMemo(() => {
    const errors = [];
    if (!canonicalId) errors.push({ field: "canonical", message: "canonical (type or pick from suggestions)" });
    const pkgN = Number(packageSize);
    if (!Number.isFinite(pkgN) || pkgN <= 0) {
      errors.push({ field: "packageSize", message: "package size" });
    }
    if (!unit.trim()) errors.push({ field: "unit", message: "unit" });
    return errors;
  }, [canonicalId, packageSize, unit]);
  const errorFields = useMemo(() => {
    const set = new Set();
    for (const e of validationErrors) set.add(e.field);
    return set;
  }, [validationErrors]);
  // First-attempt gate — banner + field highlights only show
  // after the user has at least once tried to submit. Avoids
  // splashing yellow over a freshly-opened, empty form.
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const showErrors = attemptedSubmit && validationErrors.length > 0;
  const canSubmit = name.trim().length > 0;
  // The form's "ready" state (all required fields satisfied) —
  // derived once at component scope so both the progress strip
  // IIFE and the scan-button render below can react to it
  // without recomputing.
  const formReady = validationErrors.length === 0;

  const handleScan = async (upc) => {
    setBarcodeUpc(upc);
    setScanning(false);
    setScanStatus("looking");
    try {
      // Run the OFF/USDA lookup and the prior-correction lookup
      // in parallel — they're independent reads. The correction
      // is the higher tier per CLAUDE.md's resolution cascade
      // (family + global corrections beat raw OFF data), so its
      // values win when both surface a hint for the same axis.
      const [res, correction] = await Promise.all([
        lookupBarcode(upc, { brandNutritionRows }),
        findBarcodeCorrection(upc).catch(err => {
          console.warn("[mcm-add] correction read failed:", err?.message || err);
          return null;
        }),
      ]);
      // Apply the correction's location whenever one was taught.
      // The user is initiating the scan, so they expect prior
      // teachings to win over the form's default seed. They can
      // still re-pick after, and that re-pick writes back via
      // rememberBarcodeCorrection on submit.
      if (correction?.location) setLocation(correction.location);
      // Tile correction beats the live classifier. Lock the
      // override so subsequent name/canonical edits don't
      // re-run the classifier and stomp the user's prior pick.
      if (correction?.tileId) {
        setTileId(correction.tileId);
        setTileOverridden(true);
      }

      // Type correction beats the live name-inference. Same
      // cascade rule as tile — lock the override so the typeId
      // useEffect can't re-run inferFoodTypeFromName(name) on the
      // next render and wipe the taught value.
      if (correction?.typeId && !typeOverridden) {
        setTypeId(correction.typeId);
        setTypeOverridden(true);
      }

      // Stash any categoryHints OFF returned, even if the lookup
      // didn't pair to a canonical — the memory-book fallback below
      // uses them to bias Haiku's vision call so the AI starts with
      // whatever weak taxonomy signal OFF gave us.
      if (Array.isArray(res?.categoryHints) && res.categoryHints.length > 0) {
        setScanCategoryHints(res.categoryHints);
      }

      // Best display name — productName when OFF gave us a clean
      // one, falling back to genericName ("Greek yogurt") when
      // productName is null or just brand/SKU noise. The edge
      // fn comments call this out explicitly: generic_name is
      // often a better fuzz-match target than product_name.
      const displayName = (res?.productName && res.productName.trim())
        || (res?.genericName && res.genericName.trim())
        || "";
      // Brand recovery — when OFF didn't surface a brand but the
      // productName starts with one (e.g. "Kerrygold Pure Irish
      // Butter"), pull it out via the curated knownBrands table.
      // Same path the memory-book Haiku flow uses.
      const detectedBrand = res?.brand
        || (displayName ? detectBrand(displayName) : null)
        || null;

      // OFF / USDA payload pre-fill — apply whatever fields landed.
      // No outer `if (res.found)` gate: OFF doesn't return partial
      // payloads (it's all-or-nothing), but the per-field guards
      // below mean a `found:false` with no fields is a no-op anyway.
      if (!name.trim() && displayName)         setName(displayName);
      if (!brand.trim() && detectedBrand)      setBrand(detectedBrand);
      const pkg = res?.quantity ? parsePackageSize(res.quantity) : null;
      if (!packageSize && pkg?.amount != null) setPackageSize(String(pkg.amount));
      if (!unit        && pkg?.unit)           setUnit(pkg.unit);
      if (res?.found) setRemaining(1);
      if (Array.isArray(res?.categoryHints) && res.categoryHints.length > 0) {
        const axes = tagHintsToAxes(res.categoryHints);
        if (!typeOverridden && axes.typeId) {
          setTypeId(axes.typeId);
          // Lock so the name-watching inference effect can't re-run
          // inferFoodTypeFromName(name) and wipe the OFF-derived
          // typeId. Same race that hit canonicalId — without the
          // lock, a one-render later setTypeId(null) lands.
          setTypeOverridden(true);
        }
        if (!tileOverridden && axes.tileId) {
          setTileId(axes.tileId);
          // Lock for the parallel reason — the tile classifier
          // useEffect depends on canonicalId / category and re-runs
          // on every render those change, overwriting the OFF tile.
          setTileOverridden(true);
        }
      }

      // Canonical cascade — correction → cached canonicalId →
      // inference from displayName → inference from genericName.
      // Computed synchronously so we know whether a paired
      // canonical landed without waiting on the React effect that
      // re-runs inferCanonicalFromName when `name` changes.
      const inferredFromDisplay = displayName
        ? inferCanonicalFromName(displayName)
        : null;
      const inferredFromGeneric = (!inferredFromDisplay && res?.genericName)
        ? inferCanonicalFromName(res.genericName)
        : null;
      const finalCanonicalId =
        correction?.canonicalId
        || res?.canonicalId
        || inferredFromDisplay
        || inferredFromGeneric
        || null;
      if (finalCanonicalId && !canonicalOverridden) {
        setCanonicalId(finalCanonicalId);
        // Lock the override so the name-watching inference effect
        // can't wipe a correction-tier or AI-tier canonical that
        // doesn't have an alias-map entry (synthetic user-tier slugs
        // like "caramel_dip" aren't registered until ingredient_info
        // catches up — without the lock the next render's
        // inferCanonicalFromName(name) returns null and resets us
        // back to no canonical). The lock releases automatically
        // when the user types a name that diverges from the
        // canonical's display name (see the input onChange).
        setCanonicalOverridden(true);
      }
      // Stash the raw + computed payload so the ScanDataPanel
      // below the form can render nutrition / source / etc.
      setScanDebug({
        upc,
        res: res || null,
        correction: correction || null,
        finalCanonicalId,
        displayName: displayName || null,
        detectedBrand: detectedBrand || null,
        at: new Date().toISOString(),
      });

      // brand_nutrition write — the moment we have canonical + brand
      // + nutrition, persist the row so the next scan of this UPC
      // (and every household / user who scans the same product) hits
      // the cache and gets an instant pair without re-fetching OFF.
      // Fire-and-forget per CLAUDE.md: a cache-write failure must
      // never block the add flow.
      //
      // Skipped when we have a "cached" hit — that means the row
      // already exists and we'd be re-upserting our own data.
      if (
        res?.nutrition
        && finalCanonicalId
        && (detectedBrand || res?.brand)
        && !res?.cached
        && typeof upsertBrandNutrition === "function"
      ) {
        upsertBrandNutrition({
          canonicalId: finalCanonicalId,
          brand:       detectedBrand || res.brand,
          nutrition:   res.nutrition,
          barcode:     upc,
          source:      res.source   || "openfoodfacts",
          sourceId:    res.sourceId || upc,
          confidence:  80,
        }).catch(err =>
          console.warn("[mcm-add] brand_nutrition scan-write failed:", err?.message || err),
        );
      }

      // barcode_identity_corrections write — teach the household /
      // global memory the moment we resolve a canonical, even before
      // the user submits. Without this, dismissing the form after a
      // successful scan throws away the resolution; a re-scan would
      // have to re-do the OFF lookup + name inference. Fire-and-forget.
      if (finalCanonicalId && userId) {
        rememberBarcodeCorrection({
          userId,
          isAdmin: !!isAdmin,
          barcodeUpc:    upc,
          canonicalId:   finalCanonicalId,
          // categoryHints seed the global tag-map on the admin tier
          // so similar UPCs resolve faster downstream.
          categoryHints: Array.isArray(res?.categoryHints) ? res.categoryHints : null,
        }).catch(err =>
          console.warn("[mcm-add] barcode_correction scan-write failed:", err?.message || err),
        );
      }

      // Canonical-fallback fill — when we found a canonical but
      // OFF didn't supply a name / unit, borrow the canonical's
      // display name + default unit so the row at least lands with
      // a sane identity. Without this, a correction-only hit (OFF
      // miss but family taught the UPC) would leave the form empty.
      if (finalCanonicalId) {
        const ing = findIngredient(finalCanonicalId);
        if (ing) {
          if (!name.trim() && !displayName && ing.name) setName(ing.name);
          if (!unit && ing.defaultUnit) setUnit(ing.defaultUnit);
        }
      }

      // Paired canonical is the success bar. Without one, the row
      // can't pair to recipes, freshness windows, or nutrition —
      // so we route the user into the photo flow to gather more
      // info. NEVER framed as a failure ("couldn't find that one")
      // — only ever as "tell us more." See feedback_scan_never_fails.md.
      //
      // Held off when EITHER cache is still hydrating:
      //   • brand_nutrition (useBrandNutrition) feeds the cached
      //     canonicalId fallback path inside lookupBarcode.
      //   • ingredient_info (useIngredientInfo) registers DB-tier
      //     canonicals into inferCanonicalFromName's alias map.
      // A scan that fires before either has loaded can mis-flag a
      // known UPC as needing more info — the second scan succeeds
      // only because the caches finished loading in the gap.
      if (!finalCanonicalId) {
        if (brandNutritionLoading || ingredientInfoLoading) {
          // Caches are still hydrating — leave the form populated
          // with whatever did land and let the user pick a canonical
          // manually from the typeahead. The setName→useEffect
          // chain will retry inference once dbMap finishes loading
          // (the alias-map cache invalidates when registerCanonicalsFromDb
          // fires from useIngredientInfo's mount effect), so the
          // canonical typically pairs without a second scan anyway.
          setScanStatus("found");
          return;
        }
        setScanStatus(null);
        setMemoryBookOpen(true);
        return;
      }
      setScanStatus("found");
    } catch (e) {
      console.warn("[mcm-add] scan lookup failed:", e?.message || e);
      // Lookup threw — treat the same as no canonical landing: ask
      // for more info via the photo flow rather than surfacing the
      // exception as user-facing copy.
      setScanStatus(null);
      setMemoryBookOpen(true);
    }
  };

  // Esc closes — same keyboard pattern KitchenScreen uses for
  // its sticky surfaces.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = () => {
    if (!canSubmit) return;
    // Block bad data entry — flag the missing-field state so the
    // caution banner + per-field highlights surface, then bail.
    if (validationErrors.length > 0) {
      setAttemptedSubmit(true);
      return;
    }
    const cat = defaultCategoryForLocation(location);
    // Self-teaching write — when the user scanned a barcode and
    // landed in this sheet, whatever LOCATION they confirm here
    // becomes the household-scoped (or global, for admins) answer
    // for that UPC. Next scan of the same product picks the
    // location up via findBarcodeCorrection without asking again.
    // Fire-and-forget per CLAUDE.md: a correction-write failure
    // must never block the add flow.
    if (barcodeUpc && userId) {
      rememberBarcodeCorrection({
        userId,
        isAdmin: !!isAdmin,
        barcodeUpc,
        location,
        tileId: tileId || null,
        typeId: typeId || null,
        canonicalId: canonicalId || null,
      }).catch(err => console.warn("[mcm-add] correction write failed:", err?.message || err));
    }
    // Convert package size + remaining fraction into the
    // amount/max pair the rest of the app reads. amount === max
    // means SEALED; amount < max means OPENED with that fraction
    // left. Empty package size leaves both null so the row falls
    // back to a quantity-less entry (the gauge hides itself in
    // that mode — see KitchenCard).
    const pkgN  = packageSize ? Number(packageSize) : null;
    const maxN  = Number.isFinite(pkgN) && pkgN > 0 ? pkgN : null;
    const amtN  = maxN != null ? Math.max(0, Math.min(1, remaining)) * maxN : null;
    onSubmit && onSubmit({
      name: name.trim(),
      brand: brand.trim() || null,
      amount: amtN,
      max:    maxN,
      unit: unit.trim() || null,
      category: cat,
      typeId: typeId || null,
      canonicalId: canonicalId || null,
      state: state || null,
      location,
      // Resolved tile from the live classifier (or user
      // override). Falls back to null when the classifier
      // can't pick a tile for this location; the parent
      // setPantry path lets the existing classify logic fill
      // the gap if so.
      tileId: tileId || null,
      expiresAt: (() => {
        if (expiresAt instanceof Date) return expiresAt;
        if (expiresAt === null) return null;
        // "auto" — materialize from the canonical's freshness
        // window relative to now. If we have no days the row
        // lands shelf-stable, which matches "we don't know".
        if (expiresAt === "auto" && Number.isFinite(autoDays) && autoDays > 0) {
          const d = new Date();
          d.setDate(d.getDate() + autoDays);
          d.setHours(23, 59, 0, 0);
          return d;
        }
        return null;
      })(),
      // Carry the scanned UPC (when present) so future scans
      // of the same barcode pick up corrections via
      // findBarcodeCorrection.
      barcodeUpc: barcodeUpc || null,
    });
  };

  const inputBase = {
    width: "100%",
    border: `1px solid ${theme.color.hairline}`,
    background: theme.color.glassFillHeavy,
    color: theme.color.ink,
    borderRadius: 12,
    padding: "12px 14px",
    fontFamily: font.sans,
    fontSize: 15,
    outline: "none",
    boxShadow: theme.shadow.inputInset,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add an item to the kitchen"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(20,12,4,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onClick={(e) => {
        // Backdrop click closes — only when the click target
        // is the backdrop itself, not the sheet content.
        if (e.target === e.currentTarget) onClose && onClose();
      }}
    >
      <motion.div
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 32, opacity: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        style={{
          width: "100%",
          maxWidth: 520,
          // Cap height so the sheet doesn't overflow the viewport
          // on phones — once a canonical lands the form grows
          // (pills + popular sizes + brand typeahead) and could
          // exceed even a tall iPhone. Inner scroll keeps the
          // header pinned visually while the form below pages.
          maxHeight: "90vh",
          overflowY: "auto",
          // Keep the scrollbar slot reserved so content doesn't
          // reflow horizontally when the inner scrollbar appears
          // / disappears as form sections expand.
          scrollbarGutter: "stable",
          margin: "0 12px 24px",
          padding: 22,
          borderRadius: 20,
          background: theme.color.glassFillHeavy,
          border: `1px solid ${theme.color.glassBorder}`,
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          boxShadow: "0 24px 60px rgba(20,12,4,0.40), 0 4px 16px rgba(20,12,4,0.20)",
          ...THEME_TRANSITION,
        }}
      >
        {/* Header — kicker + title with the live Category pill
            pinned to the top-right. The pill renders as a
            status indicator: orange (theme.color.burnt) when
            our auto-resolve / scan landed on a category,
            dashed muted when nothing has resolved yet. Tap
            opens the full picker so the user can override.
            Sits inside the header row so it never collides
            with the form below. */}
        <AddDraftProgressStrip
          theme={theme}
          canonicalId={canonicalId}
          packageSize={packageSize}
          unit={unit}
          brand={brand}
          brandNutritionRows={brandNutritionRows}
        />

        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Kicker tone={theme.color.inkFaint}>Add to kitchen</Kicker>
            <div style={{
              fontFamily: font.display,
              fontSize: 28,
              fontWeight: 400,
              letterSpacing: "0.025em",
              color: theme.color.ink,
              marginTop: 4,
              marginBottom: 18,
              lineHeight: 1.05,
            }}>
              What's new on the shelf?
            </div>
          </div>
          {/* Right-rail status pills — Category (orange) and
              Stored In (blue) per CLAUDE.md reserved colors.
              Hidden until the canonical is pinned: with no
              canonical the inferred values are noisy guesses
              (or empty) and showing the pills implies a
              decision the user hasn't made yet. Once a
              canonical lands the cascade fills both pills with
              real metadata, so they appear together. */}
          {canonicalId && (
          <motion.div
            // Fade + slide-in when the pills appear so the cascade
            // feels alive rather than popping in. Subtle enough to
            // not pull focus from the Name input the user is
            // probably still hovering near.
            initial={{ opacity: 0, x: 8, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            style={{
              display: "flex", flexDirection: "row", alignItems: "center",
              gap: 6, flexShrink: 0, marginTop: 2,
            }}
          >
            {/* Category pill — orange. When unset, renders as a
                tappable + add-circle (dashed border) so the user
                has an obvious affordance to attach a category.
                When set, renders as a name pill ("Cheese",
                "Yogurt") since FOOD_TYPES don't have their own
                SVG icons yet — falling back to text keeps the
                resolved value glanceable until artwork ships. */}
            {(() => {
              const t = typeId ? findFoodType(typeId) : null;
              const tone = theme.color.burnt;
              if (!t) {
                return (
                  <button
                    type="button"
                    className="mcm-focusable"
                    onClick={() => setPickerOpen("category")}
                    aria-label="Pick a category"
                    title="Pick a category"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 40, height: 40,
                      padding: 0,
                      borderRadius: 999,
                      border: `1px dashed ${withAlpha(tone, 0.55)}`,
                      background: `linear-gradient(${withAlpha(tone, 0.08)}, ${withAlpha(tone, 0.08)}), ${theme.color.glassFillHeavy}`,
                      color: tone,
                      cursor: "pointer",
                      flexShrink: 0,
                      transition: "background 200ms ease, border-color 200ms ease",
                    }}
                  >
                    <span style={{
                      fontSize: 22, lineHeight: 1, fontWeight: 300,
                      color: tone,
                    }}>+</span>
                  </button>
                );
              }
              return (
                <button
                  type="button"
                  className="mcm-focusable"
                  onClick={() => setPickerOpen("category")}
                  aria-label={`Category: ${t.label}`}
                  title={`Category · ${t.label}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    height: 40,
                    padding: "0 14px",
                    borderRadius: 999,
                    border: `1px solid ${withAlpha(tone, 0.55)}`,
                    background: `linear-gradient(${withAlpha(tone, 0.22)}, ${withAlpha(tone, 0.22)}), ${theme.color.glassFillHeavy}`,
                    color: theme.color.ink,
                    fontFamily: font.detail,
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: 14,
                    cursor: "pointer",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    transition: "background 200ms ease, border-color 200ms ease",
                  }}
                >
                  {t.label}
                </button>
              );
            })()}
            {(() => {
              const loc = LOCATIONS.find(l => l.id === location);
              const tile = loc && tileId ? loc.tiles.find(x => x.id === tileId) : null;
              const tone = axis.storedIn;
              const svg = tile ? tileIconFor(tile.id, location) : null;
              const resolved = !!tile && tile.id !== "misc" && !!svg;
              // When an SVG is found the file already has its own
              // circle / border baked in — render it bare at 100%
              // so we don't double-frame it. Otherwise show the
              // dashed teal-blue + add-circle as the unresolved
              // affordance.
              if (resolved) {
                return (
                  <button
                    type="button"
                    className="mcm-focusable"
                    onClick={() => setPickerOpen("tile")}
                    aria-label={`Stored in: ${tile.label}`}
                    title={`Stored in · ${tile.label}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 40, height: 40,
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <img
                      src={svg}
                      alt=""
                      aria-hidden
                      style={{
                        width: "100%", height: "100%", objectFit: "contain",
                        display: "block",
                        filter: "drop-shadow(0 1px 2px rgba(30,20,8,0.22))",
                      }}
                    />
                  </button>
                );
              }
              return (
                <button
                  type="button"
                  className="mcm-focusable"
                  onClick={() => setPickerOpen("tile")}
                  aria-label="Pick a shelf"
                  title="Pick a shelf"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40, height: 40,
                    padding: 0,
                    borderRadius: 999,
                    border: `1px dashed ${withAlpha(tone, 0.55)}`,
                    background: `linear-gradient(${withAlpha(tone, 0.08)}, ${withAlpha(tone, 0.08)}), ${theme.color.glassFillHeavy}`,
                    color: tone,
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "background 200ms ease, border-color 200ms ease",
                  }}
                >
                  <span style={{
                    fontSize: 22, lineHeight: 1, fontWeight: 300,
                    color: tone,
                  }}>+</span>
                </button>
              );
            })()}
          </motion.div>
          )}
        </div>

        {/* Scan-status banner — fixed-height row so the form
            below doesn't shift when the message appears /
            disappears. Empty state renders as a 0-opacity slot
            of the same height so layout stays still. */}
        {(() => {
          // Bind-confidence-aware status. Pulls bindConfidence from
          // scanDebug.memoryBook (AI photo path) or treats every other
          // hit as "exact" (deterministic resolvers — correction,
          // brand_nutrition cache, OFF, name inference).
          //
          //   exact    → teal "Got it · {name}" — confident bind, no nudge.
          //   stripped → mustard "Found {canonical} · also {claims}" — system
          //              recovered the bind by stripping flavor words; user
          //              should glance at chips before committing.
          //   guessed  → mustard "We're guessing this is {name} — tap the
          //              name to refine" — softest cue, AI proposed a
          //              fresh canonical the registry didn't know about.
          const memBind  = scanDebug?.memoryBook?.bindConfidence || null;
          const memClaims = scanDebug?.memoryBook?.claims || [];
          const memName   = scanDebug?.memoryBook?.canonicalName || null;
          const tone =
            memBind === "stripped" || memBind === "guessed"
              ? theme.color.mustard
              : scanStatus === "found"
                ? theme.color.teal
                : scanStatus === "looking"
                  ? theme.color.inkMuted
                  : theme.color.burnt;
          const message = (() => {
            if (scanStatus === "looking") return "Looking that one up…";
            if (scanStatus !== "found") return null;
            if (memBind === "guessed") {
              return memName
                ? `We're guessing this is ${memName} — tap the name to refine`
                : "We're guessing — tap the name to refine";
            }
            if (memBind === "stripped") {
              return memClaims.length > 0
                ? `Found ${memName || name.trim()} · also tagged ${memClaims.join(", ")}`
                : `Found ${memName || name.trim()} — confirm or tap to swap`;
            }
            // exact (memory-book) or non-photo path
            const display = memName || name.trim();
            return display ? `Got it · ${display}` : "Got it — review the fields below.";
          })();
          return (
            <div
              role="status"
              aria-live="polite"
              style={{
                minHeight: 18,
                marginBottom: 6,
                paddingLeft: 4,
                display: "flex",
                alignItems: "center",
                fontFamily: font.sans,
                fontSize: 12,
                letterSpacing: "0.02em",
                color: tone,
                opacity: message ? 1 : 0,
                transition: "opacity 200ms ease, color 200ms ease",
              }}
            >
              {message}
              {/* "miss" and "error" intentionally render nothing here.
                  Both states route the user into MemoryBookCapture so
                  a failed scan never reaches the user as a failure
                  message. See feedback_scan_never_fails.md. */}
            </div>
          );
        })()}


        {/* Name + canonical typeahead — as the user types we
            float a dropdown of matching canonical ingredients
            below the input. Picking a row swaps the text for
            the canonical's display name AND locks the
            canonicalId axis in one tap (same self-teaching
            cascade as classic Kitchen, just folded into the
            primary entry control). The scan button sits pinned
            to the right edge of the same input so the second
            entry path (scan a barcode) lives in the same
            visual row. */}
        {/* Field label row — "NAME" on the left, scan-prompt
            hint on the right urging the user toward the
            scanner for fast entry. Hint hides once a canonical
            lands (scanner is most useful BEFORE identifying
            the item; afterwards it'd just nag). */}
        <div style={{
          display: "flex", alignItems: "baseline",
          justifyContent: "space-between", gap: 8,
        }}>
          <FieldLabel theme={theme}>Name</FieldLabel>
          <AnimatePresence>
            {!canonicalId && (
              <motion.span
                key="scan-hint"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 0.92, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  fontFamily: font.detail,
                  fontStyle: "italic",
                  fontWeight: 400,
                  fontSize: 12,
                  color: axis.storedIn, // matches the scan halo
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Try the UPC Scanner for instant results!
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {(() => {
          // Inline State pill — sits at the right end of the
          // Name input, just before the scan button. Only shows
          // once a canonical with a state vocabulary is pinned
          // (cheese, meat, bread, etc.). Paddings adjust based
          // on whether the pill is rendering so a long typed
          // name doesn't collide with it.
          const stateOpts = canonicalId ? (statesForIngredient(canonicalId) || []) : [];
          const showStatePill = stateOpts.length > 0;
          const stateLabel = state ? (STATE_LABELS[state] || state) : null;
          const stateTone = axis.state;
          // padRight is locked to a single value so the input
          // doesn't reflow as the state pill appears / its label
          // shortens / lengthens. Reserves max-room (scan icon +
          // longest expected state label) — small phones lose a
          // little typing width, but the form stops jittering on
          // every keystroke / canonical-resolve.
          const padRight = 186;
          return (
        <div style={{ position: "relative" }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              const next = e.target.value;
              setName(next);
              setSuppressTypeahead(false);
              // FULL RESET when the user clears the name input.
              // The form is the user's notion of "this item I'm
              // adding"; clearing the name means they're starting
              // over. Wipe every downstream filter / pick so the
              // progress strip drops back to 0 and the avatar
              // returns to her most-frustrated face.
              if (next.trim().length === 0) {
                setCanonicalId(null);
                setCanonicalOverridden(false);
                setTypeId(null);
                setTypeOverridden(false);
                setTileId(null);
                setTileOverridden(false);
                setState(null);
                setStateOverridden(false);
                setLocationOverridden(false);
                setPackageSize("");
                setUnit("");
                setBrand("");
                setRemaining(1);
                setExpiresAt("auto");
                setBarcodeUpc(null);
                setScanStatus(null);
                setAttemptedSubmit(false);
                return;
              }
              // Release the canonical-override lock when the
              // typed text diverges from the bound canonical's
              // display name. Without this, picking "Cheddar"
              // and then editing to "Mozzarella" leaves the
              // canonical pinned to cheddar forever. The check
              // is "no longer the canonical's name (case- and
              // trim-insensitive)" so light typos / backspacing
              // mid-name still keep the lock — only a real
              // divergence releases it.
              //
              // Synthetic-slug fallback: AI-minted user-tier slugs
              // ("caramel_dip" from a memory-book scan) aren't in
              // the bundled registry, so findIngredient returns null
              // and lockedName would be "" — which would release the
              // lock on ANY keystroke. Compare against the slug's
              // own name (or the current `name` state) so the lock
              // holds for synthetic canonicals too.
              if (canonicalOverridden && canonicalId) {
                const ing = findIngredient(canonicalId);
                const lockedName = (ing?.name
                  || (typeof name === "string" ? name : "")
                ).trim().toLowerCase();
                if (lockedName && next.trim().toLowerCase() !== lockedName) {
                  setCanonicalOverridden(false);
                  setTypeOverridden(false);
                  setTileOverridden(false);
                  setStateOverridden(false);
                  setLocationOverridden(false);
                }
              }
            }}
            onFocus={() => setNameFocused(true)}
            onBlur={() => {
              // Defer the close so a click on a suggestion
              // row lands before this blur unmounts it. 120ms
              // tracks the suggestion list's animation budget.
              setTimeout(() => setNameFocused(false), 120);
            }}
            placeholder="e.g. Sourdough Loaf"
            style={{
              ...inputBase,
              fontFamily: font.itemName,
              fontWeight: 300,
              fontSize: 32,
              lineHeight: 1,
              paddingRight: padRight,
              // Halo cascade — first match wins:
              //   1. validation error (mustard, after attempted submit)
              //   2. focus (teal, while user is typing)
              //   3. AI bind cue — mustard halo when bindConfidence is
              //      "stripped" or "guessed" so the user's eye lands on
              //      the field that needs a glance/refine.
              //   4. plain border.
              border:
                showErrors && errorFields.has("canonical")
                  ? `1px solid ${theme.color.mustard}`
                  : nameFocused
                    ? `1px solid ${theme.color.teal}`
                    : (!canonicalOverridden
                       && (scanDebug?.memoryBook?.bindConfidence === "stripped"
                           || scanDebug?.memoryBook?.bindConfidence === "guessed"))
                      ? `1px solid ${withAlpha(theme.color.mustard, 0.55)}`
                      : inputBase.border,
              boxShadow:
                showErrors && errorFields.has("canonical")
                  ? `0 0 0 3px ${withAlpha(theme.color.mustard, 0.18)}, ${theme.shadow.inputInset}`
                  : nameFocused
                    ? `0 0 0 3px ${withAlpha(theme.color.teal, 0.14)}, ${theme.shadow.inputInset}`
                    : (!canonicalOverridden
                       && (scanDebug?.memoryBook?.bindConfidence === "stripped"
                           || scanDebug?.memoryBook?.bindConfidence === "guessed"))
                      ? `0 0 0 3px ${withAlpha(theme.color.mustard, 0.10)}, ${theme.shadow.inputInset}`
                      : inputBase.boxShadow,
              transition: "border-color 200ms ease, box-shadow 200ms ease",
            }}
          />
          {showStatePill && (
            <motion.button
              key="state-pill"
              type="button"
              className="mcm-focusable"
              initial={{ opacity: 0, scale: 0.85, x: 6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              onClick={() => setPickerOpen("state")}
              aria-label={stateLabel ? `State: ${stateLabel}` : "Pick a state"}
              title={stateLabel ? `State · ${stateLabel}` : "Pick a state"}
              style={{
                position: "absolute",
                top: "50%",
                // Sits left of the scan icon (which is at
                // right: -10 with width 64 — so the right edge
                // of the input border is at right: 0, and the
                // scan icon's circle starts at right: 26 of the
                // button's bbox). 70px gives breathing room.
                right: 70,
                transform: "translateY(-50%)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: stateLabel
                  ? `1px solid ${withAlpha(stateTone, 0.55)}`
                  : `1px dashed ${withAlpha(stateTone, 0.55)}`,
                background: stateLabel
                  ? `linear-gradient(${withAlpha(stateTone, 0.22)}, ${withAlpha(stateTone, 0.22)}), ${theme.color.glassFillHeavy}`
                  : `linear-gradient(${withAlpha(stateTone, 0.06)}, ${withAlpha(stateTone, 0.06)}), ${theme.color.glassFillHeavy}`,
                color: stateLabel ? theme.color.ink : theme.color.inkMuted,
                fontFamily: font.detail,
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: 13,
                cursor: "pointer",
                whiteSpace: "nowrap",
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                transition: "background 200ms ease, border-color 200ms ease",
              }}
            >
              <span style={{
                overflow: "hidden", textOverflow: "ellipsis",
              }}>{stateLabel || "+ state"}</span>
              <span aria-hidden style={{
                fontSize: 10, color: theme.color.inkFaint,
                fontStyle: "normal", flexShrink: 0,
              }}>▾</span>
            </motion.button>
          )}
          <button
            type="button"
            className="mcm-focusable"
            onClick={() => { setScanStatus(null); setScanning(true); }}
            aria-label="Scan a barcode"
            title="Scan a barcode"
            style={{
              position: "absolute",
              top: "50%",
              right: -10,
              transform: "translateY(-50%)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              // 10% bigger than the prior 64 — gives the
              // scanner a little more visual weight at the
              // right edge of the bar without breaking the
              // input's right-padding clearance.
              width: 70, height: 70,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              transition: "transform 120ms ease, opacity 120ms ease",
            }}
          >
            <img
              src="/icons/upc_scanner.svg"
              alt=""
              aria-hidden
              // Halo only while the form's still in progress —
              // once the human "wins" (all required fields set),
              // the scanner concedes: class drops + a grayscale
              // + dimmed-brightness filter takes over. Opacity
              // stays at 1 so the SVG's baked-in circle still
              // fully covers the input border behind it (a 50%
              // opacity reveal looked like a render bug).
              className={formReady ? undefined : "mise-scan-halo"}
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                display: "block",
                filter: formReady
                  ? "grayscale(1) brightness(0.7)"
                  : undefined,
                transition: "filter 600ms ease",
              }}
            />
          </button>
          {nameFocused && !suppressTypeahead && (nameSuggestions.length > 0 || name.trim().length >= 2) && (
            <div
              role="listbox"
              aria-label="Canonical suggestions"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0, right: 0,
                zIndex: 5,
                padding: 6,
                borderRadius: 14,
                background: theme.color.glassFillHeavy,
                border: `1px solid ${theme.color.glassBorder}`,
                backdropFilter: "blur(20px) saturate(150%)",
                WebkitBackdropFilter: "blur(20px) saturate(150%)",
                boxShadow: "0 18px 36px rgba(20,12,4,0.28), 0 4px 12px rgba(20,12,4,0.16)",
                ...THEME_TRANSITION,
              }}
            >
              {nameSuggestions.map(ing => (
                <button
                  key={ing.id}
                  type="button"
                  role="option"
                  aria-selected={ing.id === canonicalId}
                  className="mcm-focusable"
                  // onMouseDown fires before onBlur on the input,
                  // so the pick lands without a click being lost.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setName(ing.name);
                    setCanonicalId(ing.id);
                    setCanonicalOverridden(true);
                    // Unlock the downstream axes so the
                    // category + tile re-derive against the
                    // freshly-picked canonical's metadata. The
                    // user picking a canonical means they
                    // trust our cascade — any prior manual
                    // category / tile override should release
                    // so the new canonical drives those values.
                    setTypeOverridden(false);
                    setTileOverridden(false);
                    setStateOverridden(false);
                    setLocationOverridden(false);
                    setSuppressTypeahead(true);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    width: "100%",
                    padding: "8px 10px",
                    margin: "1px 0",
                    borderRadius: 10,
                    border: "1px solid transparent",
                    background: ing.id === canonicalId
                      ? `linear-gradient(${withAlpha(axis.canonical, 0.18)}, ${withAlpha(axis.canonical, 0.18)}), transparent`
                      : "transparent",
                    cursor: "pointer", textAlign: "left",
                    color: theme.color.ink,
                    transition: "background 140ms ease",
                  }}
                  onMouseEnter={(e) => { if (ing.id !== canonicalId) e.currentTarget.style.background = withAlpha(theme.color.ink, 0.05); }}
                  onMouseLeave={(e) => { if (ing.id !== canonicalId) e.currentTarget.style.background = "transparent"; }}
                >
                  {ing.emoji && <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{ing.emoji}</span>}
                  <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 500 }}>
                      {ing.name}
                    </span>
                    {ing.category && (
                      <span style={{
                        fontFamily: font.detail, fontStyle: "italic", fontWeight: 400,
                        fontSize: 12, color: theme.color.inkMuted, marginTop: 1,
                      }}>
                        {ing.category}
                      </span>
                    )}
                  </span>
                  {ing.id === canonicalId && (
                    <span style={{ color: axis.canonical, fontSize: 14 }}>✓</span>
                  )}
                </button>
              ))}
              {/* No-results escape hatch — when the typed name
                  doesn't match any bundled canonical, surface a
                  "+ Add canonical" row that creates a new
                  user-scoped canonical from the typed text.
                  Slug-cases the input so the underlying
                  pantry_items.canonical_id stays URL-safe; the
                  CLAUDE.md self-teaching cascade picks it up
                  the same as a bundled slug. */}
              {nameSuggestions.length === 0 && name.trim().length >= 2 && (
                <button
                  type="button"
                  role="option"
                  className="mcm-focusable"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const sourceName = name.trim();
                    const slug = sourceName.toLowerCase()
                      .replace(/[^a-z0-9]+/g, "_")
                      .replace(/^_+|_+$/g, "");
                    if (!slug) return;
                    setCanonicalId(slug);
                    setCanonicalOverridden(true);
                    setTypeOverridden(false);
                    setTileOverridden(false);
                    setStateOverridden(false);
                    setLocationOverridden(false);
                    setSuppressTypeahead(true);
                    // Parity with the AI photo flow: register the
                    // freshly-minted slug in pending_ingredient_info
                    // so it stops being a "shell" — refreshPending
                    // pulls it into the local map, useIngredientInfo's
                    // dbMap+pendingMap merge re-registers the alias
                    // map, and the typeahead / inferCanonicalFromName
                    // can find this slug from any other surface in
                    // the app (other Add forms, Item edits, recipe
                    // pairing). Fire-and-forget — failure here just
                    // means the slug doesn't enrich, the row still
                    // commits with canonicalId set.
                    enrichIngredient({ source_name: sourceName })
                      .then(() => refreshPending?.())
                      .catch(err =>
                        console.warn("[mcm-add] typeahead canonical enrich failed:", err?.message || err),
                      );
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    width: "100%",
                    padding: "10px 10px",
                    margin: "1px 0",
                    borderRadius: 10,
                    border: `1px dashed ${withAlpha(axis.canonical, 0.45)}`,
                    background: "transparent",
                    cursor: "pointer", textAlign: "left",
                    color: theme.color.ink,
                    transition: "background 140ms ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(axis.canonical, 0.10); }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{
                    fontSize: 18, lineHeight: 1, flexShrink: 0,
                    color: axis.canonical,
                  }}>+</span>
                  <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 500 }}>
                      Add "{name.trim()}" as a new canonical
                    </span>
                    <span style={{
                      fontFamily: font.detail, fontStyle: "italic", fontWeight: 400,
                      fontSize: 12, color: theme.color.inkMuted, marginTop: 1,
                    }}>
                      Saved to your kitchen — admin can promote later.
                    </span>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
          );
        })()}

        {/* Package size, Expires, and Brand stay hidden behind a
            pinned canonical: without a canonical the unit dropdown
            options are generic, popular-size observations are empty,
            and brand suggestions have no anchor — showing all that
            empty scaffolding lets the form look busy before the user
            has done anything. Once canonical lands, the cascade has
            real metadata to populate every downstream section. */}
        {canonicalId && (<>
        {/* Package size — single bar with a typeable amount on
            the left and a unit dropdown pinned right. Unit
            options are derived from the active canonical's
            `units` array (so "butter" gets stick / tbsp / cup /
            oz / lb / block / tub / g), with a sane default
            list as fallback when no canonical is set. The
            dropdown is a chip → ModalSheet picker per the
            CLAUDE.md "no <select> for axes" rule. */}
        <FieldLabel theme={theme} style={{ marginTop: 14 }}>Package size</FieldLabel>
        <div style={{
          display: "flex", alignItems: "stretch", gap: 0,
          // Validation halo on the package-size bar covers
          // both packageSize and unit since they share one
          // visual unit. Mustard ring + tinted border when
          // either is flagged after attempted submit.
          border: showErrors && (errorFields.has("packageSize") || errorFields.has("unit"))
            ? `1px solid ${theme.color.mustard}`
            : `1px solid ${theme.color.hairline}`,
          background: theme.color.glassFillHeavy,
          borderRadius: 12,
          boxShadow: showErrors && (errorFields.has("packageSize") || errorFields.has("unit"))
            ? `0 0 0 3px ${withAlpha(theme.color.mustard, 0.18)}, ${theme.shadow.inputInset}`
            : theme.shadow.inputInset,
          overflow: "hidden",
          transition: "border-color 200ms ease, box-shadow 200ms ease",
        }}>
          <input
            type="number"
            inputMode="decimal"
            value={packageSize}
            onChange={(e) => setPackageSize(e.target.value)}
            placeholder="16"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              color: theme.color.ink,
              padding: "12px 14px",
              fontFamily: font.itemSub,
              fontSize: 16,
              outline: "none",
            }}
          />
          {(() => {
            const ing = canonicalId ? findIngredient(canonicalId) : null;
            const units = ing?.units && ing.units.length > 0
              ? ing.units
              : DEFAULT_UNIT_OPTIONS;
            const active = units.find(u => u.id === unit) || null;
            return (
              <button
                type="button"
                className="mcm-focusable"
                onClick={() => setPickerOpen("unit")}
                aria-label={active ? `Unit: ${active.label}` : "Pick a unit"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: "none",
                  borderLeft: `1px solid ${theme.color.hairline}`,
                  background: "transparent",
                  color: unit ? theme.color.ink : theme.color.inkMuted,
                  padding: "0 14px",
                  fontFamily: font.itemSub,
                  fontSize: 16,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  minWidth: 96,
                  justifyContent: "space-between",
                }}
              >
                <span>{active ? active.label : (unit || "unit")}</span>
                <span aria-hidden style={{ fontSize: 11, color: theme.color.inkFaint }}>▾</span>
              </button>
            );
          })()}
        </div>

        {/* Popular-package quick-picks — surfaced once a canonical
            is pinned. Reads from popular_package_sizes (RPC),
            ranked brand-first then canonical-wide. Tap a chip to
            slam both Package size and Unit at once; the chip
            highlights when its values match the current pair so
            the user sees what's currently selected. */}
        {canonicalId && popularPackages.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{
              fontFamily: font.mono, fontSize: 10,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: theme.color.inkFaint,
              marginBottom: 6,
            }}>
              Popular sizes
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {popularPackages.map((p, i) => {
                const active = Number(packageSize) === p.amount && (unit || "").toLowerCase() === (p.unit || "").toLowerCase();
                const fmt = (n) => Number.isInteger(n) ? String(n) : Number(n).toFixed(1);
                return (
                  <button
                    key={`${p.amount}-${p.unit}-${i}`}
                    type="button"
                    className="mcm-focusable"
                    onClick={() => {
                      setPackageSize(String(p.amount));
                      setUnit(p.unit || "");
                      setRemaining(1);
                      // Only auto-fill brand when the user hasn't
                      // typed one — picking "16 oz · Marketside"
                      // implies they want the brand too, but a
                      // user-typed brand should never get
                      // clobbered by a chip pick.
                      if (p.brand && !brand.trim()) {
                        setBrand(p.brand);
                      }
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: active
                        ? `1px solid ${withAlpha(theme.color.teal, 0.55)}`
                        : `1px solid ${theme.color.hairline}`,
                      background: active
                        ? `linear-gradient(${withAlpha(theme.color.teal, 0.18)}, ${withAlpha(theme.color.teal, 0.18)}), ${theme.color.glassFillHeavy}`
                        : "transparent",
                      color: active ? theme.color.ink : theme.color.inkMuted,
                      fontFamily: font.detail,
                      fontStyle: "italic",
                      fontWeight: 400,
                      fontSize: 13,
                      cursor: "pointer",
                      transition: "background 160ms ease, border-color 160ms ease",
                    }}
                  >
                    <span>{fmt(p.amount)} {p.unit}</span>
                    {p.brand && (
                      <span style={{
                        fontFamily: font.mono, fontSize: 9,
                        color: theme.color.inkFaint,
                        letterSpacing: "0.04em",
                      }}>
                        · {p.brand}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Remaining slider — only renders once the package size
            is set (you can't visualize "what's left" without
            knowing the full container). Defaults to sealed/full
            so a fresh-from-the-store add reads as 100%. Drag to
            log an item that's already been opened (e.g. moving
            a half-finished jar over from another household).
            Mirrors classic Kitchen's amount/max model: amount
            === max → SEALED, amount < max → OPENED. */}
        {(() => {
          const pkgN = Number(packageSize);
          if (!Number.isFinite(pkgN) || pkgN <= 0) return null;
          const remainingAmount = pkgN * Math.max(0, Math.min(1, remaining));
          const isSealed = remaining >= 0.999;
          const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1);
          const sliderColor = isSealed ? theme.color.teal : theme.color.burnt;
          return (
            <div style={{ marginTop: 14 }}>
              <div style={{
                display: "flex", alignItems: "baseline", justifyContent: "space-between",
                marginBottom: 6,
              }}>
                <span style={{
                  fontFamily: font.mono, fontSize: 11,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: isSealed ? theme.color.teal : theme.color.burnt,
                  fontWeight: 600,
                }}>
                  {isSealed ? "Sealed" : "Opened"}
                </span>
                <span style={{
                  fontFamily: font.mono, fontSize: 12,
                  color: theme.color.inkMuted,
                }}>
                  {fmt(remainingAmount)} / {fmt(pkgN)} {unit || ""}
                </span>
              </div>
              <input
                type="range"
                min="0" max="1" step="0.01"
                value={remaining}
                onChange={(e) => setRemaining(Number(e.target.value))}
                aria-label="How much is left in the package"
                style={{
                  width: "100%",
                  accentColor: sliderColor,
                  // Tap targets — bigger thumb on touch devices
                  // via accentColor + the input's native min height
                  // already provides this on iOS / Android.
                }}
              />
            </div>
          );
        })()}

        {/* Expiration chip — three states:
            • "auto" — system computes from the canonical's
              storage.shelfLife at submit. Default for new adds.
              Pill shows a preview ("Auto · ~14 days") when the
              canonical exposes a shelf-life window.
            • null — explicit shelf-stable, no clock.
            • Date — explicit user pick.
            KitchenCard's days-chip + spoilage aura kick in once
            a date materializes. */}
        <FieldLabel theme={theme} style={{ marginTop: 14 }}>Expires</FieldLabel>
        {(() => {
          const tone = axis.state;
          const isAuto = expiresAt === "auto";
          const isDate = expiresAt instanceof Date;
          const isShelfStable = expiresAt === null;
          // Shared humanizer so "Auto · in ~14 days" and
          // "In ~14 days" use the same scale (days → weeks →
          // months → years) and never read 365-day labels.
          const humanizeDays = (days) => {
            if (days <= 0) return "Today";
            if (days === 1) return "Tomorrow";
            if (days < 14) return `${days} days`;
            if (days < 30) return `${Math.round(days / 7)} weeks`;
            if (days < 365) return `~${Math.round(days / 30)} months`;
            const years = Math.round(days / 365);
            return `~${years} year${years === 1 ? "" : "s"}`;
          };
          let label;
          if (isAuto) {
            label = autoDays ? `Auto · in ${humanizeDays(autoDays)}` : "Auto";
          } else if (isShelfStable) {
            label = "Doesn't expire";
          } else if (isDate) {
            const now = new Date();
            const days = Math.round((expiresAt - now) / 86400000);
            label = days <= 0 ? "Today"
              : days === 1 ? "Tomorrow"
              : `In ${humanizeDays(days)}`;
          }
          // Treat any non-null value (auto OR explicit date) as
          // "set" for visual state — both carry an active clock.
          const active = isAuto || isDate;
          return (
            <button
              type="button"
              className="mcm-focusable"
              onClick={() => setPickerOpen("expires")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 999,
                border: active
                  ? `1px solid ${withAlpha(tone, 0.45)}`
                  : `1px dashed ${theme.color.hairline}`,
                background: active
                  ? `linear-gradient(${withAlpha(tone, 0.18)}, ${withAlpha(tone, 0.18)}), ${theme.color.glassFillHeavy}`
                  : "transparent",
                color: active ? theme.color.ink : theme.color.inkMuted,
                fontFamily: font.detail,
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: 16,
                cursor: "pointer",
                transition: "background 200ms ease, border-color 200ms ease",
              }}
            >
              <span>{label}</span>
              <span aria-hidden style={{
                fontSize: 11, color: theme.color.inkFaint,
                fontStyle: "normal",
              }}>▾</span>
            </button>
          );
        })()}

        {/* Brand — last identifying axis. Per the user's stated
            progression, brand isn't how you find the canonical;
            it's the final lookup once everything else is set
            (canonical → state → package → fullness → expires →
            brand) so the brand-nutrition / popular-package
            observations can stamp the row with the most-precise
            metadata available. The typeahead surfaces brands the
            household has previously logged against this canonical;
            free-text still works for one-offs. */}
        <FieldLabel theme={theme} style={{ marginTop: 14 }}>Brand <span style={{ opacity: 0.5 }}>(optional)</span></FieldLabel>
        <div style={{ position: "relative" }}>
          <input
            value={brand}
            onChange={(e) => { setBrand(e.target.value); setSuppressBrandTypeahead(false); }}
            onFocus={() => setBrandFocused(true)}
            onBlur={() => { setTimeout(() => setBrandFocused(false), 120); }}
            placeholder="e.g. Kerrygold"
            style={inputBase}
          />
          {brandFocused && !suppressBrandTypeahead && filteredBrandSuggestions.length > 0 && (
            <div
              role="listbox"
              aria-label="Brand suggestions"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0, right: 0,
                zIndex: 5,
                padding: 6,
                borderRadius: 14,
                background: theme.color.glassFillHeavy,
                border: `1px solid ${theme.color.glassBorder}`,
                backdropFilter: "blur(20px) saturate(150%)",
                WebkitBackdropFilter: "blur(20px) saturate(150%)",
                boxShadow: "0 18px 36px rgba(20,12,4,0.28), 0 4px 12px rgba(20,12,4,0.16)",
                ...THEME_TRANSITION,
              }}
            >
              {filteredBrandSuggestions.map(b => {
                const active = b.toLowerCase() === brand.trim().toLowerCase();
                return (
                  <button
                    key={b}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="mcm-focusable"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setBrand(b);
                      setSuppressBrandTypeahead(true);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      width: "100%",
                      padding: "8px 10px",
                      margin: "1px 0",
                      borderRadius: 10,
                      border: "1px solid transparent",
                      background: active
                        ? `linear-gradient(${withAlpha(theme.color.teal, 0.16)}, ${withAlpha(theme.color.teal, 0.16)}), transparent`
                        : "transparent",
                      cursor: "pointer", textAlign: "left",
                      color: theme.color.ink,
                      transition: "background 140ms ease",
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = withAlpha(theme.color.ink, 0.05); }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 500, flex: 1 }}>
                      {b}
                    </span>
                    {active && <span style={{ color: theme.color.teal, fontSize: 14 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        </>)}

        {/* Scan data viewer — only renders after a scan has populated
            scanDebug. Shows source, nutrition macros, identity fields,
            tag arrays, and a collapsible raw payload so the user can
            verify what we extracted from OFF / cache / correction. */}
        <ScanDataPanel scanDebug={scanDebug} theme={theme} />

        {/* Location segmented row — matches FloatingLocationDock
            color treatment so users see the same swatch system
            here as on the dock. */}
        <FieldLabel theme={theme} style={{ marginTop: 14 }}>Where does it go?</FieldLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 4 }}>
          {LOCATIONS.map((loc) => {
            const active = location === loc.id;
            const dotColor = LOCATION_DOT[loc.id];
            return (
              <button
                key={loc.id}
                type="button"
                className="mcm-focusable"
                onClick={() => {
                  setLocation(loc.id);
                  // Lock the user's explicit pick so the
                  // canonical-driven auto-resolve doesn't keep
                  // re-overriding it on subsequent canonical
                  // changes.
                  setLocationOverridden(true);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "10px 8px",
                  borderRadius: 12,
                  border: active
                    ? `1px solid ${withAlpha(dotColor, 0.45)}`
                    : `1px solid ${theme.color.hairline}`,
                  background: active
                    ? `linear-gradient(${withAlpha(dotColor, 0.18)}, ${withAlpha(dotColor, 0.18)}), ${theme.color.glassFillHeavy}`
                    : "transparent",
                  color: active ? theme.color.ink : theme.color.inkMuted,
                  fontFamily: font.sans,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "background 200ms ease, color 200ms ease, border-color 200ms ease",
                }}
              >
                <span style={{
                  display: "inline-block",
                  width: 8, height: 8,
                  borderRadius: "50%",
                  background: dotColor,
                  boxShadow: `0 1px 2px rgba(30,20,8,0.20)`,
                }} />
                {loc.label}
              </button>
            );
          })}
        </div>

        {/* Action row */}
        <div style={{
          display: "flex", gap: 10, marginTop: 22,
          justifyContent: "flex-end",
        }}>
          <button
            type="button"
            className="mcm-focusable"
            onClick={onClose}
            // Hover brightens the border + text without
            // pulling the eye away from the primary submit.
            // The inline handlers keep us off a global :hover
            // CSS rule (we'd need a stylesheet for that).
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = withAlpha(theme.color.ink, 0.18);
              e.currentTarget.style.color = theme.color.ink;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = theme.color.hairline;
              e.currentTarget.style.color = theme.color.inkMuted;
            }}
            style={{
              padding: "12px 18px",
              borderRadius: 999,
              border: `1px solid ${theme.color.hairline}`,
              background: "transparent",
              color: theme.color.inkMuted,
              fontFamily: font.sans, fontSize: 14, fontWeight: 500,
              cursor: "pointer",
              transition: "border-color 160ms ease, color 160ms ease",
            }}
          >
            Cancel
          </button>
          <PrimaryButton
            onClick={handleSubmit}
            // Teal halo breathes around the submit when the
            // form is fully validated. Reads as "yes, you can
            // press this now" — matches the strip's Ready
            // green-state so the two visual cues sync.
            className={formReady ? "mise-submit-ready" : undefined}
            style={{
              padding: "12px 22px",
              fontSize: 14,
              transition: "background 320ms ease, border-color 320ms ease, color 320ms ease, box-shadow 320ms ease, opacity 320ms ease",
              ...(formReady
                ? { opacity: 1, cursor: "pointer" }
                : {
                    // Skeletal until the form's ready — strips
                    // the burnt CTA gradient, white border, and
                    // drop-shadow so the button reads as
                    // "not pressable yet" instead of the typical
                    // tap-me orange. The moment formReady flips
                    // true, the underlying ctaButton styling
                    // snaps back in (320ms crossfade). Click
                    // still fires handleSubmit — which surfaces
                    // the per-field halos so the user sees what
                    // they're missing.
                    background: "transparent",
                    border: `1px dashed ${withAlpha(theme.color.ink, 0.18)}`,
                    color: theme.color.inkFaint,
                    boxShadow: "none",
                    opacity: 1,
                    cursor: "default",
                  }),
            }}
          >
            {(() => {
              // User-created canonicals (via "+ Add canonical")
              // aren't in the bundled INGREDIENTS map, so
              // findIngredient returns null even though
              // canonicalId is set. Fall through to the typed
              // name so the submit doesn't read the generic
              // "Add to kitchen" right after the user just
              // committed a fresh canonical from their typing.
              if (canonicalId) {
                const display = findIngredient(canonicalId)?.name || name.trim();
                if (display) return `Add ${display}`;
              }
              return "Add to kitchen";
            })()}
          </PrimaryButton>
        </div>
      </motion.div>

      {/* Barcode scanner overlay — mounts full-screen above the
          sheet when the user taps "Scan a barcode". Owns its own
          camera stream; tearing down on close is the scanner's
          responsibility. handleScan also flips `scanning` off so
          the overlay unmounts cleanly after a successful read. */}
      {scanning && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "#000",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <BarcodeScanner
            onDetected={handleScan}
            onCancel={() => setScanning(false)}
          />
        </div>
      )}

      {/* Memory-book capture flow. Auto-opens whenever a UPC scan
          terminates with no usable signal (no OFF data, no learned
          correction, no resolver hit) — never a "scan failed"
          message. The user is invited to document the product;
          Haiku reads the photo, optional nutrition-panel photo
          fills in the macros, and the result populates this sheet
          via the merge inside onComplete. See
          feedback_scan_never_fails.md. */}
      {memoryBookOpen && (
        <MemoryBookCapture
          barcodeUpc={barcodeUpc}
          offCategoryHints={scanCategoryHints}
          onComplete={(row) => {
            setMemoryBookOpen(false);
            // Merge the AI-extracted axes into the form state.
            // Pre-fill ONLY empty slots so any user edits made
            // before opening the memory book aren't stomped.
            if (row?.name && !name.trim())            setName(row.name);
            if (row?.brand && !brand.trim())          setBrand(row.brand);
            if (row?.canonicalId && !canonicalOverridden) {
              setCanonicalId(row.canonicalId);
              // Same lock pattern as handleScan — AI-synthesized slugs
              // ("caramel_dip") aren't in the alias map yet, so the
              // name→inference effect would otherwise re-render the
              // canonical back to null. Lock holds until user diverges.
              setCanonicalOverridden(true);
            }
            if (row?.typeId && !typeOverridden)       setTypeId(row.typeId);
            if (row?.tileId && !tileOverridden) {
              setTileId(row.tileId);
              setTileOverridden(true);
            }
            if (row?.packageAmount && !packageSize) {
              setPackageSize(String(row.packageAmount));
            }
            if (row?.packageUnit && !unit)            setUnit(row.packageUnit);
            // Stash the AI's canonical decision metadata into
            // scanDebug so the panel below shows the bind tier
            // (exact / stripped / guessed) and the user can verify
            // whether AI guessed or matched a registry entry.
            setScanDebug(prev => ({
              ...(prev || { upc: barcodeUpc }),
              memoryBook: {
                bindConfidence:    row?.bindConfidence    || "guessed",
                canonicalDecision: row?.canonicalDecision || null,
                canonicalScore:    row?.canonicalScore    ?? null,
                canonicalName:     row?.canonicalName     || null,
                claims:            Array.isArray(row?.claims) ? row.claims : [],
                aiConfidence:      row?.confidence        || null,
              },
              finalCanonicalId: row?.canonicalId || prev?.finalCanonicalId || null,
              at: new Date().toISOString(),
            }));
            // Land the scan-found banner — same affordance the
            // happy-path scan uses so the user knows the form is
            // ready to review.
            setScanStatus("found");
            // Teach barcode-correction memory so the next scan of
            // this UPC pairs without re-running Haiku. Best-effort;
            // failures here never block the user's flow.
            if (row?.learnedCorrection?.barcodeUpc && row.learnedCorrection.canonicalId && userId) {
              rememberBarcodeCorrection({
                userId,
                isAdmin: !!isAdmin,
                ...row.learnedCorrection,
              }).catch((err) =>
                console.warn("[mcm-add] memory-book correction write failed:", err?.message || err),
              );
            }
            // Pending-canonical seed — AI minted a fresh slug (caramel_dip
            // wasn't in the registry). Without this write the slug lives
            // on pantry_items but isn't searchable: typeahead's allCanonicals
            // pool only contains bundled INGREDIENTS + dbCanonicalsSnapshot,
            // and dbCanonicalsSnapshot pulls from registerCanonicalsFromDb
            // (now seeded with dbMap + pendingMap together — see
            // useIngredientInfo's effect). Firing enrichIngredient writes
            // to pending_ingredient_info; refreshPending pulls it back into
            // the local map; the alias map invalidates and the next type
            // / search hit finds the synthetic. Fire-and-forget — failure
            // here doesn't block the form.
            if (
              row?.bindConfidence === "guessed"
              && row?.canonicalId
              && row?.canonicalName
            ) {
              enrichIngredient({
                source_name: row.canonicalName,
              })
                .then(() => refreshPending?.())
                .catch(err =>
                  console.warn("[mcm-add] pending canonical seed failed:", err?.message || err),
                );
            }
            // brand_nutrition write — when the photo flow's nutrition-
            // label scan landed, persist the (canonical, brand) row so
            // future scans of this UPC hit the cache instead of re-running
            // Haiku. Same fire-and-forget pattern as the OFF-success path
            // in handleScan above.
            if (
              row?.nutrition
              && row?.canonicalId
              && row?.brand
              && typeof upsertBrandNutrition === "function"
            ) {
              upsertBrandNutrition({
                canonicalId: row.canonicalId,
                brand:       row.brand,
                nutrition:   row.nutrition,
                barcode:     row.barcodeUpc || barcodeUpc || null,
                source:      "memory_book",
                sourceId:    row.barcodeUpc || barcodeUpc || null,
                confidence:  60,
              }).catch((err) =>
                console.warn("[mcm-add] memory-book brand_nutrition write failed:", err?.message || err),
              );
            }
          }}
          onCancel={() => setMemoryBookOpen(false)}
        />
      )}

      <AddDraftPickers
        pickerOpen={pickerOpen}
        setPickerOpen={setPickerOpen}
        theme={theme}
        typeId={typeId}
        setTypeId={setTypeId}
        setTypeOverridden={setTypeOverridden}
        canonicalId={canonicalId}
        unit={unit}
        setUnit={setUnit}
        state={state}
        setState={setState}
        setStateOverridden={setStateOverridden}
        expiresAt={expiresAt}
        setExpiresAt={setExpiresAt}
        autoDays={autoDays}
        location={location}
        tileId={tileId}
        setTileId={setTileId}
        setTileOverridden={setTileOverridden}
        setCanonicalId={setCanonicalId}
        setCanonicalOverridden={setCanonicalOverridden}
        allCanonicals={allCanonicals}
      />
    </div>
  );
}

// Field label primitive — small DM Mono uppercase kicker
// above each input. Pulled into a helper so the label voice
// stays consistent across the form's six fields.
function FieldLabel({ theme, children, style }) {
  return (
    <div style={{
      fontFamily: font.mono,
      fontSize: 10,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: theme.color.inkFaint,
      marginBottom: 6,
      ...style,
    }}>
      {children}
    </div>
  );
}
