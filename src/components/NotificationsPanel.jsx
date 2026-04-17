import { useEffect, useMemo, useRef } from "react";

// Buckets the inbox into Today / Yesterday / Earlier so a long-lived list
// stays scannable. All times are local to the viewer.
function bucketLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return "Earlier";
}

// "5m ago", "3h ago", "2d ago"
function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function kindBg(kind, unread) {
  const base = (() => {
    if (kind === "success") return "#15201a";
    if (kind === "warn")    return "#201a10";
    if (kind === "error")   return "#2a1515";
    return "#161616";
  })();
  // Slightly brighter for unread so the user can scan at a glance.
  return unread ? base : "#101010";
}
function kindBorder(kind, unread) {
  const base = (() => {
    if (kind === "success") return "#2a3a2e";
    if (kind === "warn")    return "#3a2e1e";
    if (kind === "error")   return "#3a1e1e";
    return "#1e1e1e";
  })();
  return unread ? base : "#1a1a1a";
}

/**
 * Slide-down inbox panel. Fixed at the top of the same 480px shell as the
 * rest of the app. Tap × or the backdrop to close.
 *
 * Read state policy (from spec): unread rows are shown + count toward the
 * badge; read rows stay visible (greyed out) but don't count; dismiss/clear
 * hard-deletes. Auto-expire at 30 days happens server-side (cron, future).
 *
 * Opening the panel auto-marks everything read so the badge clears as soon
 * as the user has acknowledged the existence of the notifications. They can
 * still scroll back through them.
 */
