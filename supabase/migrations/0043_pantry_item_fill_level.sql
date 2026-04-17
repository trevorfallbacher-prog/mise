-- 0043_pantry_item_fill_level.sql
--
-- Proportional inventory — fill_level on pantry_items.
--
-- THE GAP:
--
--   Today a pantry row tracks `amount` (e.g. 1, unit 'bottle') but
--   doesn't know how FULL that bottle is. A half-empty ketchup and
--   a brand-new one both read "1 bottle" in the Kitchen. For items
--   you don't weigh or count (oils, dressings, jars of sauce, blocks
--   of cheese, gallons of milk), the real question is "how much is
--   left?" not "how many do I have?"
--
--   The pantry_item_components.proportion column (0034) captures a
--   RECIPE'S use of a source — "I used 30% of the salt jar in this
--   cook" — but it's attached to a component row, not the pantry
--   row itself. It can't answer "walk up to the fridge — how full
--   is the ketchup?"
--
-- THE COLUMN:
--
--   fill_level  numeric(4,3) null
--     * null    — not tracked. Rows default here. The UI renders
--                 them exactly as before (no fill indicator, no
--                 slider) so counted items (6 eggs, 3 cans of beans)
--                 stay clean.
--     * 0.0 .. 1.0 — tracked. 1.0 = FULL, 0.125 = ⅛, 0.0 = empty.
--                 CHECK enforces the range.
--
--   Deliberately ORTHOGONAL to amount. A bottle of olive oil may
--   be (amount=1, unit='bottle', fill_level=0.33) — "one bottle,
--   about a third left." Two cartons of milk where one's finished:
--   (amount=1, unit='carton', fill_level=0.5) plus a second row for
--   the full one, or (amount=2, fill_level=0.75) for the average —
--   the UI lets the user pick which model feels right per item.
--
-- INTENTIONAL NON-GOALS FOR THIS MIGRATION:
--
--   * Auto-decrement from cook_logs. Finishing chunk A (per-component
--     proportion slider on Cook) lands that wiring — this migration
--     just ships the storage.
--   * A separate "capacity" or "original_amount" column. We're not
--     trying to reconstruct absolute remaining ounces; fill_level is
--     a pure ratio, same semantics the CookComplete leftover picker
--     already uses.
--
-- IDEMPOTENT — single ALTER with IF NOT EXISTS + a guarded CHECK.

alter table public.pantry_items
  add column if not exists fill_level numeric(4,3) null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pantry_items_fill_level_check'
  ) then
    alter table public.pantry_items
      add constraint pantry_items_fill_level_check
      check (fill_level is null or (fill_level >= 0 and fill_level <= 1));
  end if;
end $$;

notify pgrst, 'reload schema';
