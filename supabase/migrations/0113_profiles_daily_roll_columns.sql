-- 0113_profiles_daily_roll_columns.sql
--
-- Adds the two bookkeeping columns for the once-per-day scratch-card
-- roll (§4 daily roll). Mentioned in §6 scaffolding #7, deferred to
-- Phase 6 to land alongside the RPC + client surface.
--
--   daily_roll_date    — date, the local-day bucket the user last
--                        rolled in. The RPC (0114) compares this
--                        against the caller's local day to decide
--                        whether a fresh roll is allowed.
--   daily_roll_result  — jsonb snapshot of the last roll's row from
--                        xp_rarity_rolls plus the awarded XP. Shape:
--                        { rarity, xp_reward, cosmetic_flair,
--                          flair_hours, rolled_at }. The client
--                        reads this to render the "already rolled"
--                        compact badge and the 24h avatar flair.
--
-- Both columns are nullable — a fresh account has never rolled, so
-- both stay null until the first tap. Idempotent add via
-- information_schema guards so re-runs stay safe.
--
-- See docs/plans/xp-leveling.md §4 (daily login roll).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'daily_roll_date'
  ) then
    alter table public.profiles add column daily_roll_date date;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'daily_roll_result'
  ) then
    alter table public.profiles add column daily_roll_result jsonb;
  end if;
end $$;
