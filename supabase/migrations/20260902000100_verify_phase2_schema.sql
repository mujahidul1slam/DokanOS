-- TEMPORARY Phase 2 verification oracle: courier schema state after migration
-- 20260902000000 (backfill counts, sample rows, constraint presence).
CREATE OR REPLACE FUNCTION public.verify_phase2_schema()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'providers', (SELECT jsonb_agg(jsonb_build_object('code', code, 'name', name, 'track_interval_minutes', track_interval_minutes)) FROM public.courier_providers),
    'shipments_total', (SELECT count(*) FROM public.courier_shipments),
    'shipments_by_provider', (SELECT jsonb_object_agg(provider, c) FROM (SELECT provider, count(*) c FROM public.courier_shipments GROUP BY provider) t),
    'shipments_by_canonical', (SELECT COALESCE(jsonb_object_agg(canonical_status, c), '{}'::jsonb) FROM (SELECT canonical_status, count(*) c FROM public.courier_shipments GROUP BY canonical_status) t),
    'orders_with_consignment', (SELECT count(*) FROM public.orders WHERE consignment_id IS NOT NULL),
    'action_check_exists', (SELECT count(*) > 0 FROM pg_constraint WHERE conname = 'sync_queue_action_check'),
    'sample', (SELECT jsonb_agg(jsonb_build_object('consignment_id', consignment_id, 'provider', provider, 'canonical_status', canonical_status, 'has_integration', integration_id IS NOT NULL) ORDER BY dispatched_at DESC) FROM (SELECT * FROM public.courier_shipments ORDER BY dispatched_at DESC LIMIT 5) s)
  ) INTO out;
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_phase2_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_phase2_schema() TO anon, authenticated, service_role;
