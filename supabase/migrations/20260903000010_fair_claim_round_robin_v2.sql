-- Revamp Phase 3.2: fair scheduling in claim_sync_queue_batch.
--
-- Problem: one merchant's bulk action (e.g. bulk status change on 300
-- orders) enqueues 300 rows in a tight created_at burst; the claim's
-- ORDER BY created_at then returns ONLY that merchant's rows for every
-- batch until the burst drains — other stores' pending pushes sit behind
-- it for minutes/hours.
--
-- Fix: round-robin by store. Rank each store's eligible rows oldest-first
-- (store_seq), then claim by (store_seq, store_id): all stores' round-1 rows
-- first, then all stores' round-2 rows, etc. Within a round, store_id (a
-- random uuid) spreads stores arbitrarily — deliberately NOT created_at,
-- which would re-introduce burst priority across stores (a bursty store's
-- round-2 row is older than a quiet store's round-1 row, but the quiet
-- store must still go first). Within one store, its own rows stay FIFO by
-- created_at. A bursty store still gets all its rows claimed eventually,
-- interleaved with everyone else's.
--
-- Skip-locked semantics preserved: two concurrent workers never claim the
-- same row.

CREATE OR REPLACE FUNCTION public.claim_sync_queue_batch(p_limit int)
RETURNS SETOF public.sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT id, store_id, created_at
    FROM public.sync_queue
    WHERE status IN ('pending', 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    FOR UPDATE SKIP LOCKED
  ),
  ranked AS (
    SELECT
      e.id,
      e.store_id,
      ROW_NUMBER() OVER (
        PARTITION BY e.store_id
        ORDER BY e.created_at ASC, e.id ASC
      ) AS store_seq
    FROM eligible e
  ),
  fair_order AS (
    SELECT id
    FROM ranked
    ORDER BY store_seq ASC, store_id ASC, id ASC
    LIMIT p_limit
  )
  UPDATE public.sync_queue q
  SET status = 'processing',
      updated_at = now()
  FROM fair_order f
  WHERE q.id = f.id
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sync_queue_batch(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_queue_batch(int)
  TO service_role;
