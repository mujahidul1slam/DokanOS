-- Task 4: order_sources is the per-brand unified order source (spec §2).
-- Members read; owner/admin/member write; viewers read-only; other businesses
-- see nothing. The stock-default trigger and UQ(brand_id, name) are covered too.
-- Fixture ids per _harness.md. One transaction, rolled back at the end.
-- The brand carries a pinned uuid so foreign actors (who cannot see it under
-- RLS) still address it without NULL-target artifacts.

BEGIN;

-- Member …004 creates the brand and sources; defaults, override, UQ, update.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE
  v_id    uuid;
  v_stock boolean;
BEGIN
  INSERT INTO public.brands (id, business_id, name, slug)
  VALUES ('11111111-0000-0000-0000-0000000000f1', '11111111-0000-0000-0000-000000000001',
          'Task4 Brand', 'task4-brand');

  INSERT INTO public.order_sources (brand_id, name, type)
  VALUES ('11111111-0000-0000-0000-0000000000f1', 'Phone Orders', 'manual')
  RETURNING id, is_stock_holding INTO v_id, v_stock;
  IF v_stock IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: manual source stock-default was %, expected FALSE', v_stock
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.order_sources (brand_id, name, type)
  VALUES ('11111111-0000-0000-0000-0000000000f1', 'Main Showroom', 'showroom');
  IF NOT EXISTS (SELECT 1 FROM public.order_sources
                 WHERE name = 'Main Showroom' AND is_stock_holding IS TRUE) THEN
    RAISE EXCEPTION 'FAIL: showroom source did not default stock-holding ON'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.order_sources (brand_id, name, type, is_stock_holding)
  VALUES ('11111111-0000-0000-0000-0000000000f1', 'Pop-up Stall', 'physical_store', false);
  IF EXISTS (SELECT 1 FROM public.order_sources
             WHERE name = 'Pop-up Stall' AND is_stock_holding) THEN
    RAISE EXCEPTION 'FAIL: explicit stock-holding override was ignored'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.order_sources (brand_id, name, type)
    VALUES ('11111111-0000-0000-0000-0000000000f1', 'Phone Orders', 'manual');
    RAISE EXCEPTION 'FAIL: duplicate brand+name source accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  UPDATE public.order_sources SET name = 'Phone Desk' WHERE id = v_id;
  IF NOT EXISTS (SELECT 1 FROM public.order_sources
                 WHERE id = v_id AND name = 'Phone Desk') THEN
    RAISE EXCEPTION 'FAIL: member could not update own-account source'
      USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- Viewer …005: reads own-account sources, cannot insert, cannot update/delete.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.order_sources
      WHERE brand_id = '11111111-0000-0000-0000-0000000000f1') < 3 THEN
    RAISE EXCEPTION 'FAIL: viewer could not read own-account sources'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.order_sources (brand_id, name, type)
    VALUES ('11111111-0000-0000-0000-0000000000f1', 'Viewer Source', 'manual');
    RAISE EXCEPTION 'FAIL: viewer inserted a source' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.order_sources SET name = 'viewer-hijack'
    WHERE brand_id = '11111111-0000-0000-0000-0000000000f1';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: viewer updated % source rows', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM public.order_sources
    WHERE brand_id = '11111111-0000-0000-0000-0000000000f1';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: viewer deleted % source rows', v_rc USING ERRCODE = 'P0001';
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
  IF EXISTS (SELECT 1 FROM public.order_sources
             WHERE brand_id = '11111111-0000-0000-0000-0000000000f1') THEN
    RAISE EXCEPTION 'FAIL: outsider saw another account''s sources'
      USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.order_sources (brand_id, name, type)
    VALUES ('11111111-0000-0000-0000-0000000000f1', 'Outsider Source', 'manual');
    RAISE EXCEPTION 'FAIL: outsider inserted a source' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- OWNER_B …006: operator of another business cannot write across accounts.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_sources
             WHERE brand_id = '11111111-0000-0000-0000-0000000000f1') THEN
    RAISE EXCEPTION 'FAIL: cross-business operator saw foreign sources'
      USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.order_sources (brand_id, name, type)
    VALUES ('11111111-0000-0000-0000-0000000000f1', 'Cross Biz Source', 'manual');
    RAISE EXCEPTION 'FAIL: cross-business operator inserted a foreign source'
      USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Owner-side value-pinned survival (deny-by-invisibility discriminators).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.order_sources
                 WHERE name = 'Phone Desk' AND type = 'manual') THEN
    RAISE EXCEPTION 'FAIL: member-updated source did not survive' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_sources
             WHERE name IN ('Viewer Source', 'viewer-hijack', 'Outsider Source', 'Cross Biz Source')) THEN
    RAISE EXCEPTION 'FAIL: denied writes left residue' USING ERRCODE = 'P0001';
  END IF;
END $$;

ROLLBACK;
