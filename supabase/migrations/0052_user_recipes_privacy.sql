-- 0052_user_recipes_privacy.sql
--
-- Tightens user_recipes visibility and opens a channel for custom
-- recipes to flow back into the bundled library through admin review.
--
-- 0051 made user_recipes readable by self + accepted family. That was
-- the wrong default — a recipe is a personal notebook entry by
-- default, not a household artifact. This migration flips the ground
-- rule: a row is visible only to its author unless the author opts in
-- by flipping `shared=true`, at which point the existing family scope
-- (via family_ids_of) kicks in. Scheduling a recipe for family counts
-- as opting in, which the client is responsible for setting before
-- calling schedule().
--
-- It also introduces a "submitted_for_review" queue. When a user
-- checks the "submit to admin" box on a CUSTOM recipe (not AI —
-- those are intentionally excluded from this lane; see the plan),
-- the row becomes visible to admins so it can be reviewed and, down
-- the line, promoted into src/data/recipes/ manually. Admins can
-- flip review_status via a dedicated UPDATE policy that's scoped to
-- rows actually in the review queue, so admin reach is never broader
-- than the queue itself.

-- ── 1. columns ────────────────────────────────────────────────────────
alter table public.user_recipes
  add column if not exists shared                boolean not null default false,
  add column if not exists submitted_for_review  boolean not null default false,
  add column if not exists review_status         text;

do $$
begin
  if not exists (
    select 1
    from information_schema.check_constraints
    where constraint_name = 'user_recipes_review_status_check'
  ) then
    alter table public.user_recipes
      add constraint user_recipes_review_status_check
      check (review_status is null or review_status in ('pending','approved','rejected'));
  end if;
end $$;

-- Partial index speeds up the admin queue lookup.
create index if not exists user_recipes_submitted_idx
  on public.user_recipes (submitted_for_review)
  where submitted_for_review = true;

-- ── 2. replace SELECT policy ─────────────────────────────────────────
drop policy if exists "user_recipes: self+family select"
  on public.user_recipes;
drop policy if exists "user_recipes: private select"
  on public.user_recipes;

create policy "user_recipes: private select"
  on public.user_recipes for select
  using (
    auth.uid() = user_id
    or (shared = true and user_id in (select public.family_ids_of(auth.uid())))
    or (submitted_for_review = true and public.is_admin(auth.uid()))
  );

-- ── 3. admin UPDATE — review queue only ──────────────────────────────
-- Narrowly scoped: admins can only UPDATE rows currently in the review
-- queue (submitted_for_review=true). Approving/rejecting clears
-- submitted_for_review, which itself drops the row out of admin scope
-- — follow-up edits would need a fresh submission.
drop policy if exists "user_recipes: admin review update"
  on public.user_recipes;
create policy "user_recipes: admin review update"
  on public.user_recipes for update to authenticated
  using      (public.is_admin(auth.uid()) and submitted_for_review = true)
  with check (public.is_admin(auth.uid()));

-- ── 4. schema cache reload ───────────────────────────────────────────
notify pgrst, 'reload schema';
