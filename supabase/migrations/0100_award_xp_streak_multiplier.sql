-- 0100_award_xp_streak_multiplier.sql
--
-- Plugs the fire-mode streak multiplier into award_xp. Per §4 step 5,
-- the streak mult applies AFTER all cap logic — a 30-day-streak user
-- earns 2× what a day-2 user earns for the same raw effort, even if
-- both hit the same cap. Loyalty pays.
--
-- Reads profiles.streak_tier (kept current by the 0098 tick trigger)
-- and looks up the multiplier in xp_streak_tiers. The streak
-- multiplier is 1.00 for streak_revival (the debit path).
--
-- Ledger invariant evolution:
--   pre-0100: final_xp = base_xp + cap_adjustment
--   post-0100: final_xp = round((base_xp + cap_adjustment) * streak_mult)
--
-- So the existing cap_adjustment + streak_mult columns let a reader
-- reconstruct the exact math. The toast breakdown jsonb now returns
-- the pre-streak capped value separately (`after_caps`) so the UI
-- can animate the streak-mult beat distinctly from the prior beats.
--
-- See docs/plans/xp-leveling.md §4.

create or replace function public.award_xp(
  p_user_id        uuid,
  p_source         text,
  p_ref_table      text default null,
  p_ref_id         uuid default null,
  p_base_override  int  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base              int;
  v_raw               int;
  v_earned_today      int := 0;
  v_earned_this_ref   int := 0;
  v_headroom          int;
  v_micro_adj         int := 0;
  v_soft_adj          int := 0;
  v_hard_adj          int := 0;
  v_post_micro        int;
  v_after_caps        int;
  v_old_total         int := 0;
  v_daily_soft_cap    int;
  v_daily_hard_cap    int;
  v_haircut_pct       int;
  v_below_soft        int;
  v_between           int;
  v_above_hard        int;
  v_daily_exempt      boolean;
  v_streak_tier       smallint;
  v_streak_mult       numeric(4,2) := 1.00;
  v_final             int;
  v_day_local         date;
  v_tz                text;
  v_rollover_hour     int;
  v_event_id          uuid;
  v_source_row        public.xp_source_values%rowtype;
begin
  if p_user_id is null then
    raise exception 'award_xp: user_id is required';
  end if;

  select * into v_source_row
  from public.xp_source_values
  where source = p_source;

  if not found then
    raise exception 'award_xp: unknown source %', p_source;
  end if;

  select coalesce(timezone, 'UTC'), coalesce(streak_tier, 0)
    into v_tz, v_streak_tier
  from public.profiles where id = p_user_id;
  if v_tz is null then v_tz := 'UTC'; end if;

  select (value::text)::int into v_rollover_hour
  from public.xp_config where key = 'streak_rollover_hour';
  v_rollover_hour := coalesce(v_rollover_hour, 4);

  v_day_local := ((now() at time zone v_tz) - make_interval(hours => v_rollover_hour))::date;

  v_base := coalesce(p_base_override, v_source_row.base_xp);
  v_raw  := v_base;

  -- Per-source daily cap.
  if v_source_row.per_day_cap is not null then
    select coalesce(sum(final_xp), 0) into v_earned_today
    from public.xp_events
    where user_id = p_user_id and source = p_source and day_local = v_day_local;

    v_headroom := v_source_row.per_day_cap - v_earned_today;
    if v_headroom <= 0 then
      v_micro_adj := -v_raw;
    elsif v_raw > v_headroom then
      v_micro_adj := v_headroom - v_raw;
    end if;
  end if;

  -- Per-cook cap.
  if v_source_row.per_cook_cap is not null
     and p_ref_table = 'cook_logs' and p_ref_id is not null
  then
    select count(*) into v_earned_this_ref
    from public.xp_events
    where user_id = p_user_id and source = p_source
      and ref_table = 'cook_logs' and ref_id = p_ref_id;

    if v_earned_this_ref >= v_source_row.per_cook_cap then
      v_micro_adj := -v_raw;
    end if;
  end if;

  v_post_micro := v_raw + v_micro_adj;

  -- Daily soft / hard caps.
  v_daily_exempt := p_source like 'onboarding_%' or p_source = 'streak_revival';
  if not v_daily_exempt and v_post_micro > 0 then
    select (value::text)::int into v_daily_soft_cap from public.xp_config where key = 'daily_soft_cap';
    select (value::text)::int into v_daily_hard_cap from public.xp_config where key = 'daily_hard_cap';
    select (value::text)::int into v_haircut_pct    from public.xp_config where key = 'soft_cap_haircut_pct';

    select coalesce(sum(final_xp), 0) into v_old_total
    from public.xp_events
    where user_id = p_user_id and day_local = v_day_local
      and source not like 'onboarding_%' and source <> 'streak_revival';

    v_below_soft := greatest(0, least(v_post_micro, v_daily_soft_cap - v_old_total));
    v_between    := greatest(0, least(
                      v_post_micro - v_below_soft,
                      v_daily_hard_cap - greatest(v_daily_soft_cap, v_old_total)));
    v_above_hard := v_post_micro - v_below_soft - v_between;

    v_soft_adj := -(v_between - (v_between * v_haircut_pct / 100));
    v_hard_adj := -v_above_hard;
  end if;

  v_after_caps := greatest(
    v_raw + v_micro_adj + v_soft_adj + v_hard_adj,
    case when p_source = 'streak_revival' then v_raw else 0 end
  );

  -- ── Streak multiplier (NEW in 0100, §4 step 5) ──────────────────
  -- Skip for streak_revival (the debit path) and for any zero-or-
  -- negative value (nothing to multiply).
  if p_source <> 'streak_revival' and v_after_caps > 0 then
    select coalesce(multiplier, 1.00) into v_streak_mult
    from public.xp_streak_tiers
    where tier_idx = v_streak_tier;
    v_streak_mult := coalesce(v_streak_mult, 1.00);
  end if;

  v_final := round(v_after_caps * v_streak_mult)::int;

  insert into public.xp_events (
    user_id, source, base_xp, curated_mult, cap_adjustment,
    streak_mult, final_xp, ref_table, ref_id, day_local
  ) values (
    p_user_id, p_source, v_base, 1.00,
    v_micro_adj + v_soft_adj + v_hard_adj, v_streak_mult,
    v_final, p_ref_table, p_ref_id, v_day_local
  )
  returning id into v_event_id;

  update public.profiles
     set total_xp = greatest(0, total_xp + v_final)
   where id = p_user_id;

  return jsonb_build_object(
    'event_id',       v_event_id,
    'source',         p_source,
    'base_xp',        v_base,
    'curated_mult',   1.00,
    'micro_cap_adj',  v_micro_adj,
    'soft_cap_adj',   v_soft_adj,
    'hard_cap_adj',   v_hard_adj,
    'cap_adjustment', v_micro_adj + v_soft_adj + v_hard_adj,
    'after_caps',     v_after_caps,
    'streak_tier',    v_streak_tier,
    'streak_mult',    v_streak_mult,
    'final_xp',       v_final,
    'day_local',      v_day_local
  );
end;
$$;
