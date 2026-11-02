-- Task 15: the Legacy / unattributed pool (spec §7). Pool rows are the ones
-- scripts/migrate-enveil-vincent.sql step 10 (lines 361-374) tags:
--   orders    source='legacy migration' + the three surviving binding columns
--             NULL (Task 16 dropped selling_point_id; storefront_id remains a
--             pool predicate)
--   customers source='legacy migration' + origin_kind='legacy' + the two
--             binding columns NULL
-- They carry NO business/brand binding, so their RLS leg is membership in the
-- server-side ACTIVE business context (documented trade-off in
-- 20261102120000_legacy_pool_rls.sql: unowned rows are shared by whichever
-- business a member has active; post-migration there is one tenant/one pool).
-- Task 16 adds the account leg: a stamped pool row (business_id set) is
-- visible only to its own business; unstamped rows stay shared.
-- Once reassigned they are tenanted again through the brand's order source
-- (the binding the migration's own inference writes) — and cross-business
-- denial then holds. Spec §5 ladder (post-Task-12 values): all members read;
-- owner/admin/manager reassign; staff read-only. Fixture ids per _harness.md.

BEGIN;

-- ---- fixtures (postgres; pool rows cannot pass the store-scoped INSERT
--      policies, which is exactly why they are pool rows) ----
INSERT INTO public.brands (id, business_id, name, slug)
VALUES ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
        'Pool Fixture Brand', 'pool-fixture-brand'),
       ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002',
        'Pool Foreign Brand', 'pool-foreign-brand');

INSERT INTO public.order_sources (id, brand_id, name, type)
VALUES ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
        'Pool Fixture Source', 'manual'),
       ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002',
        'Pool Foreign Source', 'manual');

INSERT INTO public.orders (id, order_number, source)
VALUES ('44444444-0000-0000-0000-000000000001', 'POOL-1', 'legacy migration'),
       ('44444444-0000-0000-0000-000000000002', 'POOL-2', 'legacy migration');

INSERT INTO public.customers (id, name, source, origin_kind)
VALUES ('55555555-0000-0000-0000-000000000001', 'Pool Person One', 'legacy migration', 'legacy'),
       ('55555555-0000-0000-0000-000000000002', 'Pool Person Two', 'legacy migration', 'legacy');

-- ---- Manager (…004): reads the pool; reassigns to own brand's source; a
--      cross-business binding is rejected by WITH CHECK (Shape A). ----
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.orders
      WHERE source = 'legacy migration' AND store_id IS NULL
        AND storefront_id IS NULL
        AND order_source_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'FAIL: manager could not read the two unowned pool orders' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.customers
      WHERE source = 'legacy migration' AND origin_kind = 'legacy'
        AND store_id IS NULL AND origin_order_source_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'FAIL: manager could not read the two unowned pool customers' USING ERRCODE = 'P0001';
  END IF;

  -- Cross-business reassign target must be rejected (WITH CHECK, Shape A).
  BEGIN
    UPDATE public.orders
    SET order_source_id = '33333333-0000-0000-0000-000000000002'
    WHERE id = '44444444-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL: cross-business reassign binding was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Legit reassign: brand binding through the source (store-less brand path,
  -- exactly what the migration's step-9 inference writes).
  UPDATE public.orders
  SET order_source_id = '33333333-0000-0000-0000-000000000001'
  WHERE id = '44444444-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: manager reassign matched % rows', v_rc USING ERRCODE = 'P0001';
  END IF;

  -- Reassigned order stays visible to its own business (source-attribution
  -- leg) and has drained from the pool predicate.
  IF (SELECT count(*) FROM public.orders
      WHERE id = '44444444-0000-0000-0000-000000000001'
        AND order_source_id = '33333333-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'FAIL: reassigned order is not visible via its source binding' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.orders
      WHERE source = 'legacy migration' AND store_id IS NULL
        AND storefront_id IS NULL
        AND order_source_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAIL: reassigned order did not drain from the pool' USING ERRCODE = 'P0001';
  END IF;

  -- Customer reassign keeps provenance `legacy` (spec §7).
  UPDATE public.customers
  SET origin_order_source_id = '33333333-0000-0000-0000-000000000001'
  WHERE id = '55555555-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: manager customer reassign matched % rows', v_rc USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.customers
      WHERE id = '55555555-0000-0000-0000-000000000001'
        AND origin_order_source_id = '33333333-0000-0000-0000-000000000001'
        AND origin_kind = 'legacy') <> 1 THEN
    RAISE EXCEPTION 'FAIL: reassigned customer lost its legacy provenance or source binding' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- ---- Staff (…005): reads the pool but cannot reassign (Shape A′: in-block
--      rowcount + owner-side value-pinned survival). ----
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.orders
      WHERE source = 'legacy migration' AND store_id IS NULL
        AND storefront_id IS NULL
        AND order_source_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAIL: staff could not read the remaining pool order' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.orders
    SET order_source_id = '33333333-0000-0000-0000-000000000001'
    WHERE id = '44444444-0000-0000-0000-000000000002';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: staff reassigned % pool orders', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;

  BEGIN
    UPDATE public.customers
    SET origin_order_source_id = '33333333-0000-0000-0000-000000000001'
    WHERE id = '55555555-0000-0000-0000-000000000002';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: staff reassigned % pool customers', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.orders
                 WHERE id = '44444444-0000-0000-0000-000000000002'
                   AND source = 'legacy migration'
                   AND order_source_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL: pool order survival (staff write)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers
                 WHERE id = '55555555-0000-0000-0000-000000000002'
                   AND origin_kind = 'legacy'
                   AND origin_order_source_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL: pool customer survival (staff write)' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---- Owner of the OTHER business (…006, context B_other): the reassigned
--      rows are tenanted again and invisible (cross-business denial holds);
--      the still-unowned pool rows are shared by design — they belong to no
--      business at all (documented trade-off in the migration header).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.orders
      WHERE id = '44444444-0000-0000-0000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'FAIL: reassigned order crossed into the other business' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.customers
      WHERE id = '55555555-0000-0000-0000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'FAIL: reassigned customer crossed into the other business' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.orders
      WHERE id = '44444444-0000-0000-0000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'FAIL: unowned pool rows are no longer shared across active businesses' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- ---- Outsider (…007, no membership, no active context): fails closed on
--      everything, including the unowned pool. ----
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.orders
      WHERE source = 'legacy migration') <> 0 THEN
    RAISE EXCEPTION 'FAIL: outsider saw pool orders' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.customers
      WHERE source = 'legacy migration') <> 0 THEN
    RAISE EXCEPTION 'FAIL: outsider saw pool customers' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
