-- task16_contract_drop_test.sql — Task 16 (spec §8): the legacy contract drop.
--
-- Pins the post-drop contract end to end:
--   Part 1 (static): the seven legacy tables are gone; the five dead binding
--     columns are gone; orders/customers carry the new business_id account
--     stamp; the four recreated pool policies exist and none of the surviving
--     orders/customers policies still reference selling_point_id;
--     publish_my_storefront exists and no longer touches the dropped
--     channel-point table; the dead brand_stores RPCs are gone; the legacy_*
--     mapping columns on order_sources survive the drop.
--   Part 2 (behavioral, fixture in BIZ_A): a pool order and a pool customer
--     are visible to an account member while unstamped (business_id NULL),
--     invisible to an outsider; stamping them with the caller's business keeps
--     them visible to that business only; reassignment drains the pool through
--     the store-bound and source-bound WITH CHECK branches; a cross-account
--     stamp is refused; the storefront leg still removes a row from the pool;
--     anon is denied at the grant layer.
--
-- Single transaction: everything rolls back.

BEGIN;

-- ===========================================================================
-- Part 1 — static invariants
-- ===========================================================================

DO $$
DECLARE
  v_missing text;
BEGIN
  -- 1a. the seven dropped tables are gone
  FOREACH v_missing IN ARRAY ARRAY[
    'public.brand_stores',
    'public.selling_points',
    'public.locations',
    'public.connectors',
    'public.product_sources',
    'public.customer_sources',
    'public.legacy_order_channels'
  ] LOOP
    IF to_regclass(v_missing) IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL 1a: % still exists', v_missing USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS 1a: legacy tables dropped (7)';
END $$;

DO $$
DECLARE
  v_still_there int;
BEGIN
  -- 1b. the five dead binding columns are gone
  SELECT count(*) INTO v_still_there
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'orders' AND column_name IN ('selling_point_id', 'location_id'))
      OR (table_name = 'product_locations' AND column_name = 'location_id')
      OR (table_name = 'purchase_orders' AND column_name = 'location_id')
      OR (table_name = 'pos_shifts' AND column_name = 'selling_point_id')
    );
  IF v_still_there <> 0 THEN
    RAISE EXCEPTION 'FAIL 1b: % dead binding column(s) still exist', v_still_there
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 1b: dead binding columns dropped (5)';
END $$;

DO $$
DECLARE
  v_missing int;
BEGIN
  -- 1c. the account stamp columns exist on orders and customers
  SELECT count(*) INTO v_missing
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('orders', 'customers')
    AND column_name = 'business_id';
  IF v_missing <> 2 THEN
    RAISE EXCEPTION 'FAIL 1c: business_id stamp missing on orders/customers (%/2)', v_missing
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 1c: business_id stamp present on orders + customers';
END $$;

DO $$
DECLARE
  v_policies int;
  v_pinned int;
BEGIN
  -- 1d. the four recreated pool policies exist
  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('orders', 'customers')
    AND policyname LIKE 'Legacy pool %';
  IF v_policies <> 4 THEN
    RAISE EXCEPTION 'FAIL 1d: expected 4 pool policies, found %', v_policies
      USING ERRCODE = 'P0001';
  END IF;

  -- 1e. no surviving orders/customers policy still references selling_point_id
  SELECT count(*) INTO v_pinned
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('orders', 'customers')
    AND (coalesce(qual, '') LIKE '%selling_point_id%'
         OR coalesce(with_check, '') LIKE '%selling_point_id%');
  IF v_pinned <> 0 THEN
    RAISE EXCEPTION 'FAIL 1e: % surviving policy/policies still reference selling_point_id', v_pinned
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 1d/1e: 4 pool policies, none reference selling_point_id';
END $$;

DO $$
DECLARE
  v_def text;
BEGIN
  -- 1f. publish_my_storefront exists and no longer reads the dropped table
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'publish_my_storefront';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL 1f: publish_my_storefront is missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_def LIKE '%selling_points%' THEN
    RAISE EXCEPTION 'FAIL 1f: publish_my_storefront still references the dropped channel-point table'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_def NOT LIKE '%brands%' THEN
    RAISE EXCEPTION 'FAIL 1f: publish_my_storefront does not resolve ownership via brands'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 1f: publish_my_storefront rewritten on the brand leg';
END $$;

