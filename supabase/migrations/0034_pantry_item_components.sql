-- Meal composition tree: pantry_item_components.
--
-- Items come in two tiers:
--
--   * Ingredient (kind='ingredient')  — atomic, single canonical tag.
--     A stick of butter, a block of pepper jack, a raw egg.
--
--   * Meal (kind='meal')  — COMPOSED. Has a list of Components that
--     make it up. A frozen pizza, an Italian Blend shredded cheese,
--     leftover lasagna, a store-bought pesto jar, a jar of spices.
--
-- A Component is a row in THIS table. It points from a parent Meal
-- item back to the thing it contains — either:
--
--   * a canonical Ingredient reference (child_kind='ingredient'),
--     e.g. a pizza component pointing to the 'mozzarella' canonical id
--
--   * another Meal item (child_kind='item'), e.g. a lasagna component
--     pointing to the marinara-meal item that was used to make it
--
-- The second form is what makes this a recursive tree. Drilling into a
-- Meal shows its components; tapping a Meal-component drills into THAT
-- item's components; keep going and you eventually hit Ingredient
-- leaves. A Pizza Party Platter is a Meal whose components are Cheese
-- Pizza / Pepperoni Pizza / BBQ Chicken Pizza — each itself a Meal
-- with its own component tree down to raw dough, sauce, cheese, etc.
--
-- Precedence rule:
--
--   When a Meal has components listed, the components ARE the
--   authoritative composition. The flat ingredient_ids[] array on
--   pantry_items (from migration 0033) becomes a DERIVED cache —
--   client recomputes it as the union of every leaf-ingredient found
--   by walking the tree, and writes it alongside the component rows.
--   Fast recipe lookups stay fast (ingredient_ids GIN index from 0033
--   already covers "does this meal contain mozzarella?") while the
--   component rows carry the structured truth for UI rendering.
--
-- Snapshot preservation:
--
--   Components carry name_snapshot + ingredient_ids_snapshot columns.
--   When a child Meal gets consumed and its row deletes, the FK goes
--   to NULL (ON DELETE SET NULL) but the snapshot survives. So the
--   parent Meal can still display "this platter contained a Cheese
--   Pizza with [dough + sauce + mozzarella]" years after the
--   referenced pizza row is gone. History stays intact even when
--   pointers die.
--
-- Proportion tracking:
--
--   Each component can carry amount / unit / proportion. Any single
--   one (or any combination) may be populated:
--
--     * Measured baker  → amount=2, unit='tsp'
--     * Sloppy dumper   → proportion=0.10 (a tenth of the bottle)
--     * Known both      → all three populated
--
--   proportion is a fraction 0..1 of the SOURCE's current contents.
--   When a component row is written with proportion=0.1 and the
--   source's current amount is 8.3oz, the client decrements the
--   source to 8.3 * (1 - 0.1) = 7.47oz. Long-term this enables
--   "your salt jar is 8% full — restock?" insights without
--   requiring users to weigh anything.
--
-- Cycles:
--
--   A Meal containing itself (directly or transitively) is nonsense.
--   The client is responsible for a reachability check before writing
--   a child_item_id — walk the parent's ancestry and reject if the
--   proposed child already appears. No SQL trigger; keeps insert
--   latency flat and cycle detection is linear in tree depth
--   (realistically <5 levels for any meal).

create table if not exists public.pantry_item_components (
  id                        uuid        primary key default gen_random_uuid(),
  parent_item_id            uuid        not null
                              references public.pantry_items(id) on delete cascade,

  -- Discriminator. 'ingredient' = points to a canonical id in the
  -- INGREDIENTS registry; 'item' = points to another pantry_items row.
  child_kind                text        not null
                              check (child_kind in ('ingredient', 'item')),

  -- Exactly one of these is set (enforced by the check constraint below).
  -- child_ingredient_id is TEXT because the ingredient registry is bundled
  -- client-side and keys off stable string ids (e.g. 'mozzarella'); no FK
  -- target in the DB, so the client validates existence.
  child_ingredient_id       text        null,
  child_item_id             uuid        null
                              references public.pantry_items(id) on delete set null,

  -- Consumption metadata. All nullable; any combination may be present.
  -- amount + unit is the precise-measurement form; proportion is the
  -- sloppy-measurement form. Decrement semantics documented above.
  amount                    numeric     null,
  unit                      text        null,
  proportion                numeric     null
                              check (proportion is null
                                     or (proportion >= 0 and proportion <= 1)),

  -- Frozen at composition time. Survives child deletion (FK nulling)
  -- and child mutation (rename, re-tag). The parent Meal's historical
  -- composition is always reconstructable from these.
  name_snapshot             text        not null,
  ingredient_ids_snapshot   text[]      not null default '{}'::text[],

  -- Display order inside the parent's Components list. Clients sort
  -- ASC; ties break on created_at. Allows the user to reorder "Cheese
  -- · Sauce · Dough" into "Dough · Sauce · Cheese" without having to
  -- delete + re-add.
  position                  integer     not null default 0,
  created_at                timestamptz not null default now(),

  -- Exactly one of child_ingredient_id / child_item_id is populated,
  -- keyed by child_kind. Prevents both-null or both-set rows.
  constraint pantry_item_components_child_populated check (
    (child_kind = 'ingredient' and child_ingredient_id is not null and child_item_id is null)
    or
    (child_kind = 'item'       and child_item_id       is not null and child_ingredient_id is null)
  )
);

