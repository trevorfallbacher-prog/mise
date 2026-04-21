-- 0119_consumption_logs.sql
--
-- The "I ate this" feature. Every consumption event that is NOT a full
-- recipe cook lands here: eating an avocado off the pantry shelf,
-- snacking on a banana, finishing a cup of yogurt, grabbing a few
-- leftover biscuits for breakfast. cook_logs continues to hold full
-- recipe cooks; consumption_logs holds everything else.
--
-- Why a separate table rather than extending cook_logs:
--   - cook_logs carries recipe semantics (recipe_slug, rating, diners,
--     XP, favorite flags, leftover provenance). A snack has none of
--     that — cramming it in would leave most columns null and confuse
--     every existing reader of cook_logs.
--   - The notification + activity-feed triggers on cook_logs fire
--     social events ("Marissa cooked X"). Snack events should NOT fire
--     those triggers — a separate table keeps them silent by default.
--   - The dashboard's nutrition tally reads BOTH tables and sums them
--     into one stream (see src/lib/useNutritionTally.js).
--
-- Nutrition stamp semantics (mirrors cook_logs.nutrition from migration
-- 0068): the `nutrition` jsonb is a SNAPSHOT at consume-time of what
-- the resolver chain returned. We store the already-scaled macro totals
-- (not per-100g) so the tally doesn't need to rerun scaleFactor on
-- every read and the row stays accurate even if the underlying
-- canonical / brand nutrition is later edited.

create table if not exists public.consumption_logs (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,
  eaten_at           timestamptz not null default now(),

  -- The pantry row the user said they ate FROM. Nullable so a future
  -- "I ate a Clif bar that's not in my pantry" write path can log a
  -- consumption without a pantry attachment. On pantry-row deletion
  -- the reference nulls out rather than cascading — the consumption
  -- event stays on the record as a historical macro contribution.
  pantry_row_id      uuid        references public.pantry_items(id) on delete set null,

  -- Denormalized canonical id. Kept on the row so analytics + later UI
  -- ("show me every apple I've eaten this month") survive pantry-row
  -- deletion. Text rather than a FK because canonicals live in a
  -- hybrid JS/DB registry (ingredients.js + ingredient_info), not a
  -- canonical rows table.
  ingredient_id      text,

  -- Quantity + unit in the canonical's native ladder. Same shape as
  -- pantry_items.unit / pantry_items.amount so the resolver can apply
  -- scaleFactor without translation.
  amount             numeric     not null,
  unit               text        not null,

  -- Meal slot auto-inferred from eaten_at's hour (breakfast <10,
  -- lunch 10-15, dinner >=15) with user override. Null = unclassified.
  meal_slot          text        check (meal_slot in ('breakfast','lunch','dinner','snack')),

  -- Nutrition snapshot — scaled macros for THIS consumption event, not
  -- per-100g. {kcal, protein_g, fat_g, carb_g, fiber_g, sodium_mg,
  -- sugar_g}. Null when the resolver couldn't map the row to nutrition;
  -- tally skips nulls and the coverage metric surfaces the gap.
  nutrition          jsonb,

  -- When the consumption is eating leftovers from a specific cook, we
  -- point back at it for provenance + to enable "don't double-count"
  -- logic if cook_logs.nutrition already covered what got eaten at
  -- cook-time. Nullable; most consumptions are pantry-sourced and have
  -- no cook_log provenance.
  source_cook_log_id uuid        references public.cook_logs(id) on delete set null,

  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists consumption_logs_user_eaten_idx
  on public.consumption_logs (user_id, eaten_at desc);

create index if not exists consumption_logs_pantry_row_idx
  on public.consumption_logs (pantry_row_id)
  where pantry_row_id is not null;

alter table public.consumption_logs enable row level security;

-- SELECT: user's own rows + accepted-family rows. Mirrors cook_logs'
-- "connected-select" policy from migration 0013 so the dashboard can
-- roll up the whole household's macro tally without cross-family leaks.
drop policy if exists "consumption_logs: connected-select" on public.consumption_logs;
create policy "consumption_logs: connected-select"
  on public.consumption_logs for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "consumption_logs: self-insert" on public.consumption_logs;
create policy "consumption_logs: self-insert"
  on public.consumption_logs for insert
  with check (auth.uid() = user_id);

drop policy if exists "consumption_logs: self-update" on public.consumption_logs;
create policy "consumption_logs: self-update"
  on public.consumption_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "consumption_logs: self-delete" on public.consumption_logs;
create policy "consumption_logs: self-delete"
  on public.consumption_logs for delete
  using (auth.uid() = user_id);

-- Keep updated_at honest.
drop trigger if exists consumption_logs_updated_at on public.consumption_logs;
create trigger consumption_logs_updated_at
  before update on public.consumption_logs
  for each row execute function public.touch_updated_at();
