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
export default function ReceiptView({ receiptId, scanId, pantry = [], userId, familyIds = [], onClose, onOpenItem }) {
  const [receipt, setReceipt] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  // Inline editor state for header fields. Only receipt-scan artifacts
  // have editable store/date (pantry_scan has none of those concepts).
  // null = no field being edited.
  const [editingField, setEditingField] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Per-snapshot-row restore state. Keyed by snapshot index so the
  // button on row N can show "…" while the others stay tappable.
  // `restoredIds` tracks which snapshot rows we've already re-
  // inserted this session so re-clicks stay idempotent until the
  // realtime event rehydrates the `_live` field.
  const [restoring, setRestoring] = useState(new Set());
  const [restoreError, setRestoreError] = useState(null);
  // Access denied = the loaded receipt belongs to someone else. Family
  // sharing lets rows SURFACE across users (e.g. a row whose
  // source_receipt_id points at a spouse's receipt), but opening the
  // receipt itself is not in scope here — a non-owner viewer should
  // not see a stranger's grocery list, price totals, or RESTORE
  // affordance. When this flag trips, we render an empty sheet and
  // call onClose() via effect so the user lands back where they were.
  const [accessDenied, setAccessDenied] = useState(false);
  // Inline "arm then confirm" pattern for destructive delete — swap
  // out window.confirm so the delete flow stays inside the sheet
  // with the actual receipt context visible, rather than ripping the
  // user over to an OS modal that feels bolted on.
  const [armingDelete, setArmingDelete] = useState(false);
  // Which artifact kind is being rendered — drives row filtering + copy.
  const kind = scanId ? "pantry_scan" : "receipt";
  const artifactId = receiptId || scanId;

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Access denied → bail after a short beat. The sheet flashes a
  // minimal "Not your receipt" message and dismisses itself — we
  // don't want a non-owner viewer staring at someone else's grocery
  // totals, store, or line items even briefly.
  useEffect(() => {
    if (!accessDenied) return undefined;
    const t = setTimeout(() => onClose?.(), 900);
    return () => clearTimeout(t);
  }, [accessDenied, onClose]);

  // Is the viewer the owner of this artifact? Gates every WRITE path
  // (header edit, delete, restore) — family members can READ but not
  // mutate someone else's receipt, and a restored row always belongs
  // to its owner (never forge a pantry_items row stamped with
  // someone else's receipt_id).
  const isOwner = !!(receipt?.user_id && receipt.user_id === userId);

  // Persist a patch to the receipts row. Optimistic local update so the
  // header re-renders immediately; real-world latency on Supabase update
  // is usually sub-200ms but an empty spinner flash looked broken. If
  // the update fails (rare — usually an offline blip), we surface the
  // server error via console.warn and leave the optimistic state in
  // place so the user can retry on reconnect. Only applies to
  // receipt-kind artifacts (pantry_scan has no editable header).
  const commitReceiptPatch = async (patch) => {
    if (kind !== "receipt" || !artifactId) { setEditingField(null); return; }
    // Owner-only. The RLS policy may also block non-owner UPDATEs,
    // but bail early so a family viewer's edits don't even try.
    if (!isOwner) { setEditingField(null); return; }
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

  // Delete the scan artifact (receipt or pantry_scan). Full cascade:
  // every pantry_items row that points at this artifact is removed,
  // the uploaded photo leaves Storage, then the artifact row itself
  // is deleted. Order matters — nuke dependents first so nothing
  // orphans mid-delete. Self-delete RLS (0006 for receipts) scopes
  // each statement to the caller's own data; admin bypass (0049)
  // lets admins wipe other people's receipts from the admin portal.
  const deleteArtifact = async () => {
    if (!artifactId || deleting) return;
    // Owner-only. Family members can read but can't nuke each
    // other's receipts — RLS should also reject, but bail early so
    // the request never leaves the client.
    if (!isOwner) return;
    setDeleting(true);
    const table = kind === "pantry_scan" ? "pantry_scans" : "receipts";
    const fkCol  = kind === "pantry_scan" ? "source_scan_id" : "source_receipt_id";
    try {
      // 1. pantry_items first — once gone there's no dangling FK.
      const { error: itemsErr } = await supabase
        .from("pantry_items")
        .delete()
        .eq(fkCol, artifactId);
      if (itemsErr) throw itemsErr;
      // 2. storage image — best-effort, a missing object isn't fatal.
      if (receipt?.image_path) {
        const { error: storageErr } = await supabase.storage
          .from("scans")
          .remove([receipt.image_path]);
        if (storageErr) console.warn("[receipt delete] image remove failed:", storageErr.message);
      }
      // 3. artifact row itself.
      const { error: rowErr } = await supabase.from(table).delete().eq("id", artifactId);
      if (rowErr) throw rowErr;
      setDeleting(false);
      onClose?.();
    } catch (e) {
      setDeleting(false);
      alert(`Couldn't delete: ${e.message || e}`);
    }
  };

  // Re-insert a "consumed" snapshot row back into pantry_items. The
  // scan_items JSONB (migration 0050) preserved the full row shape at
  // scan-confirm time, so we can rebuild the pantry row verbatim with
  // a fresh id and the original source_* artifact pointer so provenance
  // survives the round-trip. Used when pantry rows vanish unexpectedly
  // (see the diff-based persistDiff race in useSyncedList.js — if
  // anything ever removes a row locally without going through a cook
  // or the ✕ button, the DB DELETE follows automatically).
  const restoreSnapshotRow = async (snapshotIdx, snapshot) => {
    if (!userId || !snapshot) return;
    // Owner-only. RESTORE forges a pantry_items row linked to
    // source_receipt_id — that's only meaningful when the viewer
    // owns the receipt. A family viewer restoring from someone
    // else's receipt would mint a row in THEIR pantry stamped with
    // a sibling's receipt id, which is not something we want to
    // create.
    if (!isOwner) return;
    setRestoring(prev => new Set(prev).add(snapshotIdx));
    setRestoreError(null);
    try {
      const fkCol = kind === "pantry_scan" ? "source_scan_id" : "source_receipt_id";
      const newId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const amt = typeof snapshot.amount === "number" ? snapshot.amount : 1;
      const row = {
        id: newId,
        user_id: userId,
        name: snapshot.name || snapshot.rawText || "restored item",
        emoji: snapshot.emoji || "🥫",
        amount: amt,
        unit: snapshot.unit || "count",
        max: Math.max(amt * 2, 1),
        low_threshold: Math.max(amt * 0.25, 0.25),
        category: snapshot.category || "pantry",
        price_cents: snapshot.priceCents ?? null,
        location: snapshot.location || "pantry",
        purchased_at: new Date().toISOString(),
        // Source provenance — pointer back to THIS artifact so the row
        // shows up under its "Items from this scan" list on next open.
        source_kind: kind === "pantry_scan" ? "pantry_scan" : "receipt_scan",
        [fkCol]: artifactId,
        // Identity/composition — carry forward everything the snapshot
        // knew so merge heuristics don't re-collide with other rows.
        ...(snapshot.ingredientId ? { ingredient_id: snapshot.ingredientId } : {}),
        ...(Array.isArray(snapshot.ingredientIds) && snapshot.ingredientIds.length
          ? { ingredient_ids: snapshot.ingredientIds } : {}),
        ...(snapshot.canonicalId ? { canonical_id: snapshot.canonicalId } : {}),
        ...(snapshot.state ? { state: snapshot.state } : {}),
        ...(snapshot.typeId ? { type_id: snapshot.typeId } : {}),
        ...(snapshot.tileId ? { tile_id: snapshot.tileId } : {}),
      };
      const { error } = await supabase.from("pantry_items").insert(row);
      if (error) throw error;
    } catch (e) {
      setRestoreError(e.message || String(e));
    } finally {
      setRestoring(prev => {
        const next = new Set(prev);
        next.delete(snapshotIdx);
        return next;
      });
    }
  };

  // Bulk-restore everything currently flagged consumed. Sequential
  // rather than parallel because pantry_items has a uniqueness story
  // around ingredient_id that we don't want to race into a 409.
  const restoreAllMissing = async (missingList) => {
    for (const { idx, snapshot } of missingList) {
      // eslint-disable-next-line no-await-in-loop
      await restoreSnapshotRow(idx, snapshot);
    }
  };

  // Load the artifact row (receipts or pantry_scans) + signed image URL.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const table = kind === "pantry_scan" ? "pantry_scans" : "receipts";
      // scan_items (migration 0050) is the historical snapshot of
      // the line items captured at scan-confirm time — independent of
      // live pantry state so deletes / merges / cooks don't erase the
      // receipt's contents. Falls back to null on pre-0050 rows; the
      // UI layers it over the pantry-derived view so legacy receipts
      // don't read empty.
      // user_id is loaded so we can gate ownership-sensitive actions
      // (RESTORE, DELETE, header edits) on the viewer being the
      // original owner. RLS lets family members READ each other's
      // receipts, but MUTATING another user's receipt — or forging a
      // pantry_items row stamped with their receipt_id — is not
      // something this view should ever do.
      const selectCols = kind === "pantry_scan"
        ? "id, user_id, kind, scanned_at, item_count, image_path, scan_items"
        : "id, user_id, store_name, receipt_date, scanned_at, total_cents, item_count, image_path, scan_items";
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
      // Ownership gate. The RLS policy on receipts / pantry_scans
      // permits reads for family members, so data can come back for
      // a row the viewer doesn't own. Allow the owner and any
      // explicit family member through; everyone else gets bounced.
      const ownerId = data?.user_id;
      const allowed = ownerId === userId || familyIds.includes(ownerId);
      if (!allowed) {
        setAccessDenied(true);
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

  // Historical scan-items list. Prefers receipt.scan_items (the
  // snapshot captured at scan-confirm time — complete & immutable)
  // over the live pantry filter. Falls back to pantry-derived for
  // receipts scanned before migration 0050 landed. We ALSO decorate
  // each row with a reference to the live pantry row (by matching
  // canonical / name) so tapping a row can still deep-link into its
  // current ItemCard — the snapshot gives us history, the decoration
  // gives us "still have it" signal.
  const relatedItems = useMemo(() => {
    // Live pantry rows that point back at this artifact — used as a
    // lookup for decorating snapshot rows, AND as the fallback list
    // if the receipt has no scan_items snapshot.
    const liveMatches = !pantry ? [] :
      (kind === "pantry_scan"
        ? pantry.filter(p => p.sourceScanId === artifactId)
        : pantry.filter(p => p.sourceReceiptId === artifactId));

    // Pre-0050 receipt: no snapshot, best we can do is the live list.
    const snapshot = Array.isArray(receipt?.scan_items) ? receipt.scan_items : null;
    if (!snapshot || snapshot.length === 0) return liveMatches;

    // Build a cheap canonical/name index into live pantry so each
    // snapshot row can find its current counterpart (if any) —
    // powers the "still in kitchen" marker + tap-to-ItemCard.
    const byCanonical = new Map();
    const byNameLower = new Map();
    for (const p of (pantry || [])) {
      if (p.canonicalId && !byCanonical.has(p.canonicalId)) byCanonical.set(p.canonicalId, p);
      if (p.ingredientId && !byCanonical.has(p.ingredientId)) byCanonical.set(p.ingredientId, p);
      const n = (p.name || "").toLowerCase().trim();
      if (n && !byNameLower.has(n)) byNameLower.set(n, p);
    }
    return snapshot.map((s, i) => {
      const canonHit = (s.canonicalId && byCanonical.get(s.canonicalId))
        || (s.ingredientId && byCanonical.get(s.ingredientId))
        || null;
      const nameHit = !canonHit ? byNameLower.get((s.name || "").toLowerCase().trim()) : null;
      const live = canonHit || nameHit || null;
      // Merge the snapshot with the live row so onOpenItem can pass a
      // real pantry row to ItemCard. id key is stable across renders
      // — prefer the live id when present (so keys don't collide
      // with other receipt views), fall back to index.
      return {
        ...s,
        id: live?.id || `snapshot-${artifactId}-${i}`,
        _live: live,
        _fromSnapshot: true,
        // Stable index into the snapshot array. Used by the RESTORE
        // action so per-row busy state survives re-renders even when
        // the row has no live pantry counterpart to borrow an id from.
        _snapshotIdx: i,
      };
    });
  }, [pantry, artifactId, kind, receipt]);

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

        {accessDenied && (
          <div style={{ padding: "24px 12px", textAlign: "center" }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f59e0b", letterSpacing: "0.12em", marginBottom: 8 }}>
              NOT YOURS TO VIEW
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#aaa" }}>
              This receipt belongs to someone outside your household.
            </div>
          </div>
        )}

        {!accessDenied && (() => {
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
        {(() => {
          // Collect the indices of snapshot rows that have no live
          // counterpart — those are the "consumed" (actually
          // disappeared) items we offer to restore in bulk.
          const missingList = relatedItems
            .map((item, idx) => ({ item, idx }))
            .filter(({ item }) => item._fromSnapshot && !item._live && !restoring.has(item._snapshotIdx ?? item.id))
            .map(({ item }) => ({ idx: item._snapshotIdx ?? item.id, snapshot: item }));
          const missingCount = missingList.length;
          return (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#7eb8d4", letterSpacing: "0.12em" }}>
                ITEMS FROM THIS SCAN ({relatedItems.length})
              </div>
              {missingCount > 0 && userId && isOwner && (
                <button
                  onClick={() => restoreAllMissing(missingList)}
                  style={{
                    padding: "6px 10px",
                    background: "#1a1608", border: "1px solid #3a2f10",
                    color: "#f5c842", borderRadius: 8,
                    fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
                    letterSpacing: "0.08em", cursor: "pointer",
                  }}
                  title="Re-insert every missing item from this scan back into your pantry"
                >
                  ↺ RESTORE {missingCount}
                </button>
              )}
            </div>
          );
        })()}
        {restoreError && (
          <div style={{
            marginBottom:8, padding:"8px 10px",
            background:"#2a1515", border:"1px solid #3a1e1e",
            color:"#d77777", borderRadius:8,
            fontFamily:"'DM Sans',sans-serif", fontSize:12,
          }}>
            {restoreError}
          </div>
        )}
        {relatedItems.length === 0 ? (
          <div style={{
            padding: "16px", textAlign: "center",
            background: "#0a0a0a", border: "1px dashed #242424", borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", fontStyle: "italic",
          }}>
            No line items on this {kind === "pantry_scan" ? "scan" : "receipt"}. If this is a pre-0050 record, items may have been removed from your pantry since — the snapshot wasn't captured at the time.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {relatedItems.map((item, idx) => {
              const canon = findIngredient(item.ingredientId || item.canonicalId);
              const uLabel = canon ? unitLabel(canon, item.unit) : item.unit;
              // Snapshot rows carry _live when the pantry still has
              // a matching row; tapping opens that current row in
              // ItemCard. When _live is null the item's been
              // removed — we now offer a RESTORE button that
              // re-inserts from the captured snapshot (see the
              // ghost-delete writeup in the commit message for why
              // this matters as a safety net).
              const fromSnapshot = item._fromSnapshot;
              const live = item._live || null;
              const missing = fromSnapshot && !live;
              const tappable = !fromSnapshot || !!live;
              const snapshotIdx = item._snapshotIdx ?? idx;
              const isRestoring = restoring.has(snapshotIdx);
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (!tappable || missing) return;
                    if (fromSnapshot) {
                      if (live) onOpenItem?.(live);
                    } else {
                      onOpenItem?.(item);
                    }
                  }}
                  role={tappable ? "button" : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px",
                    background: tappable ? "#141414" : "#0f0f0f",
                    border: `1px solid ${tappable ? "#242424" : "#1a1a1a"}`,
                    borderRadius: 10,
                    cursor: tappable && !missing ? "pointer" : "default",
                    textAlign: "left",
                    opacity: tappable ? 1 : 0.85,
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
                      {fromSnapshot && !live && (
                        <span style={{ color: "#8a7f6e", marginLeft: 6, fontStyle: "italic" }}>· missing</span>
                      )}
                      {fromSnapshot && live && (
                        <span style={{ color: "#7ec87e", marginLeft: 6 }}>· still in kitchen</span>
                      )}
                    </div>
                  </div>
                  {missing && userId && isOwner ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        restoreSnapshotRow(snapshotIdx, item);
                      }}
                      disabled={isRestoring}
                      style={{
                        padding:"6px 10px",
                        background: isRestoring ? "#1a1608" : "transparent",
                        border: "1px solid #3a2f10",
                        color:"#f5c842", borderRadius:8,
                        fontFamily:"'DM Mono',monospace", fontSize:9, fontWeight:700,
                        letterSpacing:"0.08em",
                        cursor: isRestoring ? "wait" : "pointer",
                      }}
                    >
                      {isRestoring ? "…" : "↺ RESTORE"}
                    </button>
                  ) : (
                    <span style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      color: tappable ? "#7eb8d4" : "#3a3a3a",
                      letterSpacing: "0.08em",
                    }}>
                      {tappable ? "→" : "·"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Destructive action — arm-then-confirm inline, not a browser
            popup. First tap reveals a red-tinted panel listing exactly
            what gets removed; second tap commits. Cancel button dismisses
            the armed state cleanly. Only renders once the artifact has
            loaded (nothing to delete otherwise). */}
        {receipt && isOwner && (
          <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid #1f1f1f" }}>
            {!armingDelete ? (
              <button
                onClick={() => setArmingDelete(true)}
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
            ) : (
              <div style={{
                padding: "18px 18px 16px",
                background: "#1a0a0a", border: "1px solid #3a1a1a",
                borderRadius: 12,
              }}>
                <div style={{
                  fontFamily: "'Fraunces',serif", fontSize: 16,
                  fontStyle: "italic", color: "#f0d4d4",
                  lineHeight: 1.45, marginBottom: 6,
                }}>
                  Deleting this {kind === "pantry_scan" ? "scan" : "receipt"} means your pantry
                  forgets everything that came with it. The ingredients,
                  the quantities, all of it.
                </div>
                <div style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                  color: "#c4a8a8", lineHeight: 1.5, marginBottom: 14,
                }}>
                  We just want to make sure. This can't be undone.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setArmingDelete(false)}
                    disabled={deleting}
                    style={{
                      flex: 1, padding: "12px 12px",
                      background: "transparent",
                      border: "1px solid #2a2a2a",
                      color: "#aaa",
                      fontFamily: "'DM Mono',monospace", fontSize: 11,
                      letterSpacing: "0.08em",
                      borderRadius: 10, cursor: "pointer",
                    }}
                  >
                    Keep the receipt
                  </button>
                  <button
                    onClick={deleteArtifact}
                    disabled={deleting}
                    style={{
                      flex: 1, padding: "12px 12px",
                      background: deleting ? "#3a1a1a" : "#5a1818",
                      border: "none",
                      color: "#fff",
                      fontFamily: "'DM Mono',monospace", fontSize: 11,
                      fontWeight: 700, letterSpacing: "0.08em",
                      borderRadius: 10,
                      cursor: deleting ? "default" : "pointer",
                    }}
                  >
                    {deleting ? "DELETING…" : "Delete forever"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
