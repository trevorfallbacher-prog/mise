-- mise — notification deep links
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- So far notifications have been purely informational — a line of text
-- with an emoji. This adds a (target_kind, target_id) pair so a row can
-- point at a specific thing the client knows how to open. The bell/toast
-- surfaces read it and turn the row into a tappable link.
--
-- target_kind is a short string so new kinds can be added in future
-- migrations without a new column. The initial vocabulary:
--   'cook_log'          — opens that cook's detail in Cookbook.
--                         When the viewer is a diner, the page lands on
--                         the review composer so "how'd it land?" leads
--                         straight into leaving a reaction.
--
-- Existing rows stay legal with NULL on both fields — the client simply
-- renders them as non-tappable, the old behavior.

alter table public.notifications
  add column if not exists target_kind text,
  add column if not exists target_id   uuid;

-- We don't add a FK on target_id because the vocabulary is open-ended
-- and a stale target is acceptable (the UI will just not open anything).
-- Index on the pair so future "find notifications pointing at X" reads
-- aren't a full scan.
create index if not exists notifications_target_idx
  on public.notifications (target_kind, target_id);


-- ── redefine notify_diners_cook_log to populate the deep-link ───────────────
-- Copy-forward of the function from 0013 with two changes:
--   1. message softened into an invite — "how'd it land?" so the tap has a
--      clear call to action
--   2. target_kind / target_id populated so the tap navigates
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
    msg   := actor_name || ' cooked ' || coalesce(new.recipe_emoji,'') || ' ' || new.recipe_title || ' and nailed it — tap to tell them how it landed';
    emoji := '🤩';
    kind  := 'success';
  elsif new.rating = 'good' then
    msg   := actor_name || ' cooked ' || coalesce(new.recipe_emoji,'') || ' ' || new.recipe_title || ' — tap to leave a reaction';
    emoji := '😊';
    kind  := 'success';
  elsif new.rating = 'meh' then
    msg   := actor_name || ' cooked ' || coalesce(new.recipe_emoji,'') || ' ' || new.recipe_title || '. Tap and tell them how it actually went';
    emoji := '😐';
    kind  := 'info';
  else
    msg   := actor_name || ' wrestled with ' || coalesce(new.recipe_emoji,'') || ' ' || new.recipe_title || ' — tap to leave an honest note (or a 🥡)';
    emoji := '😬';
    kind  := 'warn';
  end if;

  foreach recipient in array new.diners loop
    if recipient is null or recipient = new.user_id then
      continue;
    end if;
    insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
      values (recipient, new.user_id, msg, emoji, kind, 'cook_log', new.id);
  end loop;

  return new;
end;
$$;


-- ── redefine notify_chef_of_review to populate the deep-link ────────────────
-- Same copy-forward treatment for the reverse direction: when a diner
-- posts a review the chef gets a pingable, tappable inbox row that lands
-- on the same cook's detail so they can see the thread.
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
    return new;
  end if;

  reviewer_name := coalesce(public.actor_first_name(new.reviewer_id), 'A guest');

  if new.rating = 'nailed' then
    msg   := reviewer_name || ' raved about your ' || coalesce(recipe_emoji,'') || ' ' || recipe_title || ' — tap to read their note';
    emoji := '🤩';
    kind  := 'success';
  elsif new.rating = 'good' then
    msg   := reviewer_name || ' really liked your ' || coalesce(recipe_emoji,'') || ' ' || recipe_title || ' — tap to read';
    emoji := '😊';
    kind  := 'success';
  elsif new.rating = 'meh' then
    msg   := reviewer_name || ' thought your ' || coalesce(recipe_emoji,'') || ' ' || recipe_title || ' was… fine. Tap to see what they said';
    emoji := '😐';
    kind  := 'info';
  else
    msg   := reviewer_name || ' left a rough review on your ' || coalesce(recipe_emoji,'') || ' ' || recipe_title || ' — tap for the post-mortem';
    emoji := '😬';
    kind  := 'warn';
  end if;

  insert into public.notifications (user_id, actor_id, msg, emoji, kind, target_kind, target_id)
    values (chef_id, new.reviewer_id, msg, emoji, kind, 'cook_log', new.cook_log_id);

  return new;
end;
$$;
