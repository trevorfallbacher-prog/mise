-- NNNN_short_snake_case_description.sql
--
-- One-paragraph explainer: what this migration introduces, why, and
-- which user-facing capability / bug / schema need drove it. When you
-- come back to this in six months, the top of the file should tell
-- you why the change existed.
--
-- If the migration introduces a new concept (a new table, a new column
-- family, a new trigger behavior), explain the concept here — not just
-- what the SQL does but why this shape. Migrations are the permanent
-- record of every schema decision; they deserve a real comment.
--
-- Filename rules (enforced by convention, not tooling):
--   * NNNN = four-digit sequence number, zero-padded, one more than
--     the highest number in supabase/migrations/. Don't skip numbers.
--   * short_snake_case_description = the gist, in <~5 words
--   * .sql lowercase extension
--
-- This file (_TEMPLATE.sql) is NOT a migration itself — the leading
-- underscore keeps it out of sort order and the runner. Copy this
-- file when starting a new migration; don't edit it in place.
--
-- ── CHECKLIST ─────────────────────────────────────────────────────
-- Before committing, confirm:
--   [ ] IDEMPOTENT — every DDL uses IF NOT EXISTS / IF EXISTS / DO
--       block wrappers so running twice doesn't error
--   [ ] RLS ENABLED on any new table (alter table ... enable row
--       level security;) — forgetting this is the single most common
--       way to leak data across users/families
--   [ ] RLS POLICIES written using family_ids_of() for shared tables;
--       self-only tables use auth.uid() = user_id directly
--   [ ] INDEXES for every WHERE-clause column the UI reads on (see
--       the app's data fetchers for column usage)
--   [ ] REALTIME publication added if UI needs live updates (see the
--       "realtime" block below) — family-shared tables generally do
--   [ ] CLIENT CHANGES land in the SAME COMMIT or a clearly-linked
--       follow-up so partial deployments don't break
--   [ ] Tested against a fresh DB and an existing one (idempotency
--       proof). The defensive column mapping in usePantry / fromDb
--       assumes un-migrated DBs keep working — don't break that
--       invariant.
-- ────────────────────────────────────────────────────────────────────

-- ── 1. Tables ───────────────────────────────────────────────────────
-- Shape notes: prefer uuid primary keys (gen_random_uuid()), timestamptz
-- timestamps, not null where the column is required, text[] for array
-- columns with a '{}'::text[] default. Column names snake_case; the
-- client hook's fromDb/toDb maps camelCase <-> snake_case.

create table if not exists public.my_table (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  -- ...columns...
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── 2. Indexes ──────────────────────────────────────────────────────
-- Index every column the UI queries by. Shared-access tables should
-- at minimum have an index on user_id (family scans are common).
-- GIN indexes for text[] array-contains queries.
create index if not exists my_table_user_idx
  on public.my_table (user_id);

-- ── 3. Row-level security ───────────────────────────────────────────
-- Every user-facing table gets RLS. Without this, any authenticated
-- user could read any row in the table.

alter table public.my_table enable row level security;

-- SHARED TABLE (family members see each other's rows). Use these four
-- policy stanzas when the table carries a user_id that family members
-- should see. family_ids_of() is defined in migration 0007.

drop policy if exists "my_table: family-select" on public.my_table;
create policy "my_table: family-select"
  on public.my_table for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "my_table: family-insert" on public.my_table;
create policy "my_table: family-insert"
  on public.my_table for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "my_table: family-update" on public.my_table;
create policy "my_table: family-update"
  on public.my_table for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "my_table: family-delete" on public.my_table;
create policy "my_table: family-delete"
  on public.my_table for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- OWNED CHILD TABLE (authorization through a parent row — see
-- pantry_item_components from migration 0034). Use these policies when
-- the table has no user_id itself and inherits permission from its
-- parent's policies.

-- drop policy if exists "my_child: parent-select" on public.my_child;
-- create policy "my_child: parent-select"
--   on public.my_child for select
--   using (
--     exists (
--       select 1 from public.parent_table p
--       where p.id = parent_id
--         and (p.user_id = auth.uid()
--              or p.user_id in (select public.family_ids_of(auth.uid())))
--     )
--   );
-- ... (repeat for insert/update/delete, adjusting `using` vs
-- `with check` as needed)

-- SELF-ONLY TABLE (user_profiles, private notes). Simplest form.

-- drop policy if exists "my_private: self" on public.my_private;
-- create policy "my_private: self"
--   on public.my_private for all
--   using (auth.uid() = user_id)
--   with check (auth.uid() = user_id);

-- ── 4. Triggers ─────────────────────────────────────────────────────
-- Common pattern: bump updated_at on UPDATE. Define helper once in a
-- foundational migration, reuse everywhere.
-- (See tables that already use this in earlier migrations for the
-- helper function name — if none exists yet, define it alongside the
-- first trigger that needs it.)

-- drop trigger if exists my_table_set_updated_at on public.my_table;
-- create trigger my_table_set_updated_at
--   before update on public.my_table
--   for each row execute function public.set_updated_at();

-- Notification fan-out for family-shared tables — see
-- notify_family_pantry_scan (migration 0032) for the canonical shape.

-- ── 5. Realtime ─────────────────────────────────────────────────────
-- Add the table to the supabase_realtime publication if the UI
-- subscribes to postgres_changes for live sync. Wrapped in DO block
-- so re-runs don't error on an already-published table.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'my_table'
  ) then
    alter publication supabase_realtime add table public.my_table;
  end if;
end $$;

-- ── 6. Foreign keys added post-hoc (rare) ───────────────────────────
-- If you need to add a FK to an existing table (e.g. pantry_items
-- gained source_scan_id in 0029 but the target table pantry_scans
-- landed in 0032), wrap the ALTER in a DO block that checks
-- pg_constraint so re-runs don't fail.

-- do $$
-- begin
--   if not exists (
--     select 1 from pg_constraint
--     where conname = 'my_table_fk_name'
--   ) then
--     alter table public.my_table
--       add constraint my_table_fk_name
--       foreign key (ref_id) references public.other_table(id)
--       on delete set null;
--   end if;
-- end $$;

-- ── 7. Data backfills (rare, careful) ───────────────────────────────
-- If the migration needs to populate existing rows, write the backfill
-- as an idempotent UPDATE (e.g. WHERE column is null) so re-running
-- the migration doesn't re-backfill already-backfilled rows. Keep
-- backfills in THIS migration alongside the schema change — separate
-- "data-only" migrations are fragile and get missed.

-- update public.my_table
-- set some_column = coalesce(some_column, 'default')
-- where some_column is null;
