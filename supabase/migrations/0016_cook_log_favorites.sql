-- mise — per-viewer cook favorites (everyone can bookmark)
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Until now cook_logs.is_favorite was a single boolean on the row. That
-- made sense when only the chef had a view of their own log — their star
-- on their own cookbook. Once the Eaten tab landed, diners also want to
-- star cooks (for "save this for next time I see Grandma's chicken
-- again"), and they can't mutate another user's row.
--
-- This table flips favorites into a per-(viewer, cook_log) join, so:
--   * the chef's own ★ on their own cooks still works
--   * a diner can ★ a meal they ate with someone else, and only they
--     see that star
--   * RLS mirrors the cook_logs / cook_log_reviews cohort: you can
--     SELECT a favorite if you can see the underlying cook_log
--
-- We keep cook_logs.is_favorite in place (so no destructive drop) and
-- seed this table from it on first run — chef's existing stars carry
-- over automatically.

create table if not exists public.cook_log_favorites (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  cook_log_id uuid        not null references public.cook_logs(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, cook_log_id)
);

create index if not exists cook_log_favorites_user_idx
  on public.cook_log_favorites (user_id, created_at desc);

alter table public.cook_log_favorites enable row level security;

-- SELECT: anyone who can see the underlying cook_log can see favorites
-- on it. Gives the chef a way to know which of their family have starred
-- their cook (useful signal even though we don't currently surface it in
-- the UI — we could later show "Alice saved this" style hints).
drop policy if exists "cook_log_favorites: cohort-select" on public.cook_log_favorites;
create policy "cook_log_favorites: cohort-select"
  on public.cook_log_favorites for select
  using (public.can_see_cook_log(cook_log_id, auth.uid()));

-- INSERT / DELETE: only the viewer can star or un-star for themselves,
-- and only on cooks they can actually see (otherwise we'd leak cook_log
-- ids via a write probe).
drop policy if exists "cook_log_favorites: self-insert" on public.cook_log_favorites;
create policy "cook_log_favorites: self-insert"
  on public.cook_log_favorites for insert
  with check (
    auth.uid() = user_id
    and public.can_see_cook_log(cook_log_id, auth.uid())
  );

drop policy if exists "cook_log_favorites: self-delete" on public.cook_log_favorites;
create policy "cook_log_favorites: self-delete"
  on public.cook_log_favorites for delete
  using (auth.uid() = user_id);

-- Realtime so the ★ flip is reflected in every open Cookbook tab
-- without a manual refresh — especially useful when the same user is
-- signed in on two devices.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.cook_log_favorites';
  exception when duplicate_object then
    null;
  end;
end $$;

-- ── seed from the legacy cook_logs.is_favorite boolean ─────────────────────
-- Idempotent via ON CONFLICT. This preserves every ★ a chef has placed
-- prior to this migration. We deliberately don't drop the old column —
-- keeping it means a stale row still renders as ★ if a client ever rolls
-- back, and removing it later is a one-liner once we're confident.
insert into public.cook_log_favorites (user_id, cook_log_id)
  select user_id, id
    from public.cook_logs
   where is_favorite = true
on conflict (user_id, cook_log_id) do nothing;
