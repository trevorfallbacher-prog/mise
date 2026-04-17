-- 0042_admin_role.sql
--
-- Admin role — elevated permissions scoped to you (the app owner /
-- maintainer) for debugging, data audit, and cross-family moderation
-- that RLS normally blocks.
--
-- SCOPE OF THIS FIRST CUT:
--   * profiles.role column ('user' | 'admin'), default 'user'
--   * public.is_admin(uid) — SECURITY DEFINER helper that reads the
--     role column without recursing through the profiles RLS
--     policies (otherwise the admin check itself would be subject
--     to RLS, producing a catch-22)
--   * Admin SELECT bypass on public.profiles and public.receipts —
--     the two tables the first AdminPanel screen needs. Other tables
--     (pantry_items, pantry_scans, cook_logs, notifications…) stay
--     scoped to owner + family for now; expand in future migrations
--     as concrete admin use cases show up.
--
-- EXPLICITLY NOT IN THIS MIGRATION:
--   * Admin INSERT / UPDATE / DELETE policies — bypass writes are
--     much more dangerous than bypass reads, so they're added one
--     table at a time alongside the screens that need them.
--   * Self-elevation from the client — the role column is not
--     writable by the user; flipping someone to admin requires a
--     direct SQL edit (see the commented stanza at the bottom).
--
-- BOOTSTRAP — after running this migration, elevate your own user
-- via the Supabase SQL Editor:
--
--   update public.profiles
--      set role = 'admin'
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- Nothing in the client changes until you flip the role — safe to
-- ship the migration without the UI landing at the same time.

-- ── 1. role column ───────────────────────────────────────────────
alter table public.profiles
  add column if not exists role text not null default 'user';

-- Guarded CHECK — only allowed values are 'user' and 'admin'. Wrapped
-- in a DO block so re-runs don't trip on an existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('user', 'admin'));
  end if;
end $$;

-- ── 2. is_admin() helper ──────────────────────────────────────────
-- SECURITY DEFINER so the function executes with the owner's
-- privileges (reading past RLS on profiles), not the caller's.
-- Without this, any policy that references is_admin() would also
-- re-trigger the profiles SELECT policy, and we'd deadlock.
--
-- Takes an optional uid param defaulting to auth.uid() for flex —
-- most policies call the default form, but admin tooling may want
-- to probe a specific user id.
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role = 'admin'
  );
$$;

-- Lock down who can call it. Anon has no business probing roles;
-- authenticated users can check their own admin-ness (used by the
-- client to decide whether to show the Admin entry in Settings).
revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

-- ── 3. Admin SELECT policies ─────────────────────────────────────
-- Additive — these sit alongside the existing self / family policies.
-- A non-admin user's access is identical to before; an admin gains
-- visibility across all rows in the listed tables.
--
-- profiles: admin can see every user row (the AdminPanel's Users
-- list needs this — regular users still only see themselves + their
-- family per the existing policy).

drop policy if exists "profiles: admin-select" on public.profiles;
create policy "profiles: admin-select"
  on public.profiles for select
  using (public.is_admin());

-- receipts: admin can see every receipt row across families. Regular
-- users still get self + family (0011). The AdminPanel's Receipts
-- audit view needs this so mis-OCR'd or duplicate rows from any
-- family can be inspected and cleaned.

drop policy if exists "receipts: admin-select" on public.receipts;
create policy "receipts: admin-select"
  on public.receipts for select
  using (public.is_admin());

-- ── 4. Realtime / schema cache ────────────────────────────────────
-- PostgREST caches the schema; a role-column add needs a reload.
notify pgrst, 'reload schema';
