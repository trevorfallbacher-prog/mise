-- 0069_scheduled_meal_slot.sql
--
-- Meal-slot + servings columns on scheduled_meals.
--
-- Today the scheduler persists just a raw scheduled_for timestamptz.
-- Users told us they want to think in meal slots (breakfast / lunch
-- / dinner / snack) rather than clock times — "dinner Thursday" is
-- closer to how they plan than "Thursday 18:30." The time input
-- stays as a secondary override, but the slot is the primary pick
-- and we carry it through so Plan can render 'DINNER · Thu 6:30 PM'
-- instead of pure time.
--
-- servings captures the user's scale pick (SchedulePicker stepper).
-- Without this the scaled recipe preview we show at schedule time
-- gets lost on save — CookMode would re-render the original amounts
-- next time they open the meal. Storing the target lets us re-run
-- scaleRecipe on the way into CookMode.
--
-- Both columns are nullable so older client builds keep working
-- (they just won't set these fields; Plan falls back to time-based
-- slot inference).

alter table public.scheduled_meals
  add column if not exists meal_slot text
  check (meal_slot is null or meal_slot in ('breakfast', 'lunch', 'dinner', 'snack'));

comment on column public.scheduled_meals.meal_slot is
  'Meal slot: breakfast | lunch | dinner | snack. Primary
   structural pick on the scheduler (see SchedulePicker.MEAL_SLOTS).
   Nullable — pre-0069 rows infer slot from scheduled_for at render.';

alter table public.scheduled_meals
  add column if not exists servings integer
  check (servings is null or (servings > 0 and servings <= 50));

comment on column public.scheduled_meals.servings is
  'Target servings for this scheduled cook. CookMode uses scaleRecipe()
   against this vs the recipe.serves default to show the right
   ingredient amounts. Nullable — pre-0069 rows render at recipe
   default.';

-- ── schema cache reload ───────────────────────────────────────────────
notify pgrst, 'reload schema';
