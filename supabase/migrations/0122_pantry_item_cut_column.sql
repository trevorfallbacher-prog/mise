-- CUT column on pantry_items — seventh identity axis, orthogonal to
-- STATE and CANONICAL.
--
-- Per CLAUDE.md the identity hierarchy treats STATE (cubed, diced,
-- sliced, ground, minced, …) and CUT (breast, thigh, loin, ribeye,
-- brisket, …) as orthogonal. Cubed chicken breast and ground chicken
-- thigh are the same canonical (chicken) with different (cut, state)
-- tuples. The bundled registry has historically violated this by
-- giving every cut its own canonical (`chicken_breast`,
-- `chicken_thigh`, `ribeye`, `brisket`, …), which baked anatomy into
-- identity and made a generic "Chicken" recipe call fail to pair
-- with the user's Chicken Breast.
--
-- This migration introduces the CUT column on pantry_items (and
-- user_item_templates for scan-memory parity, matching 0061's brand
-- migration shape) and rewrites every existing cut-sibling
-- canonical_id to the base canonical + a cut value. Rows written
-- under the deprecated slugs continue to render correctly because
-- findIngredient + CANONICAL_ALIASES redirect on lookup; this
-- migration is the eventual cleanup pass that gets the DB into the
-- new shape.
--
-- Cut-sibling inventory (14 slugs → 4 base canonicals):
--
--   chicken  ← chicken_breast, chicken_thigh, chicken_leg,
--              chicken_wing, chicken_tenderloin
--   beef     ← ribeye, ny_strip, sirloin, brisket, chuck_roast
--   pork     ← pork_chop, pork_loin, pork_shoulder
--   turkey   ← turkey_breast
--
-- Idempotent; safe to re-run (ADD COLUMN IF NOT EXISTS, and the
-- UPDATEs match on the deprecated canonical_id which is already
-- rewritten the second time through).

-- ── cut column ────────────────────────────────────────────────────

alter table public.pantry_items
  add column if not exists cut text null;

alter table public.user_item_templates
  add column if not exists cut text null;

-- Partial indexes — most rows are null (produce, pantry staples have
-- no cut axis). Mirrors the brand index from 0061.
create index if not exists pantry_items_cut_idx
  on public.pantry_items (user_id, cut)
  where cut is not null;

create index if not exists user_item_templates_cut_idx
  on public.user_item_templates (user_id, cut)
  where cut is not null;

-- ── backfill: chicken cuts ─────────────────────────────────────────
-- ingredient_id is the legacy column (pre-0056) but some rows still
-- write it; canonical_id is the current identity column. Both get
-- rewritten so every read path sees the base canonical.

update public.pantry_items
   set canonical_id  = 'chicken',
       ingredient_id = 'chicken',
       cut           = coalesce(cut, 'breast')
 where canonical_id = 'chicken_breast' or ingredient_id = 'chicken_breast';

update public.pantry_items
   set canonical_id  = 'chicken',
       ingredient_id = 'chicken',
       cut           = coalesce(cut, 'thigh')
 where canonical_id = 'chicken_thigh' or ingredient_id = 'chicken_thigh';

update public.pantry_items
   set canonical_id  = 'chicken',
       ingredient_id = 'chicken',
       cut           = coalesce(cut, 'leg')
 where canonical_id = 'chicken_leg' or ingredient_id = 'chicken_leg';

update public.pantry_items
   set canonical_id  = 'chicken',
       ingredient_id = 'chicken',
       cut           = coalesce(cut, 'wing')
 where canonical_id = 'chicken_wing' or ingredient_id = 'chicken_wing';

update public.pantry_items
   set canonical_id  = 'chicken',
       ingredient_id = 'chicken',
       cut           = coalesce(cut, 'tenderloin')
 where canonical_id = 'chicken_tenderloin' or ingredient_id = 'chicken_tenderloin';

-- ── backfill: beef cuts ────────────────────────────────────────────

update public.pantry_items
   set canonical_id  = 'beef',
       ingredient_id = 'beef',
       cut           = coalesce(cut, 'ribeye')
 where canonical_id = 'ribeye' or ingredient_id = 'ribeye';

update public.pantry_items
   set canonical_id  = 'beef',
       ingredient_id = 'beef',
       cut           = coalesce(cut, 'ny_strip')
 where canonical_id = 'ny_strip' or ingredient_id = 'ny_strip';

update public.pantry_items
   set canonical_id  = 'beef',
       ingredient_id = 'beef',
       cut           = coalesce(cut, 'sirloin')
 where canonical_id = 'sirloin' or ingredient_id = 'sirloin';

