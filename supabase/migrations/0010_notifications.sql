-- mise — persistent notifications
--
-- Adds a per-user notifications inbox with realtime delivery. Whenever a
-- family member touches a shared table (pantry / shopping list / scheduled
-- meals), an AFTER trigger fans out one notification row to every other
-- accepted family member of the actor. The recipient client subscribes to
-- its own user_id-filtered slice of `notifications` and surfaces the row
-- as both an ephemeral toast AND a persistent inbox entry (with unread
-- badge on the bell button).
--
-- Why DB triggers and not client-side inserts:
--   * Survives the case where no recipient has the app open at the time of
--     the event — the row exists; they see it next time they open the app.
--   * Single source of truth for message text, so two clients seeing the
--     same event see the same wording.
--   * Cross-user inserts would otherwise need either a more permissive RLS
--     policy or an edge function. Trigger runs SECURITY DEFINER as the
--     table owner so it can insert into another user's notifications.
--
-- Safe to re-run.

-- ── table ───────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  actor_id    uuid                 references auth.users(id) on delete set null,
  msg         text        not null,
  emoji       text        not null default '🔔',
  kind        text        not null default 'info'
                          check (kind in ('info', 'success', 'warn', 'error')),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- ── RLS: a user owns their own inbox, full stop ─────────────────────────────
alter table public.notifications enable row level security;

drop policy if exists "notifications: self-select" on public.notifications;
create policy "notifications: self-select"
  on public.notifications for select
  using (auth.uid() = user_id);

-- Allow self-insert too. The fan-out trigger bypasses RLS via SECURITY
-- DEFINER, but keeping a self-insert policy means a client could still
-- write its own local notifications if we ever want that (e.g. "first
-- pantry item added" client-side milestone).
drop policy if exists "notifications: self-insert" on public.notifications;
create policy "notifications: self-insert"
  on public.notifications for insert
  with check (auth.uid() = user_id);

drop policy if exists "notifications: self-update" on public.notifications;
create policy "notifications: self-update"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notifications: self-delete" on public.notifications;
create policy "notifications: self-delete"
  on public.notifications for delete
  using (auth.uid() = user_id);

-- ── realtime ────────────────────────────────────────────────────────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.notifications';
  exception when duplicate_object then
    null;
  end;
end $$;

-- ── helper: actor's first name, fallback "Someone" ──────────────────────────
create or replace function public.actor_first_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(split_part(coalesce(name, ''), ' ', 1), ''),
    'Someone'
  )
  from public.profiles
  where id = uid;
$$;

-- ── pantry trigger ──────────────────────────────────────────────────────────
create or replace function public.notify_family_pantry()
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
  -- No JWT context (e.g. service-role import script) — skip silently.
  if actor is null then
    return coalesce(new, old);
  end if;

  actor_name := coalesce(public.actor_first_name(actor), 'Someone');

  if (TG_OP = 'INSERT') then
    msg   := actor_name || ' added ' || coalesce(new.emoji, '') || ' ' || new.name || ' to the pantry';
    emoji := '🥫';
    kind  := 'success';
  elsif (TG_OP = 'UPDATE') then
    -- Skip noisy amount-only updates. We only notify when the user changed
    -- something visible at-a-glance: the name or the emoji.
    if new.name  is not distinct from old.name
       and new.emoji is not distinct from old.emoji then
      return new;
    end if;
    msg   := actor_name || ' updated ' || coalesce(new.emoji, '') || ' ' || new.name;
    emoji := '🥫';
    kind  := 'info';
  elsif (TG_OP = 'DELETE') then
    msg   := actor_name || ' removed ' || coalesce(old.emoji, '') || ' ' || old.name || ' from the pantry';
    emoji := '🥫';
    kind  := 'warn';
  end if;

  for recipient in select public.family_ids_of(actor)
  loop
    insert into public.notifications (user_id, actor_id, msg, emoji, kind)
      values (recipient, actor, msg, emoji, kind);
  end loop;

  return coalesce(new, old);
end;
$$;

-- ── shopping-list trigger ───────────────────────────────────────────────────
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
    if new.name  is not distinct from old.name
       and new.emoji is not distinct from old.emoji then
      return new;
    end if;
    msg   := actor_name || ' updated the shopping list';
    emoji := '🛒';
    kind  := 'info';
  elsif (TG_OP = 'DELETE') then
    msg   := actor_name || ' removed ' || coalesce(old.emoji, '') || ' ' || old.name || ' from the shopping list';
    emoji := '🛒';
    kind  := 'warn';
  end if;

  for recipient in select public.family_ids_of(actor)
  loop
    insert into public.notifications (user_id, actor_id, msg, emoji, kind)
      values (recipient, actor, msg, emoji, kind);
  end loop;

  return coalesce(new, old);
