-- Brand column on pantry_items — first-class BRAND axis for the
-- identity stack.
--
-- Per CLAUDE.md the pantry identity stack has six rows:
--
--   1. CUSTOM NAME   — free text (title italic)
--   2. CANONICAL     — tan    (#b8a878)
--   3. CATEGORIES    — orange (#e07a3a)
--   4. STORED IN     — blue   (#7eb8d4)
--   5. STATE         — purple (#c7a8d4)
--   6. INGREDIENTS   — yellow (#f5c842)
--
-- Brand has been riding along inside the free-text name
-- ("KERRYGOLD UNSALTED BUTTER") and leaking into CANONICAL inference
-- as noise — the substring matcher saw "KERRYGOLD" and fell through
-- because no canonical aliases it, then the state detector fought
-- the brand tokens for keyword real estate. Pulling brand onto its
-- own column lets parseIdentity(rawText) strip the brand BEFORE
-- STATE and CANONICAL run, which cleans up matches on receipts that
-- lead with the manufacturer ("TYSON CHKN TNDRLN").
--
-- Brand is orthogonal to the six rendered rows — it's metadata the
-- name can surface parenthetically, not a new colored axis. We keep
-- it on pantry_items so the scan-correction / template-memory path
-- can remember "this was Kerrygold" across repurchases without
-- polluting CANONICAL.
--
-- Mirrors canonical_id's shape from migration 0039: nullable TEXT,
-- no CHECK, no FK. Free-form so receipts can write whatever brand
-- Claude extracts without us having to pre-register every grocery
-- SKU. A future migration may lift a bundled BRANDS registry in the
-- same way CANONICAL_ALIASES unified state-baked slugs.

-- ── brand column ───────────────────────────────────────────────────

alter table public.pantry_items
  add column if not exists brand text null;

alter table public.user_item_templates
  add column if not exists brand text null;

-- Template / scan-correction match path reads (user_id, brand) when
-- re-applying brand memory across repurchases. Partial index — most
-- rows are null until the parser starts populating.
create index if not exists pantry_items_brand_idx
  on public.pantry_items (user_id, brand)
  where brand is not null;

create index if not exists user_item_templates_brand_idx
  on public.user_item_templates (user_id, brand)
  where brand is not null;
