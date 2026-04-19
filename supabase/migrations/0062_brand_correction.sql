-- Brand memory on user_scan_corrections — household-learned
-- abbreviation → brand dictionary.
--
-- Background: migration 0061 added `brand` to pantry_items so the
-- identity pipeline can separate the manufacturer label from the
-- free-text name. The primary ingestion path is the scan-receipt
-- Claude call (which now returns a brand field per item), but
-- Claude only fires on scan-time and only catches abbreviations it
-- was trained on. The long tail — regional store brands (H-E-B's
-- "HCF", Publix's "GB"), idiosyncratic SKUs, typo-ridden receipts —
-- needs a per-household learning loop.
--
-- This migration adds a `brand` payload column to
-- user_scan_corrections (migration 0046). When a user taps-to-fix a
-- scan row's brand chip, rememberScanCorrection stores the mapping
-- keyed on the existing raw_text_normalized. Next scan the same
-- abbreviation appears on ANY family member's receipt,
-- findScanCorrections returns the learned brand and the scan row
-- pre-fills.
--
-- No new index — the existing (user_id, raw_text_normalized)
-- unique index is still the read path; brand rides along as a
-- payload field alongside corrected_name / emoji / canonical_id.
-- Backfill behavior matches the existing defensive-column pattern:
-- null = "not yet taught," existing rows keep their behavior.

alter table public.user_scan_corrections
  add column if not exists brand text null;
