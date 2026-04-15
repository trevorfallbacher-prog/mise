import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, safeChannel } from "./supabase";

// Row shape we render in the UI. Keeps the DB column names out of components.
//
// `isFavorite` is intentionally NOT mapped from cook_logs.is_favorite here
// — that column is a legacy boolean from when only the chef could star
// their own log. Per-viewer favorites moved to the cook_log_favorites
// join (see migration 0016), and consumers enrich each log with an
// `isFavorite` via useMyFavorites() → set-membership check.
function fromDb(row) {
  return {
    id:            row.id,
    userId:        row.user_id,
    recipeSlug:    row.recipe_slug,
    recipeTitle:   row.recipe_title,
    recipeEmoji:   row.recipe_emoji || "🍽️",
    recipeCuisine: row.recipe_cuisine || null,
    recipeCategory: row.recipe_category || null,
    rating:        row.rating,
    notes:         row.notes || "",
    xpEarned:      Number(row.xp_earned || 0),
    diners:        Array.isArray(row.diners) ? row.diners : [],
    cookedAt:      row.cooked_at,
    createdAt:     row.created_at,
  };
}

/**
 * Viewer-scoped favorites. Each row in cook_log_favorites is a (user,
 * cook_log) bookmark — the chef can star their own cooks, and a diner
 * can star someone else's cook without touching the host's row.
 *
 * Exposes:
 *   favoriteIds   — Set<cookLogId> for O(1) enrichment
 *   toggle(id)    — optimistic flip; writes (or deletes) in the DB and
 *                   lets realtime reconcile on success
 *   loading       — true until first fetch resolves
 *
 * Realtime sub is scoped to user_id=me so we don't pay for family
 * members' star flips.
 */
