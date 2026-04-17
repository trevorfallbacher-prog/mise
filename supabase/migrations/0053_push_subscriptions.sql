-- 0053_push_subscriptions.sql
--
-- Per-device Web Push subscriptions, plus the trigger that fans out
-- notifications rows to the `send-push` edge function so they reach
-- users when the browser is closed.
--
-- What's here:
--   1. public.push_subscriptions  — one row per (user, browser) pair,
--      storing the endpoint + p256dh + auth keys that VAPID signing
--      needs. Self-only RLS — these are private per-device artifacts,
--      not a family-shared surface.
--   2. public.fanout_notification_push() — SECURITY DEFINER trigger
--      function that POSTs the new notifications row to the
--      `send-push` edge function via pg_net. Non-blocking: if the HTTP
--      call fails or pg_net isn't configured yet, the in-app row still
--      landed, so the user hasn't lost the notification — they just
--      missed the push.
--   3. Trigger on public.notifications AFTER INSERT.
--
-- Prereqs expected to already be installed in this project:
--   * extension pg_net (used by existing AI + mail flows). If absent
--     we create it conditionally so this migration is safe on a fresh
--     project too.
--   * helper `public.touch_updated_at()` from migration 0028 — only
--     used here for the last_seen_at column.

-- ── 0. pg_net (idempotent) ───────────────────────────────────────────
create extension if not exists pg_net with schema extensions;

-- ── 1. table ─────────────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  endpoint     text        not null,                -- push service URL
  p256dh       text        not null,                -- client public key
  auth         text        not null,                -- client auth secret
  user_agent   text,                                -- for the Settings UI device list
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- ── 2. RLS ───────────────────────────────────────────────────────────
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions: self select"
  on public.push_subscriptions;
create policy "push_subscriptions: self select"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions: self insert"
  on public.push_subscriptions;
create policy "push_subscriptions: self insert"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions: self update"
  on public.push_subscriptions;
create policy "push_subscriptions: self update"
  on public.push_subscriptions for update
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions: self delete"
  on public.push_subscriptions;
create policy "push_subscriptions: self delete"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- ── 3. fanout trigger function ───────────────────────────────────────
-- Invoked AFTER INSERT on public.notifications. Reads the edge function
-- URL + service-role key out of settings that the project owner sets
-- in the dashboard (Database → Functions → Settings):
--
--   app.settings.supabase_url           (e.g. https://<ref>.supabase.co)
--   app.settings.supabase_service_key   (service role key; scoped)
--
-- If either is empty the function returns early — we don't want the
-- insert on notifications to fail just because push isn't wired up yet
-- (push is a convenience layer on top of the in-app row). Same reason
-- we don't WAIT for the HTTP response: pg_net is async-by-design.
create or replace function public.fanout_notification_push()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  base_url     text := coalesce(current_setting('app.settings.supabase_url', true), '');
  service_key  text := coalesce(current_setting('app.settings.supabase_service_key', true), '');
  endpoint_url text;
  body         jsonb;
begin
  if base_url = '' or service_key = '' then
    return new;
  end if;

  endpoint_url := base_url || '/functions/v1/send-push';

  body := jsonb_build_object(
    'userId',        new.user_id,
    'notification',  jsonb_build_object(
      'id',          new.id,
      'title',       'mise',
      'body',        concat_ws(' ', new.emoji, new.msg),
      'emoji',       new.emoji,
      'kind',        new.kind,
      'target_kind', new.target_kind,
      'target_id',   new.target_id
    )
  );

  perform net.http_post(
    url      := endpoint_url,
    headers  := jsonb_build_object(
                  'Content-Type',  'application/json',
                  'Authorization', 'Bearer ' || service_key
                ),
    body     := body,
    timeout_milliseconds := 3000
  );

  return new;
exception
  when others then
    -- Never block the INSERT on push-dispatch failure. The in-app
    -- notification row already landed; a failed push is a non-event
    -- from the user's perspective.
    return new;
end;
$$;

revoke all on function public.fanout_notification_push() from public;

-- ── 4. trigger ───────────────────────────────────────────────────────
drop trigger if exists notifications_fanout_push
  on public.notifications;
create trigger notifications_fanout_push
  after insert on public.notifications
  for each row execute function public.fanout_notification_push();

-- ── 5. schema cache reload ───────────────────────────────────────────
notify pgrst, 'reload schema';
