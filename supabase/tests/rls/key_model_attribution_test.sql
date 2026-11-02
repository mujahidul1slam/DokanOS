-- =============================================================================
-- Key-model attribution (migration 20261103140000_key_model_attribution.sql)
-- =============================================================================
-- Pins the structural attribution contract for orders + customers:
--
--   1. business_id is THE tenancy key. The derivation triggers stamp it from
--      the attribution bindings (order_source_id -> brand -> business, then
--      store_id -> brand.woo_store_id -> brand -> business, then — orders only
--      — storefront_id -> store -> brand -> business) on INSERT and whenever a
--      binding column changes. An INSERT with no derivable binding falls back
--      to the member's active business context (POS local-store orders stay
--      creatable and are TENANTED, not shared); a privileged writer with no
--      context keeps business_id NULL (the shared-pool doctrine).
--   2. RLS is tenancy-shaped (5 policies per table): one unified read (own
--      business + the shared unstamped pool), fail-closed insert
--      (business_id = context), bound-only update, business-scoped delete, and
--      the owner/admin/manager pool-reassign ladder for unbound rows.
--   3. The `legacy migration` tag is DATA: no policy references it.
--   4. Binding integrity rides the trigger: binding a FOREIGN business's
--      source re-derives business_id to the foreign business, which the
--      WITH CHECK (business_id = current_business_context()) rejects.
--   5. The update policy's bound restriction is load-bearing: PostgreSQL ORs
--      USING and WITH CHECK independently, so a staff-updateable unbound row
--      plus any bound-allowing WITH CHECK would let staff reassign. Staff
--      therefore cannot touch unbound rows; the ladder is the only update
--      path for them.
--
-- Fixture users/roles per _harness.md (seeded by run-rls-tests.mjs):
--   OWNER_A  00000000-…-0001  owner   BIZ_A (active context BIZ_A)
--   MEMBER_A 00000000-…-0004  manager BIZ_A (active context BIZ_A)
--   VIEWER_A 00000000-…-0005  staff   BIZ_A (active context BIZ_A)
--   OWNER_B  00000000-…-0006  owner   BIZ_B (active context BIZ_B)
--   OUTSIDER 00000000-…-0007  no membership, no context
-- Everything runs inside the harness transaction and is rolled back.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Part 1 — static shape
-- ---------------------------------------------------------------------------

-- 1a. Both derivation triggers exist and are enabled.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_trigger
   WHERE tgrelid = 'public.orders'::regclass
     AND tgisinternal = false
     AND tgenabled <> 'D'
     AND tgname = 'trg_orders_derive_business_id';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL 1a: orders derivation trigger missing/disabled';
  END IF;
  SELECT count(*) INTO v_count
    FROM pg_trigger
   WHERE tgrelid = 'public.customers'::regclass
     AND tgisinternal = false
     AND tgenabled <> 'D'
     AND tgname = 'trg_customers_derive_business_id';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL 1a: customers derivation trigger missing/disabled';
  END IF;
  RAISE NOTICE 'PASS 1a: derivation triggers exist and are enabled on orders + customers';
END $$;

-- 1b. Exactly 5 policies per table (the tenancy set).
DO $$
DECLARE
  v_orders integer;
  v_customers integer;
BEGIN
  SELECT count(*) INTO v_orders FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'orders';
  SELECT count(*) INTO v_customers FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'customers';
  IF v_orders <> 5 OR v_customers <> 5 THEN
    RAISE EXCEPTION 'FAIL 1b: expected 5 policies per table, got orders=% customers=%',
      v_orders, v_customers;
  END IF;
  RAISE NOTICE 'PASS 1b: 5 policies per table (orders %, customers %)', v_orders, v_customers;
END $$;

