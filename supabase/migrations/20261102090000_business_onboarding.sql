-- Task 13 (domain revamp, spec §6a/§6b): the business-creation onboarding
-- checklist and the membership provenance that gates the wizard.
--
-- Two pieces:
--
-- 1. `user_business_access.joined_via` — how a membership came to exist:
--    'created'  = the member created the business (founder-owner or signup
--                 provisioning core); business-creation onboarding runs for
--                 exactly these rows (spec §6a "created from scratch").
--    'invited'  = the member joined through an accepted business invitation;
--                 they never see the wizard (spec §6b — Task 3's personal
--                 profile setup is their surface).
--    'granted'  = an owner/admin added the member directly (role RPC); also
--                 the fail-closed default for any path that does not record
--                 provenance. Not creation, so no wizard offer.
--
--    Every membership INSERT path is explicit: the two creation cores stamp
--    'created', invitation acceptance stamps 'invited', and everything else
--    falls through to the conservative 'granted' default.
--
-- 2. `business_onboarding_steps` — the persistent per-business checklist that
--    makes onboarding skippable at any step and resumable after sign-out/in
--    (spec §6a "skippable, resumable, re-runnable from settings"). One row per
--    business + step; `status` is the mark ('completed' | 'skipped'); a step
--    with no row is still open. step_key is open text (not a CHECK) on
--    purpose: Task 14 appends warehouses/product-import/storefront steps
--    without another constraint migration. The step vocabulary lives in
--    src/features/onboarding/steps.ts.
--
-- RLS is the business-membership idiom (as courier_services): every account
-- member reads the checklist; owner/admin/manager write; staff read-only.

-- ---------------------------------------------------------------------------
-- 1. Membership provenance.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_business_access
  ADD COLUMN IF NOT EXISTS joined_via text NOT NULL DEFAULT 'granted';

ALTER TABLE public.user_business_access
  DROP CONSTRAINT IF EXISTS user_business_access_joined_via_check;
ALTER TABLE public.user_business_access
  ADD CONSTRAINT user_business_access_joined_via_check
  CHECK (joined_via IN ('created', 'invited', 'granted'));

