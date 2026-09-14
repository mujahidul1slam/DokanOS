# Rollback — 20260911000400_rls_tighten_app_settings.sql

Reverts the app_settings write tightening back to staff-or-admin.

```sql
BEGIN;
DROP POLICY IF EXISTS "Settings managers can insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Settings managers can update app_settings" ON public.app_settings;
CREATE POLICY "Staff and admin can insert app_settings" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can update app_settings" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
COMMIT;
```

NOTE: the `has_permission` REVOKE/GRANT is intentionally left in place on
rollback — it is a hardening with no behavior regression for authenticated users.

## Pre-merge census gate (CRITIQUE-v2 #9)

Before this migration merges to main, run against prod:

```sql
SELECT DISTINCT user_id FROM audit_log
 WHERE action IN ('settings_inventory','settings_preorder_categories')
   AND created_at > now() - interval '90 days';
```

Only these two actions write app_settings (settings_general is localStorage-only
and must not be counted). If non-admin writers exist: grant `settings.manage`
overrides first, or defer this migration with notice.