DO $$
BEGIN
  -- 1g. the dead brand_stores RPCs are gone
  IF to_regprocedure('public.create_brand_store(uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 1g: create_brand_store(uuid,text,text) still exists' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.brand_store_legacy_links_valid(uuid,uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 1g: brand_store_legacy_links_valid(uuid,uuid,uuid,uuid) still exists'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 1g: dead brand_stores RPCs dropped';
END $$;

DO $$
DECLARE
  v_mapping int;
BEGIN
  -- 1h. the legacy_* mapping columns on order_sources survive the drop
  SELECT count(*) INTO v_mapping
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'order_sources'
    AND column_name IN ('legacy_store_id', 'legacy_selling_point_id', 'legacy_woo_store_id');
  IF v_mapping <> 3 THEN
    RAISE EXCEPTION 'FAIL 1h: order_sources legacy mapping columns incomplete (%/3)', v_mapping
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 1h: legacy mapping columns survive';
END $$;

DO $$
DECLARE
  v_def text;
BEGIN
  -- 1i. the one-holder CHECK survived the location_id drop in its two-way form
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relname = 'product_locations'
    AND c.conname = 'product_locations_one_holder';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL 1i: product_locations_one_holder CHECK is missing' USING ERRCODE = 'P0001';
  END IF;
  IF v_def LIKE '%location_id%' THEN
    RAISE EXCEPTION 'FAIL 1i: one-holder CHECK still counts the dropped location holder' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 1i: one-holder CHECK rebuilt in the two-way form';
END $$;

-- ===========================================================================
-- Part 2 — behavioral (fixture in BIZ_A)
-- ===========================================================================

-- Fixture (deterministic UUIDs; rolled back with the transaction):
--   brand/store/storefront/order_source in BIZ_A, linked brands.woo_store_id,
--   one pool order + one pool customer (unbound, unstamped).
INSERT INTO public.stores (id, name, url, status)
VALUES ('17170000-0000-0000-0000-000000000001', 'T16 Contract Store', 'https://t16.contract.test', 'connected');
INSERT INTO public.brands (id, business_id, name, slug, woo_store_id)
VALUES ('16160000-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000001',
        'T16 Contract Brand', 't16-contract-brand',
        '17170000-0000-0000-0000-000000000001');
INSERT INTO public.storefronts (id, name, store_id, slug)
VALUES ('1a1a0000-0000-0000-0000-000000000001', 'T16 Contract Storefront',
        '17170000-0000-0000-0000-000000000001', 't16-contract-storefront');
INSERT INTO public.order_sources (id, brand_id, name, type)
VALUES ('1b1b0000-0000-0000-0000-000000000001',
        '16160000-0000-0000-0000-000000000001', 'T16 Contract Source', 'manual');
INSERT INTO public.orders (id, order_number, source)
VALUES ('18180000-0000-0000-0000-000000000001', 'T16-POOL-1', 'legacy migration');
INSERT INTO public.customers (id, name, source, origin_kind)
VALUES ('19190000-0000-0000-0000-000000000001', 'T16 Pool Customer', 'legacy migration', 'legacy');

-- ---------------------------------------------------------------------------
-- 2a. anon is denied at the grant layer (no anon policy, no grant)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.orders;
    RAISE EXCEPTION 'FAIL 2a: anon read orders' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.customers;
    RAISE EXCEPTION 'FAIL 2a: anon read customers' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2b. OWNER_A sees the unstamped pool rows (business_id NULL leg)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  SELECT count(*) INTO v_rc
  FROM public.orders WHERE id = '18180000-0000-0000-0000-000000000001';
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2b: owner cannot read the unstamped pool order (rowcount %)', v_rc
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_rc
  FROM public.customers WHERE id = '19190000-0000-0000-0000-000000000001';
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2b: owner cannot read the unstamped pool customer (rowcount %)', v_rc
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 2b: unstamped pool rows visible to the account member';
END $$;

-- ---------------------------------------------------------------------------
-- 2c. OUTSIDER sees nothing and can change nothing (USING filters → 0 rows)
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  SELECT count(*) INTO v_rc
  FROM public.orders WHERE id = '18180000-0000-0000-0000-000000000001';
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL 2c: outsider can read the pool order (rowcount %)', v_rc
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.orders SET notes = 'outsider touch'
   WHERE id = '18180000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL 2c: outsider updated the pool order (% row)', v_rc
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 2c: outsider is blind to the pool';
END $$;
RESET ROLE;

-- Owner-side survival check: the outsider's no-op UPDATE left the row intact.
DO $$
DECLARE v_rc bigint;
BEGIN
  SELECT count(*) INTO v_rc FROM public.orders
   WHERE id = '18180000-0000-0000-0000-000000000001'
     AND notes IS DISTINCT FROM 'outsider touch';
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2c: pool order survival after outsider UPDATE' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2d. stamping with the caller's own business keeps the row in the pool
--     (reassign WITH CHECK: still-pool branch with business_id = context)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  UPDATE public.orders SET business_id = '11111111-0000-0000-0000-000000000001'
   WHERE id = '18180000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2d: owner could not stamp the pool order with their own business'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_rc FROM public.orders WHERE id = '18180000-0000-0000-0000-000000000001';
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2d: own-business stamp hid the row from its own business'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 2d: own-business stamp accepted and still visible';
END $$;

-- ---------------------------------------------------------------------------
-- 2e. a cross-account stamp is refused (WITH CHECK: not still-pool for this
--     context, no store binding, no source binding)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE public.orders SET business_id = '11111111-0000-0000-0000-000000000002'
   WHERE id = '18180000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FAIL 2e: cross-account stamp did not raise' USING ERRCODE = 'P0001';
EXCEPTION
  WHEN insufficient_privilege THEN NULL; -- expected: new row violates row-level security policy
END $$;

-- ---------------------------------------------------------------------------
-- 2f. store-bound reassignment drains the pool (WITH CHECK store branch)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_rc bigint;
BEGIN
  UPDATE public.orders SET store_id = '17170000-0000-0000-0000-000000000001'
   WHERE id = '18180000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2f: owner could not reassign the pool order to their store'
      USING ERRCODE = 'P0001';
  END IF;
  -- drained: no longer pool-shaped
  SELECT count(*) INTO v_rc FROM public.orders
   WHERE id = '18180000-0000-0000-0000-000000000001'
     AND source = 'legacy migration' AND store_id IS NULL;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL 2f: reassigned order still reads as pool' USING ERRCODE = 'P0001';
  END IF;
  -- and it is now visible through the store-bound read policy
  SELECT count(*) INTO v_rc FROM public.orders WHERE id = '18180000-0000-0000-0000-000000000001';
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2f: reassigned order invisible via the store-bound policy'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 2f: store-bound reassignment drains the pool';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2g. source-bound reassignment drains the pool (WITH CHECK source branch)
-- ---------------------------------------------------------------------------
UPDATE public.orders SET store_id = NULL
 WHERE id = '18180000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  UPDATE public.orders SET order_source_id = '1b1b0000-0000-0000-0000-000000000001'
   WHERE id = '18180000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2g: owner could not reassign the pool order to their order source'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_rc FROM public.orders
   WHERE id = '18180000-0000-0000-0000-000000000001'
     AND source = 'legacy migration' AND order_source_id IS NULL;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL 2g: source-reassigned order still reads as pool' USING ERRCODE = 'P0001';
  END IF;
  -- visible through the source-attributed read policy
  SELECT count(*) INTO v_rc FROM public.orders WHERE id = '18180000-0000-0000-0000-000000000001';
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2g: source-reassigned order invisible via the source-attributed policy'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 2g: source-bound reassignment drains the pool';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2h. the storefront leg still removes a row from the pool (column kept).
--     Storefront-bound rows are a DATA shape, not a reassign destination: the
--     pool drains to store or source bindings, so the storefront leg is
--     exercised as postgres (simulating legacy data) and asserted read-side.
-- ---------------------------------------------------------------------------
UPDATE public.orders SET order_source_id = NULL
 WHERE id = '18180000-0000-0000-0000-000000000001';
UPDATE public.orders SET storefront_id = '1a1a0000-0000-0000-0000-000000000001'
 WHERE id = '18180000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  SELECT count(*) INTO v_rc FROM public.orders
   WHERE id = '18180000-0000-0000-0000-000000000001'
     AND source = 'legacy migration' AND storefront_id IS NULL;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL 2h: storefront-bound order still reads as pool' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 2h: storefront leg still drains the pool';
END $$;
RESET ROLE;
UPDATE public.orders SET storefront_id = NULL
 WHERE id = '18180000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- 2i. pool customer reassignment drains through the store branch
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  UPDATE public.customers SET store_id = '17170000-0000-0000-0000-000000000001'
   WHERE id = '19190000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2i: owner could not reassign the pool customer to their store'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_rc FROM public.customers
   WHERE id = '19190000-0000-0000-0000-000000000001'
     AND source = 'legacy migration' AND store_id IS NULL;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL 2i: reassigned customer still reads as pool' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'PASS 2i: pool customer reassignment drains the pool';
END $$;

RESET ROLE;
ROLLBACK;
