import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";

// Pull the last 30 days, capped at 100 rows. Older rows still exist in the DB
// (auto-prune is a future cron); we just don't surface them in the panel.
const WINDOW_MS = 30 * 24 * 3600 * 1000;
const PAGE_SIZE = 100;

/**
 * Persistent, family-fanout notifications inbox.
 *
 * The DB trigger in 0010_notifications.sql writes one row per recipient on
 * any pantry / shopping-list / scheduled-meals change. This hook subscribes
 * to the signed-in user's slice and exposes:
 *   notifications  — newest-first list of rows
 *   unreadCount    — number of rows where read_at is null
 *   loading        — true until the initial load resolves
 *   markAllRead()  — stamp read_at on every unread row
 *   dismiss(id)    — hard-delete a single row
 *   clearAll()     — hard-delete every row in the inbox
 *
 * The optional `onNew(row)` callback fires once per inbound INSERT and is
 * what App.jsx uses to raise the ephemeral toast (and a browser
 * Notification when the tab is hidden). Held in a ref so callers can
 * pass an inline arrow without retearing the realtime subscription.
 */
export function useNotifications(userId, { onNew } = {}) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const onNewRef = useRef(onNew);
  useEffect(() => { onNewRef.current = onNew; }, [onNew]);

  // Initial load.
  useEffect(() => {
    let alive = true;
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const since = new Date(Date.now() - WINDOW_MS).toISOString();
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (!alive) return;
      if (error) {
        console.error("[notifications] load failed:", error);
        setNotifications([]);
      } else {
        setNotifications(data || []);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  // Realtime: server-filtered to this user's inbox so we don't pay for
  // notifications addressed to other family members on the same publication.
  useEffect(() => {
    if (!userId) return;
    const ch = safeChannel(`rt:notifications:${userId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new;
          if (!row) return;
          setNotifications(prev => {
            if (prev.some(n => n.id === row.id)) return prev;
            return [row, ...prev];
          });
          const cb = onNewRef.current;
          if (cb) cb(row);
        }
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new;
          if (!row) return;
          setNotifications(prev => prev.map(n => (n.id === row.id ? row : n)));
        }
      )
      .on("postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const id = payload.old?.id;
          if (!id) return;
          setNotifications(prev => prev.filter(n => n.id !== id));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const unreadCount = notifications.reduce((n, r) => n + (r.read_at ? 0 : 1), 0);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    // Optimistic — stamp every currently-unread row.
    setNotifications(prev => prev.map(n => (n.read_at ? n : { ...n, read_at: now })));
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) console.error("[notifications] markAllRead failed:", error);
  }, [userId]);

  const dismiss = useCallback(async (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    const { error } = await supabase.from("notifications").delete().eq("id", id);
    if (error) console.error("[notifications] dismiss failed:", error);
  }, []);

  const clearAll = useCallback(async () => {
    if (!userId) return;
    setNotifications([]);
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("user_id", userId);
    if (error) console.error("[notifications] clearAll failed:", error);
  }, [userId]);

  return { notifications, loading, unreadCount, markAllRead, dismiss, clearAll };
}
