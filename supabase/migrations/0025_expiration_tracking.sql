-- Phase 5a: earliest-expiration tracking for pantry items.
--
-- Each pantry row carries the EARLIEST expiration across whatever was
-- merged into it, plus the MOST RECENT purchase date. Two columns,
-- both nullable — existing rows stay valid, items without ingredient
-- metadata keep no expiration (we'd rather show nothing than a wrong
-- estimate).
--
-- The merge rule (enforced client-side):
--   expires_at   = min(existing.expires_at,   new.expires_at)
--   purchased_at = max(existing.purchased_at, new.purchased_at)
--
-- This makes "your chicken goes bad Wednesday" actionable even when
-- the fresh batch you bought Friday would individually keep until
-- next Tuesday. Home cooks FIFO the fridge; the app matches that.
--
-- For items that have structured storage data in INGREDIENT_INFO
-- (see src/data/ingredients.js), the client computes the default
-- expiration as purchased_at + shelfLife[location] days.

alter table public.pantry_items
  add column if not exists expires_at   timestamptz null,
  add column if not exists purchased_at timestamptz null;

-- Useful for the pending "expiring soon" shopping-list suggestions
-- and the pantry's "oldest-first" sort.
create index if not exists pantry_items_expires_at_idx
  on public.pantry_items (user_id, expires_at)
  where expires_at is not null;
