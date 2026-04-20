import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { seedIngredientInfoOnce } from "./seedIngredientInfo";
import { registerCanonicalsFromDb } from "../data/ingredients";

// Does this `info` object carry actual enrichment, or is it a ghost
// stub left by admin auto-approve? Three categories of keys live in
// the info JSONB:
//
//   1. Provenance (`_meta`) — who/when. Never counts.
//   2. Routing (`packaging`, `parentId`) — fills specific UI chips
//      (package sizes, hub grouping) but leaves the INGREDIENT
//      description panel empty. A row with ONLY routing keys is
//      effectively a stub from the user's perspective — the
//      INGREDIENT panel reads blank, pairings don't render,
//      substitutions are missing. So routing-only rows count as
//      stubs too.
//   3. Real enrichment (`description`, `flavorProfile`, `pairs`,
//      `substitutions`, `nutrition`, `storage`, etc.) — the stuff
//      that actually populates the ingredient detail view. Any one
//      of these flips the row to "enriched".
//
// Used to drive:
//   * ItemCard's four-state metadata badge (none / stub / pending / enriched)
//   * EnrichmentButton visibility — button shows on both "none" and "stub"
//   * Package chip row resolution — reads `packaging` directly, so
//     stubs-with-packaging still surface chips (the chip UI only
//     needs routing data, not enrichment).
const ROUTING_KEYS = new Set(["_meta", "packaging", "parentId", "display_name", "emoji", "category"]);

export function isMeaningfullyEnriched(info) {
  if (!info || typeof info !== "object") return false;
  if (info?._meta?.stub === true) return false;
  for (const k of Object.keys(info)) {
    if (!ROUTING_KEYS.has(k)) return true;
  }
  return false;
}

// Ingredient-metadata context + provider.
//
// Lifts the ingredient_info fetch out of IngredientCard so tapping a pantry
// row is instant. Fetch happens ONCE on App mount; every card just reads
// from the pre-populated context. Opens a card → data is already there.
//
// Three layers of data, two layers of cache:
//
//   1. dbMap — canonical, admin-approved metadata from `ingredient_info`.
//      Keyed by canonical ingredient_id. This is what users see when the
//      registry has an approved entry.
//
//   2. pendingMap — the current user's unapproved AI enrichments from
//      `pending_ingredient_info`. Keyed by the draft's slug (which is
//      either the canonical ingredient_id, or a slugified source_name for
//      custom items like "nori_from_the_japanese_store"). Only the caller's
//      own drafts are visible — RLS scopes it per-user.
//
//   3. SEED_INGREDIENT_INFO + the JS INGREDIENT_INFO fallback in
//      src/data/ingredients.js are still the final static fallback; those
//      live in code, not here.
//
// Caches:
//   - localStorage under CACHE_KEY (dbMap only — pending is per-user and
//     short-lived so no need to persist across reloads). Paints the UI
//     before the first network roundtrip.
//
// refreshPending() re-fetches the pending map after an enrichment completes
// so the card that triggered the request sees its draft without waiting
// for realtime.

const CACHE_KEY = "mise:ingredient_info:cache:v1";

function readCache() {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(map) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage?.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded / private mode — harmless, we'll refetch next time.
  }
}

const IngredientInfoContext = createContext({
  getInfo: () => null,
  getPendingInfo: () => null,
  dbMap: {},
  pendingMap: {},
  refreshPending: async () => {},
  refreshDb: async () => {},
  loading: true,
});

