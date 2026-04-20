-- 0091_onboarding_xp_triggers.sql
--
-- The six "starter pack" onboarding awards from
-- docs/plans/xp-leveling.md §1. Each fires once per user, the first
-- time they perform the action. All six sources are tagged
-- flat_bonus=true and `source LIKE 'onboarding_%'` in
-- xp_source_values, which makes award_xp exempt them from the daily
-- soft/hard cap — a new user shouldn't be throttled on their first
-- cook just because they also did a bunch of scans that day.
--
-- Trigger family:
--   pantry_items INSERT             → onboarding_first_pantry    (+10)
--   pantry_items INSERT or UPDATE   → onboarding_first_canonical (+15)
--                                     (when canonical_id transitions to non-null)
--   cook_logs INSERT                → onboarding_first_cook      (+20)
--   scheduled_meals INSERT          → onboarding_first_plan      (+10)
--   relationships INSERT/UPDATE     → onboarding_first_household (+10)
--                                     when kind='family' and status='accepted'
--                                     and it's this user's first accepted family row
--   relationships INSERT/UPDATE     → onboarding_first_friend    (+15)
--                                     when kind='friend' and status='accepted'
--                                     and it's this user's first accepted friend row
--
-- "First ever" dedup relies on the ledger: if an xp_events row for
-- (user_id, source='onboarding_X') already exists, the trigger no-ops.
-- award_xp already writes the ledger atomically under SECURITY
-- DEFINER, so this check is race-safe within a transaction.
--
-- Attribution: all triggers attribute XP to new.user_id (the
-- onboarding rewards are earned BY the row's owner, not by whatever
-- service did the insert). For relationships we pick the row-side
-- user based on which side accepted — more below.
--
-- See docs/plans/xp-leveling.md §1 (Onboarding starter pack).

-- ── Helper: has this user already received this onboarding award? ──

create or replace function public.xp_has_onboarding(p_user_id uuid, p_source text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.xp_events
    where user_id = p_user_id and source = p_source
  );
$$;

-- ── first_pantry + first_canonical (both on pantry_items) ──────────
-- Split into two functions to keep each trigger's logic readable.

create or replace function public.xp_onboarding_first_pantry_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.xp_has_onboarding(new.user_id, 'onboarding_first_pantry') then
    return new;
  end if;
  perform public.award_xp(new.user_id, 'onboarding_first_pantry', 'pantry_items', new.id);
  return new;
exception when others then
  raise warning 'xp_onboarding_first_pantry_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists pantry_items_xp_onboarding_first on public.pantry_items;
create trigger pantry_items_xp_onboarding_first
  after insert on public.pantry_items
  for each row execute function public.xp_onboarding_first_pantry_fn();

create or replace function public.xp_onboarding_first_canonical_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Fires when canonical_id lands for the first time on a row.
  if new.canonical_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.canonical_id is not null then
    return new; -- already had a canonical; user is just re-linking
  end if;
  if public.xp_has_onboarding(new.user_id, 'onboarding_first_canonical') then
    return new;
  end if;
  perform public.award_xp(new.user_id, 'onboarding_first_canonical', 'pantry_items', new.id);
  return new;
exception when others then
  raise warning 'xp_onboarding_first_canonical_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists pantry_items_xp_onboarding_canonical on public.pantry_items;
create trigger pantry_items_xp_onboarding_canonical
  after insert or update of canonical_id on public.pantry_items
  for each row execute function public.xp_onboarding_first_canonical_fn();

-- ── first_cook ─────────────────────────────────────────────────────

create or replace function public.xp_onboarding_first_cook_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.xp_has_onboarding(new.user_id, 'onboarding_first_cook') then
    return new;
  end if;
  perform public.award_xp(new.user_id, 'onboarding_first_cook', 'cook_logs', new.id);
  return new;
exception when others then
  raise warning 'xp_onboarding_first_cook_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists cook_logs_xp_onboarding_first on public.cook_logs;
create trigger cook_logs_xp_onboarding_first
  after insert on public.cook_logs
  for each row execute function public.xp_onboarding_first_cook_fn();

-- ── first_plan ─────────────────────────────────────────────────────

create or replace function public.xp_onboarding_first_plan_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.xp_has_onboarding(new.user_id, 'onboarding_first_plan') then
    return new;
  end if;
  perform public.award_xp(new.user_id, 'onboarding_first_plan', 'scheduled_meals', new.id);
  return new;
exception when others then
  raise warning 'xp_onboarding_first_plan_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists scheduled_meals_xp_onboarding_first on public.scheduled_meals;
create trigger scheduled_meals_xp_onboarding_first
  after insert on public.scheduled_meals
  for each row execute function public.xp_onboarding_first_plan_fn();

-- ── first_household + first_friend (both on relationships) ─────────
-- Both parties get the award when the relationship hits 'accepted'
-- for the first time. The awarding function fans out to BOTH
-- requester_id and addressee_id so each side of the connection
-- claims their onboarding bonus.

create or replace function public.xp_onboarding_relationship_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text;
  v_side   uuid;
begin
  -- Only fire on transitions INTO 'accepted'.
  if new.status <> 'accepted' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'accepted' then
    return new;
  end if;

  v_source := case new.kind
    when 'family' then 'onboarding_first_household'
    when 'friend' then 'onboarding_first_friend'
    else null
  end;
  if v_source is null then
    return new;
  end if;

  foreach v_side in array array[new.requester_id, new.addressee_id] loop
    if v_side is null then
      continue;
    end if;
    if public.xp_has_onboarding(v_side, v_source) then
      continue;
    end if;
    perform public.award_xp(v_side, v_source, 'relationships', new.id);
  end loop;
  return new;
exception when others then
  raise warning 'xp_onboarding_relationship_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists relationships_xp_onboarding on public.relationships;
create trigger relationships_xp_onboarding
  after insert or update of status on public.relationships
  for each row execute function public.xp_onboarding_relationship_fn();
