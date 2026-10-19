-- ============================================================================
-- Issue #13 RLS battery: business-account member invitations.
--
-- Fixture legend (seeded by scripts/run-rls-tests.mjs):
--   OWNER_A     00000000-0000-0000-0000-000000000001  owner of BIZ_A   owner_a@dokanos.test
--   OWNER_A2    00000000-0000-0000-0000-000000000002  co-owner BIZ_A   owner_a2@dokanos.test
--   UBA_ADMIN_A 00000000-0000-0000-0000-000000000003  admin of BIZ_A   uba_admin_a@dokanos.test
--   MEMBER_A    00000000-0000-0000-0000-000000000004  member of BIZ_A  member_a@dokanos.test
--   VIEWER_A    00000000-0000-0000-0000-000000000005  viewer of BIZ_A  viewer_a@dokanos.test
--   OWNER_B     00000000-0000-0000-0000-000000000006  owner of B_OTHER owner_b@dokanos.test
--   OUTSIDER    00000000-0000-0000-0000-000000000007  no memberships   outsider@dokanos.test
--   SPARE_A     00000000-0000-0000-0000-000000000008  no memberships   spare_a@dokanos.test
--   SPARE_B     00000000-0000-0000-0000-000000000009  no memberships   spare_b@dokanos.test
--   BIZ_A       11111111-0000-0000-0000-000000000001  'Biz A Fixture'
--   B_OTHER     11111111-0000-0000-0000-000000000002  'Biz B Fixture'
--
-- Shapes: A  — function-body RAISE is exception-visible.
--         A' — deny-by-invisibility (rowcount assert).
--         B  — allow + verify as connection owner + paired cleanup.
--         C  — SELECT narrowing (targeted positives).
-- Only the repeat-acceptance proof and the owner directory probe commit; both
-- end with a paired cleanup, and the final block removes anything left over.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- AC-1 (Shape A): only an owner may issue an invitation. Members, viewers,
-- account admins, nonmembers and other-account owners are refused.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', 'invited_by_nonowner@dokanos.test');
    RAISE EXCEPTION 'FAIL: AC1 member issued an account invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', 'invited_by_nonowner@dokanos.test');
    RAISE EXCEPTION 'FAIL: AC1 viewer issued an account invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', 'invited_by_nonowner@dokanos.test');
    RAISE EXCEPTION 'FAIL: AC1 account admin issued an account invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', 'invited_by_nonowner@dokanos.test');
    RAISE EXCEPTION 'FAIL: AC1 outsider issued an account invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', 'invited_by_nonowner@dokanos.test');
    RAISE EXCEPTION 'FAIL: AC1 other-account owner issued an account invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- AC-1b (Shape A): an invalid email address is refused before any write.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', 'not-an-email');
    RAISE EXCEPTION 'FAIL: AC1b invalid email was accepted' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', '   ');
    RAISE EXCEPTION 'FAIL: AC1b empty email was accepted' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN NULL;
  END;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-2 (Shape B): an owner invitation carries the account context and the
