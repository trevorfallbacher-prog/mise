import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// Daily scratch-card roll on Home. Two states:
//   unrolled  — shows the scratch-card affordance; tap to roll
//   rolled    — compact badge showing today's result
//
// The server is the source of truth for "has this user rolled
// today" — we compare profile.daily_roll_date against a local-day
// approximation and let the RPC reject repeat calls authoritatively.
//
// Rarity palette matches the plan's tier colors (common → gold,
// uncommon → brighter gold, rare → tan, epic → prismatic gradient).

const RARITY_COPY = {
  common:   { label: "COMMON",   color: "#d4a87a", emoji: "🎲" },
  uncommon: { label: "UNCOMMON", color: "#f5c842", emoji: "✨" },
  rare:     { label: "RARE",     color: "#b8a878", emoji: "💫" },
  epic:     { label: "EPIC",     color: "#e07a3a", emoji: "🌟" },
};

function approxLocalDay(tz, rolloverHour = 4) {
  try {
    // Best-effort local-day bucket in the browser; server has
    // the authoritative check so any drift just delays the
    // compact badge's switch to the new "unrolled" state by a
    // few seconds around 04:00.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || undefined,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find(p => p.type === "year")?.value;
    const m = parts.find(p => p.type === "month")?.value;
    const d = parts.find(p => p.type === "day")?.value;
    const h = Number(parts.find(p => p.type === "hour")?.value || 0);
    if (!y || !m || !d) return null;
    const todayStr = `${y}-${m}-${d}`;
    if (h >= rolloverHour) return todayStr;
    const dt = new Date(`${todayStr}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - 1);
    const y2 = dt.getUTCFullYear();
    const m2 = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d2 = String(dt.getUTCDate()).padStart(2, "0");
    return `${y2}-${m2}-${d2}`;
  } catch {
    return null;
  }
}

export default function DailyRollCard({ profile }) {
  const [busy, setBusy]       = useState(false);
  const [justRolled, setJust] = useState(null);
  const [phase, setPhase]     = useState("idle"); // idle | rolling | revealed

  const todayStr = useMemo(
    () => approxLocalDay(profile?.timezone || "UTC"),
    [profile?.timezone],
  );
  const rolledToday = profile?.daily_roll_date === todayStr;
  const stored = profile?.daily_roll_result || null;
  const shown  = justRolled || (rolledToday ? stored : null);

  const handleRoll = async () => {
    if (busy || rolledToday) return;
    setBusy(true);
    setPhase("rolling");
    const { data, error } = await supabase.rpc("streak_daily_roll");
    if (error || !data?.ok) {
      console.error("[daily_roll] failed:", error || data?.reason);
      setBusy(false);
      setPhase("idle");
      return;
    }
    // Small deliberate delay so the reveal doesn't feel like a
    // database response — give the card ~600ms to flip visually.
    setTimeout(() => {
      setJust({
        rarity:         data.rarity,
        xp_reward:      data.xp_reward,
        cosmetic_flair: data.cosmetic_flair,
      });
      setPhase("revealed");
      setBusy(false);
    }, 600);
  };

  // Compact "already rolled today" state.
  if (shown && phase !== "rolling") {
    const rar = RARITY_COPY[shown.rarity] || RARITY_COPY.common;
    return (
      <div style={{
        margin: "12px 20px 0", padding: "10px 14px",
        background: "#111", border: `1px solid ${rar.color}33`,
        borderLeft: `3px solid ${rar.color}`, borderRadius: 10,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 18 }}>{rar.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            color: rar.color, letterSpacing: "0.14em",
          }}>
            TODAY'S ROLL · {rar.label}
          </div>
          <div style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 13,
            color: "#aaa", marginTop: 2,
          }}>
            +{shown.xp_reward} XP{shown.cosmetic_flair ? " · flair active" : ""}
          </div>
        </div>
      </div>
    );
  }

  // Unrolled affordance.
  return (
    <button
      onClick={handleRoll}
      disabled={busy}
      style={{
        width: "calc(100% - 40px)", margin: "12px 20px 0",
        padding: "14px 16px", background: "linear-gradient(135deg, #2a2015 0%, #1a1208 100%)",
        border: "1px dashed #3a2f10", borderRadius: 12,
        display: "flex", alignItems: "center", gap: 12,
        cursor: busy ? "wait" : "pointer",
        fontFamily: "inherit", color: "inherit",
        animation: busy ? "drcShake 420ms ease-in-out" : "none",
      }}
    >
      <style>{`
        @keyframes drcShake {
          0%,100% { transform: translateX(0) }
          20% { transform: translateX(-2px) rotate(-0.5deg) }
          40% { transform: translateX(2px) rotate(0.5deg) }
          60% { transform: translateX(-1px) }
          80% { transform: translateX(1px) }
        }
      `}</style>
      <span style={{ fontSize: 22 }}>🎲</span>
      <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: "#e07a3a", letterSpacing: "0.14em",
        }}>
          DAILY ROLL
        </div>
        <div style={{
          fontFamily: "'Fraunces',serif", fontSize: 15, fontStyle: "italic",
          color: "#f0ece4", marginTop: 2,
        }}>
          {busy ? "Rolling…" : "Scratch for today's bonus"}
        </div>
      </div>
      <span style={{
        fontFamily: "'DM Mono',monospace", fontSize: 14,
        color: "#e07a3a",
      }}>→</span>
    </button>
  );
}
