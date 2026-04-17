-- 0047_pending_ingredient_info.sql
--
-- On-demand AI enrichment of ingredient metadata.
--
-- Before this migration, ingredient metadata (description, storage,
-- substitutions, nutrition, etc.) lived in exactly two places:
--
--   * bundled into the JS `INGREDIENT_INFO` object in src/data/ingredients.js
--   * the `ingredient_info` JSONB table (migration 0028), seeded from
--     src/data/seedIngredientInfo.js for ~32 canonicals
--
-- The other ~150 canonical ingredients plus every user-added custom
-- pantry item ("Nori from the Japanese store") had zero metadata and
-- no path to get any, short of a human hand-editing a 5000-line JS file.
--
-- New flow: the user clicks "Add AI Enrichment" on an item with empty
-- metadata. An edge function (supabase/functions/enrich-ingredient) asks
-- Claude Haiku to fill in the full JSONB shape and writes the result
-- here as a `pending` row. The user's card immediately renders the
-- pending metadata (resolver falls through: canonical → JS fallback →
-- this table), and the bell rings via the notifications system.
--
-- An admin later reviews pending rows in AdminPanel, optionally edits
-- the JSONB, then promotes the approved row into the canonical
-- `ingredient_info` table with a clean canonical ingredient_id
-- (possibly mapped to an existing one — "Nori from..." → canonical `nori`).
--
-- ROW SCOPE: per-user. No family sharing for drafts — if a family wants
-- to share metadata, admin approval promotes it to the global table.
-- Admins get cross-user SELECT / UPDATE via additive policies at the
-- bottom.
--
-- Tightens `ingredient_info` write policy at the same time: previously
-- any authenticated user could upsert any row (migration 0028 set the
-- write policy to `auth.uid() is not null`). Now that we have an actual
-- admin approval flow, writes are restricted to admins. This is a small
-- security tightening — before this the seeder technically bypassed
-- approval, but in practice it only ever inserted known-good rows.
--
-- Safe to re-run.

-- ── 1. pending_ingredient_info table ───────────────────────────────
create table if not exists public.pending_ingredient_info (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  slug           text        not null,  -- slugified from source_name, e.g. "nori_from_the_japanese_store"
  source_name    text        not null,  -- user's raw input, preserved for audit
  pantry_item_id uuid                 references public.pantry_items(id) on delete set null,
  info           jsonb       not null default '{}'::jsonb,
  status         text        not null default 'pending'
                             check (status in ('pending', 'approved', 'rejected')),
  rejection_note text,
  approved_canonical_id text,  -- filled in when admin approves and maps to a canonical id
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, slug)
);

-- ── 2. indexes ─────────────────────────────────────────────────────
create index if not exists pending_ingredient_info_user_idx
  on public.pending_ingredient_info (user_id);

create index if not exists pending_ingredient_info_status_idx
  on public.pending_ingredient_info (status)
  where status = 'pending';

create index if not exists pending_ingredient_info_pantry_item_idx
  on public.pending_ingredient_info (pantry_item_id)
  where pantry_item_id is not null;

-- ── 3. updated_at trigger ─────────────────────────────────────────
-- Reuses the touch_updated_at function defined alongside ingredient_info
-- in migration 0028.
drop trigger if exists pending_ingredient_info_touch_updated_at
  on public.pending_ingredient_info;
create trigger pending_ingredient_info_touch_updated_at
  before update on public.pending_ingredient_info
  for each row execute function public.touch_updated_at();

-- ── 4. RLS — self-only for regular users, admin bypass ────────────
alter table public.pending_ingredient_info enable row level security;

drop policy if exists "pending_ingredient_info: self-all"
  on public.pending_ingredient_info;
create policy "pending_ingredient_info: self-all"
  on public.pending_ingredient_info for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admins can read every pending row (for the AdminPanel queue view).
drop policy if exists "pending_ingredient_info: admin-select"
  on public.pending_ingredient_info;
create policy "pending_ingredient_info: admin-select"
  on public.pending_ingredient_info for select
  using (public.is_admin());

-- Admins can update any row (to approve / reject / edit JSONB inline).
-- Regular users already have update via the self-all policy above —
-- this is additive so admins can flip status on another user's draft.
drop policy if exists "pending_ingredient_info: admin-update"
  on public.pending_ingredient_info;
create policy "pending_ingredient_info: admin-update"
  on public.pending_ingredient_info for update
  using (public.is_admin())
  with check (public.is_admin());

-- ── 5. realtime ───────────────────────────────────────────────────
-- Lets the client see pending rows appear / flip to approved without
-- a manual refetch — the IngredientCard's resolver benefits, and so
-- does the AdminPanel queue.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pending_ingredient_info'
  ) then
    alter publication supabase_realtime add table public.pending_ingredient_info;
  end if;
end $$;

-- ── 6. tighten ingredient_info write policy ────────────────────────
-- Migration 0028 set write access to any authenticated user, which was
-- fine when the only writer was the seed upserter. Now that we have
-- an admin approval flow, only admins should be writing to the
-- canonical table directly. Drop the old permissive policy and
-- replace with admin-only. (Existing admins continue to work; the
-- seeder runs at login but only inserts rows that match the bundled
-- SEED_INGREDIENT_INFO which an admin implicitly authored.)
--
-- NB: the seeder in src/lib/seedIngredientInfo.js still runs for every
-- logged-in user on version bumps. After this migration its upserts
-- will silently no-op for non-admins (RLS will reject the writes).
-- That's the correct behavior — the seed data is already present from
-- the first admin login, and non-admins never needed to re-seed.

drop policy if exists "ingredient_info: auth-write"
  on public.ingredient_info;

drop policy if exists "ingredient_info: admin-write"
  on public.ingredient_info;
create policy "ingredient_info: admin-write"
  on public.ingredient_info for all
  using (public.is_admin())
  with check (public.is_admin());

-- ── 7. schema cache reload ─────────────────────────────────────────
notify pgrst, 'reload schema';
