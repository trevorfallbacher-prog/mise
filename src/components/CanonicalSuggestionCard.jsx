// Suggestion card rendered after a successful barcode scan to confirm
// the canonical match before we lock it into the pantry row. Per
// design direction: always show, never silent-apply — even a high-
// confidence match benefits from a "looks like X — tap to confirm"
// moment. Half a tap's friction for zero pollution risk.
//
// Props:
//   match         — { canonical, confidence, reason, matchedOn }
//                   from canonicalResolver.resolveCanonicalFromScan
//   inferredState — optional { state, canonical? } from parseStateFromText
//                   + stateForCanonical. When set, we display "… as
//                   sliced" below the canonical.
//   packageSize   — optional { amount, unit } from parsePackageSize.
//                   Displayed as "· 40g" pill.
//   onUse         — () => void, fires when user taps USE. Caller is
//                   responsible for setting canonical_id + state +
//                   package size on the row.
//   onDifferent   — () => void, fires when user taps DIFFERENT.
//                   Caller opens LinkIngredient or similar picker.
//
// Visually: sits above whatever form it's injected into, purple-tinted
// to signal AI-inferred (matches the AIRecipe accent color), with a
// confidence chip inline.

export default function CanonicalSuggestionCard({
  match,
  inferredState,
  packageSize,
  onUse,
  onDifferent,
}) {
  if (!match || !match.canonical) return null;
  const c = match.canonical;
  const name = c.name || c.shortName || c.id;
  const emoji = c.emoji || "🔍";
  const confidenceLabel =
    match.confidence === "exact"  ? "EXACT MATCH" :
    match.confidence === "high"   ? "HIGH CONFIDENCE" :
    match.confidence === "medium" ? "MEDIUM"         :
    "SUGGESTION";
  const confidenceColor =
    match.confidence === "exact"  ? "#7ec87e" :
    match.confidence === "high"   ? "#c7a8d4" :
    match.confidence === "medium" ? "#b8a878" :
    "#888";

  // Compose the "matched on" breadcrumb so the user can see WHY we
  // picked it. "sushi-nori tag" is more trustworthy than a cleaned-
  // name match, and surfacing the signal helps the user catch when
  // we guessed badly.
  const sourceBreadcrumb =
    match.reason === "learned"      ? `learned · ${match.matchedOn || ""}` :
    match.reason?.startsWith("tag:") ? `tag · ${match.matchedOn || ""}`   :
    match.reason === "name-cleaned" ? `name · ${match.matchedOn || ""}`   :
    match.matchedOn || "";

  return (
    <div style={{
      marginBottom: 14, padding: "14px 14px 12px",
      background: "linear-gradient(135deg, #1e1a24 0%, #18141c 100%)",
      border: "1px solid #2e2538",
      borderRadius: 12,
    }}>
      {/* Top row — emoji, name, confidence chip */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 30, flexShrink: 0 }}>{emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            color: "#c7a8d4", letterSpacing: "0.12em",
            marginBottom: 2,
          }}>
            ✨ LOOKS LIKE
          </div>
          <div style={{
            fontFamily: "'Fraunces',serif", fontSize: 18, fontStyle: "italic",
            color: "#f0ece4", fontWeight: 400, lineHeight: 1.2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {name}
          </div>
        </div>
        <span style={{
          fontFamily: "'DM Mono',monospace", fontSize: 8, fontWeight: 700,
          color: confidenceColor,
          background: `${confidenceColor}15`,
          border: `1px solid ${confidenceColor}55`,
          padding: "3px 7px", borderRadius: 6,
          letterSpacing: "0.1em", flexShrink: 0,
        }}>
          {confidenceLabel}
        </span>
      </div>

      {/* Metadata row — matched-on breadcrumb + optional state/size pills */}
      {(sourceBreadcrumb || inferredState?.state || packageSize) && (
        <div style={{
          marginTop: 8, display: "flex", alignItems: "center",
          gap: 6, flexWrap: "wrap",
        }}>
          {sourceBreadcrumb && (
            <span style={{
              fontFamily: "'DM Mono',monospace", fontSize: 9,
              color: "#777", letterSpacing: "0.08em",
              overflow: "hidden", textOverflow: "ellipsis",
              maxWidth: "60%",
            }}>
              {sourceBreadcrumb.toUpperCase()}
            </span>
          )}
          {inferredState?.state && (
            <span style={{
              fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
              color: "#c7a8d4", background: "#1e1a28",
              border: "1px solid #2e2538",
              padding: "2px 7px", borderRadius: 6,
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              {inferredState.state}
            </span>
          )}
          {packageSize && (
            <span style={{
              fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
              color: "#b8a878", background: "#1a1608",
              border: "1px solid #3a2f10",
              padding: "2px 7px", borderRadius: 6,
              letterSpacing: "0.1em",
            }}>
              {packageSize.amount} {packageSize.unit}
            </span>
          )}
        </div>
      )}

      {/* Action buttons — USE (primary) / DIFFERENT (outline). */}
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onUse}
          style={{
            flex: 2, padding: "10px",
            background: "linear-gradient(135deg, #c7a8d4 0%, #a389b8 100%)",
            color: "#111", border: "none", borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700,
            letterSpacing: "0.1em", cursor: "pointer",
          }}
        >
          ✓ USE {(name || "").toUpperCase()}
        </button>
        <button
          type="button"
          onClick={onDifferent}
          style={{
            flex: 1, padding: "10px",
            background: "transparent", border: "1px solid #3a3a3a",
            color: "#aaa", borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 10,
            letterSpacing: "0.08em", cursor: "pointer",
          }}
        >
          DIFFERENT
        </button>
      </div>
    </div>
  );
}
