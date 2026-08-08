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
    url := 'https://jiwndicvfkiltgageqwv.supabase.co/functions/v1/pathao-courier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppd25kaWN2ZmtpbHRnYWdlcXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjg5OTcsImV4cCI6MjEwMDkwNDk5N30.zWbTtxLYD1hw-vQ7qZdxm1NgUSWYHsS-0wWXg89_7MY'
    ),
    body := jsonb_build_object('action', 'track_all')
  ) AS request_id;
  $$
);
