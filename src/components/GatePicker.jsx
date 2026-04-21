import { useCallback, useState } from "react";
import { supabase } from "../lib/supabase";
import ModalSheet from "./ModalSheet";
import { findRecipe } from "../data/recipes";

// Ranked-match picker. Opens from GateCard's CTA when all prereqs
// are green. Shows the 3 gate_recipe_slugs; user picks one, we
// flip user_gate_progress.status to 'in_match' and record the
// choice. After that, the user navigates to the recipe via their
// usual flow and cooks it. The pass detection (0112 trigger) fires
// automatically when the cook + all-nailed reviews land.
//
// If gate_recipe_slugs is empty (product hasn't filled them in
// yet — TBD per §2), we show a clear message and disable the
// picker so the user knows the feature is pending.
//
// Copy keeps the stakes clear: "This is your ranked match." Every
// diner must rate 'nailed' or the gate stays closed. Unlimited
// retries.

export default function GatePicker({ userId, gate, progress, onClose, onPicked }) {
  const [picking, setPicking] = useState(null);

  const slugs = Array.isArray(gate?.gate_recipe_slugs) ? gate.gate_recipe_slugs : [];
  const haveRecipes = slugs.length > 0;

  const pick = useCallback(async (slug) => {
    if (!userId || !slug) return;
    setPicking(slug);
    const { error } = await supabase
      .from("user_gate_progress")
      .update({
        status: "in_match",
        chosen_gate_recipe_slug: slug,
        in_match_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("gate_level", gate.gate_level);
    if (error) {
      console.error("[GatePicker] pick failed:", error);
      setPicking(null);
      return;
    }
    onPicked?.(slug);
    onClose?.();
  }, [userId, gate, onPicked, onClose]);

  return (
    <ModalSheet onClose={onClose}>
      <div style={{ padding: "28px 22px 22px" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#e07a3a", letterSpacing: "0.18em" }}>
            RANKED MATCH · L{gate.gate_level}
          </div>
          <div style={{
            fontFamily: "'Fraunces',serif", fontSize: 24, fontStyle: "italic",
            color: "#f0ece4", marginTop: 6, lineHeight: 1.25,
          }}>
            {gate.label}
          </div>
          <div style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#aaa",
            marginTop: 10, lineHeight: 1.5,
          }}>
            Pick one dish. Cook it. Every diner — including you — must rate it{" "}
            <b style={{ color: "#f5c842" }}>Nailed it</b>. Any lower rating and the gate stays shut.
          </div>
        </div>

        {!haveRecipes ? (
          <div style={{
            background: "#1a1208", border: "1px dashed #3a2f10", borderRadius: 12,
            padding: "24px 16px", textAlign: "center",
          }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#888", letterSpacing: "0.08em" }}>
              GATE RECIPES BEING CURATED
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", marginTop: 8, lineHeight: 1.5 }}>
              Your ranked-match options will appear here soon. Hold tight — your progress is saved.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {slugs.map((slug, i) => {
              const recipe = findRecipe(slug);
              const title  = recipe?.title || slug;
              const emoji  = recipe?.emoji || "🍽️";
              const subtitle = recipe?.subtitle || null;
              return (
                <button
                  key={slug}
                  onClick={() => pick(slug)}
                  disabled={picking === slug}
                  style={{
                    background: "#161616", border: "1px solid #2a2a2a", borderRadius: 12,
                    padding: "14px 16px", textAlign: "left", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 14,
                    opacity: picking && picking !== slug ? 0.4 : 1,
                    transition: "all 200ms",
                  }}
                >
                  <span style={{ fontSize: 32 }}>{emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Fraunces',serif", fontSize: 16, fontStyle: "italic", color: "#f0ece4" }}>
                      {title}
                    </div>
                    {subtitle && (
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", marginTop: 2 }}>
                        {subtitle}
                      </div>
                    )}
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#e07a3a", letterSpacing: "0.12em", marginTop: 4 }}>
                      OPTION {i + 1} OF 3
                    </div>
                  </div>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: "#e07a3a" }}>→</span>
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: "100%", marginTop: 18, background: "transparent",
            border: "1px solid #2a2a2a", color: "#888",
            borderRadius: 12, padding: "12px 0",
            fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.12em",
            cursor: "pointer",
          }}
        >
          NOT YET
        </button>
      </div>
    </ModalSheet>
  );
}
