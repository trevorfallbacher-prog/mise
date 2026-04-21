-- 0072_xp_source_values.sql
--
-- Per-source XP configuration: base value, daily cap, per-cook cap,
-- and whether the source participates in the curated-ladder multiplier.
-- One row per distinct earn source (cook_complete, scan_add,
-- photo_upload, canonical_create, ...). award_xp() joins on source
-- to resolve its base_xp and caps.
--
-- `flat_bonus` semantics: when TRUE, the curated-ladder multiplier
-- from §2 does NOT apply to this source. The cook-complete base is
-- the only source that participates in the ladder; everything else
-- (first-time bonus, plan→cook closed, eat-together, photos, …) is
-- flat by design so cuisine explorers aren't outpaced.
--
-- Micro-cap semantics: `per_day_cap` (NULL = uncapped) is enforced
-- per user per local day by award_xp(). `per_cook_cap` (NULL = n/a)
-- only applies when ref_table = 'cook_logs' (photos: 2/cook).
--
-- A few per-scope caps noted in the plan (authors_cut 3× per recipe
-- lifetime; cook_together 1× per partner pair per day) are enforced
-- in code rather than schema — they don't fit a simple daily-cap
-- column. See award_xp() in 0084+.
--
-- See docs/plans/xp-leveling.md §1 for the master source table.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_source_values (
  source         text         primary key,
  base_xp        int          not null,
  per_day_cap    int,
  per_cook_cap   int,
  flat_bonus     boolean      not null default true,
  description    text,
  updated_at     timestamptz  not null default now(),
  updated_by     uuid         references auth.users(id)
);

-- ── 2. Row-level security ───────────────────────────────────────────

alter table public.xp_source_values enable row level security;

drop policy if exists "xp_source_values: read-all-authenticated" on public.xp_source_values;
create policy "xp_source_values: read-all-authenticated"
  on public.xp_source_values for select
  to authenticated
  using (true);

-- ── 3. Seed ─────────────────────────────────────────────────────────
-- Values mirror docs/plans/xp-leveling.md §1. Tweakable post-ship via
-- the audit RPC.

insert into public.xp_source_values (source, base_xp, per_day_cap, per_cook_cap, flat_bonus, description) values
  -- Cooking (base source is curated-ladder eligible)
  ('cook_complete',            50,  null, null, false, 'Base XP for completing any cook. Curated ladder multiplier applies when the recipe has route "learn".'),
  ('first_time_recipe',       100,  null, null, true,  'One-time bonus per (user, recipe_key). Deduped via recipe_first_cooks.'),
  ('plan_cook_closed',         15,  null, null, true,  'Planned meal cooked at/near its scheduled slot.'),
  ('eat_together',             50,  3,    null, true,  'Meal had ≥2 diners. Cap 3/day.'),
  ('cook_together',            10,  null, null, true,  '1× per partner pair per day (enforced in code).'),
  ('authors_cut',              10,  null, null, true,  'Awarded when someone cooks a recipe you authored. Cap 3/recipe lifetime (enforced in code).'),
  ('mastery_5x',               25,  null, null, false, 'Dialed-in milestone: 5 cooks of the same recipe. Curated multiplier applies.'),
  ('mastery_10x',              75,  null, null, false, 'Dialed-in milestone: 10 cooks of the same recipe.'),
  ('mastery_25x',             200,  null, null, false, 'Dialed-in milestone: 25 cooks of the same recipe.'),
  -- Curated progression (apex)
  ('curated_set_complete',    500,  null, null, true,  'Completed every recipe in a curated collection tag.'),
  ('curated_collection_master', 1000, null, null, true, 'Legendary badge awarded alongside.'),
  -- Data contribution
  ('scan_add',                  5,  50,   null, true,  'Barcode scan or pantry add. Cap 50 XP/day (~10 scans).'),
  ('photo_upload',             10,  null, 2,    true,  '≤2 photos per cook.'),
  ('canonical_create',         15,  null, null, true,  'At CanonicalCreatePrompt submission.'),
  ('canonical_approved',       25,  null, null, true,  'Retro-awarded when admin approves (ingredient_info row lands).'),
  ('authored_recipe',          50,  null, null, true,  'Authored a new user_recipe with ≥3 steps AND ≥3 ingredients.'),
  ('review_cook',               5,  3,    null, true,  'Rated/noted someone else''s meal. Cap 3/day.'),
  ('nutrition_goal_day',       25,  1,    null, true,  'Hit daily kcal/macros on NutritionDashboard. 1×/day.'),
  ('pantry_hygiene',            2,  10,   null, true,  'Mark used, fix qty, etc. Cap 10 XP/day (~5 edits).'),
  -- Onboarding starter pack (one-time — exempt from daily caps via source-specific logic)
  ('onboarding_first_household',  10, null, null, true, 'First household created.'),
  ('onboarding_first_pantry',     10, null, null, true, 'First pantry item added.'),
  ('onboarding_first_cook',       20, null, null, true, 'First cook complete.'),
  ('onboarding_first_canonical',  15, null, null, true, 'First canonical linked.'),
  ('onboarding_first_plan',       10, null, null, true, 'First plan entry.'),
  ('onboarding_first_friend',     15, null, null, true, 'First friend / household member added.'),
  -- Daily login roll (XP value is dynamic per roll — row exists so the source enum is complete)
  ('daily_roll',                 0,  1,    null, true,  'Once-per-day scratch card. Actual XP comes from xp_rarity_rolls.'),
  -- Badge earn (XP value dynamic per badge tier — see xp_badge_tier_xp)
  ('badge_earn',                 0,  null, null, true,  'XP comes from xp_badge_tier_xp keyed by badges.tier.'),
  -- Revival fee (negative earn — award_xp handles the sign)
  ('streak_revival',             0,  null, null, true,  'XP deducted to revive an expired streak. Amount from xp_config.revival_fee. §3.');
