-- User-created IDENTIFIED-AS tiles ("categories" in the user's language).
--
-- The app ships with a fixed set of organizational tiles per location
-- (Pasta & Grains, Baking, Dairy & Eggs, etc. — src/lib/*Tiles.js).
-- This migration lets users CREATE their own — family-shared,
-- unlimited-count — so a household can invent whatever organizational
-- scheme fits their kitchen ("Kids' Snacks", "Protein Powders",
-- "Sauces I Never Finish", "Grandma's Spice Kit").
--
-- Data model:
--   * user_tiles is parallel to user_item_templates in shape and RLS
--   * Strict per-family dedup by normalized label (same rule as
--     templates — one family one "Protein Powders" tile)
--   * use_count tracks popularity for the future admin-promotion tier
--     (tiles used by 10+ families get blessed into the bundled set)
--   * NO classifier function — user tiles are OPT-IN ONLY. Items land
--     there only when the user explicitly tags them. Built-in tiles
--     still run the heuristic for untagged items.
--
-- Location coupling:
--   * Every user tile belongs to exactly one location (fridge / pantry
--     / freezer). The location is inherent — "Kids' Snacks" lives in
--     the pantry tab, not abstractly.
--   * Explicit location column makes the pantry grid render trivial:
--     filter by location, grab tiles, grab items with that tile_id.

create table if not exists public.user_tiles (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,

  -- User-facing label. Preserved as typed for display.
  label             text        not null,

  -- Normalized for dedup lookups (lowercased + trimmed + internal
  -- whitespace collapsed). Maintained client-side on write; indexed
  -- uniquely per user as a backstop. Family-scoped uniqueness is
  -- application-level (same pattern as user_item_templates).
  label_normalized  text        not null,

  emoji             text        not null default '🗂️',

  -- Which tab this tile lives under. Matches the value stored in
  -- pantry_items.location.
  location          text        not null
                      check (location in ('fridge', 'pantry', 'freezer')),

  -- Popularity tracking, same semantics as user_item_templates.
  use_count         integer     not null default 0,
  last_used_at      timestamptz null,

  -- Admin promotion marker. Non-null = this tile has been blessed
  -- into the bundled tile set (future chunk). Users still see their
  -- version as "✓ Promoted" but the global set is authoritative.
  promoted_at       timestamptz null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Backstop: a single user can't create two tiles with the same
-- normalized label. Family-scoped dedup is app-level.
create unique index if not exists user_tiles_user_label_uq
  on public.user_tiles (user_id, label_normalized);

-- Fast read for the picker: family's tiles filtered by location.
create index if not exists user_tiles_user_location_idx
  on public.user_tiles (user_id, location, last_used_at desc nulls last);

-- ── RLS: family-shared (mirrors user_item_templates) ───────────────

alter table public.user_tiles enable row level security;

drop policy if exists "user_tiles: family-select" on public.user_tiles;
create policy "user_tiles: family-select"
  on public.user_tiles for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "user_tiles: family-insert" on public.user_tiles;
create policy "user_tiles: family-insert"
  on public.user_tiles for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "user_tiles: family-update" on public.user_tiles;
create policy "user_tiles: family-update"
  on public.user_tiles for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "user_tiles: family-delete" on public.user_tiles;
create policy "user_tiles: family-delete"
  on public.user_tiles for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- ── Realtime ────────────────────────────────────────────────────────
-- Family members see each other's tile creations live — the moment
-- one person creates "Kids' Snacks", it appears in every other family
-- member's picker without refresh.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_tiles'
  ) then
    alter publication supabase_realtime add table public.user_tiles;
  end if;
end $$;

-- ── updated_at trigger ──────────────────────────────────────────────

create or replace function public.touch_user_tiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_tiles_touch_updated_at on public.user_tiles;
create trigger user_tiles_touch_updated_at
  before update on public.user_tiles
  for each row execute function public.touch_user_tiles_updated_at();
