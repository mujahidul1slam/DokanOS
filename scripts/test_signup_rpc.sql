-- ============================================================================
-- SQL Integration Tests — Release-1 signup contract (R1-a..d, R4a-a..c,
-- gate-regression). Run in Supabase Dashboard > SQL Editor or psql, against
-- the HOSTED project, after `supabase db push`.
--
-- Rewritten for the blank-slate contract (a stale pre-R1 version of this file
-- checked the old template shape and would mislead after the rewrite):
-- a fresh provision creates business + owner UBA + 33 permissions and NOTHING
-- else; stores/brands/access arrive only via create_my_brand_store.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_test_uid   uuid := 'a1000000-0000-0000-0000-000000000001'::uuid;
  v_user2_uid  uuid := 'a1000000-0000-0000-0000-000000000002'::uuid;
  v_member_uid uuid := 'a1000000-0000-0000-0000-000000000003'::uuid;
  v_viewer_uid uuid := 'a1000000-0000-0000-0000-000000000004'::uuid;
  v_other_uid  uuid := 'a1000000-0000-0000-0000-000000000005'::uuid;
  v_nonce      text := 'test-nonce-1234567890abcdef';
  v_nonce2     text := 'test-nonce-2468ace13579bdf0';
  v_res        jsonb;
  v_res2       jsonb;
  v_biz_id     uuid;
  v_second_biz_id uuid;
  v_user2_biz_id  uuid;
  v_store_id   uuid;
  v_brand_id   uuid;
  v_sf_id      uuid;
  v_slug       text;
  v_perm_count integer;
  v_count      integer;
  v_uba_role   text;
  v_store_domain text;
  v_sf_active  boolean;
  v_switch     text;
  v_del_res    jsonb;
