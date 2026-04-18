-- 0055_fanout_push_via_vault.sql
--
-- The fanout trigger from migration 0053 read its config via
-- current_setting('app.settings.supabase_url') and
-- current_setting('app.settings.supabase_service_key'), which
-- required ALTER DATABASE postgres SET. Supabase hosted doesn't
-- grant non-superusers permission to run ALTER DATABASE, so that
-- approach can't be configured from the SQL editor.
--
-- This migration swaps the lookup over to Supabase Vault. Vault is
-- pre-installed on every Supabase project via the supabase_vault
-- extension; secrets get inserted once via the SQL editor and are
-- then decryptable from any SECURITY DEFINER function.
--
-- Operator steps (one-time, separate from this migration):
--
--   1. Store the service-role key in Vault (SQL editor):
--        insert into vault.secrets (name, secret)
--        values ('service_role_key', '<paste service_role key>');
--
--      If the secret is already there (re-running setup), update:
--        update vault.secrets
--          set secret = '<paste service_role key>'
--        where name  = 'service_role_key';
--
--   2. Apply this migration.
--
-- The project URL is not secret (it's visible in the browser bundle
-- via REACT_APP_SUPABASE_URL), so it's inlined in the function body
-- rather than stashed in Vault.

-- ── 1. ensure Vault is installed (idempotent) ────────────────────────
create extension if not exists supabase_vault with schema vault;

-- ── 2. replace the fanout trigger function ──────────────────────────
create or replace function public.fanout_notification_push()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, extensions, vault
as $$
declare
  -- Project URL is public — safe to inline. If the project ref
  -- changes (e.g., you restore from a backup into a fresh project),
  -- edit this migration and rerun.
  base_url     text := 'https://xpnxffxvzdqijgawcnsb.supabase.co';
  service_key  text;
  endpoint_url text;
  body         jsonb;
begin
  -- Fetch the service-role key from Vault. The join is via the
  -- secret name we stored in step 1 of the operator setup.
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  -- If Vault doesn't have the key yet (setup not done), silently
  -- skip — the in-app notification row already landed, so the user
  -- hasn't lost anything; they just miss the push surface until the
  -- secret is stored.
  if service_key is null or service_key = '' then
    return new;
  end if;

  endpoint_url := base_url || '/functions/v1/send-push';

  body := jsonb_build_object(
    'userId',        new.user_id,
    'notification',  jsonb_build_object(
      'id',          new.id,
      'title',       'mise',
      'body',        concat_ws(' ', new.emoji, new.msg),
      'emoji',       new.emoji,
      'kind',        new.kind,
      'target_kind', new.target_kind,
      'target_id',   new.target_id
    )
  );

  perform net.http_post(
    url      := endpoint_url,
    headers  := jsonb_build_object(
                  'Content-Type',  'application/json',
                  'Authorization', 'Bearer ' || service_key
                ),
    body     := body,
    timeout_milliseconds := 3000
  );

  return new;
exception
  when others then
    -- Never block the INSERT on push-dispatch failure. The in-app
    -- notification row already landed; a failed push is a non-event
    -- from the user's perspective.
    return new;
end;
$$;

revoke all on function public.fanout_notification_push() from public;

-- Trigger itself was created in 0053; it keeps pointing at this
-- function by name so the CREATE OR REPLACE above picks up
-- automatically. No trigger re-create needed.

notify pgrst, 'reload schema';
