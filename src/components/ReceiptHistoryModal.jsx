import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// ReceiptHistoryModal — opens when the user taps the GROCERIES THIS
// MONTH banner on the Kitchen tab. Lists every receipt the viewer can
// see (self + family, via the receipts RLS policy from 0011), newest
// first. Each row is tappable; onOpenReceipt(id) routes into
// ReceiptView via the parent, so the viewer can drill into the photo +
// item breakdown without changing where ReceiptView lives.
//
// Grouping: by month, so a long scroll stays navigable. Month headers
// show total spend for that month as a lightweight roll-up.
//
// Not paginated yet — if a family accumulates thousands of receipts
// we'll add a limit + "load more". For now the monthly grouping plus
// the RLS scope keep the list manageable.
//
// Props:
//   userId            — viewer id (only used for "mine" vs "family" tag)
//   onOpenReceipt(id) — tap handler; parent opens ReceiptView
//   onClose()         — dismiss
export default function ReceiptHistoryModal({ userId, onOpenReceipt, onClose }) {
  const [rows, setRows] = useState(null); // null while loading
  const [error, setError] = useState(null);

  // Close on Escape — mirrors ReceiptView's keyboard handling so the
  // whole receipts surface feels consistent.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: err } = await supabase
        .from("receipts")
        .select("id, user_id, store_name, receipt_date, scanned_at, total_cents, item_count, image_path, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!alive) return;
      if (err) {
        console.warn("[receipts] history load failed:", err.message);
        setError(err.message);
        setRows([]);
        return;
      }
      setRows(data || []);
    })();
    return () => { alive = false; };
  }, []);

  // Bucket rows into {monthKey: [...]} for grouped rendering. monthKey
  // is YYYY-MM so sort order is naturally chronological. We prefer
  // receipt_date (real transaction date) and fall back to created_at
  // when the OCR couldn't parse one.
  const grouped = (() => {
    if (!rows) return null;
    const acc = new Map();
    for (const r of rows) {
      const d = r.receipt_date ? new Date(`${r.receipt_date}T12:00:00`) : new Date(r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!acc.has(key)) acc.set(key, { label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }), totalCents: 0, items: [] });
      const bucket = acc.get(key);
      bucket.totalCents += (r.total_cents || 0);
      bucket.items.push(r);
    }
    return Array.from(acc.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 315,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "18px 22px 36px",
        maxHeight: "92vh", overflowY: "auto",
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

        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#4ade80", letterSpacing: "0.12em", marginBottom: 6 }}>
          🧾 RECEIPT HISTORY
        </div>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic", color: "#f0ece4", fontWeight: 400, margin: 0, lineHeight: 1.2, marginBottom: 14 }}>
          Every receipt you've scanned
        </h2>

        {rows === null && (
          <div style={{ padding: "40px 12px", textAlign: "center", fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#555", letterSpacing: "0.1em" }}>
            LOADING…
          </div>
        )}

        {rows && rows.length === 0 && (
          <div style={{
            padding: "28px 16px", textAlign: "center",
            background: "#0a0a0a", border: "1px dashed #242424", borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", fontStyle: "italic",
          }}>
            {error
              ? `Could not load receipts: ${error}`
              : "No receipts yet. Scan one from the Kitchen tab and it'll show up here."}
          </div>
        )}

        {grouped && grouped.map(([key, bucket]) => (
          <div key={key} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.12em" }}>
                {bucket.label.toUpperCase()} · {bucket.items.length} RECEIPT{bucket.items.length === 1 ? "" : "S"}
              </div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#7ec87e" }}>
                ${(bucket.totalCents / 100).toFixed(2)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {bucket.items.map(r => {
                const dateLabel = (r.receipt_date || r.created_at)
                  ? new Date(r.receipt_date ? `${r.receipt_date}T12:00:00` : r.created_at)
                      .toLocaleDateString(undefined, { month: "short", day: "numeric" })
                  : "—";
                const isMine = r.user_id === userId;
                return (
                  <button
                    key={r.id}
                    onClick={() => onOpenReceipt?.(r.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px",
                      background: "#141414", border: "1px solid #242424",
                      borderRadius: 10, cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{r.image_path ? "📷" : "🧾"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 14, color: "#f0ece4", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.store_name || "Unknown store"}
                      </div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", marginTop: 2, letterSpacing: "0.05em" }}>
                        {dateLabel.toUpperCase()}
                        {r.item_count != null ? ` · ${r.item_count} ITEM${r.item_count === 1 ? "" : "S"}` : ""}
                        {!isMine ? " · FAMILY" : ""}
                      </div>
                    </div>
                    {r.total_cents != null && (
                      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#7ec87e", letterSpacing: "0.04em" }}>
                        ${(r.total_cents / 100).toFixed(2)}
                      </span>
                    )}
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.08em", marginLeft: 4 }}>→</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
