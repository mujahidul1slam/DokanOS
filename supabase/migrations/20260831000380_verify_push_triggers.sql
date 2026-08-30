-- TEMPORARY verification harness for 20260831000200_order_push_full_sync.
-- Runs the full trigger test suite inside SAVEPOINTs and rolls every test
-- write back, so no production data changes and no real pushes are enqueued
-- (uncommitted sync_queue rows are invisible to the sync-worker).
-- Dropped by 20260831000390_drop_verify_triggers.sql after use.

CREATE OR REPLACE FUNCTION public.verify_push_triggers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  v_before int;
  v_after1 int;
  v_after2 int;
  v_after3 int;
  v_rpc int;
  v_key1 text;
  v_minute1 text;
  v_minute2 text;
  v_orig_name text;
  v_test_name text;
  v_stats jsonb;
BEGIN
  SELECT id, customer_name, status INTO o
  FROM public.orders
  WHERE woo_order_id IS NOT NULL AND store_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no woo-linked order found');
  END IF;

  v_orig_name := o.customer_name;
  v_test_name := coalesce(v_orig_name, '') || ' [verify]';

  SELECT jsonb_build_object(
    'orders_with_woo_stamp', (SELECT count(*) FROM public.orders WHERE woo_updated_at IS NOT NULL),
    'queue_pending',   (SELECT count(*) FROM public.sync_queue WHERE status = 'pending'),
    'queue_failed',    (SELECT count(*) FROM public.sync_queue WHERE status = 'failed'),
    'queue_dead',      (SELECT count(*) FROM public.sync_queue WHERE status = 'dead_letter')
  ) INTO v_stats;

  ---------------------------------------------------------------- T1 + T2 + T3
  -- PL/pgSQL has no ROLLBACK TO SAVEPOINT; a BEGIN..EXCEPTION block creates
  -- an implicit subtransaction instead. We RAISE deliberately after capturing
  -- the counters — the handler rolls back all test writes (and any queue rows
  -- the trigger enqueued), while the captured variables survive.
  BEGIN
    SELECT count(*) INTO v_before
    FROM public.sync_queue WHERE order_id = o.id AND status = 'pending';

    -- T1: DokanOS-style customer-info edit (tracked field, NO woo stamp)
    UPDATE public.orders SET customer_name = v_test_name WHERE id = o.id;
    v_minute1 := to_char(now(), 'YYYYMMDDHH24MI');
    SELECT count(*) INTO v_after1
    FROM public.sync_queue WHERE order_id = o.id AND status = 'pending';
    SELECT min(idempotency_key) INTO v_key1
    FROM public.sync_queue
    WHERE order_id = o.id AND status = 'pending'
      AND idempotency_key LIKE 'push:%';

    -- T2: second edit within the same minute must coalesce (same key)
    UPDATE public.orders SET customer_name = v_orig_name WHERE id = o.id;
    v_minute2 := to_char(now(), 'YYYYMMDDHH24MI');
    SELECT count(*) INTO v_after2
    FROM public.sync_queue WHERE order_id = o.id AND status = 'pending';

    -- T3: Woo-origin write (tracked field + woo_updated_at stamped) must NOT enqueue
    UPDATE public.orders
    SET customer_name = v_test_name, woo_updated_at = now()
    WHERE id = o.id;
    SELECT count(*) INTO v_after3
    FROM public.sync_queue WHERE order_id = o.id AND status = 'pending';

    -- Abort the subtransaction: rolls back all writes above + enqueued rows.
    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN
      RAISE;
    END IF;
  END;

  ------------------------------------------------------------- T4: RPC enqueue
  BEGIN
    PERFORM public.enqueue_order_push(o.id, 'verification');
    SELECT count(*) INTO v_rpc
    FROM public.sync_queue
    WHERE order_id = o.id AND status = 'pending'
      AND payload ->> 'reason' = 'verification';
    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN
      RAISE;
    END IF;
  END;

  RETURN jsonb_build_object(
    'order_id', o.id,
    'stats', v_stats,
    'before', v_before, 'after1', v_after1, 'after2', v_after2, 'after3', v_after3, 'rpc_rows', v_rpc,
    't1_enqueue_on_customer_edit', (v_after1 - v_before) = 1,
    't1_key_new_format', v_key1 LIKE 'push:%:%:%',
    't1_key_sample', v_key1,
    'minute_boundary_crossed', v_minute1 IS DISTINCT FROM v_minute2,
    't2_coalesce_same_minute', (v_after2 - v_after1) = 0,
    't3_echo_suppressed', (v_after3 - v_after2) = 0,
    't4_rpc_enqueue', v_rpc = 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_push_triggers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_push_triggers() TO anon, authenticated, service_role;