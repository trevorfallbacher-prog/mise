-- 0102_xp_level_fn.sql
--
-- Two pure-math SQL helpers for the level system. Both read the
-- curve coefficient and exponent from xp_config so product can
-- retune pacing via one UPDATE (no redeploy, no migration).
--
--   xp_to_next(L)        → int. XP REQUIRED to go from level L to
--                          level L+1. round(coef * L^exp).
--                          Produces: L1→L2 = 100, L5→L6 ≈ 1320,
--                          L10→L11 ≈ 3980, L20→L21 ≈ 12100,
--                          L50→L51 ≈ 61800. See §2.
--
--   level_from_xp(x)     → int. Given a cumulative total_xp, find
--                          the highest level L such that
--                          sum(xp_to_next(1..L-1)) <= x.
--                          Starts at 1 (no one is L0).
--
-- level_from_xp is implemented as a loop with a conservative cap
-- (500 levels) — nobody should hit that in practice and the loop
-- is linear in L, which is fine for the ~100-level target band.
-- If telemetry ever shows this as a hot path, a cumulative-XP
-- lookup table is the obvious next step.
--
-- Neither function mutates — callers use them to compute levels
-- on read or inside the trigger that lands in 0103.
--
-- See docs/plans/xp-leveling.md §2 (Level curve).

create or replace function public.xp_to_next(p_level int)
returns int
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_coef int;
  v_exp  numeric;
begin
  if p_level is null or p_level < 1 then
    return 0;
  end if;

  select (value::text)::int     into v_coef from public.xp_config where key = 'xp_curve_coefficient';
  select (value::text)::numeric into v_exp  from public.xp_config where key = 'xp_curve_exponent';

  v_coef := coalesce(v_coef, 100);
  v_exp  := coalesce(v_exp,  1.6);

  return greatest(1, round(v_coef * power(p_level, v_exp))::int);
end;
$$;

create or replace function public.level_from_xp(p_xp int)
returns int
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_level int := 1;
  v_remaining int;
  v_step int;
  v_cap int := 500;  -- hard safety cap; unreachable in practice
begin
  if p_xp is null or p_xp <= 0 then
    return 1;
  end if;

  v_remaining := p_xp;
  while v_level < v_cap loop
    v_step := public.xp_to_next(v_level);
    if v_remaining < v_step then
      exit;
    end if;
    v_remaining := v_remaining - v_step;
    v_level := v_level + 1;
  end loop;
  return v_level;
end;
$$;

grant execute on function public.xp_to_next(int) to authenticated;
grant execute on function public.level_from_xp(int) to authenticated;
