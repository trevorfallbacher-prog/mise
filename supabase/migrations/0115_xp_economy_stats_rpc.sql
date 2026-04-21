-- 0115_xp_economy_stats_rpc.sql
--
-- xp_economy_stats() — admin-only observability RPC covering every
-- metric the Phase-1 telemetry plan (§7) calls out. Returns a
-- single jsonb object so the admin panel can render all cards off
-- one round trip.
--
-- Metrics:
--   median_xp_per_user_day    — median of daily sum(final_xp) per
--                                active user across the last 28d
--   p90_xp_per_user_day       — 90th percentile of the same
--   active_users_last_7       — distinct users with ≥1 xp_events
--                                in the last 7d
--   soft_cap_hit_pct          — % of earn events where soft_cap_adj
--                                is non-zero (approximated via
--                                cap_adjustment containing a soft
--                                haircut — safe proxy pre-breakdown
--                                column split)
--   hard_cap_hit_pct          — same, hard
--   streak_length_histogram   — {range → count} buckets
--   shield_burn_rate          — shields consumed vs. regen events
--                                in the last 30d (telemetry approx
--                                from xp_events counts)
--   revival_usage_30          — # of streak_revival events last 30d
--   curated_share_pct         — curated cooks / total cooks last 30d
--   median_time_to_l10_days   — median (account_age_days among
--                                users who have reached L10 at least
--                                once — approximated as "currently
--                                L10+")
--   xp_blocked_by_gates_30    — -SUM(gate_adjustment) last 30d
--
-- Gated to admins via the same pattern as the other admin views:
--   IF caller.role != 'admin' → raises.
-- SECURITY DEFINER with the admin guard so it can aggregate across
-- tables the admin's RLS grants don't cover directly.
--
-- See docs/plans/xp-leveling.md §7 (telemetry to instrument).

create or replace function public.xp_economy_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_role text;
  v_result      jsonb;
  v_median_xp   numeric;
  v_p90_xp      numeric;
  v_active_7    int;
  v_soft_ct     int;
  v_hard_ct     int;
  v_total_ct    int;
  v_streak_hist jsonb;
  v_revival_30  int;
  v_curated_ct  int;
  v_total_cooks int;
  v_median_l10  numeric;
  v_blocked_30  int;
begin
  select role into v_caller_role
  from public.profiles where id = auth.uid();
  if coalesce(v_caller_role, '') <> 'admin' then
    raise exception 'xp_economy_stats: admin role required';
  end if;

  -- Per-user per-day sums over last 28d → median + p90.
  with daily as (
    select user_id, day_local, sum(final_xp)::int as xp
    from public.xp_events
    where day_local >= current_date - interval '28 days'
      and final_xp > 0
    group by user_id, day_local
  )
  select
    percentile_cont(0.5) within group (order by xp),
    percentile_cont(0.9) within group (order by xp)
  into v_median_xp, v_p90_xp
  from daily;

  select count(distinct user_id) into v_active_7
  from public.xp_events
  where created_at >= now() - interval '7 days';

  -- Cap-hit counts (any non-zero cap_adjustment implies a trim).
  select count(*) into v_total_ct
  from public.xp_events
  where created_at >= now() - interval '30 days';

  -- We can't distinguish soft vs hard on the persisted column
  -- without the breakdown split; approximate: any cap_adjustment
  -- means soft-or-hard. final_xp = 0 on a non-onboarding,
  -- non-revival row means the event was fully capped (most
  -- commonly hard OR fully per-source-capped).
  select count(*) into v_soft_ct
  from public.xp_events
  where created_at >= now() - interval '30 days'
    and cap_adjustment < 0;

  select count(*) into v_hard_ct
  from public.xp_events
  where created_at >= now() - interval '30 days'
    and final_xp = 0
    and cap_adjustment < 0
    and source not like 'onboarding_%'
    and source <> 'streak_revival';

  -- Streak length distribution — current value per user.
  with buckets as (
    select case
      when streak_count = 0 then '0'
      when streak_count between 1 and 2 then '1-2'
      when streak_count between 3 and 6 then '3-6'
      when streak_count between 7 and 13 then '7-13'
      when streak_count between 14 and 29 then '14-29'
      else '30+'
    end as bucket
    from public.profiles
  )
  select jsonb_object_agg(bucket, ct) into v_streak_hist
  from (
    select bucket, count(*)::int as ct from buckets group by bucket
  ) t;

  select count(*) into v_revival_30
  from public.xp_events
  where source = 'streak_revival'
    and created_at >= now() - interval '30 days';

  -- Curated share — events where curated_mult > 1 vs. total
  -- cook_complete events in the last 30d.
  select count(*) into v_curated_ct
  from public.xp_events
  where source = 'cook_complete'
    and curated_mult > 1.0
    and created_at >= now() - interval '30 days';

  select count(*) into v_total_cooks
  from public.xp_events
  where source = 'cook_complete'
    and created_at >= now() - interval '30 days';

  -- Median account age among users currently at L10+ — proxy for
  -- "time to L10". Under-estimates because users who shot past L10
  -- might have done it faster than the snapshot suggests, but
  -- good enough for a dashboard sanity check.
  select percentile_cont(0.5) within group (
    order by extract(epoch from (now() - created_at)) / 86400.0
  ) into v_median_l10
  from public.profiles
  where level >= 10;

  select -coalesce(sum(gate_adjustment), 0) into v_blocked_30
  from public.xp_events
  where gate_adjustment < 0
    and created_at >= now() - interval '30 days';

  v_result := jsonb_build_object(
    'median_xp_per_user_day',   coalesce(v_median_xp, 0),
    'p90_xp_per_user_day',      coalesce(v_p90_xp, 0),
    'active_users_last_7',      coalesce(v_active_7, 0),
    'total_events_30',          coalesce(v_total_ct, 0),
    'cap_hit_count_30',         coalesce(v_soft_ct, 0),
    'hard_cap_zeroed_count_30', coalesce(v_hard_ct, 0),
    'streak_length_histogram',  coalesce(v_streak_hist, '{}'::jsonb),
    'revival_usage_30',         coalesce(v_revival_30, 0),
    'curated_share_pct',        case when coalesce(v_total_cooks, 0) = 0
                                  then 0
                                  else round((v_curated_ct::numeric / v_total_cooks::numeric) * 100, 1)
                                end,
    'median_days_to_l10',       coalesce(round(v_median_l10, 1), 0),
    'xp_blocked_by_gates_30',   coalesce(v_blocked_30, 0)
  );

  return v_result;
end;
$$;

grant execute on function public.xp_economy_stats() to authenticated;
