-- 0134_prep_notifications.sql
--
-- Scheduled prep-reminder notifications for meals on the calendar.
-- The core of the meal-prep rework: every scheduled_meals row can fan
-- out multiple prep_notifications rows (one per prep step in the
-- recipe), each with a pre-computed `deliver_at` that's scheduled_for
-- minus the step's lead time. A drain job fires the due rows into
-- public.notifications (which inherits push fanout from migration
-- 0053) once their time arrives.
--
-- Why a precomputed row instead of scan-all-meals-every-minute:
--   * Cancel / reschedule / reassign cook just mutates the rows
--     (or FK-cascades on scheduled_meal delete). No "re-derive the
--     world every minute" logic in the dispatcher.
--   * Fully auditable: you can SELECT from prep_notifications and see
--     exactly what's queued, when it'll fire, whether it's been sent.
--   * The dispatcher becomes trivially simple — one indexed range
--     scan per tick.
--
-- Quiet hours: when a prep row's nominal deliver_at falls inside the
-- user's notification_preferences.quiet_hours window, we shift it
-- EARLIER (not later — too-early is slightly annoying; too-late is
-- useless for a freeze-overnight prep). BEFORE-INSERT/UPDATE trigger
-- does the shift automatically so the column always reflects the
-- effective delivery time.
--
-- Safe to re-run.

-- ── 1. Table ────────────────────────────────────────────────────────
create table if not exists public.prep_notifications (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id)      on delete cascade,
  scheduled_meal_id uuid                 references public.scheduled_meals(id) on delete cascade,

  recipe_slug       text        not null,
  -- Stable per-meal identifier for a prep step. Combined with
  -- scheduled_meal_id this is unique, so rescheduling or toggling
  -- individual steps becomes a straightforward UPSERT from the client.
  prep_key          text        not null,

  title             text        not null,
  body              text        not null,
  emoji             text        not null default '⏰',

  -- Nominal lead (minutes before scheduled_for). Preserved even after
  -- quiet-hours shifts so the UI can show "marinate at T-30m" semantics.
  lead_minutes      integer     not null check (lead_minutes >= 0),

  -- Effective delivery time after quiet-hours shift. This is the column
  -- the drain RPC reads.
  deliver_at        timestamptz not null,

  -- Dispatch state. delivered_at is set once we've written the matching
  -- public.notifications row (notification_id stores its id). dismissed_at
  -- lets a user silence a specific prep reminder without cancelling the
  -- whole meal (future UI).
  delivered_at      timestamptz,
  notification_id   uuid                 references public.notifications(id) on delete set null,
  dismissed_at      timestamptz,

  -- Classification so the UI can render a distinct icon/label. Also
  -- lets future analytics slice "were long-lead reminders worth it?"
  source            text        not null default 'recipe_prep'
                    check (source in ('recipe_prep','step_timing','freeze_overnight','user_custom')),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (scheduled_meal_id, prep_key)
);

-- ── 2. Indexes ──────────────────────────────────────────────────────
-- The drain RPC scans for undelivered rows whose time has come. Partial
-- index keeps this scan tiny even as the table accumulates history.
create index if not exists prep_notifications_due_idx
  on public.prep_notifications (deliver_at)
  where delivered_at is null and dismissed_at is null;

create index if not exists prep_notifications_user_idx
  on public.prep_notifications (user_id, deliver_at);

create index if not exists prep_notifications_meal_idx
  on public.prep_notifications (scheduled_meal_id);

-- ── 3. RLS (self-only write, family-readable) ───────────────────────
-- Write surface is restricted to the owner — only YOUR prep queue.
-- Reads are opened to family so the "Alex's prep queue" view on the
-- plan tab can render siblings' upcoming reminders (useful when
-- deciding who to ask to start prep).
alter table public.prep_notifications enable row level security;

drop policy if exists "prep_notifications: family-select"
  on public.prep_notifications;
create policy "prep_notifications: family-select"
  on public.prep_notifications for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "prep_notifications: self-insert"
  on public.prep_notifications;
create policy "prep_notifications: self-insert"
  on public.prep_notifications for insert
  with check (auth.uid() = user_id);

drop policy if exists "prep_notifications: self-update"
  on public.prep_notifications;
create policy "prep_notifications: self-update"
  on public.prep_notifications for update
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "prep_notifications: self-delete"
  on public.prep_notifications;
create policy "prep_notifications: self-delete"
  on public.prep_notifications for delete
  using (auth.uid() = user_id);

-- ── 4. updated_at touch ─────────────────────────────────────────────
drop trigger if exists prep_notifications_set_updated_at
  on public.prep_notifications;
create trigger prep_notifications_set_updated_at
  before update on public.prep_notifications
  for each row execute function public.touch_updated_at();

