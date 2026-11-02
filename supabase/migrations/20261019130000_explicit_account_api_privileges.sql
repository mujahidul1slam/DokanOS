-- New local/cloud Supabase projects no longer give Data API roles default
-- table DML privileges. Enable only the operations covered by these existing
-- RLS policies; do not restore blanket defaults or grant anon/service_role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses,
  public.user_business_access, public.app_settings TO authenticated;

-- Profiles formerly had an authenticated SELECT USING (true) policy. Do not
-- expose every person's profile when making profile reads explicit. Preserve
-- own-profile, same-business directory, and existing platform-admin access.
CREATE OR REPLACE FUNCTION public.can_read_profile(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = _user_id
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_business_access mine
      JOIN public.user_business_access theirs ON theirs.business_id = mine.business_id
      WHERE mine.user_id = auth.uid() AND theirs.user_id = _user_id
    );
$$;
REVOKE ALL ON FUNCTION public.can_read_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_profile(uuid) TO authenticated;

DROP POLICY "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view own and shared business profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.can_read_profile(user_id));

-- Preserve ProfileSettingsTab's own-profile insert fallback for legacy users
-- missing a profile. Existing INSERT/UPDATE policies restrict both to auth.uid().
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
