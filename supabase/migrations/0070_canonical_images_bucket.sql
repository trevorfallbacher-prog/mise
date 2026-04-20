-- 0070_canonical_images_bucket.sql
--
-- AI-generated visual identity for canonical ingredients.
--
-- Unlike the curated /public/badges/*.svg set (hand-drawn, versioned
-- with the repo), canonical images are user-triggerable and
-- regenerable — admins can hit "↻ regenerate" on an IngredientCard
-- hero slot and burn a fresh Recraft call when the first output
-- wasn't right. Since every canonical has at most one active image
-- (no history of alternates), storage is keyed on canonical_id and
-- overwritten on each regen.
--
-- URL lives in ingredient_info.info.imageUrl (JSONB, no migration
-- needed on that table). The bucket is public so the client can use
-- a plain <img src> without a signed-URL round-trip — RLS is gate
-- enough because paths are keyed on canonical slugs which are
-- already public identifiers.
--
-- Write gate: admins only (profiles.role = 'admin' via is_admin()).
-- Matches the ingredient_info curation model.

insert into storage.buckets (id, name, public)
values ('canonical-images', 'canonical-images', true)
on conflict (id) do nothing;

-- Public read: bucket is public; anyone (including anon) can GET.
drop policy if exists "canonical-images: public read" on storage.objects;
create policy "canonical-images: public read"
  on storage.objects for select
  using (bucket_id = 'canonical-images');

-- Admin-only write / update / delete. Uses the is_admin() helper
-- established in migration 0042.
drop policy if exists "canonical-images: admin insert" on storage.objects;
create policy "canonical-images: admin insert"
  on storage.objects for insert
  with check (
    bucket_id = 'canonical-images'
    and public.is_admin(auth.uid())
  );

drop policy if exists "canonical-images: admin update" on storage.objects;
create policy "canonical-images: admin update"
  on storage.objects for update
  using (
    bucket_id = 'canonical-images'
    and public.is_admin(auth.uid())
  )
  with check (
    bucket_id = 'canonical-images'
    and public.is_admin(auth.uid())
  );

drop policy if exists "canonical-images: admin delete" on storage.objects;
create policy "canonical-images: admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'canonical-images'
    and public.is_admin(auth.uid())
  );

-- ── schema cache reload ───────────────────────────────────────────────
notify pgrst, 'reload schema';
