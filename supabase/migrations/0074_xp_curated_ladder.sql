-- 0074_xp_curated_ladder.sql
--
-- Curated-recipe multiplier ladder. Per-user, per-cuisine depth of
-- engagement in the "learn" route scales the cook-complete base XP
-- from 1.5× up to 3.0×. Non-curated cooks (AI / custom) stay at 1.0×
-- and never touch this table.
--
-- One row per rung. award_xp() counts the user's completed curated
-- cooks in the ref recipe's cuisine, then picks the row with the
-- largest min_lessons_in_cuisine ≤ that count.
--
-- See docs/plans/xp-leveling.md §2 for the full ladder spec.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_curated_ladder (
  min_lessons_in_cuisine  int          primary key,
  multiplier              numeric(4,2) not null,
  label                   text,
  updated_at              timestamptz  not null default now(),
  updated_by              uuid         references auth.users(id)
);

-- ── 2. Row-level security ───────────────────────────────────────────

alter table public.xp_curated_ladder enable row level security;

drop policy if exists "xp_curated_ladder: read-all-authenticated" on public.xp_curated_ladder;
create policy "xp_curated_ladder: read-all-authenticated"
  on public.xp_curated_ladder for select
  to authenticated
  using (true);

-- ── 3. Seed ─────────────────────────────────────────────────────────
-- min_lessons is INCLUSIVE start of each rung; the ladder is stepwise.

insert into public.xp_curated_ladder (min_lessons_in_cuisine, multiplier, label) values
  (1,  1.50, 'Beginner (1-4 lessons)'),
  (5,  1.75, 'Apprentice (5-9 lessons)'),
  (10, 2.00, 'Journeyman (10-14 lessons)'),
  (15, 2.50, 'Adept (15-19 lessons)'),
  (20, 3.00, 'Master (20+ lessons, max)');
