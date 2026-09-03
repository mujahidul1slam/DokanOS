-- TEMPORARY Phase 1.6 verification: expose webhook_events age range so we can
-- prove the retention sweep purged pre-cutoff rows after a drain. Will be
-- dropped together with the other verification oracles.

CREATE OR REPLACE FUNCTION public.verify_phase1_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'webhook_events_count', (SELECT count(*) FROM public.webhook_events),
    'webhook_events_oldest', (SELECT min(created_at)::text FROM public.webhook_events),
    'webhook_events_cutoff', (SELECT (now() - interval '30 days')::text)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_phase1_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_phase1_retention() TO anon, authenticated, service_role;