export default function NotificationsPanel({
  notifications,
  loading,
  unreadCount,
  markAllRead,
  dismiss,
  clearAll,
  onClose,
  // onOpen(targetKind, targetId) — called when the user taps a row that
  // carries a deep-link target. App.jsx routes the tap to the right tab
  // (currently only 'cook_log' → Cookbook). If omitted, rows are plain.
  onOpen,
  // Synthetic pinned entries injected at the top of the list. Used for
  // app-level context that isn't a real notifications-table row — the
  // release-notes pin is the canonical example. Each entry carries its
  // own onTap + onDismiss so the parent owns its lifecycle (we don't
  // dismiss a synthetic via the notifications table).
  //   { id, emoji, msg, sublabel, kind, onTap, onDismiss }
  pinned = [],
  // Always-available footer affordance to open the full release notes
  // modal. Wired even when no pin is showing — lets users come back to
  // past notes while perusing the inbox.
  onOpenReleaseNotes,
}) {
  // Auto-mark-read on open. We deliberately fire this only on mount —
  // markAllRead's identity changes every render, but we don't want to
  // re-stamp every time the inbox list mutates.
  const markAllReadRef = useRef(markAllRead);
  useEffect(() => { markAllReadRef.current = markAllRead; }, [markAllRead]);
  const hadUnreadOnOpen = useRef(unreadCount > 0);
  useEffect(() => {
    if (hadUnreadOnOpen.current) markAllReadRef.current?.();
  }, []);

  const grouped = useMemo(() => {
    const out = [];
    let lastBucket = null;
    for (const n of notifications) {
      const b = bucketLabel(n.created_at);
      if (b !== lastBucket) {
        out.push({ kind: "header", label: b });
        lastBucket = b;
      }
      out.push({ kind: "row", row: n });
    }
    return out;
  }, [notifications]);

  return (
    <>
      {/* backdrop */}
      <button
        onClick={onClose}
        aria-label="Close notifications"
        style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.5)", border: "none", padding: 0, cursor: "pointer",
        }}
      />

      <div
        style={{
          position: "fixed",
          top: 0, left: 0, right: 0,
          maxWidth: 480, margin: "0 auto",
          maxHeight: "85vh",
          background: "#0f0f0f",
          borderBottomLeftRadius: 16,
          borderBottomRightRadius: 16,
          border: "1px solid #1e1e1e",
          borderTop: "none",
          zIndex: 110,
          display: "flex", flexDirection: "column",
          boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
          animation: "panelIn 0.22s ease",
        }}
      >
        <style>{`@keyframes panelIn { from { transform: translateY(-12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>

        {/* header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 18px 12px",
        }}>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, color: "#f0ece4" }}>
            Notifications
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none", color: "#888",
              fontSize: 22, lineHeight: 1, cursor: "pointer", padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* action row */}
        {notifications.length > 0 && (
          <div style={{
            display: "flex", gap: 8, padding: "0 18px 10px",
            borderBottom: "1px solid #1a1a1a",
            paddingBottom: 12,
          }}>
            <button
              onClick={clearAll}
              style={{
                background: "transparent", border: "1px solid #2a2a2a",
                color: "#888", borderRadius: 8, padding: "6px 10px",
                fontFamily: "'DM Mono',monospace", fontSize: 10,
                letterSpacing: "0.08em", cursor: "pointer",
              }}
            >
              CLEAR ALL
            </button>
          </div>
        )}

        {/* list */}
        <div style={{ overflowY: "auto", padding: "8px 12px 16px", flex: 1 }}>
          {loading && (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "#666",
                          fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
              Loading…
            </div>
          )}
          {!loading && notifications.length === 0 && pinned.length === 0 && (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "#666",
                          fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
              <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.5 }}>🔔</div>
              No notifications yet. When family members add to the pantry,
              update the shopping list, or schedule meals, you'll see it here.
            </div>
          )}

          {/* Pinned synthetic entries — release notes, future system
              messages. Always render at the top of the list, before
              the time-bucketed real notifications. The parent decides
              when to populate this (today: only when there's an
              unseen release). */}
          {pinned.map(p => (
            <div
              key={p.id}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "11px 12px",
                marginBottom: 6,
                background: "#0f1620",
                border: "1px solid #1f3040",
                borderRadius: 10,
              }}
            >
              <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.2 }}>
                {p.emoji || "📋"}
              </span>
              <button
                onClick={p.onTap}
                style={{
                  flex: 1, minWidth: 0,
                  background: "transparent", border: "none", padding: 0,
                  textAlign: "left", cursor: "pointer", color: "inherit",
                  display: "flex", alignItems: "flex-start", gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                    color: "#f0ece4", lineHeight: 1.35,
                  }}>
                    {p.msg}
                  </div>
                  {p.sublabel && (
                    <div style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 9,
                      color: "#7eb8d4", letterSpacing: "0.08em", marginTop: 4,
                    }}>
                      {p.sublabel}
                    </div>
                  )}
                </div>
                <span
                  aria-hidden
                  style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 14,
                    color: "#7eb8d4", letterSpacing: "0.04em",
                    flexShrink: 0, alignSelf: "center",
                  }}
                >
                  →
                </span>
              </button>
              {p.onDismiss && (
                <button
                  onClick={p.onDismiss}
                  aria-label="Dismiss"
                  style={{
                    background: "transparent", border: "none", color: "#555",
                    fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 4,
                    flexShrink: 0,
                  }}
                  title="Dismiss"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {grouped.map((entry, i) => {
            if (entry.kind === "header") {
              return (
                <div key={`h-${entry.label}-${i}`} style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  color: "#666", letterSpacing: "0.12em",
                  padding: "12px 6px 6px",
                }}>
                  {entry.label.toUpperCase()}
                </div>
              );
            }
            const n = entry.row;
            const unread = !n.read_at;
            // A notification becomes a link when it carries both a target
            // kind and a target id AND the parent gave us an onOpen handler
            // for that kind. Otherwise it's a plain info row.
            const linkable = !!(onOpen && n.target_kind && n.target_id);
            const openTarget = () => {
              if (!linkable) return;
              onOpen(n.target_kind, n.target_id);
              // App.jsx closes the panel after routing; we don't close
              // preemptively here so the navigation has time to happen.
            };
            return (
              <div
                key={n.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "11px 12px",
                  marginBottom: 6,
                  background: kindBg(n.kind, unread),
                  border: `1px solid ${kindBorder(n.kind, unread)}`,
                  borderRadius: 10,
                  opacity: unread ? 1 : 0.7,
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.2 }}>
                  {n.emoji || "🔔"}
                </span>
                {/* Body is a button when linkable so the whole message + chevron
                    are one target; stays a div when not linkable so there's no
                    pointer hint where nothing happens. */}
                {linkable ? (
                  <button
                    onClick={openTarget}
                    style={{
                      flex: 1, minWidth: 0,
                      background: "transparent", border: "none", padding: 0,
                      textAlign: "left", cursor: "pointer", color: "inherit",
                      display: "flex", alignItems: "flex-start", gap: 10,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                        color: "#f0ece4", lineHeight: 1.35,
                      }}>
                        {n.msg}
                      </div>
                      <div style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 9,
                        color: "#666", letterSpacing: "0.08em", marginTop: 4,
                      }}>
                        {timeAgo(n.created_at).toUpperCase()}
                      </div>
                    </div>
                    <span
                      aria-hidden
                      style={{
                        fontFamily: "'DM Mono',monospace", fontSize: 14,
                        color: "#f5c842", letterSpacing: "0.04em",
                        flexShrink: 0, alignSelf: "center",
                      }}
                    >
                      →
                    </span>
                  </button>
                ) : (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                      color: "#f0ece4", lineHeight: 1.35,
                    }}>
                      {n.msg}
                    </div>
                    <div style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 9,
                      color: "#666", letterSpacing: "0.08em", marginTop: 4,
                    }}>
                      {timeAgo(n.created_at).toUpperCase()}
                    </div>
                  </div>
                )}
                <button
                  onClick={() => dismiss(n.id)}
                  aria-label="Dismiss"
                  style={{
                    background: "transparent", border: "none", color: "#555",
                    fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 4,
                    flexShrink: 0,
                  }}
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer link to the full release-notes modal. Always visible
            (even without a pinned entry) so users can browse back
            through past notes while perusing the inbox. */}
        {onOpenReleaseNotes && (
          <div style={{
            borderTop: "1px solid #1a1a1a",
            padding: "10px 18px 14px",
          }}>
            <button
              onClick={onOpenReleaseNotes}
              style={{
                width: "100%",
                background: "transparent", border: "1px solid #1f3040",
                color: "#7eb8d4", borderRadius: 10,
                padding: "10px 12px",
                fontFamily: "'DM Mono',monospace", fontSize: 10,
                letterSpacing: "0.1em", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}
            >
              <span>📋 RELEASE NOTES · WHAT'S CHANGED</span>
              <span>→</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
