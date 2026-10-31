-- Task 12 (domain revamp, spec Â§5): the membership role ladder is renamed
-- owner/admin/member/viewer â†’ Owner/Admin/Manager/Staff. The stored values
-- become owner/admin/manager/staff (the UI shows the capitalized labels);
-- existing rows are remapped here, and every policy/function comparing role
-- literals follows the rename.
--
-- Semantics are preserved exactly: owners and admins keep their authority,
-- "member" becomes "manager" (write-capable operator), "viewer" becomes
-- "staff" (read-only). The GLOBAL app_role enum (user_roles: admin/staff/
-- viewer) is a separate permission model and is deliberately untouched.
--
-- This also makes invitations role-carrying (spec Â§5: "the inviter picks the
-- role on the invite"): invite_business_member gains p_role and
-- accept_business_invitation grants the invited role instead of a hard-coded
-- 'member'.

-- ---------------------------------------------------------------------------
-- 1. Drop the old constraint gates so rows can move through the rename.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_business_access
  DROP CONSTRAINT user_business_access_role_check;

ALTER TABLE public.business_invitations
  DROP CONSTRAINT business_invitations_role_check;

-- ---------------------------------------------------------------------------
-- 2. Remap existing rows (the enum rename migration's data step), and point
--    the column defaults at the new ladder.
-- ---------------------------------------------------------------------------
UPDATE public.user_business_access SET role = 'manager' WHERE role = 'member';
UPDATE public.user_business_access SET role = 'staff'   WHERE role = 'viewer';
UPDATE public.business_invitations SET role = 'manager' WHERE role = 'member';
UPDATE public.business_invitations SET role = 'staff'   WHERE role = 'viewer';

ALTER TABLE public.user_business_access ALTER COLUMN role SET DEFAULT 'manager';
ALTER TABLE public.business_invitations ALTER COLUMN role SET DEFAULT 'manager';

-- ---------------------------------------------------------------------------
-- 3. Re-add the constraint gates with the new ladder values.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_business_access
  ADD CONSTRAINT user_business_access_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'staff'));

ALTER TABLE public.business_invitations
  ADD CONSTRAINT business_invitations_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'staff'));

