import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { findIngredient, unitLabel } from "../data/ingredients";

// ReceiptView — modal that opens when the user taps "TAP TO VIEW RECEIPT"
// on an ItemCard's provenance line. Shows:
//
//   * The original scan image (fetched via a signed Storage URL)
//   * Store / date / total metadata
//   * Every pantry item that came from this receipt — tapping one
//     closes this modal and opens that item's own ItemCard.
//
// Chunk F (post-hoc editing) adds the ability to re-link or correct an
// item from this view; that lands later.
//
// Props:
//   receiptId            — the uuid to load
//   pantry               — full pantry array (for resolving source_receipt_id)
//   onClose()            — dismiss
//   onOpenItem(item)     — open a specific pantry row in ItemCard
export default function ReceiptView({ receiptId, pantry = [], onClose, onOpenItem }) {
  const [receipt, setReceipt] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the receipt row + signed image URL (if any).
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("receipts")
        .select("id, store_name, receipt_date, scanned_at, total_cents, item_count, image_path")
        .eq("id", receiptId)
        .single();
      if (!alive) return;
      if (error) {
        console.warn("[receipts] load failed:", error.message);
        setReceipt(null);
        setLoading(false);
        return;
      }
      setReceipt(data);
      // Signed URL, 60-minute TTL — plenty for a viewing session, not so
      // long that a leaked URL is a forever problem.
      if (data.image_path) {
        const { data: signed, error: urlErr } = await supabase.storage
          .from("scans")
          .createSignedUrl(data.image_path, 60 * 60);
        if (!urlErr && signed?.signedUrl && alive) setImageUrl(signed.signedUrl);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [receiptId]);

  // Items in the pantry that point back at this receipt.
  const relatedItems = useMemo(
    () => (pantry || []).filter(p => p.sourceReceiptId === receiptId),
    [pantry, receiptId]
  );

  // Compact display for the metadata strip.
  const displayDate = receipt?.receipt_date || receipt?.scanned_at;
  const dateLabel = displayDate
    ? new Date(displayDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;
  const totalLabel = typeof receipt?.total_cents === "number"
    ? `$${(receipt.total_cents / 100).toFixed(2)}`
    : null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 330,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "18px 22px 36px",
        maxHeight: "92vh", overflowY: "auto",
        position: "relative",
      }}>
        {/* Drag handle (visual; swipe-to-dismiss could be added later) */}
        <div style={{ width: 44, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 14px" }} />

        {/* Close */}
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

        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.12em", marginBottom: 6 }}>
          🧾 RECEIPT
        </div>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic", color: "#f0ece4", fontWeight: 400, margin: 0, lineHeight: 1.2 }}>
          {receipt?.store_name || "Unknown store"}
        </h2>

        {/* Metadata strip */}
        <div style={{ display: "flex", gap: 12, marginTop: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {dateLabel && (
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.08em" }}>
              📅 {dateLabel.toUpperCase()}
            </span>
          )}
          {totalLabel && (
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7ec87e", letterSpacing: "0.08em" }}>
              💵 {totalLabel}
            </span>
          )}
          {receipt?.item_count != null && (
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.08em" }}>
              📦 {receipt.item_count} ITEMS
            </span>
          )}
        </div>

        {/* Image — fills width, contains within a max-height so the card
            stays scrollable even with a long receipt photo. */}
        {loading ? (
          <div style={{ padding: "40px 12px", textAlign: "center", fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#555", letterSpacing: "0.1em" }}>
            LOADING…
          </div>
        ) : imageUrl ? (
          <div style={{ background: "#0a0a0a", border: "1px solid #1f1f1f", borderRadius: 10, padding: 8, marginBottom: 16, textAlign: "center" }}>
            <img
              src={imageUrl}
              alt="Receipt scan"
              style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: 6, display: "inline-block" }}
            />
          </div>
        ) : (
          <div style={{
            padding: "28px 16px", textAlign: "center", marginBottom: 16,
            background: "#0a0a0a", border: "1px dashed #242424", borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", fontStyle: "italic",
          }}>
            No image on file. This receipt was scanned before image storage shipped — rows are still tracked, just no picture.
          </div>
        )}

        {/* Items that came from this receipt */}
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.12em", marginBottom: 8 }}>
          ITEMS FROM THIS SCAN ({relatedItems.length})
        </div>
        {relatedItems.length === 0 ? (
          <div style={{
            padding: "16px", textAlign: "center",
            background: "#0a0a0a", border: "1px dashed #242424", borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", fontStyle: "italic",
          }}>
            No pantry rows link back to this receipt. Items may have been removed, or the link was lost in a pre-0029 scan.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {relatedItems.map(item => {
              const canon = findIngredient(item.ingredientId);
              const uLabel = canon ? unitLabel(canon, item.unit) : item.unit;
              return (
                <button
                  key={item.id}
                  onClick={() => { onOpenItem?.(item); onClose?.(); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px",
                    background: "#141414", border: "1px solid #242424",
                    borderRadius: 10, cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{item.emoji || "🥫"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Fraunces',serif", fontSize: 14, color: "#f0ece4", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name}
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", marginTop: 2, letterSpacing: "0.05em" }}>
                      {item.amount} {uLabel}
                      {item.priceCents != null ? ` · $${(item.priceCents / 100).toFixed(2)}` : ""}
                    </div>
                  </div>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.08em" }}>→</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
