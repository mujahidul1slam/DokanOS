-- Revamp Phase 3.3: vault getter for the sync-alert webhook URL. The secret
-- `sync_alert_webhook_url` is created manually (one-time) with:
--   SELECT vault.create_secret('https://hooks.slack.com/services/xxx',
--                             'sync_alert_webhook_url');
-- Missing secret = alerting disabled (sync-alert checks for NULL).

CREATE OR REPLACE FUNCTION public.get_sync_alert_webhook_url()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sync_alert_webhook_url' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_sync_alert_webhook_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sync_alert_webhook_url() TO service_role;