-- Primary lookup: "what are the components of this Meal?" Clients hit
-- this on every ItemCard open + recipe-matcher descent. Index on
-- (parent_item_id, position) so the ORDER BY position doesn't sort at
-- read time.
create index if not exists pantry_item_components_parent_idx
  on public.pantry_item_components (parent_item_id, position);

-- Reverse lookup: "where is this Meal used as a component?" Lets the
-- UI surface "this pesto jar is a component of 3 pastas you've cooked"
-- and gives us the data needed to prompt "consumed — do you want to
-- clear its parent references?" when a sub-meal gets deleted.
create index if not exists pantry_item_components_child_item_idx
  on public.pantry_item_components (child_item_id)
  where child_item_id is not null;

-- Reverse canonical lookup: "which Meals contain 'mozzarella' as a
-- direct leaf component?" Useful for the dietary filter AND for
-- back-populating the ingredient_ids[] cache when a registry rename
-- happens. Partial index since child_ingredient_id is null on the
-- item-kind rows.
create index if not exists pantry_item_components_child_ingredient_idx
  on public.pantry_item_components (child_ingredient_id)
  where child_ingredient_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────
-- Mirror pantry_items' family-share policies: a user can read/write
-- component rows on any pantry_items row they or their family owns.
-- Authorization derives from the parent's ownership; no user_id column
-- on this table (would duplicate parent's column and risk drift).

alter table public.pantry_item_components enable row level security;

-- SELECT: you can see components of any item you can see.
drop policy if exists "pantry_item_components: family-select" on public.pantry_item_components;
create policy "pantry_item_components: family-select"
  on public.pantry_item_components for select
  using (
    exists (
      select 1 from public.pantry_items p
      where p.id = parent_item_id
        and (p.user_id = auth.uid()
             or p.user_id in (select public.family_ids_of(auth.uid())))
    )
  );

drop policy if exists "pantry_item_components: family-insert" on public.pantry_item_components;
create policy "pantry_item_components: family-insert"
  on public.pantry_item_components for insert
  with check (
    exists (
      select 1 from public.pantry_items p
      where p.id = parent_item_id
        and (p.user_id = auth.uid()
             or p.user_id in (select public.family_ids_of(auth.uid())))
    )
  );

drop policy if exists "pantry_item_components: family-update" on public.pantry_item_components;
create policy "pantry_item_components: family-update"
  on public.pantry_item_components for update
  using (
    exists (
      select 1 from public.pantry_items p
      where p.id = parent_item_id
        and (p.user_id = auth.uid()
             or p.user_id in (select public.family_ids_of(auth.uid())))
    )
  )
  with check (
    exists (
      select 1 from public.pantry_items p
      where p.id = parent_item_id
        and (p.user_id = auth.uid()
             or p.user_id in (select public.family_ids_of(auth.uid())))
    )
  );

drop policy if exists "pantry_item_components: family-delete" on public.pantry_item_components;
create policy "pantry_item_components: family-delete"
  on public.pantry_item_components for delete
  using (
    exists (
      select 1 from public.pantry_items p
      where p.id = parent_item_id
        and (p.user_id = auth.uid()
             or p.user_id in (select public.family_ids_of(auth.uid())))
    )
  );

-- ── realtime ─────────────────────────────────────────────────────────
-- Component rows flow through the same realtime subscriptions as their
-- parent items so family members see composition changes live. Mirrors
-- the pantry_items realtime pattern from 0008.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pantry_item_components'
  ) then
    alter publication supabase_realtime add table public.pantry_item_components;
  end if;
end $$;
