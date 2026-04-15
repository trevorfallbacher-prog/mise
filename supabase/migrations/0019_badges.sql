-- mise — badges (the award system)
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Two tables:
--   * badges         — static catalog, world-readable. One row per award
--                      the app knows how to hand out. SVG lives at
--                      icon_path (served from the React public folder).
--   * user_badges    — earn log. Primary key is (user_id, badge_id) so
--                      a user can only hold a given badge once.
--
-- Earning flow for v1:
--   * cook_logs INSERT trigger checks if the recipe has a badge_slug AND
--     the cook was rated good/nailed.
--   * If so, inserts a user_badges row (ON CONFLICT DO NOTHING so
--     re-cooking the recipe doesn't re-award) and fans out a
--     notifications row that deep-links to the profile so the user can
--     see their freshly-unlocked badge.
--
-- Future-friendly bits:
--   * earn_rule is a free-text description for the catalog UI ("Cook
--     Cacio e Pepe with a good rating or better"). A future version can
--     add structured rules, but v1 is "if you cooked the recipe,
--     you've earned it".
--   * `tier` defaults to 'standard' so we can later introduce bronze/
--     silver/gold variants without a column rename.

create table if not exists public.badges (
  id           uuid        primary key default gen_random_uuid(),
  slug         text        not null unique,
  name         text        not null,
  description  text        not null,
  icon_path    text        not null,        -- relative URL served from public/
  recipe_slug  text,                        -- nullable: non-recipe badges later
  earn_rule    text        not null default '',
  tier         text        not null default 'standard'
                           check (tier in ('standard','bronze','silver','gold')),
  color        text        not null default '#f5c842',
  created_at   timestamptz not null default now()
);

create index if not exists badges_recipe_idx on public.badges (recipe_slug);

alter table public.badges enable row level security;

-- Catalog is public — anyone (even unauthenticated) can read the list of
-- badges the app hands out. Writes stay service-role only.
drop policy if exists "badges: world-select" on public.badges;
create policy "badges: world-select"
  on public.badges for select
  using (true);


-- ── user_badges ─────────────────────────────────────────────────────────────

create table if not exists public.user_badges (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  badge_id    uuid        not null references public.badges(id) on delete cascade,
  earned_at   timestamptz not null default now(),
  cook_log_id uuid        references public.cook_logs(id) on delete set null,
  primary key (user_id, badge_id)
);

create index if not exists user_badges_user_idx on public.user_badges (user_id, earned_at desc);

alter table public.user_badges enable row level security;

-- SELECT cohort: you can see your own, AND any accepted connection's
-- (family OR friend). Matches the profile-view cohort so a friend's
-- UserProfile overlay shows their badge wall.
drop policy if exists "user_badges: connected-select" on public.user_badges;
create policy "user_badges: connected-select"
  on public.user_badges for select
  using (
    auth.uid() = user_id
    or user_id in (select public.connection_ids_of(auth.uid()))
  );

-- The trigger below writes rows as SECURITY DEFINER. We still allow
-- self-insert via RLS (future client-driven badges like "first scan"
-- are easier that way), but there's no self-update: once you've earned
-- it, the earned_at is immutable.
drop policy if exists "user_badges: self-insert" on public.user_badges;
create policy "user_badges: self-insert"
  on public.user_badges for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_badges: self-delete" on public.user_badges;
create policy "user_badges: self-delete"
  on public.user_badges for delete
  using (auth.uid() = user_id);

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.user_badges';
  exception when duplicate_object then
    null;
  end;
end $$;


-- ── seed: first badge ───────────────────────────────────────────────────────
-- Cacio e Pepe — icon_path points at the SVG dropped into public/badges/
-- by the user. The slug is stable; the icon_path is what the client
-- serves via <img src>.
insert into public.badges (slug, name, description, icon_path, recipe_slug, earn_rule, tier, color)
values (
  'cacio-e-pepe',
  'Cacio e Pepe',
  'Three ingredients, one emulsion, total control.',
  '/badges/cacio-e-pepe.svg',
  'cacio-e-pepe',
  'Cook Cacio e Pepe and rate it Good or Nailed.',
  'standard',
  '#f5c842'
)
on conflict (slug) do update set
  name        = excluded.name,
  description = excluded.description,
  icon_path   = excluded.icon_path,
  recipe_slug = excluded.recipe_slug,
  earn_rule   = excluded.earn_rule,
  tier        = excluded.tier,
  color       = excluded.color;


-- ── award trigger: post-cook → user_badges + notification ───────────────────
-- Only awards on rating good/nailed so a rough attempt doesn't unlock
-- the badge — the user has to actually pull it off. The notification
-- target is the earner's profile (target_kind='user_profile',
-- target_id=user_id) so tapping either the self-ping or the family
-- fan-out opens the UserProfile overlay where the badge visibly sits.
create or replace function public.award_badge_on_cook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  badge_row   public.badges%rowtype;
  already     boolean;
  actor_name  text;
  recipient   uuid;
begin
  if new.rating not in ('good','nailed') then
    return new;
  end if;

  select * into badge_row from public.badges
    where recipe_slug = new.recipe_slug
    limit 1;
  if not found then
    return new;
  end if;

  select exists(
    select 1 from public.user_badges
     where user_id = new.user_id and badge_id = badge_row.id
  ) into already;

  insert into public.user_badges (user_id, badge_id, cook_log_id)
    values (new.user_id, badge_row.id, new.id)
    on conflict (user_id, badge_id) do nothing;

  if already then
    return new;
  end if;

  -- Self-ping: earner's own inbox. Deep-links to their own profile so
  -- they can see the badge light up on their wall.
  insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
    values (
      new.user_id,
      new.user_id,
      'You earned the ' || badge_row.name || ' badge — tap to see your wall',
      '🏅',
      'success',
      'user_profile',
      new.user_id
    );

  -- Family fan-out: everyone in the earner's family gets a tappable
  -- ping that lands on the earner's profile. actor_first_name comes
  -- from migration 0010. Loop form matches the pattern used in
  -- notify_pantry_change (0010) — tidier than a SELECT-FROM-function.
  actor_name := coalesce(public.actor_first_name(new.user_id), 'Someone');
  for recipient in select public.family_ids_of(new.user_id) loop
    if recipient is null or recipient = new.user_id then
      continue;
    end if;
    insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
      values (
        recipient,
        new.user_id,
        actor_name || ' just earned the ' || badge_row.name || ' badge 🏅',
        '🏅',
        'success',
        'user_profile',
        new.user_id
      );
  end loop;

  return new;
end;
$$;

drop trigger if exists cook_logs_award_badge on public.cook_logs;
create trigger cook_logs_award_badge
after insert on public.cook_logs
for each row execute function public.award_badge_on_cook();
