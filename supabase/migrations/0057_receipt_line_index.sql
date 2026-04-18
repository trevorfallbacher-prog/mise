-- Receipt-line traceability for the per-instance pantry model.
--
-- Phase 1 started writing N rows per receipt (a bulk Costco run of 50
-- tuna cans = 50 rows) so groupByIdentity can render them as a
-- stacked card. Phase 4 adds a FAN-OUT pass to keep the ingest
-- consistent whether the OCR emits one aggregate line ("TUNA 2X",
-- amount=2) or two separate lines (amount=1 each): discrete-count
-- lines with amount > 1 get expanded into N copies of amount=1
-- before the merge path sees them.
--
-- Shape:
--
--   receipt_line_index  int, nullable. The position of this pantry
--                       row in the receipt's FLATTENED (post-fan-
--                       out) output. Two cans that came off OCR line
--                       7 as "TUNA 2X" get sequential indices, not
--                       both = 7. Other entry methods (manual / cook
--                       / conversion / pantry-scan) leave this NULL.
--
-- Primary use today is traceability — each pantry row can be
-- attributed back to its specific post-fan-out position on the
-- receipt snapshot, which helps debug parser drift (did OCR give us
-- one line or two?) and makes future per-line edits possible.
--
-- The partial unique index is the forward-looking hook for receipt-
-- level re-import dedupe: once the receipts-upsert path lands
-- (matching store + date + subtotal so a re-scan reuses the existing
-- receipt id instead of minting a new one), this index prevents
-- double-stacking on re-import. Until then the index never fires in
-- practice because each scan attempt today gets a fresh
-- source_receipt_id.
--
-- No backfill — existing rows have receipt_line_index = NULL which
-- the partial index ignores.

alter table public.pantry_items
  add column if not exists receipt_line_index int null;

create unique index if not exists pantry_items_receipt_line_dedupe
  on public.pantry_items (user_id, source_receipt_id, receipt_line_index)
  where source_receipt_id is not null
    and receipt_line_index is not null;
