-- Tighten receipts UPDATE to owner-only.
--
-- Migration 0041 broadened receipts UPDATE to "owner OR family" —
-- intended to support household co-editing of receipt headers. In
-- practice only the owner edits their own receipt header; the
-- family-write surface isn't used and opens a privacy hole — a
-- family member could rewrite store_name, receipt_date, total_cents,
-- or scan_items via a direct API call (bypassing the UI's
-- ownership gate in ReceiptView).
--
-- Return UPDATE to owner-only. The SELECT policy at 0011 keeps
-- family read access intact, so the household spend-insight use
-- case is unaffected. The DELETE policy at 0049 (admin-only) is
-- untouched.

drop policy if exists receipts_update_family on public.receipts;
drop policy if exists receipts_update       on public.receipts;
drop policy if exists receipts_update_self  on public.receipts;

create policy receipts_update_self on public.receipts
  for update to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);
