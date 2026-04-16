-- Multi-canonical item tagging.
--
-- Solves the "frozen pizza problem" the user articulated:
--
--   Items ≠ Ingredients. A single item on your shelf (a DiGiorno BBQ
--   Chicken frozen pizza, an Italian Blend cheese, a Ritz-style
--   cracker that's really a butter cracker) can carry MULTIPLE
--   canonical ingredient tags. The pizza is mozzarella + sausage +
--   pizza_dough + tomato_sauce all at once. Today pantry_items has a
--   single `ingredient_id TEXT` which forces one tag per row — that
--   works for a block of cheddar but not for composite products.
--
-- New column: `ingredient_ids TEXT[]`, defaulting to an empty array.
-- The existing `ingredient_id TEXT` column stays as-is for back-compat
-- with pre-0033 clients; new clients treat `ingredient_ids` as the
-- source of truth and keep `ingredient_id` mirrored to the first
-- element (same as the primary / display tag).
--
-- Read path: if ingredient_ids is non-empty, use it. Otherwise fall
-- back to [ingredient_id] so old rows keep matching recipes. Keeps the
-- migration invisible — existing rows don't need a backfill.
--
-- Write path: client serializes both when it has an array (the first
-- id also lands in ingredient_id so any lingering SQL that keys on the
-- single column still works). Single-tag writes still go to
-- ingredient_id alone and ingredient_ids stays empty — fine, the read
-- path covers it.
--
-- Querying items by any tag: `WHERE ingredient_id = 'mozzarella' OR
-- 'mozzarella' = ANY(ingredient_ids)` — or just use a GIN index on
-- the array for containment queries at scale (adding one below for
-- future "all pantry rows tagged with mozzarella" lookups).

alter table public.pantry_items
  add column if not exists ingredient_ids text[] not null default '{}'::text[];

-- GIN index for "find rows containing this tag" queries. The recipe
-- matcher does this lookup per-ingredient on cook-start, and the future
-- dietary filter ("show me vegetarian items") is a pure array-contains
-- operation — both benefit from indexed lookups once pantries grow.
create index if not exists pantry_items_ingredient_ids_idx
  on public.pantry_items using gin (ingredient_ids);