-- ---------------------------------------------------------------------------
-- 4. accept_business_invitation: grant the INVITED role, not a literal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_business_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id       uuid := auth.uid();
  v_email         text;
  v_verified_at   timestamptz;
  v_token         text;
  v_invitation    public.business_invitations%ROWTYPE;
  v_business_name text;
  v_existing_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(u.email)), u.email_confirmed_at
    INTO v_email, v_verified_at
    FROM auth.users u
   WHERE u.id = v_user_id;

  -- The binding is on a verified personal email, not on a typed address, and
  -- not on untrusted signup metadata.
  IF v_email IS NULL OR v_verified_at IS NULL THEN
    RAISE EXCEPTION 'VERIFICATION_REQUIRED: confirm your email address before accepting an invitation'
      USING ERRCODE = '42501';
  END IF;

  v_token := btrim(coalesce(p_token, ''));
  IF v_token = '' THEN
    RAISE EXCEPTION 'INVITATION_INVALID: this invitation is not valid'
      USING ERRCODE = '23514';
  END IF;

  -- Serialize acceptance against a concurrent accept or revoke of the same
  -- invitation. The state checks below are re-read after the lock is acquired,
  -- so two callers cannot both consume it and a revoke cannot race an accept.
  SELECT * INTO v_invitation
    FROM public.business_invitations
   WHERE token = v_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_INVALID: this invitation is not valid'
      USING ERRCODE = '23514';
  END IF;

  IF v_invitation.email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH: this invitation was issued for a different email address'
      USING ERRCODE = '42501';
  END IF;

  -- Safely repeatable: an existing membership wins over every later state, so
  -- a person who already joined is never told their invitation is unusable.
  SELECT a.role INTO v_existing_role
    FROM public.user_business_access a
   WHERE a.business_id = v_invitation.business_id
     AND a.user_id = v_user_id;
  IF v_existing_role IS NOT NULL THEN
    SELECT b.name INTO v_business_name
      FROM public.businesses b WHERE b.id = v_invitation.business_id;
    RETURN jsonb_build_object(
      'outcome', 'already_member',
      'business_id', v_invitation.business_id,
      'business_name', v_business_name,
      'role', v_existing_role
    );
  END IF;

  IF v_invitation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_REVOKED: this invitation was revoked'
      USING ERRCODE = '23514';
  END IF;
  IF v_invitation.expires_at IS NOT NULL AND v_invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: this invitation has expired'
      USING ERRCODE = '23514';
  END IF;
  IF v_invitation.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_USED: this invitation was already accepted'
      USING ERRCODE = '23514';
  END IF;

  -- Account-wide access at the role the invitation carries (spec Â§5).
  INSERT INTO public.user_business_access (user_id, business_id, role)
  VALUES (v_user_id, v_invitation.business_id, v_invitation.role);

  UPDATE public.business_invitations
     SET accepted_at = now(), accepted_by = v_user_id
   WHERE id = v_invitation.id;

  SELECT b.name INTO v_business_name
    FROM public.businesses b WHERE b.id = v_invitation.business_id;

  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    v_email,
    'accept_business_invitation',
    'business_invitation',
    v_invitation.id::text,
    jsonb_build_object(
      'business_id', v_invitation.business_id,
      'role', v_invitation.role
    )
  );

  RETURN jsonb_build_object(
    'outcome', 'joined',
    'business_id', v_invitation.business_id,
    'business_name', v_business_name,
    'role', v_invitation.role
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. invite_business_member: carry the invited role (new p_role argument).
--    The signature change requires DROP + CREATE; restore the old ACL.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.invite_business_member(uuid, text);

CREATE FUNCTION public.invite_business_member(p_business_id uuid, p_email text, p_role text DEFAULT 'manager')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id    uuid := auth.uid();
  v_email      text;
  v_business   public.businesses%ROWTYPE;
  v_invitation public.business_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  IF public.my_business_role(p_business_id, v_user_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'OWNER_REQUIRED: only the account owner can invite members'
      USING ERRCODE = '42501';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('owner', 'admin', 'manager', 'staff') THEN
    RAISE EXCEPTION 'INVITATION_ROLE_INVALID: role must be owner, admin, manager or staff'
      USING ERRCODE = '22023';
  END IF;

  -- The intended identity is a normalized email; the invitation binds to it.
  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'EMAIL_REQUIRED: an invitation needs the intended email address'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_email) > 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'EMAIL_INVALID: % is not a usable email address', p_email
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_business FROM public.businesses WHERE id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND: that account does not exist'
      USING ERRCODE = '22023';
  END IF;

  -- Someone who already operates this account does not need an invitation.
  IF EXISTS (
    SELECT 1
    FROM public.user_business_access a
    JOIN auth.users u ON u.id = a.user_id
    WHERE a.business_id = p_business_id
      AND lower(btrim(u.email)) = v_email
  ) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER: % already operates this account', v_email
      USING ERRCODE = '23505';
  END IF;

  -- An already-expired invitation can never become usable again. Retire it as
  -- part of the deliberate re-invitation so stale intent does not block the
  -- owner forever (the unique open-invitation index counts un-revoked rows).
  UPDATE public.business_invitations
     SET revoked_at = now(), revoked_by = v_user_id
   WHERE business_id = p_business_id
     AND email = v_email
     AND accepted_at IS NULL
     AND revoked_at IS NULL
     AND expires_at <= now();

  IF EXISTS (
    SELECT 1 FROM public.business_invitations
    WHERE business_id = p_business_id
      AND email = v_email
      AND accepted_at IS NULL
      AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'INVITATION_EXISTS: an open invitation already exists for %', v_email
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.business_invitations (business_id, email, role, invited_by)
  VALUES (p_business_id, v_email, p_role, v_user_id)
  RETURNING * INTO v_invitation;

  -- #8 audit trail: who invited which identity to which account.
  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    (SELECT email FROM auth.users WHERE id = v_user_id),
    'invite_business_member',
    'business_invitation',
    v_invitation.id::text,
    jsonb_build_object(
      'business_id', p_business_id,
      'email', v_email,
      'role', p_role,
      'expires_at', v_invitation.expires_at
    )
  );

  RETURN jsonb_build_object(
    'id', v_invitation.id,
    'business_id', p_business_id,
    'business_name', v_business.name,
    'email', v_email,
    'role', p_role,
    'token', v_invitation.token,
    'status', 'pending',
    'expires_at', v_invitation.expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.invite_business_member(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_business_member(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. set_member_business_role: validate the new ladder values.
--    (app_role checks inside â€” has_role(v_caller, 'admin'::app_role) â€” stay.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_member_business_role(p_user uuid, p_business uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_current text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'manager', 'staff') THEN
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
  -- manufacture an owner/admin â€” only business-owners or platform admins can.
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
END $function$;

-- ---------------------------------------------------------------------------
-- 7. transfer_business_ownership: the former owner becomes a manager.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_business_ownership(p_business_id uuid, p_new_owner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     SET role = 'manager'
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
    'previous_owner_role', 'manager',
    'new_owner_id', p_new_owner_id,
    'new_owner_previous_role', v_target_role,
    'owner_count', v_owner_count
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Role-guard renames in the remaining functions. The literal inventory in
--    these three is exactly ('owner','admin','member') guards; the global
--    app_role vocabulary in has_permission() is deliberately not touched.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn record;
  def text;
  renamed text;
BEGIN
  FOR fn IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN ('brand_store_legacy_links_valid', 'create_brand_store', 'create_business_brand')
  LOOP
    def := pg_get_functiondef(fn.oid);
    renamed := replace(def, '(''owner'', ''admin'', ''member'')', '(''owner'', ''admin'', ''manager'')');
    IF renamed IS NOT DISTINCT FROM def THEN
      RAISE EXCEPTION 'role ladder rename: expected role guard literal not found in function %', fn.oid::regprocedure;
    END IF;
    EXECUTE renamed;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Policy literal renames (8 policies; expressions otherwise verbatim).
-- ---------------------------------------------------------------------------
ALTER POLICY "Account members can read brands" ON public.brands
  USING (public.my_business_role(business_id, auth.uid()) = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'staff'::text]));

ALTER POLICY "Account operators can write brands" ON public.brands
  USING (public.my_business_role(business_id, auth.uid()) = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.my_business_role(business_id, auth.uid()) = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

ALTER POLICY "Account operators can write brand stores" ON public.brand_stores
  USING (EXISTS ( SELECT 1
    FROM (public.brands brand
      JOIN public.user_business_access membership ON ((membership.business_id = brand.business_id)))
   WHERE ((brand.id = brand_stores.brand_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK ((EXISTS ( SELECT 1
    FROM (public.brands brand
      JOIN public.user_business_access membership ON ((membership.business_id = brand.business_id)))
   WHERE ((brand.id = brand_stores.brand_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text]))))) AND (is_published = false) AND public.brand_store_legacy_links_valid(brand_id, legacy_location_id, legacy_selling_point_id, legacy_woo_store_id));

ALTER POLICY "Account operators can write courier services" ON public.courier_services
  USING (EXISTS ( SELECT 1
    FROM public.user_business_access membership
   WHERE ((membership.business_id = courier_services.business_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK (EXISTS ( SELECT 1
    FROM public.user_business_access membership
   WHERE ((membership.business_id = courier_services.business_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

ALTER POLICY "Account operators can write order sources" ON public.order_sources
  USING (EXISTS ( SELECT 1
    FROM (public.brands brand
      JOIN public.user_business_access membership ON ((membership.business_id = brand.business_id)))
   WHERE ((brand.id = order_sources.brand_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK (EXISTS ( SELECT 1
    FROM (public.brands brand
      JOIN public.user_business_access membership ON ((membership.business_id = brand.business_id)))
   WHERE ((brand.id = order_sources.brand_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

ALTER POLICY "Account operators can write payment accounts" ON public.payment_accounts
  USING (EXISTS ( SELECT 1
    FROM public.user_business_access membership
   WHERE ((membership.business_id = payment_accounts.business_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK (EXISTS ( SELECT 1
    FROM public.user_business_access membership
   WHERE ((membership.business_id = payment_accounts.business_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

ALTER POLICY "Account operators can write stock transfers" ON public.stock_transfers
  USING (EXISTS ( SELECT 1
    FROM (public.brands brand
      JOIN public.user_business_access membership ON ((membership.business_id = brand.business_id)))
   WHERE ((brand.id = stock_transfers.brand_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK (EXISTS ( SELECT 1
    FROM (public.brands brand
      JOIN public.user_business_access membership ON ((membership.business_id = brand.business_id)))
   WHERE ((brand.id = stock_transfers.brand_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

ALTER POLICY "Account operators can write warehouses" ON public.warehouses
  USING (EXISTS ( SELECT 1
    FROM (public.brands brand
      JOIN public.user_business_access membership ON ((membership.business_id = brand.business_id)))
   WHERE ((brand.id = warehouses.brand_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK (EXISTS ( SELECT 1
    FROM (public.brands brand
      JOIN public.user_business_access membership ON ((membership.business_id = brand.business_id)))
   WHERE ((brand.id = warehouses.brand_id) AND (membership.user_id = auth.uid()) AND (membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));
