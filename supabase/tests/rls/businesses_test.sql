-- ============================================================================
-- W1d RLS battery: businesses writes owner/admin-only. §2.2 AC-1..3.
-- Runs BEFORE user_business_access_test.sql (filename order) — never deletes
-- BIZ_A or any shared fixture. BIZ_THROWAWAY is created here in-file (slug
-- harness-throwaway-a, ON CONFLICT DO NOTHING) and deleted by AC-2b.
-- ============================================================================

-- Fixture legend:
--   OWNER_A     00000000-0000-0000-0000-000000000001  owner of BIZ_A
--   MEMBER_A    00000000-0000-0000-0000-000000000004  member of BIZ_A
--   ADMIN       00000000-0000-0000-0000-00000000000a  platform admin
--   BIZ_A        11111111-0000-0000-0000-000000000001  'Biz A Fixture' (5 seeded uba rows)

-- ============ Fixture: BIZ_THROWAWAY (created here, never restored) ============
INSERT INTO public.businesses (id, name, slug, currency, timezone)
VALUES ('22222222-0000-0000-0000-000000000001', 'Biz Throwaway', 'harness-throwaway-a', 'BDT', 'Asia/Dhaka')
ON CONFLICT (slug) DO NOTHING;

-- ============ AC-1a (A'-UPDATE): member of A UPDATE businesses A → denied, name pinned ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    UPDATE public.businesses SET name = 'Hacked Name' WHERE id = '11111111-0000-0000-0000-000000000001';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1d-AC1a member update was mutable (rowcount %)', v_rc USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id='11111111-0000-0000-0000-000000000001' AND name='Biz A Fixture')
  THEN RAISE EXCEPTION 'FAIL: W1d-AC1a member update altered the row (survival/value)' USING ERRCODE = 'P0001'; END IF;
END $$;
ROLLBACK;

-- ============ AC-1b (Shape B): owner of A UPDATE businesses A → allowed ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
UPDATE public.businesses SET phone = '01700000000' WHERE id = '11111111-0000-0000-0000-000000000001';
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id='11111111-0000-0000-0000-000000000001' AND phone='01700000000')
  THEN RAISE EXCEPTION 'FAIL: W1d-AC1b owner update did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
-- paired cleanup: restore fixture value
UPDATE public.businesses SET phone = NULL WHERE id = '11111111-0000-0000-0000-000000000001';

-- ============ AC-1c (Shape B): platform admin UPDATE businesses A → allowed ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
UPDATE public.businesses SET phone = '01711111111' WHERE id = '11111111-0000-0000-0000-000000000001';
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id='11111111-0000-0000-0000-000000000001' AND phone='01711111111')
  THEN RAISE EXCEPTION 'FAIL: W1d-AC1c admin update did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
UPDATE public.businesses SET phone = NULL WHERE id = '11111111-0000-0000-0000-000000000001';

-- ============ AC-2a (A'-DELETE): owner deletes BIZ_A → denied; 5 uba children intact ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    DELETE FROM public.businesses WHERE id = '11111111-0000-0000-0000-000000000001';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1d-AC2a owner deleted BIZ_A (rowcount %)', v_rc USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id='11111111-0000-0000-0000-000000000001')
  THEN RAISE EXCEPTION 'FAIL: W1d-AC2a BIZ_A did not survive' USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO n FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001';
  IF n <> 5 THEN
    RAISE EXCEPTION 'FAIL: W1d-AC2a uba cascade children altered (count=%)', n USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ============ AC-2b (Shape B): admin DELETEs BIZ_THROWAWAY → allowed (throwaway only) ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DELETE FROM public.businesses WHERE id = '22222222-0000-0000-0000-000000000001';
COMMIT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.businesses WHERE id='22222222-0000-0000-0000-000000000001')
  THEN RAISE EXCEPTION 'FAIL: W1d-AC2b admin delete of throwaway did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
-- BIZ_THROWAWAY deliberately never restored (CRITIQUE-v4 #3)

-- ============ AC-3 (Shape C regression): any member SELECT businesses A → unchanged ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.businesses WHERE id='11111111-0000-0000-0000-000000000001';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: W1d-AC3 member read of BIZ_A changed (count=%)', n USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;