-- ── 5. Quiet-hours shift helper ─────────────────────────────────────
-- Shift a target timestamp EARLIER if it falls inside the user's
-- quiet-hours window. Reasoning:
--   * Too-early reminder: mildly annoying. Cook might start prep
--     early, which is almost always fine.
--   * Too-late reminder: useless, because the prep couldn't happen.
--     Freeze-overnight at 7am the next morning misses the window.
-- So we shift TO 30 minutes before the quiet window starts on the
-- relevant local date. If that shifted time is already in the past,
-- we fire NOW rather than skip — belated beats never.
--
-- Returns the target unchanged when the user has no quiet-hours
-- configured (either column NULL).
create or replace function public.quiet_hours_shift(uid uuid, target timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q_start       time;
  q_end         time;
  tz            text;
  local_target  timestamp;
  local_time    time;
  local_date    date;
  effective_date date;
  in_quiet      boolean;
  shifted       timestamp;
  shifted_tz    timestamptz;
begin
  select quiet_hours_start, quiet_hours_end, coalesce(timezone, 'UTC')
    into q_start, q_end, tz
    from public.notification_preferences
    where user_id = uid;

  if q_start is null or q_end is null then
    return target;
  end if;

  local_target := (target at time zone tz);
  local_time   := local_target::time;
  local_date   := local_target::date;

  if q_start < q_end then
    -- Same-day window (e.g. 13:00..18:00)
    in_quiet := local_time >= q_start and local_time < q_end;
    effective_date := local_date;
  else
    -- Overnight window (e.g. 22:00..07:00). If we're after midnight
    -- in the early-morning portion, the window actually started the
    -- PREVIOUS local day.
    in_quiet := local_time >= q_start or local_time < q_end;
    if in_quiet and local_time < q_end then
      effective_date := local_date - 1;
    else
      effective_date := local_date;
    end if;
  end if;

  if not in_quiet then
    return target;
  end if;

  -- Shift to 30 min before the quiet window starts on effective_date.
  shifted    := (effective_date + q_start)::timestamp - interval '30 minutes';
  shifted_tz := shifted at time zone tz;

  if shifted_tz < now() then
    return now();
  end if;
  return shifted_tz;
end;
$$;

revoke all on function public.quiet_hours_shift(uuid, timestamptz) from public;
grant execute on function public.quiet_hours_shift(uuid, timestamptz)
  to authenticated, service_role;

-- ── 6. BEFORE trigger: apply quiet-hours shift automatically ────────
-- Any time a row is inserted or has its deliver_at updated, the
-- effective deliver_at gets passed through quiet_hours_shift first.
-- This means the drain RPC doesn't have to care about quiet hours —
-- the column always reflects "when we actually intend to fire".
create or replace function public.prep_notifications_apply_quiet_hours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deliver_at is not null then
    new.deliver_at := public.quiet_hours_shift(new.user_id, new.deliver_at);
  end if;
  return new;
end;
$$;

drop trigger if exists prep_notifications_quiet_hours_insert
  on public.prep_notifications;
create trigger prep_notifications_quiet_hours_insert
  before insert on public.prep_notifications
  for each row execute function public.prep_notifications_apply_quiet_hours();

drop trigger if exists prep_notifications_quiet_hours_update
  on public.prep_notifications;
create trigger prep_notifications_quiet_hours_update
  before update of deliver_at on public.prep_notifications
  for each row execute function public.prep_notifications_apply_quiet_hours();

-- ── 7. Drain RPC ────────────────────────────────────────────────────
-- Fires every due, undelivered, non-dismissed row into public.notifications.
-- Honors the per-user prep_reminders preference: if the user has opted
-- out, the row is stamped delivered_at (silently) so the scheduler
-- stops retrying it. FOR UPDATE SKIP LOCKED means multiple concurrent
-- cron runs are safe.
--
-- Returns the count of rows actually dispatched (not counting silently-
-- dropped opt-outs). Callable by the service role (cron) and by admins
-- for manual flush.
create or replace function public.drain_prep_notifications(batch_size int default 200)
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
      from public.prep_notifications
      where deliver_at <= now()
        and delivered_at is null
        and dismissed_at is null
      order by deliver_at
      limit batch_size
      for update skip locked
  loop
    -- Opt-out check: silent drop so we don't keep retrying.
    if not public.should_notify(row_.user_id, 'prep_reminders') then
      update public.prep_notifications
        set delivered_at = now()
        where id = row_.id;
      continue;
    end if;

    -- Insert into the notifications table. The existing
    -- fanout_notification_push trigger on notifications will
    -- automatically dispatch Web Push.
    insert into public.notifications (
      user_id, actor_id, msg, emoji, kind, target_kind, target_id
    ) values (
      row_.user_id,
      row_.user_id,  -- self-actor; prep reminders aren't from anyone else
      row_.title || ' — ' || row_.body,
      row_.emoji,
      'info',
      'scheduled_meal',
      row_.scheduled_meal_id
    )
    returning id into n_id;

    update public.prep_notifications
      set delivered_at    = now(),
          notification_id = n_id
      where id = row_.id;

    dispatched := dispatched + 1;
  end loop;

  return dispatched;
end;
$$;

revoke all on function public.drain_prep_notifications(int) from public;
grant execute on function public.drain_prep_notifications(int)
  to service_role;

-- ── 8. Realtime: family-shared queue view ───────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'prep_notifications'
  ) then
    alter publication supabase_realtime add table public.prep_notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
