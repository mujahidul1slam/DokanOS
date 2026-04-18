DO $$
BEGIN
  PERFORM cron.unschedule('pathao-track-all-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'pathao-track-all-15min',
  '*/15 * * * *',
  format($job$
    SELECT net.http_post(
      url := 'https://kjmvbqlemdfddjrjtiik.supabase.co/functions/v1/pathao-courier',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer %s'
      ),
      body := jsonb_build_object('action', 'track_all')
    ) AS request_id;
  $job$, current_setting('app.settings.service_role_key', true))
);