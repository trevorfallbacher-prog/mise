-- 0141_canonical_type_votes.sql
--
-- Crowd-vote tally for canonical → type_id corrections.
--
-- src/lib/canonicalCorrections.js writes a per-user pending row
-- whenever a non-admin picks a category for a canonical (one row per
-- (user_id, canonical_slug), enforced by pending_ingredient_info's
-- unique constraint from migration 0047). One user → one vote per
-- canonical, naturally.
--
-- This file exposes a SECURITY DEFINER function that aggregates those
-- per-user votes across the whole user base, so a non-admin caller
-- can ask "what does the crowd think the type is for canonical X?"
-- without RLS scoping the count down to their own row.
--
-- Why a function and not a view: pending_ingredient_info has RLS
-- enabled (migration 0047), and views inherit RLS by default. A
-- non-admin SELECTing from a view that aggregates the table would
-- only see their own rows in the aggregate. SECURITY DEFINER on a
-- function lets us deliberately escalate to count across users
-- without exposing the underlying rows themselves — only counts
-- leak out, no per-user data.
--
-- Threshold + tiebreak live client-side (canonicalCorrections.js)
-- so we can tune them without a migration.
--
-- Safe to re-run.

-- ── 1. aggregate function ──────────────────────────────────────────
create or replace function public.canonical_type_vote_tally(
  p_canonical_id text
)
returns table (type_id text, vote_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    info ->> 'type_id'  as type_id,
    count(*)            as vote_count
  from public.pending_ingredient_info
  where slug = p_canonical_id
    and info ? 'type_id'
    and (info ->> 'type_id') is not null
    and (info ->> 'type_id') <> ''
  group by info ->> 'type_id'
  order by vote_count desc, info ->> 'type_id' asc;
$$;

-- ── 2. grant execute ───────────────────────────────────────────────
-- Anyone who can authenticate (or even browse anonymously) can ask
-- the question. The function only returns aggregate counts —
-- (type_id, vote_count) tuples — so there's no per-user data leak.
grant execute on function public.canonical_type_vote_tally(text)
  to anon, authenticated;

-- ── 3. schema cache reload ─────────────────────────────────────────
notify pgrst, 'reload schema';
