-- TEMPORARY Phase 1 final verification oracle (1.2 token cache + 1.4 real
-- deliveries + queue health). Push -> invoke via PostgREST -> then push BOTH
-- drop migrations (this fn AND verify_webhook_signatures).

CREATE OR REPLACE FUNCTION public.verify_phase1_final()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tokens jsonb;
  events jsonb;
  queue_stats jsonb;
  stores_out jsonb;
BEGIN
  -- 1.2: courier token cache state (token value masked to its length).
  SELECT jsonb_agg(jsonb_build_object(
    'provider', provider,
    'integration_id', integration_id,
    'token_len', length(token),
    'expires_at', expires_at,
    'is_future', expires_at > now()
  ))
  INTO tokens
  FROM public.courier_tokens;

  -- 1.4: recent webhook deliveries (looking for the real order.meta touches).
  SELECT jsonb_agg(jsonb_build_object(
    'topic', topic,
    'woo_id', woo_id,
    'status_code', status_code,
    'error', error,
    'created_at', created_at
  ) ORDER BY created_at DESC)
  INTO events
  FROM (SELECT * FROM public.webhook_events ORDER BY created_at DESC LIMIT 12) t;

  -- Queue health after the auth-verified drains.
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE status = 'pending'),
    'processing', count(*) FILTER (WHERE status = 'processing'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'dead_letter', count(*) FILTER (WHERE status = 'dead_letter')
  )
  INTO queue_stats
  FROM public.sync_queue;

  -- 1.5: store sync windows.
  SELECT jsonb_agg(jsonb_build_object(
    'name', name,
    'status', status,
    'last_synced_at', last_synced_at
  ) ORDER BY name)
  INTO stores_out
  FROM public.stores;

  RETURN jsonb_build_object(
    'courier_tokens', COALESCE(tokens, '[]'::jsonb),
    'recent_events', COALESCE(events, '[]'::jsonb),
    'queue_stats', COALESCE(queue_stats, '{}'::jsonb),
    'stores', COALESCE(stores_out, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_phase1_final() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_phase1_final() TO anon, authenticated, service_role;
