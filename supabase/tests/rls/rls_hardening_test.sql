-- RLS hardening regression battery (companion to
-- 20261103100000_rls_hardening.sql).
--
-- Pins the post-hardening privilege doctrine so the production drift
-- (permissive default ACLs → anon-readable sync_queue/product_locations,
-- anon+authenticated TRUNCATE on ~70 tables, table-wide app_config grants,
-- authenticated-executable SECURITY DEFINER internals) can never silently
-- return. Two layers:
--   Part 1 — static invariants over pg_class / pg_default_acl / ACLs:
--     every public table has RLS enabled; no postgres-owned default ACL in
--     public grants anything to API roles; anon table-level grants exist only
--     on tables with an anon/public policy and only for SELECT; nobody
--     browser-reachable holds TRUNCATE; the carve-outs and view grants hold.
--   Part 2 — behaviour: anon denials (Shape A) on the previously-readable
--     tables including the TRUNCATE bypass, and member-scoped courier_shipments
--     reads (owner positive control + outsider invisibility + mutation
--     rowcount, Shape A′).
-- Fixture ids per _harness.md (OWNER_A …001 / OUTSIDER …007, BIZ_A …01).
-- One transaction, rolled back at the end.

BEGIN;

-- ---------------------------------------------------------------------------
-- Part 1 — static invariants (connection owner)
-- ---------------------------------------------------------------------------

-- 1a. Every public table has row-level security enabled.
DO $$
DECLARE
  v_t record;
  v_bad text := '';
