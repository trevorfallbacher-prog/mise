import { useEffect, useState } from "react";
import { supabase, safeChannel } from "../lib/supabase";

// PrepComingUpCard — ambient awareness for upcoming prep reminders.
//
// A prep notification you'll only see as an OS banner is better than
// nothing, but a user who can glance at Home and see "thaw chicken in
// 3h" before the push fires can plan their day instead of being
// ambushed. This card surfaces every undelivered, undismissed prep
// row whose deliver_at falls in the next 24h, sorted by soonest.
//
// Why a direct query (not useMealPrepQueue): that hook is scoped to
// meal IDs because it drives per-meal chip strips in Plan. Home
// wants the user's WHOLE queue regardless of which meal it hangs
// off. Simple select + realtime subscription = same infra, smaller
// surface.

const WINDOW_MS = 24 * 60 * 60 * 1000;

function formatWhen(iso) {
  const delta = new Date(iso).getTime() - Date.now();
  if (delta <= 0) return "now";
  const mins = Math.round(delta / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}

export default function PrepComingUpCard({ userId, onOpenPlan }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) { setRows([]); setLoaded(true); return; }
    let alive = true;
    const refresh = async () => {
      const until = new Date(Date.now() + WINDOW_MS).toISOString();
      const { data, error } = await supabase
        .from("prep_notifications")
        .select("id, scheduled_meal_id, title, body, emoji, deliver_at, lead_minutes, source")
        .eq("user_id", userId)
        .is("delivered_at", null)
        .is("dismissed_at", null)
        .lte("deliver_at", until)
        .order("deliver_at", { ascending: true })
        .limit(5);
      if (!alive) return;
      if (error) { console.warn("[prepCard] load failed:", error.message); setLoaded(true); return; }
      setRows(data || []);
      setLoaded(true);
    };
    refresh();
    // Realtime — any insert (new schedule), update (delivery stamp),
    // delete (reschedule sync) triggers a re-query. The queries are
    // cheap (partial index on due/undelivered/undismissed) and a
    // re-fetch keeps the card's sort + filter logic in one place.
    const ch = safeChannel(`rt:home-prep:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_notifications", filter: `user_id=eq.${userId}` },
        () => refresh(),
      )
      .subscribe();
    // Minute-grid tick so the "in 42m" labels refresh without a reload.
    const id = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      supabase.removeChannel(ch);
      clearInterval(id);
    };
  }, [userId]);

  // Hide entirely when the queue is empty — Home shouldn't carry
  // empty state chrome; absence is the signal.
  if (!loaded || rows.length === 0) return null;

  return (
    <div style={{ padding: "20px 20px 0" }}>
      <button
        onClick={() => onOpenPlan?.()}
        style={{
          width: "100%",
          textAlign: "left",
          background: "linear-gradient(180deg,#1e1408 0%,#140d05 100%)",
          border: "1px solid #3a2a0a",
          borderRadius: 14,
          padding: "14px 16px",
          cursor: onOpenPlan ? "pointer" : "default",
          display: "block",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700,
            color: "#f5c842", letterSpacing: "0.14em",
          }}>
            ⏰ PREP COMING UP
          </div>
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            color: "#888", letterSpacing: "0.1em",
          }}>
            NEXT 24H
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map(r => (
            <div
              key={r.id}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px",
                background: "#0f0a04",
                border: "1px solid #2a1f10",
                borderRadius: 10,
              }}
            >
              <span style={{ fontSize: 20, flexShrink: 0 }}>{r.emoji || "⏰"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4",
                  fontWeight: 500, lineHeight: 1.3,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {r.title}
                </div>
                {r.body && (
                  <div style={{
                    fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#888",
                    lineHeight: 1.3, marginTop: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {r.body}
                  </div>
                )}
              </div>
              <div style={{
                fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
                color: "#f5c842", letterSpacing: "0.08em", flexShrink: 0,
              }}>
                {formatWhen(r.deliver_at)}
              </div>
            </div>
          ))}
        </div>
      </button>
    </div>
  );
}
