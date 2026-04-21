-- 0116_profiles_avatar_url.sql
--
-- Adds profiles.avatar_url: a URL to the chef's currently-displayed
-- avatar image. In this codebase avatars are a *game catalog* (see
-- migration 0118) — users don't upload photos, they earn / unlock
-- character avatars that rotate on each Home mount (random mode) or
-- stay fixed (pinned mode). This column is the denormalized "what do
-- I render" value read by every rendering surface (Home top-right,
-- activity feed rows, YOUR PROFILE identity band, Settings family
-- list, CookComplete diner picker).
--
-- Source of truth is profiles.avatar_slug (added in 0118) + the
-- avatar_catalog row it points at. avatar_url is kept in sync client-
-- side whenever the slug changes — a tiny denormalization that saves
-- every render site from doing a catalog join. Nullable on purpose:
-- until the first mount grants the new user a starter pool, there's
-- nothing to render, and the client falls back to the initial-letter
-- circle.
--
-- RLS: the existing profiles policies already gate SELECT/UPDATE on
-- auth.uid() + family_ids_of(), so adding a column doesn't require
-- policy changes. Family members can already read each other's profile
-- rows by design — which is exactly the cross-user avatar visibility
-- this column enables (your family sees your currently-rolled avatar
-- on the feed in real time).

alter table public.profiles
  add column if not exists avatar_url text;
