-- The public signup accessor must reveal only the signup kill switch.
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.is_signup_open()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon cannot read the public signup flag';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.is_signup_open()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot read the public signup flag';
  END IF;
  IF has_table_privilege('anon', 'public.app_config', 'SELECT') THEN
    RAISE EXCEPTION 'anon has table-wide app_config SELECT';
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

BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.app_config) <> 0 THEN
    RAISE EXCEPTION 'anon can read private app_config rows';
  END IF;
  PERFORM public.is_signup_open();
END;
$$;
ROLLBACK;