-- 1c. No policy references the pool tag — the tag is data, not a predicate.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('orders', 'customers')
     AND (coalesce(qual, '') LIKE '%legacy migration%'
       OR coalesce(with_check, '') LIKE '%legacy migration%');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 1c: % policies still reference the pool tag', v_count;
  END IF;
  RAISE NOTICE 'PASS 1c: no policy references the legacy-migration tag';
END $$;

-- 1d. The derivation functions are SECURITY DEFINER with a locked search_path.
--     (proconfig stores the setting verbatim as `search_path=""`.)
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc
   WHERE proname IN ('derive_order_business_id', 'derive_customer_business_id')
     AND prosecdef = true
     AND proconfig @> ARRAY['search_path=""'];
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL 1d: derivation functions must be SECURITY DEFINER with search_path=%',
      v_count;
  END IF;
  RAISE NOTICE 'PASS 1d: derivation functions are SECURITY DEFINER with search_path=''''';
END $$;

-- ---------------------------------------------------------------------------
-- Part 2 — behavioral (fixtures in BIZ_A / BIZ_B)
-- ---------------------------------------------------------------------------

-- Fixture (deterministic UUIDs; rolled back with the transaction):
--   store A + brand A (BIZ_A, woo_store_id -> store A) + storefront A (-> store A)
--   store B + brand B (BIZ_B, woo_store_id -> store B)
--   order source A (brand A) + order source B (brand B)
INSERT INTO public.stores (id, name, url, status)
VALUES ('71700000-0000-0000-0000-000000000001', 'KM Store A', 'https://km-a.test', 'connected'),
       ('71700000-0000-0000-0000-000000000002', 'KM Store B', 'https://km-b.test', 'connected');
INSERT INTO public.brands (id, business_id, name, slug, woo_store_id)
VALUES ('61600000-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000001',
        'KM Brand A', 'km-brand-a',
        '71700000-0000-0000-0000-000000000001'),
       ('61600000-0000-0000-0000-000000000002',
        '11111111-0000-0000-0000-000000000002',
        'KM Brand B', 'km-brand-b',
        '71700000-0000-0000-0000-000000000002');
INSERT INTO public.storefronts (id, name, store_id, slug)
VALUES ('7a700000-0000-0000-0000-000000000001', 'KM Storefront A',
        '71700000-0000-0000-0000-000000000001', 'km-storefront-a');
INSERT INTO public.order_sources (id, brand_id, name, type)
VALUES ('6b600000-0000-0000-0000-000000000001',
        '61600000-0000-0000-0000-000000000001', 'KM Source A', 'manual'),
       ('6b600000-0000-0000-0000-000000000002',
        '61600000-0000-0000-0000-000000000002', 'KM Source B', 'manual');

-- ---------------------------------------------------------------------------
-- 2a. Member INSERT with an own order source -> the trigger stamps BIZ_A and
--     the fail-closed INSERT policy passes.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE
  v_business uuid;
BEGIN
  INSERT INTO public.orders (id, order_number, source, order_source_id)
  VALUES ('81810000-0000-0000-0000-000000000001', 'KM-ORDER-1', 'online',
          '6b600000-0000-0000-0000-000000000001');
  SELECT business_id INTO v_business FROM public.orders
   WHERE id = '81810000-0000-0000-0000-000000000001';
  IF v_business IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL 2a: source-bound insert not stamped with BIZ_A (got %)', v_business;
  END IF;
  RAISE NOTICE 'PASS 2a: source-bound member insert auto-stamped BIZ_A';
END $$;

-- ---------------------------------------------------------------------------
-- 2b. Member INSERT with NO bindings -> context fallback -> tenanted BIZ_A,
--     NOT a shared pool row.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_business uuid;
BEGIN
  INSERT INTO public.orders (id, order_number, source)
  VALUES ('81810000-0000-0000-0000-000000000002', 'KM-ORDER-2', 'pos');
  SELECT business_id INTO v_business FROM public.orders
   WHERE id = '81810000-0000-0000-0000-000000000002';
  IF v_business IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL 2b: unbound member insert should fall back to the active context (got %)',
      v_business;
  END IF;
  RAISE NOTICE 'PASS 2b: unbound member insert is context-tenanted (POS local-store flow)';
END $$;

-- ---------------------------------------------------------------------------
-- 2c. Foreign-binding rejection: rebinding to BIZ_B's order source
--     re-derives business_id to BIZ_B, which the WITH CHECK rejects.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    UPDATE public.orders
       SET order_source_id = '6b600000-0000-0000-0000-000000000002'
     WHERE id = '81810000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL 2c: foreign order-source binding was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT order_source_id FROM public.orders
       WHERE id = '81810000-0000-0000-0000-000000000001')
     IS DISTINCT FROM '6b600000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL 2c: rejected update changed the row';
  END IF;
  RAISE NOTICE 'PASS 2c: foreign order-source binding rejected (42501), row unchanged';
END $$;

-- ---------------------------------------------------------------------------
-- 2d. Unbind keeps the stamped value: clearing the bindings leaves
--     business_id = BIZ_A (the row becomes pool-shaped but stays tenanted).
-- ---------------------------------------------------------------------------
RESET ROLE;
DO $$
DECLARE
  v_business uuid;
  v_unbound boolean;
BEGIN
  UPDATE public.orders
     SET order_source_id = NULL
   WHERE id = '81810000-0000-0000-0000-000000000001';
  SELECT business_id, (store_id IS NULL AND storefront_id IS NULL AND order_source_id IS NULL)
    INTO v_business, v_unbound
    FROM public.orders
   WHERE id = '81810000-0000-0000-0000-000000000001';
  IF v_business IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' OR NOT v_unbound THEN
    RAISE EXCEPTION 'FAIL 2d: unbind must keep the stamp and leave the row unbound (business=% unbound=%)',
      v_business, v_unbound;
  END IF;
  RAISE NOTICE 'PASS 2d: unbind keeps the stamped business_id (pool-shaped, tenanted)';
END $$;

-- ---------------------------------------------------------------------------
-- 2e. Staff cannot update an unbound-but-tenanted row (the independent-OR
--     guard: the general update policy is bound-only, the ladder is
--     manager+). 0 rows, no error.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE
  v_rc integer;
BEGIN
  UPDATE public.orders SET source = 'pos'
   WHERE id = '81810000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL 2e: staff updated an unbound row (% rows)', v_rc;
  END IF;
  RAISE NOTICE 'PASS 2e: staff cannot touch unbound rows (0 rows)';
END $$;

-- ---------------------------------------------------------------------------
-- 2f. The ladder can: a manager updates the same unbound-but-tenanted row.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE
  v_rc integer;
BEGIN
  UPDATE public.orders SET source = 'pos'
   WHERE id = '81810000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL 2f: manager could not update the unbound-but-tenanted row (% rows)', v_rc;
  END IF;
  RAISE NOTICE 'PASS 2f: manager updates unbound-but-tenanted rows via the ladder';
END $$;

-- ---------------------------------------------------------------------------
-- 2g/2h. Storefront-leg and store-leg derivation (privileged writes).
-- ---------------------------------------------------------------------------
RESET ROLE;
DO $$
DECLARE
  v_business uuid;
BEGIN
  INSERT INTO public.orders (id, order_number, source, storefront_id)
  VALUES ('81810000-0000-0000-0000-000000000003', 'KM-ORDER-3', 'online',
          '7a700000-0000-0000-0000-000000000001');
  SELECT business_id INTO v_business FROM public.orders
   WHERE id = '81810000-0000-0000-0000-000000000003';
  IF v_business IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL 2g: storefront-leg derivation failed (got %)', v_business;
  END IF;

  INSERT INTO public.orders (id, order_number, source, store_id)
  VALUES ('81810000-0000-0000-0000-000000000004', 'KM-ORDER-4', 'pos',
          '71700000-0000-0000-0000-000000000001');
  SELECT business_id INTO v_business FROM public.orders
   WHERE id = '81810000-0000-0000-0000-000000000004';
  IF v_business IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL 2h: store-leg derivation failed (got %)', v_business;
  END IF;
  RAISE NOTICE 'PASS 2g/2h: storefront-leg and store-leg derivation stamp BIZ_A';
END $$;

-- ---------------------------------------------------------------------------
-- 2i. Customer trigger: origin-source leg, store leg, context fallback.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE
  v_business uuid;
BEGIN
  INSERT INTO public.customers (id, name, source, origin_kind, origin_order_source_id)
  VALUES ('91910000-0000-0000-0000-000000000001', 'KM Customer 1', 'online', 'woo_sync',
          '6b600000-0000-0000-0000-000000000001');
  SELECT business_id INTO v_business FROM public.customers
   WHERE id = '91910000-0000-0000-0000-000000000001';
  IF v_business IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL 2i: customer origin-source leg failed (got %)', v_business;
  END IF;

  INSERT INTO public.customers (id, name, source, origin_kind, store_id)
  VALUES ('91910000-0000-0000-0000-000000000002', 'KM Customer 2', 'pos', 'pos',
          '71700000-0000-0000-0000-000000000001');
  SELECT business_id INTO v_business FROM public.customers
   WHERE id = '91910000-0000-0000-0000-000000000002';
  IF v_business IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL 2i: customer store leg failed (got %)', v_business;
  END IF;

  INSERT INTO public.customers (id, name, source, origin_kind)
  VALUES ('91910000-0000-0000-0000-000000000003', 'KM Customer 3', 'manual', 'manual');
  SELECT business_id INTO v_business FROM public.customers
   WHERE id = '91910000-0000-0000-0000-000000000003';
  IF v_business IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL 2i: customer context fallback failed (got %)', v_business;
  END IF;
  RAISE NOTICE 'PASS 2i: customer trigger derives via origin source, store, and context fallback';
END $$;

-- ---------------------------------------------------------------------------
-- 2j. Cross-business denial + outsider fail-closed: BIZ_B's owner and the
--     outsider see none of BIZ_A's stamped rows.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.orders
   WHERE id IN ('81810000-0000-0000-0000-000000000001',
                '81810000-0000-0000-0000-000000000002');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 2j: OWNER_B sees % BIZ_A orders', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.customers
   WHERE id IN ('91910000-0000-0000-0000-000000000001',
                '91910000-0000-0000-0000-000000000002',
                '91910000-0000-0000-0000-000000000003');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 2j: OWNER_B sees % BIZ_A customers', v_count;
  END IF;
  RAISE NOTICE 'PASS 2j: cross-business owner sees none of the stamped rows';
END $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.orders
   WHERE id IN ('81810000-0000-0000-0000-000000000001',
                '81810000-0000-0000-0000-000000000002');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 2j: outsider sees % BIZ_A orders', v_count;
  END IF;
  RAISE NOTICE 'PASS 2j: outsider sees nothing (fail-closed)';
END $$;

-- ---------------------------------------------------------------------------
-- 2k. A privileged writer with no context keeps business_id NULL: the insert
--     is a shared pool row (the service_role doctrine; postgres bypasses RLS
--     via ownership, so no policy rejects it).
-- ---------------------------------------------------------------------------
RESET ROLE;
DO $$
DECLARE
  v_business uuid;
BEGIN
  INSERT INTO public.orders (id, order_number, source)
  VALUES ('81810000-0000-0000-0000-000000000005', 'KM-ORDER-5', 'legacy migration');
  SELECT business_id INTO v_business FROM public.orders
   WHERE id = '81810000-0000-0000-0000-000000000005';
  IF v_business IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 2k: context-less privileged insert should stay shared (got %)', v_business;
  END IF;
  RAISE NOTICE 'PASS 2k: context-less privileged insert stays business_id NULL (shared pool)';
END $$;

ROLLBACK;
