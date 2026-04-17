-- 0051_user_recipes.sql
--
-- Storage for user-authored recipes (CUSTOM recipe builder + AI-generated).
--
-- Until this migration, every recipe CookMode could load was bundled at
-- build time via src/data/recipes/index.js. The new Quick Cook flow adds
-- two paths — the custom-recipe builder and the AI draft flow — that
-- need to persist their output so the cook can be repeated, scheduled,
-- or referenced from a cook_logs row later on.
--
-- Shape mirrors the bundled schema (src/data/recipes/schema.js) so the
-- same CookMode / CookComplete / cook_logs pipeline accepts either
-- source interchangeably: bundled recipes are resolved by slug in JS,
-- user recipes resolve by slug from this table.
--
-- cook_logs.recipe_slug remains plain text — it points at a bundled
-- slug ("aglio-e-olio") OR a user_recipes slug, and findRecipe() checks
-- both. No foreign key either side so a user deleting a custom recipe
-- doesn't cascade their cook history.
--
-- ROW SCOPE: family-shared, following cook_logs / pantry_items. A user's
-- recipe is visible to every accepted family member; writes are self-only.

-- ── 1. table ──────────────────────────────────────────────────────────
create table if not exists public.user_recipes (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  slug        text        not null,
  source      text        not null
                          check (source in ('custom', 'ai')),
  recipe      jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, slug)
);

-- ── 2. indexes ────────────────────────────────────────────────────────
create index if not exists user_recipes_user_idx
  on public.user_recipes (user_id);

create index if not exists user_recipes_slug_idx
  on public.user_recipes (slug);

-- ── 3. updated_at trigger ────────────────────────────────────────────
-- Reuses public.touch_updated_at defined alongside ingredient_info
-- (migration 0028).
drop trigger if exists user_recipes_touch_updated_at
  on public.user_recipes;
create trigger user_recipes_touch_updated_at
  before update on public.user_recipes
  for each row execute function public.touch_updated_at();

-- ── 4. RLS ───────────────────────────────────────────────────────────
alter table public.user_recipes enable row level security;

-- SELECT: self + accepted family (mirrors cook_logs).
drop policy if exists "user_recipes: self+family select"
  on public.user_recipes;
create policy "user_recipes: self+family select"
  on public.user_recipes for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- INSERT / UPDATE / DELETE: author-only.
drop policy if exists "user_recipes: self insert"
  on public.user_recipes;
create policy "user_recipes: self insert"
  on public.user_recipes for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_recipes: self update"
  on public.user_recipes;
create policy "user_recipes: self update"
  on public.user_recipes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_recipes: self delete"
  on public.user_recipes;
create policy "user_recipes: self delete"
  on public.user_recipes for delete
  using (auth.uid() = user_id);

-- ── 5. realtime ──────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_recipes'
  ) then
    alter publication supabase_realtime add table public.user_recipes;
  end if;
end $$;

-- ── 6. schema cache reload ───────────────────────────────────────────
notify pgrst, 'reload schema';
