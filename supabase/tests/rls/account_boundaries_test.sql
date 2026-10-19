-- Issue #10: real database authorization at the business-account boundary.
-- Fixtures from scripts/run-rls-tests.mjs:
-- OWNER_A ...001, MEMBER_A ...004, OWNER_B ...006, OUTSIDER ...007,
-- legacy global STAFF ...00b; BIZ_A ...001, BIZ_B ...002.

BEGIN;

INSERT INTO public.stores (id, name, url)
VALUES
  ('33333333-0000-0000-0000-000000000001', 'Store A', 'https://a.test'),
  ('33333333-0000-0000-0000-000000000002', 'Store B', 'https://b.test');
INSERT INTO public.brands (id, business_id, name, slug, woo_store_id)
VALUES
  ('44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Brand A', 'issue-10-brand-a', '33333333-0000-0000-0000-000000000001'),
  ('44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'Brand B', 'issue-10-brand-b', '33333333-0000-0000-0000-000000000002');
INSERT INTO public.products (id, store_id, name)
VALUES
  ('55555555-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'Product A'),
  ('55555555-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002', 'Product B');

-- A legacy global role is not a tenant membership and grants no account data.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.products WHERE id IN (
    '55555555-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002'
  )) <> 0 THEN
    RAISE EXCEPTION 'FAIL: global role bypassed operational account isolation' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- A member has account-wide operational access only inside their account.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.products WHERE id = '55555555-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'FAIL: member cannot read own-account operations' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.products WHERE id = '55555555-0000-0000-0000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'FAIL: member read another account product' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.products SET price = 12 WHERE id = '55555555-0000-0000-0000-000000000001';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: member cannot write own-account operations' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.products (store_id, name)
    VALUES ('33333333-0000-0000-0000-000000000002', 'Forged cross-account product');
    RAISE EXCEPTION 'FAIL: forged cross-account store id accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.businesses WHERE id = '11111111-0000-0000-0000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'FAIL: member read another business account' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- Membership does not confer owner-only account or membership administration.
DO $$
DECLARE affected bigint;
BEGIN
  UPDATE public.businesses SET name = 'Member takeover'
  WHERE id = '11111111-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL: member changed owner-only business settings' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    PERFORM public.set_member_business_role(
      '00000000-0000-0000-0000-000000000007',
      '11111111-0000-0000-0000-000000000001',
      'member'
    );
    RAISE EXCEPTION 'FAIL: member performed owner-only membership administration' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;

-- The service boundary creates an empty account plus exactly one owner row.
BEGIN;
UPDATE auth.users
SET created_at = now() - interval '30 days'
WHERE id = '00000000-0000-0000-0000-000000000007';
SET LOCAL ROLE service_role;
SELECT public.create_additional_business(
  '00000000-0000-0000-0000-000000000007',
  'Issue 10 Empty Account'
);
SELECT public.create_additional_business(
  '00000000-0000-0000-0000-000000000001',
  'Issue 10 Additional Account'
);
RESET ROLE;
DO $$
DECLARE
  new_business uuid;
  additional_business uuid;
BEGIN
  SELECT business.id INTO new_business
  FROM public.businesses business
  JOIN public.user_business_access membership ON membership.business_id = business.id
  WHERE membership.user_id = '00000000-0000-0000-0000-000000000007'
    AND business.name = 'Issue 10 Empty Account';
  IF new_business IS NULL THEN
    RAISE EXCEPTION 'FAIL: business creation returned no id' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.user_business_access
      WHERE business_id = new_business
        AND user_id = '00000000-0000-0000-0000-000000000007'
        AND role = 'owner') <> 1 THEN
    RAISE EXCEPTION 'FAIL: creator did not become the sole owner' USING ERRCODE = 'P0001';
  END IF;
  SELECT business.id INTO additional_business
  FROM public.businesses business
  JOIN public.user_business_access membership ON membership.business_id = business.id
  WHERE membership.user_id = '00000000-0000-0000-0000-000000000001'
    AND membership.role = 'owner'
    AND business.name = 'Issue 10 Additional Account';
  IF additional_business IS NULL THEN
    RAISE EXCEPTION 'FAIL: an existing owner could not create an additional account' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brands WHERE business_id = new_business)
     OR EXISTS (SELECT 1 FROM public.brands WHERE business_id = additional_business)
     OR EXISTS (SELECT 1 FROM public.selling_points WHERE business_id = new_business)
     OR EXISTS (SELECT 1 FROM public.selling_points WHERE business_id = additional_business)
     OR EXISTS (SELECT 1 FROM public.stores) THEN
    RAISE EXCEPTION 'FAIL: empty business implicitly created brand/store data' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;
