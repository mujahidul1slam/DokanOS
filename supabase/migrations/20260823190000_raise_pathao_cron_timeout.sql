-- ============================================================================
-- Raise the pathao-track-all cron timeout.
--
-- 20260823183000 set timeout_milliseconds := 120000 based on an estimate of
-- 50 orders x 350ms pacing = ~18s. The first real post-fix run measured
-- 93 SECONDS for 41 consignments -- Pathao's Aladdin API averages ~2.3s per
-- lookup, so network latency dominates and the pacing delay is noise.
--
-- Extrapolated to a full 50-order window that is ~115s, i.e. inside 120000 by
-- only ~5s. A pg_net timeout records a FAILED row in net._http_response and
-- is otherwise silent, which is the same shape of invisible failure this
-- whole fix series exists to remove -- so give it real headroom instead of a
-- margin that depends on Pathao being fast.
--
-- 300000 (5 min) is still well inside the 15-minute schedule interval, so
-- runs cannot overlap.
-- ============================================================================
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
    body := jsonb_build_object('action', 'track_all'),
    timeout_milliseconds := 300000
  ) AS request_id;
  $$
);
