-- 0103_profiles_level_trigger.sql
--
-- Keeps profiles.level in sync with profiles.total_xp. Whenever
-- total_xp changes, recompute the level via level_from_xp() and
-- update profiles.level. If the recomputed level is HIGHER than
-- the stored one, it's a level-up — fire a self-ping notification
-- that the client's realtime sub can lift into the celebration
-- ceremony (Phase 4a client work).
--
-- Only fires when total_xp actually moved (is distinct from guard)
-- so no-op updates (e.g., bumping nutrition_targets) don't
-- gratuitously re-run the curve math.
--
-- level is allowed to DECREASE on the rare occasions total_xp
-- decreases (streak_revival fee). No notification on decreases —
-- we don't rub anyone's nose in a revival debit.
--
-- See docs/plans/xp-leveling.md §2 (Level curve).

create or replace function public.profiles_level_recompute_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_level int;
begin
  if new.total_xp is not distinct from old.total_xp then
    return new;
  end if;

  v_new_level := public.level_from_xp(new.total_xp);
  if v_new_level = new.level then
    return new;  -- no boundary crossed
  end if;

  new.level := v_new_level;

  -- Self-ping notification on level-UP only. Notifications schema
  -- already in 0010; the client's realtime sub will pick this up
  -- and the ceremony modal in Phase 4a client work keys off it.
  if v_new_level > coalesce(old.level, 1) then
    begin
      insert into public.notifications (
        user_id, actor_id, msg, emoji, kind, target_kind, target_id
      ) values (
        new.id,
        new.id,
        'Level up — you just hit L' || v_new_level,
        '🎉',
        'success',
        'user_profile',
        new.id
      );
    exception when others then
      -- Notification failure shouldn't block the level update.
      raise warning 'profiles_level_recompute_fn: notification insert failed: %', sqlerrm;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_level_recompute on public.profiles;
create trigger profiles_level_recompute
  before update of total_xp on public.profiles
  for each row execute function public.profiles_level_recompute_fn();

-- One-shot reconcile so existing users land on the correct level
-- immediately (instead of waiting for their next XP event).
update public.profiles
   set level = public.level_from_xp(total_xp)
 where level is distinct from public.level_from_xp(total_xp);
