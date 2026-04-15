-- mise — rename the Founder badge + backfill the first-ever award
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- Two things happen here:
--
--   1. The "Cacio e Pepe — Founder" badge gets its proper name.
--      It's now "The Smitty WerbenJagerManJensen" with the short,
--      immortal description "She Was #1!" and its own dedicated
--      SVG (the one dropped into public/badges/). The slug
--      (cacio-e-pepe-first-ever) stays identical so no trigger or
--      FK referencing it needs to change.
--
--   2. A retroactive award: the badge was introduced after the first
--      Cacio e Pepe cook had already happened, so the trigger never
--      fired. This block finds the earliest cook_log for cacio-e-pepe
--      with rating in ('good','nailed'), awards the Founder badge to
--      that user with a matching earn_reason, and fires the self +
--      family-fan-out notifications so she sees it land in her inbox
--      exactly as she would have on the original cook.
--
-- The backfill is guarded by ON CONFLICT DO NOTHING so re-running the
-- migration is a no-op once the badge is minted.

-- ── rename + re-skin ────────────────────────────────────────────────────────
-- The icon_path contains a space — browsers URL-encode on fetch, so
-- "/badges/Smitty WerbenJagerManJensen.svg" hits
-- "/badges/Smitty%20WerbenJagerManJensen.svg" at the static server and
-- resolves. If the filename ever gets renamed to kebab-case on disk,
-- bump this path in a follow-up migration.
update public.badges
   set name        = 'The Smitty WerbenJagerManJensen',
       description = 'She Was #1!',
       icon_path   = '/badges/Smitty WerbenJagerManJensen.svg'
 where slug = 'cacio-e-pepe-first-ever';


-- ── backfill: mint the 1/1 to whoever cooked Cacio e Pepe first ─────────────
do $$
declare
  first_cook   record;
  badge_row    public.badges%rowtype;
  actor_name   text;
  recipient    uuid;
  reason       text;
begin
  select * into badge_row
    from public.badges
   where slug = 'cacio-e-pepe-first-ever';
  if not found then
    return;
  end if;

  -- If the slot's already filled (someone cooked through the live
  -- trigger since 0020 landed, or this migration ran before), skip.
  if exists (select 1 from public.user_badges where badge_id = badge_row.id) then
    return;
  end if;

  -- Find the earliest eligible cook. Order by cooked_at (when the user
  -- said they cooked it) so a late-logged historical cook can still
  -- win the 1/1 — first to cook, not first to log.
  select cl.user_id, cl.id as cook_log_id, cl.cooked_at, cl.recipe_title
    into first_cook
    from public.cook_logs cl
   where cl.recipe_slug = 'cacio-e-pepe'
     and cl.rating in ('good', 'nailed')
   order by cl.cooked_at asc
   limit 1;

  if not found then
    -- Nobody's cooked it yet — leave the slot empty. The live trigger
    -- from 0020 will award it the first time someone actually does.
    return;
  end if;

  reason := 'She Was #1! — first person EVER to make Cacio e Pepe. '
         || 'A 1/1 badge, permanently minted.';

  insert into public.user_badges (user_id, badge_id, cook_log_id, earn_reason)
    values (first_cook.user_id, badge_row.id, first_cook.cook_log_id, reason)
    on conflict (user_id, badge_id) do nothing;

  -- Self-ping so the earner sees their shiny new inbox entry.
  insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
    values (
      first_cook.user_id,
      first_cook.user_id,
      'You earned The Smitty WerbenJagerManJensen 🥇 — a 1/1 for being first to cook Cacio e Pepe',
      '🏅',
      'success',
      'user_profile',
      first_cook.user_id
    );

  -- Family fan-out — everyone in her family sees the mint.
  actor_name := coalesce(public.actor_first_name(first_cook.user_id), 'Someone');
  for recipient in select public.family_ids_of(first_cook.user_id) loop
    if recipient is null or recipient = first_cook.user_id then
      continue;
    end if;
    insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
      values (
        recipient,
        first_cook.user_id,
        actor_name || ' just minted The Smitty WerbenJagerManJensen 🥇 — a 1/1 that will never exist again',
        '🏅',
        'success',
        'user_profile',
        first_cook.user_id
      );
  end loop;
end $$;
