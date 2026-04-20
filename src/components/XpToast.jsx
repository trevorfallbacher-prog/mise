import { useEffect, useState } from "react";

// Single +N XP toast. Top-right slide-in, auto-dismisses after
// `holdMs` (default 2000ms). Color pulled from the reserved
// palette (CLAUDE.md identity hierarchy) when the source maps
// to one of the six axes; otherwise a neutral muted gold.
//
// Per §5: "Toast sits for ~2s, then slides out." Single line,
// no decoration beyond the +N value and a short copy.
//
// Source → palette map:
//   canonical_create / canonical_approved → tan    (#b8a878 — CANONICAL)
//   scan_add / pantry_hygiene             → blue   (#7eb8d4 — STORED IN)
//   review_cook                           → muted purple (STATE-ish)
//   photo_upload                          → muted gold
//   nutrition_goal_day                    → yellow (#f5c842)
//   onboarding_*                          → yellow
//   badge_earn                            → yellow
//   plan_cook_closed / eat_together /
//   cook_together / authors_cut /
//   first_time_recipe / mastery_*         → orange (#e07a3a — FOOD CATEGORY)
//   default                               → gold (#d4a87a)

const SOURCE_PALETTE = {
  canonical_create:    { color: "#b8a878", label: "Canonical submitted" },
  canonical_approved:  { color: "#b8a878", label: "Canonical approved" },
  scan_add:            { color: "#7eb8d4", label: "Pantry add" },
  pantry_hygiene:      { color: "#7eb8d4", label: "Pantry hygiene" },
  review_cook:         { color: "#c7a8d4", label: "Review posted" },
  photo_upload:        { color: "#d4a87a", label: "Photo added" },
  nutrition_goal_day:  { color: "#f5c842", label: "Nutrition goal" },
  badge_earn:          { color: "#f5c842", label: "Badge earned" },
  plan_cook_closed:    { color: "#e07a3a", label: "Plan closed" },
  eat_together:        { color: "#e07a3a", label: "Eaten together" },
  cook_together:       { color: "#e07a3a", label: "Cook-together" },
  authors_cut:         { color: "#e07a3a", label: "Author's cut" },
  first_time_recipe:   { color: "#e07a3a", label: "First-time cook" },
  mastery_5x:          { color: "#e07a3a", label: "Mastery · 5×" },
  mastery_10x:         { color: "#e07a3a", label: "Mastery · 10×" },
  mastery_25x:         { color: "#e07a3a", label: "Mastery · 25×" },
  authored_recipe:     { color: "#f5c842", label: "Recipe authored" },
  cook_complete:       { color: "#d4a87a", label: "Cook complete" },
  daily_roll:          { color: "#f5c842", label: "Daily roll" },
};

function paletteFor(row) {
  if (row.source && row.source.startsWith("onboarding_")) {
    return { color: "#f5c842", label: "First time!" };
  }
  return SOURCE_PALETTE[row.source] || { color: "#d4a87a", label: row.source };
}

export default function XpToast({ row, onDismiss, holdMs = 2000 }) {
  const [phase, setPhase] = useState("entering");
  const palette = paletteFor(row);
  const isGated = (row.gate_adjustment || 0) < 0;
  const value   = isGated ? row.gate_adjustment : row.final_xp;

  useEffect(() => {
    const enterT = setTimeout(() => setPhase("holding"), 50);
    const exitT  = setTimeout(() => setPhase("leaving"), holdMs);
    const doneT  = setTimeout(() => onDismiss?.(row.id), holdMs + 300);
    return () => {
      clearTimeout(enterT);
      clearTimeout(exitT);
      clearTimeout(doneT);
    };
  }, [row.id, holdMs, onDismiss]);

  const translate = phase === "entering" ? "translateX(120%)"
                  : phase === "leaving"  ? "translateX(120%)"
                  : "translateX(0)";
  const opacity   = phase === "entering" || phase === "leaving" ? 0 : 1;

  return (
    <div style={{
      background: "#161616",
      border: `1px solid ${palette.color}33`,
      borderLeft: `3px solid ${palette.color}`,
      borderRadius: 10,
      padding: "10px 14px",
      minWidth: 190,
      maxWidth: 260,
      boxShadow: "0 4px 18px rgba(0,0,0,.4)",
      transform: translate,
      opacity,
      transition: "transform 280ms ease-out, opacity 240ms ease-out",
      display: "flex",
      alignItems: "baseline",
      gap: 10,
    }}>
      <span style={{
        fontFamily: "'DM Mono',monospace",
        fontSize: 18,
        fontWeight: 600,
        color: isGated ? "#888" : palette.color,
        whiteSpace: "nowrap",
      }}>
        {value > 0 ? "+" : ""}{value} XP
      </span>
      <span style={{
        fontFamily: "'DM Sans',sans-serif",
        fontSize: 12,
        color: "#aaa",
        textTransform: "lowercase",
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {isGated ? "blocked by gate" : palette.label}
      </span>
    </div>
  );
}
