
-- audit_log: restrict reads to admins
DROP POLICY IF EXISTS "Authenticated can read audit_log" ON public.audit_log;
CREATE POLICY "Admins can read audit_log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- user_permissions: restrict reads to admins or the owning user
DROP POLICY IF EXISTS "Authenticated can read user_permissions" ON public.user_permissions;
CREATE POLICY "Admins or owner can read user_permissions"
  ON public.user_permissions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR auth.uid() = user_id);

-- pathao_integrations: full row admin-only; expose safe columns via a view
DROP POLICY IF EXISTS "Authenticated can read pathao_integrations" ON public.pathao_integrations;
CREATE POLICY "Admins can read pathao_integrations"
  ON public.pathao_integrations FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE VIEW public.pathao_integrations_safe
WITH (security_invoker = true) AS
SELECT id, name, is_active, created_at, updated_at
FROM public.pathao_integrations;

GRANT SELECT ON public.pathao_integrations_safe TO authenticated;

-- Allow authenticated users to read the safe subset of pathao_integrations
-- (no credential columns) so non-admin staff dispatch flows keep working.
CREATE POLICY "Authenticated can read pathao_integrations safe columns"
  ON public.pathao_integrations FOR SELECT TO authenticated
  USING (true);

-- The above would re-open credentials; replace with column-level approach:
DROP POLICY "Authenticated can read pathao_integrations safe columns" ON public.pathao_integrations;

-- Storage: invoice-assets — only owner (or admin) can update/delete
DROP POLICY IF EXISTS "Authenticated users can update invoice assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete invoice assets" ON storage.objects;

CREATE POLICY "Owner or admin can update invoice assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'invoice-assets'
    AND (owner = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  )
  WITH CHECK (
    bucket_id = 'invoice-assets'
    AND (owner = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Owner or admin can delete invoice assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'invoice-assets'
    AND (owner = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  );
