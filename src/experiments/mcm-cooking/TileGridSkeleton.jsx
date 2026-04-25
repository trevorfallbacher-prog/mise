// Skeleton tile grid — shown while the initial pantry query is
// in flight and nothing has loaded yet. Renders six ghost cards
// with shimmering placeholder blocks where the icon / label /
// count pill would go. Once a single real card lands the
// skeleton unmounts via the AnimatePresence body crossfade, so
// loading → real feels like a soft fade rather than a content
// flash. Shimmer is a CSS keyframe applied via the global style
// tag in KitchenScreen so each ghost block uses the same
// animation timeline (they all pulse together rather than
// stagger, which reads as "waiting" better than a wave of
// independent animations).

import { GlassPanel, withAlpha } from "./primitives";
import { useTheme } from "./theme";

const SKELETON_COUNT = 6;

export function TileGridSkeleton() {
  const { theme } = useTheme();
  const block = (w, h) => ({
    width: w, height: h,
    borderRadius: 6,
    background: withAlpha(theme.color.ink, 0.06),
    animation: "mcm-skeleton-pulse 1.6s ease-in-out infinite",
  });
  return (
    <div style={{
      display: "grid",
      // Matches TileGrid's auto-fit columns and gap so the
      // skeleton → real transition doesn't reflow widths.
      gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
      gap: 12,
      marginTop: 20,
    }}>
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <GlassPanel
          key={i}
          padding={14}
          style={{
            // Mirror the new horizontal TileCard layout so the
            // skeleton looks like the real thing is about to
            // land there — icon left, text column right.
            display: "flex", flexDirection: "row", alignItems: "center", gap: 14,
            minHeight: 96,
            opacity: 0.7,
          }}
        >
          <div style={{ ...block(56, 56), borderRadius: 10, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ ...block("60%", 16) }} />
              <div style={{ ...block(32, 12) }} />
            </div>
            <div style={block("80%", 11)} />
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}
