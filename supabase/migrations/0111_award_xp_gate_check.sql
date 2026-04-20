-- 0111_award_xp_gate_check.sql
--
-- Final award_xp assembly — layers the gate hard-stop in front of
-- the ledger write. Per §2:
--
--   When a user is at a gate_level AND has not passed that gate,
--   all further XP earns are zeroed. The raw amount is recorded in
--   xp_events.gate_adjustment as a negative number for telemetry;
--   profiles.total_xp does NOT change. Missed XP is genuinely lost.
--
-- Edge case — boundary cross: if the current event's v_final would
-- bump level_from_xp past a gate_level the user hasn't passed, the
-- XP is CLAMPED to the amount that lands the user exactly at the
-- gate floor (end of level gate_level-1 + 1 XP). Prevents a user
-- from skipping a gate by earning a huge chunk in one cook. A new
-- user_gate_progress row with status='pending' is created so the
-- UI can light up the gate card.
--
-- Ordering is unchanged from 0106 (base → curated → micro-cap →
-- daily caps → streak); the gate check is a final gatekeeper
-- after streak_mult has applied.
--
-- streak_revival is exempt from the gate check — a revival is a
-- debit, and allowing the debit to fire inside a gate doesn't
-- un-block earning.
--
-- A small helper `xp_cumulative_to_level(L)` returns the cumulative
-- XP needed to reach exactly level L, used to compute the clamp
-- point. Memoized per-call via a local loop; levels max out around
-- 76 so the loop is cheap.
--
-- See docs/plans/xp-leveling.md §2 (level gates — hard XP stop).

-- ── Helper: cumulative XP required to reach level L ────────────────

create or replace function public.xp_cumulative_to_level(p_level int)
returns int
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_total int := 0;
  i int := 1;
begin
  if p_level is null or p_level <= 1 then
    return 0;
  end if;
  while i < p_level loop
    v_total := v_total + public.xp_to_next(i);
    i := i + 1;
  end loop;
  return v_total;
end;
$$;

grant execute on function public.xp_cumulative_to_level(int) to authenticated;

