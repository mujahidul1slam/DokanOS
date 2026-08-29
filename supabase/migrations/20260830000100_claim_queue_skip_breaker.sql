-- Phase 4: circuit-breaker-aware queue claiming.
--
-- claim_sync_queue_batch skips any sync_queue row whose parent store has an
-- active breaker (circuit_breaker_until > now()). This keeps healthy stores
-- syncing while a bad/offline store cools down for an hour instead of burning
-- worker cycles and API limits on every tick.
--
-- The breaker check is a NOT EXISTS subquery rather than a LEFT JOIN: the
-- locking CTE also carries FOR UPDATE SKIP LOCKED, and Postgres forbids row
-- locks on the nullable side of an outer join. Keeping the join out of the
-- locking query means FOR UPDATE only ever touches sync_queue.

CREATE OR REPLACE FUNCTION public.claim_sync_queue_batch(p_limit int)
RETURNS SETOF public.sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM public.sync_queue q
    WHERE q.status IN ('pending', 'failed')
      AND (q.next_retry_at IS NULL OR q.next_retry_at <= now())
      -- Skip stores under an active circuit breaker. A NULL breaker is healthy.
      -- This is a NOT EXISTS subquery rather than a LEFT JOIN: the CTE also
      -- carries FOR UPDATE SKIP LOCKED, and Postgres forbids row locks on the
      -- nullable side of an outer join. Keeping the join out of the locking
      -- query means FOR UPDATE only ever touches sync_queue.
      AND NOT EXISTS (
        SELECT 1
        FROM public.stores s
        WHERE s.id = q.store_id
          AND s.circuit_breaker_until IS NOT NULL
          AND s.circuit_breaker_until > now()
      )
    ORDER BY q.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sync_queue q
  SET status = 'processing',
      updated_at = now()
  FROM claimed c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sync_queue_batch(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_queue_batch(int)
  TO service_role;
