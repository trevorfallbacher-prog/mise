-- Base canonicals for beef / pork / turkey — retire state-baked slugs.
--
-- CLAUDE.md's identity hierarchy keeps state on a separate axis
-- (purple) from canonical (tan). The bundled registry historically
-- violated this by creating distinct canonicals `ground_beef`,
-- `ground_pork`, `ground_turkey` — baking the state into the
-- identity. Pantry rows written against those slugs stacked
-- separately from their base-species siblings, the AI recipe
-- protein picker rendered duplicate "Ground" chips, and the model
-- couldn't reason about beef-as-beef regardless of form.
--
-- This migration rewrites `pantry_items.canonical_id` from the
-- deprecated slugs to the new base canonicals (`beef`, `pork`,
-- `turkey`) and fills the `state` column with 'ground' when it
-- was null — matching the implicit semantics the old slug carried.
--
-- Client-side `findIngredient` + the new `CANONICAL_ALIASES` map
-- (src/data/ingredients.js) already route lookups through the base
-- slug, so rows not yet migrated continue to render correctly.
-- This migration is the eventual cleanup; it's safe to run
-- multiple times (no-op the second time through).
--
-- Use `COALESCE(state, 'ground')` so an explicit state the user
-- set (rare — maybe they typed "ground" into a state override,
-- or the scanner's detectStateFromText picked up "SHRD") is not
-- overwritten. Only null states default to 'ground'.

update public.pantry_items
   set canonical_id = 'beef',
       state        = coalesce(state, 'ground')
 where canonical_id = 'ground_beef';

update public.pantry_items
   set canonical_id = 'pork',
       state        = coalesce(state, 'ground')
 where canonical_id = 'ground_pork';

update public.pantry_items
   set canonical_id = 'turkey',
       state        = coalesce(state, 'ground')
 where canonical_id = 'ground_turkey';

-- Pre-existing rows where the display read "Chicken (whole)" — the
-- slug was `chicken` already (base), but "whole" is a state-shaped
-- descriptor that should live on the state column, not in the
-- display name. This migration doesn't touch canonical_id (already
-- correct); just fills null state with 'whole' so the identity
-- stack reads the state axis explicitly.
--
-- Only applies when state is null AND the user didn't already set
-- something different. Skipped rows keep whatever state they had.
update public.pantry_items
   set state = 'whole'
 where canonical_id = 'chicken'
   and state is null;

-- Verification queries (run manually after applying):
--
--   -- All pantry_items should now carry canonical_id in (beef,
--   -- pork, turkey) — never ground_*.
--   select canonical_id, count(*)
--     from public.pantry_items
--    where canonical_id in ('ground_beef','ground_pork','ground_turkey')
--    group by canonical_id;
--   -- expect: 0 rows
--
--   -- Spot-check: rows that got migrated should now have state
--   -- filled in.
--   select canonical_id, state, count(*)
--     from public.pantry_items
--    where canonical_id in ('beef','pork','turkey','chicken')
--    group by canonical_id, state
--    order by canonical_id, state;
