-- 0087_badges_tier_expansion.sql
--
-- Expands the CHECK constraint on badges.tier to accept the target
-- rarity names (common / uncommon / rare / legendary) alongside the
-- legacy names (standard / bronze / silver / gold) already stored on
-- existing rows. Phase 2 of the XP rollout fires award_xp on badge
-- earn via a tier → xp_reward lookup in xp_badge_tier_xp, which
-- already seeds BOTH naming sets (migration 0076). This migration
-- just stops new badge inserts from failing if product chooses the
-- target names going forward.
--
-- No data remap: existing rows with tier='standard' etc. keep their
-- values. The eventual per-badge remap (if any) is a product
-- decision tracked in docs/plans/xp-leveling.md §7 open question
-- #2.
--
-- Idempotent via a pg_constraint check so re-runs don't error.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'badges_tier_check'
      and conrelid = 'public.badges'::regclass
  ) then
    alter table public.badges drop constraint badges_tier_check;
  end if;

  alter table public.badges
    add constraint badges_tier_check
    check (tier in (
      'standard', 'bronze', 'silver', 'gold',
      'common',   'uncommon', 'rare',  'legendary'
    ));
end $$;
