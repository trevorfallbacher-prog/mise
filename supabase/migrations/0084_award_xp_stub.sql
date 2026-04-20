-- 0084_award_xp_stub.sql
--
-- award_xp() — the single entry point for every XP mutation. This is
-- the STUB version that writes a ledger row and bumps profiles.total_xp
-- but applies NO multipliers and NO caps. Subsequent migrations layer
-- in the missing rules:
--
--   0085_award_xp_micro_caps       — per-source daily caps
--   0086_award_xp_daily_caps       — soft / hard daily caps
--   (Phase 3) streak multiplier
--   (Phase 4) curated-ladder multiplier
--
-- Signature:
--   award_xp(p_user_id, p_source, p_ref_table, p_ref_id, p_base_override)
--     returns jsonb breakdown  { base_xp, curated_mult, cap_adjustment,
--                                streak_mult, final_xp, event_id,
--                                source, day_local }
--
-- p_base_override is used for sources whose base XP is dynamic and
-- doesn't match xp_source_values.base_xp (badge_earn reads from
-- xp_badge_tier_xp; daily_roll reads from xp_rarity_rolls;
-- streak_revival negates xp_config.revival_fee).
--
-- day_local: uses current_date (UTC) as a placeholder. The Phase-3
-- migration that adds profiles.timezone replaces this with the
-- correct local-day computation (04:00 rollover per §3).
--
-- SECURITY DEFINER — writes to xp_events (no direct-write RLS) and
-- profiles. search_path pinned to prevent hijacking.
--
-- See docs/plans/xp-leveling.md §4 for the full ordering spec.

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
  v_base       int;
  v_day_local  date := current_date;
  v_event_id   uuid;
  v_final      int;
  v_source_row public.xp_source_values%rowtype;
begin
  if p_user_id is null then
    raise exception 'award_xp: user_id is required';
  end if;

  -- Resolve base XP: explicit override wins, else table lookup.
  select * into v_source_row
  from public.xp_source_values
  where source = p_source;

  if not found then
    raise exception 'award_xp: unknown source %', p_source;
  end if;

  v_base := coalesce(p_base_override, v_source_row.base_xp);
  v_final := v_base;  -- stub: no multipliers, no caps

  insert into public.xp_events (
    user_id, source, base_xp, curated_mult, cap_adjustment,
    streak_mult, final_xp, ref_table, ref_id, day_local
  ) values (
    p_user_id, p_source, v_base, 1.00, 0, 1.00, v_final,
    p_ref_table, p_ref_id, v_day_local
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
    'cap_adjustment', 0,
    'streak_mult',    1.00,
    'final_xp',       v_final,
    'day_local',      v_day_local
  );
end;
$$;

grant execute on function public.award_xp(uuid, text, text, uuid, int) to authenticated;
