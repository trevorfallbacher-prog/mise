import { useState } from "react";
import { generateCanonicalImage } from "../lib/generateCanonicalImage";
import { useIngredientInfo } from "../lib/useIngredientInfo";

// Admin-only button that triggers Recraft image generation for a
// canonical ingredient. Two visual modes based on whether an image
// already exists:
//
//   • no image yet → "🎨 Generate image" (primary-ish)
//   • image present → "↻ Regenerate"      (subdued)
//
// Unlike EnrichmentButton (one-shot, no regen), this one is meant
// to be re-tapped until the output feels right. Each tap overwrites
// the bucket object + the ingredient_info.info.imageUrl cache-bust
// query param, so the UI re-renders the new image without a manual
// refresh.
//
// Hidden entirely for non-admins. Cost gate — Recraft is a paid
// upstream; the edge function also enforces admin-only server-side,
// but hiding the button client-side keeps non-admin users from
// seeing a dead-end "forbidden" error.
//
// Props:
//   canonicalId     — slug we're generating for (required)
//   canonicalName   — human-readable name fed to the prompt (required)
//   hasExistingImage— bool; drives label + styling
//   isAdmin         — when false, component renders null
//   compact         — smaller chip variant for header slots
//   onGenerated(url)— optional; called with the fresh image URL after
//                     a successful write. Parent can update local
//                     state immediately while the ingredient_info
//                     context refresh catches up.

export default function GenerateImageButton({
  canonicalId,
  canonicalName,
  hasExistingImage = false,
  isAdmin = false,
  compact = false,
  onGenerated,
}) {
  const [state, setState] = useState("idle"); // idle | generating | failed
  const [errMsg, setErrMsg] = useState("");
  const { refreshDb } = useIngredientInfo();

  if (!isAdmin || !canonicalId || !canonicalName) return null;

  async function handleClick() {
    setState("generating");
    setErrMsg("");
    try {
      const { imageUrl } = await generateCanonicalImage({ canonicalId, canonicalName });
      // Refresh the approved-canonical map so any mounted card that
      // reads info.imageUrl picks up the new URL automatically.
      await refreshDb?.();
      setState("idle");
      if (typeof onGenerated === "function") onGenerated(imageUrl);
    } catch (err) {
      setErrMsg(err.message || "Image generation failed");
      setState("failed");
    }
  }

  const busy = state === "generating";
  const failed = state === "failed";

  const label = busy
    ? "Generating…"
    : failed
      ? "↻ Retry image"
      : hasExistingImage
        ? "↻ Regenerate image"
        : "🎨 Generate image";

  const baseStyle = {
    border: "1px dashed #3a2f10",
    borderRadius: 8,
    cursor: busy ? "wait" : "pointer",
    fontWeight: 500,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: compact ? "4px 10px" : "8px 14px",
    fontFamily: "'DM Mono',monospace",
    fontSize: compact ? 10 : 11,
    letterSpacing: "0.08em",
    background: failed ? "#2a0f0f" : "#1a1608",
    color: failed ? "#f87171" : hasExistingImage ? "#888" : "#f5c842",
    opacity: busy ? 0.7 : 1,
    transition: "all 0.15s",
  };

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        disabled={busy}
        onClick={handleClick}
        style={baseStyle}
        aria-busy={busy}
      >
        {busy && <span aria-hidden="true" style={{ animation: "spin 1s linear infinite" }}>⏳</span>}
        <span>{label}</span>
      </button>
      {failed && errMsg && (
        <div style={{
          fontSize: 11, color: "#d98a8a",
          fontFamily: "'DM Sans',sans-serif", maxWidth: 280, lineHeight: 1.4,
        }}>
          {errMsg}
        </div>
      )}
    </div>
  );
}
