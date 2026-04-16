-- Receipt image storage pointer.
--
-- Adds `image_path` to public.receipts so the client can upload the
-- original scan to Supabase Storage and keep the path on the receipt
-- row. The ItemCard's "TAP TO VIEW RECEIPT" deep link then resolves to
-- a signed URL and the ReceiptView modal renders the image alongside
-- the row-by-row breakdown.
--
-- IMPORTANT — bucket creation step:
--
-- Run this migration THEN manually create a Storage bucket in the
-- Supabase dashboard:
--
--   Bucket name: scans
--   Public:      false  (signed URLs only — images contain prices,
--                        store locations, occasionally loyalty numbers)
--   File size:   10 MB max per object is plenty for a phone photo
--
-- Storage policies (also via dashboard, or re-run the SQL below):
--
--   READ:  the owner and their family can fetch signed URLs. RLS on
--          public.receipts already limits receipts selects to owner +
--          family (migration 0011), so the natural query pattern is:
--            1) SELECT image_path FROM receipts WHERE id = ?
--               → RLS filters by user
--            2) Call storage.createSignedUrl(bucket, path)
--          So we don't even need a storage-level family-read policy —
--          clients can't ask for a path they shouldn't see.
--
--   WRITE: authenticated users can upload to scans/<their uid>/...
--          (see storage_scans_write_policy below)
--
-- The path convention on upload:
--   scans/<user_id>/<receipt_id>.jpg
-- Predictable, one-to-one with the receipt row, no extra bookkeeping.

alter table public.receipts
  add column if not exists image_path text null;

-- Storage policy — each user can write to their own namespace in the
-- 'scans' bucket. Supabase Storage enforces these via storage.objects
-- row-level security. Using 'if exists' guards so the migration stays
-- idempotent even if the policy is created via dashboard first.
drop policy if exists "scans: self-write" on storage.objects;
create policy "scans: self-write"
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'scans'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "scans: self-read" on storage.objects;
create policy "scans: self-read"
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'scans'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "scans: self-delete" on storage.objects;
create policy "scans: self-delete"
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'scans'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
