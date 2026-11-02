-- ============================================================================
-- Issue #14: transfer business-account ownership before an owner departs.
--
-- Ownership is a protected authority. An ordinary member cannot transfer it,
-- restrict it, or remove an owner. A transfer is a deliberate act by a
-- CURRENT owner, names an EXISTING member of the SAME account, promotes that
-- member and demotes only the caller. Owners that already exist (including
-- reviewed legacy co-owners) are never removed by this operation.
--
-- Every ownership transition takes the business row lock first and then locks
-- all membership rows in a deterministic order. That serializes transfer,
-- departure, member removal and role changes per account, so competing
-- requests cannot each observe "another owner exists" and then both commit an
-- ownerless account. A final owner-count assertion makes the invariant
-- explicit even if the authorization logic above is changed later.
--
-- Departure: an owner must transfer ownership before leaving. Once the former
-- owner is an ordinary member, leaving removes only that person's row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- transfer_business_ownership — strictly owner-only (no platform-admin bypass).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_business_ownership(
  p_business_id   uuid,
  p_new_owner_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller             uuid := auth.uid();
  v_caller_role        text;
  v_target_role        text;
  v_owner_count        integer;
  v_business_name      text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_id IS NULL THEN
    RAISE EXCEPTION 'TARGET_NOT_MEMBER: choose an existing member of this account'
      USING ERRCODE = '22023';
  END IF;

  IF p_new_owner_id = v_caller THEN
    RAISE EXCEPTION 'TARGET_IS_CALLER: ownership must be transferred to another member'
      USING ERRCODE = '22023';
  END IF;

  -- The business row is the per-account mutex for every ownership transition.
  PERFORM 1
    FROM public.businesses
   WHERE id = p_business_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND: that account does not exist'
      USING ERRCODE = '22023';
  END IF;

  -- Deterministic lock order prevents two transfers from deadlocking on
  -- different membership rows. The state checks below are re-read after the
  -- lock, so a competing role change/removal cannot slip between check and act.
  PERFORM 1
    FROM public.user_business_access
   WHERE business_id = p_business_id
   ORDER BY user_id
     FOR UPDATE;

  SELECT a.role INTO v_caller_role
    FROM public.user_business_access a
   WHERE a.business_id = p_business_id
     AND a.user_id = v_caller;

  IF v_caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'OWNER_REQUIRED: only a current owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  SELECT a.role INTO v_target_role
    FROM public.user_business_access a
   WHERE a.business_id = p_business_id
     AND a.user_id = p_new_owner_id;

  -- An existing member of THIS account only. A user id from another account
  -- has no row here, so a forged/cross-account target is denied.
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'TARGET_NOT_MEMBER: choose an existing member of this account'
      USING ERRCODE = '22023';
  END IF;

  IF v_target_role IS DISTINCT FROM 'owner' THEN
    UPDATE public.user_business_access
       SET role = 'owner'
     WHERE business_id = p_business_id
       AND user_id = p_new_owner_id;
  END IF;

  -- Only the transferring owner gives up owner authority. Additional owners
  -- (including reviewed legacy co-owners) keep their rows and roles untouched.
  UPDATE public.user_business_access
     SET role = 'member'
   WHERE business_id = p_business_id
     AND user_id = v_caller;

  SELECT count(*)::integer INTO v_owner_count
    FROM public.user_business_access
   WHERE business_id = p_business_id
     AND role = 'owner';

  IF v_owner_count < 1 THEN
    RAISE EXCEPTION 'OWNER_INVARIANT: ownership transfer would leave the account ownerless'
      USING ERRCODE = '23514';
  END IF;

  SELECT b.name INTO v_business_name
    FROM public.businesses b
   WHERE b.id = p_business_id;

  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    v_caller,
    (SELECT u.email FROM auth.users u WHERE u.id = v_caller),
    'transfer_business_ownership',
    'user_business_access',
    p_new_owner_id::text,
    jsonb_build_object(
      'business_id', p_business_id,
      'business_name', v_business_name,
      'previous_owner_id', v_caller,
      'previous_owner_role', v_caller_role,
      'new_owner_id', p_new_owner_id,
      'new_owner_previous_role', v_target_role,
      'owner_count', v_owner_count
    )
  );

  RETURN jsonb_build_object(
    'transferred', true,
    'business_id', p_business_id,
    'business_name', v_business_name,
    'previous_owner_id', v_caller,
    'previous_owner_role', 'member',
    'new_owner_id', p_new_owner_id,
    'new_owner_previous_role', v_target_role,
    'owner_count', v_owner_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_business_ownership(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_business_ownership(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- leave_business_account — self-departure.
--
-- An owner cannot leave until ownership has been transferred: the deliberate
-- transfer above demotes them to member first. Ordinary members, viewers and
-- legacy account admins may leave their own membership. The same business and
-- membership locks make concurrent leave/transfer requests serial.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_business_account(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_role        text;
  v_owner_count integer;
  v_business_name text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public.businesses
   WHERE id = p_business_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND: that account does not exist'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.user_business_access
   WHERE business_id = p_business_id
   ORDER BY user_id
     FOR UPDATE;

  SELECT a.role INTO v_role
    FROM public.user_business_access a
   WHERE a.business_id = p_business_id
     AND a.user_id = v_caller;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: you are not a member of this account'
      USING ERRCODE = '22023';
  END IF;

  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'OWNER_TRANSFER_REQUIRED: transfer ownership to another member before leaving'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.user_business_access
   WHERE business_id = p_business_id
     AND user_id = v_caller;

  SELECT count(*)::integer INTO v_owner_count
    FROM public.user_business_access
   WHERE business_id = p_business_id
     AND role = 'owner';

  IF v_owner_count < 1 THEN
    RAISE EXCEPTION 'OWNER_INVARIANT: departure would leave the account ownerless'
      USING ERRCODE = '23514';
  END IF;

  SELECT b.name INTO v_business_name
    FROM public.businesses b
   WHERE b.id = p_business_id;

  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    v_caller,
    (SELECT u.email FROM auth.users u WHERE u.id = v_caller),
    'leave_business_account',
    'user_business_access',
    v_caller::text,
    jsonb_build_object(
      'business_id', p_business_id,
      'business_name', v_business_name,
      'role', v_role
    )
  );

  RETURN jsonb_build_object(
    'left', true,
    'business_id', p_business_id,
    'business_name', v_business_name,
    'role', v_role
  );
END;
$$;
REVOKE ALL ON FUNCTION public.leave_business_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_business_account(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Serialize the existing guarded RPCs with the same per-business mutex.
--
-- Without these locks, remove_business_member could read a target as 'member',
-- wait behind a concurrent transfer, and then delete the row after it became
-- the new owner. Re-reading under the business/membership locks closes that
-- check-then-act race while preserving the #13 authorization behavior.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_business_member(
  p_business_id uuid,
  p_user_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role    text;
  v_email   text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public.businesses
   WHERE id = p_business_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND: that account does not exist'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1
    FROM public.user_business_access
   WHERE business_id = p_business_id
   ORDER BY user_id
     FOR UPDATE;

  IF public.my_business_role(p_business_id, v_user_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'OWNER_REQUIRED: only the account owner can remove members'
      USING ERRCODE = '42501';
  END IF;

  SELECT a.role INTO v_role
    FROM public.user_business_access a
   WHERE a.business_id = p_business_id
     AND a.user_id = p_user_id
     FOR UPDATE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: that person is not a member of this account'
      USING ERRCODE = '22023';
  END IF;

  IF v_role = 'owner' OR p_user_id = v_user_id THEN
    RAISE EXCEPTION 'OWNER_NOT_REMOVABLE: an owner cannot be removed as an ordinary member'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.user_business_access
   WHERE business_id = p_business_id AND user_id = p_user_id;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user_id;

  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    (SELECT email FROM auth.users WHERE id = v_user_id),
    'remove_business_member',
    'user_business_access',
    p_user_id::text,
    jsonb_build_object(
      'business_id', p_business_id,
      'user_id', p_user_id,
      'email', v_email,
      'role', v_role
    )
  );

  RETURN jsonb_build_object(
    'removed', true,
    'business_id', p_business_id,
    'user_id', p_user_id,
    'role', v_role
  );
END;
$$;
REVOKE ALL ON FUNCTION public.remove_business_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_business_member(uuid, uuid) TO authenticated;

-- Role changes also take the per-business mutex before reading the caller's
-- authority and the target's current role. This prevents a concurrent transfer
-- from being demoted by a stale check (and vice versa).
CREATE OR REPLACE FUNCTION public.set_member_business_role(p_user uuid, p_business uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_current text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'member', 'viewer') THEN
    RAISE EXCEPTION 'invalid role: %', p_role USING ERRCODE = '23514';
  END IF;

  PERFORM 1
    FROM public.businesses
   WHERE id = p_business
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND: that account does not exist'
      USING ERRCODE = '22023';
  END IF;
  PERFORM 1
    FROM public.user_business_access
   WHERE business_id = p_business
   ORDER BY user_id
     FOR UPDATE;

  IF NOT public.can_manage_business_access(p_business, v_caller) THEN
    RAISE EXCEPTION 'Only business owners/admins can change member roles' USING ERRCODE = '42501';
  END IF;
  -- Elevation rule (mirrors W1a INSERT/UPDATE WITH CHECK): a uba-'admin' cannot
  -- manufacture an owner/admin — only business-owners or platform admins can.
  IF p_role IN ('owner', 'admin')
     AND NOT public.has_role(v_caller, 'admin'::public.app_role)
     AND public.my_business_role(p_business, v_caller) <> 'owner' THEN
    RAISE EXCEPTION 'Only business owners can grant owner/admin roles' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_current FROM public.user_business_access
   WHERE user_id = p_user AND business_id = p_business
     FOR UPDATE;
  IF v_current IS NULL THEN
    INSERT INTO public.user_business_access (user_id, business_id, role)
    VALUES (p_user, p_business, p_role);
  ELSE
    -- Last-owner protection (mirrors W1a USING guard; FOR UPDATE row lock inside)
    IF v_current = 'owner' AND p_role <> 'owner'
       AND NOT public.has_role(v_caller, 'admin'::public.app_role)
       AND NOT public.business_has_other_owner(p_business, p_user) THEN
      RAISE EXCEPTION 'cannot demote the last owner of this business' USING ERRCODE = '23514';
    END IF;
    UPDATE public.user_business_access SET role = p_role
     WHERE user_id = p_user AND business_id = p_business;
  END IF;

  -- The same explicit invariant as the transfer path.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_business_access
     WHERE business_id = p_business AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'OWNER_INVARIANT: the account must keep at least one owner'
      USING ERRCODE = '23514';
  END IF;

  -- Server-side audit insert (definer bypasses the admin-only SELECT RLS for writes)
  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (v_caller,
          (SELECT email FROM auth.users WHERE id = v_caller),
          'update_role', 'user_business_access', p_user::text,
          jsonb_build_object('business_id', p_business, 'old_role', v_current, 'new_role', p_role));
END $$;
REVOKE ALL ON FUNCTION public.set_member_business_role(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_business_role(uuid, uuid, text) TO authenticated;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.transfer_business_ownership(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.leave_business_account(uuid);
-- Then re-apply 20260911000500_business_member_access_rpcs.sql and
-- 20261019190000_business_member_invitations.sql to restore the previous
-- definitions of set_member_business_role and remove_business_member.
