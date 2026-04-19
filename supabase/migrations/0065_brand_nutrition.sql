-- 0065_brand_nutrition.sql
--
-- Brand-specific nutrition data — tier 2 of the nutrition resolver
-- hierarchy in src/lib/nutrition.js. Below a pantry-row override but
-- above canonical-averaged nutrition from ingredient_info. Solves the
-- "David's protein bar vs Quest protein bar" problem: same canonical,
-- wildly different macros, so we key per (canonical_id, brand).
--
-- Also ships pantry_items.nutrition_override in the same migration
-- so Phase 4 (manual per-jar overrides) can write into a column that
-- already exists — saves a second roundtrip.
--
-- DESIGN RULES:
--   1. brand is lowercased for the key (deduplicates "Kerrygold",
--      "KERRYGOLD", "kerrygold" into one row). display_brand preserves
--      the original casing for UI.
--   2. nutrition JSONB shape mirrors ingredient_info.info.nutrition:
--      { per, kcal, protein_g, fat_g, carb_g, fiber_g?, sodium_mg?,
--        sugar_g?, serving_g? }. Same renderers work on both sources.
--   3. recipe_slug is not involved; nutrition is per-brand, not
--      per-recipe.
--   4. source is an audit trail — we want to know if a row came from
--      Open Food Facts (Phase 3), a user contribution (Phase 4
--      "contribute to brand db" button), or an admin curator.
--   5. Public SELECT (reference data, like ingredient_info), auth
--      INSERT/UPDATE so the contribution path can write.

-- ── 1. brand_nutrition table ─────────────────────────────────────────
create table if not exists public.brand_nutrition (
  canonical_id   text        not null,   -- FK to ingredients.js id (text, no enforced FK — bundled registry)
  brand          text        not null,   -- normalized lowercase (e.g. "kerrygold")
  display_brand  text        not null,   -- original casing for UI ("Kerrygold")
  nutrition      jsonb       not null,   -- { per, kcal, protein_g, fat_g, carb_g, fiber_g?, sodium_mg?, sugar_g?, serving_g? }
  barcode        text,                   -- UPC/EAN when sourced from barcode scan
  source         text        not null check (source in ('openfoodfacts', 'user', 'admin')),
  source_id      text,                   -- e.g. Open Food Facts product id
  confidence     smallint    not null default 80,  -- 0-100, higher = more trustworthy
  created_by     uuid        references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (canonical_id, brand)
);

-- Barcode lookup path (Phase 3). Partial index skips the bulk of rows
-- that came from manual entry with no UPC.
create index if not exists brand_nutrition_barcode_idx
  on public.brand_nutrition (barcode)
  where barcode is not null;

-- Reverse lookup for admin / contribution dashboards — "show me every
-- brand we have data for under canonical_id='butter'".
create index if not exists brand_nutrition_canonical_idx
  on public.brand_nutrition (canonical_id);

-- ── 2. updated_at trigger ────────────────────────────────────────────
-- Reuses public.touch_updated_at (migration 0028).
drop trigger if exists brand_nutrition_touch_updated_at on public.brand_nutrition;
create trigger brand_nutrition_touch_updated_at
  before update on public.brand_nutrition
  for each row execute function public.touch_updated_at();

-- ── 3. RLS ───────────────────────────────────────────────────────────
alter table public.brand_nutrition enable row level security;

-- Everyone reads (reference data; mirrors ingredient_info).
drop policy if exists "brand_nutrition: public-read" on public.brand_nutrition;
create policy "brand_nutrition: public-read"
  on public.brand_nutrition for select
  using (true);

-- Any authenticated user can contribute. Phase 4's UI wraps the write
-- with a confirm dialog; raw write access is intentional (the table
-- is reference data keyed by normalized brand, so a bad row is
-- correctable, not catastrophic).
drop policy if exists "brand_nutrition: auth-insert" on public.brand_nutrition;
create policy "brand_nutrition: auth-insert"
  on public.brand_nutrition for insert
  with check (auth.uid() is not null);

-- Update / delete: self-only (restrict to the creator). Admin moderation
-- happens via direct dashboard access if needed.
drop policy if exists "brand_nutrition: self-update" on public.brand_nutrition;
create policy "brand_nutrition: self-update"
  on public.brand_nutrition for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

drop policy if exists "brand_nutrition: self-delete" on public.brand_nutrition;
create policy "brand_nutrition: self-delete"
  on public.brand_nutrition for delete
  using (auth.uid() = created_by);

-- ── 4. pantry_items.nutrition_override column ────────────────────────
-- Tier 1 of the resolver. When a user manually enters the exact label
-- numbers for a SPECIFIC jar (Phase 4 modal), it rides on the row.
-- Stays local to that jar; doesn't propagate to brand_nutrition
-- automatically (we offer a later opt-in "contribute to brand db").
alter table public.pantry_items
  add column if not exists nutrition_override jsonb;

-- ── 5. realtime ──────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'brand_nutrition'
  ) then
    alter publication supabase_realtime add table public.brand_nutrition;
  end if;
end $$;

-- ── 6. schema cache reload ───────────────────────────────────────────
notify pgrst, 'reload schema';
