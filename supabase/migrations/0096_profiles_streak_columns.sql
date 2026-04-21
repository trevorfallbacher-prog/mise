-- 0096_profiles_streak_columns.sql
--
-- Adds the five columns Fire Mode needs on profiles:
--
--   streak_shields               — int, count of shields held (0-3).
--                                  Shields auto-burn on a 1-day miss.
--   streak_peak                  — int, highest streak_count ever
--                                  reached. Powers the break tombstone
--                                  and the L30+ insurance revival floor.
--   streak_tier                  — smallint (0-4), denormalized for
--                                  fast multiplier lookup in award_xp
--                                  without re-computing from
--                                  streak_count each call.
--   streak_insurance_last_used   — timestamptz of the last revival.
--                                  Cooldown enforcer: revive RPC
--                                  refuses if this is within the last
--                                  revival_cooldown_days window.
--   timezone                     — text, IANA tz name ('America/
--                                  Los_Angeles' etc.). Required for
--                                  correct local-day rollover at
--                                  04:00 (xp_config.streak_rollover_hour).
--
-- Existing rows backfill to 'UTC' so the day_local math in the
-- upgraded award_xp (0097) still returns sensible dates until users
-- set their tz.
--
-- All columns are idempotent-add via information_schema guards.
--
-- See docs/plans/xp-leveling.md §3.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'streak_shields'
  ) then
    alter table public.profiles add column streak_shields int not null default 0;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'streak_peak'
  ) then
    alter table public.profiles add column streak_peak int not null default 0;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'streak_tier'
  ) then
    alter table public.profiles add column streak_tier smallint not null default 0;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'streak_insurance_last_used'
  ) then
    alter table public.profiles add column streak_insurance_last_used timestamptz;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'timezone'
  ) then
    alter table public.profiles add column timezone text not null default 'UTC';
  end if;
end $$;

-- Reconcile: streak_peak should be at least as high as current
-- streak_count for any row where a user was already mid-streak when
-- this migration runs.
update public.profiles
   set streak_peak = greatest(streak_peak, streak_count)
 where streak_count > streak_peak;
