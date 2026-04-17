-- Canonical identity column (canonical_id) on pantry_items +
-- user_item_templates.
--
-- This is the "final-resting name" of the thing, SEPARATE from
-- the composition ingredient tags in ingredient_ids[]. The 18h
-- work conflated identity with composition — a Hot Dog IS a
-- "hot_dog" canonical, but its COMPONENT INGREDIENTS are things
-- like sausage + bun (or beef + bun, or tofu + bun, depending on
-- the user's specific version). Putting the canonical identity
-- into ingredient_ids[] polluted user-composed tags.
--
-- Four layers now:
--   user name      — "Frank's Best Cheese Dogs"  (name, always custom)
--   CANONICAL      — "hot_dog"                    (canonical_id, THIS column)
--   FOOD CATEGORY  — "wweia_hot_dogs"             (type_id, 0038)
--   STORED IN      — "meat_poultry"               (tile_id, 0036)
--
-- Plus ingredient_ids[] which is the user's FREE-FORM composition:
-- "what's in my version of this thing" — cheddar + ground_pork +
-- bun, or beef + bun, whatever the user actually put in.
--
-- canonical_id is TEXT because it holds bundled canonical ingredient
-- ids from src/data/ingredients.js ('hot_dog', 'green_onion',
-- 'parmesan', etc.). No user-created canonicals today — users
-- compose via ingredient_ids[] + name their custom version, but the
-- canonical identity always maps to a bundled ingredient (USDA-
-- defensible). Future migrations may introduce user_canonicals for
-- family-specific naming conventions.

-- ── canonical_id column ────────────────────────────────────────────

alter table public.pantry_items
  add column if not exists canonical_id text null;

alter table public.user_item_templates
  add column if not exists canonical_id text null;

-- Recipe-matcher hot path. A recipe ingredient calling for 'hot_dog'
-- finds every row where canonical_id = 'hot_dog' (plus the legacy
-- ingredient_ids[] GIN match from 0033). Partial index since most
-- rows are null until the type-pick flow populates canonical.
create index if not exists pantry_items_canonical_idx
  on public.pantry_items (user_id, canonical_id)
  where canonical_id is not null;

create index if not exists user_item_templates_canonical_idx
  on public.user_item_templates (user_id, canonical_id)
  where canonical_id is not null;
