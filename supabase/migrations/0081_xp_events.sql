-- 0081_xp_events.sql
--
-- The XP ledger. One row per earn (or spend) event. This is the
-- source of truth for every user's total XP; `profiles.total_xp`
-- becomes a derived sum maintained by award_xp() and a reconciling
-- trigger that lands in later migrations.
--
-- Every row captures the FULL breakdown used to compute the final
-- XP amount so the toast choreography (§5) can replay each beat
-- without re-querying other tables, and so audit / disputes have a
-- complete trail:
--
--   base_xp         — lookup from xp_source_values
--   curated_mult    — 1.00 for non-curated / flat bonuses, else
--                     the curated-ladder multiplier in effect
--   cap_adjustment  — amount trimmed by per-source / soft / hard
--                     caps (NEGATIVE number, or 0). The raw earn
--                     before streak mult = base_xp * curated_mult
--                     + cap_adjustment.
--   streak_mult     — 1.00 until Phase 3, then the fire-mode
--                     multiplier in effect at award time.
--   final_xp        — what actually landed on profiles.total_xp.
--                     Can be negative (streak_revival).
--
-- ref_table + ref_id let us trace back to the source row
-- (e.g. cook_logs, pantry_scans, ingredient_info). NULL when the
-- source is free-standing (onboarding, daily_roll).
--
-- day_local is the local-day date in the user's timezone, computed
-- by award_xp() at write time. Indexed because every daily-cap
-- lookup queries (user_id, day_local).
--
-- See docs/plans/xp-leveling.md §4 + §6.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_events (
  id              uuid         primary key default gen_random_uuid(),
  user_id         uuid         not null references auth.users(id) on delete cascade,
  source          text         not null references public.xp_source_values(source),
  base_xp         int          not null,
  curated_mult    numeric(4,2) not null default 1.00,
  cap_adjustment  int          not null default 0,
  streak_mult     numeric(4,2) not null default 1.00,
  final_xp        int          not null,
  ref_table       text,
  ref_id          uuid,
  day_local       date         not null,
  created_at      timestamptz  not null default now()
);

-- ── 2. Indexes ──────────────────────────────────────────────────────
-- Daily-cap lookups: (user_id, day_local, source) for per-source
-- caps; (user_id, day_local) for soft/hard caps.

create index if not exists xp_events_user_day_idx
  on public.xp_events (user_id, day_local);

create index if not exists xp_events_user_day_source_idx
  on public.xp_events (user_id, day_local, source);

create index if not exists xp_events_ref_idx
  on public.xp_events (ref_table, ref_id)
  where ref_table is not null;

create index if not exists xp_events_user_created_idx
  on public.xp_events (user_id, created_at desc);

-- ── 3. Row-level security ───────────────────────────────────────────
-- Each user can read their own events. No client-side writes —
-- award_xp() (SECURITY DEFINER) is the only writer.

alter table public.xp_events enable row level security;

drop policy if exists "xp_events: self-select" on public.xp_events;
create policy "xp_events: self-select"
  on public.xp_events for select
  to authenticated
  using (auth.uid() = user_id);
