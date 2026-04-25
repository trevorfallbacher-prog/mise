// Empty-state surfaces shown in the pantry when there's nothing
// to display. Two variants: the per-tile / no-search-match
// EmptyState, and the whole-location LocationEmptyState that
// replaces the dimmed-tile wall when an entire location is bare.

import { Starburst, FadeIn, withAlpha } from "./primitives";
import { useTheme } from "./theme";
import { font } from "./tokens";
import { LOCATION_DOT } from "./FloatingLocationDock";

// Whole-location empty state — shown when the active location
// (Fridge / Pantry / Freezer) has zero items in any tile. Skips
// the visual noise of a grayed-out tile wall and gives the user
// a clear "this whole shelf is bare" moment with the location's
// own swatch color tying the message to the dock segment they're
// on.
export function LocationEmptyState({ location }) {
  const { theme } = useTheme();
  const dotColor = LOCATION_DOT[location.id] || theme.color.inkMuted;
  const copy = {
    fridge:  "Your fridge is empty. Time for a grocery run.",
    pantry:  "The pantry shelves are bare.",
    freezer: "Nothing in the freezer yet.",
  }[location.id] || "Nothing on these shelves yet.";
  return (
    <FadeIn>
      <div style={{
        position: "relative",
        marginTop: 48,
        padding: "60px 20px",
        textAlign: "center",
        overflow: "hidden",
      }}>
        <Starburst
          size={220}
          color={withAlpha(dotColor, 0.18)}
          style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Big colored dot — same swatch color as the active
              dock segment, so the empty-state visually ties to
              "yes, this is the location you picked." */}
          <div style={{
            display: "inline-block",
            width: 16, height: 16,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: `0 0 0 6px ${withAlpha(dotColor, 0.18)}, 0 2px 4px rgba(30,20,8,0.20)`,
            marginBottom: 18,
          }} />
          <div style={{
            fontFamily: font.serif, fontStyle: "italic",
            fontSize: 22, lineHeight: 1.2,
            color: theme.color.ink,
            letterSpacing: "-0.01em",
          }}>
            {copy}
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

// Empty state — shown when a drilled tile has no items OR a
// search returns zero hits. Uses a small Starburst ornament
// behind the copy (same motif the WarmBackdrop uses, just
// smaller and centered) so the "nothing here" moment still
// feels like part of the design system rather than a bare
// error screen. Copy is warmer than plain "Nothing matches"
// — pantries are a personal space, and empty states are a
// good chance to sound human.
export function EmptyState({ kind, query, tile }) {
  const { theme } = useTheme();
  const title = kind === "no-matches"
    ? `Nothing called "${query}"`
    : tile
      ? `${tile.label} is bare`
      : "This tile is empty";
  const body = kind === "no-matches"
    ? "Try a different name, or tap a location tab to browse the shelves."
    : "Scan a grocery receipt or add items manually to stock this shelf.";
  return (
    <FadeIn>
      <div style={{
        position: "relative",
        marginTop: 48,
        padding: "48px 20px",
        textAlign: "center",
        overflow: "hidden",
      }}>
        <Starburst
          size={200}
          color={withAlpha(theme.color.warmBrown, 0.08)}
          style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{
            fontFamily: font.serif, fontStyle: "italic",
            fontSize: 22, lineHeight: 1.2,
            color: theme.color.ink,
            letterSpacing: "-0.01em",
          }}>
            {title}
          </div>
          <div style={{
            marginTop: 8,
            fontFamily: font.sans, fontSize: 13,
            color: theme.color.inkMuted,
            lineHeight: 1.5,
            maxWidth: 300,
            margin: "8px auto 0",
          }}>
            {body}
          </div>
        </div>
      </div>
    </FadeIn>
  );
}
