// Search summary — shown above the flat search-hits grid. Tells
// the user how many hits and which locations they span, so a
// query that returns matches across multiple tabs (e.g. butter
// in both fridge and freezer) surfaces that distribution without
// making them count rows by hand. Also exports the SearchGlyph
// SVG since it's only used inside the search bar's input.

import { useTheme, THEME_TRANSITION } from "./theme";
import { font } from "./tokens";

export function SearchSummary({ hits, query, onClear }) {
  const { theme } = useTheme();
  const total = hits.length;
  // Per-location counts — "butter" search finds 1 in fridge + 1
  // in freezer, this line says "Found 2 · 1 fridge · 1 freezer".
  const byLoc = { fridge: 0, pantry: 0, freezer: 0 };
  for (const h of hits) {
    if (byLoc[h._location] != null) byLoc[h._location] += 1;
  }
  const parts = ["fridge", "pantry", "freezer"]
    .filter(loc => byLoc[loc] > 0)
    .map(loc => `${byLoc[loc]} ${loc}`);

  return (
    <div style={{
      marginTop: 20,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      flexWrap: "wrap",
    }}>
      <div
        // aria-live="polite" announces the result count + location
        // distribution to screen readers without interrupting the
        // user's typing. Sighted users see the same readout but
        // passively; assistive-tech users get a meaningful update
        // instead of an opaque "something changed" moment.
        aria-live="polite"
        aria-atomic="true"
        style={{
        fontFamily: font.mono, fontSize: 11,
        letterSpacing: "0.06em",
        color: theme.color.skyInkMuted,
        textTransform: "uppercase",
      }}>
        {total === 0 ? (
          <>No matches for "{query}"</>
        ) : (
          <>
            Found {total}
            {parts.length > 0 && <span style={{ opacity: 0.6 }}> · {parts.join(" · ")}</span>}
          </>
        )}
      </div>
      <button
        onClick={onClear}
        style={{
          fontFamily: font.mono, fontSize: 10,
          letterSpacing: "0.08em", textTransform: "uppercase",
          padding: "4px 10px",
          borderRadius: 999,
          border: `1px solid ${theme.color.hairline}`,
          background: theme.color.glassFillLite,
          color: theme.color.inkMuted,
          cursor: "pointer",
          ...THEME_TRANSITION,
        }}
      >
        Clear search
      </button>
    </div>
  );
}

export function SearchGlyph() {
  const { theme } = useTheme();
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="7" fill="none" stroke={theme.color.inkMuted} strokeWidth="1.6" />
      <path d="M16.5 16.5 L21 21" stroke={theme.color.inkMuted} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
