-- Issue #12: minimal physical/online store creation under exactly one brand.
-- Creation is account-authorized, explicitly typed, additive and unpublished.
-- No brand, legacy Woo store or storefront is created as a side effect.

BEGIN;

-- A brand in another account is the forged parent target. Created by the
-- migration/test connection owner before assuming the authenticated role.
INSERT INTO public.brands (business_id, name, slug)
VALUES ('11111111-0000-0000-0000-000000000002', 'Issue 12 Other Account Brand', 'issue-12-other-account-brand')
ON CONFLICT DO NOTHING;

-- Stable id for the cross-account write assertion.
INSERT INTO public.brands (id, business_id, name, slug)
VALUES (
  '44444444-0000-0000-0000-000000000098',
  '11111111-0000-0000-0000-000000000001',
  'Issue 12 Fixed Brand',
  'issue-12-fixed-brand'
)
ON CONFLICT DO NOTHING;

-- audit_log is intentionally not readable by the authenticated role, so the
-- baseline is captured by the fixture owner before assuming that role.
CREATE TEMP TABLE issue12_audit_baseline ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.audit_log WHERE action = 'create_brand_store') AS n;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';

DO $$
DECLARE
  v_brand            uuid;
  v_empty_brand      uuid;
  v_other_brand      uuid;
  v_physical         jsonb;
  v_online           jsonb;
  v_before_stores    bigint;
  v_before_brands    bigint;
  v_before_fronts    bigint;
  v_type             text;
BEGIN
  v_brand := (public.create_business_brand(
    '11111111-0000-0000-0000-000000000001',
    'Issue 12 North Star'
  )->>'id')::uuid;
  v_empty_brand := (public.create_business_brand(
    '11111111-0000-0000-0000-000000000001',
    'Issue 12 Empty Brand'
  )->>'id')::uuid;
  SELECT id INTO v_other_brand
  FROM public.brands
  WHERE name = 'Issue 12 Other Account Brand';

  SELECT count(*) INTO v_before_stores FROM public.stores;
  SELECT count(*) INTO v_before_brands FROM public.brands;
  SELECT count(*) INTO v_before_fronts FROM public.storefronts;

  v_physical := public.create_brand_store(v_brand, 'Issue 12 Dhanmondi Outlet', 'physical');
  v_online   := public.create_brand_store(v_brand, 'Issue 12 Online Shop', 'online');

  IF v_physical->>'store_type' <> 'physical'
     OR v_online->>'store_type' <> 'online'
     OR v_physical->>'brand_id' <> v_brand::text
     OR v_online->>'brand_id' <> v_brand::text THEN
    RAISE EXCEPTION 'FAIL: explicit store type or parent brand was not persisted' USING ERRCODE = 'P0001';
  END IF;
  IF (v_physical->>'is_published')::boolean IS DISTINCT FROM false
     OR (v_online->>'is_published')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: a new store was published implicitly' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.brand_stores WHERE brand_id = v_brand) <> 2 THEN
    RAISE EXCEPTION 'FAIL: a brand cannot hold multiple stores' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.brand_stores WHERE brand_id = v_empty_brand) <> 0 THEN
    RAISE EXCEPTION 'FAIL: creating a brand implicitly created a store' USING ERRCODE = 'P0001';
  END IF;

  -- A direct Data API insert must obey the same explicit type and RLS rules.
  INSERT INTO public.brand_stores (brand_id, name, store_type)
  VALUES (v_brand, 'Issue 12 Direct Physical', 'physical');

  -- Neither the RPC nor direct insert accepts a combined/unknown type.
  FOREACH v_type IN ARRAY ARRAY['both', 'physical_online', 'hybrid', 'PHYSICAL', ''] LOOP
    BEGIN
      PERFORM public.create_brand_store(v_brand, 'Issue 12 Invalid ' || v_type, v_type);
      RAISE EXCEPTION 'FAIL: RPC accepted invalid store type %', v_type USING ERRCODE = 'P0001';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    BEGIN
      INSERT INTO public.brand_stores (brand_id, name, store_type)
      VALUES (v_brand, 'Issue 12 Direct Invalid ' || v_type, v_type);
      RAISE EXCEPTION 'FAIL: table accepted invalid store type %', v_type USING ERRCODE = 'P0001';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  -- Publishing is not a creation concern and must not be accepted directly.
  BEGIN
    INSERT INTO public.brand_stores (brand_id, name, store_type, is_published)
    VALUES (v_brand, 'Issue 12 Premature Publish', 'online', true);
    RAISE EXCEPTION 'FAIL: creation accepted a published online store' USING ERRCODE = 'P0001';
  -- Rejected either by the unpublished-creation constraint or by the policy.
  EXCEPTION WHEN check_violation OR SQLSTATE '42501' THEN NULL;
  END;

  -- A forged parent brand in another account is indistinguishable from denial.
  BEGIN
    PERFORM public.create_brand_store(v_other_brand, 'Issue 12 Forged Parent', 'physical');
    RAISE EXCEPTION 'FAIL: cross-account brand was accepted as a parent' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- No unrelated resource was manufactured by store creation.
  -- The baseline already includes the two brands created above; store
  -- creation must not add another brand, legacy store or storefront.
  IF (SELECT count(*) FROM public.stores) <> v_before_stores
     OR (SELECT count(*) FROM public.storefronts) <> v_before_fronts
     OR (SELECT count(*) FROM public.brands) <> v_before_brands THEN
    RAISE EXCEPTION 'FAIL: store creation created a legacy store, storefront or extra brand' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- The fixture owner verifies the audit trail after the authenticated role is
