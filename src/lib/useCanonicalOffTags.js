// OFF categoryHint → canonical_id lookup for the resolver's Tier-1
// exact tier. Backed by the off_category_tag_canonicals table (see
// migration 0123). Admin (or crowd) corrections to the barcode
// identity resolver seed this map automatically via
// rememberBarcodeCorrection, so the learning loop is:
//
//   admin rewires one Pepsi Zero scan to `soft_drink`
//       ↓
//   rememberBarcodeCorrection (admin=true) writes both the UPC →
//       canonical entry AND upserts every non-generic OFF hint
//       ("sodas", "colas", "diet-sodas", ...) → soft_drink
//       ↓
//   the next fresh scan of a DIFFERENT soda UPC hits Tier 1
//       via this hook's lookup and auto-lands on soft_drink at
//       "exact" confidence, no manual correction needed
//
// Stays silent on envs that haven't applied migration 0123 —
// PostgREST returns 42P01 which we swallow.
//
// No provider: the scan flow lives inside Kitchen which is a single
// component. If other surfaces later need the map, we'll promote
// this to a Context+Provider pattern like useBrandNutrition /
// useIngredientInfo do, but one SELECT + one channel per session is
// cheap enough that the standalone hook is fine.

import { useCallback, useEffect, useState } from "react";
import { supabase, safeChannel } from "./supabase";

export function useCanonicalOffTags() {
  const [map, setMap] = useState(() => new Map());

  // Initial load.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("off_category_tag_canonicals")
        .select("off_tag, canonical_id");
      if (error) {
        if (error.code !== "42P01") {
          console.warn("[off_tag_map] load failed:", error.message);
        }
        return;
      }
      if (!alive) return;
      const m = new Map();
      for (const row of (data || [])) {
        if (row?.off_tag && row?.canonical_id) {
          m.set(String(row.off_tag).toLowerCase(), row.canonical_id);
        }
      }
      setMap(m);
    })();
    return () => { alive = false; };
  }, []);

  // Realtime. Admin corrections (or cascade rewrites from a slug
  // rename) propagate to every open tab without a page reload.
  useEffect(() => {
    const ch = safeChannel("rt:off_category_tag_canonicals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "off_category_tag_canonicals" },
        (payload) => {
          setMap(prev => {
            const next = new Map(prev);
            if (payload.eventType === "DELETE" && payload.old?.off_tag) {
              next.delete(String(payload.old.off_tag).toLowerCase());
            } else if (payload.new?.off_tag && payload.new?.canonical_id) {
              next.set(
                String(payload.new.off_tag).toLowerCase(),
                payload.new.canonical_id,
              );
            }
            return next;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Stable lookup — signature matches what resolveCanonicalFromScan's
  // `learnedTagLookup` parameter expects: (tag) => canonicalId | null.
  const lookup = useCallback(
    (tag) => {
      if (!tag) return null;
      return map.get(String(tag).toLowerCase()) || null;
    },
    [map],
  );

  return lookup;
}
