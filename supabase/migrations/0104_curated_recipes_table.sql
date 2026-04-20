-- 0104_curated_recipes_table.sql
--
-- Reference table that tells award_xp which recipe slugs qualify
-- for the 1.5×→3× curated multiplier (§2). A slug is "curated"
-- when it was hand-authored into the learn track by the content
-- team — not every bundled recipe qualifies (some are pure plan
-- route), and user-authored recipes are never curated by default.
--
-- Columns:
--   slug         — matches cook_logs.recipe_slug. PK.
--   cuisine      — 'italian', 'asian', 'american', etc. Drives
--                  the per-cuisine lesson count that walks the
--                  1.5×→3× ladder.
--   route_tags   — full route array from src/data/recipes/*.js
--                  (e.g. ['plan', 'learn']). Only slugs whose
--                  route_tags include 'learn' receive the
--                  multiplier; others just live here as metadata
--                  for future use.
--   collection   — optional curated-collection grouping (e.g.
--                  'italian-basics'). Powers the +500 set-complete
--                  and +1000 collection-master bonuses (§1).
--   created_at / updated_at
--
-- Seed is empty by design — populated by
-- scripts/seed_curated_recipes.js which reads the bundled recipe
-- files at runtime. Keeps the migration idempotent and free of
-- brittle hard-coded slug lists.
--
-- Readable by authenticated users (client needs to know whether
-- a recipe qualifies so it can pre-render "this cook earns the
-- curated multiplier" copy). Writes through the audit RPC pattern,
-- same as the other xp_config* tables, so changes are logged.
--
-- See docs/plans/xp-leveling.md §2, §7 open #3 (cuisine tag
-- completeness).

create table if not exists public.curated_recipes (
  slug         text         primary key,
  cuisine      text,
  route_tags   text[]       not null default '{}'::text[],
  collection   text,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now(),
  updated_by   uuid         references auth.users(id)
);

create index if not exists curated_recipes_cuisine_idx
  on public.curated_recipes (cuisine);

create index if not exists curated_recipes_collection_idx
  on public.curated_recipes (collection)
  where collection is not null;

alter table public.curated_recipes enable row level security;

drop policy if exists "curated_recipes: read-all-authenticated" on public.curated_recipes;
create policy "curated_recipes: read-all-authenticated"
  on public.curated_recipes for select
  to authenticated
  using (true);

-- Touch updated_at on edits.
drop trigger if exists curated_recipes_touch_updated_at on public.curated_recipes;
create trigger curated_recipes_touch_updated_at
  before update on public.curated_recipes
  for each row execute function public.touch_updated_at();

-- Audit trigger: log every mutation into xp_config_audit (attached
-- in 0078) so changes to the curated set stay traceable.
drop trigger if exists curated_recipes_audit_trg on public.curated_recipes;
create trigger curated_recipes_audit_trg
  after insert or update or delete on public.curated_recipes
  for each row execute function public.xp_config_audit_fn('slug');
