-- 0133_notification_preferences.sql
--
-- Per-user notification preferences, and gating of the existing family-
-- fanout triggers on those preferences.
--
-- Why this exists: the app was firing a family-fanout notification on
-- every pantry_items INSERT/UPDATE/DELETE and every shopping_list_items
-- event. That turns "someone grabbed the butter out of the fridge" into
-- a push on everyone else's phone. The product direction is the exact
-- opposite — notifications should be earned, one-per-meaningful-event,
-- never fire-and-forget on routine stock moves.
--
-- The fix is two-part:
--   1. A notification_preferences row per user, with categorized toggles
--      (pantry_activity, shopping_activity, meal_coordination, cook_log,
--      prep_reminders). Defaults chosen intentionally:
--        * pantry_activity  DEFAULT FALSE — THIS is the firehose. Off.
--        * shopping_activity DEFAULT TRUE — low-volume, mostly useful.
--        * meal_coordination DEFAULT TRUE — "Sam will cook tonight" is
--          exactly the kind of notification we want to keep.
--        * cook_log_diners   DEFAULT TRUE — "you ate the stew I cooked"
--          is rare and high-signal.
--        * prep_reminders    DEFAULT TRUE — the new reminders landing
--          in 0134 are the whole point of the rework; default on.
--        * receipt_activity  DEFAULT TRUE — receipts are already a
--          single summary per scan, not a firehose.
--        * pantry_scan_activity DEFAULT TRUE — summarized too.
--      Users with no row inherit these defaults via coalesce() in the
--      trigger — we do NOT need to backfill rows.
--   2. The existing notify_family_pantry / notify_family_shopping
--      triggers are replaced in place with versions that check each
--      recipient's preference before inserting. The message text and
--      structure are unchanged; only the gating is new.
--
-- Quiet hours columns (quiet_hours_start, quiet_hours_end, timezone)
-- land in this migration so the 0134 prep-notification scheduler can
-- read them without a second table. They're intentionally NULLable —
-- null means "no quiet window configured", which is how we distinguish
-- "user hasn't set this" from "user set 00:00..00:00".
--
-- Safe to re-run.

