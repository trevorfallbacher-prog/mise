-- 0056_canonical_identity_refactor.sql
--
-- Retire the "ingredient" vocabulary overload from the domain.
--
-- Pre-this-migration, pantry_items carried three columns that sometimes
-- held the same value and sometimes didn't:
--
--   * ingredient_id   (singular) — historically the "primary tag"
--   * ingredient_ids  (plural, 0033) — multi-tag composition array
--   * canonical_id    (0039) — identity axis
--
-- Every downstream surface read these differently, producing subtle
-- inconsistencies: the hub grouper missed user-created canonicals,
-- the enrichment button hid for rows with empty {_meta} stubs, and
-- package chips silently never rendered.
--
-- This migration collapses the vocabulary:
--
--   CANONICAL (canonical_id) — single identity source. Every pantry
--                              item carries one. Always non-null after
--                              this migration's backfill.
--   COMPONENTS (renamed from ingredient_ids) — composition array.
--                              Array of canonical IDs. A pasta row
--                              has components=['penne']; a burrito
--                              has components=['tortilla','beans',…].
--   INGREDIENT_ID (singular) — deprecated. Stays in the schema for
--                              back-compat with older clients; drop
--                              in a follow-up.
--
-- Also normalizes ingredient_info: every row whose info carries only
-- the _meta provenance block (admin auto-approve artifacts) gets
-- _meta.stub=true so the new isMeaningfullyEnriched() helper treats
-- them as "not yet enriched" rather than "fully approved."

-- ── 1. rename ingredient_ids → components ─────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pantry_items'
      and column_name = 'ingredient_ids'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pantry_items'
      and column_name = 'components'
  ) then
    alter table public.pantry_items rename column ingredient_ids to components;
  end if;
end $$;

-- ── 2. backfill canonical_id from ingredient_id where missing ──────
-- Rows that pre-date migration 0039 have ingredient_id but null
-- canonical_id. Bring identity up to date so every row has a
-- canonical to group / render / enrich against.
update public.pantry_items
   set canonical_id = ingredient_id
 where canonical_id is null
   and ingredient_id is not null;

-- ── 3. backfill components from canonical_id where empty ───────────
-- Single-ingredient items (the overwhelming common case) should have
-- components = [canonical_id]. Composed items that the user has
-- explicitly tagged (burritos, pizzas) already have non-empty
-- components and are skipped by the guard below.
update public.pantry_items
   set components = array[canonical_id]
 where canonical_id is not null
   and (components is null or array_length(components, 1) is null);

-- ── 4. flag _meta-only ingredient_info rows as stubs ───────────────
-- A row whose info JSONB carries ONLY the _meta provenance key is a
-- ghost approval — admin auto-approve claimed the canonical id but
-- no enrichment data lives there. Mark it so the client-side
-- isMeaningfullyEnriched() downgrades it to "stub" and surfaces
-- the enrichment button.
update public.ingredient_info
   set info = jsonb_set(coalesce(info, '{}'::jsonb), '{_meta,stub}',
                        'true'::jsonb, true)
 where info is not null
   and (
     select count(*)
     from jsonb_object_keys(info) as k
     where k <> '_meta'
   ) = 0;

-- ── 5. schema cache reload ─────────────────────────────────────────
notify pgrst, 'reload schema';