-- intended (normalized) email identity, always as role 'member'.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.invite_business_member('11111111-0000-0000-0000-000000000001', '  New.Person@Dokanos.TEST  ');
  IF r->>'business_id' IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: AC2 invitation lost its account context (%)', r USING ERRCODE = 'P0001';
  END IF;
  IF r->>'email' IS DISTINCT FROM 'new.person@dokanos.test' THEN
    RAISE EXCEPTION 'FAIL: AC2 invitation email was not normalized (%)', r USING ERRCODE = 'P0001';
  END IF;
  IF r->>'role' IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'FAIL: AC2 invitation did not default to the member role (%)', r USING ERRCODE = 'P0001';
  END IF;
  IF r->>'token' IS NULL OR length(r->>'token') < 16 THEN
    RAISE EXCEPTION 'FAIL: AC2 invitation carried no usable opaque token (%)', r USING ERRCODE = 'P0001';
  END IF;
  IF r->>'status' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FAIL: AC2 invitation status was %', r->>'status' USING ERRCODE = 'P0001';
  END IF;

  -- A duplicate pending invitation for the same identity is refused.
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', 'new.person@dokanos.test');
    RAISE EXCEPTION 'FAIL: AC2 duplicate pending invitation was accepted' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23505' THEN NULL;
  END;

  -- An existing member cannot be invited.
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', 'member_a@dokanos.test');
    RAISE EXCEPTION 'FAIL: AC2 existing member was invited again' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23505' THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_invitations
    WHERE business_id = '11111111-0000-0000-0000-000000000001'
      AND email = 'new.person@dokanos.test'
      AND role = 'member'
      AND accepted_at IS NULL AND revoked_at IS NULL
      AND invited_by = '00000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC2 invitation row missing after the owner RPC' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE action = 'invite_business_member'
      AND details->>'email' = 'new.person@dokanos.test'
      AND details->>'business_id' = '11111111-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC2 invitation audit row missing' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-3 (Shape B): the intended verified email accepts. Joining grants
-- account-wide member operational access only: no platform role, no store
-- grant, no granular permission, and no business account for the invitee.
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO auth.users
  (id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-00000000000e', 'authenticated', 'authenticated',
   'new.person@dokanos.test', 'local-fixture-password-never-used-for-login', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- The owner receives the invite link from the RPC. The ledger has no client
-- policies, so the token travels the same way it does in the product — through
-- the invitation link — rather than through a direct table read.
SELECT set_config('test.accept_token',
  public.invite_business_member('11111111-0000-0000-0000-000000000001', 'new.person@dokanos.test')->>'token',
  true);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}';
DO $$
DECLARE
  r jsonb;
BEGIN
  r := public.accept_business_invitation(current_setting('test.accept_token'));
  IF r->>'outcome' IS DISTINCT FROM 'joined' THEN
    RAISE EXCEPTION 'FAIL: AC3 acceptance outcome was % (%)', r->>'outcome', r USING ERRCODE = 'P0001';
  END IF;
  IF r->>'role' IS DISTINCT FROM 'member'
     OR r->>'business_id' IS DISTINCT FROM '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: AC3 acceptance returned the wrong grant (%)', r USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
DECLARE
  v_roles bigint;
  v_stores bigint;
  v_perms bigint;
BEGIN
  -- The invitee's personal identity gained no platform role, no store grant and
  -- no granular permission: only account-wide operational membership.
  SELECT count(*) INTO v_roles FROM public.user_roles
   WHERE user_id = '00000000-0000-0000-0000-00000000000e';
  SELECT count(*) INTO v_stores FROM public.user_store_access
   WHERE user_id = '00000000-0000-0000-0000-00000000000e';
  SELECT count(*) INTO v_perms FROM public.user_permissions
   WHERE user_id = '00000000-0000-0000-0000-00000000000e';
  IF v_roles <> 0 OR v_stores <> 0 OR v_perms <> 0 THEN
    RAISE EXCEPTION 'FAIL: AC3 joining assigned a platform role or granular grant (roles %, stores %, perms %)',
      v_roles, v_stores, v_perms USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = '00000000-0000-0000-0000-00000000000e'
      AND business_id = '11111111-0000-0000-0000-000000000001'
      AND role = 'member'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC3 membership row missing after acceptance' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_invitations
    WHERE business_id = '11111111-0000-0000-0000-000000000001'
      AND email = 'new.person@dokanos.test'
      AND accepted_at IS NOT NULL
      AND accepted_by = '00000000-0000-0000-0000-00000000000e'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC3 accepted_at stamp missing' USING ERRCODE = 'P0001';
  END IF;
  -- The invitee's personal identity did not become its own business account.
  IF EXISTS (SELECT 1 FROM public.businesses WHERE email = 'new.person@dokanos.test') THEN
    RAISE EXCEPTION 'FAIL: AC3 acceptance created a business account' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-4 (Shape A): acceptance is email-bound. The wrong identity is refused,
