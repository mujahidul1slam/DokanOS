-- The public signup accessor must reveal only the signup kill switch.
BEGIN;
INSERT INTO public.app_config(key, value)
VALUES ('signup_config_private_probe', to_jsonb('private'::text))
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.is_signup_open()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon cannot read the public signup flag';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.is_signup_open()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot read the public signup flag';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.is_signup_open()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot read the public signup flag';
  END IF;
  IF has_table_privilege('anon', 'public.app_config', 'SELECT') THEN
    RAISE EXCEPTION 'anon has table-wide app_config SELECT';
  END IF;
  IF has_table_privilege('authenticated', 'public.app_config', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated has table-wide app_config SELECT';
  END IF;
  IF has_table_privilege('service_role', 'public.app_config', 'SELECT') THEN
    RAISE EXCEPTION 'service_role has table-wide app_config SELECT';
  END IF;
  IF public.is_signup_open() IS DISTINCT FROM coalesce(
    (SELECT value IN ('true'::jsonb, '"true"'::jsonb)
       FROM public.app_config WHERE key = 'signup_open'), false
  ) THEN
    RAISE EXCEPTION 'signup accessor does not reflect the configured flag';
  END IF;
END;
$$;

SET LOCAL ROLE anon;
DO $$
DECLARE
  v_flag boolean;
  v_private text;
  v_denied boolean := false;
BEGIN
  BEGIN
    SELECT value::text INTO v_private
    FROM public.app_config WHERE key = 'signup_config_private_probe';
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied AND v_private IS NOT NULL THEN
    RAISE EXCEPTION 'anon can read the private app_config sentinel';
  END IF;

  SELECT public.is_signup_open() INTO v_flag;
  IF v_flag IS NULL THEN
    RAISE EXCEPTION 'anon accessor did not return a boolean signup state';
  END IF;
END;
$$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_private text;
  v_denied boolean := false;
BEGIN
  BEGIN
    SELECT value::text INTO v_private
    FROM public.app_config WHERE key = 'signup_config_private_probe';
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied AND v_private IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated can read the private app_config sentinel';
  END IF;
  PERFORM public.is_signup_open();
END;
$$;
ROLLBACK;
