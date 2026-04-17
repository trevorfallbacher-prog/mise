-- Scan-items snapshot on receipts + pantry_scans.
--
-- ReceiptView's "items from this scan" list was derived from
-- pantry_items.source_receipt_id, which reflects CURRENT pantry
-- state. As soon as a user cooks through rows (fully consumed →
-- deleted) or a later scan merges into existing pantry rows and
-- bumps their source_receipt_id to the newer receipt, the old
-- receipt's list shrinks. A 23-line grocery receipt can end up
-- showing only 4 items because everything else has moved on in
-- the pantry state machine. Not useful as a historical record.
--
-- Fix: snapshot the normalized scan items on the receipt / scan row
-- at scan-confirm time. The snapshot is the ground truth of "what
-- was on this receipt / shelf scan when it happened" — pantry_items
-- remain the LIVE state; receipt.scan_items is the HISTORICAL
-- record. ReceiptView renders from scan_items and cross-references
-- pantry by canonical_id / ingredient_id for the "still have it"
-- badge.
--
-- Shape (client writes an array; SQL doesn't enforce structure so
-- the shape can evolve):
--
--   [
--     {
--       name: "Mozzarella Cheese",
--       rawText: "8 OZ MOZZ",
--       emoji: "🧀",
--       amount: 1,
--       unit: "lb",
--       priceCents: 484,
--       category: "dairy",
--       canonicalId: "mozzarella",
--       ingredientId: "mozzarella",
--       ingredientIds: [],
--       confidence: "high",
--       state: null,
--       typeId: "wweia_cheese",
--       tileId: "dairy",
--       location: "fridge"
--     },
--     ...
--   ]
--
-- Null on rows that pre-date this migration — the client falls back
-- to the old pantry-derived view so legacy receipts don't show as
-- empty.

alter table public.receipts
  add column if not exists scan_items jsonb null;

alter table public.pantry_scans
  add column if not exists scan_items jsonb null;

-- No indexing — scan_items is read per-row (always via receipt id
-- lookup, never across rows). Adding a GIN index on a free-form
-- JSONB blob would cost more than it's worth for the current
-- access pattern.
