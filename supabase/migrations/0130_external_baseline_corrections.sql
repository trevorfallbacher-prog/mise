-- External baseline ingest (USDA Branded Foods, Open Food Facts) feeds
-- into barcode_identity_corrections so a scan of any previously-seen
-- UPC lands with brand, name, package size, and a canonical guess
-- pre-filled — without asking the user a thing. Same table, same
-- resolver, same tier-1 global read path; the ingest script just
-- fills rows the admin hasn't yet curated.
--
-- Per-field provenance (source_provenance jsonb) keeps admin edits
-- immutable across re-ingests: the ingest merge logic fills a field
-- ONLY when provenance for that field is absent or is a lower-priority
-- external source. Admin writes set provenance to "admin", which the
-- ingest script refuses to overwrite. Source values today:
--   "admin" > "usda" = "off"
-- USDA and OFF are siblings; whichever lands first on an empty field
-- wins, and the other fills remaining empty fields.
--
-- created_by becomes nullable — the ingest script runs under the
-- service role with no auth.uid() context, and the existing admin
-- write path keeps setting it as before. All existing rows keep their
-- created_by; only newly-inserted external-baseline rows carry null.
--
-- Idempotent; safe to re-run.

-- ── 1. New columns on barcode_identity_corrections ───────────────────
alter table public.barcode_identity_corrections
  add column if not exists brand                text        null,
  add column if not exists name                 text        null,
  add column if not exists package_size_amount  numeric     null,
  add column if not exists package_size_unit    text        null,
  add column if not exists image_url            text        null,
  add column if not exists category_hints       text[]      not null default '{}'::text[],
  add column if not exists source_provenance    jsonb       not null default '{}'::jsonb,
  add column if not exists last_external_sync   timestamptz null;

-- ── 2. Drop NOT NULL on created_by so ingest writes are allowed ──────
-- Service-role writes from the ingest script have no auth.uid(); rows
-- written via the admin UI keep populating it. Existing rows already
-- have a non-null created_by so no data change is needed.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'barcode_identity_corrections'
      and column_name = 'created_by'
      and is_nullable = 'NO'
  ) then
    alter table public.barcode_identity_corrections
      alter column created_by drop not null;
  end if;
end $$;

-- ── 3. Indexes ───────────────────────────────────────────────────────
-- The admin BASELINE dashboard queries rows that lack a canonical_id
-- (the review queue) and rows that were last synced from an external
-- source (the coverage count). Partial indexes keep these cheap.
create index if not exists barcode_identity_corrections_no_canonical_idx
  on public.barcode_identity_corrections (last_external_sync desc nulls last)
  where canonical_id is null;

create index if not exists barcode_identity_corrections_external_sync_idx
  on public.barcode_identity_corrections (last_external_sync desc)
  where last_external_sync is not null;

-- GIN on category_hints — admin promotion may re-seed the tag map
-- from a row's stored hints, and the dashboard can drilldown by hint.
create index if not exists barcode_identity_corrections_hints_gin
  on public.barcode_identity_corrections using gin (category_hints);

-- ── 4. Schema cache reload ───────────────────────────────────────────
notify pgrst, 'reload schema';
