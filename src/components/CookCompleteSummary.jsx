import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useXpToasts } from "./XpToastStack";

// Cook-complete summary — beat-sequenced reveal of every xp_events
// row written for this cook. Fetches all events with ref_table=
// 'cook_logs' and ref_id=cookLogId, sorts into the beat order from
// §5, then plays each beat with a ~700ms hold and a final total
// counter ramp.
//
// Tap anywhere to fast-forward. 7s hard cap on the sequence; tail
// beats batch into "+N more bonuses" so a long sequence doesn't
// trap the user.
//
// Suppresses the realtime toast stack while playing — beats and
// toasts competing for attention is the §5 anti-pattern.

const BEAT_MS         = 700;
const TOTAL_RAMP_MS   = 900;
const HARD_CAP_MS     = 7000;
const SOURCE_ORDER = [
  "cook_complete",
  "first_time_recipe",
  "plan_cook_closed",
  "eat_together",
  "photo_upload",
  "review_cook",
  "mastery_5x",
  "mastery_10x",
  "mastery_25x",
  "authors_cut",
];
const SOURCE_COPY = {
  cook_complete:      "Cook complete",
  first_time_recipe:  "First time!",
  plan_cook_closed:   "Plan → Cook closed",
  eat_together:       "Eaten together",
  photo_upload:       "Photo added",
  review_cook:        "Review posted",
  mastery_5x:         "Dialed in · 5×",
  mastery_10x:        "Dialed in · 10×",
  mastery_25x:        "Dialed in · 25×",
  authors_cut:        "Author's cut",
};
const SOURCE_COLOR = {
  cook_complete:      "#d4a87a",
  first_time_recipe:  "#f5c842",
  plan_cook_closed:   "#7eb8d4",
  eat_together:       "#e07a3a",
  photo_upload:       "#d4a87a",
  review_cook:        "#c7a8d4",
  mastery_5x:         "#e07a3a",
  mastery_10x:        "#e07a3a",
  mastery_25x:        "#e07a3a",
  authors_cut:        "#e07a3a",
};

