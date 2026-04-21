-- 0110_user_gate_prereq_state.sql
--
-- user_gate_prereq_state(p_user_id, p_gate_level) — returns the
-- per-prereq status jsonb that the gate UI renders as progress bars
-- and the server uses to decide whether to advance user_gate_progress
-- from 'pending' to 'prereqs_met'.
--
-- Return shape:
--   {
--     "gate_level": 20,
--     "all_met": false,
--     "rules": [
--       { "kind":"skill_courses_completed", "ok":true,  "have":3, "need":1, "label":"..." },
--       { "kind":"recipe_categories_covered", "ok":false, "have":["breakfast","dinner"], "need":["breakfast","lunch","dinner"], "label":"..." },
--       ...
--     ]
--   }
--
-- Evaluates every rule in xp_level_gates.prereqs. Rule kinds live
-- in 0107's migration comment. Each kind is a tight CASE branch —
-- adding a new kind = one branch here + a row shape in the client.
--
-- `all_skills_maxed` relies on a hardcoded list of the 7 canonical
-- skills (knife, heat, egg, sauce, dough, seasoning, timing) —
-- mirrors src/data/index.js:53-61. If SKILL_TREE grows, update
-- both places.
--
-- `curated_collections_mastered` uses curated_recipes.collection
-- — which is null on existing seeded rows until the collection
-- concept lands (§7 open #4). Until then this rule returns
-- have=0, ok=false, which correctly keeps L50+ gates closed.
--
-- SECURITY DEFINER so it can read across tables the caller might
-- not have direct RLS grants on (xp_level_gates, curated_recipes).
-- Callers are scoped to their own user_id via an auth.uid() guard.
--
-- See docs/plans/xp-leveling.md §2 (gate prerequisites).

create or replace function public.user_gate_prereq_state(
  p_user_id    uuid,
  p_gate_level int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate        public.xp_level_gates%rowtype;
  v_rule        jsonb;
  v_kind        text;
  v_ok          boolean;
  v_have        jsonb;
  v_need        jsonb;
  v_label       text;
  v_results     jsonb := '[]'::jsonb;
  v_all_met     boolean := true;
  v_profile     public.profiles%rowtype;
  -- rule-local scratch
  v_skill_ct    int;
  v_cats        text[];
  v_have_cats   text[];
  v_diners_max  int;
  v_cuisine_ct  int;
  v_curated_tot int;
  v_coll_ct     int;
  v_need_int    int;
  v_need_txt    text;
  v_all_skills  constant text[] := array[
    'knife','heat','egg','sauce','dough','seasoning','timing'
  ];
begin
  -- AuthZ: caller must be the target or a privileged context.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'user_gate_prereq_state: caller mismatch';
  end if;

  select * into v_gate from public.xp_level_gates where gate_level = p_gate_level;
  if not found then
    return jsonb_build_object('error', 'unknown_gate', 'gate_level', p_gate_level);
  end if;

  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'no_profile');
  end if;

  for v_rule in select * from jsonb_array_elements(v_gate.prereqs)
  loop
    v_kind  := v_rule ->> 'kind';
    v_ok    := false;
    v_have  := null;
    v_need  := null;
    v_label := null;

    case v_kind

      when 'skill_courses_completed' then
        v_need_int := coalesce((v_rule ->> 'count')::int, 1);
        v_skill_ct := (
          select coalesce(count(*), 0)
          from jsonb_each_text(coalesce(v_profile.skill_levels, '{}'::jsonb)) as s(k, v)
          where v::int >= coalesce((v_rule ->> 'min_level')::int, 5)
        );
        v_ok := v_skill_ct >= v_need_int;
        v_have := to_jsonb(v_skill_ct);
        v_need := to_jsonb(v_need_int);
        v_label := 'Skill courses at tier';

      when 'recipe_categories_covered' then
        v_cats := array(select jsonb_array_elements_text(v_rule -> 'categories'));
        v_have_cats := (
          select coalesce(array_agg(distinct recipe_category), array[]::text[])
          from public.cook_logs
          where user_id = p_user_id
            and recipe_category = any(v_cats)
        );
        v_ok := coalesce(array_length(v_have_cats, 1), 0) = array_length(v_cats, 1);
        v_have := to_jsonb(v_have_cats);
        v_need := to_jsonb(v_cats);
        v_label := 'Breakfast / lunch / dinner coverage';

      when 'streak_count_min' then
        v_need_int := coalesce((v_rule ->> 'days')::int, 1);
        v_ok := coalesce(v_profile.streak_count, 0) >= v_need_int;
        v_have := to_jsonb(coalesce(v_profile.streak_count, 0));
        v_need := to_jsonb(v_need_int);
        v_label := 'Active streak days';

      when 'host_meal_with_diners' then
        v_need_int := coalesce((v_rule ->> 'min_diners')::int, 2);
        select coalesce(max(coalesce(array_length(diners, 1), 0)), 0) into v_diners_max
        from public.cook_logs
        where user_id = p_user_id;
        v_ok := v_diners_max >= v_need_int;
        v_have := to_jsonb(v_diners_max);
        v_need := to_jsonb(v_need_int);
        v_label := 'Host a meal with diners';

      when 'curated_lessons_per_cuisine' then
        v_need_int := coalesce((v_rule ->> 'cuisine_count')::int, 1);
        select coalesce(count(*), 0) into v_cuisine_ct
        from public.user_curated_lessons
        where user_id = p_user_id
          and lesson_count >= coalesce((v_rule ->> 'lessons_per_cuisine')::int, 1);
        v_ok := v_cuisine_ct >= v_need_int;
        v_have := to_jsonb(v_cuisine_ct);
        v_need := to_jsonb(v_need_int);
        v_label := 'Cuisines at ladder tier';

      when 'curated_cooks_total' then
        v_need_int := coalesce((v_rule ->> 'count')::int, 1);
        select coalesce(sum(lesson_count), 0)::int into v_curated_tot
        from public.user_curated_lessons
        where user_id = p_user_id;
        v_ok := v_curated_tot >= v_need_int;
        v_have := to_jsonb(v_curated_tot);
        v_need := to_jsonb(v_need_int);
        v_label := 'Total curated cooks';

      when 'curated_collections_mastered' then
        v_need_int := coalesce((v_rule ->> 'count')::int, 1);
        -- Count collections where the user has cooked every slug in that
        -- collection at least once. Empty when the collection concept
        -- hasn't been populated yet (§7 open #4) — falls through to ok=false.
        with colls as (
          select collection,
                 count(*) filter (where true) as needed_slugs,
                 count(*) filter (where exists (
                   select 1 from public.cook_logs cl
                   where cl.user_id = p_user_id and cl.recipe_slug = cr.slug
                 )) as user_cooked_slugs
          from public.curated_recipes cr
          where cr.collection is not null
          group by collection
        )
        select coalesce(count(*), 0)::int into v_coll_ct
        from colls
        where user_cooked_slugs >= needed_slugs;
        v_ok := v_coll_ct >= v_need_int;
        v_have := to_jsonb(v_coll_ct);
        v_need := to_jsonb(v_need_int);
        v_label := 'Curated collections mastered';

      when 'all_skills_maxed' then
        v_skill_ct := (
          select coalesce(count(*), 0)
          from unnest(v_all_skills) as s(skill_id)
          where coalesce((coalesce(v_profile.skill_levels, '{}'::jsonb) ->> skill_id)::int, 0) >= 5
        );
        v_ok := v_skill_ct = array_length(v_all_skills, 1);
        v_have := to_jsonb(v_skill_ct);
        v_need := to_jsonb(array_length(v_all_skills, 1));
        v_label := 'All skills maxed';

      else
        v_label := 'Unknown rule kind: ' || v_kind;
    end case;

    if not v_ok then
      v_all_met := false;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'kind',  v_kind,
        'ok',    v_ok,
        'have',  v_have,
        'need',  v_need,
        'label', v_label
      )
    );
  end loop;

  return jsonb_build_object(
    'gate_level', p_gate_level,
    'all_met',    v_all_met,
    'rules',      v_results
  );
end;
$$;

grant execute on function public.user_gate_prereq_state(uuid, int) to authenticated;
