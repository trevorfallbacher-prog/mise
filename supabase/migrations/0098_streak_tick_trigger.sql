-- 0098_streak_tick_trigger.sql
--
-- Fires after every xp_events INSERT (except streak_revival) and
-- runs the streak state machine:
--
--   - No-op if the user already streaked today (last_cooked_date
--     == new.day_local)
--   - Increment streak_count if last_cooked_date == day_local - 1
--     (consecutive day)
--   - On a 1-day-or-more gap:
--       * If streak_shields > 0: burn a shield, still increment
--       * Else: reset streak_count to 1
--   - Always update last_cooked_date, recompute streak_tier from
--     xp_streak_tiers, and bump streak_peak to max(peak, new_count)
--
-- Dedup within a day: the last_cooked_date == day_local guard
-- means 10 scans on the same day still count as ONE streak day.
--
-- Trigger runs SECURITY DEFINER because it writes to profiles
-- regardless of which user is the xp_events row owner (the RPC
-- already has authority; this trigger is downstream of that).
--
-- streak_revival events are explicitly skipped — those are the
-- inverse operation (burn XP to un-break), not a streak day.
--
-- See docs/plans/xp-leveling.md §3.

create or replace function public.streak_tick_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev_date    date;
  v_new_count    int;
  v_shields      int;
  v_peak         int;
  v_new_tier     smallint;
begin
  -- streak_revival is the undo path; does not count as a streak day.
  if new.source = 'streak_revival' then
    return new;
  end if;

  select last_cooked_date, streak_count, streak_shields, streak_peak
    into v_prev_date, v_new_count, v_shields, v_peak
  from public.profiles
  where id = new.user_id
  for update;

  if not found then
    return new;
  end if;

  -- Already counted today → no-op.
  if v_prev_date = new.day_local then
    return new;
  end if;

  -- State machine.
  if v_prev_date = (new.day_local - 1) then
    v_new_count := coalesce(v_new_count, 0) + 1;
  elsif v_prev_date is null then
    -- First tracked action ever → streak begins at 1.
    v_new_count := 1;
  else
    -- Gap of ≥1 missed day. Shield or reset.
    if coalesce(v_shields, 0) > 0 then
      v_shields := v_shields - 1;
      v_new_count := coalesce(v_new_count, 0) + 1;
    else
      v_new_count := 1;
    end if;
  end if;

  -- Tier lookup: max tier_idx whose min_days ≤ new_count.
  select coalesce(max(tier_idx), 0) into v_new_tier
  from public.xp_streak_tiers
  where min_days <= v_new_count;

  update public.profiles
     set streak_count     = v_new_count,
         last_cooked_date = new.day_local,
         streak_shields   = v_shields,
         streak_tier      = v_new_tier,
         streak_peak      = greatest(coalesce(v_peak, 0), v_new_count)
   where id = new.user_id;

  return new;
exception when others then
  raise warning 'streak_tick_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists xp_events_streak_tick on public.xp_events;
create trigger xp_events_streak_tick
  after insert on public.xp_events
  for each row execute function public.streak_tick_fn();
