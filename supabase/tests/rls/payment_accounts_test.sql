-- Task 10: payment accounts are BUSINESS-level (spec §4) — one account per
-- business (bKash, Nagad, Stripe, card), never per brand. Members read;
-- owner/admin/member write; viewers read-only; other businesses see nothing.
-- UQ(business_id, name) covered. The per-source accepted-payment-methods
-- column is shape-checked (known codes only, array). Fixture ids per
-- _harness.md. One transaction, rolled back at the end.

BEGIN;

-- Member …004 creates the brand, accounts; UQ; update; method toggles.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE
  v_id uuid;
  v_src uuid;
BEGIN
  INSERT INTO public.brands (id, business_id, name, slug)
  VALUES ('11111111-0000-0000-0000-0000000000f2', '11111111-0000-0000-0000-000000000001',
          'Task10 Brand', 'task10-brand');

  INSERT INTO public.payment_accounts (business_id, provider, name, credentials)
  VALUES ('11111111-0000-0000-0000-000000000001', 'bkash', 'Main bKash',
          '{"app_key":"ak_test"}'::jsonb)
  RETURNING id INTO v_id;

  INSERT INTO public.payment_accounts (business_id, provider, name)
  VALUES ('11111111-0000-0000-0000-000000000001', 'stripe', 'Stripe Acct');

  BEGIN
    INSERT INTO public.payment_accounts (business_id, provider, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'nagad', 'Main bKash');
    RAISE EXCEPTION 'FAIL: duplicate business+name payment account accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  UPDATE public.payment_accounts
  SET name = 'Main bKash v2', credentials = '{"app_key":"ak_rotated"}'::jsonb
  WHERE id = v_id;
  IF NOT EXISTS (SELECT 1 FROM public.payment_accounts
                 WHERE id = v_id AND name = 'Main bKash v2'
                   AND credentials->>'app_key' = 'ak_rotated') THEN
    RAISE EXCEPTION 'FAIL: member could not update own-account payment account' USING ERRCODE = 'P0001';
  END IF;

  -- Per-source accepted payment methods (spec §4): known codes only.
  INSERT INTO public.order_sources (brand_id, name, type)
  VALUES ('11111111-0000-0000-0000-0000000000f2', 'Task10 Showroom', 'showroom')
  RETURNING id INTO v_src;

  IF NOT EXISTS (SELECT 1 FROM public.order_sources
                 WHERE id = v_src AND accepted_payment_methods = '["cod","cash"]'::jsonb) THEN
    RAISE EXCEPTION 'FAIL: accepted_payment_methods default was not ["cod","cash"]' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.order_sources SET accepted_payment_methods = '["cod","bkash","card"]'::jsonb
  WHERE id = v_src;
  IF NOT EXISTS (SELECT 1 FROM public.order_sources
                 WHERE id = v_src AND accepted_payment_methods = '["cod","bkash","card"]'::jsonb) THEN
    RAISE EXCEPTION 'FAIL: member could not toggle accepted payment methods' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.order_sources SET accepted_payment_methods = '["cod","bitcoin"]'::jsonb
    WHERE id = v_src;
    RAISE EXCEPTION 'FAIL: unknown payment method code accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.order_sources SET accepted_payment_methods = '"cod"'::jsonb
    WHERE id = v_src;
    RAISE EXCEPTION 'FAIL: non-array accepted_payment_methods accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

-- Viewer …005: reads, cannot write.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.payment_accounts
      WHERE business_id = '11111111-0000-0000-0000-000000000001') < 2 THEN
    RAISE EXCEPTION 'FAIL: viewer could not read own-account payment accounts' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.payment_accounts (business_id, provider, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'card', 'Viewer Card');
    RAISE EXCEPTION 'FAIL: viewer inserted a payment account' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.payment_accounts SET is_active = false
    WHERE business_id = '11111111-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: viewer updated % payment account rows', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM public.payment_accounts
    WHERE business_id = '11111111-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: viewer deleted % payment account rows', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- OUTSIDER …007: no visibility, no writes.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_accounts
             WHERE business_id = '11111111-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: outsider saw another account''s payment accounts' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.payment_accounts (business_id, provider, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'card', 'Outsider Card');
    RAISE EXCEPTION 'FAIL: outsider inserted a payment account' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- OWNER_B …006: cross-business operator denied.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_accounts
             WHERE business_id = '11111111-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: cross-business operator saw foreign payment accounts' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.payment_accounts (business_id, provider, name)
    VALUES ('11111111-0000-0000-0000-000000000001', 'card', 'Cross Biz Card');
    RAISE EXCEPTION 'FAIL: cross-business operator inserted a foreign payment account'
      USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Owner-side value-pinned survival.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payment_accounts
                 WHERE name = 'Main bKash v2'
                   AND credentials->>'app_key' = 'ak_rotated') THEN
    RAISE EXCEPTION 'FAIL: member-updated payment account did not survive' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_accounts
             WHERE name IN ('Viewer Card', 'Outsider Card', 'Cross Biz Card')) THEN
    RAISE EXCEPTION 'FAIL: denied writes left residue' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_sources
                 WHERE name = 'Task10 Showroom'
                   AND accepted_payment_methods = '["cod","bkash","card"]'::jsonb) THEN
    RAISE EXCEPTION 'FAIL: accepted-methods toggle did not survive' USING ERRCODE = 'P0001';
  END IF;
END $$;

ROLLBACK;
