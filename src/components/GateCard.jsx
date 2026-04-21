import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Gate card — shows the prereq progress for the user's next
// unpassed gate. Self-only (rendered on their own profile).
//
// Data flow:
//   1. Fetch user_gate_progress for this user, status != 'passed'.
//      If none exists yet, the user hasn't hit a gate floor yet —
//      render nothing.
//   2. Call user_gate_prereq_state RPC to refresh the rules[]
//      array; server snapshots it onto user_gate_progress in a
//      follow-up trigger (or the next award_xp call) so we don't
--      re-run the RPC on every render.
//   3. Render each rule with ✓ / ○ status + have/need copy.
//   4. When all_met, surface the picker CTA (opens a separate
//      modal — Phase 4b-8).
//
// Card is intentionally calm. The plan wants gates to feel like
// respect-your-mastery moments, not aggressive paywalls. Copy is
// short; celebration comes on pass.

const RULE_COPY = {
  skill_courses_completed:
    ({ have, need }) => `${have}/${need} skill courses mastered`,
  recipe_categories_covered:
    ({ have, need }) => {
      const h = Array.isArray(have) ? have.length : 0;
      const n = Array.isArray(need) ? need.length : 0;
      return `${h}/${n} meal slots covered`;
    },
  streak_count_min:
    ({ have, need }) => `${have}/${need}-day streak`,
  host_meal_with_diners:
    ({ have, need }) => `Host with ${have}/${need} diners`,
  curated_lessons_per_cuisine:
    ({ have, need, rule }) => {
      const lpc = rule?.lessons_per_cuisine ?? "?";
      return `${have}/${need} cuisines at ${lpc}+ lessons`;
    },
  curated_cooks_total:
    ({ have, need }) => `${have}/${need} curated cooks`,
  curated_collections_mastered:
    ({ have, need }) => `${have}/${need} collections mastered`,
  all_skills_maxed:
    ({ have, need }) => `${have}/${need} skills maxed`,
};

function ruleCopy(rule) {
  const f = RULE_COPY[rule.kind];
  if (!f) return rule.label || rule.kind;
  return f({ have: rule.have, need: rule.need, rule });
}

export default function GateCard({ userId, onOpenPicker }) {
  const [progress, setProgress] = useState(null);
  const [state, setState]       = useState(null);
  const [gate, setGate]         = useState(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;

    (async () => {
      const { data: progRows, error: pErr } = await supabase
        .from("user_gate_progress")
        .select("*")
        .eq("user_id", userId)
        .neq("status", "passed")
        .order("gate_level", { ascending: true })
        .limit(1);
      if (pErr) { console.error("[GateCard] progress load failed:", pErr); return; }

      const prog = (progRows || [])[0];
      if (!alive) return;
      if (!prog) { setProgress(null); setState(null); setGate(null); return; }
      setProgress(prog);

      const { data: gateRow, error: gErr } = await supabase
        .from("xp_level_gates")
        .select("*")
        .eq("gate_level", prog.gate_level)
        .maybeSingle();
      if (gErr) { console.error("[GateCard] gate load failed:", gErr); return; }
      if (!alive) return;
      setGate(gateRow || null);

      const { data: stateJson, error: sErr } = await supabase
        .rpc("user_gate_prereq_state", {
          p_user_id:    userId,
          p_gate_level: prog.gate_level,
        });
      if (sErr) { console.error("[GateCard] prereq state failed:", sErr); return; }
      if (!alive) return;
      setState(stateJson || null);
    })();

    return () => { alive = false; };
  }, [userId]);

  if (!progress || !gate || !state) return null;

  const rules  = Array.isArray(state.rules) ? state.rules : [];
  const allMet = !!state.all_met;

  return (
    <div style={{
      background: "#1a1208", border: "1px solid #3a2f10", borderRadius: 12,
      padding: "14px 16px", marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#e07a3a", letterSpacing: "0.14em" }}>
            🚪 L{gate.gate_level} GATE
          </span>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontStyle: "italic", color: "#f0ece4", marginTop: 3 }}>
            {gate.label}
          </div>
        </div>
      </div>

      {gate.description && (
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.5, marginBottom: 12 }}>
          {gate.description}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rules.map((r, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 11,
            color: r.ok ? "#f5c842" : "#888",
          }}>
            <span style={{ fontSize: 14, minWidth: 16, textAlign: "center" }}>
              {r.ok ? "✓" : "○"}
            </span>
            <span style={{ letterSpacing: "0.04em" }}>
              {ruleCopy(r)}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        {allMet ? (
          <button
            onClick={() => onOpenPicker?.(gate, progress)}
            style={{
              width: "100%", background: "#e07a3a", border: "none", color: "#140a04",
              padding: "12px 0", borderRadius: 10, cursor: "pointer",
              fontFamily: "'DM Mono',monospace", fontSize: 11, letterSpacing: "0.12em", fontWeight: 600,
            }}
          >
            PICK YOUR RANKED MATCH →
          </button>
        ) : (
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666",
            letterSpacing: "0.08em", textAlign: "center",
          }}>
            COMPLETE PREREQS TO UNLOCK THE RANKED MATCH
          </div>
        )}
      </div>
    </div>
  );
}
