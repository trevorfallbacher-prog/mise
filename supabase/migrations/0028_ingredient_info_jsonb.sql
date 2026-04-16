-- Hybrid ingredient metadata: JSONB in Supabase, JS fallback in code.
--
-- INGREDIENT_INFO lived as a giant JS object (~2000 lines of prose) that
-- grew with every ingredient. Editing it meant touching a 5000-line file,
-- fighting API timeouts, and redeploying. Moving it to Supabase means:
--
--   * Edit metadata from the dashboard — no deploy, no file conflicts
--   * Add new spice/ingredient metadata as INSERT statements or via UI
--   * The JS object stays as a fallback so nothing breaks while we
--     migrate entries gradually
--
-- One row per ingredient. The `info` JSONB column carries the full
-- metadata shape (description, flavorProfile, storage, substitutions,
-- nutrition, culturalNotes, origin, allergens, diet, seasonality,
-- sourcing, market, skillDev, blendOf, etc.). Schema-flexible — new
-- fields just appear in the JSON, no ALTER TABLE needed.
--
-- RLS: public read (it's reference data, not user-specific), write
-- restricted to authenticated users (so the owner can edit via the
-- dashboard or a future admin panel, but anonymous visitors can't).

create table if not exists public.ingredient_info (
  ingredient_id text primary key,
  info          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Auto-touch updated_at on edits so the client knows when to bust cache.
drop trigger if exists ingredient_info_touch_updated_at on public.ingredient_info;
create trigger ingredient_info_touch_updated_at
before update on public.ingredient_info
for each row execute function public.touch_updated_at();

alter table public.ingredient_info enable row level security;

-- Everyone can read ingredient metadata — it's reference data.
drop policy if exists "ingredient_info: public-read" on public.ingredient_info;
create policy "ingredient_info: public-read"
  on public.ingredient_info for select
  using (true);

-- Only authenticated users can write (dashboard / admin flows).
drop policy if exists "ingredient_info: auth-write" on public.ingredient_info;
create policy "ingredient_info: auth-write"
  on public.ingredient_info for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
