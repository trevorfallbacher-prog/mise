-- 0117_avatar_catalog.sql
--
-- Introduces the game-catalog avatar system: users pick a *character*
-- to display (not a photo of themselves), unlock new characters via
-- gameplay, and cycle through their owned pool each Home mount. This
-- migration lays all three layers:
--
--   1. avatar_catalog   — the registry of available character avatars
--   2. user_avatars     — rows tracking what each user owns
--   3. profiles columns — avatar_slug + avatar_mode driving display
--
-- Plus: seed the catalog with 10 common-tier starter characters,
-- auto-grant three of them to any new (or avatarless) profile, and
-- expose RPCs for shuffle (random mode) and pin (pinned mode) that
-- the client wires to Home mount + Settings respectively.
--
-- Image assets live under `public/profile-avatars/<slug>.svg` (Vite /
-- CRA serves public/ at the app root). The catalog stores the URL
-- relative to the app root (`/profile-avatars/<slug>.svg`) so the DB
-- doesn't need to know the deploy origin. Stubs are committed
-- alongside this migration; swap them for real art by dropping
-- replacement files at the same slug paths — no schema changes
-- needed.

-- ── 1. avatar_catalog ──────────────────────────────────────────────
-- Admin-curated registry of available avatars. Rarity ties into the
-- existing daily-roll tier palette so loot-box / level-up UIs
-- (future work) can reuse the same color language. unlock_rule is a
-- free-form jsonb the grant paths read — common starters have rule
-- {"kind":"starter"}, level-gated avatars later use
-- {"kind":"level","min":25}, etc.

