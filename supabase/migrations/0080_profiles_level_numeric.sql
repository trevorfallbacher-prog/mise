-- 0080_profiles_level_numeric.sql
--
-- Adds the new numeric `profiles.level` column for the XP tier.
-- Separated from the rename (0079) so each change is individually
-- revertible and the collision between the old TEXT column and the
-- new int column never exists in a live database.
--
-- Default 1 matches the lowest tier in xp_level_titles (Apprentice,
-- L1-5). Not-null so client code can assume the column is always
-- populated — the value is recomputed from xp_events + xp_config
-- by award_xp() / the level-up trigger that ships later in Phase 4.
--
-- See docs/plans/xp-leveling.md §7 decision #1.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'level'
  )
  then
    alter table public.profiles
      add column level int not null default 1;
  end if;
end $$;
