-- TEMPORARY Phase 2 runtime verification: are courier_shipments rows being
-- written/maintained by the new upsert path? Exposes the active window and
-- recent last_tracked_at values. Drop with the other oracles when done.

CREATE OR REPLACE FUNCTION public.verify_phase2_runtime()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'active_shipments', (SELECT jsonb_agg(jsonb_build_object(
        'consignment_id', consignment_id,
        'canonical_status', canonical_status,
        'raw_status', raw_status,
        'last_tracked_at', last_tracked_at,
        'age_seconds', EXTRACT(EPOCH FROM (now() - last_tracked_at))::int
      ) ORDER BY last_tracked_at ASC)
      FROM public.courier_shipments
      WHERE canonical_status NOT IN ('delivered','returned','cancelled')),
    'recent_writes', (SELECT count(*) FROM public.courier_shipments
      WHERE last_tracked_at > now() - interval '10 minutes')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_phase2_runtime() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_phase2_runtime() TO anon, authenticated, service_role;