create table if not exists public.avatar_catalog (
  slug        text        primary key,
  name        text        not null,
  image_url   text        not null,
  rarity      text        not null default 'common'
              check (rarity in ('common','uncommon','rare','ultra')),
  unlock_rule jsonb       not null default '{"kind":"starter"}'::jsonb,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists avatar_catalog_rarity_idx
  on public.avatar_catalog (rarity, sort_order);

alter table public.avatar_catalog enable row level security;

-- Catalog is public-read — every client needs it to resolve slugs on
-- render. Writes are admin-only via service role (no client-facing
-- INSERT/UPDATE policies on purpose).
drop policy if exists "avatar_catalog: public read" on public.avatar_catalog;
create policy "avatar_catalog: public read"
  on public.avatar_catalog for select
  using (true);

-- ── 2. user_avatars ────────────────────────────────────────────────
-- One row per (user_id, slug) = "this user owns this avatar". Acquired
-- through: starter grant on first load, level-up rewards (future),
-- daily-roll payload (future), loot boxes (future). earned_reason
-- surfaces on the AVATAR section in Settings so users see *how* they
-- got each one ("LEVEL 25 REWARD", "DAILY ROLL — RARE").

create table if not exists public.user_avatars (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  slug          text        not null references public.avatar_catalog(slug) on delete cascade,
  earned_reason text        not null default 'starter',
  earned_at     timestamptz not null default now(),
  primary key (user_id, slug)
);

create index if not exists user_avatars_user_idx
  on public.user_avatars (user_id, earned_at desc);

alter table public.user_avatars enable row level security;

-- Family + self can read — family members see each other's collections
-- so the in-progress collection vibe reads socially ("Alice just
-- unlocked the Axolotl!"). Writes are all server-side via RPCs so no
-- client INSERT/UPDATE/DELETE policies.
drop policy if exists "user_avatars: family-select" on public.user_avatars;
create policy "user_avatars: family-select"
  on public.user_avatars for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- ── 3. profile columns ─────────────────────────────────────────────
-- avatar_slug  — currently displayed character (FK-ish to catalog; not
--                enforced as FK so deleting a catalog row doesn't
--                cascade-null every profile pointing at it — clients
--                already fall back on missing slugs).
-- avatar_mode  — 'random' = shuffle on Home mount, 'pinned' = stays
--                until the user picks a different one in Settings.
--                Defaults to random — new users feel the game-y churn
--                from day one.

alter table public.profiles
  add column if not exists avatar_slug text;

alter table public.profiles
  add column if not exists avatar_mode text not null default 'random'
  check (avatar_mode in ('random','pinned'));

-- ── 4. seed catalog ────────────────────────────────────────────────
-- Ten common starters so the feature has something to render on day
-- one. All 'common' + kind=starter so grant_starter_avatars() can
-- draw from any of them. Swap / extend by adding new SQL migrations
-- (or via the service-role catalog editor when that lands).

insert into public.avatar_catalog (slug, name, image_url, rarity, unlock_rule, sort_order) values
  ('chef',       'The Chef',       '/profile-avatars/chef.svg',       'common', '{"kind":"starter"}', 10),
  ('fox',        'Fennec Fox',     '/profile-avatars/fox.svg',        'common', '{"kind":"starter"}', 20),
  ('bear',       'Polar Bear',     '/profile-avatars/bear.svg',       'common', '{"kind":"starter"}', 30),
  ('panda',      'Panda',          '/profile-avatars/panda.svg',      'common', '{"kind":"starter"}', 40),
  ('owl',        'Wise Owl',       '/profile-avatars/owl.svg',        'common', '{"kind":"starter"}', 50),
  ('lion',       'Lion',           '/profile-avatars/lion.svg',       'common', '{"kind":"starter"}', 60),
  ('octopus',    'Octopus',        '/profile-avatars/octopus.svg',    'common', '{"kind":"starter"}', 70),
  ('frog',       'Frog',           '/profile-avatars/frog.svg',       'common', '{"kind":"starter"}', 80),
  ('cat',        'Cat',            '/profile-avatars/cat.svg',        'common', '{"kind":"starter"}', 90),
  ('dog',        'Dog',            '/profile-avatars/dog.svg',        'common', '{"kind":"starter"}', 100)
on conflict (slug) do update set
  name        = excluded.name,
  image_url   = excluded.image_url,
  rarity      = excluded.rarity,
  unlock_rule = excluded.unlock_rule,
  sort_order  = excluded.sort_order;

-- ── 5. grant_starter_avatars RPC ───────────────────────────────────
-- Gives the caller 3 random common starter avatars and sets
-- avatar_slug to one of them + avatar_url to match. Idempotent:
-- re-running is a no-op if the user already owns anything (we read
-- starter as "user has at least one avatar"). Safe to call from the
-- client on every mount — the short-circuit keeps it cheap.

create or replace function public.grant_starter_avatars()
returns table (avatar_slug text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owned_count integer;
  first_slug text;
  first_url text;
begin
  if uid is null then
    return;
  end if;

  select count(*) into owned_count from public.user_avatars where user_id = uid;

  -- Only do the grant half on a fresh account. The returned row below
  -- still fires for existing users so the client can patch local state
  -- with whatever the server has today.
  if owned_count = 0 then
    -- Grant 3 random commons. Single insert-select keeps it atomic;
    -- on conflict do nothing guards against the pool ever shrinking
    -- below 3 and duping a row.
    insert into public.user_avatars (user_id, slug, earned_reason)
    select uid, c.slug, 'starter'
    from public.avatar_catalog c
    where c.rarity = 'common' and c.unlock_rule ->> 'kind' = 'starter'
    order by random()
    limit 3
    on conflict (user_id, slug) do nothing;
  end if;

  -- Pick (or re-pick, if already set) the active avatar. First-owned
  -- wins on a fresh grant; existing users keep whatever they had.
  select p.avatar_slug, p.avatar_url into first_slug, first_url
    from public.profiles p where p.id = uid;

  if first_slug is null then
    select ua.slug, cat.image_url
      into first_slug, first_url
    from public.user_avatars ua
    join public.avatar_catalog cat on cat.slug = ua.slug
    where ua.user_id = uid
    order by ua.earned_at asc
    limit 1;

    if first_slug is not null then
      update public.profiles
         set avatar_slug = first_slug,
             avatar_url  = first_url
       where id = uid;
    end if;
  end if;

  avatar_slug := first_slug;
  avatar_url  := first_url;
  return next;
end;
$$;

grant execute on function public.grant_starter_avatars() to authenticated;

-- ── 6. shuffle_avatar RPC ──────────────────────────────────────────
-- Picks a random avatar from the caller's owned pool (excluding the
-- current one if possible, so a shuffle always feels like a change)
-- and writes avatar_slug + avatar_url. Home calls this on mount when
-- avatar_mode = 'random'. Returns the new row so the client can
-- optimistically update without an extra select.

create or replace function public.shuffle_avatar()
returns table (avatar_slug text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_slug text;
  picked_slug text;
  picked_url text;
  pool_size integer;
begin
  if uid is null then
    return;
  end if;

  select p.avatar_slug into current_slug from public.profiles p where p.id = uid;
  select count(*) into pool_size from public.user_avatars where user_id = uid;

  if pool_size = 0 then
    return;
  end if;

  -- Prefer a slug other than the current one. Fall back to the full
  -- pool if the user only owns one avatar.
  select ua.slug, cat.image_url
    into picked_slug, picked_url
  from public.user_avatars ua
  join public.avatar_catalog cat on cat.slug = ua.slug
  where ua.user_id = uid
    and (pool_size = 1 or ua.slug is distinct from current_slug)
  order by random()
  limit 1;

  update public.profiles
     set avatar_slug = picked_slug,
         avatar_url  = picked_url
   where id = uid;

  avatar_slug := picked_slug;
  avatar_url  := picked_url;
  return next;
end;
$$;

grant execute on function public.shuffle_avatar() to authenticated;

-- ── 7. set_avatar RPC ──────────────────────────────────────────────
-- Pin a specific owned avatar. Settings calls this when the user taps
-- a tile in the AVATAR collection. Also flips avatar_mode to 'pinned'
-- so subsequent Home mounts don't re-shuffle away from the pick.
-- Rejects slugs the caller doesn't own.

create or replace function public.set_avatar(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pic_url text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from public.user_avatars where user_id = uid and slug = p_slug) then
    raise exception 'avatar % is not owned', p_slug;
  end if;

  select image_url into pic_url from public.avatar_catalog where slug = p_slug;
  if pic_url is null then
    raise exception 'avatar % not found in catalog', p_slug;
  end if;

  update public.profiles
     set avatar_slug = p_slug,
         avatar_url  = pic_url,
         avatar_mode = 'pinned'
   where id = uid;
end;
$$;

grant execute on function public.set_avatar(text) to authenticated;

-- ── 8. set_avatar_mode RPC ─────────────────────────────────────────
-- Flip between random / pinned without changing the current slug.
-- When flipping back to random, the next Home mount's shuffle_avatar
-- call does the actual roll.

create or replace function public.set_avatar_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_mode not in ('random','pinned') then
    raise exception 'invalid avatar mode %', p_mode;
  end if;
  update public.profiles set avatar_mode = p_mode where id = uid;
end;
$$;

grant execute on function public.set_avatar_mode(text) to authenticated;

-- ── 9. realtime ────────────────────────────────────────────────────
-- profiles is already on the realtime publication (earlier migrations)
-- so avatar_url changes propagate to family members without extra
-- wiring. user_avatars joins the publication so unlock celebrations
-- can land live when loot-box / level-up work ships.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_avatars'
  ) then
    alter publication supabase_realtime add table public.user_avatars;
  end if;
end $$;
