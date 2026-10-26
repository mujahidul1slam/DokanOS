-- ============================================================================
-- Issue #14 RLS battery: business-account ownership transfer and departure.
--
-- Fixture legend (seeded by scripts/run-rls-tests.mjs):
--   ADMIN       00000000-0000-0000-0000-00000000000a  platform admin
--   OWNER_A     00000000-0000-0000-0000-000000000001  owner of BIZ_A
--   OWNER_A2    00000000-0000-0000-0000-000000000002  co-owner of BIZ_A
--   UBA_ADMIN_A 00000000-0000-0000-0000-000000000003  legacy account admin
--   MEMBER_A    00000000-0000-0000-0000-000000000004  member of BIZ_A
--   VIEWER_A    00000000-0000-0000-0000-000000000005  viewer of BIZ_A
--   OWNER_B     00000000-0000-0000-0000-000000000006  owner of B_OTHER
--   OUTSIDER    00000000-0000-0000-0000-000000000007  no memberships
--   BIZ_A       11111111-0000-0000-0000-000000000001  'Biz A Fixture'
--   B_OTHER     11111111-0000-0000-0000-000000000002  'Biz B Fixture'
--
-- BIZ_A deliberately has two owners (a reviewed legacy multi-owner shape).
-- The transfer path may promote/demote only the caller and its target; every
-- other owner row must survive exactly as it was.
--
-- Verification of rows other than the caller's own membership happens after
-- RESET ROLE, because the user_business_access SELECT policy deliberately
-- hides other people's rows from authenticated callers.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- AC-1 (Shape B): an owner transfers ownership to an existing member of the
-- SAME account. The target becomes owner, the caller becomes a member, every
-- additional owner is preserved, and the account keeps at least one owner.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.transfer_business_ownership(
    '11111111-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004'
  );
  IF v_result->>'transferred' IS DISTINCT FROM 'true'
     OR v_result->>'new_owner_id' IS DISTINCT FROM '00000000-0000-0000-0000-000000000004'
     OR v_result->>'previous_owner_id' IS DISTINCT FROM '00000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: AC1 transfer result lacked explicit owner transition evidence: %', v_result USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
DECLARE
  v_before integer := 5;
  v_after integer;
  v_target_role text;
  v_caller_role text;
  v_co_owner_role text;
  v_owner_count integer;
BEGIN
  SELECT role INTO v_target_role FROM public.user_business_access
   WHERE business_id = '11111111-0000-0000-0000-000000000001'
     AND user_id = '00000000-0000-0000-0000-000000000004';
  SELECT role INTO v_caller_role FROM public.user_business_access
   WHERE business_id = '11111111-0000-0000-0000-000000000001'
     AND user_id = '00000000-0000-0000-0000-000000000001';
  SELECT role INTO v_co_owner_role FROM public.user_business_access
   WHERE business_id = '11111111-0000-0000-0000-000000000001'
     AND user_id = '00000000-0000-0000-0000-000000000002';
  SELECT count(*) INTO v_after
    FROM public.user_business_access
   WHERE business_id = '11111111-0000-0000-0000-000000000001';
  SELECT count(*) INTO v_owner_count
    FROM public.user_business_access
   WHERE business_id = '11111111-0000-0000-0000-000000000001'
     AND role = 'owner';

  IF v_target_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'FAIL: AC1 existing member did not become owner (role %)', v_target_role USING ERRCODE = 'P0001';
  END IF;
  IF v_caller_role IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'FAIL: AC1 transferring owner did not become a member (role %)', v_caller_role USING ERRCODE = 'P0001';
  END IF;
  IF v_co_owner_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'FAIL: AC1 legacy co-owner was silently changed/removed' USING ERRCODE = 'P0001';
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'FAIL: AC1 transfer created or removed membership rows (% -> %)', v_before, v_after USING ERRCODE = 'P0001';
  END IF;
  IF v_owner_count < 1 THEN
    RAISE EXCEPTION 'FAIL: AC1 transfer left the account without an owner' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.audit_log
       WHERE action = 'transfer_business_ownership'
         AND details->>'business_id' = '11111111-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'FAIL: AC1 ownership transfer was not audited exactly once' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-2 (Shape A): only an authorized CURRENT owner transfers. Ordinary
-- members, viewers, legacy account admins, nonmembers, other-account owners,
-- and platform admins (no implicit bypass) are refused before any write.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'FAIL: AC2 member transferred account ownership' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'FAIL: AC2 viewer transferred account ownership' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'FAIL: AC2 legacy account admin transferred ownership' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'FAIL: AC2 nonmember transferred ownership' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'FAIL: AC2 other-account owner transferred ownership' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'FAIL: AC2 platform admin used an implicit ownership bypass' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-3 (Shape A): the target must already operate THIS account. A forged
-- cross-account user id, an outsider, and the caller themselves are refused.
-- The account membership stays exactly as it was.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000006'
    );
    RAISE EXCEPTION 'FAIL: AC3 forged cross-account target was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000007'
    );
    RAISE EXCEPTION 'FAIL: AC3 nonmember target was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'FAIL: AC3 self-transfer was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
DECLARE v_state text;
BEGIN
  SELECT string_agg(user_id::text || ':' || role, ',' ORDER BY user_id)
    INTO v_state
    FROM public.user_business_access
   WHERE business_id = '11111111-0000-0000-0000-000000000001';
  IF v_state IS DISTINCT FROM
     '00000000-0000-0000-0000-000000000001:owner,'
     || '00000000-0000-0000-0000-000000000002:owner,'
     || '00000000-0000-0000-0000-000000000003:admin,'
     || '00000000-0000-0000-0000-000000000004:member,'
     || '00000000-0000-0000-0000-000000000005:viewer' THEN
    RAISE EXCEPTION 'FAIL: AC3 a refused transfer changed account membership: %', v_state USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-4 (Shape A/B): owner departure is blocked until ownership is transferred,
