import { useMemo, useState } from "react";
import { useNutritionTally } from "../lib/useNutritionTally";
import ModalSheet from "./ModalSheet";

// NutritionDashboard — per-user macros rollup embedded on the
// self-viewed UserProfile. Renders today's totals by default, with
// WEEK / MONTH tabs that swap to aggregate numbers + a sparkline.
// Each macro stat row carries a progress bar against the user's
// configured target (profiles.nutrition_targets). Tap any row to
// edit targets via the GoalEditor overlay.
//
// Source of truth: cook_logs.nutrition (per-serving macros stamped
// at cook-complete via recipeNutrition) × cook_logs.servings_per_eater
// (how many servings each eater consumed). useNutritionTally does the
// chef-OR-diner query, the day bucketing, and the 7/30-day series.
//
// Props:
//   userId              — self only; dashboard is gated on isSelf in parent
//   targets             — profile.nutrition_targets (kcal/protein_g/fat_g/carb_g)
//   onUpdateTargets(patch) — writes through useUserProfile.setNutritionTargets
//
// CLAUDE.md reserves tan/orange/blue/purple/yellow for identity axes.
// Picked below palette to avoid collision:
//   kcal    — #d4a87a muted gold (distinct from INGREDIENTS yellow)
//   protein — #7ec87e green      (matches pantry-override badge)
//   fat     — #d4743e burnt      (distinct from CATEGORY orange)
//   carbs   — #8ac8e8 sky        (distinct from STORED IN blue)

const MACRO_DEFS = [
  { key: "kcal",      label: "CALORIES", unit: "kcal", color: "#d4a87a" },
  { key: "protein_g", label: "PROTEIN",  unit: "g",    color: "#7ec87e" },
  { key: "fat_g",     label: "FAT",      unit: "g",    color: "#d4743e" },
  { key: "carb_g",    label: "CARBS",    unit: "g",    color: "#8ac8e8" },
];

const DEFAULT_TARGETS = { kcal: 2000, protein_g: 150, fat_g: 65, carb_g: 250 };

const PERIODS = [
  { id: "day",   label: "TODAY",       multiplier: 1  },
  { id: "week",  label: "THIS WEEK",   multiplier: 7  },
  { id: "month", label: "THIS MONTH",  multiplier: 30 },
];

