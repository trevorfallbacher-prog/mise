-- 0046_user_scan_corrections.sql
--
-- Family-shared memory of "this receipt text string → that canonical
-- identity." When a user corrects a scan row (relinks "AQUAMARINE SL"
-- to imitation_crab, or retypes "CHZ SLCD" as sliced cheese), we
-- remember the mapping keyed on the normalized raw OCR text. Next
-- scan that surfaces the same text hits the memory and pre-suggests
-- the same identity — a ⭐ star next to the row — so the user hits
-- CONFIRM instead of re-linking.
--
-- Why this shape:
--   * Keyed on raw OCR text (normalized), not on Claude's interpreted
--     name, because receipt abbreviations are the thing that repeats.
--     "ACQUAMAR FLA" shows up on every Trader Joe's receipt; a memory
--     keyed on it means the user corrects once, we're right forever.
--   * Family-shared — if one family member linked "BURR BALLS" to
--     Burrata, the rest of the household benefits on their next scan.
--   * Captures the full identity (type + canonical + ingredient_ids +
--     emoji) so reapplying is a single-record fetch, not a re-join.
--   * Correction count tracks confidence. If a string has been
--     corrected the same way 5+ times, that's a strong signal for
--     future auto-apply without star-confirmation. For now we stop
--     at "suggest," but the data is there.
--
-- What we DON'T store:
--   * Quantities / prices / dates — per-scan, not per-text.
--   * The original Claude interpretation — it drifts. The raw OCR
--     string is the stable key; Claude's guess is just the first
--     guess of many.

-- ── 1. Table ────────────────────────────────────────────────────────

create table if not exists public.user_scan_corrections (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,

  -- The receipt / scan text that keys this memory. Stored raw for
  -- debugging; the _normalized column is what we lookup by.
  raw_text          text        not null,

  -- Lowercased, trimmed, internal-whitespace-collapsed form of
  -- raw_text. Maintained by the client on write. Looked up on every
  -- scan; indexed uniquely per user so the same user can't have two
  -- rows for the same normalized string.
  raw_text_normalized text      not null,

  -- User-corrected identity. All nullable — a correction might set
  -- just the canonical, just the type, or just the display name.
  -- The picker writes whatever the user changed.
  corrected_name    text        null,
  emoji             text        null,
  type_id           text        null,   -- FOOD_TYPES id or user_types.id
  canonical_id      text        null,   -- canonical ingredient id
  ingredient_ids    text[]      not null default '{}'::text[],

  -- Popularity + recency. Every time the same raw_text is corrected
  -- (same way) we bump correction_count + last_used_at. Diverging
  -- corrections for the same text overwrite (last-correction-wins) —
  -- users change their minds, and the latest choice reflects current
  -- intent better than the stalest.
  correction_count  integer     not null default 1,
  last_used_at      timestamptz not null default now(),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── 2. Indexes ──────────────────────────────────────────────────────
-- Hot path: "given this raw text, do we have a correction?" Looked
-- up by family on every scan — index on normalized text per-user.

create unique index if not exists user_scan_corrections_user_norm_uq
  on public.user_scan_corrections (user_id, raw_text_normalized);

-- Family lookup path: "any family correction for this text?" The
-- client resolves family membership via family_ids_of() in the RLS
-- policy, so we just need a fast scan on the normalized column.
create index if not exists user_scan_corrections_norm_idx
  on public.user_scan_corrections (raw_text_normalized);

-- ── 3. RLS ──────────────────────────────────────────────────────────
-- Family-shared: corrections propagate across the household. One
-- person teaches the system, everyone benefits on their next scan.

alter table public.user_scan_corrections enable row level security;

drop policy if exists "user_scan_corrections: family-select" on public.user_scan_corrections;
create policy "user_scan_corrections: family-select"
  on public.user_scan_corrections for select
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "user_scan_corrections: family-insert" on public.user_scan_corrections;
create policy "user_scan_corrections: family-insert"
  on public.user_scan_corrections for insert
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "user_scan_corrections: family-update" on public.user_scan_corrections;
create policy "user_scan_corrections: family-update"
  on public.user_scan_corrections for update
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  )
  with check (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

drop policy if exists "user_scan_corrections: family-delete" on public.user_scan_corrections;
create policy "user_scan_corrections: family-delete"
  on public.user_scan_corrections for delete
  using (
    auth.uid() = user_id
    or user_id in (select public.family_ids_of(auth.uid()))
  );

-- ── 4. updated_at trigger ───────────────────────────────────────────

create or replace function public.touch_user_scan_corrections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_scan_corrections_touch_updated_at on public.user_scan_corrections;
create trigger user_scan_corrections_touch_updated_at
  before update on public.user_scan_corrections
  for each row execute function public.touch_user_scan_corrections_updated_at();

-- ── 5. Realtime ─────────────────────────────────────────────────────
-- Family members see each other's corrections land live — mid-scan,
-- if a spouse corrects something in parallel, the suggestion
-- appears on the next row evaluation.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_scan_corrections'
  ) then
    alter publication supabase_realtime add table public.user_scan_corrections;
  end if;
end $$;
