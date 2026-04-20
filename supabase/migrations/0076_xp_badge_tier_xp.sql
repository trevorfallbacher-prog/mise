-- 0076_xp_badge_tier_xp.sql
--
-- Maps each badge rarity tier to the XP awarded when a user earns that
-- badge. Read by the badge-award hook (scaffolded in Phase 2) which
-- calls award_xp(source='badge_earn', base = lookup(tier)).
--
-- Tier naming matches the target set from docs/plans/xp-leveling.md §7
-- open question #2 (common / uncommon / rare / legendary). The
-- badges.tier CHECK constraint is still the legacy
-- ('standard','bronze','silver','gold') at this point — the remap
-- happens in a later migration once the product decision lands.
-- Both namings are seeded here so the hook works either way.
--
-- See docs/plans/xp-leveling.md §1 (Badges block) + §7.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_badge_tier_xp (
  tier         text         primary key,
  xp_reward    int          not null,
  description  text,
  updated_at   timestamptz  not null default now(),
  updated_by   uuid         references auth.users(id)
);

-- ── 2. Row-level security ───────────────────────────────────────────

alter table public.xp_badge_tier_xp enable row level security;

drop policy if exists "xp_badge_tier_xp: read-all-authenticated" on public.xp_badge_tier_xp;
create policy "xp_badge_tier_xp: read-all-authenticated"
  on public.xp_badge_tier_xp for select
  to authenticated
  using (true);

-- ── 3. Seed ─────────────────────────────────────────────────────────
-- Both legacy and target tier names map to the same reward schedule so
-- the hook works before and after the remap.

insert into public.xp_badge_tier_xp (tier, xp_reward, description) values
  ('common',    50,  'Target tier name (post-remap).'),
  ('uncommon', 100,  'Target tier name (post-remap).'),
  ('rare',     250,  'Target tier name (post-remap).'),
  ('legendary', 500, 'Target tier name (post-remap).'),
  ('standard',  50,  'Legacy tier name (pre-remap) — maps to common.'),
  ('bronze',   100,  'Legacy tier name (pre-remap) — maps to uncommon.'),
  ('silver',   250,  'Legacy tier name (pre-remap) — maps to rare.'),
  ('gold',     500,  'Legacy tier name (pre-remap) — maps to legendary.');
