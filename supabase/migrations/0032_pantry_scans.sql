-- pantry_scans: table for fridge/pantry/freezer shelf scans.
--
-- Parallel to public.receipts (which tracks receipt-photo scans with
-- store + total + date). This is the analogous table for "point the
-- camera at my fridge shelf" scans — a scan session that produced
-- multiple pantry items without a store/receipt context.
--
-- Enables:
--
--   * Batched notifications. Today a receipt scan fires ONE rollup
--     ("Trevor scanned a receipt from TJ's — 12 items") and the pantry
--     trigger suppresses per-item pings for 10s. Fridge scans didn't
--     have anywhere to insert the summary row, so per-item pings
--     fanned out at full volume ("Marissa added butter", "Marissa
--     added eggs", "Marissa added milk", etc). This closes that gap.
--
--   * Deep-linkable provenance. The 0029 source_scan_id column on
--     pantry_items gets a real FK target, so the ItemCard's provenance
--     line can route to a pantry-scan detail view the same way
--     receipt scans route to ReceiptView.
--
--   * Shared image storage. Pantry scans use the same 'scans' bucket
--     as receipts under the same scans/<uid>/<scan_id>.<ext> path
--     convention — one storage bucket, two artifact kinds, no double
--     RLS plumbing.

create table if not exists public.pantry_scans (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,

  -- Which physical tile the user was scanning when they took the photo.
  kind         text        not null check (kind in ('fridge', 'pantry', 'freezer')),
  scanned_at   timestamptz not null default now(),
  item_count   integer     not null default 0,
  image_path   text        null,

  created_at   timestamptz not null default now()
);

create index if not exists pantry_scans_user_date_idx
  on public.pantry_scans (user_id, scanned_at desc);

alter table public.pantry_scans enable row level security;

-- Owner + family can select (mirrors receipts policy from 0011).
drop policy if exists "pantry_scans: self-or-family-select" on public.pantry_scans;
create policy "pantry_scans: self-or-family-select"
  on public.pantry_scans for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "pantry_scans: self-insert" on public.pantry_scans;
create policy "pantry_scans: self-insert"
  on public.pantry_scans for insert
  with check (auth.uid() = user_id);

drop policy if exists "pantry_scans: self-delete" on public.pantry_scans;
create policy "pantry_scans: self-delete"
  on public.pantry_scans for delete
  using (auth.uid() = user_id);

-- Back-fill the FK target for source_scan_id (0029 declared the column
-- without a reference since pantry_scans didn't exist yet). ON DELETE
-- SET NULL so deleting a scan doesn't cascade to its pantry items.
-- Guarded with a pg_constraint probe so re-running is safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pantry_items_source_scan_id_fkey'
  ) then
    alter table public.pantry_items
      add constraint pantry_items_source_scan_id_fkey
      foreign key (source_scan_id) references public.pantry_scans(id)
      on delete set null;
  end if;
end $$;

-- ── batched notification for pantry-shelf scans ─────────────────────────────
-- Fires one "Trevor scanned the fridge and added 8 items" summary on
-- pantry_scans INSERT, mirroring the receipts trigger from 0011.
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
    insert into public.notifications (user_id, actor_id, msg, emoji, kind)
      values (recipient, actor, msg, emoji, kind);
  end loop;

  return new;
end;
$$;

drop trigger if exists pantry_scans_notify_family on public.pantry_scans;
create trigger pantry_scans_notify_family
after insert on public.pantry_scans
for each row execute function public.notify_family_pantry_scan();

-- ── extend pantry-trigger suppression to cover pantry_scans ────────────────
-- The existing notify_family_pantry() trigger suppresses per-item
-- pantry pings for 10s after a receipts insert. Extend the window to
-- also cover pantry_scans inserts so fridge/pantry/freezer scans get
-- the same rollup behavior receipts enjoy.
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
  recent_batch_id    uuid;
begin
  if actor is null then
    return coalesce(new, old);
  end if;

  -- Suppression window: if this user just inserted a receipt OR a
  -- pantry_scan, the respective trigger has already produced a single
  -- summary notification and the per-item inserts that follow would be
  -- noisy duplicates. 10s is enough for a slow client batching ~30 items.
  select id into recent_batch_id
    from public.receipts
    where user_id = actor
      and created_at > now() - interval '10 seconds'
    limit 1;
  if recent_batch_id is not null then
    return coalesce(new, old);
  end if;

  select id into recent_batch_id
    from public.pantry_scans
    where user_id = actor
      and created_at > now() - interval '10 seconds'
    limit 1;
  if recent_batch_id is not null then
    return coalesce(new, old);
  end if;

  actor_name := coalesce(public.actor_first_name(actor), 'Someone');

  if (TG_OP = 'INSERT') then
    msg   := actor_name || ' added ' || coalesce(new.emoji, '') || ' ' || new.name || ' to the pantry';
    emoji := '🥫';
    kind  := 'success';
  elsif (TG_OP = 'UPDATE') then
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
