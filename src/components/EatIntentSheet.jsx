import { useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";

/**
 * EatIntentSheet — intercept between the EAT button and the actual
 * walkthrough / log flow. Asks "what did you just do?" each time so
 * the user picks the path. Three states:
 *
 *   hasReheat=true  → REHEAT FIRST + ALREADY ATE IT
 *   hasReheat=false → GENERATE REHEAT WITH AI + ALREADY ATE IT
 *
 * The GENERATE path fires a single AI call (via the generate prop
 * supplied by the parent), persists the result as the row's new
 * cookInstructions, then hands control back to ItemCard which opens
 * ReheatMode on the freshly generated walkthrough. Loading and
 * error states render inline — no secondary modal to manage.
 *
 * Props:
 *   item       — pantry row (header context: emoji, name).
 *   hasReheat  — bool; whether effectiveCookInstructions has steps.
 *   summary    — short method+time string for the REHEAT option
 *                subtitle (e.g. "Oven 350°F · 15 min"). Optional.
 *   onReheat() — user picked REHEAT FIRST. Only when hasReheat.
 *   onGenerate() — async. Parent runs the AI call + save; when the
 *                  promise resolves the parent closes this sheet and
 *                  opens ReheatMode on the fresh recipe.
 *   onJustLog() — user picked ALREADY ATE IT.
 *   onClose() — dismiss.
 */
export default function EatIntentSheet({
  item, hasReheat, summary,
  onReheat, onGenerate, onJustLog, onClose,
}) {
  const [generating, setGenerating] = useState(false);
  const [error,      setError]      = useState(null);

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      await onGenerate?.();
      // parent closes us + opens ReheatMode on success
    } catch (e) {
      setError(e?.message || "Couldn't generate — try again.");
      setGenerating(false);
    }
  };

  const primaryDisabled = generating;

  return (
    <ModalSheet onClose={onClose} zIndex={Z.picker} label="EAT">
      <div style={{ padding: "4px 22px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 40, flexShrink: 0 }}>{item?.emoji || "🍽️"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7ec87e", letterSpacing: "0.14em" }}>
              EAT
            </div>
            <div style={{
              fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 20,
              color: "#f0ece4", lineHeight: 1.15, marginTop: 2,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {item?.name || "Item"}
            </div>
          </div>
        </div>

        {/* PRIMARY path.
            hasReheat=true  → REHEAT FIRST (method summary subtitle)
            hasReheat=false → GENERATE REHEAT WITH AI (swaps in a
                              sparkle + different copy; tapping fires
                              the async onGenerate and shows a
                              loading state until the parent swaps us
                              out for ReheatMode). */}
        {hasReheat ? (
          <button
            type="button"
            onClick={onReheat}
            disabled={primaryDisabled}
            style={{
              width: "100%", padding: "16px 18px", marginBottom: 10,
              background: "#1a1608", border: "1px solid #3a2f10",
              borderRadius: 12, textAlign: "left",
              display: "flex", alignItems: "center", gap: 14,
              cursor: primaryDisabled ? "not-allowed" : "pointer",
              opacity: primaryDisabled ? 0.5 : 1,
            }}
          >
            <span style={{ fontSize: 28, flexShrink: 0 }}>♨</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
                color: "#f5c842", letterSpacing: "0.1em",
              }}>
                REHEAT FIRST
              </div>
              <div style={{
                fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#bbb",
                marginTop: 2, lineHeight: 1.35,
              }}>
                {summary
                  ? `${summary} — walk through the cook screen, then log the bite.`
                  : "Walk through the cook screen, then log the bite."}
              </div>
            </div>
            <span style={{ color: "#f5c842", fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={primaryDisabled}
            style={{
              width: "100%", padding: "16px 18px", marginBottom: 10,
              background: generating ? "#1a1a1a" : "#1a1608",
              border: `1px solid ${generating ? "#2a2a2a" : "#3a2f10"}`,
              borderRadius: 12, textAlign: "left",
              display: "flex", alignItems: "center", gap: 14,
              cursor: primaryDisabled ? "not-allowed" : "pointer",
            }}
          >
            <span style={{ fontSize: 28, flexShrink: 0 }}>{generating ? "⏳" : "✨"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
                color: generating ? "#888" : "#f5c842", letterSpacing: "0.1em",
              }}>
                {generating ? "GENERATING…" : "GENERATE REHEAT WITH AI"}
              </div>
              <div style={{
                fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#bbb",
                marginTop: 2, lineHeight: 1.35,
              }}>
                Claude writes a tight 2-5 step walkthrough for this item, saves it to the row, and opens the cook screen.
              </div>
            </div>
            <span style={{ color: generating ? "#888" : "#f5c842", fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
          </button>
        )}

        {/* Skip-reheat path — always available, same visual weight as
            the secondary action elsewhere in the consumption flow. */}
        <button
          type="button"
          onClick={onJustLog}
          disabled={primaryDisabled}
          style={{
            width: "100%", padding: "16px 18px",
            background: "#0f1a0f", border: "1px solid #1e3a1e",
            borderRadius: 12, textAlign: "left",
            display: "flex", alignItems: "center", gap: 14,
            cursor: primaryDisabled ? "not-allowed" : "pointer",
            opacity: primaryDisabled ? 0.5 : 1,
          }}
        >
          <span style={{ fontSize: 28, flexShrink: 0 }}>📝</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
              color: "#7ec87e", letterSpacing: "0.1em",
            }}>
              ALREADY ATE IT
            </div>
            <div style={{
              fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#bbb",
              marginTop: 2, lineHeight: 1.35,
            }}>
              Skip the reheat walkthrough — just log how much and what meal.
            </div>
          </div>
          <span style={{ color: "#7ec87e", fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
        </button>

        {error && (
          <div style={{
            marginTop: 12, padding: "10px 12px",
            background: "#1a0f0f", border: "1px solid #3a1a1a",
            borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#f87171",
            lineHeight: 1.4,
          }}>
            {error}
          </div>
        )}
      </div>
    </ModalSheet>
  );
}
