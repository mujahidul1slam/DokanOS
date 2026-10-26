-- S1 contract: the active business context is server-owned and membership-bound.
-- Fixture UUIDs are seeded by scripts/run-rls-tests.mjs.
--
-- S3 additions (issue #16): the operational RLS predicates must track the
-- selected context. Fixture rows for the A/B probes are created inside each
-- BEGIN/ROLLBACK block, so the battery leaves nothing behind.

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.active_business_context', 'SELECT')
     OR has_table_privilege('authenticated', 'public.active_business_context', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: client role can read active_business_context directly';
  END IF;
  IF has_table_privilege('anon', 'public.active_business_context', 'INSERT')
     OR has_table_privilege('authenticated', 'public.active_business_context', 'INSERT')
     OR has_table_privilege('anon', 'public.active_business_context', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.active_business_context', 'UPDATE')
     OR has_table_privilege('anon', 'public.active_business_context', 'DELETE')
     OR has_table_privilege('authenticated', 'public.active_business_context', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL: client role has direct active_business_context write privilege';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.set_active_business_context(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.current_business_context()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated context RPC grants are missing';
  END IF;
  -- service_role bypasses RLS but not EXECUTE on a SECURITY DEFINER function, so
  -- server-side callers need the grant too. Parity with the repo convention in
  -- 20260929120000_member_scoped_rls.sql is asserted here because the S1
  -- migration granted `authenticated` only (fixed by
  -- 20261026100000_active_business_context_service_role_grants.sql).
  IF NOT has_function_privilege('service_role', 'public.set_active_business_context(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.current_business_context()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: service_role context RPC grants are missing';
  END IF;
  -- The service-role grant must not have widened the table surface: service_role
  -- already owns RLS bypass, but no client role may reach the table directly.
  IF has_function_privilege('anon', 'public.set_active_business_context(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.current_business_context()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute context RPCs';
  END IF;
END;
$$;

-- OWNER_A may select BIZ_A.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT public.set_active_business_context('11111111-0000-0000-0000-000000000001');
DO $$
BEGIN
  IF public.current_business_context() IS DISTINCT FROM '11111111-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'FAIL: valid active business was not returned';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

-- A member of BIZ_A cannot select B_other, and the rejected switch must not
-- replace the previously selected valid context.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT public.set_active_business_context('11111111-0000-0000-0000-000000000001');
DO $$
BEGIN
  BEGIN
    PERFORM public.set_active_business_context('11111111-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'FAIL: non-member business switch succeeded' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF public.current_business_context() IS DISTINCT FROM '11111111-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'FAIL: rejected switch changed the valid context';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

-- Membership revoked AFTER a successful switch: the stored context must stop
-- resolving immediately (fail closed), with no new switch and no client write.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT public.set_active_business_context('11111111-0000-0000-0000-000000000001');
-- Discriminator: the context resolves BEFORE the revocation, so the NULL below
-- proves invalidation rather than a context that was never written.
DO $$
BEGIN
  IF public.current_business_context() IS DISTINCT FROM '11111111-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'FAIL: active business was not resolvable before revocation';
  END IF;
END;
$$;

-- The account owner removes the membership (privileged fixture connection).
RESET ROLE;
DELETE FROM public.user_business_access
 WHERE user_id = '00000000-0000-0000-0000-000000000001'
   AND business_id = '11111111-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.current_business_context() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: revoked membership still resolved an active business';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

-- OUTSIDER cannot set any business context.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    PERFORM public.set_active_business_context('11111111-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: outsider business switch succeeded' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$$;
RESET ROLE;
ROLLBACK;

-- ============================================================================
-- S3: A/B operational isolation. One member belongs to BOTH BIZ_A and B_other;
-- every probe asserts on fixed fixture ids so unrelated rows can never change
-- the verdict.
-- ============================================================================

-- Helper fixture set (repeated per block, rolled back with it):
--   RLS Store A/B  33333333-…-0021/0022  (brands: …-0021/0022 → BIZ_A / B_other)
--   RLS Product A/B 55555555-…-0021/0022       RLS Order A/B 66666666-…-0021/0022
--   RLS Cat A/B 77777777-…-0021/0022           variations/payments/timeline per parent
--   DUAL member 00000000-…-0041 (member of BIZ_A AND B_other)

-- Block 1 — a member of both businesses with NO resolved context reads nothing
-- (fail closed), even though membership alone would allow both halves.
BEGIN;
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000041', 'authenticated', 'authenticated',
        'dual-member@dokanos.test', 'local-fixture-password-never-used-for-login', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
INSERT INTO public.user_business_access (user_id, business_id, role) VALUES
  ('00000000-0000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000001', 'member'),
  ('00000000-0000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000002', 'member');
INSERT INTO public.stores (id, name, url) VALUES
  ('33333333-0000-0000-0000-000000000021', 'RLS Store A', 'https://rls-a.test'),
  ('33333333-0000-0000-0000-000000000022', 'RLS Store B', 'https://rls-b.test');
INSERT INTO public.brands (id, business_id, name, slug, woo_store_id) VALUES
  ('44444444-0000-0000-0000-000000000021', '11111111-0000-0000-0000-000000000001', 'RLS Brand A', 'rls-brand-a', '33333333-0000-0000-0000-000000000021'),
  ('44444444-0000-0000-0000-000000000022', '11111111-0000-0000-0000-000000000002', 'RLS Brand B', 'rls-brand-b', '33333333-0000-0000-0000-000000000022');
INSERT INTO public.products (id, store_id, name) VALUES
  ('55555555-0000-0000-0000-000000000021', '33333333-0000-0000-0000-000000000021', 'RLS Product A'),
  ('55555555-0000-0000-0000-000000000022', '33333333-0000-0000-0000-000000000022', 'RLS Product B');
INSERT INTO public.orders (id, store_id, order_number) VALUES
  ('66666666-0000-0000-0000-000000000021', '33333333-0000-0000-0000-000000000021', 'RLS-A-1'),
  ('66666666-0000-0000-0000-000000000022', '33333333-0000-0000-0000-000000000022', 'RLS-B-1');
INSERT INTO public.categories (id, name, store_id) VALUES
  ('77777777-0000-0000-0000-000000000021', 'RLS Cat A', '33333333-0000-0000-0000-000000000021'),
  ('77777777-0000-0000-0000-000000000022', 'RLS Cat B', '33333333-0000-0000-0000-000000000022');
INSERT INTO public.product_categories (product_id, category_id) VALUES
  ('55555555-0000-0000-0000-000000000021', '77777777-0000-0000-0000-000000000021'),
  ('55555555-0000-0000-0000-000000000022', '77777777-0000-0000-0000-000000000022');
INSERT INTO public.product_variations (id, product_id, name) VALUES
  ('88888888-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000021', 'RLS Var A'),
  ('88888888-0000-0000-0000-000000000022', '55555555-0000-0000-0000-000000000022', 'RLS Var B');
INSERT INTO public.order_payments (id, order_id, method) VALUES
  ('99999999-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000021', 'cash'),
  ('99999999-0000-0000-0000-000000000022', '66666666-0000-0000-0000-000000000022', 'cash');
INSERT INTO public.order_timeline (id, order_id, event, description) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000021', 'created', 'RLS A'),
  ('aaaaaaaa-0000-0000-0000-000000000022', '66666666-0000-0000-0000-000000000022', 'created', 'RLS B');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}';
DO $$
DECLARE
  v_count integer;
BEGIN
  IF public.current_business_context() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: unselected context unexpectedly resolved' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_count FROM public.orders WHERE id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: no-context orders read (% rows)', v_count USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: no-context products read (% rows)', v_count USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_count FROM public.categories WHERE id IN ('77777777-0000-0000-0000-000000000021', '77777777-0000-0000-0000-000000000022');
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: no-context categories read (% rows)', v_count USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_count FROM public.product_categories WHERE product_id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: no-context product_categories read (% rows)', v_count USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_count FROM public.product_variations WHERE product_id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: no-context product_variations read (% rows)', v_count USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_count FROM public.order_payments WHERE order_id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: no-context order_payments read (% rows)', v_count USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_count FROM public.order_timeline WHERE order_id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: no-context order_timeline read (% rows)', v_count USING ERRCODE = 'P0001'; END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

-- Block 2 — the member of BOTH businesses sees exactly the selected half:
-- BIZ_A after setting BIZ_A, B_other after setting B_other (A/B switching).
BEGIN;
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000041', 'authenticated', 'authenticated',
        'dual-member@dokanos.test', 'local-fixture-password-never-used-for-login', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
INSERT INTO public.user_business_access (user_id, business_id, role) VALUES
  ('00000000-0000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000001', 'member'),
  ('00000000-0000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000002', 'member');
INSERT INTO public.stores (id, name, url) VALUES
  ('33333333-0000-0000-0000-000000000021', 'RLS Store A', 'https://rls-a.test'),
  ('33333333-0000-0000-0000-000000000022', 'RLS Store B', 'https://rls-b.test');
INSERT INTO public.brands (id, business_id, name, slug, woo_store_id) VALUES
  ('44444444-0000-0000-0000-000000000021', '11111111-0000-0000-0000-000000000001', 'RLS Brand A', 'rls-brand-a', '33333333-0000-0000-0000-000000000021'),
  ('44444444-0000-0000-0000-000000000022', '11111111-0000-0000-0000-000000000002', 'RLS Brand B', 'rls-brand-b', '33333333-0000-0000-0000-000000000022');
INSERT INTO public.products (id, store_id, name) VALUES
  ('55555555-0000-0000-0000-000000000021', '33333333-0000-0000-0000-000000000021', 'RLS Product A'),
  ('55555555-0000-0000-0000-000000000022', '33333333-0000-0000-0000-000000000022', 'RLS Product B');
INSERT INTO public.orders (id, store_id, order_number) VALUES
  ('66666666-0000-0000-0000-000000000021', '33333333-0000-0000-0000-000000000021', 'RLS-A-1'),
  ('66666666-0000-0000-0000-000000000022', '33333333-0000-0000-0000-000000000022', 'RLS-B-1');
INSERT INTO public.categories (id, name, store_id) VALUES
  ('77777777-0000-0000-0000-000000000021', 'RLS Cat A', '33333333-0000-0000-0000-000000000021'),
  ('77777777-0000-0000-0000-000000000022', 'RLS Cat B', '33333333-0000-0000-0000-000000000022');
INSERT INTO public.product_categories (product_id, category_id) VALUES
  ('55555555-0000-0000-0000-000000000021', '77777777-0000-0000-0000-000000000021'),
  ('55555555-0000-0000-0000-000000000022', '77777777-0000-0000-0000-000000000022');
INSERT INTO public.product_variations (id, product_id, name) VALUES
  ('88888888-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000021', 'RLS Var A'),
  ('88888888-0000-0000-0000-000000000022', '55555555-0000-0000-0000-000000000022', 'RLS Var B');
INSERT INTO public.order_payments (id, order_id, method) VALUES
  ('99999999-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000021', 'cash'),
  ('99999999-0000-0000-0000-000000000022', '66666666-0000-0000-0000-000000000022', 'cash');
INSERT INTO public.order_timeline (id, order_id, event, description) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000021', 'created', 'RLS A'),
  ('aaaaaaaa-0000-0000-0000-000000000022', '66666666-0000-0000-0000-000000000022', 'created', 'RLS B');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}';

-- ---- select BIZ_A: exactly the A half is visible ----
SELECT public.set_active_business_context('11111111-0000-0000-0000-000000000001');
DO $$
DECLARE
  v_count integer;
BEGIN
  IF public.current_business_context() IS DISTINCT FROM '11111111-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'FAIL: context A was not selected' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_count FROM public.orders WHERE id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = '66666666-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: context A orders scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = '55555555-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: context A products scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.stores WHERE id IN ('33333333-0000-0000-0000-000000000021', '33333333-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.stores WHERE id = '33333333-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: context A stores scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.categories WHERE id IN ('77777777-0000-0000-0000-000000000021', '77777777-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.categories WHERE id = '77777777-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: context A categories scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.product_categories WHERE product_id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.product_categories WHERE category_id = '77777777-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: context A product_categories scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.product_variations WHERE product_id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.product_variations WHERE id = '88888888-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: context A product_variations scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.order_payments WHERE order_id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.order_payments WHERE id = '99999999-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: context A order_payments scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.order_timeline WHERE order_id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.order_timeline WHERE id = 'aaaaaaaa-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: context A order_timeline scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ---- switch to B_other: the SAME session now sees exactly the B half ----
SELECT public.set_active_business_context('11111111-0000-0000-0000-000000000002');
DO $$
DECLARE
  v_count integer;
BEGIN
  IF public.current_business_context() IS DISTINCT FROM '11111111-0000-0000-0000-000000000002'::uuid THEN
    RAISE EXCEPTION 'FAIL: context B was not selected' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_count FROM public.orders WHERE id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = '66666666-0000-0000-0000-000000000022') THEN
    RAISE EXCEPTION 'FAIL: context B orders scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = '55555555-0000-0000-0000-000000000022') THEN
    RAISE EXCEPTION 'FAIL: context B products scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.stores WHERE id IN ('33333333-0000-0000-0000-000000000021', '33333333-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.stores WHERE id = '33333333-0000-0000-0000-000000000022') THEN
    RAISE EXCEPTION 'FAIL: context B stores scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.categories WHERE id IN ('77777777-0000-0000-0000-000000000021', '77777777-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.categories WHERE id = '77777777-0000-0000-0000-000000000022') THEN
    RAISE EXCEPTION 'FAIL: context B categories scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.product_categories WHERE product_id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.product_categories WHERE category_id = '77777777-0000-0000-0000-000000000022') THEN
    RAISE EXCEPTION 'FAIL: context B product_categories scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.product_variations WHERE product_id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.product_variations WHERE id = '88888888-0000-0000-0000-000000000022') THEN
    RAISE EXCEPTION 'FAIL: context B product_variations scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.order_payments WHERE order_id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.order_payments WHERE id = '99999999-0000-0000-0000-000000000022') THEN
    RAISE EXCEPTION 'FAIL: context B order_payments scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.order_timeline WHERE order_id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.order_timeline WHERE id = 'aaaaaaaa-0000-0000-0000-000000000022') THEN
    RAISE EXCEPTION 'FAIL: context B order_timeline scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

-- Block 3 — a rejected switch preserves BOTH the context and its exposure: the
-- member stays on BIZ_A and B_other stays invisible end to end.
BEGIN;
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000041', 'authenticated', 'authenticated',
        'dual-member@dokanos.test', 'local-fixture-password-never-used-for-login', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
INSERT INTO public.user_business_access (user_id, business_id, role) VALUES
  ('00000000-0000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000001', 'member');
INSERT INTO public.stores (id, name, url) VALUES
  ('33333333-0000-0000-0000-000000000021', 'RLS Store A', 'https://rls-a.test'),
  ('33333333-0000-0000-0000-000000000022', 'RLS Store B', 'https://rls-b.test');
INSERT INTO public.brands (id, business_id, name, slug, woo_store_id) VALUES
  ('44444444-0000-0000-0000-000000000021', '11111111-0000-0000-0000-000000000001', 'RLS Brand A', 'rls-brand-a', '33333333-0000-0000-0000-000000000021'),
  ('44444444-0000-0000-0000-000000000022', '11111111-0000-0000-0000-000000000002', 'RLS Brand B', 'rls-brand-b', '33333333-0000-0000-0000-000000000022');
INSERT INTO public.products (id, store_id, name) VALUES
  ('55555555-0000-0000-0000-000000000021', '33333333-0000-0000-0000-000000000021', 'RLS Product A'),
  ('55555555-0000-0000-0000-000000000022', '33333333-0000-0000-0000-000000000022', 'RLS Product B');
INSERT INTO public.orders (id, store_id, order_number) VALUES
  ('66666666-0000-0000-0000-000000000021', '33333333-0000-0000-0000-000000000021', 'RLS-A-1'),
  ('66666666-0000-0000-0000-000000000022', '33333333-0000-0000-0000-000000000022', 'RLS-B-1');
INSERT INTO public.categories (id, name, store_id) VALUES
  ('77777777-0000-0000-0000-000000000021', 'RLS Cat A', '33333333-0000-0000-0000-000000000021'),
  ('77777777-0000-0000-0000-000000000022', 'RLS Cat B', '33333333-0000-0000-0000-000000000022');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}';
SELECT public.set_active_business_context('11111111-0000-0000-0000-000000000001');
DO $$
BEGIN
  BEGIN
    PERFORM public.set_active_business_context('11111111-0000-0000-0000-000000000003'); -- no membership
    RAISE EXCEPTION 'FAIL: non-member switch succeeded' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF public.current_business_context() IS DISTINCT FROM '11111111-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'FAIL: rejected switch changed the valid context' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.orders WHERE id IN ('66666666-0000-0000-0000-000000000021', '66666666-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = '66666666-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: post-rejection orders scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.products WHERE id IN ('55555555-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = '55555555-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: post-rejection products scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_count FROM public.categories WHERE id IN ('77777777-0000-0000-0000-000000000021', '77777777-0000-0000-0000-000000000022');
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.categories WHERE id = '77777777-0000-0000-0000-000000000021') THEN
    RAISE EXCEPTION 'FAIL: post-rejection categories scope is wrong (% rows)', v_count USING ERRCODE = 'P0001';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;
