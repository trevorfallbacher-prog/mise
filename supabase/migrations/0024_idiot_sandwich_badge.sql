-- mise — Idiot Sandwich easter-egg badge
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- A non-recipe, hidden badge seeded for discovery via Home's rare
-- greeting pool. When the "What are you, Trevor?" line surfaces the
-- client inserts a user_badges row and a celebratory notification
-- (self-insert RLS covers both — no RPC needed). Because it's hidden,
-- nobody sees a locked silhouette hinting at its existence — it only
-- reveals on the wall after earning.
--
-- icon_path points at /badges/idiot-sandwich.svg. No SVG is committed
-- yet — the <img onError> fallback in BadgeWall will render a 🏅
-- placeholder until one's dropped into public/badges/. Upload whenever,
-- no migration edit needed.

insert into public.badges
  (slug, name, description, icon_path, recipe_slug, earn_rule, tier, color,
   max_awards, is_hidden, priority)
values (
  'idiot-sandwich',
  'Idiot Sandwich',
  'Caught mid-doomscroll by Chef Ramsay himself. You hopeless donkey.',
  '/badges/idiot-sandwich.svg',
  null,   -- not tied to a recipe — the award path is client-side
  'Some things find you. Keep refreshing.',
  'bronze',
  '#c8a878',
  null,   -- anyone can earn it
  true,   -- hidden: silhouette suppressed on the wall until earned
  10      -- below 1/1s but still ranks above anonymous standards
)
on conflict (slug) do update set
  name        = excluded.name,
  description = excluded.description,
  icon_path   = excluded.icon_path,
  recipe_slug = excluded.recipe_slug,
  earn_rule   = excluded.earn_rule,
  tier        = excluded.tier,
  color       = excluded.color,
  max_awards  = excluded.max_awards,
  is_hidden   = excluded.is_hidden,
  priority    = excluded.priority;
