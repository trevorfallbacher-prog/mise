-- Source provenance on pantry_items.
--
-- Answers the question "where did this row come from?" with a deep link
-- back to the originating artifact (receipt, scan, cook log). The
-- ItemCard surfaces this as a clickable provenance line:
--
--   "Scanned from receipt Apr 15 · TAP TO VIEW" → opens receipt detail
--   "Scanned via pantry scan · Apr 15"          → opens scan session
--   "Added manually · Apr 15"                   → no link (obviously)
--   "Cooked from Sriracha · Apr 13"             → opens cook log
--
-- Today some of this provenance is partially inferable (source_cook_log_id
-- from migration 0026 exists for cook-complete outputs), but receipts and
-- free-form scan sessions have no link back. This closes that gap.
--
-- Columns added:
--
--   source_kind        text — 'receipt_scan' | 'pantry_scan' | 'manual'
--                            | 'cook' | 'conversion'. NULL for existing
--                            rows (treated as 'manual' by the UI).
--
--   source_receipt_id  uuid — fk to receipts(id) when the item came in
--                            via a receipt scan.
--
--   source_scan_id     uuid — fk to a future pantry_scans table OR to
--                            receipts.id when pantry-scanning a full
--                            fridge/shelf. Nullable; not enforced yet.
--
-- source_cook_log_id + source_recipe_slug already exist from migration
-- 0026 and continue to handle the 'cook' provenance kind.
--
-- No trigger, no backfill, no RLS changes — new columns are nullable or
-- defaulted. Existing RLS on pantry_items + receipts still keys on
-- user_id for auth.

alter table public.pantry_items
  add column if not exists source_kind       text null,
  add column if not exists source_receipt_id uuid null references public.receipts(id) on delete set null,
  add column if not exists source_scan_id    uuid null;

-- Validate source_kind at the DB level so a typo ('receipt-scan' vs
-- 'receipt_scan') doesn't silently break the UI's deep-link routing.
-- NULL is allowed for backward compatibility with pre-0029 rows.
alter table public.pantry_items
  drop constraint if exists pantry_items_source_kind_check;

alter table public.pantry_items
  add constraint pantry_items_source_kind_check
    check (source_kind is null or source_kind in ('receipt_scan', 'pantry_scan', 'manual', 'cook', 'conversion'));

-- Deep-link queries ("all items I got from this receipt") stay cheap.
create index if not exists pantry_items_source_receipt_idx
  on public.pantry_items (source_receipt_id)
  where source_receipt_id is not null;
