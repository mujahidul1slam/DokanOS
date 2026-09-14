-- ============================================================================
-- W1a RLS battery: user_business_access cannot be self-granted.
-- §2.1 AC-1..15, shapes A / A'-UPDATE / A'-DELETE / B / C per §4.2 of PLAN-v5.
-- Fixture UUIDs seeded by scripts/run-rls-tests.mjs; user_roles re-seeded so
-- only ADMIN is platform admin. Runs LAST (filename order) — earlier files
-- must not destroy shared fixtures (BIZ_A is never deleted).
-- ============================================================================

-- Fixture legend (UUID / role-in-uba):
--   ADMIN       00000000-0000-0000-0000-00000000000a  platform admin
--   OWNER_A     00000000-0000-0000-0000-000000000001  owner of BIZ_A
--   OWNER_A2    00000000-0000-0000-0000-000000000002  co-owner of BIZ_A
--   UBA_ADMIN_A 00000000-0000-0000-0000-000000000003  admin of BIZ_A
--   MEMBER_A    00000000-0000-0000-0000-000000000004  member of BIZ_A
--   VIEWER_A    00000000-0000-0000-0000-000000000005  viewer of BIZ_A
--   OWNER_B     00000000-0000-0000-0000-000000000006  owner of B_other
--   OUTSIDER    00000000-0000-0000-0000-000000000007  no memberships
--   SPARE_A     00000000-0000-0000-0000-000000000008  auth.users row, NO uba row
--   SPARE_B     00000000-0000-0000-0000-000000000009  auth.users row, NO uba row
--   BIZ_A        11111111-0000-0000-0000-000000000001  'Biz A Fixture'
--   B_other      11111111-0000-0000-0000-000000000002  'Biz B Fixture'

-- ============ AC-1 (Shape A): viewer of A inserts self as owner on B_other → denied ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_business_access (user_id, business_id, role)
    VALUES ('00000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000002', 'owner');
    RAISE EXCEPTION 'FAIL: W1a-AC1 viewer self-insert on other business succeeded'
      USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- ============ AC-2 (Shape A): viewer of A inserts self as owner on A → denied ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_business_access (user_id, business_id, role)
    VALUES ('00000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'owner');
    RAISE EXCEPTION 'FAIL: W1a-AC2 viewer self-insert as owner on own business succeeded'
      USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;  -- WITH CHECK evaluated before unique constraint
  END;
END $$;
ROLLBACK;

-- ============ AC-3 (Shape B / Shape A): owner inserts SPARE_A as member on A → allowed; owner on B_other → denied ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO public.user_business_access (user_id, business_id, role)
VALUES ('00000000-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', 'member');
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE user_id='00000000-0000-0000-0000-000000000008'
                    AND business_id='11111111-0000-0000-0000-000000000001')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC3a owner insert of member did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
-- paired cleanup
DELETE FROM public.user_business_access WHERE user_id='00000000-0000-0000-0000-000000000008' AND business_id='11111111-0000-0000-0000-000000000001';

-- AC-3b: owner of A inserts SPARE_A as owner on B_other → denied (42501)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_business_access (user_id, business_id, role)
    VALUES ('00000000-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000002', 'owner');
    RAISE EXCEPTION 'FAIL: W1a-AC3b owner of A granted owner on B_other' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- ============ AC-4 (Shape B): platform admin inserts any row → allowed ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
INSERT INTO public.user_business_access (user_id, business_id, role)
VALUES ('00000000-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000002', 'owner');
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE user_id='00000000-0000-0000-0000-000000000009'
                    AND business_id='11111111-0000-0000-0000-000000000002')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC4 admin insert did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
DELETE FROM public.user_business_access WHERE user_id='00000000-0000-0000-0000-000000000009' AND business_id='11111111-0000-0000-0000-000000000002';

-- ============ AC-5 (elevation symmetry): UBA admin inserts member on A → allowed; owner → denied ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
INSERT INTO public.user_business_access (user_id, business_id, role)
VALUES ('00000000-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', 'member');
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE user_id='00000000-0000-0000-0000-000000000009'
                    AND business_id='11111111-0000-0000-0000-000000000001')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC5a uba-admin insert of member did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
DELETE FROM public.user_business_access WHERE user_id='00000000-0000-0000-0000-000000000009' AND business_id='11111111-0000-0000-0000-000000000001';

