-- 0121_count_weight_g.sql
--
-- Per-pantry-row override for count→grams conversion. The canonical
-- registry declares one `toBase` per count-unit item (chicken_breast =
-- 200g per breast, egg = 50g per egg, etc.) but actual packs vary
-- wildly. A 680g four-pack of chicken breasts is 170g each, not 200g.
-- Without this column every "I ate 1 breast" event silently misreports
-- kcal by ±20% based on how the canonical was seeded vs the real pack.
--
-- When `count_weight_g` is non-null on a pantry_items row, scaleFactor
-- and the nutrition resolver prefer it over the canonical's count-unit
-- toBase. Null = use the canonical default (or derive at write-time
-- from the row's own packageAmount when all three signals are present).
-- Either way the bundled canonical stays correct as a fallback for
-- rows the user hasn't calibrated.
--
-- Schema shape: numeric so we can carry fractional grams (14.2g for
-- breakfast link sausage, etc.), nullable so pre-0121 rows and rows
-- without a count unit continue to serialize without an untouched
-- field. Defensive mapping in usePantry.fromDb/toDb gates reads/writes
-- on column presence so an un-migrated DB keeps working.

alter table public.pantry_items
  add column if not exists count_weight_g numeric;

comment on column public.pantry_items.count_weight_g is
  'Per-count grams override for count-unit rows (chicken_breast, sausage links, hot dogs). When set, wins over canonical.toBase in scaleFactor. Null = use canonical default.';
