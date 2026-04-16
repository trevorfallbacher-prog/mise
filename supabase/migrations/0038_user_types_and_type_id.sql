-- User-created IDENTIFIED-AS food types + type_id on pantry_items
-- and user_item_templates.
--
-- This is the semantic identity layer parallel to STORED IN (tiles):
--
--   IDENTIFIED AS  (type_id)  — what kind of thing it IS
--                              (Pizza, Cheese, Sausages, Pasta)
--   STORED IN      (tile_id)  — where it LIVES in the kitchen
--                              (Frozen Meals, Dairy, Pasta & Grains)
--
-- Bundled types come from WWEIA (src/data/foodTypes.js, chunk 18b) —
-- ~48 categories sourced from USDA's public-domain classifications.
-- User types in this table are family-shared additions that layer on
-- top for household-specific categorization ("in our house hot dogs
-- are sandwiches"). Same pattern as user_tiles from migration 0037.
--
-- Single-type, not multi-type:
--   We evaluated multi-type (type_ids TEXT[]) but landed on single.
--   USDA/WWEIA picks one category per food; we inherit that
--   discipline. Edge cases get their own user_type rather than
--   cluttering every item with 3 type tags. Drill-into-type stays
--   clean: "show me all my pizzas" returns exactly what you expect.
--
-- type_id is TEXT because it can hold either:
--   * A bundled WWEIA type id like 'wweia_pizza' (matches FOOD_TYPES
--     in src/data/foodTypes.js)
--   * A user_types.id uuid (user-created type)
-- The client discriminates by uuid-regex (same pattern we use for
-- tile_id).

-- ── 1. user_types table ─────────────────────────────────────────────

create table if not exists public.user_types (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,

  -- Display label preserved as typed.
  label             text        not null,

  -- Normalized for dedup lookups (lowercased + trimmed + internal
  -- whitespace collapsed). Unique per-user as a backstop; family-
  -- scoped uniqueness enforced application-side (same pattern as
  -- user_tiles / user_item_templates).
  label_normalized  text        not null,

  emoji             text        not null default '🏷️',

  -- Suggested STORED IN when the user picks this type. Optional —
  -- some types span multiple tiles (leftovers can live in any of
  -- fridge/freezer/pantry). Null = no suggestion, user picks the
  -- tile separately. Refers to either a bundled tile id slug or
  -- a user_tiles.id uuid — client discriminates by uuid-regex.
  default_tile_id   text        null,

  -- Optional location hint (fridge|pantry|freezer). Paired with
  -- default_tile_id for "when this type is picked, suggest this
  -- tile AND flip the tab to its location."
  default_location  text        null
                      check (default_location is null
                             or default_location in ('fridge','pantry','freezer')),

  -- Popularity tracking (future admin-promotion tier).
  use_count         integer     not null default 0,
  last_used_at      timestamptz null,
  promoted_at       timestamptz null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Backstop: one per user per normalized label. Family-scoped dedup
-- is application-level.
create unique index if not exists user_types_user_label_uq
  on public.user_types (user_id, label_normalized);

-- Picker hot path.
create index if not exists user_types_user_recency_idx
  on public.user_types (user_id, last_used_at desc nulls last);

-- ── 2. RLS (family-shared, parallels user_tiles) ───────────────────

alter table public.user_types enable row level security;

drop policy if exists "user_types: family-select" on public.user_types;
create policy "user_types: family-select"
  on public.user_types for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid())))
;

drop policy if exists "user_types: family-insert" on public.user_types;
create policy "user_types: family-insert"
  on public.user_types for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid())))
;

drop policy if exists "user_types: family-update" on public.user_types;
create policy "user_types: family-update"
  on public.user_types for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid())))
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid())))
;

drop policy if exists "user_types: family-delete" on public.user_types;
create policy "user_types: family-delete"
  on public.user_types for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid())))
;

-- ── 3. Realtime publication ─────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_types'
  ) then
    alter publication supabase_realtime add table public.user_types;
  end if;
end $$;

-- ── 4. updated_at trigger ───────────────────────────────────────────

create or replace function public.touch_user_types_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_types_touch_updated_at on public.user_types;
create trigger user_types_touch_updated_at
  before update on public.user_types
  for each row execute function public.touch_user_types_updated_at();

-- ── 5. type_id on pantry_items + user_item_templates ───────────────
-- Plain TEXT column — can hold a bundled WWEIA id ('wweia_pizza') or
-- a user_types uuid. Client discriminates by uuid-regex same as
-- tile_id. No FK target because of this polymorphism — both are
-- valid references but to different tables.

alter table public.pantry_items
  add column if not exists type_id text null;

alter table public.user_item_templates
  add column if not exists type_id text null;

-- Query path: "show me all my pizzas" filters by type_id equality.
-- Partial indexes since most rows are null until users adopt the
-- type picker — tree stays small.
create index if not exists pantry_items_type_idx
  on public.pantry_items (user_id, type_id)
  where type_id is not null;

create index if not exists user_item_templates_type_idx
  on public.user_item_templates (user_id, type_id)
  where type_id is not null;
