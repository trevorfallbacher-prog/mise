-- 0101_streak_revive_rpc.sql
--
-- The L30+ streak-insurance revival flow. Once per
-- revival_cooldown_days, a user within revival_window_hours of
-- breaking their streak can pay revival_fee XP to restore the
-- broken streak at its previous value.
--
-- Three adds in this migration:
--
-- 1. Two profiles columns — streak_broken_peak (the streak_count
--    at the moment of break) and streak_broken_at (when the tick
--    reset fired). Populated by the updated streak_tick trigger.
--
-- 2. Updated streak_tick_fn that records those two columns when
--    it resets streak_count to 1. No other behavior change from
--    0098.
--
-- 3. streak_revive() SECURITY DEFINER RPC. Validates:
--      - caller == p_user_id (or service_role)
--      - profiles.level ≥ xp_config.revival_min_level (30)
--      - streak_broken_peak > 0 AND
--        now - streak_broken_at <= xp_config.revival_window_hours
--      - now - streak_insurance_last_used >= revival_cooldown_days
--        (or insurance never used)
--      - profiles.total_xp - revival_fee >= level_floor_xp(level)
--        (never drop a user below their current level's starting XP)
--    Then: awards source='streak_revival' with
--    p_base_override = -revival_fee (the only NEGATIVE-base award
--    in the system), restores streak_count to streak_broken_peak,
--    updates streak_insurance_last_used, clears the broken_* fields.
--
-- See docs/plans/xp-leveling.md §3 (Streak insurance).

-- ── 1. Columns ─────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'streak_broken_peak'
  ) then
    alter table public.profiles add column streak_broken_peak int not null default 0;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'streak_broken_at'
  ) then
    alter table public.profiles add column streak_broken_at timestamptz;
  end if;
end $$;

-- ── 2. Updated streak_tick — record break state on reset ───────────

create or replace function public.streak_tick_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev_date       date;
  v_prev_count      int;
  v_new_count       int;
  v_shields         int;
  v_peak            int;
  v_new_tier        smallint;
  v_is_reset        boolean := false;
begin
  if new.source = 'streak_revival' then
    return new;
  end if;

  select last_cooked_date, streak_count, streak_shields, streak_peak
    into v_prev_date, v_prev_count, v_shields, v_peak
  from public.profiles
  where id = new.user_id
  for update;

  if not found then
    return new;
  end if;

  if v_prev_date = new.day_local then
    return new;
  end if;

  if v_prev_date = (new.day_local - 1) then
    v_new_count := coalesce(v_prev_count, 0) + 1;
  elsif v_prev_date is null then
    v_new_count := 1;
  else
    if coalesce(v_shields, 0) > 0 then
      v_shields := v_shields - 1;
      v_new_count := coalesce(v_prev_count, 0) + 1;
    else
      v_new_count := 1;
      v_is_reset := true;
    end if;
  end if;

  select coalesce(max(tier_idx), 0) into v_new_tier
  from public.xp_streak_tiers
  where min_days <= v_new_count;

  update public.profiles
     set streak_count       = v_new_count,
         last_cooked_date   = new.day_local,
         streak_shields     = v_shields,
         streak_tier        = v_new_tier,
         streak_peak        = greatest(coalesce(v_peak, 0), v_new_count),
         streak_broken_peak = case when v_is_reset then coalesce(v_prev_count, 0) else streak_broken_peak end,
         streak_broken_at   = case when v_is_reset then now() else streak_broken_at end
   where id = new.user_id;

  return new;
exception when others then
  raise warning 'streak_tick_fn: %', sqlerrm;
  return new;
end;
$$;

-- ── 3. Revive RPC ──────────────────────────────────────────────────

create or replace function public.streak_revive(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller         uuid := auth.uid();
  v_target         uuid;
  v_profile        public.profiles%rowtype;
  v_fee            int;
  v_min_level      int;
  v_window_hours   int;
  v_cooldown_days  int;
  v_xp_curve_coef  int;
  v_xp_curve_exp   numeric;
  v_level_floor    int;
  v_event_result   jsonb;
begin
  v_target := coalesce(p_user_id, v_caller);
  if v_target is null then
    raise exception 'streak_revive: no target user';
  end if;
  if v_caller is not null and v_caller <> v_target then
    raise exception 'streak_revive: can only revive your own streak';
  end if;

  select * into v_profile from public.profiles where id = v_target for update;
  if not found then
    raise exception 'streak_revive: profile not found';
  end if;

  select (value::text)::int into v_fee           from public.xp_config where key = 'revival_fee';
  select (value::text)::int into v_min_level     from public.xp_config where key = 'revival_min_level';
  select (value::text)::int into v_window_hours  from public.xp_config where key = 'revival_window_hours';
  select (value::text)::int into v_cooldown_days from public.xp_config where key = 'revival_cooldown_days';
  select (value::text)::int into v_xp_curve_coef from public.xp_config where key = 'xp_curve_coefficient';
  select (value::text)::numeric into v_xp_curve_exp from public.xp_config where key = 'xp_curve_exponent';

  -- Level gate.
  if coalesce(v_profile.level, 1) < coalesce(v_min_level, 30) then
    return jsonb_build_object('ok', false, 'reason', 'level_too_low', 'level', v_profile.level);
  end if;

  -- Must have a recent break.
  if coalesce(v_profile.streak_broken_peak, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_broken_streak');
  end if;
  if v_profile.streak_broken_at is null
     or now() - v_profile.streak_broken_at > make_interval(hours => v_window_hours)
  then
    return jsonb_build_object('ok', false, 'reason', 'outside_window');
  end if;

  -- Cooldown.
  if v_profile.streak_insurance_last_used is not null
     and now() - v_profile.streak_insurance_last_used < make_interval(days => v_cooldown_days)
  then
    return jsonb_build_object('ok', false, 'reason', 'cooldown_active');
  end if;

  -- Level floor check: don't drop the user below the starting XP of
  -- their current level. Level L starts at cumulative sum of
  -- xp_to_next(1..L-1). For simplicity, approximate the floor as
  -- coef * (level-1)^exp (monotonic boundary close to the ledger
  -- accumulated value).
  v_level_floor := greatest(0, floor(v_xp_curve_coef * power(v_profile.level, v_xp_curve_exp)))::int
                 - coalesce(v_fee, 0);
  if v_profile.total_xp - coalesce(v_fee, 0) < v_level_floor then
    return jsonb_build_object('ok', false, 'reason', 'below_level_floor');
  end if;

  -- Award the negative-XP event (source='streak_revival' is exempt
  -- from caps in award_xp).
  v_event_result := public.award_xp(
    p_user_id       := v_target,
    p_source        := 'streak_revival',
    p_ref_table     := 'profiles',
    p_ref_id        := v_target,
    p_base_override := -coalesce(v_fee, 0)
  );

  -- Restore streak and clear the break marker.
  update public.profiles
     set streak_count               = streak_broken_peak,
         streak_tier                = (
           select coalesce(max(tier_idx), 0)
           from public.xp_streak_tiers
           where min_days <= v_profile.streak_broken_peak
         ),
         streak_broken_peak         = 0,
         streak_broken_at           = null,
         streak_insurance_last_used = now()
   where id = v_target;

  return jsonb_build_object(
    'ok',            true,
    'restored_to',   v_profile.streak_broken_peak,
    'fee',           v_fee,
    'event',         v_event_result
  );
end;
$$;

grant execute on function public.streak_revive(uuid) to authenticated;
