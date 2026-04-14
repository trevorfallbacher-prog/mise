-- mise — prices + receipts
--
-- Track per-item price (last paid) and store the receipt scan event as an
-- immutable record so we can show things like "you spent $X.XX on groceries
-- this month" and eventually use historical unit prices to sanity-check
-- scanner output.
--
-- Safe to re-run.

-- ── price_cents on existing item tables ──────────────────────────────────────
-- Integer cents to avoid float drift. Nullable: older rows have no price,
-- and free-text manual adds don't need one.
alter table public.pantry_items
  add column if not exists price_cents integer;

alter table public.shopping_list_items
  add column if not exists price_cents integer;

-- ── receipts: one row per successful scan ────────────────────────────────────
create table if not exists public.receipts (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,

  scanned_at   timestamptz not null default now(),
  -- date printed on the receipt, if the model could read one. Separate from
  -- scanned_at so "I scanned an old receipt" doesn't skew the current month.
  receipt_date date,
  store_name   text,
  total_cents  integer,
  item_count   integer     not null default 0,

  created_at   timestamptz not null default now()
);

create index if not exists receipts_user_date_idx
  on public.receipts (user_id, receipt_date desc);

alter table public.receipts enable row level security;

drop policy if exists "receipts: self-select" on public.receipts;
create policy "receipts: self-select"
  on public.receipts for select
  using (auth.uid() = user_id);

drop policy if exists "receipts: self-insert" on public.receipts;
create policy "receipts: self-insert"
  on public.receipts for insert
  with check (auth.uid() = user_id);

drop policy if exists "receipts: self-delete" on public.receipts;
create policy "receipts: self-delete"
  on public.receipts for delete
  using (auth.uid() = user_id);
