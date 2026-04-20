import { useState } from "react";
import { generateCanonicalImage, setCanonicalImageLock } from "../lib/generateCanonicalImage";
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
  isLocked = false,
  isAdmin = false,
  userId = null,
  compact = false,
  onGenerated,
}) {
  const [state, setState]   = useState("idle"); // idle | generating | locking | failed
  const [errMsg, setErrMsg] = useState("");
  // Unlock requires a two-tap confirmation so an admin doesn't
  // accidentally flip a finalized canonical back into draft state.
  const [unlockArmed, setUnlockArmed] = useState(false);
  // Optional prompt hint tacked onto the next generation. Free-form
  // ("thicker strokes", "more minimal", "emphasize the stem") — the
  // edge function appends it to the end of the house prompt so the
  // admin can iterate on output without redeploying. Expanded inline
  // when the admin taps "✎ tweak prompt"; cleared after a successful
  // generation so stale hints don't leak into the next regen.
  const [hintOpen, setHintOpen] = useState(false);
  const [hint, setHint]         = useState("");
  const { refreshDb } = useIngredientInfo();

  if (!isAdmin || !canonicalId || !canonicalName) return null;

  async function handleGenerate() {
    setState("generating");
    setErrMsg("");
    try {
      const { imageUrl } = await generateCanonicalImage({
        canonicalId,
        canonicalName,
        hint: hint.trim() || undefined,
      });
      await refreshDb?.();
      // Clear the hint after a successful regen so an old "thicker
      // strokes" nudge doesn't silently apply to the next canonical
      // the admin generates.
      setHint("");
      setHintOpen(false);
      setState("idle");
      if (typeof onGenerated === "function") onGenerated(imageUrl);
    } catch (err) {
      setErrMsg(err.message || "Image generation failed");
      setState("failed");
    }
  }

  async function handleLock() {
    setState("locking");
    setErrMsg("");
    try {
      await setCanonicalImageLock({ canonicalId, locked: true, userId });
      await refreshDb?.();
      setState("idle");
    } catch (err) {
      setErrMsg(err.message || "Couldn't lock");
      setState("failed");
    }
  }

  async function handleUnlock() {
    if (!unlockArmed) {
      // First tap arms; render the button as "TAP AGAIN TO CONFIRM"
      // so the user can't fat-finger a locked canonical back open.
      setUnlockArmed(true);
      // Auto-disarm after 4s so the armed state doesn't persist
      // indefinitely in the background.
      setTimeout(() => setUnlockArmed(false), 4000);
      return;
    }
    setState("locking");
    setErrMsg("");
    try {
      await setCanonicalImageLock({ canonicalId, locked: false, userId });
      await refreshDb?.();
      setUnlockArmed(false);
      setState("idle");
    } catch (err) {
      setErrMsg(err.message || "Couldn't unlock");
      setState("failed");
    }
  }

  const busy = state === "generating" || state === "locking";
  const failed = state === "failed";

  // Shared style for the secondary (unlock / lock) buttons.
  const chipStyle = (accent) => ({
    border: `1px dashed ${accent.border}`,
    borderRadius: 8,
    cursor: busy ? "wait" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: compact ? "4px 10px" : "8px 14px",
    fontFamily: "'DM Mono',monospace",
    fontSize: compact ? 10 : 11,
    letterSpacing: "0.08em",
    background: accent.bg,
    color: accent.fg,
    opacity: busy ? 0.7 : 1,
    transition: "all 0.15s",
  });

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      {isLocked ? (
        // Locked branch. Primary button is the unlock toggle with
        // two-tap confirm; regeneration is off the table until the
        // admin explicitly unlocks first. Static "🔒 FINAL" label
        // sits next to the unlock button so the state reads clearly.
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span style={chipStyle({ border: "#2a2015", bg: "#1a1608", fg: "#f5c842" })}>
            🔒 FINAL
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={handleUnlock}
            style={chipStyle(unlockArmed
              ? { border: "#d9694a", bg: "#2a120a", fg: "#ff9178" }
              : { border: "#2a2a2a", bg: "#141414", fg: "#888" })}
            aria-busy={busy}
          >
            {state === "locking" && <span aria-hidden="true">⏳</span>}
            <span>
              {state === "locking"
                ? "Unlocking…"
                : unlockArmed
                  ? "TAP AGAIN TO UNLOCK"
                  : "🔓 Unlock to regenerate"}
            </span>
          </button>
        </div>
      ) : hasExistingImage ? (
        // Drafted branch. Regenerate is the primary action; Lock is
        // the adjacent chip for committing a final pick.
        <div style={{ display: "inline-flex", gap: 6 }}>
          <button
            type="button"
            disabled={busy}
            onClick={handleGenerate}
            style={chipStyle({ border: "#3a2f10", bg: "#1a1608", fg: "#888" })}
            aria-busy={busy}
          >
            {state === "generating" && <span aria-hidden="true">⏳</span>}
            <span>{state === "generating" ? "Generating…" : "↻ Regenerate"}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleLock}
            style={chipStyle({ border: "#2a3a1e", bg: "#0f1a0f", fg: "#a3d977" })}
            aria-busy={busy}
          >
            {state === "locking" && <span aria-hidden="true">⏳</span>}
            <span>{state === "locking" ? "Locking…" : "🔒 Lock as final"}</span>
          </button>
        </div>
      ) : (
        // Fresh branch — no image yet. Only the generate action.
        <button
          type="button"
          disabled={busy}
          onClick={handleGenerate}
          style={chipStyle({ border: "#3a2f10", bg: "#1a1608", fg: "#f5c842" })}
          aria-busy={busy}
        >
          {state === "generating" && <span aria-hidden="true">⏳</span>}
          <span>{state === "generating" ? "Generating…" : "🎨 Generate image"}</span>
        </button>
      )}
      {/* Optional prompt hint — expands inline under the generate
          chips. Hidden in the locked branch since regeneration is
          off the table there. Free-form text gets appended to the
          end of the house prompt server-side. Keeps the default
          flow quick (one tap) while giving admins an escape hatch
          when the default output isn't landing. */}
      {!isLocked && (
        hintOpen ? (
          <input
            type="text"
            autoFocus
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            onBlur={() => { if (!hint.trim()) setHintOpen(false); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setHint(""); setHintOpen(false); }
            }}
            placeholder="e.g. thicker strokes, more minimal, emphasize the stem"
            style={{
              marginTop: 2,
              padding: "6px 10px",
              background: "#0b0b0b", border: "1px solid #2a2a2a",
              color: "#f0ece4", borderRadius: 8,
              fontFamily: "'DM Mono',monospace", fontSize: 10,
              outline: "none",
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setHintOpen(true)}
            style={{
              background: "transparent", border: "none", padding: 0,
              color: "#555", cursor: "pointer",
              fontFamily: "'DM Mono',monospace", fontSize: 9,
              letterSpacing: "0.08em",
              textDecoration: "underline dotted", textUnderlineOffset: 2,
              alignSelf: "flex-start",
            }}
          >
            ✎ TWEAK PROMPT
          </button>
        )
      )}
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
