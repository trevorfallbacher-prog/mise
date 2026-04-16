import ModalSheet from "./ModalSheet";
import { COLOR, FONT, RADIUS, Z } from "../lib/tokens";
import { LATEST_RELEASE } from "../data/releaseNotes";

/**
 * WhatsNewNotification — slim post-update notification.
 *
 * Shown by useWhatsNew when CURRENT_VERSION differs from the user's
 * locally-stored last-seen version. Designed to be a quick read, not
 * a wall of text — version + headline + 1-paragraph summary + two
 * actions ("SEE WHAT'S NEW" / "DISMISS"). For the full breakdown
 * the user opens ReleaseNotesModal via the SEE button.
 *
 * Built on ModalSheet so it inherits swipe-down + Escape + click-
 * backdrop. Layered above cards (Z.confirm) so a ItemCard drilled
 * open before the notification fired doesn't bury it.
 *
 * Props:
 *   onSeeWhatsNew() — open the full ReleaseNotesModal
 *   onDismiss()     — close without opening full modal (still marks
 *                     the current version as seen so it doesn't
 *                     reappear next session)
 */
export default function WhatsNewNotification({ onSeeWhatsNew, onDismiss }) {
  if (!LATEST_RELEASE) return null;
  return (
    <ModalSheet
      onClose={onDismiss}
      zIndex={Z.confirm}
      label={`WHAT'S NEW · v${LATEST_RELEASE.version}`}
      showHandle={true}
    >
      <h2 style={{
        fontFamily: FONT.serif, fontSize: 22, fontStyle: "italic",
        color: COLOR.ink, fontWeight: 400,
        margin: "2px 0 10px", lineHeight: 1.25,
      }}>
        {LATEST_RELEASE.title}
      </h2>
      <p style={{
        fontFamily: FONT.sans, fontSize: 13, color: COLOR.dim,
        lineHeight: 1.6, margin: "0 0 18px",
      }}>
        {LATEST_RELEASE.summary}
      </p>

      {/* Compact bullet preview — first 3 shipped items, just the
          text, color-keyed by kind. Gives the user a flavor of
          what's inside before the modal-jump commitment. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
        {(LATEST_RELEASE.shipped || []).slice(0, 3).map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              fontFamily: FONT.sans, fontSize: 12,
              color: COLOR.ink, lineHeight: 1.45,
            }}
          >
            <span style={{ color: COLOR.gold, flexShrink: 0 }}>•</span>
            <span>{item.text}</span>
          </div>
        ))}
        {(LATEST_RELEASE.shipped || []).length > 3 && (
          <div style={{
            fontFamily: FONT.mono, fontSize: 10, color: COLOR.muted,
            letterSpacing: "0.08em", marginTop: 4, paddingLeft: 14,
          }}>
            + {LATEST_RELEASE.shipped.length - 3} more
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onDismiss}
          style={{
            flex: 1, padding: "13px",
            background: COLOR.ground, border: `1px solid ${COLOR.border}`,
            color: COLOR.dim, borderRadius: RADIUS.xl,
            fontFamily: FONT.mono, fontSize: 11,
            letterSpacing: "0.08em", cursor: "pointer", fontWeight: 600,
          }}
        >
          DISMISS
        </button>
        <button
          onClick={onSeeWhatsNew}
          style={{
            flex: 2, padding: "13px",
            background: COLOR.gold, border: "none",
            color: "#111", borderRadius: RADIUS.xl,
            fontFamily: FONT.mono, fontSize: 12, fontWeight: 600,
            letterSpacing: "0.1em", cursor: "pointer",
          }}
        >
          SEE WHAT'S NEW →
        </button>
      </div>
    </ModalSheet>
  );
}
