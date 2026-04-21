-- 0073_xp_streak_tiers.sql
--
-- Fire-mode streak tiers: the multiplier applied AFTER anti-grind caps
-- (so loyalty pays at equal effort), plus the per-tier shield capacity,
-- regen cadence, and visual intensity the client uses to render the
-- flame stack.
--
-- One row per tier (0..4). award_xp() looks up the active tier by
-- profiles.streak_count falling into [min_days, next tier's min_days).
-- The denormalized profiles.streak_tier (migration in Phase 3) lets
-- hot paths skip the lookup.
--
-- See docs/plans/xp-leveling.md §3 for the schedule + visual spec.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_streak_tiers (
  tier_idx            smallint     primary key,
  min_days            int          not null,
  multiplier          numeric(4,2) not null,
  shield_capacity     smallint     not null default 0,
  shield_regen_days   int,
  flame_count         smallint     not null default 0,
  particle_intensity  smallint     not null default 0,
  label               text,
  updated_at          timestamptz  not null default now(),
  updated_by          uuid         references auth.users(id)
);

-- ── 2. Row-level security ───────────────────────────────────────────

alter table public.xp_streak_tiers enable row level security;

drop policy if exists "xp_streak_tiers: read-all-authenticated" on public.xp_streak_tiers;
create policy "xp_streak_tiers: read-all-authenticated"
  on public.xp_streak_tiers for select
  to authenticated
  using (true);

-- ── 3. Seed ─────────────────────────────────────────────────────────
-- particle_intensity is a 0-3 hint the client maps to specific effect
-- presets (none, soft halo, strong halo, full field + gradient).

insert into public.xp_streak_tiers
  (tier_idx, min_days, multiplier, shield_capacity, shield_regen_days, flame_count, particle_intensity, label) values
  (0, 0,  1.00, 0, null, 0, 0, 'No streak'),
  (1, 3,  1.20, 0, null, 1, 1, 'Single flame'),
  (2, 7,  1.50, 1, 14,   2, 2, 'Two flames'),
  (3, 14, 1.75, 2, 7,    3, 2, 'Three flames'),
  (4, 30, 2.00, 3, 7,    4, 3, 'Four flames (max)');
