DROP POLICY IF EXISTS "Users can view their own invitation" ON public.invitations;

CREATE POLICY "Users can view their own invitation"
ON public.invitations
FOR SELECT
TO authenticated
USING (
  email = (auth.jwt() ->> 'email')
);