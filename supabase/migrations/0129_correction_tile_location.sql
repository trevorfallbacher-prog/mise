-- Correction memory gains tile_id + location for Shop Mode.
--
-- Shop Mode's checkout lets users fix a scan's CATEGORY (typeId),
-- STORED IN (tileId — specific shelf), and LOCATION (fridge /
-- pantry / freezer) before committing. Same as the existing
-- canonical_id / type_id corrections, those picks should teach
-- future scans of the same UPC so the family — and (when an
-- admin promotes) everyone — lands at the right placement on
-- the next scan.
--
-- Two tables, two columns each. Idempotent; safe to re-run.

alter table public.barcode_identity_corrections
  add column if not exists tile_id  text null,
  add column if not exists location text null
    check (location is null or location in ('fridge', 'pantry', 'freezer'));

alter table public.user_scan_corrections
  add column if not exists tile_id  text null,
  add column if not exists location text null
    check (location is null or location in ('fridge', 'pantry', 'freezer'));
