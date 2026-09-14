-- ============================================================================
-- W4 RLS battery: app_settings writes restricted to settings.manage holders or
-- platform admin. Shapes per §4.2 of PLAN-v5: Shape A (WITH CHECK raises 42501),
-- Shape A'-UPDATE (USING denial → rowcount=0 + value-pinned survival),
-- Shape B (allowed, persists). Fixture UUIDs are seeded by scripts/run-rls-tests.mjs.
-- ============================================================================

-- Fixture users (seeded by runner; role: staff unless noted)
--   ADMIN       00000000-0000-0000-0000-00000000000a  (user_roles: admin)
--   STAFF_NO    00000000-0000-0000-0000-00000000000b  (staff, no settings.manage)
--   STAFF_MGMT  00000000-0000-0000-0000-00000000000c  (staff, settings.manage override)
--   OWNER_A     00000000-0000-0000-0000-000000000001  (staff — used as an extra
--                actor when a second "plain staff" is needed)

-- W4 AC-A: staff WITHOUT settings.manage INSERT → WITH CHECK → 42501 (Shape A)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.app_settings (key, value) VALUES ('battery_probe', '{"x":1}'::jsonb);
    RAISE EXCEPTION 'FAIL: W4-A staff-no-perm insert unexpectedly succeeded'
      USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;  -- WITH CHECK denial — expected
  END;
END $$;
ROLLBACK;

-- W4 AC-A'-UPDATE: staff WITHOUT settings.manage UPDATE → denied by USING
-- invisibility. Mandatory rowcount assert + value-pinned survival.
-- Precondition: a fixture app_settings row exists (seeded by runner as
-- connection owner): key='battery_flag', value='{"enabled":false}'.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    UPDATE public.app_settings SET value = '{"enabled":true}'::jsonb WHERE key = 'battery_flag';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- error-world denial (grants revoked): 42501 — expected
    WHEN OTHERS THEN RAISE;                 -- harness defects must fail loudly
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;         -- MANDATORY discriminator
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: W4-A'' staff-no-perm update was mutable (rowcount %)', v_rc
      USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings
                  WHERE key = 'battery_flag' AND value = '{"enabled":false}'::jsonb) THEN
    RAISE EXCEPTION 'FAIL: W4-A'' staff-no-perm update altered the value (survival)'
      USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- W4 AC-B: staff WITH settings.manage override INSERT → allowed (Shape B)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO public.app_settings (key, value) VALUES ('battery_probe_mgmt', '{"x":1}'::jsonb);
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'battery_probe_mgmt') THEN
    RAISE EXCEPTION 'FAIL: W4-B staff-with-manage insert did not persist' USING ERRCODE = 'P0001';
  END IF;
END $$;
-- paired cleanup
DELETE FROM public.app_settings WHERE key = 'battery_probe_mgmt';

-- W4 AC-B2: staff WITH settings.manage override UPDATE → allowed (Shape B)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
UPDATE public.app_settings SET value = '{"enabled":true}'::jsonb WHERE key = 'battery_flag';
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'battery_flag' AND value = '{"enabled":true}'::jsonb) THEN
    RAISE EXCEPTION 'FAIL: W4-B2 staff-with-manage update did not persist' USING ERRCODE = 'P0001';
  END IF;
END $$;
-- restore fixture
UPDATE public.app_settings SET value = '{"enabled":false}'::jsonb WHERE key = 'battery_flag';

-- W4 AC-B3: platform admin INSERT → allowed (Shape B)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
INSERT INTO public.app_settings (key, value) VALUES ('battery_probe_admin', '{"x":1}'::jsonb);
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'battery_probe_admin') THEN
    RAISE EXCEPTION 'FAIL: W4-B3 admin insert did not persist' USING ERRCODE = 'P0001';
  END IF;
END $$;
DELETE FROM public.app_settings WHERE key = 'battery_probe_admin';

-- W4 AC-SELECT: any authenticated SELECT unchanged (regression)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.app_settings WHERE key = 'battery_flag';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: W4-SELECT authenticated read of app_settings changed (count=%)', n
      USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;