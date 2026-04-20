-- 0099_shield_regen_fn.sql
--
-- Shield regeneration. Designed to be called daily (pg_cron job
-- configured out of band, or from a Supabase scheduled function).
-- Bumps each user's streak_shields toward their tier's shield_capacity
-- on the cadence defined by xp_streak_tiers.shield_regen_days.
--
-- Rules (from docs/plans/xp-leveling.md §3):
--   - Tier 0-1 (days 0-6): no shields; capacity = 0
--   - Tier 2  (7-13):      capacity = 1, regen 1 per 14 days
--   - Tier 3  (14-29):     capacity = 2, regen 1 per 7 days
--   - Tier 4  (30+):       capacity = 3, regen 1 per 7 days
--
-- Algorithm: count the days since the user last earned (or spent) a
-- shield. When that's ≥ shield_regen_days, award +1 (clamped at
-- capacity). Uses a per-user bookkeeping column
-- streak_shields_last_regen (added lazily below) so we don't
-- re-award the same shield on repeat invocations within the window.
--
-- Safe to run multiple times per day — the regen-window check makes
-- it idempotent.
--
-- See docs/plans/xp-leveling.md §3 (Shield schedule).

-- ── Bookkeeping column ──────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'streak_shields_last_regen'
  ) then
    alter table public.profiles
      add column streak_shields_last_regen timestamptz;
  end if;
end $$;

-- ── Regen function ──────────────────────────────────────────────────

create or replace function public.streak_shield_regen()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user        record;
  v_tier        public.xp_streak_tiers%rowtype;
  v_awarded_ct  integer := 0;
  v_days_since  integer;
begin
  for v_user in
    select id, streak_shields, streak_tier, streak_shields_last_regen
    from public.profiles
    where streak_tier > 0
  loop
    select * into v_tier
    from public.xp_streak_tiers
    where tier_idx = v_user.streak_tier;

    if v_tier.shield_capacity is null
       or v_tier.shield_capacity = 0
       or v_tier.shield_regen_days is null
       or v_user.streak_shields >= v_tier.shield_capacity
    then
      continue;
    end if;

    v_days_since := case
      when v_user.streak_shields_last_regen is null then v_tier.shield_regen_days
      else extract(day from now() - v_user.streak_shields_last_regen)::int
    end;

    if v_days_since < v_tier.shield_regen_days then
      continue;
    end if;

    update public.profiles
       set streak_shields            = least(streak_shields + 1, v_tier.shield_capacity),
           streak_shields_last_regen = now()
     where id = v_user.id;

    v_awarded_ct := v_awarded_ct + 1;
  end loop;

  return v_awarded_ct;
end;
$$;

grant execute on function public.streak_shield_regen() to service_role;
