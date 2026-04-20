-- 0064_meals.sql
--
-- MEAL composition — a bundle of recipes cooked together.
--
-- Recipes stay atomic in user_recipes; a MEAL is just a pointer-set
-- that groups them. A given recipe can appear in N meals (your go-to
-- garlic mash pairs with ribeye tonight AND pork chops next week —
-- one user_recipes row, two meal_recipes rows).
--
-- DESIGN RULES (from the MEAL-composition plan):
--   1. Pieces are REUSABLE. Deleting a meal cascades only to
--      meal_recipes, NEVER to user_recipes — the side/dessert lives
--      on in the library regardless of the meal it was drafted in.
--   2. recipe_slug is free-text (same convention as
--      scheduled_meals.recipe_slug / cook_logs.recipe_slug) so it
--      can point at either a bundled recipe ("cacio-e-pepe") or a
--      user_recipes row ("my-ribeye-sear-2"). No foreign key on
--      recipe_slug — bundled recipes aren't in the DB.
--   3. course enum matches AIRecipe's COMPOSE_SLOTS + "main". "bake"
--      and "prep" are NOT valid inside a meal — those are pantry-
--      building component recipes and don't belong to a plate.
--
-- ROW SCOPE: family-shared, mirroring user_recipes (migration 0051).
-- A user's meal is visible to every accepted family member; writes
-- are self-only.

-- ── 1. meals table ───────────────────────────────────────────────────
create table if not exists public.meals (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  -- Display name. Auto-generated from the anchor recipe's title at
  -- save time ("Ribeye Italian Dinner") but user-editable after.
  name          text        not null,
  -- Anchor's emoji by default. Used in calendar tiles and library
  -- lists so a meal reads at a glance.
  emoji         text,
  -- Inherited from the anchor recipe — lets the library filter
  -- meals by cuisine the same way recipes filter today.
  cuisine       text,
  -- When this meal is typically eaten. Null means "no specific
  -- slot" — e.g. a snack-board bundle that floats freely. Phase 4
  -- ties this to calendar slots (breakfast / lunch / dinner).
  meal_timing   text        check (meal_timing in ('breakfast', 'lunch', 'dinner')),
  -- Slug of the MAIN recipe the meal was built around. Kept
  -- separately from meal_recipes so the UI can highlight the
  -- "hero" without re-scanning the pieces list, and so deleting
  -- the main piece row doesn't orphan the meal's identity.
  anchor_slug   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 2. meal_recipes join table ───────────────────────────────────────
-- Pure pointer table. Each row pins one recipe into one meal with a
-- course role. A recipe can appear in many meals (composite PK is
-- per-meal + per-slug, so the same slug can't appear twice in the
-- SAME meal but can appear in different meals freely).
create table if not exists public.meal_recipes (
  meal_id       uuid        not null references public.meals(id) on delete cascade,
  recipe_slug   text        not null,
  course        text        not null
                            check (course in ('main', 'side', 'dessert', 'appetizer')),
  sort_order    integer     not null default 0,
  primary key (meal_id, recipe_slug)
);

-- ── 3. indexes ────────────────────────────────────────────────────────
create index if not exists meals_user_idx
  on public.meals (user_id);

create index if not exists meals_user_created_idx
  on public.meals (user_id, created_at desc);

create index if not exists meal_recipes_meal_idx
  on public.meal_recipes (meal_id);

create index if not exists meal_recipes_slug_idx
  on public.meal_recipes (recipe_slug);

-- ── 4. updated_at trigger ────────────────────────────────────────────
-- Reuses public.touch_updated_at (migration 0028).
drop trigger if exists meals_touch_updated_at on public.meals;
create trigger meals_touch_updated_at
  before update on public.meals
  for each row execute function public.touch_updated_at();

-- ── 5. RLS ───────────────────────────────────────────────────────────
alter table public.meals         enable row level security;
alter table public.meal_recipes  enable row level security;

-- meals: self + accepted family select; self-only mutate. Mirrors
-- user_recipes policy so a meal is as visible as its pieces.
drop policy if exists "meals: self+family select" on public.meals;
create policy "meals: self+family select"
  on public.meals for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "meals: self insert" on public.meals;
create policy "meals: self insert"
  on public.meals for insert
  with check (auth.uid() = user_id);

drop policy if exists "meals: self update" on public.meals;
create policy "meals: self update"
  on public.meals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "meals: self delete" on public.meals;
create policy "meals: self delete"
  on public.meals for delete
  using (auth.uid() = user_id);

-- meal_recipes: visible to whoever can see the parent meal. Mutations
-- require ownership of the parent. Delegating both to an EXISTS
-- subquery against meals keeps the policy in lockstep with meals
-- visibility — loosening meals later (e.g. public library) would
-- automatically open up meal_recipes too.
drop policy if exists "meal_recipes: via meal select" on public.meal_recipes;
create policy "meal_recipes: via meal select"
  on public.meal_recipes for select
  using (
    exists (
      select 1 from public.meals m
      where m.id = meal_id
        and (
          m.user_id = auth.uid()
          or m.user_id in (select public.family_ids_of(auth.uid()))
        )
    )
  );

drop policy if exists "meal_recipes: via meal insert" on public.meal_recipes;
create policy "meal_recipes: via meal insert"
  on public.meal_recipes for insert
  with check (
    exists (
      select 1 from public.meals m
      where m.id = meal_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "meal_recipes: via meal update" on public.meal_recipes;
create policy "meal_recipes: via meal update"
  on public.meal_recipes for update
  using (
    exists (
      select 1 from public.meals m
      where m.id = meal_id and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.meals m
      where m.id = meal_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "meal_recipes: via meal delete" on public.meal_recipes;
create policy "meal_recipes: via meal delete"
  on public.meal_recipes for delete
  using (
    exists (
      select 1 from public.meals m
      where m.id = meal_id and m.user_id = auth.uid()
    )
  );

-- ── 6. realtime ──────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meals'
  ) then
    alter publication supabase_realtime add table public.meals;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meal_recipes'
  ) then
    alter publication supabase_realtime add table public.meal_recipes;
  end if;
end $$;

-- ── 7. schema cache reload ───────────────────────────────────────────
notify pgrst, 'reload schema';
