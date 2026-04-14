import { useMemo, useState } from "react";
import { totalTimeMin, difficultyLabel } from "../data/recipes";

// Format a JS Date as a local ISO-ish string for <input type="time"> ("HH:mm").
const hhmm = (d) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// Parse "HH:mm" into { hours, minutes }.
const parseHHMM = (s) => {
  const [h, m] = (s || "19:00").split(":").map(Number);
  return { hours: h || 0, minutes: m || 0 };
};

// Build the next N days starting at `start` (midnight local).
function buildDayStrip(start, count = 14) {
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }
  return days;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * SchedulePicker modal.
 *
 * Props:
 *   recipe       — the recipe to schedule
 *   initialDate  — optional Date the picker should default to
 *   onClose()    — user dismissed
 *   onSave({ scheduledFor, notificationSettings, note })
 */
export default function SchedulePicker({ recipe, initialDate, onClose, onSave }) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const days = useMemo(() => buildDayStrip(today, 14), [today]);

  const [selectedDay, setSelectedDay] = useState(() => {
    if (initialDate) {
      const d = new Date(initialDate);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    return today;
  });
  const [timeStr, setTimeStr] = useState("19:00");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Per-notification opt-in state, keyed by notification.id.
  const [notifOpts, setNotifOpts] = useState(() => {
    const map = {};
    for (const n of recipe.prepNotifications || []) {
      map[n.id] = n.defaultOn !== false;
    }
    return map;
  });

  const toggleNotif = (id) =>
    setNotifOpts(prev => ({ ...prev, [id]: !prev[id] }));

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const { hours, minutes } = parseHHMM(timeStr);
      const dt = new Date(selectedDay);
      dt.setHours(hours, minutes, 0, 0);
      await onSave({
        scheduledFor: dt.toISOString(),
        notificationSettings: notifOpts,
        note: note.trim() || null,
      });
      onClose();
    } catch (e) {
      setError(e.message || "Couldn't save. Try again.");
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 300,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "20px 22px 40px",
        maxHeight: "92vh", overflowY: "auto",
      }}>
        <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 20px" }} />

        {/* Recipe header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 32 }}>{recipe.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>SCHEDULE</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {recipe.title}
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666" }}>
              {totalTimeMin(recipe)} min · {difficultyLabel(recipe.difficulty)}
            </div>
          </div>
        </div>

        {/* Day strip */}
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 10 }}>WHEN</div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
          {days.map(d => {
            const isSelected = d.getTime() === selectedDay.getTime();
            const isToday = d.getTime() === today.getTime();
            return (
              <button
                key={d.toISOString()}
                onClick={() => setSelectedDay(d)}
                style={{
                  flexShrink: 0, width: 54, padding: "10px 0",
                  background: isSelected ? "#f5c842" : "#1a1a1a",
                  color: isSelected ? "#111" : "#bbb",
                  border: `1px solid ${isSelected ? "#f5c842" : "#2a2a2a"}`,
                  borderRadius: 10, cursor: "pointer",
                  fontFamily: "'DM Sans',sans-serif", transition: "all 0.15s",
                }}
              >
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.1em", opacity: 0.8 }}>
                  {isToday ? "TODAY" : DAY_LABELS[d.getDay()].toUpperCase()}
                </div>
                <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 400, marginTop: 2 }}>
                  {d.getDate()}
                </div>
              </button>
            );
          })}
        </div>

        {/* Time */}
        <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>TIME</div>
            <input
              type="time"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              style={{
                width: "100%", padding: "12px 14px",
                background: "#1a1a1a", border: "1px solid #2a2a2a",
                borderRadius: 10, color: "#f0ece4",
                fontFamily: "'DM Mono',monospace", fontSize: 14,
                outline: "none", colorScheme: "dark",
              }}
            />
          </div>
        </div>

        {/* Prep notifications */}
        {(recipe.prepNotifications || []).length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 10 }}>
              PREP REMINDERS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recipe.prepNotifications.map(n => {
                const on = notifOpts[n.id];
                return (
                  <button
                    key={n.id}
                    onClick={() => toggleNotif(n.id)}
                    style={{
                      textAlign: "left", display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 14px",
                      background: on ? "#1e1a0e" : "#111",
                      border: `1px solid ${on ? "#f5c84244" : "#1e1e1e"}`,
                      borderRadius: 12, cursor: "pointer", transition: "all 0.2s",
                    }}
                  >
                    <div style={{
                      width: 34, height: 20, borderRadius: 10, flexShrink: 0,
                      background: on ? "#f5c842" : "#2a2a2a",
                      position: "relative", transition: "background 0.2s",
                    }}>
                      <div style={{
                        position: "absolute", top: 2, left: on ? 16 : 2,
                        width: 16, height: 16, borderRadius: "50%",
                        background: on ? "#111" : "#888",
                        transition: "left 0.2s",
                      }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: on ? "#f0ece4" : "#888", lineHeight: 1.4 }}>
                        {n.text}
                      </div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", marginTop: 2 }}>
                        {n.leadTime} before
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{
              marginTop: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 11,
              color: "#555", lineHeight: 1.5, fontStyle: "italic",
            }}>
              Notifications are saved with this meal. Web push delivery comes in the next update — for now your choices are stored.
            </div>
          </div>
        )}

        {/* Optional note */}
        <div style={{ marginTop: 22 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>
            NOTE (OPTIONAL)
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For Sarah's birthday, try with 'nduja, etc."
            style={{
              width: "100%", padding: "12px 14px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              borderRadius: 10, color: "#f0ece4",
              fontFamily: "'DM Sans',sans-serif", fontSize: 13,
              outline: "none",
            }}
          />
        </div>

        {error && (
          <div style={{
            marginTop: 12, padding: "10px 12px",
            background: "#1a0f0f", border: "1px solid #3a1a1a",
            borderRadius: 10, fontFamily: "'DM Sans',sans-serif",
            fontSize: 13, color: "#f87171",
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, padding: "14px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              color: "#888", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12,
              cursor: "pointer", letterSpacing: "0.08em",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2, padding: "14px",
              background: "#f5c842", border: "none", color: "#111",
              borderRadius: 12, fontFamily: "'DM Mono',monospace", fontSize: 12,
              fontWeight: 600, letterSpacing: "0.08em",
              cursor: saving ? "progress" : "pointer",
              boxShadow: "0 0 30px #f5c84233",
            }}
          >
            {saving ? "SCHEDULING…" : "SCHEDULE IT →"}
          </button>
        </div>
      </div>
    </div>
  );
}
