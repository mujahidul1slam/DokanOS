-- TEMPORARY rollback-safe verification harness v2 for the fair-claim RPC
-- (revamp 3.2). The live queue has ~470 pending rows competing with the
-- synthetic burst, so instead of relying on a small LIMIT, claim generously
-- and analyze how the SYNTHETIC stores' rows were sequenced relative to each
-- other: with fair round-robin, the two synthetic stores' rows must come out
-- INTERLEAVED (A,B,A,B,A,B or B,A,B,A,B,A), never A,A,A,A,A,B.

CREATE OR REPLACE FUNCTION public.verify_fair_claim()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  store_a uuid;
  store_b uuid;
  seq_a int[] := '{}';
  seq_b int[] := '{}';
  ok_interleave boolean := false;
  ok_terminating boolean := false;
  all_seq text[] := '{}';
BEGIN
  BEGIN
    INSERT INTO public.stores (id, name, url, status)
    VALUES (gen_random_uuid(), 'FAIRTEST-A', 'https://fairtest-a.invalid', 'connected')
    RETURNING id INTO store_a;
    INSERT INTO public.stores (id, name, url, status)
    VALUES (gen_random_uuid(), 'FAIRTEST-B', 'https://fairtest-b.invalid', 'connected')
    RETURNING id INTO store_b;

    -- Burst: 5 rows store A, 3 rows store B (all push_stock, no order).
    FOR i IN 1..5 LOOP
      INSERT INTO public.sync_queue (store_id, order_id, action)
      VALUES (store_a, NULL, 'push_stock');
    END LOOP;
    FOR i IN 1..3 LOOP
      INSERT INTO public.sync_queue (store_id, order_id, action)
      VALUES (store_b, NULL, 'push_stock');
    END LOOP;

    -- Claim EVERYTHING pending (synthetic + real): the RPC's return order
    -- tells us the fairness sequence. Capture per-store arrival positions.
    all_seq := ARRAY(
      SELECT CASE store_id
               WHEN store_a THEN 'A'
               WHEN store_b THEN 'B'
               ELSE '.'
             END
      FROM public.claim_sync_queue_batch(100000)
    );

    -- Positions of A and B rows within the claimed stream.
    FOR i IN 1..array_length(all_seq, 1) LOOP
      IF all_seq[i] = 'A' THEN seq_a := array_append(seq_a, i);
      ELSIF all_seq[i] = 'B' THEN seq_b := array_append(seq_b, i);
      END IF;
    END LOOP;

    -- Fair check: every B row must arrive BEFORE A's 4th row — i.e. pure
    -- created_at ordering (A,A,A,A,A,...) would put all 5 A rows before any
    -- B row (they were inserted first). Round-robin puts B's 1st before A's 2nd.
    ok_interleave := seq_b[1] < seq_a[2];
    -- And all 3 B rows claimed (they're eligible; a huge limit claims all).
    ok_terminating := array_length(seq_b, 1) = 3 AND array_length(seq_a, 1) = 5;

    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN
      RAISE;
    END IF;
  END;

  RETURN jsonb_build_object(
    'interleave_ok', ok_interleave,
    'all_claimed_ok', ok_terminating,
    'a_positions', seq_a,
    'b_positions', seq_b
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_fair_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_fair_claim() TO anon, authenticated, service_role;
