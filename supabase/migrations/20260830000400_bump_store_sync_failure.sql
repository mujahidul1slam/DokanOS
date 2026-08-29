-- Phase 4: increment a store's sync_failures on a hard push failure. Once it
-- passes the threshold the breaker trips for one hour; a later success resets it.

CREATE OR REPLACE FUNCTION public.bump_store_sync_failure(p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failures int;
  v_threshold int := 5;
BEGIN
  UPDATE public.stores
  SET sync_failures = COALESCE(sync_failures, 0) + 1
  WHERE id = p_store_id
  RETURNING sync_failures INTO v_failures;

  IF v_failures >= v_threshold THEN
    UPDATE public.stores
    SET circuit_breaker_until = now() + interval '1 hour'
    WHERE id = p_store_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_store_sync_failure(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_store_sync_failure(uuid)
  TO service_role;
