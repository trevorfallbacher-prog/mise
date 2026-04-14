-- mise — servings on scheduled meals
--
-- Adds a `servings` column so the Plan can show "Cooking for 4" and we can
-- scale shopping-list estimates. Default matches the recipe's own default
-- (which isn't in the DB), so we fall back to 2 at the row level and let the
-- app override before insert when it knows better.
--
-- Safe to re-run.

alter table public.scheduled_meals
  add column if not exists servings integer not null default 2
    check (servings between 1 and 20);

notify pgrst, 'reload schema';
