-- scripts/backfill_xp_events.sql
--
-- One-shot backfill: replay every existing cook_logs row into
-- xp_events so the ledger introduced in migration 0081 is non-empty
-- on rollout and profiles.total_xp reconciles with the historical
-- per-cook totals. After running this:
--
--   * Every cook_log row has an xp_events row pointing to it
--     (source = 'cook_complete', ref_table = 'cook_logs').
--   * profiles.total_xp = sum of the user's xp_events.final_xp.
--
-- Run from the Supabase SQL editor as a service-role session (it
-- writes xp_events directly; no award_xp() call, no cap logic —
-- historical values stand as-is). Idempotent via ON CONFLICT: you
-- can safely re-run and only new cook_logs get ledger rows.
--
-- WHY bypass award_xp(): re-running award_xp on every historical
-- cook would apply per-source and soft/hard daily caps on the
-- backfill itself. We want the ledger to mirror what users ALREADY
-- banked, not to retroactively punish a big weekend of cooking.
--
-- See docs/plans/xp-leveling.md Phase-1 implementation plan.

-- ── 1. Unique index so ON CONFLICT works ────────────────────────────
-- Without this, we'd need a scan to detect duplicates. A partial
-- index keeps storage small and targets only cook_complete rows
-- that carry a cook_logs ref — the case backfill care about.

create unique index if not exists xp_events_cook_complete_ref_uniq
  on public.xp_events (ref_id)
  where source = 'cook_complete' and ref_table = 'cook_logs';

-- ── 2. Backfill the ledger ──────────────────────────────────────────

insert into public.xp_events (
  user_id, source, base_xp, curated_mult, cap_adjustment,
  streak_mult, final_xp, ref_table, ref_id, day_local, created_at
)
select
  cl.user_id,
  'cook_complete'                                as source,
  coalesce(cl.xp_earned, 0)                      as base_xp,
  1.00                                           as curated_mult,
  0                                              as cap_adjustment,
  1.00                                           as streak_mult,
  coalesce(cl.xp_earned, 0)                      as final_xp,
  'cook_logs'                                    as ref_table,
  cl.id                                          as ref_id,
  coalesce(cl.cooked_at, cl.created_at)::date    as day_local,
  coalesce(cl.cooked_at, cl.created_at)          as created_at
from public.cook_logs cl
on conflict do nothing;

-- ── 3. Reconcile profiles.total_xp ──────────────────────────────────
-- Every user's total_xp becomes the sum of their xp_events final_xp.
-- This lines up with the award_xp invariant going forward.

update public.profiles p
   set total_xp = coalesce(t.total, 0)
from (
  select user_id, sum(final_xp)::int as total
  from public.xp_events
  group by user_id
) t
where t.user_id = p.id;

-- Users with zero cook_logs still need total_xp = 0 (covered by the
-- default) — no action needed.

-- ── 4. Sanity check (optional) ──────────────────────────────────────
-- Uncomment to eyeball the reconcile. Should report zero drift if
-- all cook_logs backfilled cleanly.
--
-- select
--   p.id,
--   p.total_xp                                       as profiles_total,
--   coalesce(sum(e.final_xp), 0)                     as events_total,
--   p.total_xp - coalesce(sum(e.final_xp), 0)        as drift
-- from public.profiles p
-- left join public.xp_events e on e.user_id = p.id
-- group by p.id, p.total_xp
-- having p.total_xp - coalesce(sum(e.final_xp), 0) <> 0;
