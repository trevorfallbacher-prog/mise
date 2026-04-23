-- 0136_cook_step_telemetry.sql
--
-- Captures real per-step cook durations so the app can eventually
-- calibrate prep-notification lead times against what cooks ACTUALLY
-- spend, not what the recipe author estimated. The user's framing:
-- "if we don't have time based logs of how long cooks take we need
-- to make them."
--
-- Shape:
--   cook_sessions      — one row per live cook. Opened when the user
--                        enters CookMode; closed when they finish or
--                        abandon. cook_log_id is stamped from the
--                        matching cook_logs row at finish time.
--   cook_session_steps — one row per step the cook starts. Start/finish
--                        timestamps + an optional "skipped" flag +
--                        a free-text note. A GENERATED column exposes
--                        duration_seconds for easy aggregation.
--
-- Why a sessions table at all, rather than hanging steps directly off
-- cook_logs? Because cook_logs is INSERTED at the END of a cook (rating,
-- notes, diners are captured post-facto). We need a parent row that
-- exists while the cook is in progress so step rows have something to
-- reference from the first step on. The session gets joined to the
-- cook_log at finalize time.
--
-- RLS: family-read (so a cook can see their spouse's in-progress
-- cook status — "I see you just hit the 'sear' step, want help?"),
-- self-write.
--
-- Safe to re-run.

-- ── 1. cook_sessions ────────────────────────────────────────────────
create table if not exists public.cook_sessions (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  recipe_slug    text        not null,
  recipe_title   text,
  recipe_emoji   text,

  started_at     timestamptz not null default now(),
  ended_at       timestamptz,

  -- null while the cook is in progress; stamped at log time. Separate
  -- from started_at/ended_at so an abandoned cook still has a session
  -- row (for analytics) but no cook_log.
  cook_log_id    uuid                 references public.cook_logs(id) on delete set null,

  -- 'active' while open, 'finished' on successful finalize, 'abandoned'
  -- when the user bails out of CookMode without logging.
  status         text        not null default 'active'
                 check (status in ('active', 'finished', 'abandoned')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists cook_sessions_user_idx
  on public.cook_sessions (user_id, started_at desc);
create index if not exists cook_sessions_recipe_idx
  on public.cook_sessions (recipe_slug);
-- Partial index for "find my active session" queries — small and hot.
create index if not exists cook_sessions_active_idx
  on public.cook_sessions (user_id)
  where status = 'active';

alter table public.cook_sessions enable row level security;

drop policy if exists "cook_sessions: family-select" on public.cook_sessions;
create policy "cook_sessions: family-select"
  on public.cook_sessions for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "cook_sessions: self-insert" on public.cook_sessions;
create policy "cook_sessions: self-insert"
  on public.cook_sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "cook_sessions: self-update" on public.cook_sessions;
create policy "cook_sessions: self-update"
  on public.cook_sessions for update
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "cook_sessions: self-delete" on public.cook_sessions;
create policy "cook_sessions: self-delete"
  on public.cook_sessions for delete
  using (auth.uid() = user_id);

drop trigger if exists cook_sessions_set_updated_at on public.cook_sessions;
create trigger cook_sessions_set_updated_at
  before update on public.cook_sessions
  for each row execute function public.touch_updated_at();

-- ── 2. cook_session_steps ───────────────────────────────────────────
create table if not exists public.cook_session_steps (
  id                uuid        primary key default gen_random_uuid(),
  cook_session_id   uuid        not null references public.cook_sessions(id) on delete cascade,
  user_id           uuid        not null references auth.users(id) on delete cascade,

  -- step_id is the recipe's step.id (int on bundled recipes, stringy
  -- on user recipes). Stored as text to avoid coupling to a specific
  -- type, matched back to the recipe's steps array on read.
  step_id           text        not null,
  step_title        text,
  -- Nominal timer from the recipe in seconds (recipe.steps[i].timer)
  -- — lets us compute actual vs. nominal drift per cook.
  nominal_seconds   integer,

  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  skipped           boolean     not null default false,
  note              text,

  -- Convenience: null until finished_at is set. Keeps SELECT queries
  -- for analytics one-liner.
  duration_seconds  integer     generated always as (
                       case
                         when finished_at is null then null
                         else greatest(0, extract(epoch from finished_at - started_at)::int)
                       end
                     ) stored,

  created_at        timestamptz not null default now()
);

create index if not exists cook_session_steps_session_idx
  on public.cook_session_steps (cook_session_id, started_at);
create index if not exists cook_session_steps_user_idx
  on public.cook_session_steps (user_id);

alter table public.cook_session_steps enable row level security;

drop policy if exists "cook_session_steps: family-select" on public.cook_session_steps;
create policy "cook_session_steps: family-select"
  on public.cook_session_steps for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "cook_session_steps: self-insert" on public.cook_session_steps;
create policy "cook_session_steps: self-insert"
  on public.cook_session_steps for insert
  with check (auth.uid() = user_id);

drop policy if exists "cook_session_steps: self-update" on public.cook_session_steps;
create policy "cook_session_steps: self-update"
  on public.cook_session_steps for update
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "cook_session_steps: self-delete" on public.cook_session_steps;
create policy "cook_session_steps: self-delete"
  on public.cook_session_steps for delete
  using (auth.uid() = user_id);

-- ── 3. View: per-recipe observed cook durations ─────────────────────
-- A read-only convenience for the eventual lead-time calibration
-- job. Aggregates FINISHED sessions only (active/abandoned would
-- bias low) and only COMPLETED steps (a step started and never
-- finished is noise). Exposes median-ish via percentile_cont so
-- outliers from first-time cooks don't skew the estimate.
create or replace view public.cook_duration_stats as
  select
    cs.recipe_slug,
    count(*)                           as sample_count,
    avg(s.duration_seconds)::int       as avg_seconds,
    percentile_cont(0.5) within group (order by s.duration_seconds)::int as p50_seconds,
    percentile_cont(0.9) within group (order by s.duration_seconds)::int as p90_seconds
  from public.cook_session_steps s
  join public.cook_sessions cs on cs.id = s.cook_session_id
  where cs.status = 'finished'
    and s.finished_at is not null
    and not s.skipped
  group by cs.recipe_slug;

grant select on public.cook_duration_stats to authenticated;

-- ── 4. Realtime ─────────────────────────────────────────────────────
-- Family members seeing each other's in-progress cooks is the point
-- of family-read RLS. Realtime makes that view live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cook_sessions'
  ) then
    alter publication supabase_realtime add table public.cook_sessions;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cook_session_steps'
  ) then
    alter publication supabase_realtime add table public.cook_session_steps;
  end if;
end $$;

notify pgrst, 'reload schema';
