import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// AdminPanel — elevated-permissions inspector, scoped to profiles
// where role = 'admin' (see migration 0042). Mounted from Settings
// and only rendered when the viewer's own profile.role === 'admin'.
//
// FIRST-CUT SCOPE:
//   * USERS   — every profile row across all families. Id, name,
//               role, created_at. Lets the admin spot broken
//               onboarding (profile rows missing name) or orphaned
//               accounts.
//   * RECEIPTS — every receipt across all families. Store, date,
//                total, item_count, uploader, image_path. Tap a row
//                → surfaces the raw DB shape in a details panel
//                (no destructive ops in this cut — bypass writes
//                are too dangerous without explicit design).
//
// The RLS policies added in 0042 ONLY grant SELECT bypass to admins
// — UPDATE / DELETE still go through the standard self + family
// policies, so no write here can leak past what the admin's own
// family already had access to.
//
// Props:
//   userId    — viewer id (informational, not used for filtering)
//   onClose() — dismiss
export default function AdminPanel({ userId, onClose }) {
  const [tab, setTab] = useState("users"); // "users" | "receipts"

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 345,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "18px 22px 36px",
        maxHeight: "94vh", overflowY: "auto",
        position: "relative",
      }}>
        <div style={{ width: 44, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 14px" }} />

        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: 12, right: 14,
            width: 32, height: 32,
            background: "#0a0a0a", border: "1px solid #2a2a2a",
            color: "#aaa", borderRadius: 16,
            fontFamily: "'DM Mono',monospace", fontSize: 14,
            cursor: "pointer", zIndex: 1,
          }}
        >
          ✕
        </button>

        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#ef4444", letterSpacing: "0.12em", marginBottom: 6 }}>
          🛠 ADMIN TOOLS
        </div>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic", color: "#f0ece4", fontWeight: 400, margin: 0, lineHeight: 1.2, marginBottom: 14 }}>
          Elevated permissions
        </h2>

        <div style={{ display: "flex", gap: 0, margin: "0 0 14px", padding: 4, background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 12 }}>
          {[
            { id: "users",    label: "USERS" },
            { id: "receipts", label: "RECEIPTS" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: "8px",
                background: tab === t.id ? "#1e1e1e" : "transparent",
                border: "none", borderRadius: 8,
                fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 600,
                color: tab === t.id ? "#ef4444" : "#666",
                cursor: "pointer", letterSpacing: "0.1em",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "users"    && <UsersList viewerId={userId} />}
        {tab === "receipts" && <ReceiptsList viewerId={userId} />}
      </div>
    </div>
  );
}

// ── Users list ────────────────────────────────────────────────────
function UsersList({ viewerId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: err } = await supabase
        .from("profiles")
        .select("id, name, role, created_at, dietary, total_xp, last_cooked_date")
        .order("created_at", { ascending: false });
      if (!alive) return;
      if (err) { setError(err.message); setRows([]); return; }
      setRows(data || []);
    })();
    return () => { alive = false; };
  }, []);

  if (rows === null) return <Loading />;
  if (rows.length === 0) return <Empty msg={error ? `Load failed: ${error}` : "No profile rows."} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em", padding: "0 4px 4px" }}>
        {rows.length} PROFILE{rows.length === 1 ? "" : "S"}
      </div>
      {rows.map(r => (
        <div
          key={r.id}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px",
            background: r.role === "admin" ? "#1a0a0a" : "#141414",
            border: `1px solid ${r.role === "admin" ? "#3a1a1a" : "#242424"}`,
            borderRadius: 10, textAlign: "left",
          }}
        >
          <div style={{ width: 32, height: 32, borderRadius: 16, background: "#2a2015", color: "#f5c842", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Fraunces',serif", fontSize: 14, fontWeight: 500, flexShrink: 0 }}>
            {(r.name || "?")[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 13, color: "#f0ece4", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name || "— no name —"}
              {r.id === viewerId && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#f5c842", marginLeft: 6, letterSpacing: "0.08em" }}>(YOU)</span>}
            </div>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", marginTop: 2, letterSpacing: "0.04em" }}>
              {r.id.slice(0, 8)}… · {new Date(r.created_at).toLocaleDateString()}
              {r.dietary ? ` · ${r.dietary.toUpperCase()}` : ""}
              {typeof r.total_xp === "number" ? ` · ${r.total_xp}XP` : ""}
            </div>
          </div>
          <span style={{
            fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
            color: r.role === "admin" ? "#ef4444" : "#666",
            background: r.role === "admin" ? "#2a0a0a" : "transparent",
            border: `1px solid ${r.role === "admin" ? "#5a1a1a" : "#2a2a2a"}`,
            padding: "2px 7px", borderRadius: 10, letterSpacing: "0.08em",
          }}>
            {(r.role || "user").toUpperCase()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Receipts list ─────────────────────────────────────────────────
function ReceiptsList({ viewerId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: err } = await supabase
        .from("receipts")
        .select("id, user_id, store_name, receipt_date, scanned_at, total_cents, item_count, image_path, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!alive) return;
      if (err) { setError(err.message); setRows([]); return; }
      setRows(data || []);
    })();
    return () => { alive = false; };
  }, []);

  if (rows === null) return <Loading />;
  if (rows.length === 0) return <Empty msg={error ? `Load failed: ${error}` : "No receipts yet."} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em", padding: "0 4px 4px" }}>
        {rows.length} RECEIPT{rows.length === 1 ? "" : "S"} (NEWEST 500)
      </div>
      {rows.map(r => {
        const dateLabel = r.receipt_date
          ? new Date(`${r.receipt_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })
          : new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
        return (
          <div
            key={r.id}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px",
              background: "#141414", border: "1px solid #242424",
              borderRadius: 10, textAlign: "left",
            }}
          >
            <span style={{ fontSize: 18, flexShrink: 0 }}>{r.image_path ? "📷" : "🧾"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 13, color: "#f0ece4", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.store_name || "— no store —"}
              </div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", marginTop: 2, letterSpacing: "0.04em" }}>
                {dateLabel.toUpperCase()}
                {r.item_count != null ? ` · ${r.item_count} ITEMS` : ""}
                {` · ${r.user_id.slice(0, 8)}…`}
                {r.user_id === viewerId ? " (YOU)" : ""}
              </div>
            </div>
            {r.total_cents != null && (
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#7ec87e", letterSpacing: "0.04em" }}>
                ${(r.total_cents / 100).toFixed(2)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Shared loading / empty ────────────────────────────────────────
function Loading() {
  return (
    <div style={{ padding: "40px 12px", textAlign: "center", fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#555", letterSpacing: "0.1em" }}>
      LOADING…
    </div>
  );
}
function Empty({ msg }) {
  return (
    <div style={{
      padding: "28px 16px", textAlign: "center",
      background: "#0a0a0a", border: "1px dashed #242424", borderRadius: 10,
      fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", fontStyle: "italic",
    }}>
      {msg}
    </div>
  );
}
