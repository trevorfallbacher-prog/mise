-- 0088_scan_add_trigger.sql
--
-- Fires award_xp(source='scan_add') on every pantry_items INSERT.
-- Chose a trigger over client-side RPC calls because pantry_items
-- has too many insert paths to chase (scan, manual add, receipt
-- parse, item-split, leftover-meal composition, stack edits…) —
-- one trigger catches them all.
--
-- Attribution: XP goes to the caller (auth.uid()), not to
-- new.user_id. Family members can insert rows with user_id set to
-- another family member's id (migration 0004 family-insert policy).
-- The person doing the work earns the +5, even if the item ends
-- up in someone else's row.
--
-- Fail-safe: when the trigger runs in a context without an
-- authenticated user (service-role backfills, migrations), auth.uid()
-- is null — the trigger no-ops. The daily cap on scan_add is enforced
-- by award_xp via xp_source_values (50 XP/day ≈ 10 scans).
--
-- See docs/plans/xp-leveling.md §1 (Data contribution).

create or replace function public.xp_scan_add_fn()
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

  perform public.award_xp(
    p_user_id   := v_actor,
    p_source    := 'scan_add',
    p_ref_table := 'pantry_items',
    p_ref_id    := new.id
  );
  return new;
exception
  when others then
    -- Never block the insert because of an XP write failure.
    raise warning 'xp_scan_add_fn: award_xp failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists pantry_items_xp_scan_add on public.pantry_items;
create trigger pantry_items_xp_scan_add
  after insert on public.pantry_items
  for each row execute function public.xp_scan_add_fn();
