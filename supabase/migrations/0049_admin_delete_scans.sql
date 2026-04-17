-- Admin delete policies for scan artifacts.
--
-- 0042 added admin SELECT bypass on profiles + receipts, but left all
-- mutation paths (INSERT/UPDATE/DELETE) on shared tables — including
-- scan artifacts — to owner-only. That blocked a common admin chore:
-- cleaning up broken or duplicate scans that other family members
-- made so they can re-scan.
--
-- Scope limited to the scan-artifact surface:
--   * receipts           — delete a bad receipt row
--   * pantry_scans       — delete a bad shelf-scan row
--   * pantry_items       — delete items that landed from a bad scan
--                          (admin nukes the receipt, pantry rows need
--                          to go too or they become orphans pointing
--                          at a source_receipt_id that's been deleted)
--   * storage.objects    — delete the uploaded image from the 'scans'
--                          bucket so the storage footprint matches
--                          the DB state
--
-- Everything else (cook_logs, shopping list, notifications, badges,
-- etc.) stays owner-only. Admin delete is opt-in per table; adding
-- it broadly would change the security posture in ways that aren't
-- required for the scan-retry workflow.

-- receipts: admin can DELETE any row. 0006's self-delete stays in
-- place for the owner; this adds admin on top.
drop policy if exists "receipts: admin-delete" on public.receipts;
create policy "receipts: admin-delete"
  on public.receipts for delete
  using (public.is_admin());

-- pantry_scans: same pattern. 0032 created the table with
-- self-delete; admin gets the same bypass.
drop policy if exists "pantry_scans: admin-delete" on public.pantry_scans;
create policy "pantry_scans: admin-delete"
  on public.pantry_scans for delete
  using (public.is_admin());

-- pantry_items: admin can DELETE any row. The admin workflow is
-- "nuke the receipt and all items linked to it, then re-scan" —
-- without this the pantry_items would survive as dangling
-- source_receipt_id references. RLS on the regular family path
-- stays unchanged (self-delete + family-delete from earlier
-- migrations); admin is additive.
drop policy if exists "pantry_items: admin-delete" on public.pantry_items;
create policy "pantry_items: admin-delete"
  on public.pantry_items for delete
  using (public.is_admin());

-- storage.objects: admin can DELETE any object in the 'scans' bucket
-- so the image file dies with the receipt row. 0030's self-delete
-- stays in place for the owner; this is the admin override.
drop policy if exists "scans: admin-delete" on storage.objects;
create policy "scans: admin-delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'scans'
    and public.is_admin()
  );
