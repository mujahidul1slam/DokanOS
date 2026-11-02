-- ============================================================================
-- SQL Integration Tests for Member-Scoped RLS & Multi-Tenant Isolation
-- Tests Task 1.6b policies under simulated authenticated caller contexts
-- ============================================================================

DO $$
DECLARE
  v_user_a uuid := 'b1000000-0000-0000-0000-000000000001'::uuid;
  v_user_b uuid := 'b1000000-0000-0000-0000-000000000002'::uuid;
  v_biz_a uuid;
  v_biz_b uuid;
  v_store_a uuid;
  v_store_b uuid;
  v_brand_a uuid;
  v_brand_b uuid;
  v_prod_a uuid;
  v_can_access boolean;
  v_my_biz jsonb;
BEGIN
  RAISE NOTICE '=== Testing Member-Scoped RLS Isolation ===';

  -- 1. Setup clean test data
  DELETE FROM public.user_business_access WHERE user_id IN (v_user_a, v_user_b);
  DELETE FROM public.user_store_access WHERE user_id IN (v_user_a, v_user_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);

  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role)
  VALUES
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'owner.a@example.com', 'hash', now(), '{"provider":"email"}'::jsonb, '{"signup_intent":"owner"}'::jsonb, now(), now(), 'authenticated', 'authenticated'),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'owner.b@example.com', 'hash', now(), '{"provider":"email"}'::jsonb, '{"signup_intent":"owner"}'::jsonb, now(), now(), 'authenticated', 'authenticated');

  -- Create Business A & Store A
  INSERT INTO public.businesses (name, slug)
  VALUES ('Business Alpha', 'biz-alpha-test')
  RETURNING id INTO v_biz_a;

  INSERT INTO public.stores (name, url, status)
  VALUES ('Store Alpha', 'https://biz-alpha-test.stores.dokanos.app', 'disconnected')
  RETURNING id INTO v_store_a;

  INSERT INTO public.brands (business_id, name, slug, woo_store_id)
  VALUES (v_biz_a, 'Brand Alpha', 'brand-alpha-test', v_store_a)
  RETURNING id INTO v_brand_a;

  INSERT INTO public.user_business_access (user_id, business_id, role)
  VALUES (v_user_a, v_biz_a, 'owner');

  INSERT INTO public.user_store_access (user_id, store_id)
  VALUES (v_user_a, v_store_a);

  -- Create Business B & Store B
  INSERT INTO public.businesses (name, slug)
  VALUES ('Business Beta', 'biz-beta-test')
  RETURNING id INTO v_biz_b;

  INSERT INTO public.stores (name, url, status)
  VALUES ('Store Beta', 'https://biz-beta-test.stores.dokanos.app', 'disconnected')
  RETURNING id INTO v_store_b;

  INSERT INTO public.brands (business_id, name, slug, woo_store_id)
  VALUES (v_biz_b, 'Brand Beta', 'brand-beta-test', v_store_b)
  RETURNING id INTO v_brand_b;

  INSERT INTO public.user_business_access (user_id, business_id, role)
  VALUES (v_user_b, v_biz_b, 'owner');

  INSERT INTO public.user_store_access (user_id, store_id)
  VALUES (v_user_b, v_store_b);

  -- 2. Test user_can_access_store under User A context
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);

  -- User A accessing Store A -> MUST BE TRUE
  SELECT public.user_can_access_store(v_store_a) INTO v_can_access;
  IF v_can_access IS NOT TRUE THEN
    RAISE EXCEPTION 'User A was denied access to their own Store A!';
  END IF;

  -- User A accessing Store B -> MUST BE FALSE
  SELECT public.user_can_access_store(v_store_b) INTO v_can_access;
  IF v_can_access IS NOT FALSE THEN
    RAISE EXCEPTION 'CRITICAL SECURITY LEAK: User A was granted access to User B''s Store B!';
  END IF;

  RAISE NOTICE 'user_can_access_store isolation test PASSED.';

  -- 3. Test get_my_businesses() returns only own businesses
  SELECT jsonb_agg(to_jsonb(r)) INTO v_my_biz FROM public.get_my_businesses() r;
  IF jsonb_array_length(v_my_biz) <> 1 OR (v_my_biz->0->>'id')::uuid <> v_biz_a THEN
    RAISE EXCEPTION 'get_my_businesses failed for User A: got %', v_my_biz;
  END IF;

  IF (v_my_biz->0->>'role') <> 'owner' THEN
    RAISE EXCEPTION 'get_my_businesses role column missing or incorrect: got %', v_my_biz;
  END IF;

  RAISE NOTICE 'get_my_businesses isolation test PASSED.';

  -- 4. Test User B context
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);

  SELECT public.user_can_access_store(v_store_b) INTO v_can_access;
  IF v_can_access IS NOT TRUE THEN
    RAISE EXCEPTION 'User B was denied access to their own Store B!';
  END IF;

  SELECT public.user_can_access_store(v_store_a) INTO v_can_access;
  IF v_can_access IS NOT FALSE THEN
    RAISE EXCEPTION 'CRITICAL SECURITY LEAK: User B was granted access to User A''s Store A!';
  END IF;

  RAISE NOTICE 'User B isolation test PASSED.';

  -- Cleanup test records
  DELETE FROM public.user_business_access WHERE user_id IN (v_user_a, v_user_b);
  DELETE FROM public.user_store_access WHERE user_id IN (v_user_a, v_user_b);
  DELETE FROM public.brands WHERE id IN (v_brand_a, v_brand_b);
  DELETE FROM public.stores WHERE id IN (v_store_a, v_store_b);
  DELETE FROM public.businesses WHERE id IN (v_biz_a, v_biz_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);

  RAISE NOTICE '=== ALL RLS ISOLATION TESTS PASSED ===';
END $$;
