-- 0082_recipe_first_cooks.sql
--
-- Dedup table for the "first-time cooking ANY recipe" +100 bonus.
-- One row per (user, recipe_key) the first time that combination
-- cooks. award_xp() inserts with ON CONFLICT DO NOTHING; if the
-- insert affected a row, the user earned the bonus this cook.
--
-- recipe_key is text because it has to carry both bundled-recipe
-- slugs ("aglio-e-olio") and user_recipes.id (uuid rendered as
-- text). The resolver at call-time stringifies whichever one
-- applies.
--
-- See docs/plans/xp-leveling.md §1 + §6.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.recipe_first_cooks (
  user_id     uuid         not null references auth.users(id) on delete cascade,
  recipe_key  text         not null,
  cooked_at   timestamptz  not null default now(),
  xp_event_id uuid         references public.xp_events(id) on delete set null,
  primary key (user_id, recipe_key)
);

-- ── 2. Indexes ──────────────────────────────────────────────────────

create index if not exists recipe_first_cooks_user_idx
  on public.recipe_first_cooks (user_id, cooked_at desc);

-- ── 3. Row-level security ───────────────────────────────────────────

alter table public.recipe_first_cooks enable row level security;

drop policy if exists "recipe_first_cooks: self-select" on public.recipe_first_cooks;
create policy "recipe_first_cooks: self-select"
  on public.recipe_first_cooks for select
  to authenticated
  using (auth.uid() = user_id);
