import { useCallback, useState } from "react";
import { supabase } from "../lib/supabase";
import ModalSheet from "./ModalSheet";

// Revive modal for the L30+ streak-insurance flow. Gated by the
// DB-side streak_revive RPC which enforces level / window / cooldown /
// level-floor — this UI just renders the pitch, calls the RPC, and
// reflects the server response. Non-L30 users don't see the revive
// CTA at all (caller gates visibility via profile.level).
//
// Copy is intentionally gentle — a break isn't a punishment, it's a
// moment the app owns. Match the tone from docs/plans/xp-leveling.md §3.

const REASON_COPY = {
  level_too_low:      "Revival unlocks at level 30.",
  no_broken_streak:   "No recent streak to revive.",
  outside_window:     "The 48-hour revival window has closed.",
  cooldown_active:    "Revival on cooldown — try again in a few days.",
  below_level_floor:  "The fee would drop you below your level's XP floor.",
};

export default function StreakRevive({ userId, peak, fee = 200, onClose, onRevived }) {
  const [status, setStatus] = useState("idle"); // idle | pending | done | error
  const [result, setResult] = useState(null);

  const confirm = useCallback(async () => {
    if (!userId) return;
    setStatus("pending");
    const { data, error } = await supabase.rpc("streak_revive", { p_user_id: userId });
    if (error) {
      setStatus("error");
      setResult({ ok: false, reason: "rpc_error", message: error.message });
      return;
    }
    if (!data?.ok) {
      setStatus("error");
      setResult(data);
      return;
    }
    setStatus("done");
    setResult(data);
    onRevived?.(data);
  }, [userId, onRevived]);

  return (
    <ModalSheet onClose={onClose}>
      <div style={{ padding: "32px 24px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 42, marginBottom: 10 }}>🕯️</div>
        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic", color: "#f0ece4", marginBottom: 6 }}>
          {status === "done" ? "Streak restored" : "Revive your streak"}
        </div>
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#aaa", marginBottom: 22, lineHeight: 1.5 }}>
          {status === "done" ? (
            <>You're back on day <b style={{ color: "#f5c842" }}>{result?.restored_to}</b>. Nice pull.</>
          ) : status === "error" ? (
            REASON_COPY[result?.reason] || result?.message || "Revival failed."
          ) : (
            <>Pay <b style={{ color: "#e07a3a" }}>{fee} XP</b> to restore your <b style={{ color: "#f5c842" }}>{peak}-day</b> streak. One shot per 14 days.</>
          )}
        </div>

        {status !== "done" && (
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, background: "transparent", border: "1px solid #2a2a2a",
                color: "#aaa", borderRadius: 12, padding: "12px 0",
                fontFamily: "'DM Mono',monospace", fontSize: 11, letterSpacing: "0.08em",
                cursor: "pointer",
              }}
            >
              NOT NOW
            </button>
            <button
              onClick={confirm}
              disabled={status === "pending"}
              style={{
                flex: 1, background: "#e07a3a", border: "none",
                color: "#140a04", borderRadius: 12, padding: "12px 0",
                fontFamily: "'DM Mono',monospace", fontSize: 11, letterSpacing: "0.08em",
                fontWeight: 600, cursor: status === "pending" ? "wait" : "pointer",
                opacity: status === "pending" ? 0.6 : 1,
              }}
            >
              {status === "pending" ? "REVIVING…" : "REVIVE"}
            </button>
          </div>
        )}
        {status === "done" && (
          <button
            onClick={onClose}
            style={{
              width: "100%", background: "#f5c842", border: "none",
              color: "#140a04", borderRadius: 12, padding: "12px 0",
              fontFamily: "'DM Mono',monospace", fontSize: 11, letterSpacing: "0.08em",
              fontWeight: 600, cursor: "pointer",
            }}
          >
            KEEP COOKING
          </button>
        )}
      </div>
    </ModalSheet>
  );
}
