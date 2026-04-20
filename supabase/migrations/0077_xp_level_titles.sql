-- 0077_xp_level_titles.sql
--
-- Level → title range table. The UI shows the title alongside the
-- numeric level ("L12 · Home Chef"). Ranges are inclusive on both ends;
-- max_level is NULL for the open-ended top tier (Iron Chef).
--
-- See docs/plans/xp-leveling.md §2 (Level titles).

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_level_titles (
  min_level    int          primary key,
  max_level    int,
  title        text         not null,
  updated_at   timestamptz  not null default now(),
  updated_by   uuid         references auth.users(id)
);

-- ── 2. Row-level security ───────────────────────────────────────────

alter table public.xp_level_titles enable row level security;

drop policy if exists "xp_level_titles: read-all-authenticated" on public.xp_level_titles;
create policy "xp_level_titles: read-all-authenticated"
  on public.xp_level_titles for select
  to authenticated
  using (true);

-- ── 3. Seed ─────────────────────────────────────────────────────────

insert into public.xp_level_titles (min_level, max_level, title) values
  (1,  5,    'Apprentice'),
  (6,  10,   'Line Cook'),
  (11, 20,   'Home Chef'),
  (21, 35,   'Sous Chef'),
  (36, 50,   'Head Chef'),
  (51, 75,   'Executive Chef'),
  (76, null, 'Iron Chef');