update public.pantry_items
   set canonical_id  = 'beef',
       ingredient_id = 'beef',
       cut           = coalesce(cut, 'brisket')
 where canonical_id = 'brisket' or ingredient_id = 'brisket';

update public.pantry_items
   set canonical_id  = 'beef',
       ingredient_id = 'beef',
       cut           = coalesce(cut, 'chuck')
 where canonical_id = 'chuck_roast' or ingredient_id = 'chuck_roast';

-- ── backfill: pork cuts ────────────────────────────────────────────

update public.pantry_items
   set canonical_id  = 'pork',
       ingredient_id = 'pork',
       cut           = coalesce(cut, 'chop')
 where canonical_id = 'pork_chop' or ingredient_id = 'pork_chop';

update public.pantry_items
   set canonical_id  = 'pork',
       ingredient_id = 'pork',
       cut           = coalesce(cut, 'loin')
 where canonical_id = 'pork_loin' or ingredient_id = 'pork_loin';

update public.pantry_items
   set canonical_id  = 'pork',
       ingredient_id = 'pork',
       cut           = coalesce(cut, 'shoulder')
 where canonical_id = 'pork_shoulder' or ingredient_id = 'pork_shoulder';

-- ── backfill: turkey cuts ──────────────────────────────────────────

update public.pantry_items
   set canonical_id  = 'turkey',
       ingredient_id = 'turkey',
       cut           = coalesce(cut, 'breast')
 where canonical_id = 'turkey_breast' or ingredient_id = 'turkey_breast';

-- Same rewrites on user_item_templates so scan-memory repurchases
-- land on the base canonical + cut instead of re-writing the legacy
-- slug every time.

update public.user_item_templates
   set canonical_id = 'chicken', cut = coalesce(cut, 'breast')
 where canonical_id = 'chicken_breast';
update public.user_item_templates
   set canonical_id = 'chicken', cut = coalesce(cut, 'thigh')
 where canonical_id = 'chicken_thigh';
update public.user_item_templates
   set canonical_id = 'chicken', cut = coalesce(cut, 'leg')
 where canonical_id = 'chicken_leg';
update public.user_item_templates
   set canonical_id = 'chicken', cut = coalesce(cut, 'wing')
 where canonical_id = 'chicken_wing';
update public.user_item_templates
   set canonical_id = 'chicken', cut = coalesce(cut, 'tenderloin')
 where canonical_id = 'chicken_tenderloin';
update public.user_item_templates
   set canonical_id = 'beef', cut = coalesce(cut, 'ribeye')
 where canonical_id = 'ribeye';
update public.user_item_templates
   set canonical_id = 'beef', cut = coalesce(cut, 'ny_strip')
 where canonical_id = 'ny_strip';
update public.user_item_templates
   set canonical_id = 'beef', cut = coalesce(cut, 'sirloin')
 where canonical_id = 'sirloin';
update public.user_item_templates
   set canonical_id = 'beef', cut = coalesce(cut, 'brisket')
 where canonical_id = 'brisket';
update public.user_item_templates
   set canonical_id = 'beef', cut = coalesce(cut, 'chuck')
 where canonical_id = 'chuck_roast';
update public.user_item_templates
   set canonical_id = 'pork', cut = coalesce(cut, 'chop')
 where canonical_id = 'pork_chop';
update public.user_item_templates
   set canonical_id = 'pork', cut = coalesce(cut, 'loin')
 where canonical_id = 'pork_loin';
update public.user_item_templates
   set canonical_id = 'pork', cut = coalesce(cut, 'shoulder')
 where canonical_id = 'pork_shoulder';
update public.user_item_templates
   set canonical_id = 'turkey', cut = coalesce(cut, 'breast')
 where canonical_id = 'turkey_breast';

-- Verification queries (run manually after applying):
--
--   -- No rows should carry a cut-sibling slug anymore.
--   select canonical_id, count(*)
--     from public.pantry_items
--    where canonical_id in (
--      'chicken_breast','chicken_thigh','chicken_leg','chicken_wing','chicken_tenderloin',
--      'ribeye','ny_strip','sirloin','brisket','chuck_roast',
--      'pork_chop','pork_loin','pork_shoulder',
--      'turkey_breast'
--    )
--    group by canonical_id;
--   -- expect: 0 rows
--
--   -- Spot-check: base canonicals now carry cut distribution.
--   select canonical_id, cut, count(*)
--     from public.pantry_items
--    where canonical_id in ('chicken','beef','pork','turkey')
--    group by canonical_id, cut
--    order by canonical_id, cut;