export function useMyFavorites(userId, familyKey) {
  const [favoriteIds, setFavoriteIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!userId) { setFavoriteIds(new Set()); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("cook_log_favorites")
        .select("cook_log_id")
        .eq("user_id", userId);
      if (!alive) return;
      if (error) {
        console.error("[cook_log_favorites] load failed:", error);
        setFavoriteIds(new Set());
      } else {
        setFavoriteIds(new Set((data || []).map(r => r.cook_log_id)));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
    // familyKey triggers a re-fetch when connections change — same
    // refresh pattern as usePantry.
  }, [userId, familyKey]);

  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:cook_log_favorites:${userId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "cook_log_favorites", filter: `user_id=eq.${userId}` },
        (payload) => {
          setFavoriteIds(prev => {
            const next = new Set(prev);
            if (payload.eventType === "INSERT" && payload.new?.cook_log_id) {
              next.add(payload.new.cook_log_id);
            } else if (payload.eventType === "DELETE" && payload.old?.cook_log_id) {
              next.delete(payload.old.cook_log_id);
            }
            return next;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const toggle = useCallback((cookLogId) => {
    if (!userId || !cookLogId) return;
    setFavoriteIds(prev => {
      const isFav = prev.has(cookLogId);
      const next = new Set(prev);
      if (isFav) {
        next.delete(cookLogId);
        supabase.from("cook_log_favorites")
          .delete()
          .eq("user_id", userId)
          .eq("cook_log_id", cookLogId)
          .then(({ error }) => { if (error) console.error("[cook_log_favorites] unfav failed:", error); });
      } else {
        next.add(cookLogId);
        supabase.from("cook_log_favorites")
          .insert({ user_id: userId, cook_log_id: cookLogId })
          .then(({ error }) => { if (error) console.error("[cook_log_favorites] fav failed:", error); });
      }
      return next;
    });
  }, [userId]);

  return { favoriteIds, toggle, loading };
}

/**
 * Loads the signed-in user's own cook log (rows where user_id = userId),
 * sorted by cooked_at desc. Family/friends' cooks live in the
 * notifications inbox for now — chunk 3 adds a "meals I ate" tab that
 * surfaces rows where the current user is listed in `diners`.
 *
 * Subscribes to realtime so a fresh save from CookComplete lands in the
 * cookbook without a manual refresh.
 *
 * Returns:
 *   logs             — sorted [{ ... }]
 *   loading          — initial load in flight
 *   toggleFavorite   — (id) => void, flips is_favorite locally + in DB
 *   remove           — (id) => void, deletes the row (with optimistic UI)
 *   refresh          — () => void, manual re-fetch (rarely needed)
 */
export function useCookLog(userId, familyKey) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setLogs([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("cook_logs")
      .select("*")
      .eq("user_id", userId)
      .order("cooked_at", { ascending: false });
    if (error) {
      console.error("[cook_logs] load failed:", error);
      setLogs([]);
    } else {
      setLogs((data || []).map(fromDb));
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load, familyKey]);

  // Realtime — only react to rows we own (RLS would filter anyway, but the
  // channel could deliver family rows we don't want in this list).
  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:cook_logs:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cook_logs" }, (payload) => {
        const rowUser = payload.new?.user_id || payload.old?.user_id;
        if (rowUser !== userId) return;
        setLogs(prev => {
          if (payload.eventType === "INSERT") {
            const row = fromDb(payload.new);
            if (prev.some(l => l.id === row.id)) return prev;
            return [row, ...prev];
          }
          if (payload.eventType === "UPDATE") {
            const row = fromDb(payload.new);
            return prev.map(l => l.id === row.id ? row : l);
          }
          if (payload.eventType === "DELETE") {
            const id = payload.old?.id;
            return id ? prev.filter(l => l.id !== id) : prev;
          }
          return prev;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // Favorites moved out to useMyFavorites (viewer-scoped, see migration
  // 0016) — useCookLog no longer owns toggleFavorite. remove stays here
  // because only the chef can delete their own log.
  const remove = useCallback((id) => {
    setLogs(prev => prev.filter(l => l.id !== id));
    supabase.from("cook_logs").delete().eq("id", id).then(({ error }) => {
      if (error) console.error("[cook_logs] delete failed:", error);
    });
  }, []);

  return { logs, loading, remove, refresh: load };
}

/**
 * Loads cooks the signed-in user was a DINER on — meals they ate with
 * someone else who cooked. Drives the "Eaten" tab of Cookbook so a diner
 * can see every meal they attended and leave their own review.
 *
 * Each log comes back enriched with `myReview` (the current user's own
 * review of this cook, null if they haven't posted one yet). The cookbook
 * UI uses that — not the chef's self-rating — to color eaten cards and
 * power the filter chips, because the DINER's opinion is what a diner
 * cares about on their own cookbook.
 *
 * Subscribes to realtime on both cook_logs AND cook_log_reviews (scoped
 * to the current user as reviewer) so a review the diner posts anywhere
 * reflects back on their cookbook cards without a manual refresh.
 */
export function useDinerLog(userId, familyKey) {
  const [logs, setLogs] = useState([]);
  const [reviewsByLog, setReviewsByLog] = useState({}); // cookLogId → reviewRow
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setLogs([]); setReviewsByLog({}); setLoading(false); return; }
    setLoading(true);
    // `contains` on a uuid[] column expects an array — we want rows whose
    // diners array contains the current user's id.
    const { data, error } = await supabase
      .from("cook_logs")
      .select("*")
      .contains("diners", [userId])
      .order("cooked_at", { ascending: false });
    if (error) {
      console.error("[cook_logs:diner] load failed:", error);
      setLogs([]);
    } else {
      setLogs((data || []).map(fromDb));
    }

    // My reviews across all eaten logs — cheap single query, keyed by
    // reviewer so RLS only returns mine.
    const { data: revData, error: revErr } = await supabase
      .from("cook_log_reviews")
      .select("*")
      .eq("reviewer_id", userId);
    if (revErr) {
      console.error("[cook_log_reviews:mine] load failed:", revErr);
      setReviewsByLog({});
    } else {
      const map = {};
      for (const r of revData || []) map[r.cook_log_id] = reviewFromDb(r);
      setReviewsByLog(map);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load, familyKey]);

  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:cook_logs_diner:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cook_logs" }, (payload) => {
        const row = payload.new || payload.old;
        // Only care about rows where we're a diner. Note that an UPDATE
        // could add or remove us from diners — handle both edges.
        const wasDiner = Array.isArray(payload.old?.diners) && payload.old.diners.includes(userId);
        const isDiner  = Array.isArray(payload.new?.diners) && payload.new.diners.includes(userId);
        if (!wasDiner && !isDiner) return;

        setLogs(prev => {
          if (payload.eventType === "INSERT" && isDiner) {
            const mapped = fromDb(payload.new);
            if (prev.some(l => l.id === mapped.id)) return prev;
            return [mapped, ...prev];
          }
          if (payload.eventType === "UPDATE") {
            if (!isDiner) return prev.filter(l => l.id !== row.id); // chef dropped us
            const mapped = fromDb(payload.new);
            if (!prev.some(l => l.id === mapped.id)) return [mapped, ...prev];
            return prev.map(l => l.id === mapped.id ? mapped : l);
          }
          if (payload.eventType === "DELETE") {
            const id = payload.old?.id;
            return id ? prev.filter(l => l.id !== id) : prev;
          }
          return prev;
        });
      })
      // Keep the diner's own review-per-log map up to date. Scoped to this
      // user's reviews only via the reviewer_id filter so we don't react to
      // every family member's edits.
      .on("postgres_changes",
        { event: "*", schema: "public", table: "cook_log_reviews", filter: `reviewer_id=eq.${userId}` },
        (payload) => {
          setReviewsByLog(prev => {
            if (payload.eventType === "DELETE") {
              const cookLogId = payload.old?.cook_log_id;
              if (!cookLogId) return prev;
              const next = { ...prev };
              delete next[cookLogId];
              return next;
            }
            const row = payload.new;
            if (!row?.cook_log_id) return prev;
            return { ...prev, [row.cook_log_id]: reviewFromDb(row) };
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // Merge myReview onto each log so consumers don't have to juggle two
  // collections. Pure derivation; realtime drives the underlying state.
  const enriched = useMemo(
    () => logs.map(l => ({ ...l, myReview: reviewsByLog[l.id] || null })),
    [logs, reviewsByLog]
  );

  // Diner-side "delete this from my list" — calls the SECURITY DEFINER
  // RPC that removes the caller from the chef's diners[] and cleans up
  // their review + favorite on that cook. Optimistically drops the row
  // from the local state so the UI feels instant; realtime reconcile
  // will confirm or put it back if the RPC failed.
  const leaveCookLog = useCallback(async (cookLogId) => {
    if (!userId || !cookLogId) return;
    setLogs(prev => prev.filter(l => l.id !== cookLogId));
    setReviewsByLog(prev => {
      if (!(cookLogId in prev)) return prev;
      const next = { ...prev };
      delete next[cookLogId];
      return next;
    });
    const { error } = await supabase.rpc("leave_cook_log", { cook_log_id: cookLogId });
    if (error) console.error("[leave_cook_log] failed:", error);
  }, [userId]);

  return { logs: enriched, loading, leaveCookLog, refresh: load };
}

/**
 * Loads everyone who has ★-saved a given cook_log (by cook_log_favorites
 * membership), minus the viewer themselves — so the chef can see social
 * proof without their own star inflating the count ("3 people saved
 * this" is truthier than "4" when one of them is the chef).
 *
 * Intentionally a thin, detail-screen-scoped hook rather than a bulk
 * fetch across every log: the list cards don't need this data, and
 * fanning it in would make the initial cookbook paint slower for the
 * one-in-ten moment a chef taps into a cook.
 */
export function useCookSavers(cookLogId, viewerId) {
  const [saverIds, setSaverIds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!cookLogId) { setSaverIds([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("cook_log_favorites")
        .select("user_id")
        .eq("cook_log_id", cookLogId);
      if (!alive) return;
      if (error) {
        console.error("[cook_log_favorites:savers] load failed:", error);
        setSaverIds([]);
      } else {
        setSaverIds((data || []).map(r => r.user_id).filter(id => id !== viewerId));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [cookLogId, viewerId]);

  // Realtime: new ★ or un-★ on this cook from anyone in the cohort.
  useEffect(() => {
    if (!cookLogId) return;
    const ch = safeChannel(`rt:cook_log_favorites:savers:${cookLogId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "cook_log_favorites", filter: `cook_log_id=eq.${cookLogId}` },
        (payload) => {
          setSaverIds(prev => {
            if (payload.eventType === "INSERT") {
              const id = payload.new?.user_id;
              if (!id || id === viewerId || prev.includes(id)) return prev;
              return [...prev, id];
            }
            if (payload.eventType === "DELETE") {
              const id = payload.old?.user_id;
              return id ? prev.filter(x => x !== id) : prev;
            }
            return prev;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [cookLogId, viewerId]);

  return { saverIds, loading };
}

// Map DB review row → UI shape. Kept local so Cookbook never sees snake_case.
function reviewFromDb(row) {
  return {
    id:         row.id,
    cookLogId:  row.cook_log_id,
    reviewerId: row.reviewer_id,
    rating:     row.rating,
    notes:      row.notes || "",
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  };
}

/**
 * Loads + realtime-subs the reviews for a single cook_log.
 *
 * Returns:
 *   reviews        — sorted oldest-first so the thread reads top-to-bottom
 *   myReview       — convenience lookup: the current user's review, or null
 *   loading
 *   upsertMyReview — ({rating, notes}) => Promise<void>. Uses onConflict
 *                    so editing just bumps the existing row.
 *   deleteMyReview — () => Promise<void>
 */
export function useCookLogReviews(cookLogId, userId) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!cookLogId) { setReviews([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("cook_log_reviews")
        .select("*")
        .eq("cook_log_id", cookLogId)
        .order("created_at", { ascending: true });
      if (!alive) return;
      if (error) { console.error("[cook_log_reviews] load failed:", error); setReviews([]); }
      else       { setReviews((data || []).map(reviewFromDb)); }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [cookLogId]);

  useEffect(() => {
    if (!cookLogId) return;
    const ch = safeChannel(`rt:cook_log_reviews:${cookLogId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "cook_log_reviews", filter: `cook_log_id=eq.${cookLogId}` },
        (payload) => {
          setReviews(prev => {
            if (payload.eventType === "INSERT") {
              const row = reviewFromDb(payload.new);
              if (prev.some(r => r.id === row.id)) return prev;
              return [...prev, row];
            }
            if (payload.eventType === "UPDATE") {
              const row = reviewFromDb(payload.new);
              if (!prev.some(r => r.id === row.id)) return [...prev, row];
              return prev.map(r => r.id === row.id ? row : r);
            }
            if (payload.eventType === "DELETE") {
              const id = payload.old?.id;
              return id ? prev.filter(r => r.id !== id) : prev;
            }
            return prev;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [cookLogId]);

  const myReview = useMemo(
    () => reviews.find(r => r.reviewerId === userId) || null,
    [reviews, userId]
  );

  const upsertMyReview = useCallback(async ({ rating, notes }) => {
    if (!cookLogId || !userId) return;
    const { error } = await supabase
      .from("cook_log_reviews")
      .upsert(
        { cook_log_id: cookLogId, reviewer_id: userId, rating, notes: notes || null },
        { onConflict: "cook_log_id,reviewer_id" },
      );
    if (error) console.error("[cook_log_reviews] upsert failed:", error);
  }, [cookLogId, userId]);

  const deleteMyReview = useCallback(async () => {
    if (!cookLogId || !userId) return;
    const { error } = await supabase
      .from("cook_log_reviews")
      .delete()
      .eq("cook_log_id", cookLogId)
      .eq("reviewer_id", userId);
    if (error) console.error("[cook_log_reviews] delete failed:", error);
  }, [cookLogId, userId]);

  return { reviews, myReview, loading, upsertMyReview, deleteMyReview };
}

// Map a DB photo row → UI shape, materializing the public URL so consumers
// can drop it straight into an <img src>.
function photoFromDb(row, publicUrlFor) {
  return {
    id:          row.id,
    cookLogId:   row.cook_log_id,
    uploaderId:  row.uploader_id,
    storagePath: row.storage_path,
    createdAt:   row.created_at,
    url:         publicUrlFor(row.storage_path),
  };
}

/**
 * Photos attached to a single cook_log. Anyone in the cohort (chef, any
 * diner, family-of-chef) can upload. Only the uploader can delete their
 * own photos. Realtime sub keeps all open detail screens in sync so a
 * diner's pic shows up on the chef's side the moment it lands.
 *
 * Exposes:
 *   photos         — oldest-first array (first-uploaded becomes cover)
 *   loading        — initial fetch flag
 *   upload(file)   — blob/File → storage + DB insert (Promise<void>)
 *   remove(id)     — delete the DB row and the underlying storage object
 *                    (only the uploader can run this)
 */
export function useCookPhotos(cookLogId, viewerId) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

  // publicUrl is stable per path; memoize the bucket handle so the
  // photoFromDb helper doesn't allocate a new one per call.
  const bucket = useMemo(() => supabase.storage.from("meal-photos"), []);
  const publicUrlFor = useCallback(
    (path) => bucket.getPublicUrl(path).data.publicUrl,
    [bucket]
  );

  useEffect(() => {
    let alive = true;
    if (!cookLogId) { setPhotos([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("cook_log_photos")
        .select("*")
        .eq("cook_log_id", cookLogId)
        .order("created_at", { ascending: true });
      if (!alive) return;
      if (error) {
        console.error("[cook_log_photos] load failed:", error);
        setPhotos([]);
      } else {
        setPhotos((data || []).map(r => photoFromDb(r, publicUrlFor)));
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [cookLogId, publicUrlFor]);

  useEffect(() => {
    if (!cookLogId) return;
    const ch = safeChannel(`rt:cook_log_photos:${cookLogId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "cook_log_photos", filter: `cook_log_id=eq.${cookLogId}` },
        (payload) => {
          setPhotos(prev => {
            if (payload.eventType === "INSERT") {
              const row = photoFromDb(payload.new, publicUrlFor);
              if (prev.some(p => p.id === row.id)) return prev;
              return [...prev, row];
            }
            if (payload.eventType === "DELETE") {
              const id = payload.old?.id;
              return id ? prev.filter(p => p.id !== id) : prev;
            }
            return prev;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [cookLogId, publicUrlFor]);

  const upload = useCallback(async (file) => {
    if (!cookLogId || !viewerId || !file) return;
    // Opaque, unguessable path under a cook_log_id folder so the bucket
    // can't be enumerated. Extension is a best-effort sniff from the
    // MIME type — good enough for browsers serving the file back.
    const ext = (file.type && file.type.split("/")[1]) || "jpg";
    const storagePath = `${cookLogId}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await bucket.upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
    if (upErr) {
      console.error("[cook_log_photos] storage upload failed:", upErr);
      return;
    }

    const { error: insErr } = await supabase.from("cook_log_photos").insert({
      cook_log_id: cookLogId,
      uploader_id: viewerId,
      storage_path: storagePath,
    });
    if (insErr) {
      console.error("[cook_log_photos] row insert failed:", insErr);
      // Best-effort rollback — if the DB insert fails we shouldn't leave
      // a dangling object in storage that nobody can discover.
      bucket.remove([storagePath]).catch(() => { /* swallow */ });
    }
    // Realtime handles the list update.
  }, [cookLogId, viewerId, bucket]);

  const remove = useCallback(async (photoId) => {
    const target = photos.find(p => p.id === photoId);
    if (!target) return;
    // Optimistic — realtime DELETE will also fire, but removing locally
    // now keeps the UI snappy even on flaky connections.
    setPhotos(prev => prev.filter(p => p.id !== photoId));
    const { error: delErr } = await supabase
      .from("cook_log_photos")
      .delete()
      .eq("id", photoId);
    if (delErr) {
      console.error("[cook_log_photos] db delete failed:", delErr);
      return;
    }
    // Storage cleanup is gated by the bucket RLS "owner delete" policy —
    // if the viewer isn't the uploader this no-ops, which is exactly what
    // we want (the DB delete above would have been blocked too).
    const { error: rmErr } = await bucket.remove([target.storagePath]);
    if (rmErr) console.error("[cook_log_photos] storage remove failed:", rmErr);
  }, [photos, bucket]);

  return { photos, loading, upload, remove };
}