-- creates no membership, and does not consume the invitation.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT public.invite_business_member('11111111-0000-0000-0000-000000000001', 'spare_a@dokanos.test');
RESET ROLE;
SELECT set_config('test.invite_token',
  (SELECT token FROM public.business_invitations
    WHERE business_id = '11111111-0000-0000-0000-000000000001' AND email = 'spare_a@dokanos.test'), true);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.accept_business_invitation(current_setting('test.invite_token'));
    RAISE EXCEPTION 'FAIL: AC4 wrong email accepted the invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = '00000000-0000-0000-0000-000000000009'
      AND business_id = '11111111-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC4 wrong-email acceptance created membership' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.business_invitations
    WHERE email = 'spare_a@dokanos.test' AND accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: AC4 wrong-email attempt consumed the invitation' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- AC-5a (Shape A): an unknown token is invalid for anyone.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.accept_business_invitation('test-unknown-token-0001');
    RAISE EXCEPTION 'FAIL: AC5a unknown token was accepted' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;
ROLLBACK;

-- AC-5b (Shape A): a revoked invitation is unusable and grants nothing.
BEGIN;
INSERT INTO public.business_invitations (business_id, email, token, revoked_at, revoked_by)
VALUES ('11111111-0000-0000-0000-000000000001', 'spare_a@dokanos.test', 'test-revoked-token-0001',
        now(), '00000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.accept_business_invitation('test-revoked-token-0001');
    RAISE EXCEPTION 'FAIL: AC5b revoked invitation was accepted' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access
              WHERE user_id = '00000000-0000-0000-0000-000000000008') THEN
    RAISE EXCEPTION 'FAIL: AC5b revoked invitation created membership' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- AC-5c (Shape A): an expired invitation is unusable and grants nothing.
BEGIN;
INSERT INTO public.business_invitations (business_id, email, token, expires_at)
VALUES ('11111111-0000-0000-0000-000000000001', 'spare_a@dokanos.test', 'test-expired-token-0001',
        now() - interval '1 day');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.accept_business_invitation('test-expired-token-0001');
    RAISE EXCEPTION 'FAIL: AC5c expired invitation was accepted' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;
ROLLBACK;

-- AC-5d (Shape A): an already-consumed invitation whose membership no longer
-- exists cannot be replayed into a fresh membership.
BEGIN;
INSERT INTO public.business_invitations (business_id, email, token, accepted_at, accepted_by)
VALUES ('11111111-0000-0000-0000-000000000001', 'spare_b@dokanos.test', 'test-used-token-00001',
        now(), '00000000-0000-0000-0000-000000000009');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.accept_business_invitation('test-used-token-00001');
    RAISE EXCEPTION 'FAIL: AC5d consumed invitation was replayed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = '00000000-0000-0000-0000-000000000009'
      AND business_id = '11111111-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC5d replay created membership' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- AC-6 (Shape A): an unverified identity cannot accept — the binding is on a
