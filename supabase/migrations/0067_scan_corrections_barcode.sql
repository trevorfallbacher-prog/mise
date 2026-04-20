-- 0067_scan_corrections_barcode.sql
--
-- Barcode-keyed correction memory, two tiers:
--
--   1. user_scan_corrections.barcode_upc (NEW COLUMN) — per-user
--      / family-shared (via 0046's RLS). Regular users correcting
--      a scan row write here. Learning is scoped to the household
--      that taught it — next scan within that family benefits.
--
--   2. barcode_identity_corrections (NEW TABLE) — GLOBAL. One
--      correction, all users benefit. WRITE gated on is_admin()
--      so random users can't mislabel a UPC for the whole base.
--      Admin scans bypass the per-user tier and go straight here.
--      Admin tooling (future) can promote a user_scan_corrections
--      row to this table after review.
--
-- Client contract:
--   * Scan barcode → query BOTH tables, global wins if both hit.
--   * Correction commit:
--       - is_admin user → upsert into barcode_identity_corrections
--       - regular user  → upsert into user_scan_corrections with
--         barcode_upc populated. An admin can later promote.
--
-- Both tables coexist; neither replaces 0046's text-keyed memory.

-- ── 1. user_scan_corrections.barcode_upc ─────────────────────────────
alter table public.user_scan_corrections
  add column if not exists barcode_upc text null;

-- Per-user uniqueness on UPC — one canonical mapping per UPC per
-- user. Re-correcting the same UPC updates the existing row.
create unique index if not exists user_scan_corrections_user_upc_uidx
  on public.user_scan_corrections (user_id, barcode_upc)
  where barcode_upc is not null;

create index if not exists user_scan_corrections_barcode_idx
  on public.user_scan_corrections (barcode_upc)
  where barcode_upc is not null;

-- ── 2. barcode_identity_corrections (global) ─────────────────────────
create table if not exists public.barcode_identity_corrections (
  id                uuid        primary key default gen_random_uuid(),

  barcode_upc       text        not null unique,

  canonical_id      text        null,
  type_id           text        null,
  emoji             text        null,
  ingredient_ids    text[]      not null default '{}'::text[],

  -- Tallying. Each admin promotion or admin-scan correction bumps
  -- this; a high value = crowd-verified. UI can treat >= 2 as
  -- "trust without suggesting" and 1 as "suggest and let user
  -- confirm" if we want tiered auto-apply later.
  correction_count  integer     not null default 1,
  last_used_at      timestamptz not null default now(),

  -- Provenance — always set (RLS's auth.uid() guard enforces).
  created_by        uuid        not null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists barcode_identity_corrections_upc_idx
  on public.barcode_identity_corrections (barcode_upc);

-- ── 3. updated_at trigger ────────────────────────────────────────────
drop trigger if exists barcode_identity_corrections_touch_updated_at on public.barcode_identity_corrections;
create trigger barcode_identity_corrections_touch_updated_at
  before update on public.barcode_identity_corrections
  for each row execute function public.touch_updated_at();

-- ── 4. RLS ───────────────────────────────────────────────────────────
alter table public.barcode_identity_corrections enable row level security;

-- Everyone reads. Reference data for the whole user base, same
-- pattern as ingredient_info and brand_nutrition.
drop policy if exists "barcode_identity_corrections: public-read" on public.barcode_identity_corrections;
create policy "barcode_identity_corrections: public-read"
  on public.barcode_identity_corrections for select
  using (true);

-- Only admins write. Prevents griefing / mislabeling of the global
-- pool by regular users — their corrections go to
-- user_scan_corrections instead, and admin tooling can promote.
drop policy if exists "barcode_identity_corrections: admin-insert" on public.barcode_identity_corrections;
create policy "barcode_identity_corrections: admin-insert"
  on public.barcode_identity_corrections for insert
  with check (public.is_admin());

drop policy if exists "barcode_identity_corrections: admin-update" on public.barcode_identity_corrections;
create policy "barcode_identity_corrections: admin-update"
  on public.barcode_identity_corrections for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "barcode_identity_corrections: admin-delete" on public.barcode_identity_corrections;
create policy "barcode_identity_corrections: admin-delete"
  on public.barcode_identity_corrections for delete
  using (public.is_admin());

-- ── 5. pantry_items.barcode_upc ──────────────────────────────────────
-- Persists the source UPC on every barcode-scanned row so after-
-- the-fact ItemCard edits can key their correction back to the UPC.
alter table public.pantry_items
  add column if not exists barcode_upc text null;

create index if not exists pantry_items_barcode_idx
  on public.pantry_items (barcode_upc)
  where barcode_upc is not null;

-- ── 6. realtime ──────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'barcode_identity_corrections'
  ) then
    alter publication supabase_realtime add table public.barcode_identity_corrections;
  end if;
end $$;

-- ── 7. schema cache reload ───────────────────────────────────────────
notify pgrst, 'reload schema';
