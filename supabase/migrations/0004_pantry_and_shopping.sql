-- mise — pantry and shopping list tables
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Two tables, same RLS pattern as scheduled_meals:
--   pantry_items        — what the user has on hand
--   shopping_list_items — what the user needs to buy
--
-- Both tables use client-generated uuids so the app can insert optimistically
-- (no round-trip needed to get an id).

-- ── pantry_items ─────────────────────────────────────────────────────────────
create table if not exists public.pantry_items (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,

  name          text        not null,
  emoji         text        not null default '🥫',
  amount        numeric     not null default 0,
  unit          text        not null default '',
  max           numeric     not null default 1,
  category      text        not null default 'pantry',
  low_threshold numeric     not null default 0.25,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists pantry_items_user_idx
  on public.pantry_items (user_id);

drop trigger if exists pantry_items_touch_updated_at on public.pantry_items;
create trigger pantry_items_touch_updated_at
before update on public.pantry_items
for each row execute function public.touch_updated_at();

alter table public.pantry_items enable row level security;

drop policy if exists "pantry_items: self-select" on public.pantry_items;
create policy "pantry_items: self-select"
  on public.pantry_items for select
  using (auth.uid() = user_id);

drop policy if exists "pantry_items: self-insert" on public.pantry_items;
create policy "pantry_items: self-insert"
  on public.pantry_items for insert
  with check (auth.uid() = user_id);

drop policy if exists "pantry_items: self-update" on public.pantry_items;
create policy "pantry_items: self-update"
  on public.pantry_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "pantry_items: self-delete" on public.pantry_items;
create policy "pantry_items: self-delete"
  on public.pantry_items for delete
  using (auth.uid() = user_id);

-- ── shopping_list_items ──────────────────────────────────────────────────────
create table if not exists public.shopping_list_items (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,

  name       text        not null,
  emoji      text        not null default '🥫',
  amount     numeric     not null default 1,
  unit       text        not null default '',
  category   text        not null default 'pantry',
  -- how this item got added: "manual" | "low-stock" | "recipe"
  source     text        not null default 'manual',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopping_list_items_user_idx
  on public.shopping_list_items (user_id);

drop trigger if exists shopping_list_items_touch_updated_at on public.shopping_list_items;
create trigger shopping_list_items_touch_updated_at
before update on public.shopping_list_items
for each row execute function public.touch_updated_at();

alter table public.shopping_list_items enable row level security;

drop policy if exists "shopping_list_items: self-select" on public.shopping_list_items;
create policy "shopping_list_items: self-select"
  on public.shopping_list_items for select
  using (auth.uid() = user_id);

drop policy if exists "shopping_list_items: self-insert" on public.shopping_list_items;
create policy "shopping_list_items: self-insert"
  on public.shopping_list_items for insert
  with check (auth.uid() = user_id);

drop policy if exists "shopping_list_items: self-update" on public.shopping_list_items;
create policy "shopping_list_items: self-update"
  on public.shopping_list_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "shopping_list_items: self-delete" on public.shopping_list_items;
create policy "shopping_list_items: self-delete"
  on public.shopping_list_items for delete
  using (auth.uid() = user_id);
