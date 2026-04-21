-- 0114_daily_roll_rpc.sql
--
-- streak_daily_roll() — once-per-local-day weighted scratch-card
-- roll. Server-side RNG only, per §4 ("never trust a client-seeded
-- roll with XP on the line"). Caller is gated to their own user_id
-- via auth.uid().
--
-- Algorithm:
--   1. Compute day_local from profiles.timezone + rollover_hour
--      (matches award_xp's rollover so a 03:30-local roll still
--      belongs to the previous day).
--   2. If profiles.daily_roll_date == day_local, reject — already
--      rolled today.
--   3. Draw a weighted sample from xp_rarity_rolls. weight_pct
--      sums to 100; random() * 100 picks the band.
--   4. award_xp with source='daily_roll', p_base_override = reward XP.
--      Bypasses daily caps by design — daily_roll is exempted via
--      the source config in xp_source_values.
--   5. Snapshot the result onto profiles.daily_roll_result +
--      daily_roll_date.
--
-- Returns jsonb { ok, rarity, xp_reward, cosmetic_flair, flair_hours,
-- event, rolled_at } or { ok:false, reason:'already_rolled' }.
--
-- The RPC is idempotent within the same day_local because step 2
-- rejects repeat calls — client can safely retry on network flake.
--
-- See docs/plans/xp-leveling.md §4 (daily login roll).

create or replace function public.streak_daily_roll(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target         uuid;
  v_caller         uuid := auth.uid();
  v_profile        public.profiles%rowtype;
  v_day_local      date;
  v_tz             text;
  v_rollover_hour  int;
  v_pick           public.xp_rarity_rolls%rowtype;
  v_roll           numeric;
  v_running        numeric := 0;
  v_event          jsonb;
  v_result         jsonb;
begin
  v_target := coalesce(p_user_id, v_caller);
  if v_target is null then
    raise exception 'streak_daily_roll: no target user';
  end if;
  if v_caller is not null and v_caller <> v_target then
    raise exception 'streak_daily_roll: can only roll for yourself';
  end if;

  select * into v_profile from public.profiles where id = v_target for update;
  if not found then
    raise exception 'streak_daily_roll: profile not found';
  end if;

  v_tz := coalesce(v_profile.timezone, 'UTC');
  select (value::text)::int into v_rollover_hour
  from public.xp_config where key = 'streak_rollover_hour';
  v_rollover_hour := coalesce(v_rollover_hour, 4);

  v_day_local := ((now() at time zone v_tz) - make_interval(hours => v_rollover_hour))::date;

  -- Already rolled today.
  if v_profile.daily_roll_date = v_day_local then
    return jsonb_build_object(
      'ok',     false,
      'reason', 'already_rolled',
      'result', v_profile.daily_roll_result
    );
  end if;

  -- Weighted sample. random() ∈ [0, 1) → scaled to [0, 100).
  -- Rarity rows are scanned in a stable order (weight_pct DESC)
  -- to make the common rows cheapest in the CPU sense.
  v_roll := random() * 100;
  for v_pick in
    select * from public.xp_rarity_rolls order by weight_pct desc
  loop
    v_running := v_running + v_pick.weight_pct;
    if v_roll < v_running then
      exit;
    end if;
  end loop;

  if v_pick.rarity is null then
    -- Shouldn't happen if weights sum to 100; fall back to common.
    select * into v_pick from public.xp_rarity_rolls where rarity = 'common';
  end if;

  -- Award via the ledger. override = the rolled XP.
  v_event := public.award_xp(
    p_user_id       := v_target,
    p_source        := 'daily_roll',
    p_ref_table     := 'profiles',
    p_ref_id        := v_target,
    p_base_override := v_pick.xp_reward
  );

  v_result := jsonb_build_object(
    'rarity',         v_pick.rarity,
    'xp_reward',      v_pick.xp_reward,
    'cosmetic_flair', v_pick.cosmetic_flair,
    'flair_hours',    v_pick.flair_hours,
    'rolled_at',      now()
  );

  update public.profiles
     set daily_roll_date   = v_day_local,
         daily_roll_result = v_result
   where id = v_target;

  return jsonb_build_object(
    'ok',             true,
    'rarity',         v_pick.rarity,
    'xp_reward',      v_pick.xp_reward,
    'cosmetic_flair', v_pick.cosmetic_flair,
    'flair_hours',    v_pick.flair_hours,
    'event',          v_event,
    'rolled_at',      now()
  );
end;
$$;

grant execute on function public.streak_daily_roll(uuid) to authenticated;
