-- Task 3 (domain revamp, spec §5/§6b): post-verification personal profile setup.
--
-- profile_setup_completed_at records that the person completed or skipped the
-- one-time "Set up your profile" step. NULL means the step is still owed.
--
-- Backfill decision: every profile that exists before this migration was created
-- before the setup step existed. Those people must not be pushed through it, so
-- they are marked as already done. Only accounts created after this migration
-- (new profile rows) start with the step owed.
--
-- phone is optional and holds a normalized Bangladeshi mobile number, validated
-- by the client (src/lib/accounts/profileSetup.ts). No policy change: a user can
-- still write only their own row (existing "Users can update own profile").

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS profile_setup_completed_at timestamptz;

UPDATE public.profiles
   SET profile_setup_completed_at = now()
 WHERE profile_setup_completed_at IS NULL;

-- Rows created after this migration are left NULL by handle_new_user, so the step
-- is owed to them. The column has no default on purpose: "owed" is the absence of
-- a completion time, which keeps the gate to one explicit field.
COMMENT ON COLUMN public.profiles.profile_setup_completed_at IS
  'Set when the one-time profile setup is completed or skipped. NULL means still owed.';
