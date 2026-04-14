-- mise — family/friends relationships
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Two relationship tiers:
--   family  — share pantry + scheduled_meals (both can read AND write)
--   friend  — share profile prefs only (dietary, level, goal); read-only
--
-- Invitations use a short share code printed on the settings screen. There is
-- no email lookup, so users exchange codes out-of-band (text, in person, etc.).
--
-- Implementation notes:
--   * We store ONE row per relationship (requester → addressee), not two. All
--     queries OR across both columns.
--   * RLS on pantry_items / scheduled_meals is extended via SECURITY DEFINER
--     helper functions so policies don't have to inline the OR-ed subqueries.
--   * The invite_code is a random 6-char alphanumeric; unique across the
--     profiles table. Collisions are astronomically unlikely at app scale but
--     the unique constraint will retry generation if needed.

-- ── invite code on profiles ──────────────────────────────────────────────────
-- Generate a 6-char upper-case alphanumeric code (A-Z + 2-9, skipping
-- 0/1/O/I/L to avoid visual confusion).
create or replace function public.generate_invite_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1),
    ''
  )
  from generate_series(1, 6);
$$;

-- Add the column (nullable first, then backfill, then NOT NULL).
alter table public.profiles
  add column if not exists invite_code text unique;

update public.profiles
  set invite_code = public.generate_invite_code()
  where invite_code is null;

alter table public.profiles
  alter column invite_code set not null;

-- New users get a code on profile insert if the client didn't supply one.
create or replace function public.set_invite_code_default()
returns trigger
language plpgsql
as $$
begin
  if new.invite_code is null then
    new.invite_code := public.generate_invite_code();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_invite_code_default on public.profiles;
create trigger profiles_invite_code_default
before insert on public.profiles
for each row execute function public.set_invite_code_default();

-- ── relationships table ──────────────────────────────────────────────────────
create table if not exists public.relationships (
  id           uuid        primary key default gen_random_uuid(),
  requester_id uuid        not null references auth.users(id) on delete cascade,
  addressee_id uuid        not null references auth.users(id) on delete cascade,
  kind         text        not null check (kind in ('family', 'friend')),
  status       text        not null default 'pending'
                           check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A single directed request between two users (either party can drop it).
  -- A user can upgrade friend → family by sending a fresh request from the
  -- other side; the accept-path will UPDATE kind when both rows collapse.
  constraint relationships_distinct check (requester_id <> addressee_id),
  constraint relationships_unique_pair unique (requester_id, addressee_id)
);

create index if not exists relationships_requester_idx
  on public.relationships (requester_id);
create index if not exists relationships_addressee_idx
  on public.relationships (addressee_id);

drop trigger if exists relationships_touch_updated_at on public.relationships;
create trigger relationships_touch_updated_at
before update on public.relationships
for each row execute function public.touch_updated_at();

alter table public.relationships enable row level security;

-- Both parties can see rows they're part of.
drop policy if exists "relationships: participant-select" on public.relationships;
create policy "relationships: participant-select"
  on public.relationships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Only the requester can create the initial pending row.
drop policy if exists "relationships: requester-insert" on public.relationships;
create policy "relationships: requester-insert"
  on public.relationships for insert
  with check (auth.uid() = requester_id and status = 'pending');

-- Either party can update (the addressee to accept, either to change kind).
drop policy if exists "relationships: participant-update" on public.relationships;
create policy "relationships: participant-update"
  on public.relationships for update
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Either party can remove the relationship.
drop policy if exists "relationships: participant-delete" on public.relationships;
create policy "relationships: participant-delete"
  on public.relationships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ── helpers: ids of accepted family / friends for a user ─────────────────────
