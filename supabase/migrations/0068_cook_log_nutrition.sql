-- 0068_cook_log_nutrition.sql
--
-- Nutrition tracking on completed cooks + per-user daily targets.
--
-- Today every cook_logs row captures recipe identity, rating, diners,
-- and XP — but the macros computed at recipe-render time via
-- recipeNutrition() are thrown away the moment the cook confirms. No
-- persisted log = no running tally = no "what did I eat this week"
-- surface. This migration stamps per-serving macros on each cook and
-- gives every profile a configurable daily target so the upcoming
-- NutritionDashboard can render progress bars against a goal.
--
-- cook_logs.nutrition shape (documented; schema enforces none):
--   {
--     "kcal":       520,
--     "protein_g":  28,
--     "fat_g":      22,
--     "carb_g":     45,
--     "fiber_g":    6,
--     "sodium_mg":  480,
--     "sugar_g":    4,
--     "coverage":   { "resolved": 7, "total": 9 }
--   }
-- Per-serving, not per-recipe — one eater = one serving. Reader
-- attributes one serving to the chef and one to each diner. Nullable
-- for pre-0068 rows; the tally hook skips nulls and discloses them
-- as "based on N of M meals" so coverage gaps stay honest.
--
-- profiles.nutrition_targets shape:
--   { "kcal": 2000, "protein_g": 150, "fat_g": 65, "carb_g": 250 }
-- Default is a rough 2000-kcal adult baseline; users edit via the
-- goal editor on the NutritionDashboard.

alter table public.cook_logs
  add column if not exists nutrition jsonb;

comment on column public.cook_logs.nutrition is
  'Per-serving macros stamped at cook-complete via recipeNutrition().
   Shape: { kcal, protein_g, fat_g, carb_g, fiber_g, sodium_mg,
   sugar_g, coverage: { resolved, total } }. One serving = recipe.serves
   from the registry (already normalized inside recipeNutrition).
   Nullable for pre-0068 rows; tally hook skips nulls.';

-- How many recipe-servings each eater actually consumed. Default 1 —
-- "four people cooked and ate a four-serving lasagna, one slice each"
-- is the common case. Chef bumps this up for "solo chef ate three of
-- four" (→ 3) or down for "family of four shared a two-serving recipe"
-- (→ 0.5). Per-eater, not per-cook, so the tally math is dead simple:
--   per_eater_macros = perServing × servings_per_eater
-- numeric(4,2) allows 0.25 increments up to 99.99 — plenty of
-- headroom without inviting pathological inputs.
alter table public.cook_logs
  add column if not exists servings_per_eater numeric(4,2)
  not null default 1;

comment on column public.cook_logs.servings_per_eater is
  'How many recipe-servings each eater (chef + each diner) consumed.
   Default 1. Tally: per_eater_macros = nutrition × servings_per_eater.
   Stepper UI on CookComplete lets the chef adjust for leftovers /
   second helpings / splits.';

alter table public.profiles
  add column if not exists nutrition_targets jsonb
  not null default '{"kcal":2000,"protein_g":150,"fat_g":65,"carb_g":250}'::jsonb;

comment on column public.profiles.nutrition_targets is
  'Per-user daily macro targets. Default 2000 kcal / 150g protein /
   65g fat / 250g carbs. Edited from NutritionDashboard goal editor.';

-- ── schema cache reload ───────────────────────────────────────────────
notify pgrst, 'reload schema';
