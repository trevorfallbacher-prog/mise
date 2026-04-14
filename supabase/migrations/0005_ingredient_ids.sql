-- mise — ingredient_id column for pantry + shopping list
--
-- Canonical ingredients live in client code (src/data/ingredients.js) and are
-- referenced by id. Items added from the dropdown get an ingredient_id, which
-- is how recipes match against the pantry (rather than fuzzy-matching on name).
-- Free-text items stay supported — they just have ingredient_id = NULL and
-- won't match any recipe.
--
-- Safe to re-run.

alter table public.pantry_items
  add column if not exists ingredient_id text;

alter table public.shopping_list_items
  add column if not exists ingredient_id text;

create index if not exists pantry_items_ingredient_idx
  on public.pantry_items (user_id, ingredient_id);

create index if not exists shopping_list_items_ingredient_idx
  on public.shopping_list_items (user_id, ingredient_id);
