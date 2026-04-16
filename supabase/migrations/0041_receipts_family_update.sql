-- 0041_receipts_family_update.sql
--
-- Adds a family-update policy to public.receipts so any family
-- member (not just the original uploader) can correct the store
-- name, date, or total on a receipt row. Mirrors the family-select
-- pattern already in place from 0011.
--
-- The need:
--
--   OCR is going to misfire. Trader Joe's prints "Whole Foods " at
--   the top of a receipt (rare but real) and the model latches onto
--   the wrong string. Before today, fixing that required the
--   original uploader to re-scan or manually edit in the DB — the
--   partner who noticed the error couldn't touch it. That's the
--   opposite of the "family-shared kitchen" promise.
--
--   Now family members share write access on receipts the same way
--   they share read access. ReceiptView surfaces tap-to-edit on the
--   store + date header, persisting an UPDATE that any family member
--   can land.
--
-- IDEMPOTENT — drop policy if exists / create policy.
--
-- Security notes:
--   * The select policy already lets family see these rows, so
--     family-update doesn't leak any new information.
--   * Strangers still can't UPDATE (using-clause checks family
--     membership of owner).
--   * There's no DELETE update — deletes stay with the owner
--     (0006's self-delete). A mistaken family delete would be much
--     harder to recover from than a mistaken family edit.

drop policy if exists "receipts: family-update" on public.receipts;
create policy "receipts: family-update"
  on public.receipts for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

notify pgrst, 'reload schema';
