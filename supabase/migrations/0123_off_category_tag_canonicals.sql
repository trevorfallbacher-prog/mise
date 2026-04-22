-- 0123_off_category_tag_canonicals.sql
--
-- Tier-1 "learned tag map" for canonicalResolver. Maps a single OFF
-- categoryHint slug → a canonical_id that the admin / crowd has
-- confirmed is correct for products carrying that tag. The resolver
-- consults this table FIRST (before any fuzzy matching) so that,
-- after one admin rewire of a Pepsi Zero mis-tagged as sugar, every
-- future fresh scan of a different soda UPC whose OFF hints also
-- carry "sodas" or "colas" lands on the same canonical
-- (soft_drink) at "exact" confidence, without the user ever
-- touching the canonical chip.
--
-- Why a new table instead of extending ingredient_info: OFF
-- categoryHints are a DIFFERENT namespace from our canonical slugs.
-- One OFF tag ("sodas") maps to one of OUR canonicals (soft_drink),
-- and the learning grows orthogonally to the canonical registry —
-- adding a new canonical doesn't magically teach the resolver about
-- all of OFF's tag vocabulary for it, and adding a new OFF tag
-- mapping doesn't change anything about the canonical itself.
-- Keeping them separate also lets admin rename a canonical
-- (soda_pop → soft_drink) and cascade the tag-map rows with a
-- simple UPDATE, the same shape used for barcode_identity_corrections.
--
-- Write model: admin-gated. Regular users teach via the existing
-- barcode_identity_corrections / user_scan_corrections paths
-- (UPC-keyed, narrower). Admin writes here carry the whole
-- categoryHints array from the corrected row, so one rewire seeds
-- every hint the product carried. Filtering of generic hints
-- ("beverages" is too broad to be useful) happens client-side in the
-- write helper before the upsert.

-- ── 1. Table ────────────────────────────────────────────────────────
create table if not exists public.off_category_tag_canonicals (
  off_tag           text        primary key,

  canonical_id      text        not null,

  -- Tally: every admin correction that confirms this mapping bumps
  -- the count. Useful when we later want to gate auto-apply
  -- confidence on crowd corroboration.
  correction_count  integer     not null default 1,
  last_used_at      timestamptz not null default now(),

  created_by        uuid        null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── 2. Indexes ──────────────────────────────────────────────────────
-- Primary key on off_tag already indexes the read path. Add an index
-- on canonical_id so the admin rename cascade (UPDATE ... WHERE
-- canonical_id = old_slug) stays cheap even as the table grows.
create index if not exists off_category_tag_canonicals_canonical_idx
  on public.off_category_tag_canonicals (canonical_id);

-- ── 3. Updated_at trigger ──────────────────────────────────────────
drop trigger if exists off_category_tag_canonicals_touch_updated_at
  on public.off_category_tag_canonicals;
create trigger off_category_tag_canonicals_touch_updated_at
  before update on public.off_category_tag_canonicals
  for each row execute function public.touch_updated_at();

-- ── 4. RLS ──────────────────────────────────────────────────────────
-- Public read (reference data, same shape as barcode_identity_
-- corrections). Admin-only write.
alter table public.off_category_tag_canonicals enable row level security;

drop policy if exists "off_category_tag_canonicals: public-read"
  on public.off_category_tag_canonicals;
create policy "off_category_tag_canonicals: public-read"
  on public.off_category_tag_canonicals for select
  using (true);

drop policy if exists "off_category_tag_canonicals: admin-insert"
  on public.off_category_tag_canonicals;
create policy "off_category_tag_canonicals: admin-insert"
  on public.off_category_tag_canonicals for insert
  with check (public.is_admin());

drop policy if exists "off_category_tag_canonicals: admin-update"
  on public.off_category_tag_canonicals;
create policy "off_category_tag_canonicals: admin-update"
  on public.off_category_tag_canonicals for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "off_category_tag_canonicals: admin-delete"
  on public.off_category_tag_canonicals;
create policy "off_category_tag_canonicals: admin-delete"
  on public.off_category_tag_canonicals for delete
  using (public.is_admin());

-- ── 5. Realtime ────────────────────────────────────────────────────
-- Published so the client-side hook picks up newly-seeded mappings
-- without a page reload. Same pattern as avatar_catalog /
-- ingredient_info.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'off_category_tag_canonicals'
  ) then
    alter publication supabase_realtime
      add table public.off_category_tag_canonicals;
  end if;
end $$;
