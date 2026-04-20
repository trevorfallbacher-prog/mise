-- 0112_gate_ranked_match_pass_trigger.sql
--
-- Ranked-match pass detection. A gate passes when the chef has
-- picked a gate recipe, cooked it, and every diner (including the
-- chef) has rated it 'nailed'. Any lower rating from anyone =
-- still gated, cook again.
--
-- Unanimous-nailed check details:
--   - Chef rating: cook_logs.rating == 'nailed'
--   - Diners: for each uid in cook_logs.diners[], there's a
--     cook_log_reviews row with reviewer_id=uid AND rating='nailed'.
--     If the chef is also in diners[] (ate their own cook), the
--     chef's own cook_logs.rating counts as their review — no
--     double-requirement.
--
-- This migration ships:
--   - check_gate_pass(p_cook_log_id) — helper that evaluates the
--     unanimous-nailed condition and flips user_gate_progress to
--     'passed' if met. Fires a self-ping notification on pass.
--   - Trigger on cook_log_reviews INSERT/UPDATE — the most common
--     "last nailed landed" event.
--   - Trigger on cook_logs UPDATE of rating — covers the edge case
--     where the chef rates AFTER all diners have already rated.
--
-- Idempotent: the helper skips work if no in_match row exists
-- matching the cook_log, and the 'passed' status transition is
-- guarded so re-fires don't re-notify.
--
-- On pass: the gate-check branch in award_xp (0111) will see the
-- passed row on the next earn and stop zeroing — normal earning
-- resumes from that point.
--
-- See docs/plans/xp-leveling.md §2 (ranked match).

create or replace function public.check_gate_pass(p_cook_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cook            public.cook_logs%rowtype;
  v_progress        public.user_gate_progress%rowtype;
  v_diners          uuid[];
  v_nailed_reviews  int;
  v_required_diners int;
  v_chef_is_diner   boolean;
begin
  select * into v_cook from public.cook_logs where id = p_cook_log_id;
  if not found then
    return;
  end if;

  -- Find an in_match row whose chosen cook is this one.
  select * into v_progress
  from public.user_gate_progress
  where user_id = v_cook.user_id
    and match_cook_log_id = p_cook_log_id
    and status in ('in_match', 'prereqs_met');
  if not found then
    return;
  end if;

  -- Chef must have rated nailed on their own cook_logs row.
  if v_cook.rating is distinct from 'nailed' then
    return;
  end if;

  v_diners := coalesce(v_cook.diners, array[]::uuid[]);
  -- Filter out the chef from diners (they already counted via rating).
  v_chef_is_diner := v_cook.user_id = any(v_diners);
  if v_chef_is_diner then
    v_diners := array(select d from unnest(v_diners) as d where d <> v_cook.user_id);
  end if;

  v_required_diners := coalesce(array_length(v_diners, 1), 0);

  if v_required_diners = 0 then
    -- Solo cook (or only the chef ate): chef's 'nailed' is enough.
    null;
  else
    select count(*)::int into v_nailed_reviews
    from public.cook_log_reviews
    where cook_log_id = p_cook_log_id
      and reviewer_id = any(v_diners)
      and rating = 'nailed';

    if v_nailed_reviews < v_required_diners then
      return;  -- not unanimous yet
    end if;
  end if;

  -- Unanimous. Flip to passed.
  update public.user_gate_progress
     set status     = 'passed',
         passed_at  = now()
   where user_id    = v_cook.user_id
     and gate_level = v_progress.gate_level
     and status     <> 'passed';

  -- Self-ping notification so the celebration modal has something
  -- to react to.
  begin
    insert into public.notifications (
      user_id, actor_id, msg, emoji, kind, target_kind, target_id
    ) values (
      v_cook.user_id,
      v_cook.user_id,
      'Gate passed — you unlocked the next tier',
      '🚪',
      'success',
      'user_profile',
      v_cook.user_id
    );
  exception when others then
    raise warning 'check_gate_pass: notification insert failed: %', sqlerrm;
  end;
end;
$$;

-- ── Triggers ───────────────────────────────────────────────────────

create or replace function public.check_gate_pass_on_review_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.rating <> 'nailed' then
    return new;  -- only nailed ratings can complete the condition
  end if;
  perform public.check_gate_pass(new.cook_log_id);
  return new;
exception when others then
  raise warning 'check_gate_pass_on_review_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists cook_log_reviews_gate_pass on public.cook_log_reviews;
create trigger cook_log_reviews_gate_pass
  after insert or update of rating on public.cook_log_reviews
  for each row execute function public.check_gate_pass_on_review_fn();

create or replace function public.check_gate_pass_on_cook_rating_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.rating <> 'nailed' then
    return new;
  end if;
  perform public.check_gate_pass(new.id);
  return new;
exception when others then
  raise warning 'check_gate_pass_on_cook_rating_fn: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists cook_logs_gate_pass on public.cook_logs;
create trigger cook_logs_gate_pass
  after insert or update of rating on public.cook_logs
  for each row execute function public.check_gate_pass_on_cook_rating_fn();
