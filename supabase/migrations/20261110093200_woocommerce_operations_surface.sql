-- Issue 55: bounded operator health aggregation and explicit containment helpers.
-- The function is service-role only; the API authenticates the caller and checks
-- owner/admin membership before invoking it.

CREATE OR REPLACE FUNCTION public.get_woocommerce_connector_health(p_connector_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  connector_row record;
  counts jsonb;
  latest_delivery jsonb;
  latest_run jsonb;
  conflicts integer;
  queue_depth bigint;
  oldest timestamptz;
BEGIN
  SELECT id, business_id, status, intake_enabled, outbound_enabled, webhook_status,
         last_webhook_verified_at, last_webhook_processed_at, last_reconciliation_at,
         reconciliation_watermark
    INTO connector_row
    FROM public.woocommerce_connectors
   WHERE id = p_connector_id;
  IF connector_row.id IS NULL THEN RAISE EXCEPTION 'connector_not_found'; END IF;

  SELECT coalesce(jsonb_object_agg(state, amount), '{}'::jsonb),
         coalesce(sum(amount), 0)::bigint, min(created_at)
    INTO counts, queue_depth, oldest
    FROM (
      SELECT state, count(*)::bigint AS amount, min(created_at) AS created_at
        FROM public.woocommerce_sync_work
       WHERE connector_id = p_connector_id
       GROUP BY state
    ) grouped;

  SELECT to_jsonb(d) INTO latest_delivery
    FROM (
      SELECT received_at, verified_at, processed_at, verification_result
        FROM public.woocommerce_webhook_deliveries
       WHERE connector_id = p_connector_id
       ORDER BY received_at DESC LIMIT 1
    ) d;
  SELECT to_jsonb(r) INTO latest_run
    FROM (
      SELECT id, state, started_at, completed_at, pages, discovered, enqueued,
             error_class, last_error, watermark_after
        FROM public.woocommerce_reconciliation_runs
       WHERE connector_id = p_connector_id
       ORDER BY started_at DESC LIMIT 1
    ) r;
  SELECT count(*) INTO conflicts
    FROM public.woocommerce_sync_conflicts
   WHERE connector_id = p_connector_id AND resolution IS NULL;

  RETURN jsonb_build_object(
    'connector', jsonb_build_object(
      'id', connector_row.id, 'business_id', connector_row.business_id,
      'status', connector_row.status, 'intake_enabled', connector_row.intake_enabled,
      'outbound_enabled', connector_row.outbound_enabled,
      'webhook_status', connector_row.webhook_status,
      'last_webhook_verified_at', connector_row.last_webhook_verified_at,
      'last_webhook_processed_at', connector_row.last_webhook_processed_at,
      'last_reconciliation_at', connector_row.last_reconciliation_at,
      'reconciliation_watermark', connector_row.reconciliation_watermark
    ),
    'queue', jsonb_build_object('counts', counts, 'total', queue_depth, 'oldest_created_at', oldest),
    'latest_delivery', coalesce(latest_delivery, 'null'::jsonb),
    'latest_reconciliation', coalesce(latest_run, 'null'::jsonb),
    'open_conflict_count', conflicts
  );
END $$;
REVOKE ALL ON FUNCTION public.get_woocommerce_connector_health(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_woocommerce_connector_health(uuid) TO service_role;

COMMENT ON FUNCTION public.get_woocommerce_connector_health(uuid) IS
  'Bounded aggregate for owner/admin operations; excludes all credential and secret values.';
