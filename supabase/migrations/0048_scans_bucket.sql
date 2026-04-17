-- Create the 'scans' Storage bucket for receipt + pantry-shelf scan
-- images. Migration 0030 already wrote the storage.objects policies
-- for this bucket, but the bucket itself required a manual step in
-- the Supabase dashboard ("Bucket name: scans, Public: false"). That
-- manual step was easy to miss — scans would land in pantry_items,
-- receipts would get inserted with image_path=null, and the upload
-- call would fail with "Bucket not found".
--
-- This migration creates the bucket programmatically so the upload
-- path works end-to-end after a fresh migration run. Mirrors the
-- pattern in 0018_cook_log_photos.sql for the 'meal-photos' bucket.
--
-- public=false: scan images contain prices, store locations, and
-- occasionally loyalty numbers. The client reads them via signed
-- URLs (see ReceiptView.jsx), which is why 0030 skipped a public-
-- read policy — authorization happens at the receipts/pantry_scans
-- row level, not at the storage layer.
--
-- file_size_limit: 10 MB max per object. Compressed phone photos
-- run 1-3 MB typically; 10 MB gives headroom for uncompressed HEIC
-- or raw uploads while keeping abusive uploads out.
--
-- allowed_mime_types: image/* only. Locks out anyone trying to
-- smuggle non-image files into a bucket that's scoped to scans.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'scans',
    'scans',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  )
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
