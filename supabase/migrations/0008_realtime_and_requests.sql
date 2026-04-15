-- mise — realtime + meal requests
--
-- Adds:
--   * `cook_id` + `requested_by` to scheduled_meals for attribution and the
--     "request a meal" flow (null cook_id = an unclaimed request)
--   * 'requested' as a valid status (superseded once cook_id is claimed)
--   * enables Supabase Realtime on the three shared tables so family members
--     see each other's changes without a refresh
--
-- Safe to re-run.

-- ── scheduled_meals: cook_id + requested_by ─────────────────────────────────
alter table public.scheduled_meals
  add column if not exists cook_id       uuid references auth.users(id) on delete set null,
  add column if not exists requested_by  uuid references auth.users(id) on delete set null;

-- Backfill: every existing meal was created by user_id and (implicitly) was
-- going to be cooked by that same person. Only set cook_id where it's null.
update public.scheduled_meals
  set cook_id = user_id
  where cook_id is null;

-- ── realtime ────────────────────────────────────────────────────────────────
-- Add each table to the supabase_realtime publication. If a table is already
-- in the publication, `add table` errors, so wrap in a DO block.
do $$
declare t text;
begin
  foreach t in array array['pantry_items','shopping_list_items','scheduled_meals']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      -- already in the publication, no-op
      null;
    end;
  end loop;
end $$;

-- Realtime respects RLS — subscribers only receive events for rows they'd
-- be allowed to SELECT. Because family-select already admits family rows,
-- family members automatically get each other's realtime events.

notify pgrst, 'reload schema';
