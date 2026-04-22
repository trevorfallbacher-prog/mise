import { useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";

/**
 * CookInstructionsSheet — read-only preview of a pantry row's
 * cookInstructions (migration 0125).
 *
 * After the UX consolidation: AI generation lives exclusively in the
 * EAT button flow (EatIntentSheet → GENERATE REHEAT WITH AI). This
 * sheet is now a pure preview surface — no SUGGEST, no REGENERATE,
 * no SAVE. Users who want to REGENERATE go through EAT → GENERATE
 * (which overwrites the block). CLEAR stays so users can drop bad
 * instructions; clearing returns them to the empty state where the
 * EAT flow takes over.
 *
 * Props:
 *   item       — pantry row. Reads .name, .emoji, .cookInstructions.
 *   fromCanonical — true when the block came from ingredient_info.
 *   fromRecipe    — true when the block was synthesized from a
 *                   source-recipe's reheat block at render time.
 *   verb       — "COOK" or "REHEAT" depending on context (raw
 *                ingredient vs meal leftover).
 *   onClose()  — dismiss.
 *   onSave(block | null) — the parent's commit path. We only use
 *                the null form here (CLEAR); generation/save flow
 *                lives elsewhere.
 */

export default function CookInstructionsSheet({
  item,
  fromCanonical = false,
  fromRecipe = false,
  verb = "COOK",
  onClose, onSave,
}) {
  const block = item?.cookInstructions || null;
  const steps = Array.isArray(block?.steps) ? block.steps : [];

  const [clearing, setClearing] = useState(false);
  const [error,    setError]    = useState(null);

  const clear = async () => {
    setError(null);
    setClearing(true);
    try {
      await onSave?.(null);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Couldn't clear — try again.");
      setClearing(false);
    }
  };

  return (
    <ModalSheet onClose={onClose} zIndex={Z.picker} label={`${verb} INSTRUCTIONS`}>
      <div style={{ padding: "4px 22px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div style={{ fontSize: 40, flexShrink: 0 }}>{item?.emoji || "🍽️"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 20, color: "#f0ece4", lineHeight: 1.15 }}>
              {item?.name || "Ingredient"}
            </div>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", marginTop: 4, letterSpacing: "0.12em" }}>
              MINI {verb} RECIPE · OPENS ON EAT
              {fromCanonical && (
                <span style={{ marginLeft: 8, color: "#a99870" }}>· FROM ENRICHMENT</span>
              )}
              {fromRecipe && (
                <span style={{ marginLeft: 8, color: "#a99870" }}>· FROM RECIPE</span>
              )}
            </div>
          </div>
        </div>

        {/* Preview — when a block exists. Reads like a mini recipe
            card: emoji + title header, reheat summary pill, then each
            step as a card (icon, title, instruction, timer / heat /
            doneCue / tip badges). */}
        {block && steps.length > 0 ? (
          <div style={{
            padding: "16px", marginBottom: 14,
            background: "#0f0f0f", border: "1px solid #222",
            borderRadius: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 28, flexShrink: 0 }}>{block.emoji || "♨"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 18, color: "#f0ece4", lineHeight: 1.15 }}>
                  {block.title || "Reheat"}
                </div>
                {block.summary && (
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", marginTop: 3, letterSpacing: "0.08em" }}>
                    ♨ {block.summary}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {steps.map((s, i) => (
                <div
                  key={s.id || i}
                  style={{
                    padding: "10px 12px",
                    background: "#141414", border: "1px solid #242424",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#888", letterSpacing: "0.12em", marginBottom: 4 }}>
                    <span style={{ marginRight: 6 }}>{s.icon || "👨‍🍳"}</span>
                    STEP {i + 1}
                    {typeof s.timer === "number" && s.timer > 0 && (
                      <span style={{ marginLeft: 8, color: "#f5c842" }}>
                        · {Math.round(s.timer / 60)}m {s.timer % 60 ? `${s.timer % 60}s` : ""}
                      </span>
                    )}
                    {s.heat && (
                      <span style={{ marginLeft: 8, color: "#e0a868" }}>
                        · 🔥 {String(s.heat).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: "'Fraunces',serif", fontSize: 14, color: "#f0ece4", fontStyle: "italic", marginBottom: 4 }}>
                    {s.title}
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb", lineHeight: 1.45 }}>
                    {s.instruction}
                  </div>
                  {s.doneCue && (
                    <div style={{ marginTop: 5, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#c9a34e" }}>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: "0.1em", color: "#8a7a5a", marginRight: 4 }}>
                        DONE WHEN
                      </span>
                      {s.doneCue}
                    </div>
                  )}
                  {s.tip && (
                    <div style={{ marginTop: 5, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#6aa3d9" }}>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: "0.1em", color: "#4a7aa5", marginRight: 4 }}>
                        TIP
                      </span>
                      {s.tip}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{
            padding: "14px 16px", marginBottom: 14,
            background: "#0f0f0f", border: "1px dashed #242424",
            borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
            color: "#888", lineHeight: 1.5,
          }}>
            No {verb.toLowerCase()} instructions yet. Tap the EAT button on
            this item and pick GENERATE REHEAT WITH AI — Claude will
            write a tight walkthrough and save it to the row.
          </div>
        )}

        {error && (
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "#1a0f0f", border: "1px solid #3a1a1a", borderRadius: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#f87171" }}>
            {error}
          </div>
        )}

        {block && (
          <button
            type="button"
            onClick={clear}
            disabled={clearing}
            style={{
              width: "100%", padding: "14px",
              background: "#1a1a1a", border: "1px solid #3a1a1a",
              color: "#f87171", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
              letterSpacing: "0.1em",
              cursor: clearing ? "not-allowed" : "pointer",
            }}
          >
            {clearing ? "CLEARING…" : "CLEAR"}
          </button>
        )}
      </div>
    </ModalSheet>
  );
}
