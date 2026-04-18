-- Split legacy aggregate pantry_items rows into per-instance siblings.
--
-- Phase 1 of the per-instance pantry refactor started writing one
-- pantry_items row per physical unit (50 cans of tuna = 50 rows the
-- render layer stacks into one card). Existing data predates this:
-- a user who scanned a Costco run before the refactor has rows like
-- { amount: 50, unit: 'can' } or { amount: 1, reserve_count: 49 }
-- that won't render as stacks and won't decrement / route correctly
-- under the new logic.
--
-- This RPC migrates ONE USER's data on demand. Caller passes their
-- own user_id; admins can pass any user_id (e.g. via the admin
-- panel). For each qualifying row (discrete-count unit + total
-- instance count > 1), it INSERTs N-1 sibling copies and resets
-- the source row to amount=1, reserve_count=0, package_*=null. The
-- bucket the render layer groups by then sees N independent rows
-- sharing identity.
--
-- Why opt-in (RPC) and not auto-run: legacy rows with partial
-- fill_level on discrete units ("0.5 can open"), or hand-edited
-- amounts that don't reflect physical instance count, need a human
-- to confirm. Settings surfaces a button; users opt in when ready.
--
-- Returns (split_count, total_instances) so the UI can show
-- "Migrated 12 rows into 47 instances."

create or replace function public.split_aggregate_rows(p_user_id uuid)
returns table (split_count int, total_instances int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_split_count int := 0;
  v_total_instances int := 0;
  rec record;
  v_total int;
  v_to_make int;
  k int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if auth.uid() <> p_user_id and not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'forbidden';
  end if;

  for rec in
    select * from public.pantry_items
    where user_id = p_user_id
      and unit in (
        'count','can','box','each','bottle','bag','jar',
        'pack','package','piece','slice','loaf','wedge',
        'block','ball','wheel','carton','container','tub',
        'fillet','head','leaf','clove'
      )
      and (coalesce(amount, 0) >= 2 or coalesce(reserve_count, 0) > 0)
  loop
    v_total := greatest(
      1,
      floor(coalesce(rec.amount, 1))::int + coalesce(rec.reserve_count, 0)
    );
    v_to_make := v_total - 1;

    if v_to_make > 0 then
      for k in 1..v_to_make loop
        insert into public.pantry_items (
          user_id, name, emoji, amount, unit, max, low_threshold,
          category, location, expires_at, purchased_at, price_cents,
          kind, servings_remaining, source_recipe_slug,
          source_cook_log_id, state, source_kind, source_receipt_id,
          source_scan_id, scan_raw, tile_id, type_id, canonical_id,
          protected, ingredient_id, ingredient_ids
        ) values (
          rec.user_id, rec.name, rec.emoji, 1, rec.unit, rec.max,
          rec.low_threshold, rec.category, rec.location, rec.expires_at,
          rec.purchased_at, rec.price_cents, rec.kind, rec.servings_remaining,
          rec.source_recipe_slug, rec.source_cook_log_id, rec.state,
          rec.source_kind, rec.source_receipt_id, rec.source_scan_id,
          rec.scan_raw, rec.tile_id, rec.type_id, rec.canonical_id,
          rec.protected, rec.ingredient_id, rec.ingredient_ids
        );
      end loop;
    end if;

    -- Reset the source row to a single instance. Retire the legacy
    -- packaging fields — they're superseded by "count of sibling
    -- rows sharing identity."
    update public.pantry_items
    set amount = 1,
        reserve_count = 0,
        package_amount = null,
        package_unit = null
    where id = rec.id;

    v_split_count := v_split_count + 1;
    v_total_instances := v_total_instances + v_total;
  end loop;

  return query select v_split_count, v_total_instances;
end;
$$;

grant execute on function public.split_aggregate_rows(uuid) to authenticated;
