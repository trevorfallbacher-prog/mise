-- 0132_brand_nutrition_ingredients.sql
--
-- Adds the PRODUCT ingredient list + allergen statement to
-- brand_nutrition, alongside the nutrition macros row. Surfaced by
-- the scan-nutrition-label edge function when the photo captures
-- the "Ingredients:" panel next to the Nutrition Facts panel (most
-- US packaging prints them side by side or stacked).
--
-- Two fields:
--
--   ingredients_text — the raw ingredient declaration, as-printed.
--     Preserved verbatim (minus trivial whitespace normalization)
--     so legal disclosures ("with 2% or less of…", "may contain…")
--     stay intact. Displayable, searchable, editable. Stored as
--     plain text because the label layout is prose, not a list.
--
--   allergens — parsed array of lowercase allergen tokens pulled
--     from the "Contains:" statement (FDA requires this bold
--     summary line on every US package that contains any of the
--     9 major allergens). Normalized to lowercase singular form
--     (["milk","soy","wheat","peanuts",…]) so cross-household
--     filtering ("hide items with peanuts") is a simple contains
--     query.
--
-- Both are shared reference data keyed by (canonical_id, brand).
-- Per-jar overrides ride on pantry_items.nutrition_override jsonb
-- as sibling keys — no pantry_items schema change needed.

alter table public.brand_nutrition
  add column if not exists ingredients_text text,
  add column if not exists allergens        text[];

-- Quick GIN index for allergen filtering — "show me every stocked
-- item that contains peanuts" becomes an indexed `&& ARRAY['peanuts']`
-- containment check.
create index if not exists brand_nutrition_allergens_idx
  on public.brand_nutrition
  using gin (allergens)
  where allergens is not null;

notify pgrst, 'reload schema';
