-- mise — scheduled meals table
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Each row = "cook THIS recipe at THIS time, with THESE notifications on."
-- Recipe identity is stored as a `recipe_slug` string (references the static
-- library in src/data/recipes/). When we move recipes into the DB later,
-- we'll migrate this to a recipe_id uuid with a real foreign key.

create table if not exists public.scheduled_meals (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,

  recipe_slug   text        not null,
  scheduled_for timestamptz not null,        -- local wall-clock chosen by user, stored as UTC

  -- map of notification id → bool (user's per-notification opt-in).
  -- e.g. { "soften-butter": true, "marinate": false }
  notification_settings jsonb not null default '{}'::jsonb,

  status        text        not null default 'planned'
                check (status in ('planned', 'cooked', 'skipped')),

  -- optional free-text note from the user ("for Sarah's birthday")
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists scheduled_meals_user_day_idx
  on public.scheduled_meals (user_id, scheduled_for);

-- Reuse the generic trigger defined in 0001_init.sql
drop trigger if exists scheduled_meals_touch_updated_at on public.scheduled_meals;
create trigger scheduled_meals_touch_updated_at
before update on public.scheduled_meals
for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: a user sees and mutates only their own scheduled meals
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.scheduled_meals enable row level security;

drop policy if exists "scheduled_meals: self-select" on public.scheduled_meals;
create policy "scheduled_meals: self-select"
  on public.scheduled_meals for select
  using (auth.uid() = user_id);

drop policy if exists "scheduled_meals: self-insert" on public.scheduled_meals;
create policy "scheduled_meals: self-insert"
  on public.scheduled_meals for insert
  with check (auth.uid() = user_id);

drop policy if exists "scheduled_meals: self-update" on public.scheduled_meals;
create policy "scheduled_meals: self-update"
  on public.scheduled_meals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "scheduled_meals: self-delete" on public.scheduled_meals;
create policy "scheduled_meals: self-delete"
  on public.scheduled_meals for delete
  using (auth.uid() = user_id);
