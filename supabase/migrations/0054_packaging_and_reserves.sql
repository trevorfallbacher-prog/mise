-- 0054_packaging_and_reserves.sql
--
-- Reserve-unit accounting for discrete-package pantry items.
--
-- Before this migration, every pantry row used a single liquid-gauge
-- model: amount / unit / max, depleted linearly as the user cooked.
-- That's fine for olive oil in a bottle but a poor fit for canned and
-- dried goods where humans think in units ("5 cans of Spam in the
-- cupboard, one I'm working through"). The gauge would have to
-- encode both the open package AND the sealed reserves in a single
-- number, and it just doesn't.
--
-- This migration adds three optional columns so a row can carry a
-- two-tier quantity: a currently-open package (amount / unit, as
-- before) plus an integer reserve_count of sealed packages. The
-- package's standard size lives in package_amount / package_unit so
-- the client can render a segmented gauge — one block per sealed
-- unit, last block partially filled by the open one.
--
-- Rows opt in by having a non-null package_amount. Rows without it
-- (olive oil, flour-by-weight, anything where the package doesn't
-- matter) keep the existing liquid-gauge behavior untouched.
--
-- Client math:
--   total on-hand = amount + reserve_count * package_amount
--   low-threshold trigger fires against that total, so a row with 0
--   open and 3 reserves won't falsely mark as low.

alter table public.pantry_items
  add column if not exists package_amount numeric,
  add column if not exists package_unit   text,
  add column if not exists reserve_count  integer not null default 0;

-- Defensive — reserve_count should never be negative. A missed
-- decrement during cook-mode accounting could theoretically push it
-- below zero; the CHECK stops that from persisting.
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'pantry_items_reserve_count_nonneg'
  ) then
    alter table public.pantry_items
      add constraint pantry_items_reserve_count_nonneg
      check (reserve_count >= 0);
  end if;
end $$;

-- Schema cache reload so PostgREST picks up the new columns.
notify pgrst, 'reload schema';
