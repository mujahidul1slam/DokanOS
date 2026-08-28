-- Phase 1: make sync_queue claiming concurrency-safe.
--
-- The worker used to SELECT pending rows and THEN loop marking each
-- "processing". Under concurrent dispatch (GitHub Actions + a revived
-- pg_cron, or two overlapping Actions runs) both dispatchers can read the
-- same 20 rows before either has flipped status, so the same order gets
-- pushed to WooCommerce twice.
--
-- This RPC claims a batch inside a single transaction using
-- SELECT ... FOR UPDATE SKIP LOCKED: one dispatcher locks the rows it
-- takes, the next dispatcher skips them. No two callers can ever claim the
-- same row.
--
-- It also adds idempotency_key, used by the Phase 2 (webhooks) and Phase 3
-- (parallel pool) work so an event can't be enqueued twice.

-- Forward-looking column: a stable key (store_id + woo order id + event)
-- so event-driven enqueues are de-duplicated before they ever enter the queue.
ALTER TABLE public.sync_queue
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Partial unique index: only enforced for non-null keys, so legacy rows
-- (and any non-idempotent enqueue) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_idempotency
  ON public.sync_queue (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_sync_queue_batch(p_limit int)
RETURNS SETOF public.sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.sync_queue
    WHERE status IN ('pending', 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at ASC
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
