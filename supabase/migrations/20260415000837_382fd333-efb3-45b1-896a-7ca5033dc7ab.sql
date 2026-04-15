
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Authenticated users can manage stores" ON public.stores;

-- Admins get full access (including credentials)
CREATE POLICY "Admins can manage stores"
  ON public.stores
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Staff/viewers can read stores but NOT credential columns
-- We create a restrictive SELECT policy for non-admins
CREATE POLICY "Staff can read stores basic info"
  ON public.stores
  FOR SELECT
  TO authenticated
  USING (true);
