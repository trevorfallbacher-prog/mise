-- mise — let a diner remove themselves from a cook they didn't eat (or
--        just want off their cookbook)
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- The chef can already delete their own cook_log (owner-only DELETE in
-- migration 0013). A diner couldn't touch the row at all — they can't
-- even UPDATE to pull themselves off the diners[] array (RLS on
-- cook_logs UPDATE is owner-only). That means a mistag stuck forever
-- on the diner's Eaten tab with no escape hatch.
--
-- This RPC is the escape hatch. SECURITY DEFINER so we can mutate the
-- chef's row on behalf of a diner, but only when the caller is ACTUALLY
-- listed as a diner on the cook. Anything else raises.
--
-- Side effects (all idempotent):
--   * array_remove auth.uid() from cook_logs.diners
--   * delete caller's review (if any) on that cook
--   * delete caller's favorite (if any) on that cook
--   * leave the cook_log itself intact for the chef

create or replace function public.leave_cook_log(cook_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  row    public.cook_logs%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into row from public.cook_logs where id = cook_log_id;
  if not found then
    -- Silent success — row doesn't exist or RLS hid it. No point leaking
    -- the distinction.
    return;
  end if;

  -- Refuse if the caller isn't actually on the diners list. The chef
  -- removing themselves would be nonsensical; nudge them to DELETE the
  -- whole cook_log instead of the owner-hole of this RPC.
  if caller = row.user_id then
    raise exception 'chef cannot leave their own cook — use delete instead'
      using errcode = 'P0001';
  end if;
  if not (caller = ANY(row.diners)) then
    -- Caller wasn't on this cook in the first place; nothing to do.
    return;
  end if;

  update public.cook_logs
     set diners = array_remove(diners, caller)
   where id = cook_log_id;

  -- Clean up the caller's review + favorite on this cook. Once they're
  -- not a diner, RLS would hide the review from them anyway, but we
  -- delete explicitly so the chef's review thread doesn't show a stale
  -- rating from someone who's just abandoned the meal.
  delete from public.cook_log_reviews
    where cook_log_id = leave_cook_log.cook_log_id
      and reviewer_id = caller;

  delete from public.cook_log_favorites
    where cook_log_id = leave_cook_log.cook_log_id
      and user_id     = caller;
end;
$$;

grant execute on function public.leave_cook_log(uuid) to authenticated;
