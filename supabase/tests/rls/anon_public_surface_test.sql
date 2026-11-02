-- Fresh-project anon surface contract (issue #16 follow-up).
-- Guards the two parity fixes in 20261026150000_fix_anon_public_surface.sql:
--  1) the anon storefronts read must never require EXECUTE on
--     user_can_access_store (SQL OR is not guaranteed to short-circuit), and
--  2) invoice_settings branding columns are readable at the privilege layer
--     while every settings column and every row stays closed to anon.

DO $$
DECLARE
BEGIN
  -- 1) anon must be able to read active storefronts without function EXECUTE.
  IF has_function_privilege('anon', 'public.user_can_access_store(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute user_can_access_store (policy qual contract broken)'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_table_privilege('anon', 'public.storefronts', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon lacks storefronts SELECT (public storefront breaks)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2) invoice_settings: branding columns granted, everything else denied.
  IF NOT has_column_privilege('anon', 'public.invoice_settings', 'business_name', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.invoice_settings', 'logo_url', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.invoice_settings', 'tagline', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon cannot read invoice_settings branding columns (boot probe 401s)'
      USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public.invoice_settings', 'SELECT')
     OR has_column_privilege('anon', 'public.invoice_settings', 'measurement_slip_template', 'SELECT')
     OR has_column_privilege('anon', 'public.invoice_settings', 'shipping_inside_dhaka', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can read invoice_settings beyond branding columns'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Behavioural half: as anon, the branding probe returns [] (not an error) and
-- the storefronts read is safe even when an INACTIVE row exists (the case that
-- used to evaluate the forbidden function call).
BEGIN;
INSERT INTO public.storefronts (slug, name, is_active)
VALUES ('rls-anon-probe', 'RLS Anon Probe', false);
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
DO $$
DECLARE
  v_count integer;
BEGIN
  -- Inactive row must stay invisible to anon...
  SELECT count(*) INTO v_count FROM public.storefronts WHERE slug = 'rls-anon-probe';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: anon sees an inactive storefront' USING ERRCODE = 'P0001';
  END IF;
  -- ...and scanning the table (which evaluates the policy qual incl. the
  -- inactive row) must not raise 42501 for the missing function privilege.
  SELECT count(*) INTO v_count FROM public.storefronts;
  IF v_count < 0 THEN
    RAISE EXCEPTION 'FAIL: unreachable' USING ERRCODE = 'P0001';
  END IF;
  -- Branding probe must return without error; rows stay hidden by RLS.
  SELECT count(*) INTO v_count FROM public.invoice_settings;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: anon can see invoice_settings rows' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;
