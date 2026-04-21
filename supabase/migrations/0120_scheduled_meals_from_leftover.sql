-- 0120_scheduled_meals_from_leftover.sql
--
-- Phase 3 scheduling-leftovers: let a scheduled_meals row optionally
-- reference a specific leftover pantry row. When the slot fires, the
-- client opens the "I ate this" sheet on that pantry row instead of
-- CookMode — the user is consuming an existing meal, not cooking a
-- new one. The recipe_slug stays populated (it's the slug the
-- leftover was originally cooked from, copied from the meal row's
-- source_recipe_slug) so the calendar card keeps its title, emoji,
-- and cuisine without extra joins.
--
-- Nullable because scheduling-from-recipe (the original flow) stays
-- the default — leftover scheduling is additive, not a replacement.
-- ON DELETE SET NULL so a deleted leftover doesn't take the planned
-- slot down with it; the calendar card just degrades to a regular
-- scheduled cook and the user can still cook the recipe fresh.

alter table public.scheduled_meals
  add column if not exists from_pantry_row_id uuid
    references public.pantry_items(id) on delete set null;

create index if not exists scheduled_meals_from_pantry_idx
  on public.scheduled_meals (from_pantry_row_id)
  where from_pantry_row_id is not null;
