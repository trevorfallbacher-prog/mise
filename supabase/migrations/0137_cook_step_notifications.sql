-- 0137_cook_step_notifications.sql
--
-- Timer-driven push notifications DURING a cook. Parallels
-- prep_notifications (migration 0134) but for the intra-cook window:
-- when the user hits "start" on a step that has a timer, we queue a
-- row here with deliver_at = now() + timer_seconds. The drain RPC
-- fires it if the timer rings before the user manually advances.
--
-- Key design difference vs prep_notifications:
--   * NO quiet-hours shift. The user is actively cooking — "don't
--     wake me up to flip the steak" isn't a sensible override when
--     they chose to start cooking at this time.
--   * FK to cook_sessions with ON DELETE CASCADE. If the cook is
--     abandoned or the session row is purged, pending timer pushes
--     disappear with it.
--   * Short deliver_at lives — most rows are live for 1..30 minutes,
--     then either fire or get cancelled when the user taps "next".
--     This table is a short-lived work queue, not a history record.
--
-- Why a queue instead of client-side setTimeout: setTimeout dies when
-- the browser tab is closed or the phone locks. This is the exact
-- scenario the user wants covered — "close the app during a cook, get
-- pinged when it's time to do something." The queue + server-side
-- drain is the only way to deliver a push to a backgrounded PWA.
--
-- Cron cadence floor: the existing mise_drain_prep_notifications job
-- ticks every minute, so sub-60-second timers can drift by up to 60s.
-- For typical cook steps (braise 30 min, roast 45 min, rest 10 min)
-- that drift is invisible. Very short timers (90s sear flips) remain
-- best-effort — CookMode should keep its in-app countdown as the
-- primary surface while the app is open, and treat the push as the
-- safety net for when the app isn't.
--
-- Safe to re-run.

-- ── 1. Add cook_step_timers toggle to notification_preferences ──────
alter table public.notification_preferences
  add column if not exists cook_step_timers boolean not null default true;

