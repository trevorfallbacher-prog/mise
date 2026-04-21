-- 0085_award_xp_micro_caps.sql
--
-- Layers per-source micro-cap logic on top of the award_xp() stub
-- from 0084. Before writing the ledger row, the function now:
--
--   1. Checks per_day_cap on xp_source_values. If the user has
--      already earned ≥ per_day_cap XP from this source today
--      (summed from xp_events where day_local = today), final_xp
--      becomes 0 and cap_adjustment records the trim.
--   2. If per_day_cap would be breached BY this event, trims the
--      event down to the remaining headroom.
--   3. Checks per_cook_cap when ref_table = 'cook_logs' — caps
--      photo_upload at 2 per cook, etc.
--
-- Soft / hard daily totals still pass through unchanged at this
-- stage; those layer in via 0086.
--
-- Ledger invariant: cap_adjustment is always ≤ 0 (a negative
-- number or zero), and final_xp = base_xp + cap_adjustment
-- (multiplier = 1.00 until Phase 3/4). Clients reading the
-- breakdown can reconstruct the exact trim trail.
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
  v_base            int;
  v_raw             int;          -- base * curated_mult (curated deferred)
  v_earned_today    int := 0;
  v_earned_this_ref int := 0;
  v_headroom        int;
  v_cap_adjustment  int := 0;
  v_final           int;
  v_day_local       date := current_date;
  v_event_id        uuid;
  v_source_row      public.xp_source_values%rowtype;
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

  v_base := coalesce(p_base_override, v_source_row.base_xp);
  v_raw  := v_base;  -- curated multiplier lands in Phase 4

  -- ── Per-source daily cap ──────────────────────────────────────────
  if v_source_row.per_day_cap is not null then
    select coalesce(sum(final_xp), 0) into v_earned_today
    from public.xp_events
    where user_id   = p_user_id
      and source    = p_source
      and day_local = v_day_local;

    v_headroom := v_source_row.per_day_cap - v_earned_today;
    if v_headroom <= 0 then
      v_cap_adjustment := -v_raw;              -- fully capped out
    elsif v_raw > v_headroom then
      v_cap_adjustment := v_headroom - v_raw;  -- partial trim (negative)
    end if;
  end if;

  -- ── Per-cook cap (only when the event refs a cook_log) ────────────
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
      -- Already at the per-cook cap: zero out this event. The
      -- adjustment reflects the full raw value being dropped.
      v_cap_adjustment := -v_raw;
    end if;
  end if;

  v_final := greatest(0, v_raw + v_cap_adjustment);

  insert into public.xp_events (
    user_id, source, base_xp, curated_mult, cap_adjustment,
    streak_mult, final_xp, ref_table, ref_id, day_local
  ) values (
    p_user_id, p_source, v_base, 1.00, v_cap_adjustment, 1.00,
    v_final, p_ref_table, p_ref_id, v_day_local
  )
  returning id into v_event_id;

  update public.profiles
     set total_xp = total_xp + v_final
   where id = p_user_id;

  return jsonb_build_object(
    'event_id',       v_event_id,
    'source',         p_source,
    'base_xp',        v_base,
    'curated_mult',   1.00,
    'cap_adjustment', v_cap_adjustment,
    'streak_mult',    1.00,
    'final_xp',       v_final,
    'day_local',      v_day_local
  );
end;
$$;
