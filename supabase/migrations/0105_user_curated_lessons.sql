-- 0105_user_curated_lessons.sql
--
-- Per-user, per-cuisine curated-lesson counter. Drives the curated-
-- ladder multiplier lookup in award_xp (0106) — instead of joining
-- cook_logs × curated_recipes × counting on every cook_complete, we
-- maintain a small rollup table that answers the question in O(1).
--
-- Row shape:
--   (user_id, cuisine) composite PK
--   lesson_count     int, # of curated-learn cooks in this cuisine
--   last_cooked_at   timestamptz
--
-- The trigger on cook_logs INSERT:
--   - Looks up curated_recipes by new.recipe_slug
--   - Only fires when route_tags contains 'learn' AND cuisine is set
--   - Upserts into user_curated_lessons, incrementing lesson_count
--
-- The curated multiplier in award_xp then walks xp_curated_ladder
-- to find the tier whose min_lessons_in_cuisine ≤ this count. Max
-- rung is 20+ lessons → 3.0× per §2.
--
-- Intentionally counts EVERY curated cook, not just first-times —
-- a user who cooks aglio-e-olio 20× builds up italian depth even
-- though only the first cook awards the +100 first-time bonus.
-- Mastery is the point of the ladder.
--
-- See docs/plans/xp-leveling.md §2.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.user_curated_lessons (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  cuisine         text        not null,
  lesson_count    int         not null default 0,
  last_cooked_at  timestamptz,
  primary key (user_id, cuisine)
);

create index if not exists user_curated_lessons_user_idx
  on public.user_curated_lessons (user_id);

alter table public.user_curated_lessons enable row level security;

drop policy if exists "user_curated_lessons: self-select" on public.user_curated_lessons;
create policy "user_curated_lessons: self-select"
  on public.user_curated_lessons for select
  to authenticated
  using (auth.uid() = user_id);

-- ── 2. Trigger on cook_logs ─────────────────────────────────────────

create or replace function public.user_curated_lessons_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.curated_recipes%rowtype;
begin
  if new.recipe_slug is null then
    return new;
  end if;

  select * into v_row from public.curated_recipes where slug = new.recipe_slug;
  if not found then
    return new;
  end if;
  if v_row.cuisine is null then
    return new;
  end if;
  if not (v_row.route_tags @> array['learn']::text[]) then
    return new;
  end if;

  insert into public.user_curated_lessons (user_id, cuisine, lesson_count, last_cooked_at)
  values (new.user_id, v_row.cuisine, 1, coalesce(new.cooked_at, new.created_at))
  on conflict (user_id, cuisine) do update
    set lesson_count   = public.user_curated_lessons.lesson_count + 1,
        last_cooked_at = excluded.last_cooked_at;

  return new;
exception when others then
  raise warning 'user_curated_lessons_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists cook_logs_curated_lessons on public.cook_logs;
create trigger cook_logs_curated_lessons
  after insert on public.cook_logs
  for each row execute function public.user_curated_lessons_fn();
