-- Fix woo-sync-all-15min cron job to include proper Authorization headers and a larger timeout.
DO $$
BEGIN
  PERFORM cron.unschedule('woo-sync-all-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'woo-sync-all-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jiwndicvfkiltgageqwv.supabase.co/functions/v1/woo-sync-all',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppd25kaWN2ZmtpbHRnYWdlcXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjg5OTcsImV4cCI6MjEwMDkwNDk5N30.zWbTtxLYD1hw-vQ7qZdxm1NgUSWYHsS-0wWXg89_7MY',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'woo_sync_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- Fix process_sync_queue_5min cron job to include a larger timeout.
DO $$
BEGIN
  PERFORM cron.unschedule('process_sync_queue_5min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'process_sync_queue_5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jiwndicvfkiltgageqwv.supabase.co/functions/v1/sync-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppd25kaWN2ZmtpbHRnYWdlcXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjg5OTcsImV4cCI6MjEwMDkwNDk5N30.zWbTtxLYD1hw-vQ7qZdxm1NgUSWYHsS-0wWXg89_7MY'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
