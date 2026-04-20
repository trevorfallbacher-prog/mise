-- 0078_xp_config_audit.sql
--
-- Immutable audit log for every mutation to the xp_config* family of
-- tables (xp_config, xp_source_values, xp_streak_tiers,
-- xp_curated_ladder, xp_rarity_rolls, xp_badge_tier_xp,
-- xp_level_titles). The guiding principle from §6: "Tweaking a value
-- = one UPDATE — no migration, no redeploy. All edits are audited."
--
-- A single trigger function logs the old/new row as jsonb plus the
-- acting user. We attach it to every config table here; future config
-- tables must add the same trigger in their own migration.
--
-- Writes to the audit log itself are blocked — only the trigger can
-- insert, and the table has no UPDATE/DELETE policy. This makes the
-- log tamper-evident without needing storage-layer guarantees.
--
-- See docs/plans/xp-leveling.md §6.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.xp_config_audit (
  id            bigserial   primary key,
  table_name    text        not null,
  row_pk        text        not null,
  op            text        not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  old_row       jsonb,
  new_row       jsonb,
  actor         uuid        references auth.users(id),
  at            timestamptz not null default now()
);

create index if not exists xp_config_audit_table_idx
  on public.xp_config_audit (table_name, at desc);

create index if not exists xp_config_audit_actor_idx
  on public.xp_config_audit (actor, at desc);

-- ── 2. Row-level security ───────────────────────────────────────────
-- Readable by authenticated users (transparency). No write policy —
-- only the SECURITY DEFINER trigger below can insert.

alter table public.xp_config_audit enable row level security;

drop policy if exists "xp_config_audit: read-all-authenticated" on public.xp_config_audit;
create policy "xp_config_audit: read-all-authenticated"
  on public.xp_config_audit for select
  to authenticated
  using (true);

-- ── 3. Trigger function ─────────────────────────────────────────────
-- Pulls the primary-key value as text so the log stays consistent
-- across tables with different PK types (text, int, smallint).

create or replace function public.xp_config_audit_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row_pk text;
  v_actor  uuid;
begin
  v_actor := auth.uid();

  if tg_op = 'DELETE' then
    v_row_pk := coalesce(
      old.key::text,
      (to_jsonb(old) ->> (tg_argv[0]))
    );
    insert into public.xp_config_audit (table_name, row_pk, op, old_row, new_row, actor)
    values (tg_table_name, v_row_pk, 'DELETE', to_jsonb(old), null, v_actor);
    return old;
  end if;

  v_row_pk := coalesce(
    (to_jsonb(new) ->> 'key'),
    (to_jsonb(new) ->> (tg_argv[0]))
  );

  if tg_op = 'INSERT' then
    insert into public.xp_config_audit (table_name, row_pk, op, old_row, new_row, actor)
    values (tg_table_name, v_row_pk, 'INSERT', null, to_jsonb(new), v_actor);
  else
    insert into public.xp_config_audit (table_name, row_pk, op, old_row, new_row, actor)
    values (tg_table_name, v_row_pk, 'UPDATE', to_jsonb(old), to_jsonb(new), v_actor);
  end if;

  return new;
end;
$$;

-- ── 4. Attach trigger to every xp_config* table ─────────────────────
-- tg_argv[0] is the primary-key column name (used when the row doesn't
-- have a `key` column).

drop trigger if exists xp_config_audit_trg on public.xp_config;
create trigger xp_config_audit_trg
  after insert or update or delete on public.xp_config
  for each row execute function public.xp_config_audit_fn('key');

drop trigger if exists xp_source_values_audit_trg on public.xp_source_values;
create trigger xp_source_values_audit_trg
  after insert or update or delete on public.xp_source_values
  for each row execute function public.xp_config_audit_fn('source');

drop trigger if exists xp_streak_tiers_audit_trg on public.xp_streak_tiers;
create trigger xp_streak_tiers_audit_trg
  after insert or update or delete on public.xp_streak_tiers
  for each row execute function public.xp_config_audit_fn('tier_idx');

drop trigger if exists xp_curated_ladder_audit_trg on public.xp_curated_ladder;
create trigger xp_curated_ladder_audit_trg
  after insert or update or delete on public.xp_curated_ladder
  for each row execute function public.xp_config_audit_fn('min_lessons_in_cuisine');

drop trigger if exists xp_rarity_rolls_audit_trg on public.xp_rarity_rolls;
create trigger xp_rarity_rolls_audit_trg
  after insert or update or delete on public.xp_rarity_rolls
  for each row execute function public.xp_config_audit_fn('rarity');

drop trigger if exists xp_badge_tier_xp_audit_trg on public.xp_badge_tier_xp;
create trigger xp_badge_tier_xp_audit_trg
  after insert or update or delete on public.xp_badge_tier_xp
  for each row execute function public.xp_config_audit_fn('tier');

drop trigger if exists xp_level_titles_audit_trg on public.xp_level_titles;
create trigger xp_level_titles_audit_trg
  after insert or update or delete on public.xp_level_titles
  for each row execute function public.xp_config_audit_fn('min_level');