BEGIN
  RAISE NOTICE '=== Release-1 Signup Contract Tests (R1 + R4a + gate-regression) ===';

  -- 0. Fixture hygiene: remove leftover fixture rows from prior runs
  DELETE FROM public.user_permissions WHERE user_id IN (v_test_uid, v_user2_uid, v_member_uid, v_viewer_uid);
  DELETE FROM public.user_store_access WHERE user_id IN (v_test_uid, v_user2_uid, v_member_uid, v_viewer_uid);
  DELETE FROM public.user_business_access WHERE user_id IN (v_test_uid, v_user2_uid, v_member_uid, v_viewer_uid);
  DELETE FROM public.signup_events WHERE user_id IN (v_test_uid, v_user2_uid)
     OR email IN ('merchant.test@example.com', 'merchant.two@example.com');
  DELETE FROM auth.users WHERE id IN (v_test_uid, v_user2_uid, v_member_uid, v_viewer_uid, v_other_uid);

  -- 1. Server anchor rows (one per owner fixture)
  INSERT INTO public.signup_events (email, event, ip, ua, meta, created_at) VALUES
    ('merchant.test@example.com', 'signup_started', '127.0.0.1', 'test-agent',
     jsonb_build_object('nonce', v_nonce, 'business_name', 'Bengal Artisans',
       'store_slug', 'bengal-artisans', 'tos_version', 'v1.0', 'privacy_version', 'v1.0'), now()),
    ('merchant.two@example.com', 'signup_started', '127.0.0.1', 'test-agent',
     jsonb_build_object('nonce', v_nonce2, 'business_name', 'River Crafts Co',
       'store_slug', 'river-crafts-co', 'tos_version', 'v1.0', 'privacy_version', 'v1.0'), now());

  -- 2. Fixture users
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role) VALUES
    (v_test_uid, '00000000-0000-0000-0000-000000000000', 'merchant.test@example.com', 'dummy-hash', now(),
     jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
     jsonb_build_object('signup_intent', 'owner', 'business_name', 'Bengal Artisans',
       'store_slug', 'bengal-artisans', 'signup_nonce', v_nonce,
       'first_name', 'Rafiq', 'last_name', 'Ahmed'),
     now(), now(), 'authenticated', 'authenticated'),
    (v_user2_uid, '00000000-0000-0000-0000-000000000000', 'merchant.two@example.com', 'dummy-hash', now(),
     jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
     jsonb_build_object('signup_intent', 'owner', 'business_name', 'River Crafts Co',
       'store_slug', 'river-crafts-co', 'signup_nonce', v_nonce2,
       'first_name', 'Nusrat', 'last_name', 'Jahan'),
     now(), now(), 'authenticated', 'authenticated'),
    (v_member_uid, '00000000-0000-0000-0000-000000000000', 'member.test@example.com', 'dummy-hash', now(),
     jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
     '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
    (v_viewer_uid, '00000000-0000-0000-0000-000000000000', 'viewer.test@example.com', 'dummy-hash', now(),
     jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
     '{}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
    (v_other_uid, '00000000-0000-0000-0000-000000000000', 'failed.setup@example.com', 'dummy-hash', now(),
     jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
     '{}'::jsonb, now(), now(), 'authenticated', 'authenticated');

  -- 3. R1: provision_owner_business — blank-slate contract
  v_res := public.provision_owner_business(v_test_uid, v_nonce);
  RAISE NOTICE 'Provision result: %', v_res;
  IF v_res->>'business_id' IS NULL THEN
    RAISE EXCEPTION 'Provisioning failed: %', v_res;
  END IF;
  v_biz_id := (v_res->>'business_id')::uuid;

  -- R1-a: owner bundle = exactly 33 permissions, storefronts.view present
  v_perm_count := NULL;
  SELECT count(*) INTO v_perm_count FROM public.user_permissions WHERE user_id = v_test_uid;
  IF v_perm_count <> 33 THEN
    RAISE EXCEPTION 'R1-a: owner bundle must be exactly 33 keys, got %', v_perm_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_permissions
                  WHERE user_id = v_test_uid AND permission::text = 'storefronts.view') THEN
    RAISE EXCEPTION 'R1-a: storefronts.view missing from owner bundle';
  END IF;

  -- Forbidden keys must stay absent (carried over)
  IF EXISTS (SELECT 1 FROM public.user_permissions
              WHERE user_id = v_test_uid
                AND permission::text IN ('settings.manage', 'team.manage', 'integrations.manage', 'stores.manage')) THEN
    RAISE EXCEPTION 'Owner permission bundle contains forbidden keys!';
  END IF;

  -- R1-b: ZERO template rows for the fresh provision
  IF EXISTS (SELECT 1 FROM public.stores s
              JOIN public.brands br ON br.woo_store_id = s.id
             WHERE br.business_id = v_biz_id) THEN
    RAISE EXCEPTION 'R1-b: template store rows were created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brands WHERE business_id = v_biz_id) THEN
    RAISE EXCEPTION 'R1-b: template brand rows were created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locations WHERE business_id = v_biz_id) THEN
    RAISE EXCEPTION 'R1-b: template location rows were created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefronts sf
              JOIN public.brands br ON sf.store_id = br.woo_store_id
             WHERE br.business_id = v_biz_id) THEN
    RAISE EXCEPTION 'R1-b: template storefront rows were created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.selling_points WHERE business_id = v_biz_id) THEN
    RAISE EXCEPTION 'R1-b: template selling_points rows were created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connectors WHERE business_id = v_biz_id) THEN
    RAISE EXCEPTION 'R1-b: template connector rows were created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_sources WHERE business_id = v_biz_id) THEN
    RAISE EXCEPTION 'R1-b: template product_source rows were created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_sources WHERE business_id = v_biz_id) THEN
    RAISE EXCEPTION 'R1-b: template customer_source rows were created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_store_access WHERE user_id = v_test_uid) THEN
    RAISE EXCEPTION 'R1-b: template user_store_access rows were created';
  END IF;

  -- UBA role, zero global roles, consent (carried over)
  v_uba_role := NULL;
  SELECT role INTO v_uba_role FROM public.user_business_access
   WHERE user_id = v_test_uid AND business_id = v_biz_id;
  IF v_uba_role IS NULL OR v_uba_role <> 'owner' THEN
    RAISE EXCEPTION 'UBA role must be owner, got %', v_uba_role;
  END IF;
  v_count := NULL;
  SELECT count(*) INTO v_count FROM public.user_roles WHERE user_id = v_test_uid;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'user_roles must be 0 for owner, got %', v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consent_records WHERE user_id = v_test_uid AND doc = 'tos') THEN
    RAISE EXCEPTION 'TOS consent record missing!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consent_records WHERE user_id = v_test_uid AND doc = 'privacy') THEN
    RAISE EXCEPTION 'Privacy consent record missing!';
  END IF;
  -- onboarding marker starts NULL (D-09)
  IF EXISTS (SELECT 1 FROM public.businesses WHERE id = v_biz_id AND onboarding_completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Fresh provision must have NULL onboarding_completed_at';
  END IF;

  RAISE NOTICE 'R1-a/b PASSED: 33-key bundle, zero template rows, consent logged.';

  -- 4. Idempotent re-invoke with the same nonce (carried over)
  v_res2 := public.provision_owner_business(v_test_uid, v_nonce);
  IF (v_res2->>'business_id')::uuid <> v_biz_id THEN
    RAISE EXCEPTION 'Idempotent provisioning returned unexpected result: %', v_res2;
  END IF;
  v_perm_count := NULL;
  SELECT count(*) INTO v_perm_count FROM public.user_permissions WHERE user_id = v_test_uid;
  IF v_perm_count <> 33 THEN
    RAISE EXCEPTION 'Idempotent re-invoke changed the bundle size: %', v_perm_count;
  END IF;
  RAISE NOTICE 'Idempotency check PASSED.';

  -- 5. R1-d: create_additional_business idempotency triple
  -- 5a. same name, same user, within 24h -> SAME business, no second audit event
  v_res2 := public.create_additional_business(v_test_uid, 'Bengal Artisans');
  IF (v_res2->>'business_id')::uuid <> v_biz_id THEN
    RAISE EXCEPTION 'R1-d 5a: same-name re-invoke must return the same business, got %', v_res2;
  END IF;
  v_count := NULL;
  SELECT count(*) INTO v_count FROM public.signup_events
   WHERE event = 'business_added' AND user_id = v_test_uid;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'R1-d 5a: idempotent return must not write business_added events, found %', v_count;
  END IF;
  -- 5b. different name -> NEW business
  v_res2 := public.create_additional_business(v_test_uid, 'Dhaka Modern Crafts');
  v_second_biz_id := (v_res2->>'business_id')::uuid;
  IF v_second_biz_id IS NULL OR v_second_biz_id = v_biz_id THEN
    RAISE EXCEPTION 'R1-d 5b: different name must create a NEW business, got %', v_res2;
  END IF;
  v_count := NULL;
  SELECT count(*) INTO v_count FROM public.user_business_access WHERE user_id = v_test_uid;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'R1-d 5b: owner should now have 2 UBA rows, got %', v_count;
  END IF;
  -- 5c. user B using user A's taken name -> fresh suffixed slug, never A's business
  v_res := public.provision_owner_business(v_user2_uid, v_nonce2);
  v_user2_biz_id := (v_res->>'business_id')::uuid;
  v_res2 := public.create_additional_business(v_user2_uid, 'Bengal Artisans');
  IF (v_res2->>'business_id')::uuid = v_biz_id THEN
    RAISE EXCEPTION 'R1-d 5c: user B must never receive user A''s business';
  END IF;
  IF (v_res2->>'business_id')::uuid = v_user2_biz_id THEN
    RAISE EXCEPTION 'R1-d 5c: user B same-name should create a NEW business, got their existing one';
  END IF;
  v_uba_role := NULL;
  SELECT role INTO v_uba_role FROM public.user_business_access
   WHERE user_id = v_user2_uid AND business_id = (v_res2->>'business_id')::uuid;
  IF v_uba_role IS NULL THEN
    RAISE EXCEPTION 'R1-d 5c: user B should own the newly created business';
  END IF;
  RAISE NOTICE 'R1-d idempotency triple PASSED.';

  -- 6. R4a: create_my_brand_store as the owner (jwt simulation)
  PERFORM set_config('request.jwt.claim.sub', v_test_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_test_uid::text, 'role', 'authenticated')::text, true);
  v_store_domain := NULL;
  SELECT value #>> '{}' INTO v_store_domain FROM public.app_config WHERE key = 'storefront_domain';
  v_res := public.create_my_brand_store(v_biz_id, 'Bengal Artisans Main');
  RAISE NOTICE 'create_my_brand_store result: %', v_res;
  v_store_id := (v_res->>'store_id')::uuid;
  v_brand_id := (v_res->>'brand_id')::uuid;
  v_sf_id := (v_res->>'storefront_id')::uuid;
  v_slug := v_res->>'slug';
  IF v_store_id IS NULL OR v_brand_id IS NULL OR v_sf_id IS NULL OR v_slug IS NULL THEN
    RAISE EXCEPTION 'R4a-c: create_my_brand_store returned an incomplete result: %', v_res;
  END IF;

  -- R4a-c: one transaction, four rows, correct shapes
  IF NOT EXISTS (SELECT 1 FROM public.stores
                  WHERE id = v_store_id
                    AND url = 'https://' || v_slug || '.' || v_store_domain
                    AND status = 'disconnected') THEN
    RAISE EXCEPTION 'R4a-c: store row missing or wrong url/status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands
                  WHERE id = v_brand_id AND business_id = v_biz_id
                    AND woo_store_id = v_store_id AND slug = v_slug) THEN
    RAISE EXCEPTION 'R4a-c: brand row missing or not linked to the store';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_store_access
                  WHERE user_id = v_test_uid AND store_id = v_store_id) THEN
    RAISE EXCEPTION 'R4a-c: user_store_access row missing for the caller';
  END IF;
  v_sf_active := NULL;
  SELECT is_active INTO v_sf_active FROM public.storefronts WHERE id = v_sf_id;
  IF v_sf_active IS NOT FALSE THEN
    RAISE EXCEPTION 'R4a-c: placeholder storefront must be inactive, got %', v_sf_active;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storefronts WHERE id = v_sf_id AND slug = v_slug) THEN
    RAISE EXCEPTION 'R4a-c: storefront slug mismatch';
  END IF;
  RAISE NOTICE 'R4a-c create checks PASSED.';

  -- 6a. R4a-b: second invoke returns the SAME store (single-store cap)
  v_res2 := public.create_my_brand_store(v_biz_id, 'Bengal Artisans Main');
  IF (v_res2->>'store_id')::uuid <> v_store_id THEN
    RAISE EXCEPTION 'R4a-b: second invoke must return the same store, got %', v_res2;
  END IF;
  v_count := NULL;
  SELECT count(*) INTO v_count FROM public.stores s
    JOIN public.brands br ON br.woo_store_id = s.id
   WHERE br.business_id = v_biz_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'R4a-b: duplicate store rows after re-invoke, got %', v_count;
  END IF;
  RAISE NOTICE 'R4a-b single-store cap PASSED.';

  -- 6b. R4a-a: deny matrix
  -- member denied
  PERFORM set_member_business_role(v_member_uid, v_biz_id, 'member');
  PERFORM set_config('request.jwt.claim.sub', v_member_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_member_uid::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.create_my_brand_store(v_biz_id, 'Should Not Exist');
    RAISE EXCEPTION 'R4a-a: member was allowed to create a store!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN
      RAISE EXCEPTION 'R4a-a: member denial raised an unexpected error: %', SQLERRM;
    END IF;
  END;
  -- viewer denied
  PERFORM set_config('request.jwt.claim.sub', v_test_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_test_uid::text, 'role', 'authenticated')::text, true);
  PERFORM set_member_business_role(v_viewer_uid, v_biz_id, 'viewer');
  PERFORM set_config('request.jwt.claim.sub', v_viewer_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer_uid::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.create_my_brand_store(v_biz_id, 'Should Not Exist');
    RAISE EXCEPTION 'R4a-a: viewer was allowed to create a store!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN
      RAISE EXCEPTION 'R4a-a: viewer denial raised an unexpected error: %', SQLERRM;
    END IF;
  END;
  -- owner of another business denied (user2 owns their own business, none on v_biz_id)
  PERFORM set_config('request.jwt.claim.sub', v_user2_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user2_uid::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.create_my_brand_store(v_biz_id, 'Cross Tenant');
    RAISE EXCEPTION 'R4a-a: owner of business A was allowed to create in business B!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN
      RAISE EXCEPTION 'R4a-a: cross-tenant denial raised an unexpected error: %', SQLERRM;
    END IF;
  END;
  -- denied attempts left nothing behind
  IF EXISTS (SELECT 1 FROM public.stores WHERE name IN ('Should Not Exist', 'Cross Tenant')) THEN
    RAISE EXCEPTION 'R4a-a: denied attempts left rows behind';
  END IF;
  -- restore owner context
  PERFORM set_config('request.jwt.claim.sub', v_test_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_test_uid::text, 'role', 'authenticated')::text, true);
  RAISE NOTICE 'R4a-a deny matrix PASSED.';

  -- 7. R4-d4: publish works on the R4a-reserved storefront (wizard step-4 shape)
  --    the wizard attaches the dokanos_storefront selling point, then publishes
  INSERT INTO public.selling_points (business_id, brand_id, name, type, woo_store_id, storefront_id)
  VALUES (v_biz_id, v_brand_id, v_slug || ' Storefront', 'dokanos_storefront', v_store_id, v_sf_id);
  v_res := public.publish_my_storefront(v_sf_id);
  IF (v_res->>'status') <> 'ok' OR (v_res->>'is_active')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'publish on the R4a storefront failed: %', v_res;
  END IF;
  v_sf_active := NULL;
  SELECT is_active INTO v_sf_active FROM public.storefronts WHERE id = v_sf_id;
  IF v_sf_active IS NOT TRUE THEN
    RAISE EXCEPTION 'R4-d4: storefront not active after publish';
  END IF;
  RAISE NOTICE 'R4-d4 publish PASSED.';

  -- 8. gate-regression
  -- 8a. provisioned owner denied by delete_unprovisioned_self (carried over)
  PERFORM set_config('request.jwt.claim.sub', v_test_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_test_uid::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.delete_unprovisioned_self();
    RAISE EXCEPTION 'delete_unprovisioned_self should have thrown for a provisioned user!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DELETE_DENIED_PROVISIONED%' THEN
      RAISE NOTICE 'Provisioned delete protection PASSED (caught expected error: %)', SQLERRM;
    ELSE
      RAISE EXCEPTION 'Unexpected error from delete_unprovisioned_self: %', SQLERRM;
    END IF;
  END;

  -- 8b. gate RPCs still exist (purge + retention + publish + delete + R4a)
  v_count := NULL;
  SELECT count(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('get_purge_candidates', 'run_data_retention_cleanup',
                       'publish_my_storefront', 'delete_unprovisioned_self', 'create_my_brand_store');
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'gate-regression: expected 5 RPCs present, got %', v_count;
  END IF;

  -- 8c. kill switch untouched: signup_open still false
  v_switch := NULL;
  SELECT value #>> '{}' INTO v_switch FROM public.app_config WHERE key = 'signup_open';
  IF v_switch IS NULL OR v_switch <> 'false' THEN
    RAISE EXCEPTION 'gate-regression: signup_open must remain false, got %', v_switch;
  END IF;

  -- 8d. zero global roles across ALL self-serve fixtures
  v_count := NULL;
  SELECT count(*) INTO v_count FROM public.user_roles
   WHERE user_id IN (v_test_uid, v_user2_uid, v_member_uid, v_viewer_uid);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'user_roles rows exist for self-serve fixtures: %', v_count;
  END IF;
  RAISE NOTICE 'gate-regression PASSED.';

  -- 9. delete_unprovisioned_self succeeds for an unprovisioned user (carried over)
  PERFORM set_config('request.jwt.claim.sub', v_other_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_uid::text, 'role', 'authenticated')::text, true);
  v_del_res := public.delete_unprovisioned_self();
  IF (v_del_res->>'status') <> 'ok' THEN
    RAISE EXCEPTION 'delete_unprovisioned_self failed for the unprovisioned user: %', v_del_res;
  END IF;
  PERFORM 1 FROM auth.users WHERE id = v_other_uid;
  IF FOUND THEN
    RAISE EXCEPTION 'Unprovisioned user still exists in auth.users!';
  END IF;
  RAISE NOTICE 'Unprovisioned delete check PASSED.';

  RAISE NOTICE '=== ALL RELEASE-1 CONTRACT TESTS COMPLETED SUCCESSFULLY ===';
  RAISE NOTICE 'New contract: 33-key bundle, zero template rows, R4a single-store cap, gates green.';

  -- Fixture rollback safety net (the outer ROLLBACK is the real cleanup)
  DELETE FROM auth.users WHERE id IN (v_test_uid, v_user2_uid, v_member_uid, v_viewer_uid);
END $$;

ROLLBACK;
