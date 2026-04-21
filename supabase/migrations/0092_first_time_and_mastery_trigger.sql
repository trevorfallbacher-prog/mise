-- 0092_first_time_and_mastery_trigger.sql
--
-- Two linked concerns, both driven by cook_logs INSERT:
--
-- 1. `first_time_recipe` (+100) — the cook is the user's FIRST cook
--    of that specific recipe. Deduped via recipe_first_cooks: we
--    INSERT with ON CONFLICT DO NOTHING; if a row actually landed,
--    this was first-time and we award.
--
-- 2. `recipe_mastery` counter + milestone fires — increments
--    cook_count on recipe_mastery and, if the new count crosses a
--    milestone boundary (5 / 10 / 25), fires the corresponding
--    mastery_5x / mastery_10x / mastery_25x award.
--
-- recipe_key convention: cook_logs.recipe_slug is the source of
-- truth. Bundled recipes have slugs like 'aglio-e-olio'; user
-- recipes use whatever slug the author picked (also text). One
-- lookup key covers both.
--
-- Both concerns share a trigger because they're both keyed off the
-- same (user_id, recipe_slug) pair and it's marginally cheaper than
-- two passes. If the future wants them separate, split is trivial.
--
-- See docs/plans/xp-leveling.md §1 (Cooking — first-time + mastery).

create or replace function public.xp_first_time_and_mastery_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key          text;
  v_first_landed boolean := false;
  v_new_count    int;
  v_prev_count   int;
begin
  if new.recipe_slug is null then
    return new;
  end if;
  v_key := new.recipe_slug;

  -- ── First-time cook dedup ──────────────────────────────────────
  insert into public.recipe_first_cooks (user_id, recipe_key, cooked_at)
  values (new.user_id, v_key, coalesce(new.cooked_at, new.created_at))
  on conflict (user_id, recipe_key) do nothing
  returning true into v_first_landed;

  if coalesce(v_first_landed, false) then
    perform public.award_xp(
      p_user_id   := new.user_id,
      p_source    := 'first_time_recipe',
      p_ref_table := 'cook_logs',
      p_ref_id    := new.id
    );
  end if;

  -- ── Mastery counter + milestone fires ──────────────────────────
  insert into public.recipe_mastery (user_id, recipe_key, cook_count, last_cooked_at)
  values (new.user_id, v_key, 1, coalesce(new.cooked_at, new.created_at))
  on conflict (user_id, recipe_key) do update
    set cook_count = public.recipe_mastery.cook_count + 1,
        last_cooked_at = excluded.last_cooked_at
  returning cook_count into v_new_count;
  v_prev_count := v_new_count - 1;

  -- Fire a milestone only when the crossing happens on this cook
  -- (previous count was below the boundary, new count is at or
  -- above it). Keeps backfills from mass-firing milestones.
  if v_prev_count < 5 and v_new_count >= 5 then
    perform public.award_xp(new.user_id, 'mastery_5x', 'cook_logs', new.id);
  elsif v_prev_count < 10 and v_new_count >= 10 then
    perform public.award_xp(new.user_id, 'mastery_10x', 'cook_logs', new.id);
  elsif v_prev_count < 25 and v_new_count >= 25 then
    perform public.award_xp(new.user_id, 'mastery_25x', 'cook_logs', new.id);
  end if;

  return new;
exception when others then
  raise warning 'xp_first_time_and_mastery_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists cook_logs_xp_first_time_mastery on public.cook_logs;
create trigger cook_logs_xp_first_time_mastery
  after insert on public.cook_logs
  for each row execute function public.xp_first_time_and_mastery_fn();
