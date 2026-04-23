// MealPrepTimeline — renders the queued prep_notifications rows for a
// single scheduled meal as a horizontal strip of timestamp chips.
// Purpose: give the user a visible preview of what the system will
// ping them about, when, so they trust it before the first ping fires.
//
// Shown inline inside MealDetailDrawer in Plan.jsx. Each chip is:
//   • emoji from the prep step (freezer 🧊 for overnight, ⏰ otherwise)
//   • short "when" label derived from deliver_at
//   • body text of the reminder on a second line
//   • a right-side state pill: PENDING / DELIVERED / OFF
//   • tap → toggle dismissed (opt-out of this particular reminder for
//     this particular meal)

function fmtWhen(deliverIso, scheduledIso) {
  const d = new Date(deliverIso);
  const scheduled = new Date(scheduledIso);
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  const isPast = ms < 0;

  // Relative to the meal: "T-30m", "T-12h", "T-1d". Anchored to
  // scheduled_for so the label reads in cooking-time terms rather
  // than calendar-clock terms.
  const leadMs = scheduled.getTime() - d.getTime();
  const leadMin = Math.round(leadMs / 60_000);
  let leadLabel;
  if (leadMin < 60) {
    leadLabel = `T-${leadMin}m`;
  } else if (leadMin < 24 * 60) {
    leadLabel = `T-${Math.round(leadMin / 60)}h`;
  } else {
    leadLabel = `T-${Math.round(leadMin / (24 * 60))}d`;
  }

  // Absolute clock label for the chip's wall-time, formatted short:
  // today → "9:30 PM", tomorrow → "Tue 9:30 PM", further → "Apr 23 9:30 PM".
  const sameDay = d.toDateString() === now.toDateString();
  const dayLabel = sameDay
    ? ""
    : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const timeLabel = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const absLabel = dayLabel ? `${dayLabel} · ${timeLabel}` : timeLabel;

  return { leadLabel, absLabel, isPast };
}

function stateTone(row) {
  if (row.dismissed_at) return { label: "OFF",       fg: "#666", bg: "#141414", border: "#2a2a2a" };
  if (row.delivered_at) return { label: "DELIVERED", fg: "#7ec87e", bg: "#0f1a0f", border: "#1e3a1e" };
  return                       { label: "PENDING",   fg: "#f5c842", bg: "#1e1a0e", border: "#3a3010" };
}

export default function MealPrepTimeline({ meal, rows, onDismiss, onUndismiss }) {
  if (!meal || !rows?.length) return null;

  // Show deliveries in chronological order — earliest future ping
  // first. Past delivered rows hang on the left (dimmed) so users
  // remember what already fired.
  const sorted = [...rows].sort((a, b) => a.deliver_at.localeCompare(b.deliver_at));

  return (
    <div style={{
      marginTop: 14, padding: "12px 12px 10px",
      background: "#0f0f0f", border: "1px solid #1e1e1e",
      borderRadius: 12,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        marginBottom: 10,
      }}>
        <span style={{ fontSize: 14 }}>🔔</span>
        <span style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: "#f5c842", letterSpacing: "0.12em", fontWeight: 700,
        }}>
          WHAT'S COMING
        </span>
        <span style={{
          fontFamily: "'DM Sans',sans-serif", fontSize: 11,
          color: "#666", marginLeft: "auto",
        }}>
          {sorted.filter(r => !r.delivered_at && !r.dismissed_at).length} pending ·
          {" "}{sorted.filter(r => r.delivered_at).length} sent
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sorted.map(row => {
          const when = fmtWhen(row.deliver_at, meal.scheduled_for);
          const tone = stateTone(row);
          const dim  = !!row.dismissed_at || !!row.delivered_at;
          const toggle = () => {
            if (row.delivered_at) return; // can't un-send
            if (row.dismissed_at) onUndismiss?.(row.id);
            else                  onDismiss?.(row.id);
          };
          return (
            <button
              key={row.id}
              onClick={toggle}
              disabled={!!row.delivered_at}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px",
                background: dim ? "#0c0c0c" : "#141414",
                border: `1px solid ${tone.border}`,
                borderRadius: 10,
                cursor: row.delivered_at ? "default" : "pointer",
                textAlign: "left",
                width: "100%",
                opacity: dim ? 0.7 : 1,
              }}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{row.emoji || "⏰"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex", alignItems: "baseline", gap: 8,
                  marginBottom: 2,
                }}>
                  <span style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#f5c842", letterSpacing: "0.1em", fontWeight: 700,
                  }}>
                    {when.leadLabel}
                  </span>
                  <span style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#888",
                  }}>
                    {when.absLabel}
                  </span>
                </div>
                <div style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                  color: "#f0ece4", lineHeight: 1.35,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {row.title}
                </div>
                {row.body && (
                  <div style={{
                    fontFamily: "'DM Sans',sans-serif", fontSize: 11,
                    color: "#888", marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis",
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  }}>
                    {row.body}
                  </div>
                )}
              </div>
              <span style={{
                flexShrink: 0,
                fontFamily: "'DM Mono',monospace", fontSize: 9,
                color: tone.fg, background: tone.bg,
                border: `1px solid ${tone.border}`,
                borderRadius: 4, padding: "2px 6px",
                letterSpacing: "0.08em", fontWeight: 700,
              }}>
                {tone.label}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{
        fontFamily: "'DM Sans',sans-serif", fontSize: 11,
        color: "#555", marginTop: 8, lineHeight: 1.4,
      }}>
        Tap a pending reminder to turn it off for this meal. Delivered
        ones stay visible as a history trail.
      </div>
    </div>
  );
}
