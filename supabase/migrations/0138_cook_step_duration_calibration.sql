-- 0138_cook_step_duration_calibration.sql
--
-- Per-step observed durations so cook-timer pushes (migration 0137)
-- can calibrate against the user's actual pace rather than the
-- recipe author's estimate. Closes the feedback loop the user called
-- out: "if we don't have time based logs of how long cooks take we
-- need to make them" + "base notifications on cook times" — chunks
-- 3 / 4 captured the data, this chunk uses it.
--
-- Exposed as a SECURITY DEFINER RPC rather than a view so aggregates
-- can read the full cross-family corpus (individual user's family
-- cooks are too sparse to calibrate in the early days — my family
-- has cooked carbonara twice; the global audience has cooked it
-- thousands of times). The RPC only ever returns aggregate counts,
-- avg, and percentiles — no individual cook durations, no cook_ids,
-- nothing that would leak a specific user's pace. Safe to open.
--
-- Call pattern from the client:
--   supabase.rpc('observed_step_duration', {
--     p_recipe_slug: recipe.slug,
--     p_step_id:     String(step.id),
--   })
--   → { sample_count, avg_seconds, p50_seconds, p90_seconds } | empty
--
-- Empty when no finished sessions exist yet — caller falls back to
-- the recipe's authored nominal.
--
-- Safe to re-run.

create or replace function public.observed_step_duration(
  p_recipe_slug text,
  p_step_id     text
)
returns table(
  sample_count  bigint,
  avg_seconds   integer,
  p50_seconds   integer,
  p90_seconds   integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint                                           as sample_count,
    avg(s.duration_seconds)::int                               as avg_seconds,
    percentile_cont(0.5) within group (order by s.duration_seconds)::int as p50_seconds,
    percentile_cont(0.9) within group (order by s.duration_seconds)::int as p90_seconds
  from public.cook_session_steps s
  join public.cook_sessions cs on cs.id = s.cook_session_id
  where cs.status = 'finished'
    and s.finished_at is not null
    and not s.skipped
    and s.duration_seconds > 0
    and cs.recipe_slug = p_recipe_slug
    and s.step_id      = p_step_id
  having count(*) > 0;
$$;

revoke all on function public.observed_step_duration(text, text) from public;
grant execute on function public.observed_step_duration(text, text)
  to authenticated, service_role;

-- Analogous call for a whole recipe (ignores step_id), useful when a
-- future UI wants to show "this recipe typically takes X min" without
-- iterating through every step. Returns one aggregated row or empty.
create or replace function public.observed_recipe_duration(
  p_recipe_slug text
)
returns table(
  sample_count  bigint,
  avg_seconds   integer,
  p50_seconds   integer,
  p90_seconds   integer
)
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select cs.id,
           sum(s.duration_seconds) as total
      from public.cook_session_steps s
      join public.cook_sessions cs on cs.id = s.cook_session_id
      where cs.status = 'finished'
        and s.finished_at is not null
        and not s.skipped
        and s.duration_seconds > 0
        and cs.recipe_slug = p_recipe_slug
      group by cs.id
  )
  select
    count(*)::bigint                                     as sample_count,
    avg(total)::int                                      as avg_seconds,
    percentile_cont(0.5) within group (order by total)::int as p50_seconds,
    percentile_cont(0.9) within group (order by total)::int as p90_seconds
  from totals
  having count(*) > 0;
$$;

revoke all on function public.observed_recipe_duration(text) from public;
grant execute on function public.observed_recipe_duration(text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
