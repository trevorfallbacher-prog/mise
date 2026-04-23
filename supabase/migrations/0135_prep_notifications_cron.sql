-- 0135_prep_notifications_cron.sql
--
-- Schedules the drain_prep_notifications() RPC (from 0134) to run
-- every minute via pg_cron. Without this migration, prep_notifications
-- rows queue up correctly but never actually fire — the drain RPC
-- exists but nothing calls it.
--
-- pg_cron is available by default on Supabase but needs a one-time
-- CREATE EXTENSION. On local dev / fresh projects the extension may
-- not be installed; the DO block below is defensive and skips the
-- schedule step when pg_cron isn't present. That means the migration
-- is safe to run anywhere; on environments without cron the rows just
-- sit in prep_notifications until something (a manual SELECT
-- drain_prep_notifications(), a GitHub Action, a Supabase scheduled
-- function) picks them up.
--
-- Every-minute cadence is a tradeoff:
--   * Lower latency on prep reminders — worst-case 60s drift from
--     "deliver_at" to "notification lands". T-30m reminders that
--     should fire at 6:00 fire between 6:00 and 6:01.
--   * Cron job table accumulates a row per minute in cron.job_run_details
--     which Supabase prunes on its own schedule.
--   * The RPC is cheap (partial-index scan on deliver_at) so per-minute
--     ticks cost almost nothing when nothing is due.
--
-- Safe to re-run: the cron.unschedule lookup-by-name + re-insert is
-- idempotent.

-- ── 1. Extension ────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Try to create. Fails silently on envs without superuser if the
    -- extension isn't pre-approved — the outer block catches and
    -- moves on.
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice '[0135] pg_cron not installable in this environment: %', sqlerrm;
    end;
  end if;
end $$;

-- ── 2. Ensure the drain RPC is callable by cron ─────────────────────
-- pg_cron jobs run as the postgres role on Supabase. drain_prep_notifications
-- is SECURITY DEFINER (declared in 0134) so it executes with the owner's
-- rights regardless of who invokes it. We still grant EXECUTE to postgres
-- defensively so a revoke-all-from-public earlier in the chain doesn't
-- leave cron unable to call the function.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'drain_prep_notifications'
  ) then
    execute 'grant execute on function public.drain_prep_notifications(int) to postgres';
  end if;
end $$;

-- ── 3. Schedule the drain ───────────────────────────────────────────
-- Gated on pg_cron existing so the migration stays safe on envs
-- that don't have it.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule any prior version by name so the migration is
    -- idempotent (pg_cron doesn't upsert on jobname conflict).
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'mise_drain_prep_notifications';

    perform cron.schedule(
      'mise_drain_prep_notifications',
      '* * * * *',
      $cmd$ select public.drain_prep_notifications(200); $cmd$
    );

    raise notice '[0135] scheduled mise_drain_prep_notifications every minute';
  else
    raise notice '[0135] pg_cron missing — prep notifications will not auto-drain. Run drain_prep_notifications() manually or install pg_cron.';
  end if;
end $$;

notify pgrst, 'reload schema';
