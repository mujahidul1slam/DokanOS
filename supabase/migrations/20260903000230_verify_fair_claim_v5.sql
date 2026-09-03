-- TEMPORARY rollback-safe verification harness v5 for the fair-claim RPC
-- (revamp 3.2). RETURNING order is arbitrary heap order, so fairness must be
-- asserted via SELECTION COMPOSITION, not output order:
--   With 4 eligible stores (2 real + 2 synthetic), claim(4) must take exactly
--   ONE row per store (all round-1 rows) — including exactly 1 synthetic-A and
--   1 synthetic-B row. Pure created_at ordering would take the 4 oldest rows
--   (all real-store rows, since the synthetic burst is newest): 0 synthetic.

CREATE OR REPLACE FUNCTION public.verify_fair_claim()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  store_a uuid;
  store_b uuid;
  a_r1 int := 0;
  b_r1 int := 0;
  a_r2 int := 0;
  b_r2 int := 0;
  ok_round1 boolean := false;
  ok_round2 boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.stores (id, name, url, status)
    VALUES (gen_random_uuid(), 'FAIRTEST-A', 'https://fairtest-a.invalid', 'connected')
    RETURNING id INTO store_a;
    INSERT INTO public.stores (id, name, url, status)
    VALUES (gen_random_uuid(), 'FAIRTEST-B', 'https://fairtest-b.invalid', 'connected')
    RETURNING id INTO store_b;

    -- Burst: A gets 5, B gets 3 — newest created_at in the queue (bursts
    -- always are; that's the starvation scenario).
    FOR i IN 1..5 LOOP
      INSERT INTO public.sync_queue (store_id, order_id, action)
      VALUES (store_a, NULL, 'push_stock');
    END LOOP;
    FOR i IN 1..3 LOOP
      INSERT INTO public.sync_queue (store_id, order_id, action)
      VALUES (store_b, NULL, 'push_stock');
    END LOOP;

    -- Round 1: with 4 eligible stores, 4 slots = 1 row per store.
    SELECT count(*) FILTER (WHERE store_id = store_a),
           count(*) FILTER (WHERE store_id = store_b)
    INTO a_r1, b_r1
    FROM public.claim_sync_queue_batch(4);

    -- Round 2: next 4 slots = each store's 2nd-oldest row.
    SELECT count(*) FILTER (WHERE store_id = store_a),
           count(*) FILTER (WHERE store_id = store_b)
    INTO a_r2, b_r2
    FROM public.claim_sync_queue_batch(4);

    ok_round1 := (a_r1 = 1 AND b_r1 = 1);
    ok_round2 := (a_r2 = 1 AND b_r2 = 1);

    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN
      RAISE;
    END IF;
  END;

  RETURN jsonb_build_object(
    'round1_one_row_per_store', ok_round1,
    'round2_one_row_per_store', ok_round2,
    'a_claimed_r1', a_r1, 'b_claimed_r1', b_r1,
    'a_claimed_r2', a_r2, 'b_claimed_r2', b_r2
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_fair_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_fair_claim() TO anon, authenticated, service_role;
