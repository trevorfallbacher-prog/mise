-- 0131_brand_nutrition_label_scan_source.sql
--
-- Add 'label_scan' to the brand_nutrition.source check constraint so
-- the new scan-nutrition-label edge function can contribute brand
-- rows that are clearly distinguishable from the three existing
-- provenance values:
--
--   openfoodfacts  — Phase 3 barcode lookup via OFF
--   user           — typed by hand into NutritionOverrideSheet and
--                    subsequently promoted to brand_nutrition
--   admin          — curator-seeded
--   label_scan     — NEW — derived from a photo of the product's
--                    nutrition panel via Sonnet vision
--
-- Provenance matters for two things:
--   1. Source-badge rendering — the resolver in src/lib/nutrition.js
--      surfaces a colored chip ("YOU", "BRAND", "SCAN", ...) so the
--      user can tell at a glance where a number came from.
--   2. Admin moderation — a curator reviewing low-quality rows can
--      filter to source='label_scan' to catch misreads before they
--      propagate household-to-household.
--
-- This migration only touches the CHECK constraint. The nutrition
-- JSONB column is unshaped — new fields (saturated_fat_g, trans_fat_g,
-- cholesterol_mg, added_sugar_g, vitamin_d_mcg, calcium_mg, iron_mg,
-- potassium_mg) ride along without a column add.

alter table public.brand_nutrition
  drop constraint if exists brand_nutrition_source_check;

alter table public.brand_nutrition
  add constraint brand_nutrition_source_check
  check (source in ('openfoodfacts', 'user', 'admin', 'label_scan'));

notify pgrst, 'reload schema';
