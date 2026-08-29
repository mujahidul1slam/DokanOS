-- Phase 4: allow the "Sync Now" action (or an admin) to manually clear a store's
-- circuit breaker and failure counter so pushes resume immediately.

CREATE OR REPLACE FUNCTION public.reset_store_circuit_breaker(p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.stores
  SET circuit_breaker_until = NULL,
      sync_failures = 0
  WHERE id = p_store_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_store_circuit_breaker(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_store_circuit_breaker(uuid)
  TO service_role, authenticated;