-- ---------------------------------------------------------------------------
-- 2. create_business_with_owner — the founder-owner row records 'created'.
--    Body otherwise verbatim from 20260911000130 (signature unchanged).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_name text,
  p_slug text,
  p_logo_url text DEFAULT NULL,
  p_currency text DEFAULT 'BDT',
  p_timezone text DEFAULT 'Asia/Dhaka'
)
RETURNS public.businesses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text := btrim(p_name);   -- NIT-8b: normalize once; all checks + INSERT use v_name
  v_business public.businesses;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_role(v_user, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'business name is required' USING ERRCODE = '23502';
  END IF;
  -- NIT-8a: match W5's client-side cap — the RPC is the authoritative path.
  IF length(v_name) > 100 THEN
    RAISE EXCEPTION 'business name must be 100 characters or fewer' USING ERRCODE = '23514';
  END IF;
  -- F18: server-side validation — the RPC is callable by any authenticated
  -- client directly; never trust the frontend slugifier.
  IF p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(p_slug) < 2 OR length(p_slug) > 60 THEN
    RAISE EXCEPTION 'slug must be 2-60 chars: lowercase letters, digits, single dashes'
      USING ERRCODE = '23514';
  END IF;
  IF p_currency NOT IN ('BDT','USD','EUR','GBP','INR','MYR','SAR','AED') THEN
    RAISE EXCEPTION 'unsupported currency: %', p_currency USING ERRCODE = '23514';
  END IF;
  -- Full allow-list = BusinessAccountTab.TIMEZONES (:22-31), verbatim — the
  -- first future caller passing a UI-listed zone cannot be surprised.
  IF p_timezone NOT IN (
    'Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai',
    'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'
  ) THEN
    RAISE EXCEPTION 'unsupported timezone: %', p_timezone USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.businesses (name, slug, logo_url, currency, timezone)
  VALUES (v_name, p_slug, p_logo_url, p_currency, p_timezone)
  RETURNING * INTO v_business;

  -- Task 13: the founder's membership records how it came to exist.
  INSERT INTO public.user_business_access (user_id, business_id, role, joined_via)
  VALUES (v_user, v_business.id, 'owner', 'created');

  RETURN v_business;
END $$;
REVOKE ALL ON FUNCTION public.create_business_with_owner(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. signup_create_business_core — the blank-slate provisioning core stamps
--    the owner membership 'created' (create_additional_business and
--    provision_owner_business both delegate here). Body otherwise verbatim
--    from 20261006120000. verify_signup_fns() pins this body's permission
--    bundle (exactly 33 `(p_user_id, '` literals + storefronts.view) — the
--    membership line below is a `(p_user_id, v_business_id, …)` literal and
--    keeps both assertions at 33/true.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signup_create_business_core(
  p_user_id       uuid,
  p_business_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name        text;
  v_slug_base   text;
  v_slug        text;
  v_attempt     int := 0;
  v_business_id uuid;
BEGIN
  -- Serialize all provisioning for this user (concurrent double-invoke safe)
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Normalize the business name once (never trust client/anchor text)
  v_name := btrim(coalesce(p_business_name, ''));
  IF v_name = '' OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'PROVISION_INVALID_NAME: business name must be 1-100 characters'
      USING ERRCODE = 'P0001';
  END IF;

  -- Slug candidate: same rules as src/lib/slug.ts (lower, hyphenated);
  -- fallback store-<4 random> when the name strips to nothing (Bengali/emoji).
  v_slug_base := lower(regexp_replace(trim(v_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := btrim(v_slug_base, '-');
  IF length(v_slug_base) < 2 THEN
    v_slug_base := 'store-' || substr(md5(random()::text), 1, 4);
  END IF;
  v_slug_base := left(v_slug_base, 60);

  -- Slug-collision retry on businesses.slug only. R1: this function writes
  -- no other table, so the three-column retry (businesses/brands/storefronts)
  -- now lives in create_my_brand_store (20261006121000).
  LOOP
    v_attempt := v_attempt + 1;
    v_slug := CASE WHEN v_attempt = 1 THEN v_slug_base
                   ELSE left(v_slug_base, 55) || '-' || v_attempt::text END;

    BEGIN
      INSERT INTO public.businesses (name, slug)
      VALUES (v_name, v_slug)
      RETURNING id INTO v_business_id;

      EXIT; -- success
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RAISE EXCEPTION 'PROVISION_RETRYABLE: slug collision after 5 attempts'
          USING ERRCODE = 'P0001';
      END IF;
      -- nested block rolls back to its savepoint; retry with next candidate
    END;
  END LOOP;

  -- Owner membership (never a global user_roles row). Task 13: a provisioning
  -- core creates the business from scratch, so the row records 'created'.
  INSERT INTO public.user_business_access (user_id, business_id, role, joined_via)
  VALUES (p_user_id, v_business_id, 'owner', 'created');

  -- Permission bundle (global-scope per user; idempotent re-grant).
  -- 33 keys per SIGNUP-DISCOVERY.md §2 + R1 (32 + storefronts.view) —
  -- excludes settings.manage, integrations.manage, stores.manage, team.manage.
  INSERT INTO public.user_permissions (user_id, permission)
  VALUES
    (p_user_id, 'dashboard.view'),
    (p_user_id, 'orders.view'),
    (p_user_id, 'orders.create'),
    (p_user_id, 'orders.edit'),
    (p_user_id, 'orders.delete'),
    (p_user_id, 'orders.change_status'),
    (p_user_id, 'orders.dispatch'),
    (p_user_id, 'orders.refund'),
    (p_user_id, 'orders.log_payment'),
    (p_user_id, 'orders.discount_large'),
    (p_user_id, 'preorders.view'),
    (p_user_id, 'preorders.manage'),
    (p_user_id, 'customers.view'),
    (p_user_id, 'customers.edit'),
    (p_user_id, 'customers.delete'),
    (p_user_id, 'products.view'),
    (p_user_id, 'products.create'),
    (p_user_id, 'products.edit'),
    (p_user_id, 'products.delete'),
    (p_user_id, 'products.view_cost'),
    (p_user_id, 'products.edit_cost'),
    (p_user_id, 'pos.use'),
    (p_user_id, 'pos.discount_large'),
    (p_user_id, 'pos.refund'),
    (p_user_id, 'pos.shift_close'),
    (p_user_id, 'analytics.view'),
    (p_user_id, 'analytics.view_revenue'),
    (p_user_id, 'integrations.view'),
    (p_user_id, 'stores.view'),
    (p_user_id, 'settings.view'),
    (p_user_id, 'team.view'),
    (p_user_id, 'audit.view'),
    (p_user_id, 'storefronts.view')
  ON CONFLICT (user_id, permission) DO NOTHING;

  -- Post-insert assertion (owner membership only — no store/access rows exist
  -- under the blank-slate contract; store access is created by R4a)
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                 WHERE user_id = p_user_id AND business_id = v_business_id) THEN
    RAISE EXCEPTION 'PROVISION_RETRYABLE: owner membership assertion failed'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('slug', v_slug, 'business_id', v_business_id);
END;
$$;

REVOKE ALL ON FUNCTION public.signup_create_business_core(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. accept_business_invitation — invitation acceptance stamps 'invited', so
--    the wizard offer (joined_via = 'created') can never reach an invited
--    member (spec §6b). Body otherwise verbatim from 20261101090000.
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

  -- Account-wide access at the role the invitation carries (spec §5).
  -- Task 13: an accepted invitation makes the member 'invited', never a
  -- creator — the business onboarding wizard stays closed to them (spec §6b).
  INSERT INTO public.user_business_access (user_id, business_id, role, joined_via)
  VALUES (v_user_id, v_invitation.business_id, v_invitation.role, 'invited');

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

REVOKE ALL ON FUNCTION public.accept_business_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_business_invitation(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Legacy provenance backfill (one-time, pre-existing rows only).
--    (a) Memberships that consumed an invitation are 'invited' — recorded
--        intent beats the default even for old rows.
--    (b) Remaining owner rows predate the invitation feature (business
--        creation backfills and co-founders) and are founder-equivalent.
--    Everything else keeps the conservative 'granted' default. Future rows
--    get explicit provenance from the functions above.
-- ---------------------------------------------------------------------------
UPDATE public.user_business_access a
SET joined_via = 'invited'
WHERE EXISTS (
  SELECT 1 FROM public.business_invitations i
  WHERE i.business_id = a.business_id
    AND i.accepted_by = a.user_id
    AND i.accepted_at IS NOT NULL
);

UPDATE public.user_business_access a
SET joined_via = 'created'
WHERE a.joined_via = 'granted'
  AND a.role = 'owner';

-- ---------------------------------------------------------------------------
-- 6. business_onboarding_steps — the persistent per-business checklist
--    (spec §6a: skippable at any step, resumable, re-runnable from settings).
-- ---------------------------------------------------------------------------
CREATE TABLE public.business_onboarding_steps (
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  -- Open text on purpose: Task 14 appends warehouses/product-import/storefront
  -- steps; the vocabulary lives in src/features/onboarding/steps.ts and rows
  -- with unknown keys are ignored by the client.
  step_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, step_key)
);

CREATE TRIGGER set_business_onboarding_steps_updated_at
  BEFORE UPDATE ON public.business_onboarding_steps
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

ALTER TABLE public.business_onboarding_steps ENABLE ROW LEVEL SECURITY;

-- New local/cloud projects do not grant Data API table privileges implicitly
-- (20261026140000): without this floor the policies are unreachable below the
-- Data API. service_role bypasses RLS but not table privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_onboarding_steps TO authenticated, service_role;

-- Business-membership idiom (as courier_services): any account member reads
-- the checklist; owner/admin/manager write; staff read-only; other businesses
-- see nothing.
CREATE POLICY "Account members can read business onboarding steps"
  ON public.business_onboarding_steps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.business_id = business_onboarding_steps.business_id
        AND membership.user_id = auth.uid()
    )
  );

CREATE POLICY "Account operators can write business onboarding steps"
  ON public.business_onboarding_steps FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.business_id = business_onboarding_steps.business_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.business_id = business_onboarding_steps.business_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'manager')
    )
  );
