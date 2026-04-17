import { useMemo, useState } from "react";
import ModalSheet from "./ModalSheet";
import { COLOR, FONT, RADIUS, SPACE, Z } from "../lib/tokens";
import { RELEASE_NOTES } from "../data/releaseNotes";

// Visual tokens for each entry kind. The kind drives the chip color
// + emoji; the text comes from the release-notes data file. Keeps
// the badge styling uniform so a "feature" reads the same in every
// release.
const KIND_STYLES = {
  feature:      { label: "NEW",     color: COLOR.gold,     bg: COLOR.goldDeep,  border: COLOR.goldDim,  emoji: "✨" },
  fix:          { label: "FIX",     color: COLOR.leaf,     bg: COLOR.leafDeep,  border: COLOR.leafDim,  emoji: "🛠️" },
  safety:       { label: "SAFETY",  color: COLOR.amber,    bg: "#1a1208",       border: "#3a2a10",      emoji: "🛡️" },
  ux:           { label: "POLISH",  color: COLOR.sky,      bg: COLOR.skyDeep,   border: COLOR.skyBorder, emoji: "💎" },
  architecture: { label: "UNDER THE HOOD", color: COLOR.dim, bg: COLOR.deep,    border: COLOR.border,   emoji: "⚙️" },
};

/**
 * ReleaseNotesModal — the full patch-notes view.
 *
 * Lists every release in RELEASE_NOTES newest-first, each with its
 * shipped-items grouped by kind and an optional "coming soon" tease.
 *
 * Each release entry is collapsed-by-default after the first one so
 * users skim the latest at a glance without the whole history
 * dominating the viewport. Tap to expand any older release.
 *
 * Props:
 *   onClose() — dismiss
 *   focusVersion — optional version string to scroll to / expand
 *                  on open. The "what's new" notification passes
 *                  CURRENT_VERSION here so opening directly from
 *                  the notification lands the user on the relevant
 *                  release. When omitted, just the latest is open.
 */
export default function ReleaseNotesModal({ onClose, focusVersion }) {
  // Tracks which release versions are expanded. Default: just the
  // latest (or focusVersion if provided). Older entries sit collapsed
  // so the modal opens compact.
  const initialExpanded = useMemo(() => {
    const latest = RELEASE_NOTES[0]?.version;
    const focus = focusVersion || latest;
    return new Set(focus ? [focus] : []);
  }, [focusVersion]);
  const [expanded, setExpanded] = useState(initialExpanded);
  const toggle = (v) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(v) ? next.delete(v) : next.add(v);
    return next;
  });

  return (
    <ModalSheet onClose={onClose} zIndex={Z.confirm} label="WHAT'S NEW">
      <h2 style={{
        fontFamily: FONT.serif, fontSize: 26, fontStyle: "italic",
        color: COLOR.ink, fontWeight: 400, margin: "2px 0 6px",
      }}>
        Release Notes
      </h2>
      <p style={{
        fontFamily: FONT.sans, fontSize: 13, color: COLOR.dim,
        lineHeight: 1.5, margin: "0 0 18px",
      }}>
        Every change worth knowing about. Newer up top.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {RELEASE_NOTES.map(entry => {
          const isOpen = expanded.has(entry.version);
          return (
            <div
              key={entry.version}
              style={{
                background: COLOR.deep,
                border: `1px solid ${COLOR.edge}`,
                borderRadius: RADIUS.xl,
                overflow: "hidden",
              }}
            >
              {/* Header — always visible. Tap to expand/collapse. */}
              <button
                onClick={() => toggle(entry.version)}
                style={{
                  width: "100%", textAlign: "left",
                  padding: "14px 16px",
                  background: "transparent", border: "none",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT.mono, fontSize: 9,
                    color: COLOR.gold, letterSpacing: "0.12em",
                    marginBottom: 4,
                  }}>
                    v{entry.version} · {formatDate(entry.date)}
                  </div>
                  <div style={{
                    fontFamily: FONT.serif, fontSize: 17, fontStyle: "italic",
                    color: COLOR.ink, lineHeight: 1.3,
                  }}>
                    {entry.title}
                  </div>
                </div>
                <span style={{
                  fontFamily: FONT.mono, fontSize: 11, color: COLOR.dim,
                  flexShrink: 0,
                }}>
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: "0 16px 16px" }}>
                  {entry.summary && (
                    <p style={{
                      fontFamily: FONT.sans, fontSize: 13,
                      color: COLOR.ink, lineHeight: 1.55,
                      margin: "0 0 14px",
                    }}>
                      {entry.summary}
                    </p>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {entry.shipped.map((item, i) => {
                      const k = KIND_STYLES[item.kind] || KIND_STYLES.feature;
                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex", alignItems: "flex-start", gap: 10,
                            padding: "10px 12px",
                            background: k.bg,
                            border: `1px solid ${k.border}`,
                            borderRadius: RADIUS.lg,
                          }}
                        >
                          <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.4 }}>{k.emoji}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: FONT.mono, fontSize: 9,
                              color: k.color, letterSpacing: "0.1em",
                              marginBottom: 3,
                            }}>
                              {k.label}
                            </div>
                            <div style={{
                              fontFamily: FONT.sans, fontSize: 13,
                              color: COLOR.ink, lineHeight: 1.45,
                            }}>
                              {item.text}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {entry.coming_soon && entry.coming_soon.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{
                        fontFamily: FONT.mono, fontSize: 9,
                        color: COLOR.plum, letterSpacing: "0.12em",
                        marginBottom: 8,
                      }}>
                        🛣️ COMING SOON
                      </div>
                      <ul style={{
                        margin: 0, padding: "0 0 0 18px",
                        fontFamily: FONT.sans, fontSize: 12,
                        color: COLOR.muted, lineHeight: 1.6,
                      }}>
                        {entry.coming_soon.map((line, i) => (
                          <li key={i} style={{ marginBottom: 4 }}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 22 }}>
        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "13px",
            background: COLOR.gold, border: "none",
            color: "#111", borderRadius: RADIUS.xl,
            fontFamily: FONT.mono, fontSize: 12, fontWeight: 600,
            letterSpacing: "0.1em", cursor: "pointer",
          }}
        >
          GOT IT
        </button>
      </div>
    </ModalSheet>
  );
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}
