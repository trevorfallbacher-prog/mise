-- mise — notifications v2: broaden coverage + receipts
--
-- Builds on 0010_notifications.sql:
--   * Pantry trigger now fires on amount changes (both up and down) in
--     addition to renames. Emoji-change check is dropped because the
--     custom-add UI no longer exposes an emoji input.
--   * Shopping-list trigger fires on every event (INSERT/UPDATE/DELETE) so
--     adds, renames, and removals all show up.
--   * NEW receipts trigger: when anyone scans a receipt, family members get
--     a single summary notification ("Trevor scanned a $87.42 receipt from
--     Trader Joe's — 12 items"). Dedup detection compares fingerprint
--     against the family's last 7 days of receipts and fires a separate
--     warning to BOTH the new uploader and the original one.
--   * Pantry trigger SUPPRESSES per-item notifications when the same actor
--     inserted a receipt within the last 10 seconds. One summary > a wall
--     of individual pantry pings.
--   * Receipts opened to family-select RLS so a future history view can
--     sum spend across the household.
--
-- Safe to re-run.

-- ── extend RLS: family can read each other's receipts ───────────────────────
drop policy if exists "receipts: family-select" on public.receipts;
create policy "receipts: family-select"
  on public.receipts for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- ── helper: human-readable money string for cents (NULL → "a") ──────────────
-- Used in the receipt notification message so we don't hand-roll formatting
-- in two places.
create or replace function public.format_cents(c integer)
returns text
language sql
immutable
as $$
  select case
    when c is null then 'a'
    else '$' || trim(to_char((c / 100.0)::numeric, 'FM999G999G990D00'))
  end;
$$;

-- ── helper: receipt fingerprint ─────────────────────────────────────────────
-- Same store + same date + same total = almost certainly the same physical
-- receipt. Returns NULL when there's nothing meaningful to compare on.
create or replace function public.receipt_fingerprint(
  store_name text, receipt_date date, total_cents integer
)
returns text
language sql
immutable
as $$
  select case
    when store_name is null and receipt_date is null and total_cents is null then null
    else lower(coalesce(trim(store_name), ''))
         || '|' || coalesce(receipt_date::text, '')
         || '|' || coalesce(total_cents::text, '')
  end;
$$;

-- ── pantry trigger: broader UPDATE, suppress during receipt scans ───────────
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

  -- Suppression window: if this user just inserted a receipt, the receipts
  -- trigger has already produced a single summary notification and the
  -- per-item pantry inserts that follow would be noisy duplicates. Ten
  -- seconds is enough to cover a slow client batching ~30 items.
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
    -- Notify on rename OR amount change. Custom-add UI no longer lets users
    -- pick an emoji, so emoji-only diffs effectively don't happen.
    if new.name is not distinct from old.name
       and new.amount is not distinct from old.amount then
      return new;
    end if;
    if new.name is distinct from old.name then
      msg   := actor_name || ' renamed pantry item to ' || coalesce(new.emoji, '') || ' ' || new.name;
      emoji := '🥫';
      kind  := 'info';
    elsif new.amount > old.amount then
      msg   := actor_name || ' restocked ' || coalesce(new.emoji, '') || ' ' || new.name;
      emoji := '🥫';
      kind  := 'success';
    else
      -- amount dropped — likely a cook-mode deduction, but the user wants
      -- to know. Keep the message neutral.
      msg   := actor_name || ' used some ' || coalesce(new.emoji, '') || ' ' || new.name;
      emoji := '🥫';
      kind  := 'info';
    end if;
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

-- ── shopping-list trigger: notify on every event ────────────────────────────
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
    insert into public.notifications (user_id, actor_id, msg, emoji, kind)
      values (recipient, actor, msg, emoji, kind);
  end loop;

  return coalesce(new, old);
end;
$$;

-- ── receipts trigger: per-receipt summary + cross-user dedup detection ──────
create or replace function public.notify_family_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor      uuid := auth.uid();
  actor_name text;
  msg        text;
  emoji      text := '🧾';
  kind       text := 'success';
  recipient  uuid;

  fp                text;
  dup_user_id       uuid;
  dup_user_name     text;
  dup_msg_for_actor text;
  dup_msg_for_orig  text;
  store_label       text;
begin
  if actor is null then
    return coalesce(new, old);
  end if;

  -- Only react to inserts. We don't notify on receipt edits/deletes for now.
  if TG_OP <> 'INSERT' then
    return new;
  end if;

  actor_name  := coalesce(public.actor_first_name(actor), 'Someone');
  store_label := coalesce(nullif(trim(new.store_name), ''), 'a store');

  msg := actor_name
       || ' scanned a ' || public.format_cents(new.total_cents)
       || ' receipt from ' || store_label
       || ' — ' || new.item_count::text
       || (case when new.item_count = 1 then ' item' else ' items' end);

  -- Fan out the main summary to every accepted family member of the actor.
  for recipient in select public.family_ids_of(actor)
  loop
    insert into public.notifications (user_id, actor_id, msg, emoji, kind)
      values (recipient, actor, msg, emoji, kind);
  end loop;

  -- Dedup: look for a matching fingerprint from any family member (including
  -- the actor's own past receipts) within the last 7 days. If found, fire a
  -- warning to both the actor and the original uploader so they can decide
  -- whether to delete one of them.
  fp := public.receipt_fingerprint(new.store_name, new.receipt_date, new.total_cents);
  if fp is not null then
    select r.user_id into dup_user_id
      from public.receipts r
      where r.id <> new.id
        and r.created_at > now() - interval '7 days'
        and (r.user_id = actor or r.user_id in (select public.family_ids_of(actor)))
        and public.receipt_fingerprint(r.store_name, r.receipt_date, r.total_cents) = fp
      order by r.created_at desc
      limit 1;

    if dup_user_id is not null then
      dup_user_name := coalesce(public.actor_first_name(dup_user_id), 'Someone');

      if dup_user_id = actor then
        dup_msg_for_actor := 'Heads up — you already logged a ' || public.format_cents(new.total_cents)
                          || ' receipt from ' || store_label || ' recently';
      else
        dup_msg_for_actor := 'Heads up — ' || dup_user_name || ' already logged a ' || public.format_cents(new.total_cents)
                          || ' receipt from ' || store_label || ' recently';
        dup_msg_for_orig  := actor_name || ' just logged a receipt that looks like one you already scanned'
                          || ' (' || public.format_cents(new.total_cents) || ' from ' || store_label || ')';
      end if;

      insert into public.notifications (user_id, actor_id, msg, emoji, kind)
        values (actor, actor, dup_msg_for_actor, '⚠️', 'warn');

      if dup_user_id <> actor then
        insert into public.notifications (user_id, actor_id, msg, emoji, kind)
          values (dup_user_id, actor, dup_msg_for_orig, '⚠️', 'warn');
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ── hook the receipts trigger in ────────────────────────────────────────────
drop trigger if exists receipts_notify_family on public.receipts;
create trigger receipts_notify_family
  after insert on public.receipts
  for each row execute function public.notify_family_receipt();

-- ── realtime: receipts (so a future history view updates live) ──────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.receipts';
  exception when duplicate_object then
    null;
  end;
end $$;

notify pgrst, 'reload schema';