BEGIN
  FOR v_t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    v_bad := v_bad || ' ' || v_t.relname;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'FAIL: public tables with RLS disabled:%', v_bad
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- 1b. The postgres-owned default ACLs on schema public grant nothing to the
-- API roles (the root cause of the drift — new tables must arrive ungranted).
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE n.nspname = 'public'
    AND d.defaclrole = 'postgres'::regrole
    AND EXISTS (
      SELECT 1
      FROM aclexplode(d.defaclacl) a
      JOIN pg_roles r ON r.oid = a.grantee
      WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'public'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: postgres default ACLs in public still grant API roles (%) entries', v_n
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- 1c. Anon table-level grants: only on tables with an anon/public policy, and
-- only SELECT (the products/app_config carve-outs are column-scoped and never
-- appear in relacl).
DO $$
DECLARE
  v_g record;
  v_bad text := '';
BEGIN
  FOR v_g IN
    SELECT c.relname, a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') AND r.rolname = 'anon'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = v_g.relname
        AND p.roles::text ~ 'anon|public'
    ) THEN
      v_bad := v_bad || format(' %s(no-anon-policy:%s)', v_g.relname, v_g.privilege_type);
    ELSIF v_g.privilege_type <> 'SELECT' THEN
      v_bad := v_bad || format(' %s(non-SELECT:%s)', v_g.relname, v_g.privilege_type);
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'FAIL: anon grant surface violates the policy doctrine:%', v_bad
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- 1d. TRUNCATE is not held by any browser-reachable role on any public table
-- (RLS does not gate TRUNCATE — proven bypass).
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND (has_table_privilege('anon', c.oid, 'TRUNCATE')
         OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: anon/authenticated hold TRUNCATE on % public tables', v_n
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- 1e. Targeted posture asserts.
DO $$
BEGIN
  -- app_config: function-only for the API roles; service_role keeps the
  -- column-scoped read the signup edge function needs.
  IF has_table_privilege('anon', 'public.app_config', 'SELECT')
     OR has_table_privilege('authenticated', 'public.app_config', 'SELECT')
     OR has_table_privilege('service_role', 'public.app_config', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: table-wide app_config SELECT reappeared' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.app_config', 'key', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.app_config', 'value', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: service_role lost the app_config (key, value) read' USING ERRCODE = 'P0001';
  END IF;

  -- products: catalog columns readable, cost_price/provenance stay excluded.
  IF has_table_privilege('anon', 'public.products', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon regained table-wide products SELECT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_column_privilege('anon', 'public.products', 'name', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon lost the products catalog read' USING ERRCODE = 'P0001';
  END IF;
  IF has_column_privilege('anon', 'public.products', 'cost_price', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can read products.cost_price' USING ERRCODE = 'P0001';
  END IF;

  -- invoice_settings: branding columns only.
  IF has_table_privilege('anon', 'public.invoice_settings', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon regained table-wide invoice_settings SELECT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_column_privilege('anon', 'public.invoice_settings', 'business_name', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon lost the invoice_settings branding read' USING ERRCODE = 'P0001';
  END IF;

  -- The nine formerly-exposed tables.
  IF NOT has_table_privilege('authenticated', 'public.courier_shipments', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated lost courier_shipments read' USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public.courier_shipments', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can read courier_shipments' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.product_locations', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.product_locations', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.product_locations', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.product_locations', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL: authenticated lost product_locations DML' USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public.product_locations', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can read product_locations' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.payment_providers', 'SELECT')
     OR has_table_privilege('anon', 'public.payment_providers', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: payment_providers read surface wrong' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_table_privilege('anon', 'public.courier_providers', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.courier_providers', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: courier_providers public read lost' USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public.sync_queue', 'SELECT')
     OR has_table_privilege('authenticated', 'public.sync_queue', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.sync_queue', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: sync_queue surface wrong' USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public.webhook_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.webhook_events', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.webhook_events', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: webhook_events surface wrong' USING ERRCODE = 'P0001';
  END IF;

  -- Views.
  IF NOT has_table_privilege('authenticated', 'public.sync_health', 'SELECT')
     OR has_table_privilege('anon', 'public.sync_health', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: sync_health surface wrong' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.pathao_integrations_safe', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.stores_safe', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated lost the _safe views' USING ERRCODE = 'P0001';
  END IF;

  -- Sequences: service_role keeps the signup sequence; anon gets nothing.
  IF NOT has_sequence_privilege('service_role', 'public.signup_events_id_seq', 'USAGE')
     OR has_sequence_privilege('anon', 'public.signup_events_id_seq', 'USAGE') THEN
    RAISE EXCEPTION 'FAIL: signup_events_id_seq surface wrong' USING ERRCODE = 'P0001';
  END IF;

  -- Functions: the app RPC surface survives; the internals do not.
  IF NOT has_function_privilege('anon', 'public.is_signup_open()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_signup_open()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.is_signup_open()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: is_signup_open() EXECUTE surface wrong' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.generate_pos_order_number(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated lost generate_pos_order_number' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.claim_sync_queue_batch(int)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_sync_queue_batch(int)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_sync_queue_batch(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: claim_sync_queue_batch surface wrong' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- 1f. The three new policies exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'courier_providers'
                   AND policyname = 'Anyone can read courier providers') THEN
    RAISE EXCEPTION 'FAIL: courier_providers public-read policy missing' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'payment_providers'
                   AND policyname = 'Authenticated can read payment providers') THEN
    RAISE EXCEPTION 'FAIL: payment_providers read policy missing' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'courier_shipments'
                   AND policyname = 'Account members can read courier_shipments') THEN
    RAISE EXCEPTION 'FAIL: courier_shipments member policy missing' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Part 2 — behaviour
-- ---------------------------------------------------------------------------

-- Fixture: brand → store (linked via brands.woo_store_id) → order → shipment,
-- all inside BIZ_A so OWNER_A (…001) resolves user_can_access_store.
DO $$
DECLARE
  v_brand uuid;
  v_store uuid;
  v_order uuid;
  v_integration uuid;
BEGIN
  INSERT INTO public.brands (name, slug, business_id)
  VALUES ('RLS Hardening Brand', 'rls-hardening-brand',
          '11111111-0000-0000-0000-000000000001')
  RETURNING id INTO v_brand;

  INSERT INTO public.stores (name, url, status)
  VALUES ('RLS Hardening Store', 'https://rls-hardening.example.com', 'connected')
  RETURNING id INTO v_store;

  UPDATE public.brands SET woo_store_id = v_store WHERE id = v_brand;

  INSERT INTO public.courier_providers (code, name, is_active)
  VALUES ('hardening-test', 'RLS Hardening Provider', true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO public.courier_integrations (provider, store_id, credentials, is_active)
  VALUES ('hardening-test', v_store, '{}'::jsonb, true)
  RETURNING id INTO v_integration;

  INSERT INTO public.orders (id, store_id, order_number)
  VALUES (gen_random_uuid(), v_store, 'HARDENING-1')
  RETURNING id INTO v_order;

  INSERT INTO public.courier_shipments (order_id, provider, integration_id, consignment_id)
  VALUES (v_order, 'hardening-test', v_integration, 'HARDENING-CS-1');
END $$;

-- 2a. Shape A — anon denials on the previously-readable surface, including the
-- TRUNCATE bypass that motivated the grant revocations.
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.sync_queue;
    RAISE EXCEPTION 'FAIL: anon read sync_queue' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.product_locations;
    RAISE EXCEPTION 'FAIL: anon read product_locations' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.courier_shipments;
    RAISE EXCEPTION 'FAIL: anon read courier_shipments' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.payment_providers (code, name) VALUES ('anon-probe', 'x');
    RAISE EXCEPTION 'FAIL: anon inserted payment_providers' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.orders;
    RAISE EXCEPTION 'FAIL: anon TRUNCATEd orders (RLS does not gate TRUNCATE)' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 2b. Owner positive control: OWNER_A reads the shipment of an order in a
-- store of their active business.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  SELECT count(*) INTO v_rc
  FROM public.courier_shipments WHERE consignment_id = 'HARDENING-CS-1';
  IF v_rc <> 1 THEN
    RAISE EXCEPTION 'FAIL: owner cannot read own-brand shipment (rowcount %)', v_rc
      USING ERRCODE = 'P0001';
  END IF;
  -- policy-active smoke: product_locations reads must not error for a member.
  PERFORM count(*) FROM public.product_locations;
END $$;

-- 2c. Outsider invisibility (Shape A′): OUTSIDER (…007) sees nothing. Mutation
-- is denied at the GRANT layer — the hardening doctrine grants only what
-- policies imply, and courier_shipments has no client UPDATE policy (edge
-- functions write it with the service key), so the UPDATE denial is
-- insufficient_privilege, not a filtered rowcount.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  SELECT count(*) INTO v_rc
  FROM public.courier_shipments WHERE consignment_id = 'HARDENING-CS-1';
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: outsider read a foreign shipment (rowcount %)', v_rc
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.courier_shipments SET raw_status = 'tampered'
    WHERE consignment_id = 'HARDENING-CS-1';
    RAISE EXCEPTION 'FAIL: outsider mutated a foreign shipment' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Owner-side survival check: the outsider's no-op UPDATE left the row intact.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.courier_shipments
                 WHERE consignment_id = 'HARDENING-CS-1'
                   AND (raw_status IS NULL OR raw_status <> 'tampered')) THEN
    RAISE EXCEPTION 'FAIL: shipment survival after outsider UPDATE' USING ERRCODE = 'P0001';
  END IF;
END $$;

ROLLBACK;
