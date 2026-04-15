-- mise — cook log (completed cooks + rating + diners)
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Every time a user finishes cooking a recipe through CookMode, the client
-- writes one row here. The row carries:
--   * the recipe identity (slug + denormalized title / emoji / cuisine so the
--     Cookbook renders even if the recipe file is later renamed)
--   * a self-reported rating on a 4-step scale (rough / meh / good / nailed)
--   * optional free-text notes
--   * an array of `diners` — the connected users (family OR friends) who ate
--     with the chef. This drives (a) fan-out of the "X cooked Y" notification
--     and (b) chunk-3 review access (a diner can add their own rating).
--   * an `is_favorite` flag auto-set by the client when the rating is good/
--     nailed (so the Cookbook can surface favorites immediately; users can
--     also toggle it manually later).
--
-- Read visibility:
--   * the chef always sees their own log
--   * accepted family sees the chef's log (for the shared-kitchen feel)
--   * any diner on the row sees it even if they're only friends — that's
--     how chunk 3 can show "here's the meal you ate together" from the
--     diner's side.

create table if not exists public.cook_logs (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,

  recipe_slug    text        not null,
  recipe_title   text        not null,
  recipe_emoji   text                 default '🍽️',
  recipe_cuisine text,
  recipe_category text,

  rating         text        not null check (rating in ('rough','meh','good','nailed')),
  notes          text,
  xp_earned      integer     not null default 0,

  -- Connected user ids (subset of family ∪ friends) the chef said ate with
  -- them. Kept as an array so we don't need a join table for the common
  -- single-query read path. Chunk-3's reviews are per-diner so they get
  -- their own table keyed by (cook_log_id, reviewer_id).
  diners         uuid[]      not null default '{}',

  is_favorite    boolean     not null default false,

  cooked_at      timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists cook_logs_user_cooked_idx
  on public.cook_logs (user_id, cooked_at desc);
create index if not exists cook_logs_diners_gin
  on public.cook_logs using gin (diners);

alter table public.cook_logs enable row level security;

-- SELECT: owner OR family-of-owner OR any listed diner.
drop policy if exists "cook_logs: connected-select"    on public.cook_logs;
create policy "cook_logs: connected-select"
  on public.cook_logs for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
    or auth.uid() = ANY(diners)
  );

-- INSERT / UPDATE / DELETE: owner only. Family members who ate with the chef
-- get a separate cook_log_reviews row in chunk 3 — they don't mutate the
-- chef's log.
drop policy if exists "cook_logs: self-insert" on public.cook_logs;
create policy "cook_logs: self-insert"
  on public.cook_logs for insert
  with check (auth.uid() = user_id);

drop policy if exists "cook_logs: self-update" on public.cook_logs;
create policy "cook_logs: self-update"
  on public.cook_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "cook_logs: self-delete" on public.cook_logs;
create policy "cook_logs: self-delete"
  on public.cook_logs for delete
  using (auth.uid() = user_id);

-- Keep the inbox surface up to date in realtime.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.cook_logs';
  exception when duplicate_object then
    null;
  end;
end $$;

-- ── fan-out: ping each diner on INSERT ──────────────────────────────────────
-- The message is rating-aware so a good cook gets a warm note and a bad cook
-- gets a gentle ribbing. Runs SECURITY DEFINER so we can insert into other
-- users' notifications rows (mirroring the pantry/shopping triggers).
create or replace function public.notify_diners_cook_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  msg        text;
  emoji      text;
  kind       text;
  recipient  uuid;
begin
  if new.diners is null or array_length(new.diners, 1) is null then
    return new;
  end if;

  actor_name := coalesce(public.actor_first_name(new.user_id), 'Someone');

  if new.rating = 'nailed' then
    msg   := actor_name || ' cooked ' || coalesce(new.recipe_emoji,'') || ' ' || new.recipe_title || ' and nailed it — give them a chef''s kiss 👨‍🍳';
    emoji := '🤩';
    kind  := 'success';
  elsif new.rating = 'good' then
    msg   := actor_name || ' cooked ' || coalesce(new.recipe_emoji,'') || ' ' || new.recipe_title || ' — pretty happy with it';
    emoji := '😊';
    kind  := 'success';
  elsif new.rating = 'meh' then
    msg   := actor_name || ' cooked ' || coalesce(new.recipe_emoji,'') || ' ' || new.recipe_title || '. It was a meh one — call in for support';
    emoji := '😐';
    kind  := 'info';
  else
    msg   := actor_name || ' wrestled with ' || coalesce(new.recipe_emoji,'') || ' ' || new.recipe_title || ' and the meal won. Someone order takeout 🥡';
    emoji := '😬';
    kind  := 'warn';
  end if;

  foreach recipient in array new.diners loop
    -- Don't ping the chef themselves if they (bizarrely) added themselves.
    if recipient is null or recipient = new.user_id then
      continue;
    end if;
    insert into public.notifications (user_id, actor_id, msg, emoji, kind)
      values (recipient, new.user_id, msg, emoji, kind);
  end loop;

  return new;
end;
$$;

drop trigger if exists cook_logs_notify_diners on public.cook_logs;
create trigger cook_logs_notify_diners
after insert on public.cook_logs
for each row execute function public.notify_diners_cook_log();
