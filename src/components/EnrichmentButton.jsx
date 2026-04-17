import { useState } from "react";
import { enrichIngredient } from "../lib/enrichIngredient";
import { useIngredientInfo } from "../lib/useIngredientInfo";

// Button that triggers on-demand AI enrichment for an ingredient with no
// metadata. Two call modes (pick one via props):
//
//   <EnrichmentButton canonicalId="burdock_root" />
//     For a canonical ingredient that has no ingredient_info row yet.
//
//   <EnrichmentButton sourceName="Nori from the Japanese store"
//                     pantryItemId={item.id} />
//     For a user-custom pantry item (ingredient_id === null).
//
// States:
//   idle       → "✨ Add AI Enrichment"
//   enriching  → disabled, spinner, "Generating…"
//   failed     → error message + retry link
//
// On success, calls onEnriched(pending) if provided AND refreshes the
// IngredientInfo context so other mounted cards pick up the new draft.
// The edge function also fires a bell notification, so the user gets
// feedback even if they navigate away before the response lands.

export default function EnrichmentButton({
  canonicalId = null,
  sourceName = null,
  pantryItemId = null,
  onEnriched,
  compact = false,
}) {
  const [state, setState] = useState("idle"); // idle | enriching | failed
  const [errMsg, setErrMsg] = useState("");
  const { refreshPending } = useIngredientInfo();

  if (!canonicalId && !sourceName) {
    // Misuse guard — don't render a button that can't do anything.
    return null;
  }

  async function handleClick() {
    setState("enriching");
    setErrMsg("");
    try {
      const { pending } = await enrichIngredient({
        canonical_id: canonicalId,
        source_name: sourceName,
        pantry_item_id: pantryItemId,
      });
      await refreshPending();
      setState("idle");
      if (typeof onEnriched === "function") {
        onEnriched(pending);
      }
    } catch (err) {
      setErrMsg(err.message || "Enrichment failed");
      setState("failed");
    }
  }

  const baseStyle = {
    border: "none",
    borderRadius: 8,
    cursor: state === "enriching" ? "wait" : "pointer",
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: compact ? "6px 12px" : "10px 16px",
    fontSize: compact ? 13 : 14,
    background:
      state === "failed"
        ? "#d98a8a"
        : state === "enriching"
          ? "#a3c9d9"
          : "#f5c842",
    color: state === "failed" ? "#fff" : "#2a1a05",
    opacity: state === "enriching" ? 0.85 : 1,
    transition: "background 0.15s ease, transform 0.05s ease",
  };

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        disabled={state === "enriching"}
        onClick={handleClick}
        style={baseStyle}
        aria-busy={state === "enriching"}
      >
        {state === "enriching" ? (
          <>
            <span className="spin" aria-hidden="true">⏳</span>
            Generating…
          </>
        ) : state === "failed" ? (
          <>🔄 Retry enrichment</>
        ) : (
          <>✨ Add AI Enrichment</>
        )}
      </button>
      {state === "failed" && errMsg && (
        <div style={{ fontSize: 12, color: "#d98a8a", maxWidth: 280 }}>
          {errMsg}
        </div>
      )}
    </div>
  );
}
