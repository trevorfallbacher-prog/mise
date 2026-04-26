// NameTypeaheadList — the canonical-suggestion dropdown that hangs
// off the Name input in AddDraftSheet. Position-fixed to the
// viewport (the parent recomputes typeaheadAnchor on visualViewport
// scroll/resize) so the iOS keyboard can't drag the list off the
// user's finger.
//
// Extracted from AddDraftSheet.jsx (which had grown past the
// 1500-line tripwire). The parent owns name state, suggestions, and
// every override flag the typeahead releases on pick — this
// component just renders the list and forwards picks back through
// callbacks. No local state.

import { font, axis } from "./tokens";
import { withAlpha } from "./primitives";
import { THEME_TRANSITION } from "./theme";
import { enrichIngredient } from "../../lib/enrichIngredient";

export function NameTypeaheadList({
  theme,
  // gating
  nameFocused,
  suppressTypeahead,
  typeaheadAnchor,
  // data
  nameSuggestions,
  name,
  canonicalId,
  // pick handlers — parent releases its override locks
  setName,
  setCanonicalId,
  setCanonicalOverridden,
  setTypeOverridden,
  setTileOverridden,
  setStateOverridden,
  setLocationOverridden,
  setSuppressTypeahead,
  // for the "+ Add canonical" no-results path
  refreshPending,
}) {
  const visible =
    nameFocused
    && !suppressTypeahead
    && typeaheadAnchor
    && (nameSuggestions.length > 0 || name.trim().length >= 2);
  if (!visible) return null;

  const releaseOverrides = () => {
    setTypeOverridden(false);
    setTileOverridden(false);
    setStateOverridden(false);
    setLocationOverridden(false);
  };

  return (
    <div
      role="listbox"
      aria-label="Canonical suggestions"
      style={{
        // Fixed-to-viewport anchoring (vs. absolute under the
        // input) so iOS keyboard-open and any layout shift
        // below the input doesn't drag the dropdown off the
        // user's finger. Position is recomputed on every
        // visualViewport scroll/resize via the parent's effect.
        position: "fixed",
        top: typeaheadAnchor.top,
        left: typeaheadAnchor.left,
        width: typeaheadAnchor.width,
        zIndex: 1000,
        padding: 6,
        borderRadius: 14,
        background: theme.color.glassFillHeavy,
        border: `1px solid ${theme.color.glassBorder}`,
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        boxShadow: "0 18px 36px rgba(20,12,4,0.28), 0 4px 12px rgba(20,12,4,0.16)",
        ...THEME_TRANSITION,
      }}
    >
      {nameSuggestions.map(ing => (
        <button
          key={ing.id}
          type="button"
          role="option"
          aria-selected={ing.id === canonicalId}
          className="mcm-focusable"
          // onMouseDown fires before onBlur on the input,
          // so the pick lands without a click being lost.
          onMouseDown={(e) => {
            e.preventDefault();
            setName(ing.name);
            setCanonicalId(ing.id);
            setCanonicalOverridden(true);
            // Unlock the downstream axes so the
            // category + tile re-derive against the
            // freshly-picked canonical's metadata. The
            // user picking a canonical means they
            // trust our cascade — any prior manual
            // category / tile override should release
            // so the new canonical drives those values.
            releaseOverrides();
            setSuppressTypeahead(true);
          }}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            width: "100%",
            padding: "8px 10px",
            margin: "1px 0",
            borderRadius: 10,
            border: "1px solid transparent",
            background: ing.id === canonicalId
              ? `linear-gradient(${withAlpha(axis.canonical, 0.18)}, ${withAlpha(axis.canonical, 0.18)}), transparent`
              : "transparent",
            cursor: "pointer", textAlign: "left",
            color: theme.color.ink,
            transition: "background 140ms ease",
          }}
          onMouseEnter={(e) => { if (ing.id !== canonicalId) e.currentTarget.style.background = withAlpha(theme.color.ink, 0.05); }}
          onMouseLeave={(e) => { if (ing.id !== canonicalId) e.currentTarget.style.background = "transparent"; }}
        >
          {ing.emoji && <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{ing.emoji}</span>}
          <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 500 }}>
              {ing.name}
            </span>
            {ing.category && (
              <span style={{
                fontFamily: font.detail, fontStyle: "italic", fontWeight: 400,
                fontSize: 12, color: theme.color.inkMuted, marginTop: 1,
              }}>
                {ing.category}
              </span>
            )}
          </span>
          {ing.id === canonicalId && (
            <span style={{ color: axis.canonical, fontSize: 14 }}>✓</span>
          )}
        </button>
      ))}
      {/* No-results escape hatch — when the typed name
          doesn't match any bundled canonical, surface a
          "+ Add canonical" row that creates a new
          user-scoped canonical from the typed text.
          Slug-cases the input so the underlying
          pantry_items.canonical_id stays URL-safe; the
          CLAUDE.md self-teaching cascade picks it up
          the same as a bundled slug. */}
      {nameSuggestions.length === 0 && name.trim().length >= 2 && (
        <button
          type="button"
          role="option"
          className="mcm-focusable"
          onMouseDown={(e) => {
            e.preventDefault();
            const sourceName = name.trim();
            const slug = sourceName.toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "");
            if (!slug) return;
            setCanonicalId(slug);
            setCanonicalOverridden(true);
            releaseOverrides();
            setSuppressTypeahead(true);
            // Parity with the AI photo flow: register the
            // freshly-minted slug in pending_ingredient_info
            // so it stops being a "shell" — refreshPending
            // pulls it into the local map, useIngredientInfo's
            // dbMap+pendingMap merge re-registers the alias
            // map, and the typeahead / inferCanonicalFromName
            // can find this slug from any other surface in
            // the app (other Add forms, Item edits, recipe
            // pairing). Fire-and-forget — failure here just
            // means the slug doesn't enrich, the row still
            // commits with canonicalId set.
            enrichIngredient({ source_name: sourceName })
              .then(() => refreshPending?.())
              .catch(err =>
                console.warn("[mcm-add] typeahead canonical enrich failed:", err?.message || err),
              );
          }}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            width: "100%",
            padding: "10px 10px",
            margin: "1px 0",
            borderRadius: 10,
            border: `1px dashed ${withAlpha(axis.canonical, 0.45)}`,
            background: "transparent",
            cursor: "pointer", textAlign: "left",
            color: theme.color.ink,
            transition: "background 140ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = withAlpha(axis.canonical, 0.10); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{
            fontSize: 18, lineHeight: 1, flexShrink: 0,
            color: axis.canonical,
          }}>+</span>
          <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 500 }}>
              Add "{name.trim()}" as a new canonical
            </span>
            <span style={{
              fontFamily: font.detail, fontStyle: "italic", fontWeight: 400,
              fontSize: 12, color: theme.color.inkMuted, marginTop: 1,
            }}>
              Saved to your kitchen — admin can promote later.
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
