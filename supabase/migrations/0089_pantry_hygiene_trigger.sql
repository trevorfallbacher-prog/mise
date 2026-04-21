-- 0089_pantry_hygiene_trigger.sql
--
-- Fires award_xp(source='pantry_hygiene') on pantry_items UPDATE
-- where the amount or category changed. Those two columns capture
-- the two activities the plan rewards: "mark used / fix qty"
-- (amount) and re-classifying a pantry row (category, e.g. moving
-- something from fridge → pantry after a scan got it wrong).
--
-- Intentionally narrow: updates that only bump updated_at or swap
-- the emoji are not hygiene work and shouldn't earn XP. Updates
-- that ONLY change name or unit are also excluded — those are
-- touchups that don't improve data-quality meaningfully.
--
-- Trade-off: cook-driven amount decrements (applied by
-- CookComplete when items get consumed) WILL fire this trigger.
-- We accept that: the daily cap of 10 XP/day (≈5 edits) enforced
-- by xp_source_values bounds the damage, and rewarding the pantry
-- being kept in sync with reality is on-brand. If telemetry
-- shows this floods the cap during normal cooking, we can tighten
-- with a session variable or split the cook path to skip this.
--
-- Attribution: XP goes to auth.uid() (the caller), not new.user_id.
-- Same reasoning as 0088_scan_add_trigger.
--
-- See docs/plans/xp-leveling.md §1 (Data contribution).

create or replace function public.xp_pantry_hygiene_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    return new;
  end if;

  -- Only fire when an actual hygiene-relevant column changed.
  if new.amount is not distinct from old.amount
     and new.category is not distinct from old.category
  then
    return new;
  end if;

  perform public.award_xp(
    p_user_id   := v_actor,
    p_source    := 'pantry_hygiene',
    p_ref_table := 'pantry_items',
    p_ref_id    := new.id
  );
  return new;
exception
  when others then
    raise warning 'xp_pantry_hygiene_fn: award_xp failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists pantry_items_xp_hygiene on public.pantry_items;
create trigger pantry_items_xp_hygiene
  after update on public.pantry_items
  for each row execute function public.xp_pantry_hygiene_fn();
