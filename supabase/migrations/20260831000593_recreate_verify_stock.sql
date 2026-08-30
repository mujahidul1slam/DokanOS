-- TEMPORARY Phase-3 verification harness (rollback-safe via exception
-- subtransactions, same pattern as 20260831000391). Tests:
--   T1: local stock edit on Woo-linked product enqueues push_stock
--   T2: Woo-origin stock write (woo_updated_at stamp) does NOT enqueue
--   T3: variation stock edit enqueues the PARENT's push_stock
--   T4: recover_orphaned_sync_rows resets stale processing rows (per-row attempts)
-- Dropped by 20260831000592 after the run.

CREATE OR REPLACE FUNCTION public.verify_stock_triggers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  v_before int; v_after1 int; v_after2 int; v_after3 int; v_recov int;
  v_key text;
  v_count int;
BEGIN
  SELECT id, stock_quantity, stock_status, woo_product_id, store_id INTO p
  FROM public.products
  WHERE woo_product_id IS NOT NULL AND store_id IS NOT NULL
  ORDER BY updated_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no woo-linked product found');
  END IF;

  SELECT count(*) INTO v_before
  FROM public.sync_queue
  WHERE action = 'push_stock' AND payload->>'product_id' = p.id::text
    AND status = 'pending';

  BEGIN
    -- T1: local stock edit
    UPDATE public.products
    SET stock_quantity = GREATEST(COALESCE(stock_quantity, 0), 0)
    WHERE id = p.id;  -- value-identical write still fires trigger only on change;
                      -- force a real change:
    UPDATE public.products
    SET stock_quantity = COALESCE(stock_quantity, 0) + 1
    WHERE id = p.id;

    SELECT count(*) INTO v_after1
    FROM public.sync_queue
    WHERE action = 'push_stock' AND payload->>'product_id' = p.id::text
      AND status = 'pending';
    SELECT max(idempotency_key) INTO v_key
    FROM public.sync_queue
    WHERE action = 'push_stock' AND payload->>'product_id' = p.id::text
      AND idempotency_key LIKE 'stock:%';

    -- T2: Woo-origin write must NOT enqueue
    UPDATE public.products
    SET stock_quantity = COALESCE(stock_quantity, 0) + 1,
        woo_updated_at = now()
    WHERE id = p.id;
    SELECT count(*) INTO v_after2
    FROM public.sync_queue
    WHERE action = 'push_stock' AND payload->>'product_id' = p.id::text
      AND status = 'pending';

    -- T3: variation edit enqueues the PARENT
    UPDATE public.product_variations
    SET stock_quantity = COALESCE(stock_quantity, 0) + 1
    WHERE product_id = p.id AND woo_variation_id IS NOT NULL;
    SELECT count(*) INTO v_after3
    FROM public.sync_queue
    WHERE action = 'push_stock' AND payload->>'product_id' = p.id::text
      AND status = 'pending';

    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN RAISE; END IF;
  END;

  -- T4: orphan recovery RPC — inside an exception block it runs but rolls
  -- back, proving the mechanics without touching real rows.
  BEGIN
    -- fabricate a stale processing row
    INSERT INTO public.sync_queue (store_id, action, payload, status, attempts, updated_at)
    VALUES (p.store_id, 'push_stock', jsonb_build_object('product_id', p.id),
            'processing', 2, now() - interval '20 minutes');
    SELECT public.recover_orphaned_sync_rows(now() - interval '15 minutes') INTO v_recov;
    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_count
  FROM public.sync_queue WHERE action = 'push_stock' AND status = 'pending';

  RETURN jsonb_build_object(
    'product_id', p.id,
    'before', v_before, 'after1', v_after1, 'after2', v_after2,
    'after3', v_after3, 'recovered', v_recov,
    'residual_pending_stock', v_count,
    't1_enqueue_on_stock_edit', (v_after1 - v_before) >= 1,
    't1_key_format', v_key LIKE 'stock:%:%',
    't2_echo_suppressed', (v_after2 - v_after1) = 0,
    't3_variation_enqueues_parent', (v_after3 - v_after2) = 1,
    't4_orphan_recovery_worked', coalesce(v_recov, 0) >= 1,
    'no_residual_rows', v_count = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_stock_triggers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_stock_triggers() TO anon, authenticated, service_role;