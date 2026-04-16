-- Raw scanner output on pantry_items.
--
-- Adds a scan_raw JSONB column that stores whatever the vision API
-- returned for the most-recent scan that contributed to this pantry
-- row. Answers the "what did Claude think this was?" debugging
-- question that's currently unanswerable because we discard the
-- scanner output as soon as the user confirms.
--
-- Shape (not enforced — intentionally flexible):
--
--   {
--     "raw_name": "SHRD MOZZ 8OZ",        // exact text off the label
--     "confidence": "high" | "medium" | "low",
--     "mode": "receipt" | "fridge" | "pantry" | "freezer",
--     "detected_state": "shredded",       // if state-detection fired
--     "price_cents": 399,                  // if the scanner read a price
--     "amount_raw": "8OZ",                 // pre-parse, as seen on label
--     "scanned_at": "2026-04-16T18:30:00Z"
--   }
--
-- Written on insert AND overwritten on merge (last-wins — matches the
-- source_receipt_id semantics from chunk C). Historical scan reads
-- across merges are NOT preserved in this chunk; a future scan_reads
-- table could if needed.
--
-- NULL for rows added manually or by conversions. Existing rows stay
-- NULL until a scan touches them.

alter table public.pantry_items
  add column if not exists scan_raw jsonb null;

-- No index — scan_raw is a per-row read field, never a filter/sort
-- target. If we ever want "find all pantry rows with low-confidence
-- scan reads" we can add a GIN index then.
