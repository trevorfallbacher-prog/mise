-- 0044_pantry_item_protected.sql
--
-- Adds a per-row `protected` flag on pantry_items so specific rows
-- can be marked undeletable. Use case: keepsakes (Bella's Gummy Bear
-- — the one she saved for dad), emergency pantry floors, anything
-- sentimental. Deleting a protected row requires a human with DB
-- access (or an admin flipping the flag back to false) — not a tap.
--
-- Behavior:
--   * New column `protected boolean not null default false`. Every
--     existing row becomes `false` on backfill — nothing regresses.
--   * Delete policy rebuilt to exclude protected rows entirely. The
--     DB is the source of truth; even a buggy client that tried
--     DELETE would be rejected, and the ✕ in the UI is gated on
--     the same flag so the control doesn't surface in the first
--     place.
--   * Update policy UNCHANGED — you can still edit the name,
--     amount, emoji, etc. on a protected row. Only delete is
--     blocked.
--
-- Bootstrap (run once after applying this migration, replacing
-- YOUR@EMAIL.COM with the owning account):
--
--   update public.pantry_items
--   set protected = true
--   where name ilike '%gummy bear%'
--     and user_id = (select id from auth.users where email = 'YOUR@EMAIL.COM');
--
-- To un-protect later:
--
--   update public.pantry_items set protected = false where id = '<uuid>';
--
-- IDEMPOTENT — add-column-if-not-exists + drop-policy-if-exists.

alter table public.pantry_items
  add column if not exists protected boolean not null default false;

-- Rebuild the delete policy so protected rows are hard-blocked at
-- the DB. Mirrors the family-delete USING from 0007 but adds the
-- `protected = false` guard.
drop policy if exists "pantry_items: self-delete"   on public.pantry_items;
drop policy if exists "pantry_items: family-delete" on public.pantry_items;
create policy "pantry_items: family-delete"
  on public.pantry_items for delete
  using (
    protected = false
    and (
      auth.uid() = user_id
      or user_id in (select public.family_ids_of(auth.uid()))
    )
  );

notify pgrst, 'reload schema';
