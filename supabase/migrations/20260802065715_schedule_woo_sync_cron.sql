-- Drop the job if it already exists so this migration is idempotent
DO $$
BEGIN
  PERFORM cron.unschedule('woo-sync-all-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule woo-sync-all to run every 15 minutes as a safety net.
-- Uses pg_net to call the Edge Function directly from the database.
SELECT cron.schedule(
  'woo-sync-all-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kjmvbqlemdfddjrjtiik.supabase.co/functions/v1/woo-sync-all',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'woo_sync_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
