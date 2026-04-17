-- 0045_pantry_scans_self_update.sql
--
-- Adds the missing UPDATE policy on public.pantry_scans so the
-- scanner can back-fill image_path after the image upload lands in
-- Storage. Without this, every pantry-shelf scan since 0030/0032
-- silently lost its image pointer — the upload succeeded in the
-- 'scans' bucket, but the UPDATE on the row was RLS-rejected with
-- zero rows affected and no thrown error. Result: ReceiptView
-- showed "No image on file" for every fridge/pantry/freezer scan
-- even though the JPG was sitting in Storage the whole time.
--
-- Receipts never had this bug because 0006 stamped a self-update
-- policy on receipts from day one (extended to family-update in
-- 0041). Pantry scans got the select/insert/delete policies in
-- 0032 but the update got missed.
--
-- Mirrors the 0041 pattern: family members can also correct a
-- pantry scan's metadata (currently just image_path and future
-- fields like a re-uploaded corrected photo).
--
-- IDEMPOTENT — drop-if-exists + create.

drop policy if exists "pantry_scans: self-update"   on public.pantry_scans;
drop policy if exists "pantry_scans: family-update" on public.pantry_scans;
create policy "pantry_scans: family-update"
  on public.pantry_scans for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

notify pgrst, 'reload schema';
