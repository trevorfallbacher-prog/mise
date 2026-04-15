-- mise — meal photos on cook_logs
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Anyone who can see a cook_log (the chef, any listed diner, or
-- family-of-chef — same cohort as cook_log_reviews) can upload photos
-- of the meal. A diner might snap a shot of the plated dish; the chef
-- might have a mise-en-place shot. Both belong together under one cook.
--
-- Photos live in Supabase Storage (bucket `meal-photos`, public-read so
-- the <img> tag can load them without a signed-URL round-trip). The DB
-- table tracks (cook_log_id, uploader_id, storage_path) so we have a
-- clean cascade when a cook is deleted and a cheap query path for "give
-- me every photo on this cook".
--
-- RLS:
--   * SELECT: same cohort as cook_log_reviews. We piggyback on the
--     can_see_cook_log helper from 0014.
--   * INSERT: uploader must be auth.uid() AND must be in the cohort.
--   * DELETE: uploader only (you can't remove someone else's picture).

create table if not exists public.cook_log_photos (
  id           uuid        primary key default gen_random_uuid(),
  cook_log_id  uuid        not null references public.cook_logs(id) on delete cascade,
  uploader_id  uuid        not null references auth.users(id)       on delete cascade,
  storage_path text        not null,
  created_at   timestamptz not null default now()
);

create index if not exists cook_log_photos_cook_idx
  on public.cook_log_photos (cook_log_id, created_at desc);
create index if not exists cook_log_photos_uploader_idx
  on public.cook_log_photos (uploader_id);

alter table public.cook_log_photos enable row level security;

drop policy if exists "cook_log_photos: cohort-select" on public.cook_log_photos;
create policy "cook_log_photos: cohort-select"
  on public.cook_log_photos for select
  using (public.can_see_cook_log(cook_log_id, auth.uid()));

drop policy if exists "cook_log_photos: cohort-insert" on public.cook_log_photos;
create policy "cook_log_photos: cohort-insert"
  on public.cook_log_photos for insert
  with check (
    auth.uid() = uploader_id
    and public.can_see_cook_log(cook_log_id, auth.uid())
  );

drop policy if exists "cook_log_photos: self-delete" on public.cook_log_photos;
create policy "cook_log_photos: self-delete"
  on public.cook_log_photos for delete
  using (auth.uid() = uploader_id);

-- Realtime so a photo uploaded by one diner appears instantly on every
-- open detail screen in the cohort.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.cook_log_photos';
  exception when duplicate_object then
    null;
  end;
end $$;


-- ── storage: public bucket + policies ───────────────────────────────────────
-- The bucket itself. `public=true` means the object URLs render in an
-- <img> tag without a signed-URL request per render. Fine for meal
-- photos — they're not private-sensitive, the RLS on the DB table gates
-- which paths a viewer even learns about.
insert into storage.buckets (id, name, public)
  values ('meal-photos', 'meal-photos', true)
  on conflict (id) do nothing;

-- Anyone (including unauthenticated) can read objects in this bucket —
-- required for <img src> to load on a public page. The paths are
-- opaque UUIDs; nobody can enumerate them without the DB row.
drop policy if exists "meal-photos: public read" on storage.objects;
create policy "meal-photos: public read"
  on storage.objects for select
  using (bucket_id = 'meal-photos');

-- Authenticated users can upload. We intentionally don't constrain the
-- path on INSERT — the client writes to `<cook_log_id>/<uuid>` and the
-- accompanying cook_log_photos row is what RLS-protects discovery.
drop policy if exists "meal-photos: auth insert" on storage.objects;
create policy "meal-photos: auth insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'meal-photos');

-- Only the original uploader can delete their object. `owner` on
-- storage.objects is auto-set to auth.uid() on insert, so this is a
-- direct equality check rather than a join through cook_log_photos.
drop policy if exists "meal-photos: owner delete" on storage.objects;
create policy "meal-photos: owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'meal-photos' and owner = auth.uid());
