-- Family-shared user item templates + their component trees.
--
-- A **Template** is a user's saved identity for a recurring item —
-- name + emoji + category + default unit/amount/location + its
-- composition. Saved automatically the first time a user adds a
-- custom item; bumped in use_count + last_used_at on every re-add.
--
-- Solves the data-cleaning bottleneck. The bundled canonical registry
-- can't capture every brand-specific product ("Home Run Inn Pizza"),
-- every household name ("Mom's Marinara"), every regional composite.
-- Templates let users build this layer themselves, family-shared, and
-- the most-used ones can eventually be promoted by admins into a
-- global tier (promoted_at).
--
-- Relationship to pantry_items:
--   * A template is the BLUEPRINT. "Home Run Inn Pizza" the concept.
--   * A pantry_items row is an INSTANCE. "The Home Run Inn pizza
--     sitting in my freezer right now."
--   * Adding an item from a template: clone the template's identity
--     into a new pantry_items row + clone its components into
--     pantry_item_components. Bump use_count + last_used_at on the
--     template.
--
-- Dedup strategy (decided 2026-04-16):
--   Strict per-family uniqueness on name. If a family member has
--   already created "Home Run Inn Pizza", the next family member who
--   types that name gets the existing template as a suggestion rather
--   than creating a duplicate. Dedup is APPLICATION-LEVEL (client
--   queries first and upserts onto existing when a match is found in
--   family scope) — Postgres unique constraints can't span family
--   relationships cleanly because family membership is resolved
--   through the family_ids_of() function, not a column. The per-user
--   unique index below is a backstop: a single user can't create two
--   templates with the same normalized name by accident.
--
-- Component tree:
--   user_item_template_components mirrors pantry_item_components
--   exactly. Templates can contain canonical-ingredient components
--   (the overwhelming majority case) OR other templates (a
--   "Loaded Pizza Night" template could reference "Home Run Inn
--   Pizza" + "House Salad" templates). The schema supports both
--   shapes; initial UI surfaces only ingredient-kind components and
--   template-to-template refs land in a follow-up.

-- ── 1. user_item_templates ──────────────────────────────────────────

create table if not exists public.user_item_templates (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,

  -- User-facing name. Preserved exactly as typed for display.
  name              text        not null,

  -- Normalized name (lowercased + trimmed + internal-whitespace-collapsed)
  -- used for strict dedup lookups. Maintained by the client on write.
  -- Indexed uniquely per user; family-scoped uniqueness is enforced
  -- application-side because it spans rows with different user_ids.
  name_normalized   text        not null,

  -- Identity carried into new pantry_items when the template is used.
  emoji             text        null,
  category          text        null,
  default_unit      text        null,
  default_amount    numeric     null,
  default_location  text        null check (default_location is null
                      or default_location in ('fridge','pantry','freezer')),

  -- Flattened canonical tags — same semantics as pantry_items.ingredient_ids.
  -- GIN-indexed for "templates containing mozzarella" lookups later.
  ingredient_ids    text[]      not null default '{}'::text[],

  -- Popularity tracking. use_count increments on every instantiation;
  -- last_used_at refreshes on every instantiation + direct edit.
  -- Powers the "recents" ranking in AddItemModal and (future) the
  -- admin-promotion signal for turning popular templates into global
  -- composites.
  use_count         integer     not null default 1,
  last_used_at      timestamptz not null default now(),

  -- Nullable timestamp. Non-null = admin has promoted this template
  -- into the global community-composites tier. Kept on this row so
  -- the user sees their contribution landed; actual global tier lives
  -- in a separate (future) table populated by the admin tooling.
  promoted_at       timestamptz null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Backstop: a single user can't have two templates with the same
-- normalized name. Family-scoped dedup is application-level (see
-- comment above).
create unique index if not exists user_item_templates_user_normalized_uq
  on public.user_item_templates (user_id, name_normalized);

-- Hot path: "my (and family's) recents, newest-first."
create index if not exists user_item_templates_user_recent_idx
  on public.user_item_templates (user_id, last_used_at desc);

-- Reverse lookup: "templates containing mozzarella" — dietary filter,
-- recipe substitution suggestions.
create index if not exists user_item_templates_ingredient_ids_idx
  on public.user_item_templates using gin (ingredient_ids);

-- ── RLS: family-shared ──────────────────────────────────────────────

alter table public.user_item_templates enable row level security;

drop policy if exists "user_item_templates: family-select" on public.user_item_templates;
create policy "user_item_templates: family-select"
  on public.user_item_templates for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "user_item_templates: family-insert" on public.user_item_templates;
create policy "user_item_templates: family-insert"
  on public.user_item_templates for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "user_item_templates: family-update" on public.user_item_templates;
create policy "user_item_templates: family-update"
  on public.user_item_templates for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "user_item_templates: family-delete" on public.user_item_templates;
create policy "user_item_templates: family-delete"
  on public.user_item_templates for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- ── 2. user_item_template_components ────────────────────────────────
-- Direct mirror of pantry_item_components, retargeted at templates.
-- Same constraint shape, same snapshot pattern (name_snapshot +
-- ingredient_ids_snapshot), same position ordering.

create table if not exists public.user_item_template_components (
  id                        uuid        primary key default gen_random_uuid(),
  parent_template_id        uuid        not null
                              references public.user_item_templates(id) on delete cascade,

  -- 'ingredient' = canonical-registry id (string, no FK target);
  -- 'template' = another user_item_templates row (recursive).
  child_kind                text        not null
                              check (child_kind in ('ingredient','template')),

  child_ingredient_id       text        null,
  child_template_id         uuid        null
                              references public.user_item_templates(id) on delete set null,

  amount                    numeric     null,
  unit                      text        null,
  proportion                numeric     null
                              check (proportion is null
                                     or (proportion >= 0 and proportion <= 1)),

  -- Snapshots so template composition stays readable if a child
  -- template is deleted (FK nulls) — same pattern as
  -- pantry_item_components.
  name_snapshot             text        not null,
  ingredient_ids_snapshot   text[]      not null default '{}'::text[],

  position                  integer     not null default 0,
  created_at                timestamptz not null default now(),

  constraint uitc_child_populated check (
    (child_kind = 'ingredient' and child_ingredient_id is not null and child_template_id is null)
    or
    (child_kind = 'template'   and child_template_id   is not null and child_ingredient_id is null)
  )
);

create index if not exists user_item_template_components_parent_idx
  on public.user_item_template_components (parent_template_id, position);

create index if not exists user_item_template_components_child_template_idx
  on public.user_item_template_components (child_template_id)
  where child_template_id is not null;

create index if not exists user_item_template_components_child_ingredient_idx
  on public.user_item_template_components (child_ingredient_id)
  where child_ingredient_id is not null;

-- ── RLS: authorize through parent template ──────────────────────────
-- No user_id column on the component row; RLS derives from the
-- parent template's ownership. Same pattern as pantry_item_components.

alter table public.user_item_template_components enable row level security;

drop policy if exists "uitc: parent-select" on public.user_item_template_components;
create policy "uitc: parent-select"
  on public.user_item_template_components for select
  using (
    exists (
      select 1 from public.user_item_templates t
      where t.id = parent_template_id
        and (t.user_id = auth.uid()
             or t.user_id in (select public.family_ids_of(auth.uid())))
    )
  );

drop policy if exists "uitc: parent-insert" on public.user_item_template_components;
create policy "uitc: parent-insert"
  on public.user_item_template_components for insert
  with check (
    exists (
      select 1 from public.user_item_templates t
      where t.id = parent_template_id
        and (t.user_id = auth.uid()
             or t.user_id in (select public.family_ids_of(auth.uid())))
    )
  );

drop policy if exists "uitc: parent-update" on public.user_item_template_components;
create policy "uitc: parent-update"
  on public.user_item_template_components for update
  using (
    exists (
      select 1 from public.user_item_templates t
      where t.id = parent_template_id
        and (t.user_id = auth.uid()
             or t.user_id in (select public.family_ids_of(auth.uid())))
    )
  )
  with check (
    exists (
      select 1 from public.user_item_templates t
      where t.id = parent_template_id
        and (t.user_id = auth.uid()
             or t.user_id in (select public.family_ids_of(auth.uid())))
    )
  );

drop policy if exists "uitc: parent-delete" on public.user_item_template_components;
create policy "uitc: parent-delete"
  on public.user_item_template_components for delete
  using (
    exists (
      select 1 from public.user_item_templates t
      where t.id = parent_template_id
        and (t.user_id = auth.uid()
             or t.user_id in (select public.family_ids_of(auth.uid())))
    )
  );

-- ── 3. Realtime ─────────────────────────────────────────────────────
-- Family members see each other's template saves live — the moment one
-- person adds "Home Run Inn Pizza" the rest of the household sees it
-- in their recents on their next AddItemModal open (or immediately if
-- they already have it open).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_item_templates'
  ) then
    alter publication supabase_realtime add table public.user_item_templates;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_item_template_components'
  ) then
    alter publication supabase_realtime add table public.user_item_template_components;
  end if;
end $$;

-- ── 4. updated_at trigger ───────────────────────────────────────────
-- Bump updated_at on every UPDATE. Simple helper; if other tables
-- later need the same behavior we can promote this to a shared
-- trigger function.

create or replace function public.touch_user_item_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_item_templates_touch_updated_at on public.user_item_templates;
create trigger user_item_templates_touch_updated_at
  before update on public.user_item_templates
  for each row execute function public.touch_user_item_templates_updated_at();
