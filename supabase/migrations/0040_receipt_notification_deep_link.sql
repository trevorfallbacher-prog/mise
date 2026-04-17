-- 0040_receipt_notification_deep_link.sql
--
-- Makes the bell notification for a receipt (and a pantry-shelf scan)
-- tappable. Until now the rollup row — "Trevor scanned a $47 receipt
-- from Trader Joe's — 12 items" — was pure text: you saw it, but the
-- only way to actually look at the receipt was to navigate to the
-- Kitchen, find one of its items, tap it, and drill into the
-- provenance line. That's three hops for something that should be
-- one tap.
--
-- Migration 0015 already added notifications.target_kind + target_id
-- and taught cook_log triggers to populate them. The receipt +
-- pantry_scan triggers (from 0011 and 0032) still inserted their
-- summary rows with both fields null, so the client rendered them
-- non-tappable even though ReceiptView is fully built and already
-- knows how to open both artifact kinds by id.
--
-- This migration redefines both triggers to populate:
--   target_kind = 'receipt'       + target_id = receipts.id
--   target_kind = 'pantry_scan'   + target_id = pantry_scans.id
--
-- Kind strings chosen to match the provenance vocabulary the
-- ItemCard already uses so client routing stays symmetric with the
-- existing onOpenProvenance handler in Pantry.jsx.
--
-- Dedup warnings for receipts also get a target_id so tapping
-- "Heads up — you already logged…" lands on the NEW receipt (the one
-- that just came in), giving the user an immediate side-by-side
-- "delete which one?" entry point.
--
-- IDEMPOTENT — CREATE OR REPLACE on both functions; no schema DDL.
-- Safe to re-run.

-- ── notify_family_receipt: populate target_kind/target_id ──────────────
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

  -- Summary fan-out. target_kind/target_id so the bell row taps straight
  -- into ReceiptView.
  for recipient in select public.family_ids_of(actor)
  loop
    insert into public.notifications
      (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
    values
      (recipient, actor, msg, emoji, kind, 'receipt', new.id);
  end loop;

  -- Same dedup detection as 0011, now with deep links on both warning
  -- rows so the user lands on ReceiptView and can compare.
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

      insert into public.notifications
        (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
      values
        (actor, actor, dup_msg_for_actor, '⚠️', 'warn', 'receipt', new.id);

      if dup_user_id <> actor then
        insert into public.notifications
          (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
        values
          (dup_user_id, actor, dup_msg_for_orig, '⚠️', 'warn', 'receipt', new.id);
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ── notify_family_pantry_scan: same deep-link treatment ────────────────
create or replace function public.notify_family_pantry_scan()
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
  kind       text := 'success';
  recipient  uuid;
  kind_label text;
begin
  if actor is null or TG_OP <> 'INSERT' then
    return coalesce(new, old);
  end if;

  actor_name := coalesce(public.actor_first_name(actor), 'Someone');
  kind_label := case new.kind
    when 'fridge'  then 'the fridge'
    when 'freezer' then 'the freezer'
    when 'pantry'  then 'the pantry'
    else 'a shelf'
  end;
  emoji := case new.kind
    when 'fridge'  then '🧊'
    when 'freezer' then '❄️'
    when 'pantry'  then '🥫'
    else '📱'
  end;

  msg := actor_name
       || ' scanned ' || kind_label
       || ' and added ' || new.item_count::text
       || (case when new.item_count = 1 then ' item' else ' items' end);

  for recipient in select public.family_ids_of(actor)
  loop
    insert into public.notifications
      (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
    values
      (recipient, actor, msg, emoji, kind, 'pantry_scan', new.id);
  end loop;

  return new;
end;
$$;

notify pgrst, 'reload schema';
