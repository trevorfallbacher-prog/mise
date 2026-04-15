-- mise — cook log reviews (diner's take on a cook)
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Every connected user the chef listed in `cook_logs.diners` can leave ONE
-- review on that cook — their own rating, their own note. The chef can see
-- all reviews; other diners on the same cook can see each other's reviews
-- (so the couple who came over for fajitas can both see their partner's
-- take). Reviews never mutate the chef's own log.
--
-- RLS mirrors the cook_logs policy (same visibility cohort):
--   * SELECT: the chef, any diner on that log, or family-of-chef
--   * INSERT / UPDATE / DELETE: only the reviewer themselves, and only
--     if they're actually listed as a diner on the referenced cook
--
-- A diner leaving a review also pings the chef via the notifications
-- inbox so the "how'd it land?" feedback loop closes without the chef
-- having to go hunting.

create table if not exists public.cook_log_reviews (
  id           uuid        primary key default gen_random_uuid(),
  cook_log_id  uuid        not null references public.cook_logs(id) on delete cascade,
  reviewer_id  uuid        not null references auth.users(id)       on delete cascade,

  rating       text        not null check (rating in ('rough','meh','good','nailed')),
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One review per (cook, reviewer). The client uses upsert so editing a
-- review just bumps this row rather than accumulating.
create unique index if not exists cook_log_reviews_unique_per_reviewer
  on public.cook_log_reviews (cook_log_id, reviewer_id);

create index if not exists cook_log_reviews_reviewer_idx
  on public.cook_log_reviews (reviewer_id);

drop trigger if exists cook_log_reviews_touch_updated_at on public.cook_log_reviews;
create trigger cook_log_reviews_touch_updated_at
before update on public.cook_log_reviews
for each row execute function public.touch_updated_at();

alter table public.cook_log_reviews enable row level security;

-- Helper: can the caller SEE the underlying cook_log?
--
-- We inline the same logic as cook_logs's SELECT policy instead of calling
-- the table, because RLS on cook_logs would otherwise recurse. SECURITY
-- DEFINER sidesteps that.
create or replace function public.can_see_cook_log(log_id uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cook_logs l
    where l.id = log_id
      and (
        l.user_id = viewer
        or l.user_id in (select public.family_ids_of(viewer))
        or viewer = ANY(l.diners)
      )
  );
$$;

-- Helper: is the caller actually listed as a diner on this cook?
-- Used to gate insert/update: you can only review meals you were at.
create or replace function public.is_diner_on(log_id uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cook_logs l
    where l.id = log_id
      and viewer = ANY(l.diners)
  );
$$;

drop policy if exists "cook_log_reviews: cohort-select" on public.cook_log_reviews;
create policy "cook_log_reviews: cohort-select"
  on public.cook_log_reviews for select
  using (public.can_see_cook_log(cook_log_id, auth.uid()));

drop policy if exists "cook_log_reviews: diner-insert" on public.cook_log_reviews;
create policy "cook_log_reviews: diner-insert"
  on public.cook_log_reviews for insert
  with check (
    auth.uid() = reviewer_id
    and public.is_diner_on(cook_log_id, auth.uid())
  );

drop policy if exists "cook_log_reviews: self-update" on public.cook_log_reviews;
create policy "cook_log_reviews: self-update"
  on public.cook_log_reviews for update
  using (auth.uid() = reviewer_id)
  with check (auth.uid() = reviewer_id);

drop policy if exists "cook_log_reviews: self-delete" on public.cook_log_reviews;
create policy "cook_log_reviews: self-delete"
  on public.cook_log_reviews for delete
  using (auth.uid() = reviewer_id);

-- Keep the review surface up to date in realtime too.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.cook_log_reviews';
  exception when duplicate_object then
    null;
  end;
end $$;

-- ── fan-out: notify the chef when a diner leaves a review ───────────────────
-- Rating-aware copy so a glowing review lands differently than a rough one.
-- Upsert-friendly — the trigger also fires on UPDATE so an edited review
-- still pings (we could suppress that, but the chef probably does want to
-- know if someone upgraded their 😐 to a 😊).
create or replace function public.notify_chef_of_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chef_id      uuid;
  reviewer_name text;
  recipe_title text;
  recipe_emoji text;
  msg          text;
  emoji        text;
  kind         text;
begin
  select user_id, cook_logs.recipe_title, cook_logs.recipe_emoji
    into chef_id, recipe_title, recipe_emoji
    from public.cook_logs
    where id = new.cook_log_id;

  if chef_id is null or chef_id = new.reviewer_id then
    return new; -- chef reviewing their own meal would be weird; skip ping
  end if;

  reviewer_name := coalesce(public.actor_first_name(new.reviewer_id), 'A guest');

  if new.rating = 'nailed' then
    msg   := reviewer_name || ' raved about your ' || coalesce(recipe_emoji,'') || ' ' || recipe_title || ' — chef''s kiss 👨‍🍳';
    emoji := '🤩';
    kind  := 'success';
  elsif new.rating = 'good' then
    msg   := reviewer_name || ' really liked your ' || coalesce(recipe_emoji,'') || ' ' || recipe_title;
    emoji := '😊';
    kind  := 'success';
  elsif new.rating = 'meh' then
    msg   := reviewer_name || ' thought your ' || coalesce(recipe_emoji,'') || ' ' || recipe_title || ' was… fine';
    emoji := '😐';
    kind  := 'info';
  else
    msg   := reviewer_name || ' left a rough review on your ' || coalesce(recipe_emoji,'') || ' ' || recipe_title || ' — we don''t talk about that meal';
    emoji := '😬';
    kind  := 'warn';
  end if;

  insert into public.notifications (user_id, actor_id, msg, emoji, kind)
    values (chef_id, new.reviewer_id, msg, emoji, kind);

  return new;
end;
$$;

drop trigger if exists cook_log_reviews_notify_chef on public.cook_log_reviews;
create trigger cook_log_reviews_notify_chef
after insert or update of rating, notes on public.cook_log_reviews
for each row execute function public.notify_chef_of_review();
