-- 0124_scheduled_meals_ingredient_eat.sql
--
-- Let scheduled_meals rows represent "plan to eat THIS pantry row at
-- THAT time" — not just "plan to cook THIS recipe". Users want to
-- schedule a raw chicken breast for lunch the same way they can
-- schedule a recipe. Migration 0120 wired from_pantry_row_id for
-- leftover meal rows (which always carry a source_recipe_slug copied
-- from the cook); this extends that to ingredient rows that have no
-- recipe provenance at all.
--
-- Two changes:
--   1. recipe_slug drops NOT NULL — ingredient-eat rows have no recipe.
--   2. A CHECK ensures every row still has at least one identity
--      pointer so Plan can always render the slot as something
--      (either the recipe or the pantry row it references).

alter table public.scheduled_meals
  alter column recipe_slug drop not null;

alter table public.scheduled_meals
  drop constraint if exists scheduled_meals_has_identity;

alter table public.scheduled_meals
  add constraint scheduled_meals_has_identity
    check (recipe_slug is not null or from_pantry_row_id is not null);