-- verified personal email, not on a typed address.
BEGIN;
INSERT INTO auth.users
  (id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-00000000000f', 'authenticated', 'authenticated',
   'unverified_person@dokanos.test', 'local-fixture-password-never-used-for-login', NULL,
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.business_invitations (business_id, email, token)
VALUES ('11111111-0000-0000-0000-000000000001', 'unverified_person@dokanos.test', 'test-unverified-token-01');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000f","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.accept_business_invitation('test-unverified-token-01');
    RAISE EXCEPTION 'FAIL: AC6 unverified person accepted an invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-7 (Shape B): acceptance is safely repeatable. The second acceptance
-- reports already_member, keeps exactly one membership row and the role.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- Session-scoped (not transaction-local): this proof must span the commit that
-- makes the first membership durable. The value is cleared in the paired cleanup.
SELECT set_config('test.repeat_token',
  public.invite_business_member('11111111-0000-0000-0000-000000000001', 'spare_b@dokanos.test')->>'token',
  false);
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.accept_business_invitation(current_setting('test.repeat_token'));
  IF r->>'outcome' IS DISTINCT FROM 'joined' THEN
    RAISE EXCEPTION 'FAIL: AC7 first acceptance outcome was %', r->>'outcome' USING ERRCODE = 'P0001';
  END IF;
END $$;
COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = '00000000-0000-0000-0000-000000000009'
      AND business_id = '11111111-0000-0000-0000-000000000001'
      AND role = 'member'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC7 first acceptance did not persist' USING ERRCODE = 'P0001';
  END IF;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.accept_business_invitation(current_setting('test.repeat_token'));
  IF r->>'outcome' IS DISTINCT FROM 'already_member' THEN
    RAISE EXCEPTION 'FAIL: AC7 repeat acceptance outcome was %', r->>'outcome' USING ERRCODE = 'P0001';
  END IF;
  IF r->>'role' IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'FAIL: AC7 repeat acceptance changed the role to %', r->>'role' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;
RESET ROLE;
DO $$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.user_business_access
   WHERE user_id = '00000000-0000-0000-0000-000000000009'
     AND business_id = '11111111-0000-0000-0000-000000000001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: AC7 repeated acceptance duplicated membership (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
END $$;
-- Paired cleanup (this proof needs committed rows to be meaningful).
RESET test.repeat_token;
DELETE FROM public.user_business_access
 WHERE user_id = '00000000-0000-0000-0000-000000000009'
   AND business_id IN ('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002');
DELETE FROM public.business_invitations WHERE email = 'spare_b@dokanos.test';
DELETE FROM public.audit_log
 WHERE action IN ('invite_business_member', 'accept_business_invitation')
   AND details->>'business_id' = '11111111-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- AC-8 (Shape C): the invitation directory is owner-only. Members, viewers,
-- account admins, outsiders and other-account owners see nothing.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT public.invite_business_member('11111111-0000-0000-0000-000000000001', 'directory_probe@dokanos.test');
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.list_business_invitations('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC8 member listed account invitations' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.list_business_invitations('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC8 viewer listed account invitations' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.list_business_invitations('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC8 account admin listed account invitations' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.list_business_invitations('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC8 outsider listed account invitations' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.list_business_invitations('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC8 other-account owner listed account invitations' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_status text; v_count int; v_token text;
BEGIN
  SELECT count(*) INTO v_count FROM public.list_business_invitations('11111111-0000-0000-0000-000000000001')
   WHERE email = 'directory_probe@dokanos.test';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: AC8 owner listing returned % matching rows', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT status, token INTO v_status, v_token
    FROM public.list_business_invitations('11111111-0000-0000-0000-000000000001')
   WHERE email = 'directory_probe@dokanos.test';
  IF v_status IS DISTINCT FROM 'pending' OR v_token IS NULL OR length(v_token) < 16 THEN
    RAISE EXCEPTION 'FAIL: AC8 owner listing returned (%, %)', v_status, v_token USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- AC-8b (Shape C): the member directory is readable by any account member and
-- by nobody else; it exposes no invitation data.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE v_fixture int;
BEGIN
  SELECT count(*) INTO v_fixture FROM public.list_business_members('11111111-0000-0000-0000-000000000001')
   WHERE user_id IN ('00000000-0000-0000-0000-000000000001',
                     '00000000-0000-0000-0000-000000000002',
                     '00000000-0000-0000-0000-000000000003',
                     '00000000-0000-0000-0000-000000000004',
                     '00000000-0000-0000-0000-000000000005');
  IF v_fixture <> 5 THEN
    RAISE EXCEPTION 'FAIL: AC8b member directory returned % fixture members', v_fixture USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.list_business_members('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC8b outsider read the member directory' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-9 (Shape B): owner-only membership management. Members, account admins,
-- nonmembers and other-account owners cannot remove anyone; the owner can
-- remove a member, but never an owner (or themselves) this way.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.remove_business_member('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005');
    RAISE EXCEPTION 'FAIL: AC9 member removed another member' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.remove_business_member('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004');
    RAISE EXCEPTION 'FAIL: AC9 account admin removed a member' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.remove_business_member('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004');
    RAISE EXCEPTION 'FAIL: AC9 outsider removed a member' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.remove_business_member('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004');
    RAISE EXCEPTION 'FAIL: AC9 other-account owner removed a member' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  -- An owner is never removable through ordinary member removal, even when a
  -- second owner exists (ownership transfer belongs to a later slice).
  BEGIN
    PERFORM public.remove_business_member('11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'FAIL: AC9 owner removed an owner through member removal' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM public.remove_business_member('11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC9 owner removed themselves through member removal' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
  -- A nonmember target is reported as not found, uniformly.
  BEGIN
    PERFORM public.remove_business_member('11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000007');
    RAISE EXCEPTION 'FAIL: AC9 missing member was reported as removed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN NULL;
  END;
END $$;
ROLLBACK;

-- The owner removes an ordinary member: allowed, audited, row gone, owner intact.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.remove_business_member('11111111-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004');
  IF r->>'removed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FAIL: AC9 owner removal outcome was %', r USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = '00000000-0000-0000-0000-000000000004'
      AND business_id = '11111111-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC9 owner removal left the membership row' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = '00000000-0000-0000-0000-000000000002'
      AND business_id = '11111111-0000-0000-0000-000000000001' AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC9 owner rows changed during member removal' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE action = 'remove_business_member'
      AND details->>'user_id' = '00000000-0000-0000-0000-000000000004'
      AND details->>'business_id' = '11111111-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC9 removal audit row missing' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-10 (Shape A'): the invitation ledger is not client-writable. Not even the
-- owner can insert a row outside the audited RPC.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    INSERT INTO public.business_invitations (business_id, email)
    VALUES ('11111111-0000-0000-0000-000000000001', 'direct_write@dokanos.test');
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: AC10 owner inserted an invitation row directly (rowcount %)', v_rc USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-11 (Shape C): describe gives every arrival a clear outcome and never
-- reports a mismatch as a match.
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.business_invitations (business_id, email, token, expires_at)
VALUES ('11111111-0000-0000-0000-000000000001', 'spare_a@dokanos.test', 'test-expired-token-0002',
        now() - interval '1 hour');
INSERT INTO public.business_invitations (business_id, email, token, revoked_at, revoked_by)
VALUES ('11111111-0000-0000-0000-000000000001', 'spare_a@dokanos.test', 'test-revoked-token-0002',
        now(), '00000000-0000-0000-0000-000000000001');
INSERT INTO public.business_invitations (business_id, email, token, accepted_at, accepted_by)
VALUES ('11111111-0000-0000-0000-000000000001', 'spare_a@dokanos.test', 'test-accepted-token-0002',
        now(), '00000000-0000-0000-0000-000000000008');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}';
DO $$
DECLARE r jsonb;
BEGIN
  SELECT public.describe_business_invitation('test-expired-token-0002') INTO r;
  IF r->>'status' IS DISTINCT FROM 'expired' OR (r->>'email_matches')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: AC11 expired description was % (%)', r->>'status', r USING ERRCODE = 'P0001';
  END IF;
  IF r->>'business_name' IS DISTINCT FROM 'Biz A Fixture' THEN
    RAISE EXCEPTION 'FAIL: AC11 description lost the account context (%)', r USING ERRCODE = 'P0001';
  END IF;
  SELECT public.describe_business_invitation('test-revoked-token-0002') INTO r;
  IF r->>'status' IS DISTINCT FROM 'revoked' THEN
    RAISE EXCEPTION 'FAIL: AC11 revoked description was %', r->>'status' USING ERRCODE = 'P0001';
  END IF;
  SELECT public.describe_business_invitation('test-accepted-token-0002') INTO r;
  IF r->>'status' IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'FAIL: AC11 accepted description was %', r->>'status' USING ERRCODE = 'P0001';
  END IF;
  SELECT public.describe_business_invitation('test-unknown-token-0002') INTO r;
  IF r->>'status' IS DISTINCT FROM 'invalid' OR (r->>'email_matches')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: AC11 unknown description was % (%)', r->>'status', r USING ERRCODE = 'P0001';
  END IF;
END $$;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
DO $$
DECLARE r jsonb;
BEGIN
  SELECT public.describe_business_invitation('test-revoked-token-0002') INTO r;
  IF (r->>'email_matches')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: AC11 wrong identity saw a matching email (%)', r USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- AC-11b (Shape A): anon cannot reach any invitation RPC.
BEGIN;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.invite_business_member('11111111-0000-0000-0000-000000000001', 'anon@dokanos.test');
    RAISE EXCEPTION 'FAIL: AC11b anon issued an invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.accept_business_invitation('any-token');
    RAISE EXCEPTION 'FAIL: AC11b anon accepted an invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.describe_business_invitation('any-token');
    RAISE EXCEPTION 'FAIL: AC11b anon described an invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.list_business_invitations('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC11b anon listed invitations' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.remove_business_member('11111111-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000004');
    RAISE EXCEPTION 'FAIL: AC11b anon removed a member' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.list_business_members('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: AC11b anon read the member directory' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.revoke_business_invitation('22222222-0000-0000-0000-000000000013');
    RAISE EXCEPTION 'FAIL: AC11b anon revoked an invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC-12 (Shape B): only the owner withdraws an open invitation, and a
-- withdrawn invitation is unusable and grants nothing.
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.business_invitations (id, business_id, email, token)
VALUES ('22222222-0000-0000-0000-000000000013', '11111111-0000-0000-0000-000000000001',
        'spare_a@dokanos.test', 'test-revoke-token-0001');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.revoke_business_invitation('22222222-0000-0000-0000-000000000013');
    RAISE EXCEPTION 'FAIL: AC12 member revoked an invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.revoke_business_invitation('22222222-0000-0000-0000-000000000013');
    RAISE EXCEPTION 'FAIL: AC12 account admin revoked an invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.revoke_business_invitation('22222222-0000-0000-0000-000000000013');
    RAISE EXCEPTION 'FAIL: AC12 other-account owner revoked an invitation' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.revoke_business_invitation('22222222-0000-0000-0000-000000000013');
  IF r->>'revoked' IS DISTINCT FROM 'true' OR r->>'status' IS DISTINCT FROM 'revoked' THEN
    RAISE EXCEPTION 'FAIL: AC12 owner revoke outcome was % (%)', r->>'status', r USING ERRCODE = 'P0001';
  END IF;
END $$;
-- The intended identity can no longer use it.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.accept_business_invitation('test-revoke-token-0001');
    RAISE EXCEPTION 'FAIL: AC12 withdrawn invitation was accepted' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE user_id = '00000000-0000-0000-0000-000000000008'
      AND business_id = '11111111-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC12 revocation still granted membership' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_invitations
    WHERE id = '22222222-0000-0000-0000-000000000013'
      AND revoked_at IS NOT NULL
      AND revoked_by = '00000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC12 revocation stamp missing' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE action = 'revoke_business_invitation'
      AND details->>'email' = 'spare_a@dokanos.test'
      AND details->>'business_id' = '11111111-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'FAIL: AC12 revocation audit row missing' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- Paired cleanup: nothing this file created may leak into the other tests.
-- ---------------------------------------------------------------------------
DELETE FROM public.user_business_access
 WHERE user_id IN ('00000000-0000-0000-0000-000000000008',
                   '00000000-0000-0000-0000-000000000009')
   AND business_id IN ('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002');
DELETE FROM public.business_invitations
 WHERE email IN ('new.person@dokanos.test', 'spare_a@dokanos.test', 'spare_b@dokanos.test',
                 'directory_probe@dokanos.test', 'invited_by_nonowner@dokanos.test',
                 'unverified_person@dokanos.test', 'direct_write@dokanos.test');
DELETE FROM public.audit_log
 WHERE action IN ('invite_business_member', 'accept_business_invitation',
                  'revoke_business_invitation', 'remove_business_member');
