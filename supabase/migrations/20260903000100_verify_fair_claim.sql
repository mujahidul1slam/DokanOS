-- TEMPORARY rollback-safe verification harness for the fair-claim RPC
-- (revamp 3.2). Uses the ABORT_TEST pattern: DB writes inside subtransaction
-- blocks are rolled back at the end, so the live queue is untouched, while
-- boolean results survive via variable assignments.
--
-- Test: insert a synthetic burst — 5 rows for store A (created_at spread)
-- and 3 rows for store B — plus pretend a pre-existing row for store B.
-- Claim 6 rows: fair scheduling should return A,B,A,B,A,B (interleaved),
-- NOT A,A,A,A,A,B (burst starvation).
-- NOTE: inserts happen inside the harness transaction; since the whole RPC
-- body is one transaction aborted at the end, nothing persists.

CREATE OR REPLACE FUNCTION public.verify_fair_claim()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  store_a uuid;
  store_b uuid;
  claimed text[] := '{}';
  ok_fair boolean := false;
  ok_count boolean := false;
  burst_a int := 5;
  burst_b int := 3;
BEGIN
  BEGIN
    -- Two synthetic stores (rolled back at the end).
    INSERT INTO public.stores (id, name, url, status)
    VALUES (gen_random_uuid(), 'FAIRTEST-A', 'https://fairtest-a.invalid', 'connected')
    RETURNING id INTO store_a;
    INSERT INTO public.stores (id, name, url, status)
    VALUES (gen_random_uuid(), 'FAIRTEST-B', 'https://fairtest-b.invalid', 'connected')
    RETURNING id INTO store_b;

    -- Burst: store A gets 5 rows in one second; store B gets 3.
    FOR i IN 1..burst_a LOOP
      INSERT INTO public.sync_queue (store_id, order_id, action)
      VALUES (store_a, NULL, 'push_stock');
    END LOOP;
    -- sync_queue.order_id is nullable but action check requires a valid one;
    -- use push_stock rows (they carry product ids in payload, no order).
    FOR i IN 1..burst_b LOOP
      INSERT INTO public.sync_queue (store_id, order_id, action)
      VALUES (store_b, NULL, 'push_stock');
    END LOOP;

    -- Claim burst_b + burst_a - 2 = 6 rows (more than one store's set).
    claimed := ARRAY(
      SELECT store_id::text
      FROM public.claim_sync_queue_batch(6)
      WHERE store_id IN (store_a, store_b)
      ORDER BY updated_at DESC, id
    );

    ok_count := array_length(claimed, 1) = 6;

    -- Fair interleaving: with 6 claimed from A(5)+B(3), B must have ALL 3
    -- claimed (pure created_at ordering would claim A,A,A,A,A,B instead).
    DECLARE
      b_count int;
    BEGIN
      SELECT count(*) INTO b_count FROM unnest(claimed) c WHERE c = store_b::text;
      ok_fair := b_count = 3;
    END;

    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN
      RAISE;
    END IF;
  END;

  RETURN jsonb_build_object(
    'claimed_count_ok', ok_count,
    'fair_interleave_ok', ok_fair,
    'claimed', claimed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_fair_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_fair_claim() TO anon, authenticated, service_role;
