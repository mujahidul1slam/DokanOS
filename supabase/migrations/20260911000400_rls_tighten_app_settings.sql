-- ============================================================================
-- W4: Tighten app_settings writes. Original (20260429165344) let any staff
-- INSERT/UPDATE app_settings (global stock, preorder categories) bypassing
-- settings.manage. Now restricted to settings.manage holders or platform admin.
-- Uses the existing has_permission (20260420112330:169) SECURITY DEFINER
-- function. SELECT + DELETE policies unchanged.
-- ============================================================================
BEGIN;
-- has_permission carries no explicit grants, so EXECUTE defaults to PUBLIC
-- (anon included). Restrict to authenticated.
REVOKE ALL ON FUNCTION public.has_permission(uuid, app_permission) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, app_permission) TO authenticated;

DROP POLICY IF EXISTS "Staff and admin can insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Staff and admin can update app_settings" ON public.app_settings;

CREATE POLICY "Settings managers can insert app_settings" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
              OR public.has_permission(auth.uid(), 'settings.manage'::app_permission));
CREATE POLICY "Settings managers can update app_settings" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_permission(auth.uid(), 'settings.manage'::app_permission))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
              OR public.has_permission(auth.uid(), 'settings.manage'::app_permission));
COMMIT;

-- ============================================================================
-- ROLLBACK (see .planning/rollbacks/20260911000400_rls_tighten_app_settings.md):
-- BEGIN;
-- DROP POLICY IF EXISTS "Settings managers can insert app_settings" ON public.app_settings;
-- DROP POLICY IF EXISTS "Settings managers can update app_settings" ON public.app_settings;
-- CREATE POLICY "Staff and admin can insert app_settings" ON public.app_settings
--   FOR INSERT TO authenticated
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
-- CREATE POLICY "Staff and admin can update app_settings" ON public.app_settings
--   FOR UPDATE TO authenticated
--   USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
-- COMMIT;
-- NOTE: the has_permission REVOKE/GRANT is intentionally left in place on
-- rollback — it is a hardening with no behavior regression for authenticated
-- users.
-- ============================================================================