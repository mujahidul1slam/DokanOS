-- ============================================================================
-- R1 — Blank-slate provisioning rewrite (audit §4 R1; CONTEXT D-17/D-18)
--
-- Rewrites public.signup_create_business_core so a fresh provision creates
-- ONLY: businesses (1) + user_business_access owner (1) + user_permissions
-- (33 keys). The 9 template row groups (stores, brands, locations,
-- storefronts, selling_points, connectors, product_sources,
-- customer_sources, user_store_access) are NO LONGER created here.
--
-- They are created later, on demand, by the member-callable
-- public.create_my_brand_store RPC (migration 20261006121000) driven by the
-- onboarding wizard.
--
-- Gates byte-identical: provision_owner_business is NOT touched by this file.
-- create_additional_business gains a per-user 24h idempotency guard.
-- verify_signup_fns is extended with the 33-key bundle assertion.
--
-- Rollback: .planning/rollbacks/20261006120000_blank_slate_provisioning.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. signup_create_business_core — blank slate: business + owner + bundle.
--    Same signature, SECURITY DEFINER, search_path, error codes and return
--    shape as 20260925120100:40-216. Reachable only via the two service_role
--    entry RPCs below (REVOKE preserved).
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

  -- Owner membership (never a global user_roles row)
  INSERT INTO public.user_business_access (user_id, business_id, role)
  VALUES (p_user_id, v_business_id, 'owner');

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
-- 2. create_additional_business — SWITCHER entry point (post-signup).
--    Same signature/guards/errors as 20260925120100:336-375 plus the R1
--    per-user 24h idempotency guard inserted after the member check and
--    before the core call. Called by the create-business edge fn via service
--    key only (REVOKE/GRANT below).
-- ---------------------------------------------------------------------------
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

  -- Must already be a provisioned member (≥1 UBA row) OR platform admin/staff.
  -- Sign-up-specific gates (anchor/nonce/provider/24h) intentionally absent.
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access WHERE user_id = p_user_id)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role IN ('admin', 'staff')) THEN
    RAISE EXCEPTION 'PROVISION_NOT_MEMBER: complete your account setup first'
      USING ERRCODE = 'P0001';
  END IF;

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

-- ---------------------------------------------------------------------------
-- 3. Verify migration (extended) — every pre-R1 assertion kept; adds the
--    33-key owner-bundle assertion (32 pre-R1 keys + storefronts.view).
--    Row-count testing against a fixture owner belongs to the acceptance
--    script (scripts/test_signup_rpc.sql, plan 01-02); this fn asserts the
--    bundle source directly so it also passes on a fresh hosted project.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_signup_fns()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- all five fns exist
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='canonical_email')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='signup_create_business_core')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='provision_owner_business')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='create_additional_business')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='get_auth_signup_state') THEN
    RAISE EXCEPTION 'verify_signup_fns: missing function';
  END IF;

  -- provision_owner_business must NOT be executable by anon/authenticated
  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE specific_schema = 'public'
      AND routine_name = 'provision_owner_business'
      AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'verify_signup_fns: provision_owner_business must be service_role-only';
  END IF;

  -- canonical_email sanity
  IF public.canonical_email('A.B+x@GMAIL.com') <> 'ab@gmail.com' THEN
    RAISE EXCEPTION 'verify_signup_fns: canonical_email logic broken';
  END IF;

  -- handle_new_user trigger still wired
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'users' AND c.relnamespace = 'auth'::regnamespace
      AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'verify_signup_fns: on_auth_user_created trigger missing';
  END IF;

  -- R1: owner bundle is exactly 33 keys incl. storefronts.view
  IF position('storefronts.view' IN pg_get_functiondef('public.signup_create_business_core(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'verify_signup_fns: owner bundle missing storefronts.view (33 keys expected)';
  END IF;
  IF (SELECT count(*) FROM regexp_matches(
        pg_get_functiondef('public.signup_create_business_core(uuid,text)'::regprocedure),
        '\(p_user_id, ''', 'g')) <> 33 THEN
    RAISE EXCEPTION 'verify_signup_fns: owner bundle must contain exactly 33 permission keys';
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'fns', 5, 'trigger_patched', true, 'bundle_keys', 33);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_signup_fns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_signup_fns() TO service_role, authenticated;
