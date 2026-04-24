-- 0139_scheduled_meals_recipe_user_id.sql
--
-- Disambiguate which user_recipes row a scheduled_meals row points at.
-- Before this column existed, scheduled_meals.recipe_slug was the only
-- recipe pointer. That was fine when a viewer's recipe library was
-- self-only, but migration 0052 opened the door to family members
-- seeing each other's user_recipes via shared=true. useUserRecipes
-- ingests every visible row (self + family) into a single slug→recipe
-- Map, so the moment two family members both authored a recipe with
-- the same slug (e.g. both saved a "stir-fry"), lookups collapsed to
-- whichever row landed last — the viewer would open a shared recipe
-- card in the picker but the Cook surface would silently swap to
-- their own same-slug row, replacing quantities and steps with the
-- wrong content.
--
-- The fix is a companion pointer: when scheduling a user-authored
-- recipe, stamp the author's user_id alongside the slug. The client's
-- findBySlug(slug, ownerUserId) resolver uses this to pick the exact
-- row the scheduler picked, instead of last-in-wins. Nullable so
-- bundled recipes (src/data/recipes/*) keep working with slug alone
-- and pre-existing rows don't need backfill — the null case falls
-- back to the viewer's own row, which is the best guess when we have
-- no author hint. No FK constraint target change on user_recipes
-- itself — recipes are referenced by slug, not id, because the slug
-- is the stable identity the picker carries.
--
-- Client changes ship in the same commit (useScheduledMeals schedule
-- write, Plan.jsx picker + schedule wire-up, findBySlug signature
-- change). With only the migration applied and an old client, writes
-- silently skip the column (the hook uses a conditional spread) and
-- the slug-collision bug stays latent until the client catches up.

-- ── 1. Column ───────────────────────────────────────────────────────
-- on delete set null: if the author's account is deleted, the meal
-- row survives with just the slug; resolution falls back to the
-- viewer's own copy (if any) or fails to resolve (drawer shows the
-- locked-recipe fallback that already exists in Plan.jsx).

alter table public.scheduled_meals
  add column if not exists recipe_user_id uuid
  references auth.users(id) on delete set null;

-- ── 2. Index ────────────────────────────────────────────────────────
-- Not expected to be queried on directly — the client reads
-- recipe_user_id after fetching a scheduled_meals row by (user_id,
-- scheduled_for). Index omitted.
