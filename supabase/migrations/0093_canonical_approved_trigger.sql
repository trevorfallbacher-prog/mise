-- 0093_canonical_approved_trigger.sql
--
-- Awards +25 XP to the original canonical creator when an
-- ingredient_info row lands — or, more precisely, when the
-- corresponding pending_ingredient_info row transitions to
-- status='approved'. The creator is tracked on
-- pending_ingredient_info.user_id (ingredient_info itself has no
-- user_id column — see migration 0028).
--
-- Two fire conditions covered by this migration's two triggers:
--
-- 1. `pending_ingredient_info` transitions status → 'approved'.
--    Canonical path when admin uses the dashboard approval flow.
-- 2. `ingredient_info` INSERT with a matching pending row.
--    Covers edge cases where the row lands directly (admin
--    backfill, auto-approve flow that bypasses the pending table
--    but writes the pending row for audit).
--
-- Dedup: checks xp_events for an existing canonical_approved row
-- keyed by the pending row's id. This is idempotent — running
-- either trigger twice (or both in the same transaction) credits
-- once.
--
-- Attribution goes to pending_ingredient_info.user_id, NOT
-- auth.uid() — the admin approves, but the creator earns.
--
-- See docs/plans/xp-leveling.md §1 (Data contribution — canonical_approved).

create or replace function public.xp_canonical_approved_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pending_id uuid;
  v_creator    uuid;
begin
  -- Case 1: pending row transitioned to approved.
  if tg_table_name = 'pending_ingredient_info' then
    if new.status <> 'approved' then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status = 'approved' then
      return new;
    end if;
    v_pending_id := new.id;
    v_creator    := new.user_id;

  -- Case 2: ingredient_info insert (look up the pending row).
  elsif tg_table_name = 'ingredient_info' then
    select id, user_id into v_pending_id, v_creator
    from public.pending_ingredient_info
    where slug = new.ingredient_id
      and status in ('approved', 'pending')
    order by created_at asc
    limit 1;
    if v_creator is null then
      return new;
    end if;
  else
    return new;
  end if;

  -- Dedup via the ledger.
  if exists (
    select 1 from public.xp_events
    where source = 'canonical_approved'
      and ref_table = 'pending_ingredient_info'
      and ref_id = v_pending_id
  ) then
    return new;
  end if;

  perform public.award_xp(
    p_user_id   := v_creator,
    p_source    := 'canonical_approved',
    p_ref_table := 'pending_ingredient_info',
    p_ref_id    := v_pending_id
  );
  return new;
exception when others then
  raise warning 'xp_canonical_approved_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists pending_ingredient_info_xp_approved on public.pending_ingredient_info;
create trigger pending_ingredient_info_xp_approved
  after insert or update of status on public.pending_ingredient_info
  for each row execute function public.xp_canonical_approved_fn();

drop trigger if exists ingredient_info_xp_approved on public.ingredient_info;
create trigger ingredient_info_xp_approved
  after insert on public.ingredient_info
  for each row execute function public.xp_canonical_approved_fn();
