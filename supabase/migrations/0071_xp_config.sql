-- 0071_xp_config.sql
--
-- Creates the scalar-config table for the XP & leveling system. Every
-- tunable number in the XP economy (daily caps, soft-cap haircut, level
-- curve coefficients, revival fee, roll seed, etc.) lives here as a
-- jsonb value keyed by string. Code reads via a short-lived cache in
-- award_xp(); admins tweak values with one UPDATE instead of a
-- migration + redeploy cycle.
--
-- This is the FIRST of the XP config tables. Later migrations add:
--   0072 xp_source_values, 0073 xp_streak_tiers, 0074 xp_curated_ladder,
--   0075 xp_rarity_rolls, 0076 xp_badge_tier_xp, 0077 xp_level_titles,
--   0078 xp_config_audit (catches edits to all of the above).
--
-- See docs/plans/xp-leveling.md §6 for the full config-driven design.
--
-- Writes are admin-only (service role). Reads are open to all
-- authenticated users — the XP config is not sensitive, and the client
-- needs it to render toast copy and level thresholds.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_config (
  key          text         primary key,
  value        jsonb        not null,
  description  text,
  updated_at   timestamptz  not null default now(),
  updated_by   uuid         references auth.users(id)
);

-- ── 2. Row-level security ───────────────────────────────────────────
-- Read-all for authenticated users (client needs level curve + caps to
-- render UI). No direct write policy — mutations happen through a
-- SECURITY DEFINER RPC added in 0078 that also writes the audit log.

alter table public.xp_config enable row level security;

drop policy if exists "xp_config: read-all-authenticated" on public.xp_config;
create policy "xp_config: read-all-authenticated"
  on public.xp_config for select
  to authenticated
  using (true);

-- ── 3. Seed scalar values ───────────────────────────────────────────
-- Values mirror the defaults in docs/plans/xp-leveling.md. Changing any
-- of these later is an UPDATE (via the audit RPC), not a migration.

insert into public.xp_config (key, value, description) values
  ('daily_soft_cap',          '200'::jsonb,   'Raw daily XP above this threshold counts at soft_cap_haircut_pct. §4'),
  ('daily_hard_cap',          '400'::jsonb,   'Raw daily XP above this threshold is dropped entirely. §4'),
  ('soft_cap_haircut_pct',    '50'::jsonb,    'Percent (0-100) of XP retained when over the soft cap. §4'),
  ('xp_curve_coefficient',    '100'::jsonb,   'xp_to_next(L) = coefficient * L^exponent. §2'),
  ('xp_curve_exponent',       '1.6'::jsonb,   'Exponent in xp_to_next(L) formula. §2'),
  ('revival_fee',             '200'::jsonb,   'XP deducted to revive an expired streak. Never drops user below level floor. §3'),
  ('revival_cooldown_days',   '14'::jsonb,    'Minimum days between consecutive revivals per user. §3'),
  ('revival_window_hours',    '48'::jsonb,    'Hours after streak break during which revival is possible. §3'),
  ('revival_min_level',       '30'::jsonb,    'Minimum user level for streak insurance eligibility. §3'),
  ('streak_rollover_hour',    '4'::jsonb,     'Local-time hour (0-23) at which a new streak day begins. §3'),
  ('toast_beat_ms',           '700'::jsonb,   'Default per-beat duration for cook-complete toast choreography. §5'),
  ('toast_sequence_cap_ms',   '7000'::jsonb,  'Hard ceiling on toast sequence; overflow batches into "+N more bonuses" beat. §5'),
  ('config_cache_seconds',    '30'::jsonb,    'award_xp() in-transaction cache TTL for xp_config* tables. §6');
