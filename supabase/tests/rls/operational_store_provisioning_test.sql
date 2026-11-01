-- Option B (2026-11-01 user decision): operational-store provisioning bridge.
-- "Members can provision stores" (20261103090000) is a membership-scoped INSERT
-- leg on `stores`, keyed to the SELECTED active business through
-- current_business_context() and the operator-write ladder owner/admin/manager
-- (20261101090000:554-562). Fixture roles per run-rls-tests.mjs:947-951:
--   …001 owner, …003 admin, …004 manager  → ladder (ALLOW)
--   …005 staff (business role 'staff')    → not on the ladder (DENY)
--   …007 no membership / no context       → fail closed (DENY)
-- NO user_store_access grants are involved: user_can_access_store gates on the
-- brand link (20261026120000:43-61). The paired half of the bridge — stamping
-- order_sources.legacy_woo_store_id — is FK semantics (ON DELETE SET NULL),
-- asserted at the bottom outside RLS.

BEGIN;

-- …001 (owner of BIZ_A) provisions a store: the ladder + context pass.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  INSERT INTO public.stores (name, url, status)
  VALUES ('Fixture Provision Owner', 'https://provision-owner.test', 'connected');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL: owner could not provision a store (% )', SQLERRM USING ERRCODE = 'P0001';
END $$;
RESET ROLE;

-- …003 (admin of BIZ_A) provisions a store.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  INSERT INTO public.stores (name, url, status)
  VALUES ('Fixture Provision Admin', 'https://provision-admin.test', 'connected');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL: account admin could not provision a store (% )', SQLERRM USING ERRCODE = 'P0001';
END $$;
RESET ROLE;

-- …004 (manager of BIZ_A) provisions a store.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  INSERT INTO public.stores (name, url, status)
  VALUES ('Fixture Provision Manager', 'https://provision-manager.test', 'connected');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL: manager could not provision a store (% )', SQLERRM USING ERRCODE = 'P0001';
END $$;
RESET ROLE;

-- …005 (business role 'staff') is NOT on the operator ladder → denied.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.stores (name, url, status)
    VALUES ('Fixture Provision Staff', 'https://provision-staff.test', 'disconnected');
    RAISE EXCEPTION 'FAIL: staff-role member provisioned a store' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- …007 (no membership, no active-business context) fails closed.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.stores (name, url, status)
    VALUES ('Fixture Provision Outsider', 'https://provision-outsider.test', 'disconnected');
    RAISE EXCEPTION 'FAIL: context-less outsider provisioned a store' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- FK semantics (outside RLS — table-level): order_sources.legacy_woo_store_id
-- REFERENCES stores(id) ON DELETE SET NULL. Deleting the provisioned store must
-- clear the provenance stamp, never orphan or cascade the source.
DO $$
DECLARE v_store uuid; v_stamp uuid; v_brand uuid;
BEGIN
  SELECT id INTO v_store FROM public.stores WHERE name = 'Fixture Provision Owner';
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'FAIL: owner-provisioned store row missing' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.brands (name, slug, business_id)
  VALUES ('Fixture Provision Brand', 'fixture-provision-brand',
          '11111111-0000-0000-0000-000000000001')
  RETURNING id INTO v_brand;

  INSERT INTO public.order_sources
    (name, type, brand_id, config, accepted_payment_methods, fulfillment_preference, ship_from_store)
  VALUES
    ('Fixture Stamp Source', 'manual', v_brand, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, false);
  UPDATE public.order_sources
  SET legacy_woo_store_id = v_store
  WHERE name = 'Fixture Stamp Source';
  SELECT legacy_woo_store_id INTO v_stamp FROM public.order_sources WHERE name = 'Fixture Stamp Source';
  IF v_stamp IS DISTINCT FROM v_store THEN
    RAISE EXCEPTION 'FAIL: legacy_woo_store_id stamp did not land' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.stores WHERE id = v_store;
  SELECT legacy_woo_store_id INTO v_stamp FROM public.order_sources WHERE name = 'Fixture Stamp Source';
  IF v_stamp IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: legacy_woo_store_id not cleared by ON DELETE SET NULL' USING ERRCODE = 'P0001';
  END IF;
END $$;

ROLLBACK;
