import { useState } from "react";
import { supabase } from "../lib/supabase";
import { enrichIngredient } from "../lib/enrichIngredient";
import { useIngredientInfo, slugifyIngredientName } from "../lib/useIngredientInfo";

// Button that triggers on-demand AI enrichment for an ingredient with no
// metadata. Two call modes (pick one via props):
//
//   <EnrichmentButton canonicalId="burdock_root" />
//     For a canonical ingredient that has no ingredient_info row yet.
//
//   <EnrichmentButton sourceName="Nori from the Japanese store"
//                     pantryItemId={item.id} />
//     For a user-custom pantry item (canonical_id === null). The button
//     stamps canonical_id = slugify(sourceName) onto the pantry row
//     BEFORE requesting the enrichment — so every downstream lookup
//     (ItemCard, admin queue, approved ingredient_info join) agrees on
//     a single key. Without this stamping, the pending row was keyed by
//     slugify(source_name_at_enrichment_time) and the read path re-
//     slugified item.name; any drift in between (user edits the name,
//     admin renames, different slugifiers) orphaned the enrichment.
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
      // Resolve the canonical id we'll submit + store. Case A: a real
      // bundled canonical was passed in, use it. Case B: sourceName
      // only — slugify it and stamp it onto the pantry row FIRST so
      // the enrichment lands keyed by that same slug and subsequent
      // reads (ItemCard's getPendingInfo(item.canonicalId)) can find
      // it. Without the stamp, pending_ingredient_info.slug and
      // item.canonicalId can drift apart and the enrichment falls
      // off the UI even though it was saved.
      let resolvedCanonicalId = canonicalId;
      if (!resolvedCanonicalId && sourceName) {
        const slug = slugifyIngredientName(sourceName);
        if (slug) {
          resolvedCanonicalId = slug;
          if (pantryItemId) {
            // Best-effort — a failure here doesn't block enrichment,
            // but it does mean the read path won't find the pending
            // row until the admin approves (ingredient_info keyed by
            // the admin-chosen canonical).
            const { error: stampErr } = await supabase
              .from("pantry_items")
              .update({ canonical_id: slug })
              .eq("id", pantryItemId)
              .is("canonical_id", null);
            if (stampErr) console.warn("[enrichment] canonical stamp failed:", stampErr.message);
          }
        }
      }

      const { pending } = await enrichIngredient({
        canonical_id: resolvedCanonicalId,
        source_name: resolvedCanonicalId ? null : sourceName,
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
