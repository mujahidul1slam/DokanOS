-- ============================================================================
-- W1b RLS battery: create_business_with_owner RPC — admin-only, validated.
-- §2.3 AC-1..4. All function-body RAISE → exception-visible → Shape A.
-- ============================================================================

-- Fixture: ADMIN 00000000-0000-0000-0000-00000000000a (platform admin)
--          STAFF 00000000-0000-0000-0000-00000000000b (staff — non-admin)

-- AC-1: admin creates business + owner row atomically; slug collision → 23505, no orphan
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE v_biz uuid;
BEGIN
  SELECT id INTO v_biz FROM public.create_business_with_owner('Battery Biz', 'battery-biz');
  IF v_biz IS NULL THEN
    RAISE EXCEPTION 'FAIL: W1b-AC1 RPC returned no business' USING ERRCODE = 'P0001';
  END IF;
  -- owner row must exist
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id = v_biz AND user_id = '00000000-0000-0000-0000-00000000000a' AND role = 'owner') THEN
    RAISE EXCEPTION 'FAIL: W1b-AC1 owner row missing' USING ERRCODE = 'P0001';
  END IF;
  -- cleanup created business (admin path)
  DELETE FROM public.businesses WHERE id = v_biz;
END $$;
ROLLBACK;

-- AC-1b: slug collision propagates 23505, no orphan access row
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE v_biz uuid;
BEGIN
  -- create once
  SELECT id INTO v_biz FROM public.create_business_with_owner('Collision Biz', 'collision-biz');
  BEGIN
    PERFORM public.create_business_with_owner('Collision Biz 2', 'collision-biz');  -- duplicate slug
    RAISE EXCEPTION 'FAIL: W1b-AC1b duplicate slug did not raise' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23505' THEN NULL;
  END;
  -- no orphan: exactly one access row for v_biz
  IF (SELECT count(*) FROM public.user_business_access WHERE business_id = v_biz) <> 1 THEN
    RAISE EXCEPTION 'FAIL: W1b-AC1b orphan access row after collision' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.businesses WHERE id = v_biz;
END $$;
ROLLBACK;

-- AC-2 (Shape A): non-admin → 42501 'Admin access required'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.create_business_with_owner('Staff Biz', 'staff-biz');
    RAISE EXCEPTION 'FAIL: W1b-AC2 non-admin create succeeded' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- AC-3 (Shape A): anon → denied (no authenticated role)
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.create_business_with_owner('Anon Biz', 'anon-biz');
    RAISE EXCEPTION 'FAIL: W1b-AC3 anon create succeeded' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;  -- or permission denied on EXECUTE
  END;
END $$;
ROLLBACK;

-- AC-4 (Shape A): validation raises — empty name (23502), over-long (23514), bad slug (23514), bad currency (23514), bad timezone (23514)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.create_business_with_owner('', 'empty-name');
    RAISE EXCEPTION 'FAIL: W1b-AC4a empty name did not raise' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23502' THEN NULL;
  END;
  BEGIN
    PERFORM public.create_business_with_owner(repeat('x', 101), 'long-name');
    RAISE EXCEPTION 'FAIL: W1b-AC4b over-long name did not raise' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM public.create_business_with_owner('Bad Slug Biz', 'My Slug!!');
    RAISE EXCEPTION 'FAIL: W1b-AC4c bad slug did not raise' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM public.create_business_with_owner('Bad Cur Biz', 'bad-currency', NULL, 'XYZ');
    RAISE EXCEPTION 'FAIL: W1b-AC4d bad currency did not raise' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM public.create_business_with_owner('Bad TZ Biz', 'bad-timezone', NULL, 'BDT', 'Mars/Olympus');
    RAISE EXCEPTION 'FAIL: W1b-AC4e bad timezone did not raise' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;
ROLLBACK;