-- v3: T3 was self-defeating — the variation's enqueue key
-- (stock:{parent}:{minute}) is IDENTICAL to T1's key for the same product in
-- the same minute, so ON CONFLICT DO NOTHING coalesced it (correct dedup
-- behavior!). T3 now runs against a DIFFERENT product than T1/T2.
CREATE OR REPLACE FUNCTION public.verify_stock_triggers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;      -- product for T1/T2
  pv record;     -- different product (with variations) for T3
  v_before int; v_after1 int; v_after2 int; v_after3 int; v_recov int;
  v_key text;
  v_count int;
BEGIN
  SELECT pr.id, pr.stock_quantity, pr.stock_status, pr.woo_product_id, pr.store_id
  INTO p
  FROM public.products pr
  WHERE pr.woo_product_id IS NOT NULL AND pr.store_id IS NOT NULL
  ORDER BY pr.updated_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no woo-linked product found');
  END IF;

  -- T3 needs a DIFFERENT Woo-linked product that has Woo-linked variations.
  SELECT pr.id, pr.store_id INTO pv
  FROM public.products pr
  WHERE pr.woo_product_id IS NOT NULL AND pr.store_id IS NOT NULL
    AND pr.id <> p.id
    AND EXISTS (SELECT 1 FROM public.product_variations x
               WHERE x.product_id = pr.id AND x.woo_variation_id IS NOT NULL)
  ORDER BY pr.updated_at DESC
  LIMIT 1;

  SELECT count(*) INTO v_before
  FROM public.sync_queue
  WHERE action = 'push_stock' AND payload->>'product_id' = p.id::text
    AND status = 'pending';

  BEGIN
    -- T1: local stock edit
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

    -- T3: variation edit enqueues the PARENT (different product than T1/T2)
    IF FOUND AND pv.id IS NOT NULL THEN
      UPDATE public.product_variations
      SET stock_quantity = COALESCE(stock_quantity, 0) + 1
      WHERE product_id = pv.id AND woo_variation_id IS NOT NULL;
      SELECT count(*) INTO v_after3
      FROM public.sync_queue
      WHERE action = 'push_stock' AND payload->>'product_id' = pv.id::text
        AND status = 'pending';
    ELSE
      v_after3 := -1;  -- untested
    END IF;

    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN RAISE; END IF;
  END;

  -- T4: orphan recovery RPC (rolled back; proves mechanics only)
  BEGIN
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
    't3_product_id', pv.id,
    'before', v_before, 'after1', v_after1, 'after2', v_after2,
    'after3', v_after3, 'recovered', v_recov,
    'residual_pending_stock', v_count,
    't1_enqueue_on_stock_edit', (v_after1 - v_before) >= 1,
    't1_key_format', v_key LIKE 'stock:%:%',
    't2_echo_suppressed', (v_after2 - v_after1) = 0,
    't3_variation_enqueues_parent', v_after3 >= 1,
    't3_tested', v_after3 <> -1,
    't4_orphan_recovery_worked', coalesce(v_recov, 0) >= 1,
    'no_residual_rows', v_count = 0
  );
END;
$$;