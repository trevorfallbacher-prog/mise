import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

// Row shape we render in the UI. Keeps the DB column names out of components.
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
    isFavorite:    !!row.is_favorite,
    cookedAt:      row.cooked_at,
    createdAt:     row.created_at,
  };
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
    const ch = supabase
      .channel(`rt:cook_logs:${userId}`)
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

  const toggleFavorite = useCallback((id) => {
    setLogs(prev => {
      const target = prev.find(l => l.id === id);
      if (!target) return prev;
      const next = !target.isFavorite;
      // Fire-and-forget; realtime UPDATE will reconcile on success.
      supabase.from("cook_logs").update({ is_favorite: next }).eq("id", id).then(({ error }) => {
        if (error) console.error("[cook_logs] toggleFavorite failed:", error);
      });
      return prev.map(l => l.id === id ? { ...l, isFavorite: next } : l);
    });
  }, []);

  const remove = useCallback((id) => {
    setLogs(prev => prev.filter(l => l.id !== id));
    supabase.from("cook_logs").delete().eq("id", id).then(({ error }) => {
      if (error) console.error("[cook_logs] delete failed:", error);
    });
  }, []);

  return { logs, loading, toggleFavorite, remove, refresh: load };
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
    const ch = supabase
      .channel(`rt:cook_logs_diner:${userId}`)
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

  return { logs: enriched, loading, refresh: load };
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
    const ch = supabase
      .channel(`rt:cook_log_reviews:${cookLogId}`)
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
