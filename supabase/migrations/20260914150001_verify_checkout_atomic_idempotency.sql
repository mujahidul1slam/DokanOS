-- ============================================================================
-- Verification: Storefront Phase 6 atomic checkout, idempotency & PII closure (§9.6)
-- ============================================================================

DO $$
DECLARE
  v_count int;
  v_tbl text;
  v_tbls text[] := ARRAY[
    'orders',
    'order_items',
    'order_payments',
    'order_timeline',
    'customers',
    'stores',
    'categories',
    'product_categories'
  ];
BEGIN
  -- 1. Confirm orders columns exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'idempotency_key') THEN
    RAISE EXCEPTION 'Verification failed: orders.idempotency_key does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'storefront_id') THEN
    RAISE EXCEPTION 'Verification failed: orders.storefront_id does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'stock_restored_at') THEN
    RAISE EXCEPTION 'Verification failed: orders.stock_restored_at does not exist';
  END IF;

  -- 2. Confirm order_items.stock_ledger exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'stock_ledger') THEN
    RAISE EXCEPTION 'Verification failed: order_items.stock_ledger does not exist';
  END IF;

  -- 3. Confirm unique indexes exist
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'uq_orders_idempotency_key') THEN
    RAISE EXCEPTION 'Verification failed: index uq_orders_idempotency_key does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'uq_orders_order_number') THEN
    RAISE EXCEPTION 'Verification failed: index uq_orders_order_number does not exist (L8)';
  END IF;

  -- 4. Confirm RPCs exist
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'storefront_place_order') THEN
    RAISE EXCEPTION 'Verification failed: RPC storefront_place_order does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'storefront_restore_stock') THEN
    RAISE EXCEPTION 'Verification failed: RPC storefront_restore_stock does not exist';
  END IF;

  -- 5. Confirm RPC privileges: service_role has EXECUTE, PUBLIC/anon/authenticated revoked (H6)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_name = 'storefront_place_order'
      AND grantee = 'service_role'
      AND privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Verification failed: service_role missing EXECUTE on storefront_place_order';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_name = 'storefront_place_order'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
      AND privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Verification failed: unauthorized role retains EXECUTE on storefront_place_order';
  END IF;

  -- 6. Confirm zero TO anon policies on the drop list (H1/H5/H7)
  FOREACH v_tbl IN ARRAY v_tbls
  LOOP
    SELECT count(*) INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = v_tbl
      AND (roles @> ARRAY['anon']::name[] OR roles @> ARRAY['public']::name[]);

    IF v_count > 0 THEN
      RAISE EXCEPTION 'Verification failed: % still has % anon policies', v_tbl, v_count;
    END IF;
  END LOOP;

  RAISE NOTICE 'Phase 6 verification passed successfully';
END $$;
