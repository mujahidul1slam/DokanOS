DO $$
BEGIN
  PERFORM cron.unschedule('pathao-track-all-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'pathao-track-all-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kjmvbqlemdfddjrjtiik.supabase.co/functions/v1/pathao-courier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqbXZicWxlbWRmZGRqcmp0aWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MzgxNjksImV4cCI6MjA5MTExNDE2OX0.7r2znKjCxnoJrHMxWFuK2PqJ6GO6LeF8MvFOI1Qhg7Y'
    ),
    body := jsonb_build_object('action', 'track_all')
  ) AS request_id;
  $$
);