-- 0083_recipe_mastery.sql
--
-- Per-user, per-recipe cook counter. Drives the 5× / 10× / 25×
-- "Dialed In" milestone bonuses (+25 / +75 / +200) without
-- re-scanning cook_logs on every cook.
--
-- award_xp() increments cook_count atomically when source =
-- cook_complete, then checks whether the new count crossed a
-- milestone boundary and fires mastery_5x / mastery_10x /
-- mastery_25x as follow-up events.
--
-- recipe_key is text (same shape as recipe_first_cooks.recipe_key)
-- so bundled slugs and user_recipes.id both fit.
--
-- last_xp_event_id records the most recent milestone event so the
-- UI can link "you hit 10× on Aglio e Olio" back to its beat row.
--
-- See docs/plans/xp-leveling.md §1 + §6.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.recipe_mastery (
  user_id              uuid         not null references auth.users(id) on delete cascade,
  recipe_key           text         not null,
  cook_count           int          not null default 0,
  last_cooked_at       timestamptz,
  last_milestone       int,
  last_xp_event_id     uuid         references public.xp_events(id) on delete set null,
  primary key (user_id, recipe_key)
);

-- ── 2. Indexes ──────────────────────────────────────────────────────

create index if not exists recipe_mastery_user_count_idx
  on public.recipe_mastery (user_id, cook_count desc);

-- ── 3. Row-level security ───────────────────────────────────────────

alter table public.recipe_mastery enable row level security;

drop policy if exists "recipe_mastery: self-select" on public.recipe_mastery;
create policy "recipe_mastery: self-select"
  on public.recipe_mastery for select
  to authenticated
  using (auth.uid() = user_id);