-- ── award_xp with gate check ───────────────────────────────────────

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
  v_curated_mult      numeric(4,2) := 1.00;
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
  v_recipe_cuisine    text;
  v_recipe_slug       text;
  v_lesson_count      int;
  -- gate check scratch
  v_current_total     int;
  v_current_level     int;
  v_would_be_total    int;
  v_would_be_level    int;
  v_gate              public.xp_level_gates%rowtype;
  v_gate_passed       boolean;
  v_gate_adjustment   int := 0;
  v_final_pre_gate    int;
  v_gate_floor        int;
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

  select coalesce(timezone, 'UTC'), coalesce(streak_tier, 0),
         coalesce(total_xp, 0), coalesce(level, 1)
    into v_tz, v_streak_tier, v_current_total, v_current_level
  from public.profiles where id = p_user_id;
  if v_tz is null then v_tz := 'UTC'; end if;

  select (value::text)::int into v_rollover_hour
  from public.xp_config where key = 'streak_rollover_hour';
  v_rollover_hour := coalesce(v_rollover_hour, 4);

  v_day_local := ((now() at time zone v_tz) - make_interval(hours => v_rollover_hour))::date;

  v_base := coalesce(p_base_override, v_source_row.base_xp);

  -- ── Curated ladder multiplier ───────────────────────────────────
  if not v_source_row.flat_bonus
     and p_ref_table = 'cook_logs'
     and p_ref_id is not null
  then
    select recipe_slug into v_recipe_slug
    from public.cook_logs where id = p_ref_id;

    if v_recipe_slug is not null then
      select cuisine into v_recipe_cuisine
      from public.curated_recipes
      where slug = v_recipe_slug
        and route_tags @> array['learn']::text[]
        and cuisine is not null;

      if v_recipe_cuisine is not null then
        select coalesce(lesson_count, 0) into v_lesson_count
        from public.user_curated_lessons
        where user_id = p_user_id and cuisine = v_recipe_cuisine;
        v_lesson_count := coalesce(v_lesson_count, 0);

        select coalesce(multiplier, 1.00) into v_curated_mult
        from public.xp_curated_ladder
        where min_lessons_in_cuisine <= v_lesson_count
        order by min_lessons_in_cuisine desc
        limit 1;
        v_curated_mult := coalesce(v_curated_mult, 1.00);
      end if;
    end if;
  end if;

  v_raw := round(v_base * v_curated_mult)::int;

  -- ── Micro-cap ───────────────────────────────────────────────────
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

  -- ── Daily soft / hard caps ──────────────────────────────────────
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

  -- ── Streak multiplier ───────────────────────────────────────────
  if p_source <> 'streak_revival' and v_after_caps > 0 then
    select coalesce(multiplier, 1.00) into v_streak_mult
    from public.xp_streak_tiers
    where tier_idx = v_streak_tier;
    v_streak_mult := coalesce(v_streak_mult, 1.00);
  end if;

  v_final := round(v_after_caps * v_streak_mult)::int;
  v_final_pre_gate := v_final;

  -- ── Gate check (NEW in 0111, §2 hard XP stop) ───────────────────
  -- streak_revival bypasses this entirely (it's a debit, not an earn).
  if p_source <> 'streak_revival' and v_final > 0 then
    v_would_be_total := v_current_total + v_final;
    v_would_be_level := public.level_from_xp(v_would_be_total);

    -- Look for a gate whose boundary we'd cross OR that we're already
    -- parked at. "Parked at a gate" = current_level == gate_level and
    -- user hasn't passed it — that happens after a previous event
    -- clamped to the floor.
    select * into v_gate
    from public.xp_level_gates
    where (v_current_level = gate_level and v_would_be_level >= gate_level)
       or (v_current_level < gate_level and v_would_be_level > gate_level)
    order by gate_level asc
    limit 1;

    if found then
      -- Has the user already passed this gate?
      select (status = 'passed') into v_gate_passed
      from public.user_gate_progress
      where user_id = p_user_id and gate_level = v_gate.gate_level;
      v_gate_passed := coalesce(v_gate_passed, false);

      if not v_gate_passed then
        v_gate_floor := public.xp_cumulative_to_level(v_gate.gate_level);
        -- Clamp final_xp so total lands at-or-before the gate floor's
        -- ceiling (first XP of the gate level = gate_floor). If we're
        -- already at/past the floor, final_xp becomes 0.
        if v_current_total >= v_gate_floor then
          v_final := 0;
        else
          v_final := greatest(0, v_gate_floor - v_current_total);
        end if;
        v_gate_adjustment := -(v_final_pre_gate - v_final);

        -- Ensure a user_gate_progress row exists so the UI lights up.
        insert into public.user_gate_progress (user_id, gate_level, status)
        values (p_user_id, v_gate.gate_level, 'pending')
        on conflict (user_id, gate_level) do nothing;
      end if;
    end if;
  end if;

  -- ── Ledger + total_xp ───────────────────────────────────────────

  insert into public.xp_events (
    user_id, source, base_xp, curated_mult, cap_adjustment,
    streak_mult, final_xp, ref_table, ref_id, day_local, gate_adjustment
  ) values (
    p_user_id, p_source, v_base, v_curated_mult,
    v_micro_adj + v_soft_adj + v_hard_adj, v_streak_mult,
    v_final, p_ref_table, p_ref_id, v_day_local, v_gate_adjustment
  )
  returning id into v_event_id;

  update public.profiles
     set total_xp = greatest(0, total_xp + v_final)
   where id = p_user_id;

  return jsonb_build_object(
    'event_id',        v_event_id,
    'source',          p_source,
    'base_xp',         v_base,
    'curated_mult',    v_curated_mult,
    'cuisine',         v_recipe_cuisine,
    'lesson_count',    coalesce(v_lesson_count, 0),
    'micro_cap_adj',   v_micro_adj,
    'soft_cap_adj',    v_soft_adj,
    'hard_cap_adj',    v_hard_adj,
    'cap_adjustment',  v_micro_adj + v_soft_adj + v_hard_adj,
    'after_caps',      v_after_caps,
    'streak_tier',     v_streak_tier,
    'streak_mult',     v_streak_mult,
    'gate_adjustment', v_gate_adjustment,
    'gated_at_level',  case when v_gate_adjustment < 0 then v_gate.gate_level else null end,
    'final_xp',        v_final,
    'day_local',       v_day_local
  );
end;
$$;
