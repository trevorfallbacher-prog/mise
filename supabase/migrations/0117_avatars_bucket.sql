-- 0117_avatars_bucket.sql
--
-- Creates the `avatars` Storage bucket for user-uploaded profile
-- pictures. Bucket name matches convention already used by meal-photos
-- (0018) and scans (0048).
--
-- public=true: avatar URLs render in <img src=…> on every surface
-- without a signed-URL round-trip per render. The paths are scoped to
-- <user_id>/<uuid>.jpg so they're not enumerable, and the DB column
-- that holds the URL is already RLS-gated through profiles (family
-- + self select). Same rationale as meal-photos.
--
-- file_size_limit: 5 MB — avatars are tiny after compression
-- (compressImage downscales to 1600px JPEG q=0.72, typically <300 KB).
-- Half the cap of meal-photos/scans since avatars don't need headroom
-- for raw/HEIC originals.
--
-- allowed_mime_types: the same image formats the compressor can load.
-- Locks out anyone trying to smuggle non-image files into a public
-- bucket.
--
-- RLS on storage.objects:
--
--   * SELECT — public, same as meal-photos. Required for <img> to
--     load on any surface that knows the URL.
--   * INSERT — authenticated users may write ONLY under their own
--     user_id prefix. This is tighter than meal-photos (which accepts
--     any authenticated write) because avatars are a single-row-per-
--     user resource; without the prefix constraint a user could pile
--     objects into someone else's folder. The (storage.foldername
--     (name))[1] trick extracts the first path segment and compares
--     it to auth.uid() cast to text.
--   * UPDATE — owner only. Lets the upload path reuse a stable key
--     (e.g. upsert=true) without needing delete+insert.
--   * DELETE — owner only, same as meal-photos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars',
    'avatars',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  )
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars: self insert" on storage.objects;
create policy "avatars: self insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid())
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid());
