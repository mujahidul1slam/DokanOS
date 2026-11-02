-- Task 5: warehouses are brand-level stock-only locations.
-- Members read; owner/admin/member write; viewers read-only; other businesses
-- see nothing. UQ(brand_id, name) covered. Fixture ids per _harness.md.

BEGIN;

-- Member …004 creates the brand and warehouses; UQ; update.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.brands (id, business_id, name, slug)
  VALUES ('11111111-0000-0000-0000-0000000000f2', '11111111-0000-0000-0000-000000000001',
          'Task5 Brand', 'task5-brand');

  INSERT INTO public.warehouses (brand_id, name, is_default)
  VALUES ('11111111-0000-0000-0000-0000000000f2', 'Main Warehouse', true)
  RETURNING id INTO v_id;

  INSERT INTO public.warehouses (brand_id, name)
  VALUES ('11111111-0000-0000-0000-0000000000f2', 'Annex');

  BEGIN
    INSERT INTO public.warehouses (brand_id, name)
    VALUES ('11111111-0000-0000-0000-0000000000f2', 'Main Warehouse');
    RAISE EXCEPTION 'FAIL: duplicate brand+name warehouse accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  UPDATE public.warehouses SET name = 'Main WH' WHERE id = v_id;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_id AND name = 'Main WH' AND is_default) THEN
    RAISE EXCEPTION 'FAIL: member could not update own-account warehouse' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- Viewer …005: reads, cannot write.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.warehouses
      WHERE brand_id = '11111111-0000-0000-0000-0000000000f2') < 2 THEN
    RAISE EXCEPTION 'FAIL: viewer could not read own-account warehouses' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.warehouses (brand_id, name)
    VALUES ('11111111-0000-0000-0000-0000000000f2', 'Viewer WH');
    RAISE EXCEPTION 'FAIL: viewer inserted a warehouse' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.warehouses SET name = 'viewer-hijack'
    WHERE brand_id = '11111111-0000-0000-0000-0000000000f2';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: viewer updated % warehouse rows', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM public.warehouses
    WHERE brand_id = '11111111-0000-0000-0000-0000000000f2';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: viewer deleted % warehouse rows', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- OUTSIDER …007: no visibility, no writes.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.warehouses
             WHERE brand_id = '11111111-0000-0000-0000-0000000000f2') THEN
    RAISE EXCEPTION 'FAIL: outsider saw another account''s warehouses' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.warehouses (brand_id, name)
    VALUES ('11111111-0000-0000-0000-0000000000f2', 'Outsider WH');
    RAISE EXCEPTION 'FAIL: outsider inserted a warehouse' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- OWNER_B …006: cross-business operator denied.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.warehouses
             WHERE brand_id = '11111111-0000-0000-0000-0000000000f2') THEN
    RAISE EXCEPTION 'FAIL: cross-business operator saw foreign warehouses' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.warehouses (brand_id, name)
    VALUES ('11111111-0000-0000-0000-0000000000f2', 'Cross Biz WH');
    RAISE EXCEPTION 'FAIL: cross-business operator inserted a foreign warehouse'
      USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Owner-side value-pinned survival.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.warehouses
                 WHERE name = 'Main WH' AND is_default IS TRUE) THEN
    RAISE EXCEPTION 'FAIL: member-updated warehouse did not survive' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.warehouses
             WHERE name IN ('Viewer WH', 'viewer-hijack', 'Outsider WH', 'Cross Biz WH')) THEN
    RAISE EXCEPTION 'FAIL: denied writes left residue' USING ERRCODE = 'P0001';
  END IF;
END $$;

ROLLBACK;
