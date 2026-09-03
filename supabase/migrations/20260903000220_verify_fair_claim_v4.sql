-- TEMPORARY rollback-safe verification harness v3 for the fair-claim RPC
-- (revamp 3.2). Correct invariant test: with N stores having pending rows,
-- claim order must respect ROUND-ROBIN — every eligible store's round-1 row
-- before any store's round-2 row, etc. Test with distinct created_at per row
-- (realistic burst) and assert B's round-1 row precedes A's round-2 row.

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
  ok_round_robin boolean := false;
  ok_counts boolean := false;
  all_seq text[] := '{}';
BEGIN
  BEGIN
    INSERT INTO public.stores (id, name, url, status)
    VALUES (gen_random_uuid(), 'FAIRTEST-A', 'https://fairtest-a.invalid', 'connected')
    RETURNING id INTO store_a;
    INSERT INTO public.stores (id, name, url, status)
    VALUES (gen_random_uuid(), 'FAIRTEST-B', 'https://fairtest-b.invalid', 'connected')
    RETURNING id INTO store_b;

    -- Burst with DISTINCT created_at (realistic: inserts take time; the
    -- same-transaction now() freeze is why v2's rows all tied).
    FOR i IN 1..5 LOOP
      INSERT INTO public.sync_queue (store_id, order_id, action, created_at, updated_at)
      VALUES (store_a, NULL, 'push_stock', now() - (6 - i) * interval '1 second', now() - (6 - i) * interval '1 second');
    END LOOP;
    FOR i IN 1..3 LOOP
      INSERT INTO public.sync_queue (store_id, order_id, action, created_at, updated_at)
      VALUES (store_b, NULL, 'push_stock', now() - (4 - i) * interval '1 second', now() - (4 - i) * interval '1 second');
    END LOOP;

    all_seq := ARRAY(
      SELECT CASE store_id WHEN store_a THEN 'A' WHEN store_b THEN 'B' ELSE '.' END
      FROM public.claim_sync_queue_batch(100000)
    );

    FOR i IN 1..array_length(all_seq, 1) LOOP
      IF all_seq[i] = 'A' THEN seq_a := array_append(seq_a, i);
      ELSIF all_seq[i] = 'B' THEN seq_b := array_append(seq_b, i);
      END IF;
    END LOOP;

    -- Round-robin: B's first row must come before A's SECOND row (B round 1
    -- precedes A round 2). created_at ordering alone would give A five rows
    -- (all inserted with earlier timestamps) before B's first.
    ok_round_robin := seq_b[1] < seq_a[2];
    ok_counts := array_length(seq_a, 1) = 5 AND array_length(seq_b, 1) = 3;

    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN
      RAISE;
    END IF;
  END;

  RETURN jsonb_build_object(
    'round_robin_ok', ok_round_robin,
    'counts_ok', ok_counts,
    'a_positions', seq_a,
    'b_positions', seq_b
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_fair_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_fair_claim() TO anon, authenticated, service_role;
