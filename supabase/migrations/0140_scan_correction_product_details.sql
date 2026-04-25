-- 0140_scan_correction_product_details.sql
--
-- Extend user_scan_corrections with product-detail columns so the
-- family tier can persist the same UPC-clinging payload that the
-- global tier (barcode_identity_corrections, migration 0130) already
-- carries. Goal: the moment a UPC scan returns brand / productName /
-- packageSize (whether from OFF, the AI photo flow, or USDA baseline),
-- those fields stick to the UPC. Re-scanning the same code rehydrates
-- the form without re-running OFF or Haiku.
--
-- barcode_identity_corrections already has brand / name /
-- package_size_amount / package_size_unit (added by 0130 for the
-- USDA-branded ingest); user_scan_corrections only had `brand` (0062)
-- — this migration brings the family tier to parity.
--
-- All columns nullable. Existing rows backfill to NULL; the
-- application's read path already handles missing fields gracefully.

alter table public.user_scan_corrections
  add column if not exists name                  text     null,
  add column if not exists package_size_amount   numeric  null,
  add column if not exists package_size_unit     text     null;

-- No new indexes — these columns are read-only-on-correction-hit, never
-- queried on their own. Lookup is by (user_id, barcode_upc) via the
-- existing partial unique index from migration 0067.
