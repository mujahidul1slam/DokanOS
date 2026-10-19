-- Issue #11: brands are independent account children. Owners and operational
-- members can create/list them; a forged business parent is rejected.

BEGIN;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';

DO $$
DECLARE
  first_brand jsonb;
  second_brand jsonb;
  stores_before bigint;
  storefronts_before bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE business_id = '11111111-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: fixture account was not empty before brand creation' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO stores_before FROM public.stores;
  SELECT count(*) INTO storefronts_before FROM public.storefronts;

  first_brand := public.create_business_brand(
    '11111111-0000-0000-0000-000000000001',
    'North Star'
  );
  second_brand := public.create_business_brand(
    '11111111-0000-0000-0000-000000000001',
    'Daylight Goods'
  );

  IF first_brand->>'name' <> 'North Star' OR second_brand->>'name' <> 'Daylight Goods' THEN
    RAISE EXCEPTION 'FAIL: member could not create name-only brands' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.brands
      WHERE business_id = '11111111-0000-0000-0000-000000000001'
        AND name IN ('North Star', 'Daylight Goods')) <> 2 THEN
    RAISE EXCEPTION 'FAIL: member could not list both own-account brands' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brands
             WHERE name IN ('North Star', 'Daylight Goods') AND woo_store_id IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: brand creation linked an implicit store' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.stores) <> stores_before
     OR (SELECT count(*) FROM public.storefronts) <> storefronts_before THEN
    RAISE EXCEPTION 'FAIL: brand creation implicitly created a store/storefront' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    PERFORM public.create_business_brand(
      '11111111-0000-0000-0000-000000000002',
      'Forged Parent'
    );
    RAISE EXCEPTION 'FAIL: forged cross-account business accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- The owner has the same operational create/list capability.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  PERFORM public.create_business_brand(
    '11111111-0000-0000-0000-000000000001',
    'Owner Brand'
  );
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE name = 'Owner Brand') THEN
    RAISE EXCEPTION 'FAIL: owner could not create/list a brand' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- A viewer membership may list but not create (first-release operator policy).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE name IN ('North Star', 'Daylight Goods', 'Owner Brand')) THEN
    RAISE EXCEPTION 'FAIL: viewer could not list own-account brands' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    PERFORM public.create_business_brand(
      '11111111-0000-0000-0000-000000000001',
      'Viewer Brand'
    );
    RAISE EXCEPTION 'FAIL: read-only viewer created a brand' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

-- A legacy platform role is not account membership.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE name IN ('North Star', 'Daylight Goods', 'Owner Brand')) THEN
    RAISE EXCEPTION 'FAIL: legacy global role listed account brands' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    PERFORM public.create_business_brand(
      '11111111-0000-0000-0000-000000000001',
      'Global Role Brand'
    );
    RAISE EXCEPTION 'FAIL: legacy global role created an account brand' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;
