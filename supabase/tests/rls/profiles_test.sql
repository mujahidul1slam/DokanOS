-- Shared business membership is the boundary for directory reads, not login alone.
BEGIN;
-- Legacy identities may be missing a profile; the settings form can repair
-- only its caller's profile using the existing self-insert policy.
DELETE FROM public.profiles WHERE user_id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
INSERT INTO public.profiles (user_id, full_name)
  VALUES ('00000000-0000-0000-0000-000000000004', 'Repaired legacy profile');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'A member must see their own and shared-business profiles';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id IN (
    '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000007')) THEN
    RAISE EXCEPTION 'A member must not see another business or nonmember profile';
  END IF;
  UPDATE public.profiles SET full_name = 'Unauthorized'
    WHERE user_id = '00000000-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'Shared directory access must not allow editing another profile';
  END IF;
END $$;
ROLLBACK;
