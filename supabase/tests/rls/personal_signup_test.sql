-- Run by scripts/run-rls-tests.mjs against a local migrated Supabase only.
-- Registration/verification/recovery must not consume pending invitations.
BEGIN;

DO $$
DECLARE
  person_id uuid := '99999999-0000-0000-0000-000000000009';
  account_count bigint;
  brand_count bigint;
  store_count bigint;
  storefront_count bigint;
BEGIN
  SELECT count(*) INTO account_count FROM public.businesses;
  SELECT count(*) INTO brand_count FROM public.brands;
  SELECT count(*) INTO store_count FROM public.stores;
  SELECT count(*) INTO storefront_count FROM public.storefronts;

  INSERT INTO public.invitations (email, role, invited_by)
  VALUES ('personal-signup-fixture@dokanos.test', 'admin', '00000000-0000-0000-0000-00000000000a');

  -- Client metadata is untrusted: even a matching pending admin invitation
  -- must not grant a role or membership when an auth identity is inserted.
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  VALUES (person_id, 'personal-signup-fixture@dokanos.test',
    '{"full_name":"Personal Signup Fixture","signup_intent":"personal","role":"admin"}', now(), now());

  UPDATE auth.users SET email_confirmed_at = now() WHERE id = person_id;
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = person_id;
  UPDATE auth.users SET encrypted_password = 'local-recovery-fixture' WHERE id = person_id;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = person_id AND full_name = 'Personal Signup Fixture') THEN
    RAISE EXCEPTION 'Personal registration must create a profile';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = person_id)
     OR EXISTS (SELECT 1 FROM public.user_business_access WHERE user_id = person_id)
     OR EXISTS (SELECT 1 FROM public.user_store_access WHERE user_id = person_id) THEN
    RAISE EXCEPTION 'Authentication must not grant business or platform access';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invitations WHERE email = 'personal-signup-fixture@dokanos.test' AND accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Authentication must not accept an invitation';
  END IF;
  IF account_count <> (SELECT count(*) FROM public.businesses)
     OR brand_count <> (SELECT count(*) FROM public.brands)
     OR store_count <> (SELECT count(*) FROM public.stores)
     OR storefront_count <> (SELECT count(*) FROM public.storefronts) THEN
    RAISE EXCEPTION 'Personal signup/verification/recovery must preserve business resources';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000009","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000009', true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access)
     OR EXISTS (SELECT 1 FROM public.businesses) THEN
    RAISE EXCEPTION 'A verified nonmember must not read another account or membership';
  END IF;
END;
$$;

ROLLBACK;
