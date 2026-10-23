-- The signup functions write audit and rate-limit rows as service_role.
-- This test asserts the minimum service-role surface and no broader client grants.
BEGIN;

DO $$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.signup_events', 'INSERT') THEN
    RAISE EXCEPTION 'service_role cannot insert signup_events';
  END IF;
  IF NOT has_sequence_privilege('service_role', 'public.signup_events_id_seq', 'USAGE') THEN
    RAISE EXCEPTION 'service_role cannot use the signup_events identity sequence';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.rate_limit_hits', 'SELECT') THEN
    RAISE EXCEPTION 'service_role cannot read rate_limit_hits';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.rate_limit_hits', 'INSERT') THEN
    RAISE EXCEPTION 'service_role cannot insert rate_limit_hits';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.rate_limit_hits', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role cannot update rate_limit_hits';
  END IF;

  IF has_table_privilege('anon', 'public.signup_events', 'INSERT') THEN
    RAISE EXCEPTION 'anon can insert signup_events';
  END IF;
  IF has_table_privilege('authenticated', 'public.signup_events', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated can insert signup_events';
  END IF;
  IF has_table_privilege('anon', 'public.rate_limit_hits', 'SELECT') THEN
    RAISE EXCEPTION 'anon can read rate_limit_hits';
  END IF;
  IF has_table_privilege('authenticated', 'public.rate_limit_hits', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can update rate_limit_hits';
  END IF;
  IF has_table_privilege('service_role', 'public.app_config', 'SELECT') THEN
    RAISE EXCEPTION 'service_role has table-wide app_config SELECT';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_count integer;
BEGIN
  -- The Edge Function checks the insert error only; it does not request rows.
  INSERT INTO public.signup_events(email, event)
  VALUES ('grant-test@example.invalid', 'signup_started');

  INSERT INTO public.rate_limit_hits(key, bucket, count)
  VALUES ('signup_grant_test', '2026-10-23T00:00:00Z', 1)
  ON CONFLICT (key, bucket) DO UPDATE SET count = EXCLUDED.count + 1;

  SELECT count INTO v_count
  FROM public.rate_limit_hits
  WHERE key = 'signup_grant_test';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'service_role rate_limit_hits upsert/read failed';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.signup_events(email, event)
    VALUES ('grant-test@example.invalid', 'signup_started');
    RAISE EXCEPTION 'anon inserted signup_events';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.rate_limit_hits(key, bucket, count)
    VALUES ('signup_grant_test', '2026-10-23T00:00:00Z', 1);
    RAISE EXCEPTION 'anon inserted rate_limit_hits';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.signup_events(email, event)
    VALUES ('grant-test@example.invalid', 'signup_started');
    RAISE EXCEPTION 'authenticated inserted signup_events';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

ROLLBACK;
