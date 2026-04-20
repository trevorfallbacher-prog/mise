-- 0090_cook_log_xp_triggers.sql
--
-- Two triggers on cook_logs INSERT, both firing follow-up award_xp
-- calls once the ledger row from CookComplete's in-client
-- award_xp('cook_complete') has landed:
--
--   plan_cook_closed  — +15 when the cook matches a scheduled_meals
--                        row (same user, same recipe_slug, scheduled
--                        within ±24h of cooked_at). Flips the
--                        scheduled_meals row to status='cooked' in the
--                        same transaction.
--   eat_together      — +50 when diners[] has length ≥ 2.
--
-- Daily caps (eat_together 3/day) enforced by xp_source_values.
--
-- Why triggers instead of client calls: CookComplete doesn't always
-- know whether the cook came from a scheduled meal — it takes a
-- recipe prop that could originate anywhere. Server-side lookup is
-- the only way to reliably detect "this cook closed a plan slot"
-- across every entry path (Plan, AIRecipe, Cookbook-replay, etc.).
--
-- Both triggers attribute XP to new.user_id (the chef) since cook_logs
-- insert policy requires auth.uid() = user_id — caller and chef are
-- the same.
--
-- See docs/plans/xp-leveling.md §1 (Cooking).

-- ── plan_cook_closed ────────────────────────────────────────────────

create or replace function public.xp_plan_cook_closed_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_matched uuid;
begin
  -- Find a scheduled_meals row within ±24h. Pick the nearest one if
  -- several qualify (user rescheduled twice, we don't want to double
  -- award on a single cook).
  select id into v_matched
  from public.scheduled_meals
  where user_id = new.user_id
    and recipe_slug = new.recipe_slug
    and status = 'planned'
    and abs(extract(epoch from (scheduled_for - coalesce(new.cooked_at, new.created_at)))) <= 86400
  order by abs(extract(epoch from (scheduled_for - coalesce(new.cooked_at, new.created_at))))
  limit 1;

  if v_matched is null then
    return new;
  end if;

  update public.scheduled_meals
     set status = 'cooked'
   where id = v_matched;

  perform public.award_xp(
    p_user_id   := new.user_id,
    p_source    := 'plan_cook_closed',
    p_ref_table := 'cook_logs',
    p_ref_id    := new.id
  );
  return new;
exception
  when others then
    raise warning 'xp_plan_cook_closed_fn: % ', sqlerrm;
    return new;
end;
$$;

drop trigger if exists cook_logs_xp_plan_closed on public.cook_logs;
create trigger cook_logs_xp_plan_closed
  after insert on public.cook_logs
  for each row execute function public.xp_plan_cook_closed_fn();

-- ── eat_together ────────────────────────────────────────────────────

create or replace function public.xp_eat_together_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(array_length(new.diners, 1), 0) < 2 then
    return new;
  end if;

  perform public.award_xp(
    p_user_id   := new.user_id,
    p_source    := 'eat_together',
    p_ref_table := 'cook_logs',
    p_ref_id    := new.id
  );
  return new;
exception
  when others then
    raise warning 'xp_eat_together_fn: % ', sqlerrm;
    return new;
end;
$$;

drop trigger if exists cook_logs_xp_eat_together on public.cook_logs;
create trigger cook_logs_xp_eat_together
  after insert on public.cook_logs
  for each row execute function public.xp_eat_together_fn();
