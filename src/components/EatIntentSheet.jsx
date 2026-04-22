import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";

/**
 * EatIntentSheet — intercept between the EAT button and the actual
 * walkthrough / log flow. Asks "what did you just do?" rather than
 * inferring from state, so the user controls the path each time:
 *   REHEAT FIRST  — launch the full-screen ReheatMode walkthrough,
 *                   then chain into the amount-and-log sheet.
 *   ALREADY ATE IT — skip straight to the amount-and-log sheet.
 *
 * Opens ONLY when reheat instructions exist for the row (per-row
 * cookInstructions, canonical enrichment, or source-recipe synth).
 * When there's nothing to reheat, ItemCard bypasses this sheet and
 * opens IAteThisSheet directly — no need to ask.
 *
 * Props:
 *   item         — pantry row (for header context: emoji, name).
 *   summary      — short method+time string for the REHEAT option
 *                  subtitle ("Oven 350°F · 15 min"). Optional.
 *   onReheat()   — user picked REHEAT FIRST.
 *   onJustLog()  — user picked ALREADY ATE IT.
 *   onClose()    — user dismissed the sheet.
 */
export default function EatIntentSheet({ item, summary, onReheat, onJustLog, onClose }) {
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

        {/* Primary option — REHEAT FIRST. Gold-on-dark palette matches
            the rest of the cook-walkthrough surfaces so the user
            learns one vocabulary. Subtitle shows the method + time
            so the user knows what they're about to do before tapping. */}
        <button
          type="button"
          onClick={onReheat}
          style={{
            width: "100%", padding: "16px 18px", marginBottom: 10,
            background: "#1a1608", border: "1px solid #3a2f10",
            borderRadius: 12, textAlign: "left",
            display: "flex", alignItems: "center", gap: 14,
            cursor: "pointer",
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
              {summary ? `${summary} — walk through the cook screen, then log the bite.` : "Walk through the cook screen, then log the bite."}
            </div>
          </div>
          <span style={{ color: "#f5c842", fontFamily: "'DM Mono',monospace", fontSize: 14 }}>→</span>
        </button>

        {/* Secondary option — already ate it cold / didn't need to
            heat. Muted palette (same as neutral buttons elsewhere)
            so the primary REHEAT reads as the default path. */}
        <button
          type="button"
          onClick={onJustLog}
          style={{
            width: "100%", padding: "16px 18px",
            background: "#0f1a0f", border: "1px solid #1e3a1e",
            borderRadius: 12, textAlign: "left",
            display: "flex", alignItems: "center", gap: 14,
            cursor: "pointer",
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
      </div>
    </ModalSheet>
  );
}
