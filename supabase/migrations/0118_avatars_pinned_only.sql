-- 0118_avatars_pinned_only.sql
--
-- Tightens the avatar system spec now that the product has settled:
--
--   * Signups get 8 random commons (not 3), so the collection grid in
--     Settings reads as a real picker on day one instead of a tiny
--     starter pack. Leaves room for 2 more commons + every higher
--     rarity to arrive as unlocks later.
--   * The "random re-roll each Home mount" mode is off by default —
--     users were confused by their avatar changing on them. Once
--     assigned, their avatar stays until they pick a different one in
--     Settings. The column + RPCs live on unused so a future toggle
--     can flip it back on without another schema migration.
--   * Existing rows from the short-lived random-default period are
--     migrated to pinned so no one's avatar silently churns on upgrade.
--
-- This migration is purely a behavior change — no new columns / tables.

-- Switch the default. Anything inserted from now on starts pinned.
alter table public.profiles
  alter column avatar_mode set default 'pinned';

-- Settle existing accounts. Nobody was using the random mode yet by
-- design (client shuffle call wasn't shipping for long), but flip
-- anyway so the display matches the new intent.
update public.profiles
   set avatar_mode = 'pinned'
 where avatar_mode = 'random';

-- Grant count moves from 3 → 8. Everything else about the RPC stays
-- the same: idempotent short-circuit when the user already owns
-- anything, atomic insert-select for the grant, pick first-earned as
-- the active slug when one isn't already set.
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

  if owned_count = 0 then
    -- Grant 8 random commons. Guarded against pool shrinkage below 8
    -- via ON CONFLICT; the LIMIT caps the draw to what the catalog
    -- actually holds so a small catalog grants everything available.
    insert into public.user_avatars (user_id, slug, earned_reason)
    select uid, c.slug, 'starter'
    from public.avatar_catalog c
    where c.rarity = 'common' and c.unlock_rule ->> 'kind' = 'starter'
    order by random()
    limit 8
    on conflict (user_id, slug) do nothing;
  end if;

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

-- Top-up existing users who signed up under the 3-starter version of
-- the RPC. Without this they'd be stuck at 3 unless we manually
-- reseeded, because the grant short-circuits on any existing
-- ownership. Skips untouched accounts (ownership count = 0) and
-- already-full accounts (>= 8). Idempotent via ON CONFLICT.
do $$
declare
  u record;
  have integer;
begin
  for u in select id from public.profiles loop
    select count(*) into have from public.user_avatars where user_id = u.id;
    if have between 1 and 7 then
      insert into public.user_avatars (user_id, slug, earned_reason)
      select u.id, c.slug, 'starter'
      from public.avatar_catalog c
      where c.rarity = 'common'
        and c.unlock_rule ->> 'kind' = 'starter'
        and c.slug not in (select slug from public.user_avatars where user_id = u.id)
      order by random()
      limit (8 - have)
      on conflict (user_id, slug) do nothing;
    end if;
  end loop;
end $$;
