-- 0075_xp_rarity_rolls.sql
--
-- Daily-roll reward table. On each user's first tracked action of the
-- local day, a server-side RNG picks a row weighted by weight_pct, and
-- the scratch-card animation reveals it. Purely additive bonus XP plus
-- an optional cosmetic flair for Epic rolls.
--
-- Weights must sum to 100. Enforced by a CHECK on the sum is tricky in
-- standard Postgres (no easy cross-row constraint), so we rely on the
-- audit RPC (0078) to reject writes that would break the invariant.
--
-- See docs/plans/xp-leveling.md §4 for the daily-roll spec.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_rarity_rolls (
  rarity          text         primary key,
  weight_pct      smallint     not null check (weight_pct between 0 and 100),
  xp_reward       int          not null,
  cosmetic_flair  text,
  flair_hours     int,
  description     text,
  updated_at      timestamptz  not null default now(),
  updated_by      uuid         references auth.users(id)
);

-- ── 2. Row-level security ───────────────────────────────────────────

alter table public.xp_rarity_rolls enable row level security;

drop policy if exists "xp_rarity_rolls: read-all-authenticated" on public.xp_rarity_rolls;
create policy "xp_rarity_rolls: read-all-authenticated"
  on public.xp_rarity_rolls for select
  to authenticated
  using (true);

-- ── 3. Seed ─────────────────────────────────────────────────────────
-- Weights sum to 100.

insert into public.xp_rarity_rolls (rarity, weight_pct, xp_reward, cosmetic_flair, flair_hours, description) values
  ('common',   70,   5, null,              null, 'Baseline daily nudge.'),
  ('uncommon', 20,  15, null,              null, 'Modest boost.'),
  ('rare',      8,  50, null,              null, 'Nice find.'),
  ('epic',      2, 150, 'avatar_sparkle',  24,   'Gradient border + sparkle particles on profile avatar for 24h.');
