-- mise — initial schema
--
-- Run this once in your Supabase project:
--   Supabase dashboard → SQL Editor → New query → paste this → Run
--
-- It's safe to re-run (uses IF NOT EXISTS / OR REPLACE where possible), but
-- dropping and re-running cleanly during development is also fine since we
-- don't have production data yet.

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles: extends auth.users with the cooking-specific profile
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  name             text,
  dietary          text,
  vegan_style      text,
  level            text,
  goal             text,

  total_xp         integer     not null default 0,
  streak_count     integer     not null default 0,
  last_cooked_date date,

  -- map of skill_id → level (1..5). e.g. { "knife": 2, "heat": 1 }
  skill_levels     jsonb       not null default '{}'::jsonb,
  -- set of cuisine ids the user has ever cooked. Used for first-cuisine bonus.
  cuisines_cooked  text[]      not null default '{}',

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Keep updated_at fresh on any profile update
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
--
-- Every table below enables RLS and allows each authenticated user to read /
-- write only their own rows. The publishable/anon key cannot bypass this.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;

drop policy if exists "profiles: self-select" on public.profiles;
create policy "profiles: self-select"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: self-insert" on public.profiles;
create policy "profiles: self-insert"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles: self-update" on public.profiles;
create policy "profiles: self-update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No delete policy — we don't let users delete their own profile row from the
-- client. If we add account deletion later, it should cascade from auth.users.
