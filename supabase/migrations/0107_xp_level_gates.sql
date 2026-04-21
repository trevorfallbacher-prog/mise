-- 0107_xp_level_gates.sql
--
-- Gate config. One row per gate boundary. A user cannot advance
-- past gate_level until their user_gate_progress for this gate is
-- 'passed'. XP earned past the gate (before it's passed) gets
-- dropped — the plan hard-stops accrual, not just levelling (§2).
--
-- Prereqs are encoded as a jsonb array of rule objects, each with
-- a `kind` discriminator the aggregator RPC (0110) knows how to
-- evaluate against the user's actual data. Rule kinds used here:
--
--   skill_courses_completed
--     { kind, count, min_level? }
--     # of skills in profiles.skill_levels with value ≥ min_level
--     (default min_level=5 → maxed). count is the threshold.
--
--   recipe_categories_covered
--     { kind, categories: [..] }
--     user has cooked ≥1 recipe in each listed category
--     (checked via cook_logs.recipe_category).
--
--   streak_count_min
--     { kind, days }
--     profiles.streak_count >= days, currently active.
--
--   host_meal_with_diners
--     { kind, min_diners }
--     at least one cook_logs row authored where
--     array_length(diners, 1) >= min_diners.
--
--   curated_lessons_per_cuisine
--     { kind, lessons_per_cuisine, cuisine_count }
--     count of distinct cuisines in user_curated_lessons
--     where lesson_count >= lessons_per_cuisine is ≥ cuisine_count.
--
--   curated_cooks_total
--     { kind, count }
--     sum(lesson_count) across user_curated_lessons >= count.
--
--   curated_collections_mastered
--     { kind, count }
--     # of distinct curated collections where the user has cooked
--     every slug in that collection. (Counted once the collection
--     concept lands — §7 open #4.)
--
--   all_skills_maxed
--     { kind }
--     every skill in the SKILL_TREE has level == max (5).
--
-- gate_recipe_slugs is the 3-option ranked-match picker list. Left
-- empty at seed time — product fills in once the curated library
-- has enough difficult dishes (§2). The UI gracefully handles an
-- empty list by telling the user "gate recipes are being curated."
--
-- Gate 1 is at L20 (NOT L10) per §2 — the first month should feel
-- smooth, not gated.
--
-- See docs/plans/xp-leveling.md §2 (Level gates).

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_level_gates (
  gate_level          int          primary key,
  prereqs             jsonb        not null default '[]'::jsonb,
  gate_recipe_slugs   text[]       not null default '{}'::text[],
  label               text         not null,
  description         text,
  updated_at          timestamptz  not null default now(),
  updated_by          uuid         references auth.users(id)
);

-- ── 2. Row-level security ───────────────────────────────────────────

alter table public.xp_level_gates enable row level security;

drop policy if exists "xp_level_gates: read-all-authenticated" on public.xp_level_gates;
create policy "xp_level_gates: read-all-authenticated"
  on public.xp_level_gates for select
  to authenticated
  using (true);

-- ── 3. Audit trigger (same family as other xp_config*) ─────────────

drop trigger if exists xp_level_gates_audit_trg on public.xp_level_gates;
create trigger xp_level_gates_audit_trg
  after insert or update or delete on public.xp_level_gates
  for each row execute function public.xp_config_audit_fn('gate_level');

-- ── 4. Seed — 4 gates, prereqs locked, gate_recipe_slugs TBD ───────

insert into public.xp_level_gates (gate_level, prereqs, gate_recipe_slugs, label, description) values
  (
    20,
    '[
      { "kind": "skill_courses_completed", "count": 1, "min_level": 5 },
      { "kind": "recipe_categories_covered", "categories": ["breakfast", "lunch", "dinner"] },
      { "kind": "streak_count_min", "days": 3 }
    ]'::jsonb,
    '{}'::text[],
    'Home Chef → Sous Chef',
    'Prove you can string together a full day of meals, stay consistent, and finish a skill course.'
  ),
  (
    35,
    '[
      { "kind": "skill_courses_completed", "count": 2, "min_level": 3 },
      { "kind": "host_meal_with_diners", "min_diners": 3 },
      { "kind": "curated_lessons_per_cuisine", "lessons_per_cuisine": 5, "cuisine_count": 3 },
      { "kind": "streak_count_min", "days": 7 }
    ]'::jsonb,
    '{}'::text[],
    'Sous Chef → Head Chef',
    'Show range across cuisines, consistency across weeks, and the ability to host.'
  ),
  (
    50,
    '[
      { "kind": "skill_courses_completed", "count": 4, "min_level": 5 },
      { "kind": "curated_cooks_total", "count": 25 },
      { "kind": "curated_collections_mastered", "count": 2 },
      { "kind": "streak_count_min", "days": 14 }
    ]'::jsonb,
    '{}'::text[],
    'Head Chef → Executive Chef',
    'Mastery across multiple disciplines, deep curated work, a fortnight of momentum.'
  ),
  (
    75,
    '[
      { "kind": "all_skills_maxed" },
      { "kind": "curated_lessons_per_cuisine", "lessons_per_cuisine": 20, "cuisine_count": 5 },
      { "kind": "curated_collections_mastered", "count": 999 },
      { "kind": "streak_count_min", "days": 30 }
    ]'::jsonb,
    '{}'::text[],
    'Executive Chef → Iron Chef',
    'Every skill maxed, ladder-max in five cuisines, every curated collection, a month of fire.'
  )
on conflict (gate_level) do update set
  prereqs     = excluded.prereqs,
  label       = excluded.label,
  description = excluded.description;
