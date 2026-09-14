-- ============================================================================
-- W7 RLS battery: member access RPCs. Shape A — function-body RAISE is
-- exception-visible. Fixtures seeded by the runner.
-- ============================================================================

-- Fixture legend:
--   OWNER_A  00000000-0000-0000-0000-000000000001  owner of BIZ_A
--   MEMBER_A 00000000-0000-0000-0000-000000000004  member of BIZ_A
--   VIEWER_A 00000000-0000-0000-0000-000000000005  viewer of BIZ_A
--   OUTSIDER 00000000-0000-0000-0000-000000000007  no memberships
--   ADMIN    00000000-0000-0000-0000-00000000000a  platform admin
--   BIZ_A     11111111-0000-0000-0000-000000000001

-- AC-3 (Shape A): non-manager (viewer of A) calling set_member_business_role → RPC raises
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.set_member_business_role('00000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'member');
    RAISE EXCEPTION 'FAIL: W7-AC3 non-manager changed a member role' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- AC-3b (Shape A): outsider (no membership) calling get_member_access → RPC raises
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.get_member_access('00000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: W7-AC3b outsider viewed member access' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- AC-4 (Shape A): sole-owner self-demotion via RPC → error 'cannot demote the last owner'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.set_member_business_role('00000000-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000002', 'member');
    RAISE EXCEPTION 'FAIL: W7-AC4 sole owner self-demoted via RPC' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;  -- last-owner protection raise
  END;
END $$;
ROLLBACK;
-- verify the sole owner's row still owner (owner-side survival)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id='11111111-0000-0000-0000-000000000002'
                    AND user_id='00000000-0000-0000-0000-000000000006' AND role='owner') THEN
    RAISE EXCEPTION 'FAIL: W7-AC4 sole-owner row demoted (survival)' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- AC-1 (Shape B): owner of A changes MEMBER_A's role viewer→member → persists + audit row
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
PERFORM public.set_member_business_role('00000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'member');
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id='11111111-0000-0000-0000-000000000001'
                    AND user_id='00000000-0000-0000-0000-000000000005' AND role='member') THEN
    RAISE EXCEPTION 'FAIL: W7-AC1 role change did not persist' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log
                  WHERE entity_type='user_business_access'
                    AND details->>'business_id'='11111111-0000-0000-0000-000000000001'
                    AND details->>'new_role'='member') THEN
    RAISE EXCEPTION 'FAIL: W7-AC1 audit row missing' USING ERRCODE = 'P0001';
  END IF;
END $$;
-- paired cleanup: restore fixture
UPDATE public.user_business_access SET role='viewer'
 WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000005';

-- AC-1b (Shape A): uba-admin (not owner) elevates MEMBER_A to owner → RPC raises (elevation rule)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.set_member_business_role('00000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'owner');
    RAISE EXCEPTION 'FAIL: W7-AC1b uba-admin manufactured an owner' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- AC-5 (Shape C): get_member_access returns the member's business role
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.get_member_access('00000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001');
  IF r.business_role IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'FAIL: W7-AC5 get_member_access returned wrong role (%)', r.business_role USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;