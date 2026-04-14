-- mise — physical location for pantry items
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Adds a single `location` column to pantry_items so the same row knows
-- whether it lives in the fridge, the cabinet/pantry, or the freezer.
-- This lets one table back three filterable views in the UI (and one
-- shelf-scan pipeline back three contexts in the scanner) instead of
-- splitting into three parallel tables — which would have tripled RLS,
-- realtime subscriptions, and every "what do I have" query.
--
-- Backfill heuristic: existing rows have no idea where they're stored,
-- so we infer from the category they came in with:
--   produce, dairy, meat → fridge
--   frozen               → freezer
--   pantry, dry, anything else → pantry (the column default)
--
-- Users will inevitably reclassify some rows (eggs in the pantry,
-- bananas on the counter, etc.) — the inline location chip on each
-- card is the escape hatch, not a perfect backfill.

alter table public.pantry_items
  add column if not exists location text not null default 'pantry'
    check (location in ('fridge', 'pantry', 'freezer'));

create index if not exists pantry_items_location_idx
  on public.pantry_items (user_id, location);

-- Backfill any rows that are still sitting at the default 'pantry' but
-- whose category strongly implies otherwise. Idempotent — running it
-- again won't move rows the user has since reclassified, because we
-- only touch rows whose location is still the default.
update public.pantry_items
  set location = 'fridge'
  where location = 'pantry'
    and category in ('dairy', 'produce', 'meat');

update public.pantry_items
  set location = 'freezer'
  where location = 'pantry'
    and category = 'frozen';