export default function NutritionDashboard({ userId, targets, onUpdateTargets }) {
  const [period, setPeriod]      = useState("day");
  const [editingGoals, setEditingGoals] = useState(false);

  const tally = useNutritionTally(userId);
  const eff = { ...DEFAULT_TARGETS, ...(targets || {}) };

  // Active period numbers + label.
  const current = useMemo(() => {
    if (period === "day")   return tally.today        || {};
    if (period === "week")  return tally.weekTotals   || {};
    if (period === "month") return tally.monthTotals  || {};
    return {};
  }, [period, tally.today, tally.weekTotals, tally.monthTotals]);

  const periodDef = PERIODS.find(p => p.id === period);
  const series = period === "month" ? tally.dailySeriesMonth : tally.dailySeriesWeek;
  const showSparkline = period !== "day" && Array.isArray(series) && series.length > 0;

  const coverageText = (() => {
    const cov = tally.coverage;
    if (!cov || cov.total === 0) return null;
    if (cov.withNutrition === cov.total) return null;
    const untracked = cov.total - cov.withNutrition;
    return `BASED ON ${cov.withNutrition} OF ${cov.total} MEALS · ${untracked} UNTRACKED`;
  })();

  return (
    <div style={{ marginTop: 18 }}>
      <style>{`
        @keyframes ntGrowBar { from { width: 0% } to { width: var(--nt-target-w) } }
        @keyframes ntGrowHeight { from { height: 0% } to { height: var(--nt-h) } }
        @keyframes ntRise { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
      `}</style>

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10,
      }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
          NUTRITION
        </div>
        <button
          onClick={() => setEditingGoals(true)}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            color: "#888", letterSpacing: "0.08em",
            textDecoration: "underline dotted", textUnderlineOffset: 2,
            padding: 0,
          }}
        >
          EDIT GOALS
        </button>
      </div>

      {/* Period tabs. Single-select chip row. Keying the card body on
          the active period forces React to remount so the growBar
          animation re-runs on every tab switch. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {PERIODS.map(p => {
          const active = p.id === period;
          return (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              style={{
                flex: 1, padding: "8px 0",
                background: active ? "#f5c842" : "#141414",
                border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                color: active ? "#111" : "#888",
                borderRadius: 8,
                fontFamily: "'DM Mono',monospace", fontSize: 10,
                fontWeight: active ? 700 : 400,
                cursor: "pointer", letterSpacing: "0.08em",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div key={period} style={{ animation: "ntRise 0.3s ease backwards" }}>
        {tally.loading ? (
          <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#666", fontStyle: "italic", margin: 0 }}>
            Loading…
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {MACRO_DEFS.map((m, i) => {
                const actual = Math.round(current[m.key] || 0);
                const target = Math.round((Number(eff[m.key]) || 0) * periodDef.multiplier);
                const pct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
                return (
                  <div
                    key={m.key}
                    onClick={() => setEditingGoals(true)}
                    style={{
                      padding: "10px 12px",
                      background: "#141414", border: "1px solid #242424",
                      borderRadius: 10, cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <span style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 10,
                        color: m.color, letterSpacing: "0.08em",
                      }}>
                        {m.label}
                      </span>
                      <span style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#f0ece4",
                      }}>
                        {actual.toLocaleString()}
                        <span style={{ color: "#555" }}> / {target.toLocaleString()} {m.unit}</span>
                      </span>
                    </div>
                    <div style={{
                      height: 6, background: "#0b0b0b", borderRadius: 4,
                      overflow: "hidden", position: "relative",
                    }}>
                      <div style={{
                        height: "100%", background: m.color,
                        borderRadius: 4,
                        "--nt-target-w": `${pct}%`,
                        width: `${pct}%`,
                        animation: `ntGrowBar 0.7s ${i * 0.12}s ease backwards`,
                        boxShadow: pct > 0 ? `0 0 8px ${m.color}40` : "none",
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {showSparkline && (
              <div style={{
                marginTop: 14, padding: "12px 10px",
                background: "#0f0f0f", border: "1px solid #1e1e1e",
                borderRadius: 10,
              }}>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  color: "#666", letterSpacing: "0.08em", marginBottom: 8,
                }}>
                  {period === "week" ? "LAST 7 DAYS · KCAL" : "LAST 30 DAYS · KCAL"}
                </div>
                {(() => {
                  const max = series.reduce((n, d) => Math.max(n, d.kcal || 0), 0) || 1;
                  const minBarPct = 3;
                  return (
                    <div style={{
                      display: "flex", alignItems: "flex-end", gap: 3,
                      height: 60,
                    }}>
                      {series.map((d, i) => {
                        const pct = d.kcal > 0
                          ? Math.max(minBarPct, (d.kcal / max) * 100)
                          : minBarPct;
                        const isEmpty = !(d.meals > 0);
                        return (
                          <div
                            key={d.date}
                            title={`${d.date} · ${Math.round(d.kcal || 0)} kcal · ${d.meals} meal${d.meals === 1 ? "" : "s"}`}
                            style={{
                              flex: 1,
                              height: `${pct}%`,
                              background: isEmpty ? "#1c1c1c" : "#d4a87a",
                              borderRadius: 2,
                              boxShadow: isEmpty ? "none" : "0 0 6px #d4a87a30",
                              animation: `ntGrowHeight 0.5s ${i * 0.02}s ease backwards`,
                              "--nt-h": `${pct}%`,
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {coverageText && (
              <div style={{
                marginTop: 10,
                fontFamily: "'DM Mono',monospace", fontSize: 9,
                color: "#555", letterSpacing: "0.08em",
              }}>
                {coverageText}
              </div>
            )}

            {tally.today?.meals === 0 && period === "day" && (
              <p style={{
                marginTop: 10,
                fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                color: "#666", fontStyle: "italic",
              }}>
                No cooks logged today yet.
              </p>
            )}
          </>
        )}
      </div>

      {editingGoals && (
        <GoalEditor
          targets={eff}
          onClose={() => setEditingGoals(false)}
          onSave={async (patch) => {
            await onUpdateTargets?.(patch);
            setEditingGoals(false);
          }}
        />
      )}
    </div>
  );
}

function GoalEditor({ targets, onClose, onSave }) {
  const [draft, setDraft] = useState({
    kcal:      String(targets.kcal      ?? ""),
    protein_g: String(targets.protein_g ?? ""),
    fat_g:     String(targets.fat_g     ?? ""),
    carb_g:    String(targets.carb_g    ?? ""),
  });

  const rows = [
    { key: "kcal",      label: "CALORIES", unit: "kcal", color: "#d4a87a" },
    { key: "protein_g", label: "PROTEIN",  unit: "g",    color: "#7ec87e" },
    { key: "fat_g",     label: "FAT",      unit: "g",    color: "#d4743e" },
    { key: "carb_g",    label: "CARBS",    unit: "g",    color: "#8ac8e8" },
  ];

  const save = () => {
    const patch = {};
    for (const r of rows) {
      const v = Number(draft[r.key]);
      if (Number.isFinite(v) && v > 0) patch[r.key] = v;
    }
    onSave?.(patch);
  };

  return (
    <ModalSheet onClose={onClose}>
      <div style={{ padding: "16px 20px 24px" }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 6 }}>
          DAILY GOALS
        </div>
        <h2 style={{
          fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
          color: "#f0ece4", fontWeight: 400, margin: 0, marginBottom: 14,
        }}>
          What are you aiming for?
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map(r => (
            <label key={r.key} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px",
              background: "#141414", border: "1px solid #242424",
              borderRadius: 10,
            }}>
              <span style={{
                flex: 1,
                fontFamily: "'DM Mono',monospace", fontSize: 11,
                color: r.color, letterSpacing: "0.08em",
              }}>
                {r.label}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft[r.key]}
                onChange={e => setDraft(prev => ({ ...prev, [r.key]: e.target.value }))}
                style={{
                  width: 80, padding: "6px 8px",
                  background: "#0b0b0b", border: "1px solid #2a2a2a",
                  color: "#f0ece4", borderRadius: 8,
                  fontFamily: "'DM Mono',monospace", fontSize: 14,
                  textAlign: "right", outline: "none",
                }}
              />
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", minWidth: 32 }}>
                {r.unit}
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "12px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              color: "#888", borderRadius: 10,
              fontFamily: "'DM Mono',monospace", fontSize: 11,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={save}
            style={{
              flex: 2, padding: "12px",
              background: "#7ec87e", border: "none",
              color: "#0a1a0a", borderRadius: 10,
              fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.08em", cursor: "pointer",
            }}
          >
            SAVE GOALS
          </button>
        </div>
      </div>
    </ModalSheet>
  );
}
