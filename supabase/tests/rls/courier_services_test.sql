-- Task 9: courier services are BUSINESS-level (spec §4) — one courier account
-- per business, no per-brand duplication. Members read; owner/admin/member
-- write; viewers read-only; other businesses see nothing. UQ(business_id, name)
-- and the legacy_* audit columns (unique-when-set) covered. Fixture ids per
-- _harness.md.

BEGIN;

-- Member …004 creates services in Biz A; UQ; update; legacy ids unique.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.courier_services (business_id, provider, name, credentials, legacy_pathao_integration_id)
  VALUES ('11111111-0000-0000-0000-000000000001', 'pathao', 'Main Pathao',
          '{"client_id":"ck_test"}'::jsonb, '11111111-0000-0000-0000-0000000000e1')
  RETURNING id INTO v_id;

  INSERT INTO public.courier_services (business_id, provider, name)
  VALUES ('11111111-0000-0000-0000-000000000001', 'steadfast', 'Steadfast Acct');

  BEGIN
    INSERT INTO public.courier_services (business_id, provider, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'pathao', 'Main Pathao');
    RAISE EXCEPTION 'FAIL: duplicate business+name courier service accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.courier_services (business_id, provider, name, legacy_pathao_integration_id)
    VALUES ('11111111-0000-0000-0000-000000000001', 'redx', 'RedX Dup',
            '11111111-0000-0000-0000-0000000000e1');
    RAISE EXCEPTION 'FAIL: duplicate legacy_pathao_integration_id accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  UPDATE public.courier_services
  SET name = 'Main Pathao v2', credentials = '{"client_id":"ck_rotated"}'::jsonb
  WHERE id = v_id;
  IF NOT EXISTS (SELECT 1 FROM public.courier_services
                 WHERE id = v_id AND name = 'Main Pathao v2'
                   AND credentials->>'client_id' = 'ck_rotated') THEN
    RAISE EXCEPTION 'FAIL: member could not update own-account courier service' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- Viewer …005: reads, cannot write.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.courier_services
      WHERE business_id = '11111111-0000-0000-0000-000000000001') < 2 THEN
    RAISE EXCEPTION 'FAIL: viewer could not read own-account courier services' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.courier_services (business_id, provider, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'redx', 'Viewer Courier');
    RAISE EXCEPTION 'FAIL: viewer inserted a courier service' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.courier_services SET is_active = false
    WHERE business_id = '11111111-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: viewer updated % courier service rows', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM public.courier_services
    WHERE business_id = '11111111-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: viewer deleted % courier service rows', v_rc USING ERRCODE = 'P0001';
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
  IF EXISTS (SELECT 1 FROM public.courier_services
             WHERE business_id = '11111111-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: outsider saw another account''s courier services' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.courier_services (business_id, provider, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'redx', 'Outsider Courier');
    RAISE EXCEPTION 'FAIL: outsider inserted a courier service' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- OWNER_B …006: cross-business operator denied.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.courier_services
             WHERE business_id = '11111111-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: cross-business operator saw foreign courier services' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.courier_services (business_id, provider, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'redx', 'Cross Biz Courier');
    RAISE EXCEPTION 'FAIL: cross-business operator inserted a foreign courier service'
      USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Owner-side value-pinned survival.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.courier_services
                 WHERE name = 'Main Pathao v2'
                   AND credentials->>'client_id' = 'ck_rotated'
                   AND legacy_pathao_integration_id = '11111111-0000-0000-0000-0000000000e1') THEN
    RAISE EXCEPTION 'FAIL: member-updated courier service did not survive' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.courier_services
             WHERE name IN ('Viewer Courier', 'Outsider Courier', 'Cross Biz Courier', 'RedX Dup')) THEN
    RAISE EXCEPTION 'FAIL: denied writes left residue' USING ERRCODE = 'P0001';
  END IF;
END $$;

ROLLBACK;
