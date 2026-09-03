-- Revamp Phase 3.3: sync_health view — one place to read the whole sync
-- system's state (queue depth, oldest pending age, DLQ count, breaker trips,
-- per-courier tracking rotation). Surfaces on the dashboard + the daily
-- dead-man's-switch alert.

CREATE OR REPLACE VIEW public.sync_health AS
SELECT
  -- Queue depth by status
  (SELECT count(*) FROM public.sync_queue WHERE status = 'pending')::int AS queue_pending,
  (SELECT count(*) FROM public.sync_queue WHERE status = 'processing')::int AS queue_processing,
  (SELECT count(*) FROM public.sync_queue WHERE status = 'failed')::int AS queue_failed,
  (SELECT count(*) FROM public.sync_queue WHERE status = 'dead_letter')::int AS queue_dead_letter,
  -- Age of the oldest still-pending row (seconds; NULL = empty queue)
  (SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at)))::int
     FROM public.sync_queue WHERE status = 'pending') AS oldest_pending_seconds,
  -- Rows waiting only because next_retry_at is in the future
  (SELECT count(*) FROM public.sync_queue
     WHERE status = 'pending' AND next_retry_at > now())::int AS pending_waiting_retry,
  -- Circuit breakers currently tripped
  (SELECT count(*) FROM public.stores
     WHERE circuit_breaker_until IS NOT NULL AND circuit_breaker_until > now())::int AS stores_breaker_tripped,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'until', circuit_breaker_until)),
                  '[]'::jsonb)
     FROM public.stores
     WHERE circuit_breaker_until IS NOT NULL AND circuit_breaker_until > now()) AS breaker_detail,
  -- Store sync freshness
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'status', status, 'last_synced_at', last_synced_at,
      'sync_age_minutes', EXTRACT(EPOCH FROM (now() - last_synced_at)) / 60)),
    '[]'::jsonb)
     FROM public.stores) AS stores_sync,
  -- Courier tracking rotation (per provider): active shipments + how stale
  -- the LEAST-recently-tracked one is (rotation health)
  (SELECT coalesce(jsonb_object_agg(provider, jsonb_build_object(
      'active', c,
      'stalest_tracked_minutes', EXTRACT(EPOCH FROM (now() - m)) / 60)),
    '{}'::jsonb)
     FROM (
       SELECT provider, count(*) c, MIN(last_tracked_at) m
       FROM public.courier_shipments
       WHERE canonical_status NOT IN ('delivered','returned','cancelled')
         AND last_tracked_at IS NOT NULL
       GROUP BY provider
     ) t) AS courier_tracking,
  -- Webhook delivery health (last hour)
  (SELECT count(*) FROM public.webhook_events
     WHERE created_at > now() - interval '1 hour')::int AS webhooks_last_hour,
  (SELECT count(*) FROM public.webhook_events
     WHERE created_at > now() - interval '1 hour' AND status_code >= 400)::int AS webhooks_failed_last_hour;

GRANT SELECT ON public.sync_health TO authenticated, service_role;
