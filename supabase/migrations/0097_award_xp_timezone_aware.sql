-- 0097_award_xp_timezone_aware.sql
--
-- Replaces the current UTC-date placeholder in award_xp() (seeded
-- in 0084 / 0085 / 0086) with proper per-user local-day math. The
-- rollover hour comes from xp_config.streak_rollover_hour (default
-- 4) so late-night cooks still count toward the right day — a cook
-- at 02:30 local belongs to the PREVIOUS calendar day.
--
-- Algorithm:
--   local_now    = now() at profiles.timezone
--   offset_hour  = xp_config.streak_rollover_hour  (integer 0-23)
--   day_local    = (local_now - offset_hour hours)::date
--
-- Falls back to UTC if the user has no tz (shouldn't happen post-0096
-- since the default is 'UTC', but belt-and-suspenders).
--
-- Everything else in award_xp (cap logic, ledger write, total_xp
-- bump) stays exactly as 0086 — this migration ONLY swaps the
-- v_day_local assignment.
--
-- See docs/plans/xp-leveling.md §3 (timezone + rollover) and §4
-- (award_xp ordering).

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
  v_old_total         int := 0;
  v_daily_soft_cap    int;
  v_daily_hard_cap    int;
  v_haircut_pct       int;
  v_below_soft        int;
  v_between           int;
  v_above_hard        int;
  v_daily_exempt      boolean;
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

  -- Per-user timezone + global rollover-hour → local day bucket.
  select coalesce(timezone, 'UTC') into v_tz
  from public.profiles where id = p_user_id;
  if v_tz is null then v_tz := 'UTC'; end if;

  select (value::text)::int into v_rollover_hour
  from public.xp_config where key = 'streak_rollover_hour';
  v_rollover_hour := coalesce(v_rollover_hour, 4);

  v_day_local := ((now() at time zone v_tz) - make_interval(hours => v_rollover_hour))::date;

  v_base := coalesce(p_base_override, v_source_row.base_xp);
  v_raw  := v_base;

  if v_source_row.per_day_cap is not null then
    select coalesce(sum(final_xp), 0) into v_earned_today
    from public.xp_events
    where user_id   = p_user_id
      and source    = p_source
      and day_local = v_day_local;

    v_headroom := v_source_row.per_day_cap - v_earned_today;
    if v_headroom <= 0 then
      v_micro_adj := -v_raw;
    elsif v_raw > v_headroom then
      v_micro_adj := v_headroom - v_raw;
    end if;
  end if;

  if v_source_row.per_cook_cap is not null
     and p_ref_table = 'cook_logs'
     and p_ref_id is not null
  then
    select count(*) into v_earned_this_ref
    from public.xp_events
    where user_id   = p_user_id
      and source    = p_source
      and ref_table = 'cook_logs'
      and ref_id    = p_ref_id;

    if v_earned_this_ref >= v_source_row.per_cook_cap then
      v_micro_adj := -v_raw;
    end if;
  end if;

  v_post_micro := v_raw + v_micro_adj;

  v_daily_exempt := p_source like 'onboarding_%' or p_source = 'streak_revival';

  if not v_daily_exempt and v_post_micro > 0 then
    select (value::text)::int into v_daily_soft_cap
      from public.xp_config where key = 'daily_soft_cap';
    select (value::text)::int into v_daily_hard_cap
      from public.xp_config where key = 'daily_hard_cap';
    select (value::text)::int into v_haircut_pct
      from public.xp_config where key = 'soft_cap_haircut_pct';

    select coalesce(sum(final_xp), 0) into v_old_total
    from public.xp_events
    where user_id   = p_user_id
      and day_local = v_day_local
      and source    not like 'onboarding_%'
      and source    <> 'streak_revival';

    v_below_soft := greatest(0, least(v_post_micro, v_daily_soft_cap - v_old_total));
    v_between    := greatest(
                      0,
                      least(
                        v_post_micro - v_below_soft,
                        v_daily_hard_cap - greatest(v_daily_soft_cap, v_old_total)
                      )
                    );
    v_above_hard := v_post_micro - v_below_soft - v_between;

    v_soft_adj := -(v_between - (v_between * v_haircut_pct / 100));
    v_hard_adj := -v_above_hard;
  end if;

  v_final := greatest(
    v_raw + v_micro_adj + v_soft_adj + v_hard_adj,
    case when p_source = 'streak_revival' then v_raw else 0 end
  );

  insert into public.xp_events (
    user_id, source, base_xp, curated_mult, cap_adjustment,
    streak_mult, final_xp, ref_table, ref_id, day_local
  ) values (
    p_user_id, p_source, v_base, 1.00,
    v_micro_adj + v_soft_adj + v_hard_adj, 1.00,
    v_final, p_ref_table, p_ref_id, v_day_local
  )
  returning id into v_event_id;

  update public.profiles
     set total_xp = greatest(0, total_xp + v_final)
   where id = p_user_id;

  return jsonb_build_object(
    'event_id',          v_event_id,
    'source',            p_source,
    'base_xp',           v_base,
    'curated_mult',      1.00,
    'micro_cap_adj',     v_micro_adj,
    'soft_cap_adj',      v_soft_adj,
    'hard_cap_adj',      v_hard_adj,
    'cap_adjustment',    v_micro_adj + v_soft_adj + v_hard_adj,
    'streak_mult',       1.00,
    'final_xp',          v_final,
    'day_local',         v_day_local
  );
end;
$$;
