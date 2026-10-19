-- Issue #9: creating an authentication identity creates a personal profile only.
-- In particular, untrusted metadata and matching invitation emails are not an
-- authorized acceptance. Existing roles, memberships, invitations and business
-- resources are deliberately left unchanged. Apply only after deployment approval.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''), NEW.email)
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Personal profile only. Business/platform grants and invitation acceptance require separate authorized operations.';
