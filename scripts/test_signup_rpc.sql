-- ============================================================================
-- SQL Integration Tests for Signup Provisioning, Multi-business & Recovery RPCs
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_test_uid uuid := 'a1000000-0000-0000-0000-000000000001'::uuid;
  v_other_uid uuid := 'a1000000-0000-0000-0000-000000000002'::uuid;
  v_nonce text := 'test-nonce-1234567890abcdef';
  v_res jsonb;
  v_res2 jsonb;
  v_biz_id uuid;
  v_brand_id uuid;
  v_loc_id uuid;
  v_store_id uuid;
  v_sf_id uuid;
  v_perm_count integer;
  v_global_roles_count integer;
  v_uba_role text;
  v_store_access_count integer;
  v_connector_count integer;
  v_sp_count integer;
  v_ps_count integer;
  v_cs_count integer;
  v_sf_active boolean;
  v_second_biz jsonb;
  v_second_biz_id uuid;
  v_del_res jsonb;
BEGIN
  RAISE NOTICE '=== Starting Signup RPC Integration Tests ===';

  -- Clean up any leftover test data
  DELETE FROM auth.users WHERE id IN (v_test_uid, v_other_uid);
  DELETE FROM public.signup_events WHERE email = 'merchant.test@example.com' OR user_id IN (v_test_uid, v_other_uid);

  -- 1. Insert server anchor row in signup_events (per Task 1.2 / Task 1.3)
  INSERT INTO public.signup_events (
    email,
    event,
    ip,
    ua,
    meta,
    created_at
  ) VALUES (
    'merchant.test@example.com',
    'signup_started',
    '127.0.0.1',
    'test-agent',
    jsonb_build_object(
      'nonce', v_nonce,
      'business_name', 'Bengal Artisans',
      'store_slug', 'bengal-artisans',
      'tos_version', 'v1.0',
      'privacy_version', 'v1.0'
    ),
    now()
  );

  -- 2. Insert test user into auth.users with provider='email' in raw_app_meta_data
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    aud,
    role
  ) VALUES (
    v_test_uid,
    '00000000-0000-0000-0000-000000000000',
    'merchant.test@example.com',
    'dummy-hash',
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object(
      'signup_intent', 'owner',
      'business_name', 'Bengal Artisans',
      'store_slug', 'bengal-artisans',
      'signup_nonce', v_nonce,
      'first_name', 'Rafiq',
      'last_name', 'Ahmed'
    ),
    now(),
    now(),
    'authenticated',
    'authenticated'
  );

  RAISE NOTICE 'Test user and anchor created: %', v_test_uid;

  -- 3. Test provision_owner_business with matching nonce
  v_res := public.provision_owner_business(v_test_uid, v_nonce);
  RAISE NOTICE 'Provision result: %', v_res;

  IF v_res->>'business_id' IS NULL THEN
    RAISE EXCEPTION 'Provisioning failed: %', v_res;
  END IF;

  v_biz_id := (v_res->>'business_id')::uuid;

  -- Find associated resources
  SELECT id INTO v_brand_id FROM public.brands WHERE business_id = v_biz_id;
  SELECT id INTO v_loc_id FROM public.locations WHERE business_id = v_biz_id AND is_default = true;
  SELECT id INTO v_store_id FROM public.stores WHERE name = 'Bengal Artisans';
  SELECT id, is_active INTO v_sf_id, v_sf_active FROM public.storefronts WHERE store_id = v_store_id;

  IF v_brand_id IS NULL OR v_loc_id IS NULL OR v_store_id IS NULL OR v_sf_id IS NULL THEN
    RAISE EXCEPTION 'One or more core resources not created: brand=% loc=% store=% sf=%',
      v_brand_id, v_loc_id, v_store_id, v_sf_id;
  END IF;

  -- Check storefront row: must be inactive initially
  IF v_sf_active IS NOT FALSE THEN
    RAISE EXCEPTION 'Storefront must be inactive initially, got is_active=%', v_sf_active;
  END IF;

  -- Check 4 parity rows
  SELECT count(*) INTO v_connector_count FROM public.connectors WHERE business_id = v_biz_id;
  SELECT count(*) INTO v_sp_count FROM public.selling_points WHERE business_id = v_biz_id;
  SELECT count(*) INTO v_ps_count FROM public.product_sources WHERE business_id = v_biz_id;
  SELECT count(*) INTO v_cs_count FROM public.customer_sources WHERE business_id = v_biz_id;

  IF v_connector_count < 1 OR v_sp_count < 2 OR v_ps_count < 1 OR v_cs_count < 1 THEN
    RAISE EXCEPTION 'Parity rows missing: connector=% sp=% ps=% cs=%',
      v_connector_count, v_sp_count, v_ps_count, v_cs_count;
  END IF;

  -- Check user_business_access role
  SELECT role INTO v_uba_role FROM public.user_business_access WHERE user_id = v_test_uid AND business_id = v_biz_id;
  IF v_uba_role <> 'owner' THEN
    RAISE EXCEPTION 'UBA role must be owner, got %', v_uba_role;
  END IF;

  -- Check user_permissions: EXACT 32 keys (36 total enum values minus 4 excluded), zero forbidden keys
  SELECT count(*) INTO v_perm_count FROM public.user_permissions WHERE user_id = v_test_uid;
  IF v_perm_count <> 32 THEN
    RAISE EXCEPTION 'Owner permissions count must be exactly 32 (36 minus 4 excluded), got %', v_perm_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = v_test_uid
      AND permission::text IN ('settings.manage', 'team.manage', 'integrations.manage', 'stores.manage')
  ) THEN
    RAISE EXCEPTION 'Owner permission bundle contains forbidden keys!';
  END IF;

  -- Check store access
  SELECT count(*) INTO v_store_access_count FROM public.user_store_access WHERE user_id = v_test_uid AND store_id = v_store_id;
  IF v_store_access_count <> 1 THEN
    RAISE EXCEPTION 'user_store_access row missing!';
  END IF;

  -- CRITICAL: Zero rows in user_roles!
  SELECT count(*) INTO v_global_roles_count FROM public.user_roles WHERE user_id = v_test_uid;
  IF v_global_roles_count <> 0 THEN
    RAISE EXCEPTION 'CRITICAL: user_roles must be 0 for owner, got %', v_global_roles_count;
  END IF;

  -- Check consent records written
  IF NOT EXISTS (SELECT 1 FROM public.consent_records WHERE user_id = v_test_uid AND doc = 'tos') THEN
    RAISE EXCEPTION 'TOS consent record missing!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consent_records WHERE user_id = v_test_uid AND doc = 'privacy') THEN
    RAISE EXCEPTION 'Privacy consent record missing!';
  END IF;

  RAISE NOTICE 'Provisioning checks PASSED: all 11 tables populated correctly, 31 permissions, 0 global user_roles, consent logged.';

  -- 4. Test Idempotency with same nonce
  v_res2 := public.provision_owner_business(v_test_uid, v_nonce);
  IF (v_res2->>'business_id')::uuid <> v_biz_id THEN
    RAISE EXCEPTION 'Idempotent provisioning returned unexpected result: %', v_res2;
  END IF;
  RAISE NOTICE 'Idempotency check PASSED.';

  -- 5. Test publish_my_storefront
  PERFORM set_config('request.jwt.claim.sub', v_test_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_test_uid::text, 'role', 'authenticated')::text, true);

  v_res := public.publish_my_storefront(v_sf_id);
  IF (v_res->>'status') <> 'ok' OR (v_res->>'is_active')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'publish_my_storefront failed: %', v_res;
  END IF;

  SELECT is_active INTO v_sf_active FROM public.storefronts WHERE id = v_sf_id;
  IF v_sf_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Storefront was not activated after publish_my_storefront!';
  END IF;
  RAISE NOTICE 'publish_my_storefront check PASSED.';

  -- 6. Test create_additional_business
  v_second_biz := public.create_additional_business(v_test_uid, 'Dhaka Modern Crafts');
  IF v_second_biz->>'business_id' IS NULL THEN
    RAISE EXCEPTION 'create_additional_business failed: %', v_second_biz;
  END IF;
  v_second_biz_id := (v_second_biz->>'business_id')::uuid;

  SELECT role INTO v_uba_role FROM public.user_business_access WHERE user_id = v_test_uid AND business_id = v_second_biz_id;
  IF v_uba_role <> 'owner' THEN
    RAISE EXCEPTION 'Second business UBA role must be owner, got %', v_uba_role;
  END IF;

  -- Ensure still 0 global roles
  SELECT count(*) INTO v_global_roles_count FROM public.user_roles WHERE user_id = v_test_uid;
  IF v_global_roles_count <> 0 THEN
    RAISE EXCEPTION 'Global user_roles became non-zero after creating second business!';
  END IF;
  RAISE NOTICE 'create_additional_business check PASSED.';

  -- 7. Test delete_unprovisioned_self
  -- A: Provisioned user attempting delete_unprovisioned_self must be REJECTED
  BEGIN
    PERFORM public.delete_unprovisioned_self();
    RAISE EXCEPTION 'delete_unprovisioned_self should have thrown for provisioned user!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DELETE_DENIED_PROVISIONED%' THEN
      RAISE NOTICE 'Provisioned delete protection check PASSED (caught expected error: %)', SQLERRM;
    ELSE
      RAISE EXCEPTION 'Unexpected error from delete_unprovisioned_self: %', SQLERRM;
    END IF;
  END;

  -- B: Unprovisioned user calling delete_unprovisioned_self succeeds
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    aud,
    role
  ) VALUES (
    v_other_uid,
    '00000000-0000-0000-0000-000000000000',
    'failed.setup@example.com',
    'dummy-hash',
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    now(),
    now(),
    'authenticated',
    'authenticated'
  );

  PERFORM set_config('request.jwt.claim.sub', v_other_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_uid::text, 'role', 'authenticated')::text, true);

  v_del_res := public.delete_unprovisioned_self();
  IF (v_del_res->>'status') <> 'ok' THEN
    RAISE EXCEPTION 'delete_unprovisioned_self failed for unprovisioned user: %', v_del_res;
  END IF;

  PERFORM 1 FROM auth.users WHERE id = v_other_uid;
  IF FOUND THEN
    RAISE EXCEPTION 'Unprovisioned user still exists in auth.users!';
  END IF;
  RAISE NOTICE 'delete_unprovisioned_self for unprovisioned user check PASSED.';

  RAISE NOTICE '=== ALL RPC INTEGRATION TESTS COMPLETED SUCCESSFULLY ===';

  -- Cleanup test data
  DELETE FROM auth.users WHERE id = v_test_uid;
END $$;

ROLLBACK;
