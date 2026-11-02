-- ============================================================================
-- Allow zero-membership confirmed accounts to create their FIRST business via
-- create_additional_business (the CreateBusinessDialog surface, CONTEXT D-04).
--
-- Why: the member-guard ("PROVISION_NOT_MEMBER: complete your account setup
-- first") rejected exactly the users the D-04 zero-membership surface is for.
-- First businesses previously required the anchor-gated signup-provision path,
-- whose 24h account-age gate (PROVISION_EXPIRED) leaves older confirmed
-- accounts with no self-serve recovery at all. The audit's D-04 decision makes
-- the create-business surface the zero-membership destination, so this
-- function must serve them.
--
-- Guard removed entirely (not just relaxed): the admin/staff special-case in
-- the old guard contradicted D-03 (admin/staff treated identically). The
-- abuse surface stays bounded by the create-business edge fn: authenticated
-- session + Turnstile captcha + signup_open kill switch + 3/day/user and
-- 10/day/IP rate limits. The core this calls is the R1 blank-slate core
-- (business + owner UBA + 33-key permission bundle, zero template rows).
--
-- All other behavior byte-identical to 20261006120000:145-219 (gates,
-- R1 24h idempotency, core call, audit event, REVOKE/GRANT).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_additional_business(
  p_user_id       uuid,
  p_business_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user      record;
  v_existing  record;
  v_name      text;
  v_slug_base text;
  v_result    jsonb;
BEGIN
  SELECT * INTO v_user FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVISION_NO_USER: no such user' USING ERRCODE = 'P0001';
  END IF;
  IF v_user.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'PROVISION_UNCONFIRMED: email not confirmed' USING ERRCODE = 'P0001';
  END IF;

  -- NOTE: the former PROVISION_NOT_MEMBER member-guard is deliberately gone.
  -- Zero-membership confirmed accounts create their FIRST business here
  -- (D-04 create-business surface); the admin/staff special-case is gone too
  -- (D-03 — identical treatment). Edge-fn bounds: captcha + kill switch +
  -- 3/day/user + 10/day/IP rate limits.

  -- R1 idempotency guard: the same canonical name re-invoked by the SAME user
  -- within 24h returns that user's existing business (slug-base exact or with
  -- a numeric collision suffix). Keyed on (p_user_id, own businesses) —
  -- NEVER global: another user reusing this name gets a fresh suffixed slug,
  -- never this business. Different names always create new.
  v_name := btrim(coalesce(p_business_name, ''));
  v_slug_base := lower(regexp_replace(trim(v_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := btrim(v_slug_base, '-');
  IF length(v_slug_base) < 2 THEN
    v_slug_base := 'store-' || substr(md5(random()::text), 1, 4);
  END IF;
  v_slug_base := left(v_slug_base, 60);

  SELECT b.slug, b.id INTO v_existing
  FROM public.user_business_access a
  JOIN public.businesses b ON b.id = a.business_id
  WHERE a.user_id = p_user_id
    AND (b.slug = v_slug_base OR b.slug LIKE v_slug_base || '-%')
    AND b.created_at > now() - interval '24 hours'
  ORDER BY b.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    -- Idempotent return: create nothing, write no second 'business_added'
    -- audit event.
    RETURN jsonb_build_object('slug', v_existing.slug, 'business_id', v_existing.id);
  END IF;

  v_result := public.signup_create_business_core(p_user_id, p_business_name);

  INSERT INTO public.signup_events (event, user_id)
  VALUES ('business_added', p_user_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_additional_business(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_additional_business(uuid, text) TO service_role;
