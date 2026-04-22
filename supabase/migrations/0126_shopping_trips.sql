-- Shopping trips + trip_scans — the aggregate container for a shopping
-- session in Shop Mode.
--
-- Shop Mode marries three identity sources (OFF / barcode, receipt OCR,
-- shopping-list slot) into one shopping trip. During the trip, the user
-- fires the scanner at every item before it goes in the cart — each
-- scan writes a trip_scans row with the UPC + OFF payload + status
-- (green = canonical resolved, yellow = OFF-known but no canonical,
-- red = OFF miss). The user taps a shopping_list_items row to pair the
-- scan to their pre-set list slot; the pair is a direct FK, no fuzzy
-- match needed. At checkout, scanning the receipt attaches receipt
-- line indices to the paired trip_scans (UPC direct match first, then
-- fuzzy rawText ↔ OFF productName). Commit pass creates pantry_items
-- with the full identity stack: brand + canonical + UPC from OFF,
-- price + receipt_id from the receipt, source_shopping_list_item_id
-- from the list slot.
--
-- Tables:
--   shopping_trips   — one row per trip (open → checked_out / cancelled)
--   trip_scans       — one row per unique UPC scanned in a trip;
--                      re-scans bump qty rather than inserting (enforced
--                      by the unique(trip_id, barcode_upc) constraint).
--
-- Idempotent; safe to re-run.

-- ── 1. shopping_trips ──────────────────────────────────────────────

create table if not exists public.shopping_trips (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz null,
  store_name      text        null,
  receipt_id      uuid        null, -- FK added post-hoc below
  status          text        not null default 'active'
                    check (status in ('active', 'checked_out', 'cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists shopping_trips_user_idx
  on public.shopping_trips (user_id);

create index if not exists shopping_trips_status_idx
  on public.shopping_trips (user_id, status)
  where status = 'active';

create index if not exists shopping_trips_receipt_idx
  on public.shopping_trips (receipt_id)
  where receipt_id is not null;

-- Post-hoc FK to receipts — wrapped in DO block for idempotency.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shopping_trips_receipt_fk'
  ) then
    alter table public.shopping_trips
      add constraint shopping_trips_receipt_fk
      foreign key (receipt_id) references public.receipts(id)
      on delete set null;
  end if;
end $$;

-- ── 2. trip_scans ──────────────────────────────────────────────────

create table if not exists public.trip_scans (
  id                               uuid        primary key default gen_random_uuid(),
  trip_id                          uuid        not null references public.shopping_trips(id) on delete cascade,
  user_id                          uuid        not null references auth.users(id) on delete cascade,
  scanned_at                       timestamptz not null default now(),
  barcode_upc                      text        not null,
  off_payload                      jsonb       null,
  status                           text        not null default 'red'
                                     check (status in ('green', 'yellow', 'red')),
  canonical_id                     text        null,
  brand                            text        null,
  product_name                     text        null,
  qty                              integer     not null default 1 check (qty > 0),
  paired_shopping_list_item_id     uuid        null,
  paired_pantry_item_id            uuid        null,
  paired_receipt_line_index        integer     null,
  created_at                       timestamptz not null default now(),
  updated_at                       timestamptz not null default now(),
  unique (trip_id, barcode_upc)
);

create index if not exists trip_scans_trip_idx
  on public.trip_scans (trip_id);

create index if not exists trip_scans_user_idx
  on public.trip_scans (user_id);

create index if not exists trip_scans_upc_idx
  on public.trip_scans (barcode_upc);

create index if not exists trip_scans_status_idx
  on public.trip_scans (trip_id, status);

create index if not exists trip_scans_unpaired_idx
  on public.trip_scans (trip_id)
  where paired_shopping_list_item_id is null;

-- Post-hoc FKs to shopping_list_items and pantry_items.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trip_scans_list_item_fk'
  ) then
    alter table public.trip_scans
      add constraint trip_scans_list_item_fk
      foreign key (paired_shopping_list_item_id)
      references public.shopping_list_items(id)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'trip_scans_pantry_item_fk'
  ) then
    alter table public.trip_scans
      add constraint trip_scans_pantry_item_fk
      foreign key (paired_pantry_item_id)
      references public.pantry_items(id)
      on delete set null;
  end if;
end $$;

-- ── 3. Row-level security ─────────────────────────────────────────
-- Family-shared: both trips and trip_scans carry user_id so members of
-- the same family can see each other's trips (matches pantry_items /
-- shopping_list_items semantics).

alter table public.shopping_trips  enable row level security;
alter table public.trip_scans      enable row level security;

drop policy if exists "shopping_trips: family-select" on public.shopping_trips;
create policy "shopping_trips: family-select"
  on public.shopping_trips for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "shopping_trips: family-insert" on public.shopping_trips;
create policy "shopping_trips: family-insert"
  on public.shopping_trips for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "shopping_trips: family-update" on public.shopping_trips;
create policy "shopping_trips: family-update"
  on public.shopping_trips for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "shopping_trips: family-delete" on public.shopping_trips;
create policy "shopping_trips: family-delete"
  on public.shopping_trips for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "trip_scans: family-select" on public.trip_scans;
create policy "trip_scans: family-select"
  on public.trip_scans for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "trip_scans: family-insert" on public.trip_scans;
create policy "trip_scans: family-insert"
  on public.trip_scans for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "trip_scans: family-update" on public.trip_scans;
create policy "trip_scans: family-update"
  on public.trip_scans for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "trip_scans: family-delete" on public.trip_scans;
create policy "trip_scans: family-delete"
  on public.trip_scans for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- ── 4. Triggers — updated_at ───────────────────────────────────────
-- Reuse the touch_updated_at() helper from migration 0001.

drop trigger if exists shopping_trips_touch_updated_at on public.shopping_trips;
create trigger shopping_trips_touch_updated_at
  before update on public.shopping_trips
  for each row execute function public.touch_updated_at();

drop trigger if exists trip_scans_touch_updated_at on public.trip_scans;
create trigger trip_scans_touch_updated_at
  before update on public.trip_scans
  for each row execute function public.touch_updated_at();

-- ── 5. Realtime ────────────────────────────────────────────────────
-- Both tables are family-shared and the UI subscribes to them so two
-- people shopping together see each other's scans roll in live.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_trips'
  ) then
    alter publication supabase_realtime add table public.shopping_trips;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_scans'
  ) then
    alter publication supabase_realtime add table public.trip_scans;
  end if;
end $$;
