-- 0094_badge_earn_trigger.sql
--
-- Fires award_xp(source='badge_earn') on every user_badges INSERT,
-- with the base XP override pulled from xp_badge_tier_xp keyed by
-- the earned badge's tier. Seeded in 0076: common/uncommon/rare/
-- legendary (target names) and standard/bronze/silver/gold (legacy)
-- both map to +50 / +100 / +250 / +500.
--
-- XP goes to new.user_id (the earner). Bypasses daily caps because
-- source='badge_earn' isn't in the onboarding family — we want to
-- reconsider this only if badge-farming becomes a problem.
-- Actually: badges are one-per-user-per-badge by the (user_id,
-- badge_id) PK, and there's no way to earn one twice, so farming is
-- structurally blocked. Leaving the normal daily-cap behavior in
-- place — a user earning multiple badges in one day can still hit
-- the soft-cap haircut on the later ones, which feels fine.
--
-- See docs/plans/xp-leveling.md §1 (Badges).

create or replace function public.xp_badge_earn_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tier       text;
  v_base       int;
begin
  select tier into v_tier
  from public.badges
  where id = new.badge_id;

  if v_tier is null then
    return new;
  end if;

  select xp_reward into v_base
  from public.xp_badge_tier_xp
  where tier = v_tier;

  if v_base is null then
    raise warning 'xp_badge_earn_fn: no xp_badge_tier_xp row for tier %', v_tier;
    return new;
  end if;

  perform public.award_xp(
    p_user_id       := new.user_id,
    p_source        := 'badge_earn',
    p_ref_table     := 'user_badges',
    p_ref_id        := null,       -- user_badges has composite PK, no single uuid
    p_base_override := v_base
  );
  return new;
exception when others then
  raise warning 'xp_badge_earn_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists user_badges_xp_earn on public.user_badges;
create trigger user_badges_xp_earn
  after insert on public.user_badges
  for each row execute function public.xp_badge_earn_fn();