-- AC-5b: uba-admin inserts SPARE_B as owner on A → denied (42501)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_business_access (user_id, business_id, role)
    VALUES ('00000000-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', 'owner');
    RAISE EXCEPTION 'FAIL: W1a-AC5b uba-admin manufactured an owner' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- ============ AC-6 (Shape A'-DELETE): sole owner deletes own row → denied ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    DELETE FROM public.user_business_access
     WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1a-AC6 sole-owner row was deletable (rowcount %)', v_rc USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC6 sole-owner row did not survive' USING ERRCODE = 'P0001'; END IF;
END $$;
ROLLBACK;

-- ============ AC-7 (Shape B x3): owner deletes own row w/ co-owner; owner deletes member; uba-admin deletes member ============
-- 7a: OWNER_A (co-owner exists) deletes own row → allowed
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DELETE FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000001';
COMMIT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000001')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC7a co-owner leave did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
INSERT INTO public.user_business_access (user_id, business_id, role) VALUES ('00000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'owner');

-- 7b: OWNER_A deletes MEMBER_A's row → allowed
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DELETE FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004';
COMMIT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC7b owner delete of member did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
INSERT INTO public.user_business_access (user_id, business_id, role) VALUES ('00000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'member');

-- 7c: UBA_ADMIN_A deletes MEMBER_A's row → allowed
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DELETE FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004';
COMMIT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC7c uba-admin delete of member did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
INSERT INTO public.user_business_access (user_id, business_id, role) VALUES ('00000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'member');

-- ============ AC-8 (A'-DELETE / A'-UPDATE): uba-admin deletes/demotes sole owner of B_other → denied ============
-- 8a: UBA_ADMIN_A attempts to delete OWNER_B (sole owner of B_other) → denied
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    DELETE FROM public.user_business_access
     WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1a-AC8a uba-admin deleted sole owner (rowcount %)', v_rc USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC8a sole owner did not survive' USING ERRCODE = 'P0001'; END IF;
END $$;
ROLLBACK;

-- 8b: UBA_ADMIN_A demotes OWNER_B (owner→member) → denied, row survives with role='owner'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    UPDATE public.user_business_access SET role='member'
     WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1a-AC8b uba-admin demoted sole owner (rowcount %)', v_rc USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id='11111111-0000-0000-0000-000000000002'
                    AND user_id='00000000-0000-0000-0000-000000000006'
                    AND role='owner')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC8b sole owner demoted (survival/value)' USING ERRCODE = 'P0001'; END IF;
END $$;
ROLLBACK;

-- ============ AC-9 (A'-UPDATE, headline): sole owner self-demotes → denied ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    UPDATE public.user_business_access SET role='member'
     WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1a-AC9 sole-owner row was mutable (rowcount %)', v_rc USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id='11111111-0000-0000-0000-000000000002'
                    AND user_id='00000000-0000-0000-0000-000000000006'
                    AND role='owner')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC9 sole-owner row missing or demoted' USING ERRCODE = 'P0001'; END IF;
END $$;
ROLLBACK;

-- ============ AC-10 (B x3 / A x1): owner demotes co-owner; uba-admin demotes co-owner; elevation rules ============
-- 10a: OWNER_A demotes co-owner OWNER_A2 (owner→member) → allowed (OWNER_A still owner)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
UPDATE public.user_business_access SET role='member'
 WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000002';
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000002' AND role='member')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC10a owner demote of co-owner did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
UPDATE public.user_business_access SET role='owner' WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000002';

-- 10b: UBA_ADMIN_A demotes co-owner OWNER_A2 (owner→member) → allowed (OWNER_A still owner)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
UPDATE public.user_business_access SET role='member'
 WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000002';
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000002' AND role='member')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC10b uba-admin demote of co-owner did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
UPDATE public.user_business_access SET role='owner' WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000002';

-- 10c: UBA_ADMIN_A elevates MEMBER_A viewer→owner → denied (WITH CHECK raises 42501)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    UPDATE public.user_business_access SET role='owner'
     WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004';
    RAISE EXCEPTION 'FAIL: W1a-AC10c uba-admin elevated a member to owner' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;  -- UPDATE WITH CHECK elevation violation
  END;
END $$;
ROLLBACK;

-- 10d: OWNER_A elevates MEMBER_A viewer→owner → allowed
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
UPDATE public.user_business_access SET role='owner'
 WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004';
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004' AND role='owner')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC10d owner elevation did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
UPDATE public.user_business_access SET role='member' WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004';

-- ============ AC-11 (Shape A trigger): OWNER_A2 mutates OWNER_A's identity → trigger check_violation ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    UPDATE public.user_business_access SET user_id='00000000-0000-0000-0000-000000000008'
     WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL: W1a-AC11 identity mutation succeeded' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;  -- check_violation from trg_uba_immutable
  END;
END $$;
ROLLBACK;

-- ============ AC-12 (Shape B exemption): platform admin deletes/demotes sole owner → allowed ============
-- 12a: ADMIN deletes OWNER_B (sole owner of B_other) → allowed (backstop)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DELETE FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006';
COMMIT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC12a admin delete of sole owner did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
-- paired restore
INSERT INTO public.user_business_access (user_id, business_id, role) VALUES ('00000000-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000002', 'owner');

-- 12b: ADMIN demotes sole owner OWNER_B → allowed (backstop)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
UPDATE public.user_business_access SET role='member' WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006';
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006' AND role='member')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC12b admin demote of sole owner did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
UPDATE public.user_business_access SET role='owner' WHERE business_id='11111111-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000006';

-- ============ AC-14 (SELECT regression — pure SQL): member reads own row = 1 ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.user_business_access
   WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: W1a-AC14 member own-row read changed (count=%)', n USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ============ AC-15 (Shape C): uba-admin cannot SELECT another member's row ============
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.user_business_access
   WHERE business_id='11111111-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1a-AC15 manager saw another member''s row' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;