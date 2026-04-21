-- 0106_award_xp_curated_multiplier.sql
--
-- Final award_xp evolution — plugs the curated ladder multiplier in
-- BEFORE the cap math, per §4 step 2. Full ordering is now:
--
--   1. base_xp (from xp_source_values or override)
--   2. curated multiplier (new — reads xp_curated_ladder by the
--      user's lesson count in the cook's cuisine)
--   3. per-source micro-cap
--   4. daily soft/hard caps
--   5. streak multiplier (applied AFTER caps)
--   6. write ledger + increment total_xp
--
-- Curated multiplier fires only when ALL of:
--   - Source has flat_bonus=false in xp_source_values (cook_complete,
--     mastery_5x/10x/25x).
--   - ref_table = 'cook_logs' and ref_id is set.
--   - The cook_log's recipe_slug is in curated_recipes.
--   - That curated_recipes row has cuisine set AND route_tags
--     contains 'learn'.
--   - The user has a user_curated_lessons row for that cuisine
--     (always true once the counter trigger from 0105 has fired).
--
-- The multiplier comes from xp_curated_ladder — row with
-- min_lessons_in_cuisine = max( ≤ user's lesson count in that cuisine).
--
-- Note on ordering with 0105: that trigger fires on cook_logs INSERT
-- BEFORE the client calls award_xp, so by the time this function
-- reads user_curated_lessons the current cook is already counted —
-- the 5th Italian cook sees count=5 and earns 1.75× (the tier
-- transition it earned).
--
-- See docs/plans/xp-leveling.md §2 + §4.

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

  -- ── Curated ladder multiplier (§4 step 2) ───────────────────────
  -- Only applies to non-flat-bonus sources referencing a cook_log
  -- that hangs off a curated-learn recipe with a cuisine tag.
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

  -- ── Per-source daily cap ────────────────────────────────────────
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

  insert into public.xp_events (
    user_id, source, base_xp, curated_mult, cap_adjustment,
    streak_mult, final_xp, ref_table, ref_id, day_local
  ) values (
    p_user_id, p_source, v_base, v_curated_mult,
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
    'curated_mult',   v_curated_mult,
    'cuisine',        v_recipe_cuisine,
    'lesson_count',   coalesce(v_lesson_count, 0),
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
