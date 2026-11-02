-- ============================================================================
-- Post-deploy backend verification — paste into Supabase Dashboard > SQL Editor
-- after `supabase db push` completes. Run each block separately.
-- ============================================================================

-- 1. The new policies exist (expect 9 rows: 3 on businesses, 3 on
--    user_business_access, 2 on app_settings + unchanged select/delete)
select tablename, policyname, cmd
from pg_policies
where tablename in ('businesses', 'user_business_access', 'app_settings')
order by tablename, policyname;

-- 2. Realtime publication membership (expect exactly 1 row)
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'user_business_access';

-- 3. New helpers + RPCs exist (expect 7 rows)
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'create_business_with_owner', 'get_member_access', 'set_member_business_role',
    'get_my_managed_businesses', 'can_manage_business_access',
    'my_business_role', 'business_has_other_owner'
  );

-- 4. Immutable-identity trigger on user_business_access (expect trg_uba_immutable)
select tgname
from pg_trigger
where tgrelid = 'public.user_business_access'::regclass and not tgisinternal;

-- 5. Old policies are gone (expect ZERO rows)
select tablename, policyname
from pg_policies
where (tablename = 'user_business_access' and policyname = 'Users can write own access')
   or (tablename = 'businesses' and policyname = 'Members can write businesses')
   or (tablename = 'app_settings' and policyname like 'Staff and admin can %app_settings');

-- 6. Hosted-parity calibration — record the outcome in supabase/tests/rls/_harness.md
--    Pick a real business id first:
select id, name from businesses limit 1;
--    Then run as a simulated non-member (expect: no error + 0 rows updated = silent-skip
--    world; or 42501 = error world — BOTH are fine, note which):
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}';
UPDATE public.businesses SET name = name WHERE id = '<PASTE_REAL_BIZ_ID_HERE>';
ROLLBACK;