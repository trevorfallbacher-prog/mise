-- 0066_pantry_attributes.sql
--
-- Flexible metadata ride-along on pantry items. Open Food Facts returns
-- richer product metadata than we previously captured — origin,
-- certifications (USDA Organic, Kosher, Non-GMO, PDO, etc.), flavor
-- variants, and over time grade / variety / intensity / age. Each of
-- these is orthogonal to the primary identity axes (canonical, brand,
-- state) per CLAUDE.md, so rather than adding N columns over N
-- migrations we store them as a JSONB blob that grows flexibly.
--
-- Shape (documented; schema enforces none):
--   {
--     "origins":        ["Italy", "Parma"],
--     "certifications": [
--       { "id": "usda-organic",          "label": "USDA Organic" },
--       { "id": "non-gmo-project-verified", "label": "Non-GMO Project Verified" }
--     ],
--     "flavor":         ["wasabi"],
--     "variety":        "wagyu",       -- future
--     "grade":          "prime",       -- future
--     "intensity":      "sharp",       -- future
--     "age":            "24-month",    -- future
--     "productionMethod": "pasture-raised"  -- future
--   }
--
-- All fields optional. Known keys get pills rendered on ItemCard;
-- unknown keys render as generic key:value chips so the model can
-- grow without a frontend rebuild per new field.
--
-- Writers: AddItemModal (post-scan extraction), ItemCard (post-scan
-- extraction on brand-chooser flow), future Phase 2 auto-enrichment.
-- Readers: ItemCard identity stack (attribute pills), future
-- filter/search surfaces.

alter table public.pantry_items
  add column if not exists attributes jsonb;

comment on column public.pantry_items.attributes is
  'Flexible metadata ride-along (origins, certifications, flavor, variety, grade, intensity, age, production method). See src/lib/canonicalResolver.js for extraction. Nullable.';

-- ── schema cache reload ───────────────────────────────────────────────
notify pgrst, 'reload schema';
