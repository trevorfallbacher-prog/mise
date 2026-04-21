import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Loads the avatar catalog + the viewer's owned pool, and exposes the
 * RPCs that mutate them. Three pieces of state:
 *
 *   catalog — array of { slug, name, image_url, rarity, sort_order }
 *             from avatar_catalog. Public-read; small (a dozen rows
 *             for a long time), loaded once.
 *   owned   — Set<slug> of avatars the caller owns (user_avatars rows
 *             for auth.uid()). Refreshed after any grant / unlock.
 *   ready   — true once both loads settle.
 *
 * RPC wrappers:
 *   grantStarters() — one-shot starter pack grant. Safe to call on
 *                     every mount; server short-circuits if the user
 *                     already owns anything. Returns the updated pool.
 *   shuffle()       — random mode only. Asks the server to pick a new
 *                     slug and update profiles.avatar_slug + avatar_url.
 *                     Returns the new { slug, url } for optimistic UI.
 *   pin(slug)       — settles on one avatar, flips avatar_mode to
 *                     'pinned'. Server validates ownership.
 *   setMode(mode)   — 'random' | 'pinned' without changing the slug.
 */
export function useAvatars(userId) {
  const [catalog, setCatalog] = useState([]);
  const [owned, setOwned] = useState(new Set());
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [ownedLoading, setOwnedLoading] = useState(true);

  // Catalog is public-read and small; one fetch on first mount is enough.
  // No realtime subscription — catalog additions land with new migrations,
  // not at runtime.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      const { data, error } = await supabase
        .from("avatar_catalog")
        .select("slug,name,image_url,rarity,sort_order")
        .order("sort_order", { ascending: true });
      if (!cancelled) {
        if (error) console.error("[avatars] catalog load:", error);
        setCatalog(data || []);
        setCatalogLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadOwned = useCallback(async () => {
    if (!userId) {
      setOwned(new Set());
      setOwnedLoading(false);
      return;
    }
    setOwnedLoading(true);
    const { data, error } = await supabase
      .from("user_avatars")
      .select("slug")
      .eq("user_id", userId);
    if (error) console.error("[avatars] owned load:", error);
    setOwned(new Set((data || []).map(r => r.slug)));
    setOwnedLoading(false);
  }, [userId]);

  useEffect(() => { loadOwned(); }, [loadOwned]);

  const grantStarters = useCallback(async () => {
    if (!userId) return null;
    const { data, error } = await supabase.rpc("grant_starter_avatars");
    if (error) {
      console.error("[avatars] grant_starters:", error);
      return null;
    }
    await loadOwned();
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { slug: row.avatar_slug, url: row.avatar_url } : null;
  }, [userId, loadOwned]);

  const shuffle = useCallback(async () => {
    if (!userId) return null;
    const { data, error } = await supabase.rpc("shuffle_avatar");
    if (error) {
      console.error("[avatars] shuffle:", error);
      return null;
    }
    // RPC returns `setof` so data is an array; take the first row.
    const row = Array.isArray(data) ? data[0] : data;
    return row ? { slug: row.avatar_slug, url: row.avatar_url } : null;
  }, [userId]);

  const pin = useCallback(async (slug) => {
    if (!userId || !slug) return;
    const { error } = await supabase.rpc("set_avatar", { p_slug: slug });
    if (error) {
      console.error("[avatars] pin:", error);
      throw error;
    }
  }, [userId]);

  const setMode = useCallback(async (mode) => {
    if (!userId || !mode) return;
    const { error } = await supabase.rpc("set_avatar_mode", { p_mode: mode });
    if (error) {
      console.error("[avatars] set_mode:", error);
      throw error;
    }
  }, [userId]);

  return {
    catalog,
    owned,
    ready: !catalogLoading && !ownedLoading,
    grantStarters,
    shuffle,
    pin,
    setMode,
    refreshOwned: loadOwned,
  };
}
