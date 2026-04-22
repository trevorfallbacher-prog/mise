-- Purchased-state columns on shopping_list_items.
--
-- Before Shop Mode, the shopping list had no "completed" state — items
-- were deleted when the user checked them off. Shop Mode needs the
-- audit trail: when a trip pairs a scan to a list item, we want to keep
-- the list row around marked purchased with a forward-link back to the
-- pantry row that the scan became. That turns the shopping list into a
-- per-trip ledger and lets the UI render a "you bought apples on
-- 2026-04-22" retrospective instead of losing the row outright.
--
-- The `source` column also gains a new implicit value `trip_impulse`
-- for items created silently by Shop Mode when the user taps NOT ON MY
-- LIST after scanning. The column has no CHECK constraint, so no DDL
-- is needed — this migration documents the new value and adds the
-- supporting index.
--
-- Idempotent; safe to re-run.

alter table public.shopping_list_items
  add column if not exists purchased_at timestamptz null,
  add column if not exists purchased_pantry_item_id uuid null,
  add column if not exists purchased_trip_id uuid null;

-- Post-hoc FKs — the target tables must exist before these constraints
-- can be added. pantry_items from migration 0004; shopping_trips from
-- migration 0126.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shopping_list_items_purchased_pantry_fk'
  ) then
    alter table public.shopping_list_items
      add constraint shopping_list_items_purchased_pantry_fk
      foreign key (purchased_pantry_item_id)
      references public.pantry_items(id)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'shopping_list_items_purchased_trip_fk'
  ) then
    alter table public.shopping_list_items
      add constraint shopping_list_items_purchased_trip_fk
      foreign key (purchased_trip_id)
      references public.shopping_trips(id)
      on delete set null;
  end if;
end $$;

-- Indexes — the UI queries the list in two slices ("still need to buy"
-- = purchased_at is null; "purchased in this trip" = by trip_id).
create index if not exists shopping_list_items_unpurchased_idx
  on public.shopping_list_items (user_id)
  where purchased_at is null;

create index if not exists shopping_list_items_trip_idx
  on public.shopping_list_items (purchased_trip_id)
  where purchased_trip_id is not null;

-- Note on `source`:
--   Existing values: 'manual', 'low-stock', 'recipe'
--   New value:       'trip_impulse' (Shop Mode silently-added list item
--                    from NOT ON MY LIST tap — keeps the pair model
--                    uniform and gives impulse buys a provenance tag).
--   No CHECK constraint exists on the column (0004), so no DDL
--   required; client writes the literal string directly.
