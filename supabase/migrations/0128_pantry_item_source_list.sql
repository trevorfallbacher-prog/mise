-- Shop Mode forward-link from pantry_items back to the shopping_list_items
-- slot that prompted the purchase.
--
-- Shop Mode's commit pass (src/lib/commitShopModeTrip.js) pairs each
-- trip_scan to a receipt line's pantry_items row and to the list slot
-- the user tapped in-aisle. Three writes happen in that pass:
--
--   trip_scans.paired_pantry_item_id       ← pantry row just inserted
--   shopping_list_items.purchased_*        ← list slot marked purchased
--   pantry_items.source_shopping_list_item_id ← this column, so the
--                                             ItemCard can render
--                                             "from your shopping list"
--                                             without a JOIN lookup
--
-- Nullable: not every pantry row has a list provenance — direct
-- receipt scans, manual adds, and recipe conversions don't. Partial
-- index matches other provenance columns (source_receipt_id,
-- source_scan_id) which are also mostly null.

alter table public.pantry_items
  add column if not exists source_shopping_list_item_id uuid null;

-- Post-hoc FK — idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pantry_items_source_list_fk'
  ) then
    alter table public.pantry_items
      add constraint pantry_items_source_list_fk
      foreign key (source_shopping_list_item_id)
      references public.shopping_list_items(id)
      on delete set null;
  end if;
end $$;

create index if not exists pantry_items_source_list_idx
  on public.pantry_items (source_shopping_list_item_id)
  where source_shopping_list_item_id is not null;
