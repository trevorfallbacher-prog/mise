import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { seedIngredientInfoOnce } from "./seedIngredientInfo";

// Ingredient-metadata context + provider.
//
// Lifts the ingredient_info fetch out of IngredientCard so tapping a pantry
// row is instant. Fetch happens ONCE on App mount; every card just reads
// from the pre-populated context. Opens a card → data is already there.
//
// Two layers for near-zero first paint:
//
//   1. localStorage cache — the full dbMap is stored under CACHE_KEY. On
//      mount we seed React state from the cache, so the first render has
//      data before any network roundtrip. Stale-while-revalidate: the
//      cache paints, the network fetch runs, fresh data replaces it when
//      it lands.
//
//   2. Background seed + refetch — the Provider's effect runs
//      seedIngredientInfoOnce(supabase) (no-op if already seeded this
//      version) then refetches. First-ever login does seed → fetch in
//      sequence so the table is populated before we read from it. Every
//      subsequent mount skips the seeder via its localStorage gate.
//
// useIngredientInfo() (the hook) is unchanged from the consumer's side —
// it still returns { getInfo, dbMap, loading }. The only difference is
// where that state lives (context, not component-local).

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
  dbMap: {},
  loading: true,
});

export function IngredientInfoProvider({ children }) {
  // Seed React state from the cache so the first render has data.
  // Loading=false if cache hit (we already have SOMETHING to paint).
  const initial = readCache();
  const [dbMap, setDbMap] = useState(() => initial || {});
  const [loading, setLoading] = useState(() => !initial);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Seed first so the table has rows before we read. Idempotent — the
      // gate inside seedIngredientInfoOnce short-circuits after the first
      // successful run.
      await seedIngredientInfoOnce(supabase);

      const { data, error } = await supabase
        .from("ingredient_info")
        .select("ingredient_id, info");
      if (!alive) return;
      if (error) {
        console.warn("[ingredient_info] fetch failed (cache/JS fallback still works):", error.message);
        setLoading(false);
        return;
      }
      const map = {};
      for (const row of data || []) {
        map[row.ingredient_id] = row.info || {};
      }
      setDbMap(map);
      writeCache(map);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const getInfo = useCallback(
    (ingredientId) => (ingredientId ? dbMap[ingredientId] || null : null),
    [dbMap]
  );

  const value = useMemo(
    () => ({ getInfo, dbMap, loading }),
    [getInfo, dbMap, loading]
  );

  return (
    <IngredientInfoContext.Provider value={value}>
      {children}
    </IngredientInfoContext.Provider>
  );
}

// Reads from the App-level Provider. Same shape as before the context
// lift so no consumer needs to change.
export function useIngredientInfo() {
  return useContext(IngredientInfoContext);
}