-- including for a legacy co-owner. After the transfer the former owner is a
-- member and may leave; the account keeps its other owner(s).
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_result jsonb;
BEGIN
  BEGIN
    PERFORM public.leave_business_account('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC4 owner departed without transferring ownership' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  v_result := public.transfer_business_ownership(
    '11111111-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004'
  );
  IF v_result->>'new_owner_id' IS DISTINCT FROM '00000000-0000-0000-0000-000000000004' THEN
    RAISE EXCEPTION 'FAIL: AC4 transfer did not name the new owner' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.leave_business_account('11111111-0000-0000-0000-000000000001');
  IF v_result->>'left' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FAIL: AC4 former owner could not leave after transfer: %', v_result USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access
              WHERE business_id = '11111111-0000-0000-0000-000000000001'
                AND user_id = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: AC4 departure did not remove the former owner membership' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.user_business_access
       WHERE business_id = '11111111-0000-0000-0000-000000000001'
         AND role = 'owner') < 1 THEN
    RAISE EXCEPTION 'FAIL: AC4 departure left the account ownerless' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id = '11111111-0000-0000-0000-000000000001'
                    AND user_id = '00000000-0000-0000-0000-000000000002'
                    AND role = 'owner') THEN
    RAISE EXCEPTION 'FAIL: AC4 legacy co-owner did not survive the transfer/departure' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id = '11111111-0000-0000-0000-000000000001'
                    AND user_id = '00000000-0000-0000-0000-000000000004'
                    AND role = 'owner') THEN
    RAISE EXCEPTION 'FAIL: AC4 target did not remain owner after the former owner left' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- AC-4b: a legacy co-owner is also blocked from departing without a transfer.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.leave_business_account('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC4b co-owner departed without transferring ownership' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id = '11111111-0000-0000-0000-000000000001'
                    AND user_id = '00000000-0000-0000-0000-000000000002'
                    AND role = 'owner') THEN
    RAISE EXCEPTION 'FAIL: AC4b blocked co-owner departure changed the owner row' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-5 (Shape B): ordinary members, viewers and legacy account admins may
-- leave; the account owner is untouched and the account stays owned.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.leave_business_account('11111111-0000-0000-0000-000000000001');
  IF v_result->>'left' IS DISTINCT FROM 'true' OR v_result->>'role' IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'FAIL: AC5 member departure failed: %', v_result USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access
              WHERE business_id = '11111111-0000-0000-0000-000000000001'
                AND user_id = '00000000-0000-0000-0000-000000000004') THEN
    RAISE EXCEPTION 'FAIL: AC5 member departure left the row behind' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.user_business_access
       WHERE business_id = '11111111-0000-0000-0000-000000000001'
         AND role = 'owner') < 1 THEN
    RAISE EXCEPTION 'FAIL: AC5 member departure removed the owner' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  PERFORM public.leave_business_account('11111111-0000-0000-0000-000000000001');
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access
              WHERE business_id = '11111111-0000-0000-0000-000000000001'
                AND user_id = '00000000-0000-0000-0000-000000000005') THEN
    RAISE EXCEPTION 'FAIL: AC5 viewer departure left the row behind' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  PERFORM public.leave_business_account('11111111-0000-0000-0000-000000000001');
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access
              WHERE business_id = '11111111-0000-0000-0000-000000000001'
                AND user_id = '00000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'FAIL: AC5 legacy account admin departure left the row behind' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-6 (Shape A): repeated and competing operations never orphan the account.
-- A former owner cannot transfer again or leave twice; a chained transfer still
-- leaves at least one owner.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  PERFORM public.transfer_business_ownership(
    '11111111-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004'
  );

  BEGIN
    PERFORM public.transfer_business_ownership(
      '11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'FAIL: AC6 former owner transferred ownership twice' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM public.leave_business_account('11111111-0000-0000-0000-000000000001');
  BEGIN
    PERFORM public.leave_business_account('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC6 repeated departure was reported as success' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.user_business_access
       WHERE business_id = '11111111-0000-0000-0000-000000000001'
         AND role = 'owner') < 1 THEN
    RAISE EXCEPTION 'FAIL: AC6 repeated operations left the account ownerless' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- AC-6b: after one transfer to MEMBER_A, the new owner can transfer again to
-- the preserved co-owner; ownership moves without creating or removing rows.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  PERFORM public.transfer_business_ownership(
    '11111111-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004'
  );
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}',
    true
  );
  PERFORM public.transfer_business_ownership(
    '11111111-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002'
  );
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.user_business_access
       WHERE business_id = '11111111-0000-0000-0000-000000000001') <> 5 THEN
    RAISE EXCEPTION 'FAIL: AC6b chained transfer changed the membership row count' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.user_business_access
       WHERE business_id = '11111111-0000-0000-0000-000000000001'
         AND role = 'owner') < 1 THEN
    RAISE EXCEPTION 'FAIL: AC6b chained transfer left the account ownerless' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id = '11111111-0000-0000-0000-000000000001'
                    AND user_id = '00000000-0000-0000-0000-000000000002'
                    AND role = 'owner') THEN
    RAISE EXCEPTION 'FAIL: AC6b target did not receive ownership' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;
