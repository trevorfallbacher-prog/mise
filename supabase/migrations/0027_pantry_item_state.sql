-- Phase 2 continuation: ingredient state tracking.
--
-- Adds a nullable `state` column to pantry_items so one ingredient id can
-- exist in multiple physical forms in the pantry simultaneously. Bread
-- might live as a loaf, a bag of slices, and a jar of crumbs — all three
-- are the same ingredientId ("bread") but different rows with different
-- states.
--
-- Canonical state vocabulary (free text for now, enforced by the client;
-- promoting to a CHECK constraint once the registry has stabilized):
--
--   Bread:    loaf, slices, crumbs, cubes, toasted
--   Cheese:   block, grated, shredded, sliced, cubed
--   Chicken:  raw, cooked, shredded_cooked, diced_cooked, ground
--   Salt:     fine, coarse, flaky
--   Onion:    whole, diced, sliced, minced
--   Garlic:   head, cloves, minced, paste, roasted
--   Lemon:    whole, juiced, zested
--
-- NULL means "no state distinction" — milk, oil, single-form ingredients
-- never set this and existing rows keep working as-is.
--
-- Matching rule (enforced in the recipe-to-pantry matcher):
--   recipe calls for state='crumbs'  → pantry row must have state='crumbs'
--   recipe doesn't specify state      → any pantry row with the same id
--                                       matches regardless of state
--
-- The "Make crumbs from loaf" convert flow will decrement the source row
-- and insert a new pantry row with the target state, same ingredientId.

alter table public.pantry_items
  add column if not exists state text null;

-- No index needed yet — state is always read in conjunction with a
-- user_id + ingredient_id filter, which already has good coverage via
-- the existing pantry_items_user_idx.
