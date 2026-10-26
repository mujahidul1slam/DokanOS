-- Fresh-project Data API privilege floor: every RLS policy must be reachable.
--
-- Background (measured on a freshly reset project): policies in pg_policies do
-- not imply table DML privileges. New Supabase projects give the Data API
-- roles no default grants, so a table can have a perfectly scoped policy and
-- still answer 401/403 before RLS runs — the gap
-- 20261026140000_explicit_api_table_grants.sql closes. Older projects masked
-- this with accumulated implicit default grants, so only fresh deployments
-- and this battery ever see it.
--
-- Contract asserted here: for every policy in schema public that addresses
-- anon or authenticated (including TO PUBLIC, which covers both), the policy's
-- role holds at least the table privileges the policy's cmd implements —
-- SELECT for FOR SELECT, each of SELECT/INSERT/UPDATE/DELETE for FOR ALL, the
-- matching single operation otherwise. service_role, which bypasses RLS but
-- not table privileges, must be able to read the core operational tables.
--
-- Deliberate exception (20260620172022 "prevent anon from reading
-- cost_price"): anon reads public.products through column-level grants, not a
-- table-level grant. The generic rule below therefore checks anon/products
-- SELECT at column level instead — and pins the carve-out: if anyone ever
-- grants table-level SELECT there, cost_price becomes public and this test
-- fails.

DO $$
DECLARE
  v_policy record;
  v_role text;
  v_op text;
  v_required text[];
  v_gaps text := '';
BEGIN
  FOR v_policy IN
    SELECT p.tablename AS table_name,
           p.policyname AS policy_name,
           lower(r.role_name) AS policy_role,
           p.cmd AS policy_cmd
    FROM pg_policies p
    CROSS JOIN LATERAL unnest(p.roles) AS r(role_name)
    WHERE p.schemaname = 'public'
    ORDER BY p.tablename, p.policyname
  LOOP
    FOREACH v_role IN ARRAY CASE WHEN v_policy.policy_role = 'public'
                                 THEN ARRAY['anon', 'authenticated']
                                 ELSE ARRAY[v_policy.policy_role] END
    LOOP
      IF v_role NOT IN ('anon', 'authenticated') THEN
        CONTINUE; -- owner/definer-only policies (TO postgres, …) are not API surface
      END IF;
      v_required := CASE v_policy.policy_cmd
                      WHEN 'ALL' THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
                      ELSE ARRAY[v_policy.policy_cmd]
                    END;
      FOREACH v_op IN ARRAY v_required
      LOOP
        -- products/anon SELECT is column-scoped on purpose; block 2 owns it.
        IF v_policy.table_name = 'products' AND v_role = 'anon' AND v_op = 'SELECT' THEN
          CONTINUE;
        END IF;
        -- app_config is function-only by design (20261022120000 routes access
        -- through is_signup_open()); signup_config_accessor_test.sql owns the
        -- zero-grant assertion for it. Skip it here so policy introspection
        -- never demands a table-wide grant on it.
        IF v_policy.table_name = 'app_config' THEN
          CONTINUE;
        END IF;
        IF NOT has_table_privilege(v_role,
                                   format('%I.%I', 'public', v_policy.table_name),
                                   v_op) THEN
          v_gaps := v_gaps
            || format(E'\n  %s needs %s on public.%s for policy "%s" (%s)',
                      v_role, v_op, v_policy.table_name,
                      v_policy.policy_name, v_policy.policy_cmd);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF v_gaps <> '' THEN
    RAISE EXCEPTION 'FAIL: RLS policies whose role has no table DML privilege:%', v_gaps
      USING ERRCODE = 'P0001';
  END IF;
  -- Pin the app_config carve-out: NO API role may hold table-wide SELECT on it
  -- (private config keys must stay unreadable; only is_signup_open() reads it).
  IF has_table_privilege('anon', 'public.app_config', 'SELECT')
     OR has_table_privilege('authenticated', 'public.app_config', 'SELECT')
     OR has_table_privilege('service_role', 'public.app_config', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: some role holds table-wide app_config SELECT (20261022120000 function-only contract lost)'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- products/anon: the storefront catalog column set must be readable, and the
-- cost_price carve-out must still hold (a table-level SELECT grant makes
-- has_column_privilege true for cost_price and fails here).
DO $$
DECLARE
  v_column record;
  v_missing text := '';
BEGIN
  FOR v_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
    ORDER BY ordinal_position
  LOOP
    IF v_column.column_name = 'cost_price' THEN
      CONTINUE;
    END IF;
    IF NOT has_column_privilege('anon', 'public.products', v_column.column_name, 'SELECT') THEN
      v_missing := v_missing || ' ' || v_column.column_name;
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'FAIL: anon cannot read public.products columns (storefront catalog breaks):%',
      v_missing USING ERRCODE = 'P0001';
  END IF;
  IF has_column_privilege('anon', 'public.products', 'cost_price', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can read public.products.cost_price (20260620172022 carve-out lost)'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- service_role bypasses RLS but not table privileges; the Edge Functions read
-- these on every order and product path.
DO $$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.orders', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.products', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.order_items', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: service_role lacks SELECT on orders/products/order_items'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- This test is what keeps fresh projects from regressing into 401/403: if a
-- policy is added (or granted) without the matching table DML privilege, the
-- Data API rejects the request before RLS can apply it — and the first place
-- that shows up is a live browser session, not a unit test.