-- released. Exactly one event per successful RPC call is expected.
DO $$
DECLARE
  v_baseline bigint;
  v_after    bigint;
BEGIN
  SELECT n INTO v_baseline FROM issue12_audit_baseline;
  SELECT count(*) INTO v_after FROM public.audit_log WHERE action = 'create_brand_store';
  IF v_after <> v_baseline + 2 THEN
    RAISE EXCEPTION 'FAIL: store creation was not audited exactly once per RPC store' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- A platform viewer may read own-account stores but may not create one.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE
  v_brand uuid;
BEGIN
  SELECT id INTO v_brand FROM public.brands WHERE name = 'Issue 12 North Star';
  IF (SELECT count(*) FROM public.brand_stores WHERE brand_id = v_brand) <> 3 THEN
    RAISE EXCEPTION 'FAIL: viewer could not read own-account stores' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    PERFORM public.create_brand_store(v_brand, 'Issue 12 Viewer Store', 'online');
    RAISE EXCEPTION 'FAIL: read-only viewer created a store' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.brand_stores (brand_id, name, store_type)
    VALUES (v_brand, 'Issue 12 Viewer Direct', 'physical');
    RAISE EXCEPTION 'FAIL: viewer inserted a store directly' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- Another account cannot see or write these stores, even with the known brand id.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
DECLARE
  v_brand uuid := '44444444-0000-0000-0000-000000000098';
BEGIN
  IF EXISTS (SELECT 1 FROM public.brand_stores WHERE brand_id = v_brand) THEN
    RAISE EXCEPTION 'FAIL: other-account owner listed foreign stores' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_stores WHERE name LIKE 'Issue 12 %') THEN
    RAISE EXCEPTION 'FAIL: other-account owner listed any foreign store' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    PERFORM public.create_brand_store(v_brand, 'Issue 12 Cross Account Store', 'physical');
    RAISE EXCEPTION 'FAIL: other-account owner created a store under a foreign brand' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- Legacy platform roles are not account membership.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brand_stores) THEN
    RAISE EXCEPTION 'FAIL: legacy global role listed account stores' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    PERFORM public.create_brand_store(
      (SELECT id FROM public.brands WHERE name = 'Issue 12 North Star'),
      'Issue 12 Global Role Store',
      'online'
    );
    RAISE EXCEPTION 'FAIL: legacy global role created an account store' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;
