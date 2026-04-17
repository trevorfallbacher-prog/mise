-- tile_id memory on user_item_templates and pantry_items.
--
-- Solves the "frozen cheese pizza lands on the dairy tile" bug. The
-- tile classifiers currently pick an item's primary canonical and
-- route by that — fine for atomic ingredients (a mozzarella block
-- goes to Dairy) but wrong for composed Meals where the primary
-- component is not the item's identity (a frozen pizza's primary is
-- mozzarella -> Dairy, but the pizza is a Frozen Meal).
--
-- Fix: let the user's explicit tile choice win over the heuristic.
--
--   * When a user adds a custom item from a specific tile
--     (AddItemModal opened via the tile's + button), stamp that
--     tile_id onto the new pantry_items row AND the auto-saved
--     template so future re-adds and family-member adds inherit the
--     placement.
--
--   * The classifier adds a short-circuit: if item.tile_id is set,
--     return it directly. Falls back to the existing heuristic when
--     unset, so the change is purely additive — items from before
--     this migration keep their current behavior.
--
-- tile_id is a plain text column (no FK) because tile ids are bundled
-- client-side in fridgeTiles.js / pantryTiles.js / freezerTiles.js and
-- aren't a DB-shaped concept. The client validates existence before
-- writing.

-- ── pantry_items ────────────────────────────────────────────────────
alter table public.pantry_items
  add column if not exists tile_id text null;

-- Optional index. Not critical for current queries (classifier runs
-- client-side off an already-loaded row), but useful for future
-- "show me everything on this tile" server-side lookups as the
-- pantry scales past what the client wants to load.
create index if not exists pantry_items_tile_idx
  on public.pantry_items (user_id, tile_id)
  where tile_id is not null;

-- ── user_item_templates ─────────────────────────────────────────────
alter table public.user_item_templates
  add column if not exists tile_id text null;

-- Templates filter by tile_id in the recents/typeahead context boost
-- (user adding from a specific tile gets templates from that tile
-- floated first). GIN not needed — simple equality scan on a tiny
-- per-user / per-family row set.
create index if not exists user_item_templates_tile_idx
  on public.user_item_templates (user_id, tile_id)
  where tile_id is not null;
