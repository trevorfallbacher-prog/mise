-- 0109_xp_events_gate_adjustment.sql
--
-- Adds xp_events.gate_adjustment int column for gate-blocked XP
-- telemetry. When award_xp detects a user is at a gate without
-- passing it (0111), final_xp becomes 0 and the amount that WOULD
-- have landed (the pre-zero value) is recorded here as a negative
-- number. Never credited to profiles.total_xp — it's purely for
-- "how much XP did gates block" dashboards + rebalance decisions.
--
-- The existing cap_adjustment column captures cap-trimmed XP; this
-- column captures gate-blocked XP. They're mutually exclusive on
-- the same row (if gated, caps don't even evaluate).
--
-- Default 0 so the overwhelming majority of rows (non-gated events)
-- don't need to write this column. Idempotent add via
-- information_schema guard.
--
-- A partial index surfaces the subset of rows that actually blocked
-- XP, keeping telemetry queries cheap.
--
-- See docs/plans/xp-leveling.md §2 (gate XP hard stop).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'xp_events'
      and column_name  = 'gate_adjustment'
  ) then
    alter table public.xp_events add column gate_adjustment int not null default 0;
  end if;
end $$;

create index if not exists xp_events_gate_adjustment_idx
  on public.xp_events (user_id, day_local)
  where gate_adjustment < 0;
