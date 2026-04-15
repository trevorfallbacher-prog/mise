-- mise — reassign The Smitty WerbenJagerManJensen to Marissa
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- The 0021 backfill picked the wrong user. It walks cook_logs ordered
-- by cooked_at asc — a test cook Trevor logged beat Marissa's real
-- first-ever cacio e pepe, so he ended up with the 1/1. The badge
-- needs to move to Marissa and the inbox needs to be scrubbed of the
-- mistaken notifications so nobody sees stale "Trevor just minted"
-- history.
--
-- Resolution order:
--   1. Look up Marissa by profile name (first-name match, must be
--      unique or we raise so we don't silently pick the wrong one).
--   2. Revoke every existing Smitty badge award — wipes Trevor's slot.
--   3. Delete every notification referencing a Smitty/Founder mint so
--      the inbox doesn't keep the wrong actor around.
--   4. Find Marissa's earliest qualifying cacio e pepe cook and mint
--      the badge to her with the right earn_reason.
--   5. Fire fresh self + family fan-out notifications so her inbox
--      lights up like it would have on a live award.

do $$
declare
  smitty_id   uuid;
  marissa_id  uuid;
  match_count integer;
  earliest    public.cook_logs%rowtype;
  actor_name  text;
  recipient   uuid;
begin
  select id into smitty_id from public.badges
   where slug = 'cacio-e-pepe-first-ever';
  if smitty_id is null then
    raise notice 'Smitty badge row not found — run 0019/0020/0021 first';
    return;
  end if;

  -- Name lookup. Case-insensitive first-name match; if it's ambiguous
  -- we'd rather fail loudly than assign the badge to the wrong person
  -- a second time.
  select count(*) into match_count
    from public.profiles
   where name ilike 'marissa%';

  if match_count = 0 then
    raise exception 'no profile matched "Marissa*" — check profiles.name'
      using errcode = 'P0001';
  end if;
  if match_count > 1 then
    raise exception 'multiple profiles matched "Marissa*" — edit this migration to target the correct user_id'
      using errcode = 'P0001';
  end if;

  select id into marissa_id from public.profiles
   where name ilike 'marissa%'
   limit 1;

  -- 1. Revoke every current holder of the Smitty badge. In the normal
  --    case that's just one row (Trevor). If the slot was somehow
  --    filled by a third party, they're cleared too — the badge is
  --    supposed to be Marissa's alone.
  delete from public.user_badges where badge_id = smitty_id;

  -- 2. Scrub every inbox of the wrong mint notifications. Pattern-
  --    match on the badge's unique phrasing so we don't sweep other
  --    badge notifications. Safe if there are none.
  delete from public.notifications
   where emoji = '🏅'
     and (msg ilike '%Smitty%' or msg ilike '%Founder%');

  -- 3. Pick Marissa's earliest qualifying cook.
  select * into earliest
    from public.cook_logs
   where user_id = marissa_id
     and recipe_slug = 'cacio-e-pepe'
     and rating in ('good','nailed')
   order by cooked_at asc
   limit 1;

  if earliest.id is null then
    raise exception 'Marissa has no good/nailed cacio-e-pepe cook yet — she needs to log one first'
      using errcode = 'P0001';
  end if;

  -- 4. Mint to Marissa with the real earn flavor.
  insert into public.user_badges (user_id, badge_id, cook_log_id, earn_reason)
    values (
      marissa_id, smitty_id, earliest.id,
      'She Was #1! — first person EVER to make Cacio e Pepe. '
      || 'A 1/1 badge, permanently minted.'
    );

  -- 5. Inbox pings — self + family fan-out.
  insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
    values (
      marissa_id, marissa_id,
      'You earned The Smitty WerbenJagerManJensen 🥇 — a 1/1 for being first to cook Cacio e Pepe',
      '🏅', 'success', 'user_profile', marissa_id
    );

  actor_name := coalesce(public.actor_first_name(marissa_id), 'Marissa');
  for recipient in select public.family_ids_of(marissa_id) loop
    if recipient is null or recipient = marissa_id then
      continue;
    end if;
    insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
      values (
        recipient, marissa_id,
        actor_name || ' just minted The Smitty WerbenJagerManJensen 🥇 — a 1/1 that will never exist again',
        '🏅', 'success', 'user_profile', marissa_id
      );
  end loop;
end $$;
