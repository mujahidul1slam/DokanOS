-- Issue #12: reviewed legacy relationships can be represented additively
-- without reinterpreting, moving or deleting the legacy rows. This fixture is
-- a representative review outcome, not an automatic migration.

BEGIN;

-- Representative legacy operations in Biz A: Woo connector, brand link,
-- showroom location, selling point and order history.
INSERT INTO public.stores (id, name, url, status)
VALUES ('33333333-0000-0000-0000-000000000013', 'Issue 12 Legacy Woo', 'https://legacy-woo.test', 'connected');
INSERT INTO public.brands (id, business_id, name, slug, woo_store_id)
VALUES (
  '44444444-0000-0000-0000-000000000013',
  '11111111-0000-0000-0000-000000000001',
  'Issue 12 Legacy Brand',
  'issue-12-legacy-brand',
  '33333333-0000-0000-0000-000000000013'
);
INSERT INTO public.locations (id, business_id, brand_id, name, type, address, city)
VALUES (
  '66666666-0000-0000-0000-000000000013',
  '11111111-0000-0000-0000-000000000001',
  '44444444-0000-0000-0000-000000000013',
  'Issue 12 Legacy Showroom',
  'showroom',
  '12 Legacy Road',
  'Dhaka'
);
INSERT INTO public.selling_points (
  id, business_id, brand_id, name, type, location_id, woo_store_id
)
VALUES (
  '77777777-0000-0000-0000-000000000013',
  '11111111-0000-0000-0000-000000000001',
  '44444444-0000-0000-0000-000000000013',
  'Issue 12 Legacy Counter',
  'showroom_pos',
  '66666666-0000-0000-0000-000000000013',
  '33333333-0000-0000-0000-000000000013'
);
INSERT INTO public.orders (id, store_id, order_number, source, status, total)
VALUES (
  '88888888-0000-0000-0000-000000000013',
  '33333333-0000-0000-0000-000000000013',
  'ISSUE12-LEGACY-1',
  'pos',
  'delivered',
  1250.00
);
-- A second account for the cross-account mapping assertion.
INSERT INTO public.brands (id, business_id, name, slug)
VALUES (
  '44444444-0000-0000-0000-000000000014',
  '11111111-0000-0000-0000-000000000002',
  'Issue 12 Legacy Other',
  'issue-12-legacy-other'
);

-- Legacy tables are fixture-owned and not all readable by the authenticated
-- role; capture the baseline before switching roles.
CREATE TEMP TABLE issue12_legacy_baseline ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.storefronts) AS fronts;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  v_new_store uuid;
BEGIN
  INSERT INTO public.brand_stores (
    id, brand_id, name, store_type,
    legacy_location_id, legacy_selling_point_id, legacy_woo_store_id
  )
  VALUES (
    '99999999-0000-0000-0000-000000000013',
    '44444444-0000-0000-0000-000000000013',
    'Issue 12 Migrated Showroom',
    'physical',
    '66666666-0000-0000-0000-000000000013',
    '77777777-0000-0000-0000-000000000013',
    '33333333-0000-0000-0000-000000000013'
  )
  RETURNING id INTO v_new_store;

  IF v_new_store <> '99999999-0000-0000-0000-000000000013' THEN
    RAISE EXCEPTION 'FAIL: reviewed store id changed' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT is_published FROM public.brand_stores WHERE id = v_new_store) <> false THEN
    RAISE EXCEPTION 'FAIL: reviewed mapping was published implicitly' USING ERRCODE = 'P0001';
  END IF;

  -- A legacy resource can be represented by at most one new store.
  BEGIN
    INSERT INTO public.brand_stores (
      brand_id, name, store_type, legacy_selling_point_id
    )
    VALUES (
      '44444444-0000-0000-0000-000000000013',
      'Issue 12 Duplicate Mapping',
      'physical',
      '77777777-0000-0000-0000-000000000013'
    );
    RAISE EXCEPTION 'FAIL: duplicate legacy mapping was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
RESET ROLE;

-- The fixture owner verifies that every stable legacy reference and its
-- history survives the additive mapping unchanged.
DO $$
DECLARE
  v_fronts_before bigint;
BEGIN
  SELECT fronts INTO v_fronts_before FROM issue12_legacy_baseline;

  IF NOT EXISTS (
    SELECT 1 FROM public.stores
    WHERE id = '33333333-0000-0000-0000-000000000013'
      AND name = 'Issue 12 Legacy Woo'
      AND url = 'https://legacy-woo.test'
      AND status = 'connected'
  ) THEN
    RAISE EXCEPTION 'FAIL: legacy Woo store changed during mapping' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands
    WHERE id = '44444444-0000-0000-0000-000000000013'
      AND business_id = '11111111-0000-0000-0000-000000000001'
      AND woo_store_id = '33333333-0000-0000-0000-000000000013'
  ) THEN
    RAISE EXCEPTION 'FAIL: legacy brand relationship changed during mapping' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.locations
    WHERE id = '66666666-0000-0000-0000-000000000013'
      AND brand_id = '44444444-0000-0000-0000-000000000013'
      AND name = 'Issue 12 Legacy Showroom'
      AND type = 'showroom'
  ) THEN
    RAISE EXCEPTION 'FAIL: legacy location changed during mapping' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.selling_points
    WHERE id = '77777777-0000-0000-0000-000000000013'
      AND brand_id = '44444444-0000-0000-0000-000000000013'
      AND location_id = '66666666-0000-0000-0000-000000000013'
      AND woo_store_id = '33333333-0000-0000-0000-000000000013'
  ) THEN
    RAISE EXCEPTION 'FAIL: legacy selling point changed during mapping' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = '88888888-0000-0000-0000-000000000013'
      AND store_id = '33333333-0000-0000-0000-000000000013'
      AND order_number = 'ISSUE12-LEGACY-1'
      AND total = 1250.00
  ) THEN
    RAISE EXCEPTION 'FAIL: legacy operational history changed during mapping' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.storefronts) <> v_fronts_before THEN
    RAISE EXCEPTION 'FAIL: reviewed mapping published or created a storefront' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- A reviewed mapping cannot attach another account's legacy resource.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.brand_stores (
      brand_id, name, store_type, legacy_location_id
    )
    VALUES (
      '44444444-0000-0000-0000-000000000014',
      'Issue 12 Cross Account Mapping',
      'physical',
      '66666666-0000-0000-0000-000000000013'
    );
    RAISE EXCEPTION 'FAIL: cross-account legacy location was mapped' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;