-- ── 1. Table ────────────────────────────────────────────────────────
create table if not exists public.notification_preferences (
  user_id                uuid        primary key
                           references auth.users(id) on delete cascade,

  -- Category toggles. See header for default rationale.
  pantry_activity        boolean     not null default false,
  shopping_activity      boolean     not null default true,
  meal_coordination      boolean     not null default true,
  cook_log_diners        boolean     not null default true,
  prep_reminders         boolean     not null default true,
  receipt_activity       boolean     not null default true,
  pantry_scan_activity   boolean     not null default true,

  -- Quiet hours. NULL on either side = no window configured. The
  -- window is interpreted as local time in `timezone` (IANA name,
  -- e.g. "America/Los_Angeles"). Overnight windows (start > end) are
  -- supported — 22:00..07:00 means "quiet from 10pm to 7am".
  quiet_hours_start      time,
  quiet_hours_end        time,
  timezone               text        not null default 'UTC',

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ── 2. RLS (self-only) ──────────────────────────────────────────────
alter table public.notification_preferences enable row level security;

drop policy if exists "notification_preferences: self"
  on public.notification_preferences;
create policy "notification_preferences: self"
  on public.notification_preferences for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 3. updated_at trigger ───────────────────────────────────────────
-- touch_updated_at() is defined in migration 0028; reuse.
drop trigger if exists notification_preferences_set_updated_at
  on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- ── 4. Helper: per-recipient category check ─────────────────────────
-- Returns true if the given recipient should receive notifications in
-- the named category. Falls back to the column's DEFAULT when the
-- recipient has no preferences row yet — so new users inherit the
-- "pantry off, everything else on" shape without a backfill step.
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
    -- Match the table DEFAULTs exactly. If you change the DEFAULT on
    -- a column above, change it here too.
    if category = 'pantry_activity'       then return false; end if;
    if category = 'shopping_activity'     then return true;  end if;
    if category = 'meal_coordination'     then return true;  end if;
    if category = 'cook_log_diners'       then return true;  end if;
    if category = 'prep_reminders'        then return true;  end if;
    if category = 'receipt_activity'      then return true;  end if;
    if category = 'pantry_scan_activity'  then return true;  end if;
    return true;
  end if;

  if category = 'pantry_activity'       then return pref.pantry_activity;       end if;
  if category = 'shopping_activity'     then return pref.shopping_activity;     end if;
  if category = 'meal_coordination'     then return pref.meal_coordination;     end if;
  if category = 'cook_log_diners'       then return pref.cook_log_diners;       end if;
  if category = 'prep_reminders'        then return pref.prep_reminders;        end if;
  if category = 'receipt_activity'      then return pref.receipt_activity;      end if;
  if category = 'pantry_scan_activity'  then return pref.pantry_scan_activity;  end if;
  return true;
end;
$$;

revoke all on function public.should_notify(uuid, text) from public;
grant execute on function public.should_notify(uuid, text) to authenticated, service_role;

-- ── 5. Replace pantry trigger with a gated + reduced-noise version ──
-- Key differences from migration 0011's version:
--   * per-recipient should_notify('pantry_activity') guard so each
--     family member sees pantry noise only if they opted in
--   * UPDATE path: we only notify on RENAME now. The "used some" and
--     "restocked" branches were exactly the "every time someone opens
--     the fridge" events the user asked us to kill. Rename stays
--     because it's rare and carries new identity info.
--   * receipt suppression window unchanged (migration 0011 logic)
create or replace function public.notify_family_pantry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor              uuid := auth.uid();
  actor_name         text;
  msg                text;
  emoji              text;
  kind               text;
  recipient          uuid;
  recent_receipt_id  uuid;
begin
  if actor is null then
    return coalesce(new, old);
  end if;

  -- Receipt-scan suppression: one receipt summary beats 30 per-item pings.
  select id into recent_receipt_id
    from public.receipts
    where user_id = actor
      and created_at > now() - interval '10 seconds'
    limit 1;
  if recent_receipt_id is not null then
    return coalesce(new, old);
  end if;

  actor_name := coalesce(public.actor_first_name(actor), 'Someone');

  if (TG_OP = 'INSERT') then
    msg   := actor_name || ' added ' || coalesce(new.emoji, '') || ' ' || new.name || ' to the pantry';
    emoji := '🥫';
    kind  := 'success';
  elsif (TG_OP = 'UPDATE') then
    -- Notify ONLY on rename. Amount changes (restock / used-some) are
    -- intentionally silent — they were the main source of noise and
    -- they don't require action by anyone else in the family.
    if new.name is not distinct from old.name then
      return new;
    end if;
    msg   := actor_name || ' renamed pantry item to ' || coalesce(new.emoji, '') || ' ' || new.name;
    emoji := '🥫';
    kind  := 'info';
  elsif (TG_OP = 'DELETE') then
    msg   := actor_name || ' removed ' || coalesce(old.emoji, '') || ' ' || old.name || ' from the pantry';
    emoji := '🥫';
    kind  := 'warn';
  end if;

  for recipient in select public.family_ids_of(actor)
  loop
    if not public.should_notify(recipient, 'pantry_activity') then
      continue;
    end if;
    insert into public.notifications (user_id, actor_id, msg, emoji, kind)
      values (recipient, actor, msg, emoji, kind);
  end loop;

  return coalesce(new, old);
end;
$$;

-- ── 6. Replace shopping trigger with a gated version ────────────────
-- Message bodies unchanged from migration 0011; only the per-recipient
-- should_notify('shopping_activity') gate is new.
create or replace function public.notify_family_shopping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor      uuid := auth.uid();
  actor_name text;
  msg        text;
  emoji      text;
  kind       text;
  recipient  uuid;
begin
  if actor is null then
    return coalesce(new, old);
  end if;

  actor_name := coalesce(public.actor_first_name(actor), 'Someone');

  if (TG_OP = 'INSERT') then
    msg   := actor_name || ' added ' || coalesce(new.emoji, '') || ' ' || new.name || ' to the shopping list';
    emoji := '🛒';
    kind  := 'success';
  elsif (TG_OP = 'UPDATE') then
    if new.name is not distinct from old.name
       and new.amount is not distinct from old.amount then
      return new;
    end if;
    msg   := actor_name || ' updated ' || coalesce(new.emoji, '') || ' ' || new.name || ' on the shopping list';
    emoji := '🛒';
    kind  := 'info';
  elsif (TG_OP = 'DELETE') then
    msg   := actor_name || ' removed ' || coalesce(old.emoji, '') || ' ' || old.name || ' from the shopping list';
    emoji := '🛒';
    kind  := 'warn';
  end if;

  for recipient in select public.family_ids_of(actor)
  loop
    if not public.should_notify(recipient, 'shopping_activity') then
      continue;
    end if;
    insert into public.notifications (user_id, actor_id, msg, emoji, kind)
      values (recipient, actor, msg, emoji, kind);
  end loop;

  return coalesce(new, old);
end;
$$;

-- ── 7. schema cache reload ──────────────────────────────────────────
notify pgrst, 'reload schema';