function buildBeats(events) {
  const beats = [];
  // 1-N. Source-ordered earn beats.
  const earned = events
    .filter((e) => (e.final_xp || 0) > 0 && e.source !== "streak_revival")
    .sort((a, b) => {
      const ai = SOURCE_ORDER.indexOf(a.source);
      const bi = SOURCE_ORDER.indexOf(b.source);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  for (const e of earned) {
    beats.push({
      kind:  "earn",
      label: SOURCE_COPY[e.source] || e.source,
      value: `+${e.final_xp}`,
      color: SOURCE_COLOR[e.source] || "#d4a87a",
    });
  }
  // Curated multiplier (single combined beat off the cook_complete row).
  const cook = events.find((e) => e.source === "cook_complete");
  if (cook && Number(cook.curated_mult) > 1.0) {
    beats.push({
      kind:  "mult",
      label: `Curated boost · ×${Number(cook.curated_mult).toFixed(2)}`,
      value: `×${Number(cook.curated_mult).toFixed(2)}`,
      color: "#b8a878",
    });
  }
  // Streak multiplier (read off any earn — same per cook).
  const anyMult = earned.find((e) => Number(e.streak_mult) > 1.0);
  if (anyMult) {
    beats.push({
      kind:  "mult",
      label: `Fire mode · ×${Number(anyMult.streak_mult).toFixed(2)}`,
      value: `×${Number(anyMult.streak_mult).toFixed(2)}`,
      color: "#e07a3a",
    });
  }
  // Gate-blocked event (rare but worth surfacing).
  const gated = events.find((e) => (e.gate_adjustment || 0) < 0);
  if (gated) {
    beats.push({
      kind:  "gate",
      label: "Blocked by gate",
      value: `${gated.gate_adjustment}`,
      color: "#888",
    });
  }
  return beats;
}

function clampBeats(beats) {
  // 7s budget. Reserve TOTAL_RAMP_MS for the final beat. Each
  // earn / mult beat costs BEAT_MS. Truncate + summarize the
  // overflow.
  const budget = HARD_CAP_MS - TOTAL_RAMP_MS;
  const max    = Math.floor(budget / BEAT_MS);
  if (beats.length <= max) return beats;
  const head = beats.slice(0, max - 1);
  const tail = beats.slice(max - 1);
  const tailValue = tail.reduce((sum, b) => {
    const n = Number(String(b.value).replace(/[^\-0-9.]/g, ""));
    return sum + (Number.isFinite(n) ? Math.round(n) : 0);
  }, 0);
  head.push({
    kind:  "batch",
    label: `+${tail.length} more bonuses`,
    value: `+${tailValue}`,
    color: "#aaa",
  });
  return head;
}

export default function CookCompleteSummary({ cookLogId, onClose }) {
  const [beats, setBeats] = useState([]);
  const [revealed, setRevealed] = useState([]);
  const [total, setTotal] = useState(0);
  const [showTotal, setShowTotal] = useState(false);
  const skippedRef = useRef(false);
  const { mute } = useXpToasts();

  // Mute toast stack for the lifetime of the summary.
  useEffect(() => {
    mute(true);
    return () => mute(false);
  }, [mute]);

  // Fetch the cook's xp_events and build the beat list.
  useEffect(() => {
    if (!cookLogId) { onClose?.(); return; }
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("xp_events")
        .select("*")
        .eq("ref_table", "cook_logs")
        .eq("ref_id", cookLogId)
        .order("created_at", { ascending: true });
      if (!alive) return;
      if (error) {
        console.error("[CookCompleteSummary] events load failed:", error);
        onClose?.();
        return;
      }
      const allBeats = clampBeats(buildBeats(data || []));
      setBeats(allBeats);
      const sum = (data || []).reduce((s, e) => s + (e.final_xp || 0), 0);
      setTotal(sum);
    })();
    return () => { alive = false; };
  }, [cookLogId, onClose]);

  // Drive the reveal loop.
  useEffect(() => {
    if (beats.length === 0) return;
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled || skippedRef.current) return;
      if (i >= beats.length) {
        setShowTotal(true);
        setTimeout(() => { if (!cancelled) onClose?.(); }, 2000);
        return;
      }
      setRevealed((prev) => [...prev, beats[i]]);
      i += 1;
      setTimeout(tick, BEAT_MS);
    };
    tick();
    return () => { cancelled = true; };
  }, [beats, onClose]);

  const fastForward = () => {
    if (skippedRef.current) return;
    skippedRef.current = true;
    setRevealed(beats);
    setShowTotal(true);
    setTimeout(() => onClose?.(), 1200);
  };

  return (
    <div
      onClick={fastForward}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "radial-gradient(ellipse at center, #1a1208 0%, #050300 75%)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "24px", cursor: "pointer",
        animation: "ccsFadeIn 250ms ease-out",
      }}
    >
      <style>{`
        @keyframes ccsFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ccsBeatIn { 0% { opacity: 0; transform: translateY(8px) scale(0.95) } 60% { opacity: 1; transform: translateY(0) scale(1.04) } 100% { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>

      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#888",
        letterSpacing: "0.18em", marginBottom: 24,
      }}>
        COOK COMPLETE
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", minHeight: 220 }}>
        {revealed.map((b, i) => {
          // Defensive guards — if a malformed beat ever lands here
          // (undefined entry from a stale closure / unexpected event
          // shape from xp_events), we render a muted fallback row
          // rather than crashing the summary mid-cook-save. Beat
          // shape is { kind, label, value, color } — every field
          // gets a fallback so any one missing doesn't take down
          // the whole sequence.
          if (!b) return null;
          return (
            <div key={i} style={{
              display: "flex", alignItems: "baseline", gap: 14,
              animation: "ccsBeatIn 360ms ease-out backwards",
            }}>
              <span style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 26, fontWeight: 600,
                color: b.color || "#aaa",
                minWidth: 80, textAlign: "right",
              }}>
                {b.value ?? ""}
              </span>
              <span style={{
                fontFamily: "'DM Sans',sans-serif",
                fontSize: 14, color: "#aaa", letterSpacing: "0.02em",
              }}>
                {b.label ?? ""}
              </span>
            </div>
          );
        })}
      </div>

      {showTotal && (
        <div style={{ marginTop: 28, textAlign: "center", animation: "ccsBeatIn 500ms ease-out backwards" }}>
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#666",
            letterSpacing: "0.14em", marginBottom: 6,
          }}>
            TOTAL
          </div>
          <div style={{
            fontFamily: "'Fraunces',serif", fontSize: 56, fontWeight: 300,
            color: "#f5c842", lineHeight: 1,
            textShadow: "0 0 30px rgba(245, 200, 66, 0.35)",
          }}>
            +{total} XP
          </div>
        </div>
      )}

      <div style={{
        position: "absolute", bottom: 24, left: 0, right: 0, textAlign: "center",
        fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#444",
        letterSpacing: "0.16em",
      }}>
        TAP ANYWHERE TO SKIP
      </div>
    </div>
  );
}
