-- Task 2 (domain revamp, spec §5): the personal default business account.
--
-- The default controls post-login landing only. Quick-create and search keep
-- following the business the user is currently in. A default that was removed
-- or whose membership was lost is ignored by the client, which falls back to
-- the sole or first remaining business, so ON DELETE SET NULL keeps the row
-- valid without a cleanup job.
--
-- No policy or grant change: profiles already allows authenticated users to
-- read shared-business profiles and to insert or update only their own row
-- (20261019130000_explicit_account_api_privileges.sql).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_business_id uuid
    REFERENCES public.businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_default_business_id_idx
  ON public.profiles (default_business_id);