-- Update should_notify() to recognize the new category. Keep the
-- earlier categories' behavior byte-identical so this doesn't
-- quietly regress them.
create or replace function public.should_notify(recipient uuid, category text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pref record;
begin
  select * into pref
    from public.notification_preferences
    where user_id = recipient;

  if pref is null then
    if category = 'pantry_activity'       then return false; end if;
    if category = 'shopping_activity'     then return true;  end if;
    if category = 'meal_coordination'     then return true;  end if;
    if category = 'cook_log_diners'       then return true;  end if;
    if category = 'prep_reminders'        then return true;  end if;
    if category = 'receipt_activity'      then return true;  end if;
    if category = 'pantry_scan_activity'  then return true;  end if;
    if category = 'cook_step_timers'      then return true;  end if;
    return true;
  end if;

  if category = 'pantry_activity'       then return pref.pantry_activity;       end if;
  if category = 'shopping_activity'     then return pref.shopping_activity;     end if;
  if category = 'meal_coordination'     then return pref.meal_coordination;     end if;
  if category = 'cook_log_diners'       then return pref.cook_log_diners;       end if;
  if category = 'prep_reminders'        then return pref.prep_reminders;        end if;
  if category = 'receipt_activity'      then return pref.receipt_activity;      end if;
  if category = 'pantry_scan_activity'  then return pref.pantry_scan_activity;  end if;
  if category = 'cook_step_timers'      then return pref.cook_step_timers;      end if;
  return true;
end;
$$;

-- ── 2. Table ────────────────────────────────────────────────────────
create table if not exists public.cook_step_notifications (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id)        on delete cascade,
  cook_session_id    uuid        not null references public.cook_sessions(id) on delete cascade,

  -- The cook_session_steps row this timer belongs to. Nullable so a
  -- cancellation path that deletes the step row first doesn't FK-fail;
  -- cascade handles the common case.
  step_row_id        uuid                 references public.cook_session_steps(id) on delete cascade,

  step_id            text        not null,
  step_title         text,
  recipe_title       text,
  recipe_emoji       text,

  -- Body is pre-rendered (e.g. "Step 4: Flip the steak") so the drain
  -- doesn't need to join cook_sessions + derive text.
  body               text        not null,

  -- The nominal timer in seconds — stamped for analytics ("how often
  -- did users beat the timer manually vs. let it ring?").
  timer_seconds      integer     not null check (timer_seconds > 0),

  deliver_at         timestamptz not null,
  delivered_at       timestamptz,
  notification_id    uuid                 references public.notifications(id) on delete set null,
  dismissed_at       timestamptz,

  created_at         timestamptz not null default now()
);

-- Partial index: the hot path is "due, undelivered, not dismissed".
create index if not exists cook_step_notifications_due_idx
  on public.cook_step_notifications (deliver_at)
  where delivered_at is null and dismissed_at is null;

-- Session-scoped lookups when the cook ends and we need to purge
-- anything still pending.
create index if not exists cook_step_notifications_session_idx
  on public.cook_step_notifications (cook_session_id);

-- ── 3. RLS: family-read, self-write ─────────────────────────────────
alter table public.cook_step_notifications enable row level security;

drop policy if exists "cook_step_notifications: family-select"
  on public.cook_step_notifications;
create policy "cook_step_notifications: family-select"
  on public.cook_step_notifications for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "cook_step_notifications: self-insert"
  on public.cook_step_notifications;
create policy "cook_step_notifications: self-insert"
  on public.cook_step_notifications for insert
  with check (auth.uid() = user_id);

drop policy if exists "cook_step_notifications: self-update"
  on public.cook_step_notifications;
create policy "cook_step_notifications: self-update"
  on public.cook_step_notifications for update
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "cook_step_notifications: self-delete"
  on public.cook_step_notifications;
create policy "cook_step_notifications: self-delete"
  on public.cook_step_notifications for delete
  using (auth.uid() = user_id);

-- ── 4. Drain RPC ────────────────────────────────────────────────────
-- Separate from drain_prep_notifications because the category / target
-- deep-link / title differ. Both drains run in the same per-minute
-- cron job (scheduled below) so there's only one tick to reason about.
create or replace function public.drain_cook_step_notifications(batch_size int default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  row_      record;
  n_id      uuid;
  dispatched int := 0;
begin
  for row_ in
    select *
      from public.cook_step_notifications
      where deliver_at <= now()
        and delivered_at is null
        and dismissed_at is null
      order by deliver_at
      limit batch_size
      for update skip locked
  loop
    -- Opt-out: drop silently so we don't keep retrying.
    if not public.should_notify(row_.user_id, 'cook_step_timers') then
      update public.cook_step_notifications
        set delivered_at = now()
        where id = row_.id;
      continue;
    end if;

    -- Notification body is pre-rendered ("Timer's up — flip the
    -- steak"). The fanout trigger concats emoji + msg into the push
    -- body, so users see "🔥 Timer's up — flip the steak" on the
    -- OS banner — reads like a cookbook prompt, not a generic mise
    -- ping.
    insert into public.notifications (
      user_id, actor_id, msg, emoji, kind, target_kind, target_id
    ) values (
      row_.user_id,
      row_.user_id,
      row_.body,
      coalesce(row_.recipe_emoji, '⏲️'),
      'info',
      'cook_session',
      row_.cook_session_id
    )
    returning id into n_id;

    update public.cook_step_notifications
      set delivered_at    = now(),
          notification_id = n_id
      where id = row_.id;

    dispatched := dispatched + 1;
  end loop;

  return dispatched;
end;
$$;

revoke all on function public.drain_cook_step_notifications(int) from public;
grant execute on function public.drain_cook_step_notifications(int)
  to service_role;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'drain_cook_step_notifications'
  ) then
    execute 'grant execute on function public.drain_cook_step_notifications(int) to postgres';
  end if;
end $$;

-- ── 5. Cron schedule ────────────────────────────────────────────────
-- Fold into the same per-minute tick as drain_prep_notifications so we
-- don't end up with two jobs competing. One statement, two drains.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'mise_drain_prep_notifications';
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'mise_drain_cook_step_notifications';

    -- Combined tick — both drains inside one transaction. If either
    -- raises, the other still ran because they're SECURITY DEFINER
    -- procedures returning int, not in a nested transaction.
    -- Also unschedule any existing combined job (defensive on re-run,
    -- since cron.schedule doesn't upsert on jobname collision).
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'mise_drain_notifications';

    perform cron.schedule(
      'mise_drain_notifications',
      '* * * * *',
      $cmd$
        select public.drain_prep_notifications(200);
        select public.drain_cook_step_notifications(200);
      $cmd$
    );

    raise notice '[0137] combined drain scheduled as mise_drain_notifications (every minute)';
  else
    raise notice '[0137] pg_cron missing — cook-step pushes will not auto-drain. Call drain_cook_step_notifications() manually or install pg_cron.';
  end if;
end $$;

-- ── 6. Realtime ─────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cook_step_notifications'
  ) then
    alter publication supabase_realtime add table public.cook_step_notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
