-- 0108_user_gate_progress.sql
--
-- Per-user gate state machine. One row per (user_id, gate_level)
-- the user has made progress on. Rows are created lazily — either
-- by the first xp_events write that lands at the gate floor (the
-- gate-check in 0111 inserts with status='pending'), or by the
-- ranked-match pass trigger (0112) when a user somehow finishes
-- prereqs before hitting the floor.
--
-- Status lifecycle:
--   pending       — user is at/past the gate's XP floor but has
--                   not completed prerequisites yet. award_xp
--                   zeros earnings while in this state.
--   prereqs_met   — all prerequisites green; the ranked-match
--                   picker unlocks. Still gated on XP.
--   in_match      — user has chosen a gate_recipe and is cooking
--                   it. Still gated on XP.
--   passed        — ranked match completed, all diners rated
--                   "nailed". Gate lifts; normal earning resumes.
--                   Banked XP is NOT retroactively credited — the
--                   lost XP stays lost per §2.
--
-- chosen_gate_recipe_slug records which of the 3 options the user
-- picked. match_cook_log_id points to the cook_log of the actual
-- cook attempt.
--
-- prereqs_state_jsonb is a snapshot of the aggregator's output at
-- the last check, so the client can render stable progress bars
-- without re-running the RPC every render. Updated by the
-- aggregator and the gate-check paths.
--
-- RLS: self-only select / insert / update. Gate progress is private
-- — a family member shouldn't see your in-progress ranked match
-- until you pass it and the level-up celebration fans out.
--
-- See docs/plans/xp-leveling.md §2 (Level gates).

create table if not exists public.user_gate_progress (
  user_id                  uuid         not null references auth.users(id) on delete cascade,
  gate_level               int          not null references public.xp_level_gates(gate_level) on delete cascade,
  status                   text         not null default 'pending'
                           check (status in ('pending', 'prereqs_met', 'in_match', 'passed')),
  prereqs_state_jsonb      jsonb        not null default '[]'::jsonb,
  chosen_gate_recipe_slug  text,
  match_cook_log_id        uuid         references public.cook_logs(id) on delete set null,
  started_at               timestamptz  not null default now(),
  prereqs_met_at           timestamptz,
  in_match_at              timestamptz,
  passed_at                timestamptz,
  updated_at               timestamptz  not null default now(),
  primary key (user_id, gate_level)
);

create index if not exists user_gate_progress_user_idx
  on public.user_gate_progress (user_id);

create index if not exists user_gate_progress_active_idx
  on public.user_gate_progress (user_id, gate_level)
  where status <> 'passed';

drop trigger if exists user_gate_progress_touch on public.user_gate_progress;
create trigger user_gate_progress_touch
  before update on public.user_gate_progress
  for each row execute function public.touch_updated_at();

alter table public.user_gate_progress enable row level security;

drop policy if exists "user_gate_progress: self-all" on public.user_gate_progress;
create policy "user_gate_progress: self-all"
  on public.user_gate_progress for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