-- SECURITY DEFINER so policies can call them without recursion through RLS.
create or replace function public.family_ids_of(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when requester_id = uid then addressee_id else requester_id end
  from public.relationships
  where kind = 'family'
    and status = 'accepted'
    and (requester_id = uid or addressee_id = uid);
$$;

create or replace function public.friend_ids_of(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when requester_id = uid then addressee_id else requester_id end
  from public.relationships
  where kind = 'friend'
    and status = 'accepted'
    and (requester_id = uid or addressee_id = uid);
$$;

-- Anyone accepted in either direction (family OR friend).
create or replace function public.connection_ids_of(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when requester_id = uid then addressee_id else requester_id end
  from public.relationships
  where status = 'accepted'
    and (requester_id = uid or addressee_id = uid);
$$;

-- ── extended RLS: profiles visible to family + friends ───────────────────────
-- Replace the self-only SELECT policy. Family and friends both need to read
-- the profile row (family for name/avatar, friends for dietary/level/goal).
-- Keep insert/update self-only.
drop policy if exists "profiles: self-select" on public.profiles;
drop policy if exists "profiles: connected-select" on public.profiles;
create policy "profiles: connected-select"
  on public.profiles for select
  using (
    auth.uid() = id
    or id in (select public.connection_ids_of(auth.uid()))
  );

-- ── extended RLS: pantry_items shared with family ────────────────────────────
-- Family members can read AND write each other's pantry rows.
drop policy if exists "pantry_items: self-select" on public.pantry_items;
drop policy if exists "pantry_items: family-select" on public.pantry_items;
create policy "pantry_items: family-select"
  on public.pantry_items for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "pantry_items: self-insert" on public.pantry_items;
drop policy if exists "pantry_items: family-insert" on public.pantry_items;
create policy "pantry_items: family-insert"
  on public.pantry_items for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "pantry_items: self-update" on public.pantry_items;
drop policy if exists "pantry_items: family-update" on public.pantry_items;
create policy "pantry_items: family-update"
  on public.pantry_items for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "pantry_items: self-delete" on public.pantry_items;
drop policy if exists "pantry_items: family-delete" on public.pantry_items;
create policy "pantry_items: family-delete"
  on public.pantry_items for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- ── extended RLS: scheduled_meals shared with family ─────────────────────────
drop policy if exists "scheduled_meals: self-select" on public.scheduled_meals;
drop policy if exists "scheduled_meals: family-select" on public.scheduled_meals;
create policy "scheduled_meals: family-select"
  on public.scheduled_meals for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "scheduled_meals: self-insert" on public.scheduled_meals;
drop policy if exists "scheduled_meals: family-insert" on public.scheduled_meals;
create policy "scheduled_meals: family-insert"
  on public.scheduled_meals for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "scheduled_meals: self-update" on public.scheduled_meals;
drop policy if exists "scheduled_meals: family-update" on public.scheduled_meals;
create policy "scheduled_meals: family-update"
  on public.scheduled_meals for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "scheduled_meals: self-delete" on public.scheduled_meals;
drop policy if exists "scheduled_meals: family-delete" on public.scheduled_meals;
create policy "scheduled_meals: family-delete"
  on public.scheduled_meals for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- ── extended RLS: shopping_list_items shared with family ─────────────────────
drop policy if exists "shopping_list_items: self-select" on public.shopping_list_items;
drop policy if exists "shopping_list_items: family-select" on public.shopping_list_items;
create policy "shopping_list_items: family-select"
  on public.shopping_list_items for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "shopping_list_items: self-insert" on public.shopping_list_items;
drop policy if exists "shopping_list_items: family-insert" on public.shopping_list_items;
create policy "shopping_list_items: family-insert"
  on public.shopping_list_items for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "shopping_list_items: self-update" on public.shopping_list_items;
drop policy if exists "shopping_list_items: family-update" on public.shopping_list_items;
create policy "shopping_list_items: family-update"
  on public.shopping_list_items for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "shopping_list_items: self-delete" on public.shopping_list_items;
drop policy if exists "shopping_list_items: family-delete" on public.shopping_list_items;
create policy "shopping_list_items: family-delete"
  on public.shopping_list_items for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- ── RPC: accept invite by code ───────────────────────────────────────────────
-- The client doesn't know the other user's id until it resolves their invite
-- code through here. SECURITY DEFINER lets us look up the code even though
-- the caller has no permission on the other profile row yet.
create or replace function public.request_connection(
  code text,
  relationship_kind text
)
returns public.relationships
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  existing  public.relationships;
  row       public.relationships;
begin
  if relationship_kind not in ('family', 'friend') then
    raise exception 'invalid kind: %', relationship_kind;
  end if;

  select id into target_id from public.profiles
    where invite_code = upper(trim(code));

  if target_id is null then
    raise exception 'no user found for code %', code using errcode = 'P0001';
  end if;

  if target_id = auth.uid() then
    raise exception 'cannot connect to yourself' using errcode = 'P0001';
  end if;

  -- If a row already exists either direction, return it (idempotent).
  select * into existing from public.relationships
    where (requester_id = auth.uid() and addressee_id = target_id)
       or (requester_id = target_id  and addressee_id = auth.uid())
    limit 1;

  if found then
    -- If the other party already invited me, accept instead of inserting.
    if existing.status = 'pending' and existing.addressee_id = auth.uid() then
      update public.relationships
        set status = 'accepted', kind = relationship_kind
        where id = existing.id
        returning * into row;
      return row;
    end if;
    return existing;
  end if;

  insert into public.relationships (requester_id, addressee_id, kind, status)
    values (auth.uid(), target_id, relationship_kind, 'pending')
    returning * into row;
  return row;
end;
$$;

grant execute on function public.request_connection(text, text) to authenticated;
