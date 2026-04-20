-- 0095_authors_cut_trigger.sql
--
-- Fires award_xp(source='authors_cut') +10 to the AUTHOR of a
-- user-authored recipe whenever someone ELSE cooks it. Uses the
-- same recipe_slug convention as the first-time / mastery trigger
-- (0092) — user_recipes.slug is the lookup key.
--
-- Lifetime per-recipe cap: 3 awards per (author, recipe_slug).
-- Implemented via a ledger lookup (count of existing authors_cut
-- events keyed on ref_table='user_recipes' and the recipe's id).
-- Blocks the 2-account farm: creating a user_recipe and cooking it
-- under a burner account 100× only earns the author +30 lifetime.
--
-- Bundled recipes (no matching user_recipes row) don't fire this
-- trigger at all — the original author is "mise" / content team,
-- not a specific user.
--
-- Self-cooks don't fire — if the cooker IS the author, no XP
-- (you can't earn author's cut on your own recipe).
--
-- See docs/plans/xp-leveling.md §1 (Cooking — author's cut).

create or replace function public.xp_authors_cut_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipe_id  uuid;
  v_author_id  uuid;
  v_prior      int;
begin
  if new.recipe_slug is null then
    return new;
  end if;

  -- Resolve the user_recipes row. If none match, this was a bundled
  -- recipe or an AI-authored row not saved to user_recipes.
  select id, user_id into v_recipe_id, v_author_id
  from public.user_recipes
  where slug = new.recipe_slug
  limit 1;

  if v_author_id is null then
    return new;
  end if;
  if v_author_id = new.user_id then
    return new;  -- self-cook, no author's cut
  end if;

  -- Lifetime cap: 3 awards per recipe.
  select count(*) into v_prior
  from public.xp_events
  where source    = 'authors_cut'
    and ref_table = 'user_recipes'
    and ref_id    = v_recipe_id
    and user_id   = v_author_id;

  if v_prior >= 3 then
    return new;
  end if;

  perform public.award_xp(
    p_user_id   := v_author_id,
    p_source    := 'authors_cut',
    p_ref_table := 'user_recipes',
    p_ref_id    := v_recipe_id
  );
  return new;
exception when others then
  raise warning 'xp_authors_cut_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists cook_logs_xp_authors_cut on public.cook_logs;
create trigger cook_logs_xp_authors_cut
  after insert on public.cook_logs
  for each row execute function public.xp_authors_cut_fn();