export function IngredientInfoProvider({ children }) {
  const initial = readCache();
  const [dbMap, setDbMap] = useState(() => initial || {});
  const [pendingMap, setPendingMap] = useState({});
  const [loading, setLoading] = useState(() => !initial);

  // Mirror dbMap into the bundled registry's DB-canonicals map so
  // pure lookup helpers (fuzzyMatchIngredient, findIngredient,
  // inferCanonicalFromName) can see admin-approved user canonicals
  // alongside the 400 JS bundled ones. Fires on initial load (from
  // cache) AND on every refresh so a freshly approved canonical
  // becomes searchable across the app without a page reload. The
  // registry module handles cache invalidation of its alias-map
  // internally.
  useEffect(() => {
    registerCanonicalsFromDb(dbMap);
  }, [dbMap]);

  const fetchPending = useCallback(async () => {
    const { data, error } = await supabase
      .from("pending_ingredient_info")
      .select("slug, info, status")
      .in("status", ["pending", "approved"]);
    if (error) {
      // Likely the table doesn't exist yet (migration not run) or the user
      // is logged out. Either way, the UI still works via dbMap + JS fallback.
      return;
    }
    const map = {};
    for (const row of data || []) {
      map[row.slug] = { info: row.info || {}, status: row.status };
    }
    setPendingMap(map);
  }, []);

  // Pulled out as a useCallback so admin-side writes (approveCustom,
  // approvePending, renameBundled, etc.) can call refreshDb() after
  // an upsert and the running session picks up the new approval
  // without a full page reload. Before this, dbMap was loaded once
  // in the effect body and any mid-session approval was invisible
  // until the user hard-refreshed.
  const fetchDb = useCallback(async () => {
    const { data, error } = await supabase
      .from("ingredient_info")
      .select("ingredient_id, info");
    if (error) {
      console.warn("[ingredient_info] fetch failed (cache/JS fallback still works):", error.message);
      return;
    }
    const map = {};
    for (const row of data || []) {
      map[row.ingredient_id] = row.info || {};
    }
    setDbMap(map);
    writeCache(map);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Seed first so the table has rows before we read. Idempotent — the
      // gate inside seedIngredientInfoOnce short-circuits after the first
      // successful run.
      await seedIngredientInfoOnce(supabase);

      await Promise.all([fetchDb(), fetchPending()]);
      if (!alive) return;
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [fetchDb, fetchPending]);

  const getInfo = useCallback(
    (ingredientId) => (ingredientId ? dbMap[ingredientId] || null : null),
    [dbMap]
  );

  // Slug lookup for user-scoped pending drafts. Used by IngredientCard for
  // canonicals that haven't been seeded yet (slug = canonical id), and by
  // ItemCard for custom pantry items (slug = slugified source_name).
  //
  // Only returns rows that are STILL in pending status. fetchPending()
  // loads both 'pending' and 'approved' rows into pendingMap (so the
  // admin-approved info is available to any future "was this approved"
  // consumer), but the PENDING badge on ItemCard and IngredientCard
  // must only fire while the row is genuinely awaiting review —
  // otherwise an already-approved ingredient reads "✨ PENDING ·
  // Awaiting admin review" forever because the row stayed in the
  // table with status='approved' after the admin clicked APPROVE.
  // The AdminPanel ENRICHMENTS queue already filters
  // `.eq("status","pending")` (AdminPanel.jsx:321); this mirrors
  // that filter for the client-side badge so the two views agree.
  const getPendingInfo = useCallback(
    (slug) => {
      if (!slug) return null;
      const row = pendingMap[slug];
      if (!row || row.status !== "pending") return null;
      return row.info || null;
    },
    [pendingMap]
  );

  const value = useMemo(
    () => ({
      getInfo,
      getPendingInfo,
      dbMap,
      pendingMap,
      refreshPending: fetchPending,
      refreshDb: fetchDb,
      loading,
    }),
    [getInfo, getPendingInfo, dbMap, pendingMap, fetchPending, fetchDb, loading]
  );

  return (
    <IngredientInfoContext.Provider value={value}>
      {children}
    </IngredientInfoContext.Provider>
  );
}

// Reads from the App-level Provider.
export function useIngredientInfo() {
  return useContext(IngredientInfoContext);
}

// Module-scope slug helper so the same algorithm lives in one place on the
// client. Mirrors the server-side slugify in
// supabase/functions/enrich-ingredient/index.ts — keep these in sync.
export function slugifyIngredientName(raw) {
  if (!raw) return "unnamed_ingredient";
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "unnamed_ingredient"
  );
}
