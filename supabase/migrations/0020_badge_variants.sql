-- mise — badge variants: 1/1 scarcity, hidden reveals, earn flavor text
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- The v1 badges system (0019) handed every qualified cook the same
-- badge for a recipe. This migration adds three axes so the wall can
-- carry genuine character:
--
--   * max_awards   — integer cap on how many of a badge can exist in
--                    the whole app. NULL = unlimited (the default);
--                    1 makes a badge a true 1/1 that belongs to the
--                    first eligible earner forever. 25 would make a
--                    "top 25 founders" style badge if we ever want it.
--
--   * is_hidden    — when true, the locked silhouette is suppressed
--                    on everyone's wall. Once earned it always shows
--                    — the reveal itself is the surprise. Great for
--                    easter-egg badges like "First to ever cook X".
--
--   * priority     — ordering knob when multiple badges match the
--                    same recipe. The trigger tries badges in
--                    priority DESC order, so a scarcer, higher-
--                    priority badge is attempted first; if that slot
--                    is full the trigger falls through to the
--                    standard badge for the recipe.
--
--   * earn_reason  — per-earn flavor text stored on user_badges,
--                    rendered in the BadgeDetail modal. The trigger
--                    writes a reason tailored to the badge variant
--                    (e.g. "First person EVER to make Cacio e Pepe —
--                    a 1/1 badge, permanently minted").
--
-- Race notes:
--   The first-eligible-earner check for a 1/1 is "count(user_badges)
--   < max_awards" at trigger time. Under extreme concurrent INSERTs
--   two earners could each see count=0 and both win the slot. For a
--   family-pilot tier app that's accepted and recoverable. If we ever
--   need strict one-winner semantics, wrap the award in
--   pg_advisory_xact_lock(hashtext(badge_slug)) so awards serialize.

alter table public.badges
  add column if not exists max_awards  integer,
  add column if not exists is_hidden   boolean not null default false,
  add column if not exists priority    integer not null default 0;

alter table public.user_badges
  add column if not exists earn_reason text;


-- ── seed: the 1/1 Cacio e Pepe first-ever badge ─────────────────────────────
-- Priority 100 so the trigger tries it before the standard badge for the
-- same recipe. max_awards=1 means it's globally unique. Hidden so nobody
-- sees a grey silhouette waiting for them — it just appears on the
-- earner's wall as a surprise the first time.
insert into public.badges
  (slug, name, description, icon_path, recipe_slug, earn_rule, tier, color,
   max_awards, is_hidden, priority)
values (
  'cacio-e-pepe-first-ever',
  'Cacio e Pepe — Founder',
  'The very first cook to nail Cacio e Pepe in mise. A 1/1 badge — this one will never be minted again.',
  '/badges/cacio-e-pepe.svg',
  'cacio-e-pepe',
  'Be the first person in mise to cook Cacio e Pepe at a good rating or better.',
  'gold',
  '#f5c842',
  1,     -- max_awards: only ONE of these will ever exist
  true,  -- is_hidden: no silhouette on anyone''s wall until it''s earned
  100    -- priority: try this before the standard cacio-e-pepe badge
)
on conflict (slug) do update set
  name        = excluded.name,
  description = excluded.description,
  icon_path   = excluded.icon_path,
  recipe_slug = excluded.recipe_slug,
  earn_rule   = excluded.earn_rule,
  tier        = excluded.tier,
  color       = excluded.color,
  max_awards  = excluded.max_awards,
  is_hidden   = excluded.is_hidden,
  priority    = excluded.priority;

-- Nudge the standard cacio-e-pepe badge's language so its description
-- implicitly acknowledges the founder: everyone else still feels good
-- about their earn without the 1/1 feeling robbed.
update public.badges
   set description = 'The three-ingredient emulsion, earned. Someone else got to it first — the 1/1 Founder badge is already minted — but this one''s yours.'
 where slug = 'cacio-e-pepe';


-- ── redefined award trigger ────────────────────────────────────────────────
-- Walks the candidate badges for the cooked recipe in priority DESC,
-- max_awards ASC NULLS LAST order — most prestigious first. Awards the
-- first one the user qualifies for (doesn't already hold, has capacity
-- remaining). Captures an earn_reason tailored to the variant on insert.
create or replace function public.award_badge_on_cook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cand         public.badges%rowtype;
  awarded      public.badges%rowtype;
  already      boolean;
  awarded_cnt  integer;
  reason       text;
  actor_name   text;
  recipient    uuid;
begin
  if new.rating not in ('good','nailed') then
    return new;
  end if;

  -- Walk candidates most-prestigious first. A user who already holds a
  -- badge for this recipe won't collect another one (we pick the single
  -- best they qualify for and stop).
  for cand in
    select * from public.badges
     where recipe_slug = new.recipe_slug
     order by priority desc, max_awards asc nulls last
  loop
    select exists(
      select 1 from public.user_badges
       where user_id = new.user_id and badge_id = cand.id
    ) into already;
    if already then
      -- Already holds this variant — they won't re-earn it, and we
      -- shouldn't downgrade them to a less prestigious variant either.
      return new;
    end if;

    -- Capacity check for scarce badges. Racy under concurrency but the
    -- risk is limited to the handful of rows around the cap.
    if cand.max_awards is not null then
      select count(*) into awarded_cnt from public.user_badges where badge_id = cand.id;
      if awarded_cnt >= cand.max_awards then
        continue; -- slot full, try the next variant
      end if;
    end if;

    awarded := cand;
    exit;  -- take the first variant that passes
  end loop;

  if awarded.id is null then
    return new;  -- nothing to award
  end if;

  -- Compose an earn_reason that reflects the specific variant. Keeps
  -- flavor in the DB alongside the award so the UI doesn't have to
  -- re-derive the reason from badge slug patterns.
  if awarded.max_awards = 1 then
    reason := 'First person EVER to make ' || awarded.name
           || ' — a 1/1 badge, permanently minted.';
  elsif awarded.max_awards is not null then
    reason := 'One of the first ' || awarded.max_awards
           || ' to earn ' || awarded.name || '.';
  else
    reason := 'Cooked ' || coalesce(new.recipe_title, awarded.name)
           || ' and ' || (case when new.rating = 'nailed' then 'nailed it' else 'delivered' end) || '.';
  end if;

  insert into public.user_badges (user_id, badge_id, cook_log_id, earn_reason)
    values (new.user_id, awarded.id, new.id, reason)
    on conflict (user_id, badge_id) do nothing;

  -- Self-ping.
  insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
    values (
      new.user_id,
      new.user_id,
      case
        when awarded.max_awards = 1
          then 'You earned the ' || awarded.name || ' 🥇 — a 1/1 badge, permanently yours'
        else 'You earned the ' || awarded.name || ' badge — tap to see your wall'
      end,
      '🏅',
      'success',
      'user_profile',
      new.user_id
    );

  -- Family fan-out. Rare-badge earns get amplified copy so the family
  -- notices a big moment rather than a routine ping.
  actor_name := coalesce(public.actor_first_name(new.user_id), 'Someone');
  for recipient in select public.family_ids_of(new.user_id) loop
    if recipient is null or recipient = new.user_id then
      continue;
    end if;
    insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
      values (
        recipient,
        new.user_id,
        case
          when awarded.max_awards = 1
            then actor_name || ' just minted the ' || awarded.name || ' 🥇 — a 1/1 that will never exist again'
          else actor_name || ' just earned the ' || awarded.name || ' badge 🏅'
        end,
        '🏅',
        'success',
        'user_profile',
        new.user_id
      );
  end loop;

  return new;
end;
$$;
