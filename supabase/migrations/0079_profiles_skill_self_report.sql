-- 0079_profiles_skill_self_report.sql
--
-- Renames the legacy TEXT column `profiles.level` (values: 'beginner'
-- | 'intermediate' | 'advanced' — what the user told us about
-- themselves during onboarding) to `profiles.skill_self_report`,
-- freeing the name `level` for the numeric XP tier that lands in the
-- next migration.
--
-- Every read site of the old column is updated in the SAME commit:
--   src/App.jsx            write path during onboarding upsert
--   src/lib/aiContext.js   read → outgoing AI payload (wire field
--                          stays `level` so generate-recipe edge
--                          function is unchanged)
--   src/components/Home.jsx ProfilePill read
--
-- The column declaration originated in 0001_init.sql. No RPCs, no
-- RLS policies, no triggers referenced the column — scan confirmed.
-- Values are preserved as-is; the rename is pure metadata.
--
-- Idempotency: wrapped in a DO block that checks information_schema
-- so re-runs after the rename don't error. Handles the "already
-- renamed" case silently.
--
-- See docs/plans/xp-leveling.md §7 decision #1.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'level'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'skill_self_report'
  )
  then
    alter table public.profiles
      rename column level to skill_self_report;
  end if;
end $$;
