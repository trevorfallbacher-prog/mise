import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { findIngredient, unitLabel } from "../data/ingredients";

// ReceiptView — modal that opens when the user taps the provenance line
// on an ItemCard. Renders one of two scan-artifact kinds:
//
//   * Receipt scan (receiptId prop)     — from public.receipts
//   * Pantry-shelf scan (scanId prop)   — from public.pantry_scans
//
// Layout is the same for both: the original image (fetched via a signed
// Storage URL) + top metadata + a list of every pantry row this scan
// produced. Tapping an item closes this modal and opens that item's
// ItemCard.
//
// Chunk F adds post-hoc editing / re-linking from this view; that lands
// later.
//
// Props (pass exactly one of receiptId / scanId):
//   receiptId            — receipts.id uuid
//   scanId               — pantry_scans.id uuid
//   pantry               — full pantry array (for filtering related items)
//   onClose()            — dismiss
//   onOpenItem(item)     — open a specific pantry row in ItemCard
export default function ReceiptView({ receiptId, scanId, pantry = [], onClose, onOpenItem }) {
  const [receipt, setReceipt] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  // Inline editor state for header fields. Only receipt-scan artifacts
  // have editable store/date (pantry_scan has none of those concepts).
  // null = no field being edited.
  const [editingField, setEditingField] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Which artifact kind is being rendered — drives row filtering + copy.
  const kind = scanId ? "pantry_scan" : "receipt";
  const artifactId = receiptId || scanId;

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Persist a patch to the receipts row. Optimistic local update so the
  // header re-renders immediately; real-world latency on Supabase update
  // is usually sub-200ms but an empty spinner flash looked broken. If
  // the update fails (rare — usually an offline blip), we surface the
  // server error via console.warn and leave the optimistic state in
  // place so the user can retry on reconnect. Only applies to
  // receipt-kind artifacts (pantry_scan has no editable header).
  const commitReceiptPatch = async (patch) => {
    if (kind !== "receipt" || !artifactId) { setEditingField(null); return; }
    setSaving(true);
    setReceipt(prev => prev ? { ...prev, ...patch } : prev);
    setEditingField(null);
    const { error } = await supabase
      .from("receipts")
      .update(patch)
      .eq("id", artifactId);
    if (error) console.warn("[receipts] update failed:", error.message, patch);
    setSaving(false);
  };

  // Delete the scan artifact (receipt or pantry_scan). Related pantry
  // rows stay — they're real food the family might already be eating;
  // losing the source link is harmless (the component already renders
  // gracefully for pre-0029 rows with no source). DELETE on receipts is
  // owner-only by policy (0006 / 0041 comment), so non-owners will get
  // an RLS error surfaced via alert.
  const deleteArtifact = async () => {
    if (!artifactId || deleting) return;
    const n = relatedItems.length;
    const msg = n > 0
      ? `Delete this ${kind === "pantry_scan" ? "shelf scan" : "receipt"}? The ${n} pantry item${n === 1 ? "" : "s"} that came from it will stay — only the scan record and its photo are removed.`
      : `Delete this ${kind === "pantry_scan" ? "shelf scan" : "receipt"}?`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    const table = kind === "pantry_scan" ? "pantry_scans" : "receipts";
    const { error } = await supabase.from(table).delete().eq("id", artifactId);
    setDeleting(false);
    if (error) {
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    onClose?.();
  };

  // Load the artifact row (receipts or pantry_scans) + signed image URL.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const table = kind === "pantry_scan" ? "pantry_scans" : "receipts";
      const selectCols = kind === "pantry_scan"
        ? "id, kind, scanned_at, item_count, image_path"
        : "id, store_name, receipt_date, scanned_at, total_cents, item_count, image_path";
      const { data, error } = await supabase
        .from(table)
        .select(selectCols)
        .eq("id", artifactId)
        .single();
      if (!alive) return;
      if (error) {
        console.warn(`[${table}] load failed:`, error.message);
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
  }, [artifactId, kind]);

  // Items in the pantry that point back at this artifact. Filter changes
  // with kind so the same component surfaces the right items for either
  // scan artifact.
  const relatedItems = useMemo(() => {
    if (!pantry) return [];
    if (kind === "pantry_scan") return pantry.filter(p => p.sourceScanId === artifactId);
    return pantry.filter(p => p.sourceReceiptId === artifactId);
  }, [pantry, artifactId, kind]);

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
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 318,
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

        {(() => {
          const isPantryScan = kind === "pantry_scan";
          const headerEmoji = isPantryScan
            ? (receipt?.kind === "fridge" ? "🧊"
              : receipt?.kind === "freezer" ? "❄️"
              : "🥫")
            : "🧾";
          const headerLabel = isPantryScan
            ? `${String(receipt?.kind || "PANTRY").toUpperCase()} SCAN`
            : "RECEIPT";
          const headerTitle = isPantryScan
            ? (receipt?.kind === "fridge" ? "Fridge scan"
              : receipt?.kind === "freezer" ? "Freezer scan"
              : "Pantry scan")
            : (receipt?.store_name || "Unknown store");
          // Store-name edit lives on the h2 for receipt-scan artifacts.
          // Pantry-scan headers stay static — there's nothing to correct.
          // Tapping the h2 swaps in a text input; blur or Enter commits.
          const isEditingStore = !isPantryScan && editingField === "store";
          return (
            <>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.12em", marginBottom: 6 }}>
                {headerEmoji} {headerLabel}
              </div>
              {isEditingStore ? (
                <input
                  type="text"
                  autoFocus
                  defaultValue={receipt?.store_name || ""}
                  placeholder="Store name"
                  onBlur={e => commitReceiptPatch({ store_name: (e.target.value || "").trim() || null })}
                  onKeyDown={e => {
                    if (e.key === "Enter") e.target.blur();
                    if (e.key === "Escape") setEditingField(null);
                  }}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                    color: "#f5c842", fontWeight: 400, lineHeight: 1.2,
                    background: "#0a0a0a", border: "1px solid #f5c842",
                    borderRadius: 8, padding: "4px 10px", outline: "none",
                  }}
                />
              ) : (
                <h2
                  onClick={() => { if (!isPantryScan) setEditingField("store"); }}
                  title={isPantryScan ? undefined : "Tap to fix the store name (anyone in the family can edit)"}
                  style={{
                    fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
                    color: "#f0ece4", fontWeight: 400, margin: 0, lineHeight: 1.2,
                    cursor: isPantryScan ? "default" : "text",
                  }}
                >
                  {headerTitle}
                  {saving && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#7eb8d4", marginLeft:8, letterSpacing:"0.08em" }}>SAVING…</span>}
                </h2>
              )}
            </>
          );
        })()}

        {/* Metadata strip. Receipt-only fields (store, total) hide cleanly
            when we're showing a pantry-scan artifact since receipt is null
            for those. Date is tap-to-edit for receipt artifacts — same
            flow as store-name editing. */}
        <div style={{ display: "flex", gap: 12, marginTop: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          {kind === "receipt" && editingField === "date" ? (
            <input
              type="date"
              autoFocus
              defaultValue={receipt?.receipt_date || ""}
              onBlur={e => commitReceiptPatch({ receipt_date: e.target.value || null })}
              onKeyDown={e => {
                if (e.key === "Enter") e.target.blur();
                if (e.key === "Escape") setEditingField(null);
              }}
              style={{
                background: "#0a0a0a", border: "1px solid #f5c842",
                color: "#f5c842", borderRadius: 6, padding: "2px 6px",
                fontFamily: "'DM Mono',monospace", fontSize: 10, outline: "none",
              }}
            />
          ) : dateLabel ? (
            <button
              onClick={() => { if (kind === "receipt") setEditingField("date"); }}
              title={kind === "receipt" ? "Tap to fix the receipt date" : undefined}
              style={{
                background: "transparent", border: "none", padding: 0,
                fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888",
                letterSpacing: "0.08em",
                cursor: kind === "receipt" ? "pointer" : "default",
              }}
            >
              📅 {dateLabel.toUpperCase()}
            </button>
          ) : kind === "receipt" ? (
            <button
              onClick={() => setEditingField("date")}
              style={{
                background: "transparent", border: "1px dashed #2a2a2a",
                color: "#666", fontFamily: "'DM Mono',monospace", fontSize: 10,
                padding: "1px 6px", borderRadius: 4, cursor: "pointer", letterSpacing: "0.08em",
              }}
            >
              + set date
            </button>
          ) : null}
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
                  onClick={() => onOpenItem?.(item)}
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

        {/* Destructive action — a muted row at the bottom so it takes a
            second tap to confirm and doesn't sit next to the close ✕
            where mis-taps would hurt. Only renders once the artifact has
            loaded (nothing to delete otherwise). */}
        {receipt && (
          <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid #1f1f1f" }}>
            <button
              onClick={deleteArtifact}
              disabled={deleting}
              style={{
                width: "100%", padding: "10px 12px",
                background: "transparent", border: "1px solid #3a1a1a",
                color: deleting ? "#555" : "#b04545",
                fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.12em",
                borderRadius: 8, cursor: deleting ? "default" : "pointer",
              }}
            >
              {deleting ? "DELETING…" : `🗑  DELETE ${kind === "pantry_scan" ? "SHELF SCAN" : "RECEIPT"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
