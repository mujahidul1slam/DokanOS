-- Task 13: the per-business onboarding checklist (spec §6a) plus membership
-- provenance. The checklist is BUSINESS-level: any account member reads;
-- owner/admin/manager write; staff read-only; other businesses see nothing.
-- Provenance half: create_business_with_owner stamps the founder row
-- joined_via='created' — the wizard-eligibility input behind the
-- invited-member bypass (spec §6b). Fixture ids per _harness.md.

BEGIN;

-- Manager …004 writes the checklist in Biz A; PK + status CHECK pinned.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  INSERT INTO public.business_onboarding_steps (business_id, step_key, status)
  VALUES ('11111111-0000-0000-0000-000000000001', 'business_profile', 'completed');

  INSERT INTO public.business_onboarding_steps (business_id, step_key, status)
  VALUES ('11111111-0000-0000-0000-000000000001', 'first_brand', 'skipped');

  -- Re-mark via upsert: the wizard revisits a step and saves it again.
  INSERT INTO public.business_onboarding_steps (business_id, step_key, status)
  VALUES ('11111111-0000-0000-0000-000000000001', 'business_profile', 'skipped')
  ON CONFLICT (business_id, step_key) DO UPDATE SET status = EXCLUDED.status;
  IF (SELECT status FROM public.business_onboarding_steps
      WHERE business_id = '11111111-0000-0000-0000-000000000001'
        AND step_key = 'business_profile') <> 'skipped' THEN
    RAISE EXCEPTION 'FAIL: onboarding re-mark upsert did not land' USING ERRCODE = 'P0001';
  END IF;

  -- PK: a plain duplicate row for the same step is rejected.
  BEGIN
    INSERT INTO public.business_onboarding_steps (business_id, step_key, status)
    VALUES ('11111111-0000-0000-0000-000000000001', 'first_brand', 'completed');
    RAISE EXCEPTION 'FAIL: duplicate onboarding step row accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- status CHECK: only completed|skipped (a step with no row stays open).
  BEGIN
    INSERT INTO public.business_onboarding_steps (business_id, step_key, status)
    VALUES ('11111111-0000-0000-0000-000000000001', 'order_sources', 'bogus');
    RAISE EXCEPTION 'FAIL: invalid onboarding status accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF (SELECT count(*) FROM public.business_onboarding_steps
      WHERE business_id = '11111111-0000-0000-0000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'FAIL: manager could not read own-account onboarding steps' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

-- Staff …005: reads, cannot write.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  IF (SELECT count(*) FROM public.business_onboarding_steps
      WHERE business_id = '11111111-0000-0000-0000-000000000001') < 2 THEN
    RAISE EXCEPTION 'FAIL: staff could not read own-account onboarding steps' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.business_onboarding_steps (business_id, step_key, status)
    VALUES ('11111111-0000-0000-0000-000000000001', 'order_sources', 'completed');
    RAISE EXCEPTION 'FAIL: staff inserted an onboarding step' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.business_onboarding_steps SET status = 'completed'
    WHERE business_id = '11111111-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: staff updated % onboarding step rows', v_rc USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM public.business_onboarding_steps
    WHERE business_id = '11111111-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    IF v_rc <> 0 THEN
      RAISE EXCEPTION 'FAIL: staff deleted % onboarding step rows', v_rc USING ERRCODE = 'P0001';
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
  IF EXISTS (SELECT 1 FROM public.business_onboarding_steps
             WHERE business_id = '11111111-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: outsider saw another account''s onboarding steps' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.business_onboarding_steps (business_id, step_key, status)
    VALUES ('11111111-0000-0000-0000-000000000001', 'order_sources', 'completed');
    RAISE EXCEPTION 'FAIL: outsider inserted an onboarding step' USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- OWNER_B …006: cross-business operator denied.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_onboarding_steps
             WHERE business_id = '11111111-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: cross-business operator saw foreign onboarding steps' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.business_onboarding_steps (business_id, step_key, status)
    VALUES ('11111111-0000-0000-0000-000000000001', 'order_sources', 'completed');
    RAISE EXCEPTION 'FAIL: cross-business operator inserted a foreign onboarding step'
      USING ERRCODE = 'P0001';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Owner-side value-pinned survival (Shape A′ half): the denied writes above
-- left the manager's rows exactly as saved.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.business_onboarding_steps
                 WHERE business_id = '11111111-0000-0000-0000-000000000001'
                   AND step_key = 'business_profile' AND status = 'skipped')
     OR NOT EXISTS (SELECT 1 FROM public.business_onboarding_steps
                    WHERE business_id = '11111111-0000-0000-0000-000000000001'
                      AND step_key = 'first_brand' AND status = 'skipped') THEN
    RAISE EXCEPTION 'FAIL: manager-saved onboarding marks did not survive' USING ERRCODE = 'P0001';
  END IF;
  -- Residue of the DENIED writes above can only land in the fixture business;
  -- scope the check accordingly. (A table-wide scan would false-positive on a
  -- long-lived dev DB where real businesses legitimately hold 'order_sources'
  -- step rows — dirty-DB safety, same semantics.)
  IF EXISTS (SELECT 1 FROM public.business_onboarding_steps
             WHERE business_id = '11111111-0000-0000-0000-000000000001'
               AND step_key = 'order_sources') THEN
    RAISE EXCEPTION 'FAIL: denied writes left residue' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- Provenance: the founder row created by create_business_with_owner records
-- joined_via='created' — the eligibility input for the wizard offer (the
-- invited-member bypass lives in src/features/onboarding/eligibility.ts).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE v_biz uuid;
BEGIN
  SELECT id INTO v_biz FROM public.create_business_with_owner('Onboarding Probe', 'onboarding-probe');
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                 WHERE business_id = v_biz
                   AND user_id = '00000000-0000-0000-0000-00000000000a'
                   AND role = 'owner'
                   AND joined_via = 'created') THEN
    RAISE EXCEPTION 'FAIL: founder membership is not marked joined_via=created' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.businesses WHERE id = v_biz;
END $$;
RESET ROLE;

-- Provenance visibility: a member can read their own membership's provenance
-- (the wizard's eligibility query is an ordinary own-row read).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                 WHERE user_id = '00000000-0000-0000-0000-000000000004'
                   AND business_id = '11111111-0000-0000-0000-000000000001'
                   AND joined_via IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: member cannot read own membership provenance' USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
