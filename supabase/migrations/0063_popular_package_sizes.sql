-- Observation-based package-size recommendations.
--
-- Background: packaging sizes used to be admin-curated into
-- `ingredient_info.packaging.sizes` — the admin team manually typed
-- "8oz / 16oz / 1lb" for every canonical. That's unbounded data
-- entry (thousands of SKUs) and the admin queue was becoming the
-- bottleneck for every new user who scanned an unfamiliar package.
--
-- This migration replaces admin-curated packaging with a learning
-- loop, same shape as user_scan_corrections (migration 0046):
-- observe what real users declare as their package size on
-- pantry_items, aggregate across households, surface the top N as
-- chip suggestions the next user gets for free.
--
-- Key on (canonical_id, brand) because brands almost always ship in
-- the same sizes — Kerrygold Unsalted is 8oz whether you bought it
-- in SF or Austin; Barilla penne is 16oz. Brand-specific hits are
-- the strongest signal; canonical-only is the fallback when the
-- scan didn't resolve a brand.
--
-- Security: `pantry_items` is family-RLS'd (users only see their
-- own family's rows). A cross-household aggregate needs
-- SECURITY DEFINER to bypass RLS, but we only RETURN the aggregates
-- (amount, unit, brand, count) — no row-level data leaves the
-- function. No user ids, no pantry contents, no PII. Safe to expose
-- to every authenticated user since the output is equivalent to a
-- published histogram.
--
-- The function is SQL (not plpgsql) so Postgres can inline it into
-- the client's call as a simple SELECT — no planning overhead per
-- invocation. Limit capped at 20 to prevent a rogue client from
-- pulling the full histogram.

create or replace function public.popular_package_sizes(
  p_brand     text default null,
  p_canonical text default null,
  p_limit     int  default 5
)
returns table (
  amount  numeric,
  unit    text,
  brand   text,
  n       bigint
)
language sql
security definer
set search_path = public
as $$
  select
    max::numeric  as amount,
    unit,
    brand,
    count(*)      as n
  from public.pantry_items
  where max > 0
    and unit is not null
    and unit <> ''
    and (p_canonical is null or canonical_id = p_canonical)
    -- Brand filter semantics: null input = match any brand
    -- (canonical-wide rollup). Non-null input = only rows with that
    -- exact brand (brand-specific rollup). `is not distinct from`
    -- treats brand=null as a real value so "no-brand" buckets don't
    -- silently merge into the brand-filtered query.
    and (p_brand is null or brand is not distinct from p_brand)
  group by max, unit, brand
  order by count(*) desc, max asc
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

-- Every authenticated user can call this. Anonymous / unauthenticated
-- sessions don't need package recommendations (they can't write to
-- pantry_items anyway).
grant execute on function public.popular_package_sizes(text, text, int)
  to authenticated;

-- Supporting index — the GROUP BY + WHERE filters benefit from a
-- composite on (canonical_id, brand, max, unit). Keeps the aggregate
-- fast even as pantry_items grows.
create index if not exists pantry_items_package_histogram_idx
  on public.pantry_items (canonical_id, brand, max, unit)
  where max > 0 and unit is not null and unit <> '';