end;
$$;

-- ── scheduled-meals trigger ─────────────────────────────────────────────────
-- Mirrors the priority order from the old App-level toast formatter so the
-- inbox text reads the same as what users were seeing in transient toasts.
create or replace function public.notify_family_meal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor         uuid := auth.uid();
  actor_name    text;
  cook_name     text;
  old_cook_name text;
  dish          text;
  msg           text;
  emoji         text;
  kind          text;
  recipient     uuid;
begin
  if actor is null then
    return coalesce(new, old);
  end if;

  actor_name := coalesce(public.actor_first_name(actor), 'Someone');
  dish := replace(
    coalesce(case when TG_OP = 'DELETE' then old.recipe_slug else new.recipe_slug end, 'a meal'),
    '-', ' '
  );

  if (TG_OP = 'INSERT') then
    if new.cook_id is null then
      msg   := actor_name || ' is asking if someone can cook ' || dish;
      emoji := '🙋';
      kind  := 'info';
    elsif new.cook_id = new.user_id then
      msg   := actor_name || ' scheduled ' || dish;
      emoji := '📅';
      kind  := 'info';
    else
      cook_name := coalesce(public.actor_first_name(new.cook_id), 'Someone');
      msg   := actor_name || ' scheduled ' || dish || ' for ' || cook_name || ' to cook';
      emoji := '📅';
      kind  := 'info';
    end if;

  elsif (TG_OP = 'UPDATE') then
    if old.cook_id is null and new.cook_id is not null then
      cook_name := coalesce(public.actor_first_name(new.cook_id), 'Someone');
      msg   := cook_name || ' is going to cook ' || dish || ' 🍳';
      emoji := '✅';
      kind  := 'success';
    elsif old.cook_id is not null and new.cook_id is null then
      old_cook_name := coalesce(public.actor_first_name(old.cook_id), 'Someone');
      msg   := old_cook_name || ' backed out of ' || dish || ' — looking for a cook';
      emoji := '🙋';
      kind  := 'warn';
    elsif old.cook_id is not null and new.cook_id is not null
          and old.cook_id <> new.cook_id then
      cook_name     := coalesce(public.actor_first_name(new.cook_id), 'Someone');
      old_cook_name := coalesce(public.actor_first_name(old.cook_id), 'Someone');
      msg   := cook_name || ' is cooking ' || dish || ' now (was ' || old_cook_name || ')';
      emoji := '🔄';
      kind  := 'info';
    elsif old.servings is distinct from new.servings then
      msg   := actor_name || ' set ' || dish || ' to ' || new.servings::text || ' '
               || (case when new.servings = 1 then 'person' else 'people' end);
      emoji := '👥';
      kind  := 'info';
    elsif old.scheduled_for is distinct from new.scheduled_for then
      msg   := actor_name || ' rescheduled ' || dish;
      emoji := '📅';
      kind  := 'info';
    else
      -- Nothing meaningful changed — skip.
      return new;
    end if;

  elsif (TG_OP = 'DELETE') then
    msg   := actor_name || ' cancelled ' || dish;
    emoji := '🗑️';
    kind  := 'warn';
  end if;

  for recipient in select public.family_ids_of(actor)
  loop
    insert into public.notifications (user_id, actor_id, msg, emoji, kind)
      values (recipient, actor, msg, emoji, kind);
  end loop;

  return coalesce(new, old);
end;
$$;

-- ── hook the triggers in ────────────────────────────────────────────────────
drop trigger if exists pantry_items_notify_family on public.pantry_items;
create trigger pantry_items_notify_family
  after insert or update or delete on public.pantry_items
  for each row execute function public.notify_family_pantry();

drop trigger if exists shopping_list_items_notify_family on public.shopping_list_items;
create trigger shopping_list_items_notify_family
  after insert or update or delete on public.shopping_list_items
  for each row execute function public.notify_family_shopping();

drop trigger if exists scheduled_meals_notify_family on public.scheduled_meals;
create trigger scheduled_meals_notify_family
  after insert or update or delete on public.scheduled_meals
  for each row execute function public.notify_family_meal();

notify pgrst, 'reload schema';
