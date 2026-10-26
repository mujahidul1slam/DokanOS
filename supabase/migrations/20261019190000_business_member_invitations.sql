-- Issue #13: invite and manage business-account members using verified personal
-- identities.
--
-- An invitation is an owner-issued intent that names exactly one account and
-- exactly one intended personal email. It is not a business account, not a
-- platform role and not a brand/store/module grant: accepting it only creates
-- account-wide 'member' operational access for the person who already holds
-- that verified personal email. Personal registration happens elsewhere (#9)
-- and never consumes an invitation.
--
-- The ledger itself is reachable only through the SECURITY DEFINER RPCs below.
-- It has RLS enabled with no client policies and no Data API privileges at all,
-- mirroring public.signup_events, so a client cannot read, mint, edit or delete
-- an invitation (or harvest its bearer token) through a direct request.

CREATE TABLE IF NOT EXISTS public.business_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email       text NOT NULL,
  -- This release invites account-wide operational members only. Owner/admin
  -- elevation and configurable granular grants are deliberately out of scope.
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
  token       text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  invited_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS business_invitations_token_key
  ON public.business_invitations (token);
-- One open invitation per intended identity per account. Consumed/revoked rows
-- stay as history without blocking a later, deliberate re-invitation.
CREATE UNIQUE INDEX IF NOT EXISTS business_invitations_open_email_key
  ON public.business_invitations (business_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_business_invitations_business
  ON public.business_invitations (business_id);

ALTER TABLE public.business_invitations ENABLE ROW LEVEL SECURITY;
-- No client policies: only the SECURITY DEFINER RPCs below may touch this table.
REVOKE ALL ON TABLE public.business_invitations FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Derived invitation state, shared by the RPCs so "usable" means one thing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_invitation_state(
  p_accepted_at timestamptz,
  p_revoked_at  timestamptz,
  p_expires_at  timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_accepted_at IS NOT NULL THEN 'accepted'
    WHEN p_revoked_at IS NOT NULL THEN 'revoked'
    WHEN p_expires_at IS NOT NULL AND p_expires_at <= now() THEN 'expired'
    ELSE 'pending'
  END;
$$;
REVOKE ALL ON FUNCTION public.business_invitation_state(timestamptz, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- invite_business_member — strictly owner-only.
--
-- The account id is a parent, never an authority claim by itself, and there is
-- deliberately no platform-admin bypass: issuing an invitation is an owner act.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_business_member(
  p_business_id uuid,
  p_email       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  VALUES (p_business_id, v_email, 'member', v_user_id)
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
      'role', 'member',
      'expires_at', v_invitation.expires_at
    )
  );

  RETURN jsonb_build_object(
    'id', v_invitation.id,
    'business_id', p_business_id,
    'business_name', v_business.name,
    'email', v_email,
    'role', 'member',
    'token', v_invitation.token,
    'status', 'pending',
    'expires_at', v_invitation.expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.invite_business_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_business_member(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- accept_business_invitation — the intended verified identity joins.
--
-- Order matters: authentication, then a verified personal email, then the
-- token, then the email binding, then an existing membership (which makes the
-- call safely repeatable), then the unusable states. Nothing here grants a
-- platform role, a store grant or a granular permission, and nothing creates a
-- business account for the invitee.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_business_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

  -- Account-wide member operational access only.
  INSERT INTO public.user_business_access (user_id, business_id, role)
  VALUES (v_user_id, v_invitation.business_id, 'member');

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
      'role', 'member'
    )
  );

  RETURN jsonb_build_object(
    'outcome', 'joined',
    'business_id', v_invitation.business_id,
    'business_name', v_business_name,
    'role', 'member'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.accept_business_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_business_invitation(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- describe_business_invitation — the arrival surface for an invite link.
-- Available to any authenticated person (they may not be a member yet) and
-- never reports a mismatch as a match.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.describe_business_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_email      text;
  v_invitation public.business_invitations%ROWTYPE;
  v_status     text;
  v_name       text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = v_user_id;

  SELECT * INTO v_invitation
    FROM public.business_invitations
   WHERE token = btrim(coalesce(p_token, ''));

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'invalid',
      'business_name', NULL,
      'email_matches', false
    );
  END IF;

  v_status := public.business_invitation_state(
    v_invitation.accepted_at, v_invitation.revoked_at, v_invitation.expires_at);
  SELECT b.name INTO v_name FROM public.businesses b WHERE b.id = v_invitation.business_id;

  RETURN jsonb_build_object(
    'status', v_status,
    'business_name', v_name,
    'email_matches', (v_email IS NOT NULL AND v_invitation.email = v_email)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.describe_business_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.describe_business_invitation(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- list_business_invitations — owner-only review of the account's ledger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_business_invitations(p_business_id uuid)
RETURNS TABLE (
  id          uuid,
  email       text,
  role        text,
  status      text,
  token       text,
  invited_by  uuid,
  created_at  timestamptz,
  expires_at  timestamptz,
  accepted_at timestamptz,
  revoked_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  IF public.my_business_role(p_business_id, auth.uid()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'OWNER_REQUIRED: only the account owner can review invitations'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT i.id,
         i.email,
         i.role,
         public.business_invitation_state(i.accepted_at, i.revoked_at, i.expires_at),
         i.token,
         i.invited_by,
         i.created_at,
         i.expires_at,
         i.accepted_at,
         i.revoked_at
    FROM public.business_invitations i
   WHERE i.business_id = p_business_id
   ORDER BY i.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.list_business_invitations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_business_invitations(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- list_business_members — any member of the account may see who operates it.
-- Outsiders (and nonmembers) get nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_business_members(p_business_id uuid)
RETURNS TABLE (
  user_id   uuid,
  email     text,
  full_name text,
  role      text,
  joined_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  IF public.my_business_role(p_business_id, auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REQUIRED: account membership required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.user_id,
         u.email::text,
         p.full_name,
         a.role,
         a.created_at
    FROM public.user_business_access a
    LEFT JOIN auth.users u ON u.id = a.user_id
    LEFT JOIN public.profiles p ON p.user_id = a.user_id
   WHERE a.business_id = p_business_id
   ORDER BY a.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.list_business_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_business_members(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- remove_business_member — owner-only.
--
-- Ownership transfer is a separate, deliberate act (#14): ordinary member
-- removal never removes an owner, including the caller removing themselves.
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

  IF public.my_business_role(p_business_id, v_user_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'OWNER_REQUIRED: only the account owner can remove members'
      USING ERRCODE = '42501';
  END IF;

  SELECT a.role INTO v_role
    FROM public.user_business_access a
   WHERE a.business_id = p_business_id
     AND a.user_id = p_user_id;
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

-- ---------------------------------------------------------------------------
-- revoke_business_invitation — owner-only; withdraws an open invitation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_business_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_invitation public.business_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: authentication required' USING ERRCODE = '42501';
  END IF;

  -- Take the same row lock as acceptance, so revoke and accept cannot both
  -- commit; after waiting, the checks below see the winning state.
  SELECT * INTO v_invitation
    FROM public.business_invitations
   WHERE id = p_invitation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: that invitation does not exist'
      USING ERRCODE = '22023';
  END IF;

  IF public.my_business_role(v_invitation.business_id, v_user_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'OWNER_REQUIRED: only the account owner can revoke invitations'
      USING ERRCODE = '42501';
  END IF;

  IF v_invitation.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'revoked', true,
      'invitation_id', v_invitation.id,
      'business_id', v_invitation.business_id,
      'status', 'revoked'
    );
  END IF;

  IF v_invitation.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_USED: an accepted invitation cannot be revoked'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.business_invitations
     SET revoked_at = now(), revoked_by = v_user_id
   WHERE id = p_invitation_id;

  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    (SELECT email FROM auth.users WHERE id = v_user_id),
    'revoke_business_invitation',
    'business_invitation',
    p_invitation_id::text,
    jsonb_build_object(
      'business_id', v_invitation.business_id,
      'email', v_invitation.email
    )
  );

  RETURN jsonb_build_object(
    'revoked', true,
    'invitation_id', p_invitation_id,
    'business_id', v_invitation.business_id,
    'status', 'revoked'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_business_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_business_invitation(uuid) TO authenticated;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.revoke_business_invitation(uuid);
-- DROP FUNCTION IF EXISTS public.remove_business_member(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.list_business_members(uuid);
-- DROP FUNCTION IF EXISTS public.list_business_invitations(uuid);
-- DROP FUNCTION IF EXISTS public.describe_business_invitation(text);
-- DROP FUNCTION IF EXISTS public.accept_business_invitation(text);
-- DROP FUNCTION IF EXISTS public.invite_business_member(uuid, text);
-- DROP FUNCTION IF EXISTS public.business_invitation_state(timestamptz, timestamptz, timestamptz);
-- DROP TABLE IF EXISTS public.business_invitations;
