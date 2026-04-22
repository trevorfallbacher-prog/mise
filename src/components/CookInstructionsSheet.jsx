import { useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";
import { suggestCookInstructions } from "../lib/suggestCookInstructions";

/**
 * CookInstructionsSheet — recipe-shape preview editor for
 * pantry_items.cook_instructions (migration 0125).
 *
 * After the pivot to recipe-shaped cook_instructions, this sheet is
 * essentially a SUGGEST-with-AI surface. The AI drafts a tight
 * mini-recipe (title, emoji, reheat summary, steps[]); the user
 * previews it and either SAVEs, REGENERATEs, or CLEARs. No manual
 * step authoring in this sheet — keep it tight. Power users who want
 * to hand-edit can do it via a direct pantry_items row update later.
 *
 * Props:
 *   item — pantry row. We read .name, .emoji, .ingredientId /
 *          .canonicalId, .brand, .state, .cut, .category,
 *          .cookInstructions.
 *   onClose() — dismiss.
 *   onSave(block | null) — persist. Pass null to clear.
 */

export default function CookInstructionsSheet({ item, onClose, onSave }) {
  const existing = item?.cookInstructions || null;

  const [draft,    setDraft]    = useState(existing);
  const [suggesting, setSuggesting] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState(null);

  // AI autofill. Calls the suggest-cook-instructions edge function
  // with the row's identity axes and replaces the local draft with
  // the response. Saving persists; regenerating discards the draft.
  const suggest = async () => {
    setError(null);
    setSuggesting(true);
    try {
      const { cookInstructions, error: err } = await suggestCookInstructions({
        name:        item?.name,
        canonicalId: item?.ingredientId || item?.canonicalId,
        brand:       item?.brand,
        state:       item?.state,
        cut:         item?.cut,
        category:    item?.category,
      });
      if (err) { setError(err); return; }
      if (!cookInstructions) { setError("Couldn't suggest — try again."); return; }
      setDraft(cookInstructions);
    } catch (e) {
      setError(e?.message || "Couldn't suggest — try again.");
    } finally {
      setSuggesting(false);
    }
  };

  const save = async () => {
    setError(null);
    if (!draft) { setError("Generate a draft first."); return; }
    setSaving(true);
    try {
      await onSave?.(draft);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await onSave?.(null);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Couldn't clear — try again.");
    } finally {
      setSaving(false);
    }
  };

  const steps = Array.isArray(draft?.steps) ? draft.steps : [];

  return (
    <ModalSheet onClose={onClose} zIndex={Z.picker} label="COOK INSTRUCTIONS">
      <div style={{ padding: "4px 22px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div style={{ fontSize: 40, flexShrink: 0 }}>{item?.emoji || "🍽️"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 20, color: "#f0ece4", lineHeight: 1.15 }}>
              {item?.name || "Ingredient"}
            </div>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", marginTop: 4, letterSpacing: "0.12em" }}>
              MINI RECIPE · OPENS ON "I ATE THIS"
            </div>
          </div>
        </div>

        {/* SUGGEST button — the primary action when no draft exists;
            becomes REGENERATE once a draft is on screen. Same gold-
            on-dark palette as the AIRecipe draft CTA so users learn
            one vocabulary across both surfaces. */}
        <button
          type="button"
          onClick={suggest}
          disabled={suggesting || saving}
          style={{
            width: "100%", padding: "12px 14px", marginBottom: 14,
            background: suggesting ? "#1a1a1a" : "#1a1608",
            border: `1px solid ${suggesting ? "#2a2a2a" : "#3a2f10"}`,
            color: suggesting ? "#888" : "#f5c842",
            borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
            letterSpacing: "0.1em", cursor: suggesting || saving ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <span style={{ fontSize: 14 }}>{suggesting ? "⏳" : "✨"}</span>
          {suggesting ? "SUGGESTING…" : draft ? "REGENERATE WITH AI" : "SUGGEST WITH AI"}
        </button>

        {/* Draft preview — only when a draft exists. Reads like a
            mini ItemCard for a recipe: emoji + title header, reheat
            summary pill, then each step as a card (icon, title,
            instruction, timer / heat / doneCue / tip badges). */}
        {draft && (
          <div style={{
            padding: "16px", marginBottom: 14,
            background: "#0f0f0f", border: "1px solid #222",
            borderRadius: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 28, flexShrink: 0 }}>{draft.emoji || "♨"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 18, color: "#f0ece4", lineHeight: 1.15 }}>
                  {draft.title || "Reheat"}
                </div>
                {draft.summary && (
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", marginTop: 3, letterSpacing: "0.08em" }}>
                    ♨ {draft.summary}
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
                </div>
              ))}
            </div>
          </div>
        )}

        {!draft && !suggesting && (
          <div style={{
            padding: "14px 16px", marginBottom: 14,
            background: "#0f0f0f", border: "1px dashed #242424",
            borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
            color: "#888", lineHeight: 1.5,
          }}>
            No cook instructions yet. Tap SUGGEST and Claude will write a
            tight 2–5 step walkthrough based on the item's identity.
            You can regenerate until it reads right, then SAVE.
          </div>
        )}

        {error && (
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "#1a0f0f", border: "1px solid #3a1a1a", borderRadius: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#f87171" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          {existing && (
            <button
              type="button"
              onClick={clear}
              disabled={saving}
              style={{
                flex: 1, padding: "14px",
                background: "#1a1a1a", border: "1px solid #3a1a1a",
                color: "#f87171", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 11,
                letterSpacing: "0.1em", cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              CLEAR
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || !draft}
            style={{
              flex: existing ? 2 : 1, padding: "14px",
              background: saving || !draft ? "#1a1a1a" : "#f5c842",
              border: "none", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
              color: saving || !draft ? "#444" : "#111",
              cursor: saving || !draft ? "not-allowed" : "pointer",
              letterSpacing: "0.08em",
            }}
          >
            {saving ? "SAVING…" : "SAVE"}
          </button>
        </div>
      </div>
    </ModalSheet>
  );
}
