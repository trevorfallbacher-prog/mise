-- Phase 2 of the compound-ingredient work. Adds the columns the
-- post-cook pantry-reconcile flow needs to tell ingredients apart
-- from finished-meal leftovers, and to decrement partial-use rows
-- without the "0.4 bottle" rounding surprise.
--
-- New columns on pantry_items (all nullable / safely defaulted so
-- existing rows keep working untouched):
--
--   kind
--     'ingredient' (default) — a raw or compound ingredient row, what
--                              pantry_items has always tracked. Matched
--                              by ingredientId.
--     'meal'       — leftovers from a finished cook. These rows carry
--                    a servings_remaining + source_cook_log_id instead
--                    of an ingredientId. Merge by source_cook_log_id,
--                    not ingredientId (you can have leftover carbonara
--                    AND leftover cacio e pepe in the fridge; both are
--                    'meal' rows but they're distinct).
--
--   servings_remaining
--     For kind='meal' rows, the fractional-servings count left in the
--     fridge / freezer / pantry. Stored as numeric so 0.5, 0.25, 0.125
--     all land cleanly. Null for kind='ingredient' rows — they use
--     amount+unit as they always have.
--
--   source_recipe_slug
--     For kind='meal' rows and for kind='ingredient' rows that came
--     out of a scratch recipe's `produces` field, the slug of the
--     recipe that created this row. Lets the UI link back ("made
--     from Homemade Sriracha on Apr 12").
--
--   source_cook_log_id
--     The cook_logs row this pantry row was created from. Lets us
--     keep per-cook traceability without joining on slug + user +
--     timestamp heuristics. Null for manually added rows.
--
-- No trigger, no backfill, no RLS changes. The existing RLS policies
-- on pantry_items still key on user_id, which is unchanged.

alter table public.pantry_items
  add column if not exists kind               text     not null default 'ingredient',
  add column if not exists servings_remaining numeric  null,
  add column if not exists source_recipe_slug text     null,
  add column if not exists source_cook_log_id uuid     null;

-- Validate the kind enumeration at the DB level so a typo client-side
-- can't silently land a 'meals' (plural) row that nothing queries for.
alter table public.pantry_items
  drop constraint if exists pantry_items_kind_check;

alter table public.pantry_items
  add constraint pantry_items_kind_check
    check (kind in ('ingredient', 'meal'));

-- The Cookbook / future "eat a leftover" flow will want to surface
-- all meal rows for a given cook log. Small partial index keeps it cheap.
create index if not exists pantry_items_cook_log_idx
  on public.pantry_items (source_cook_log_id)
  where source_cook_log_id is not null;
