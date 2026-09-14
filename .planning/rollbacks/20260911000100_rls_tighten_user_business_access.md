# Rollback — 20260911000100_rls_tighten_user_business_access.sql

Reverts the P0 user_business_access write-policy tightening. Restores the
original self-grant policy **verbatim** (20260904000100:371-374) — this re-opens
the multi-tenant escalation hole; only run alongside a frontend rollback.

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_uba_immutable ON public.user_business_access;
DROP FUNCTION IF EXISTS public.user_business_access_immutable();
DROP POLICY IF EXISTS "Managers can add members" ON public.user_business_access;
DROP POLICY IF EXISTS "Managers can update member roles" ON public.user_business_access;
DROP POLICY IF EXISTS "Members can leave; managers can remove" ON public.user_business_access;
CREATE POLICY "Users can write own access" ON public.user_business_access
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
COMMIT;
```

"Users can read own access" was never touched — it stands unchanged. The three
helper functions (my_business_role, can_manage_business_access,
business_has_other_owner) are left in place: harmless orphans that W7's RPCs reuse.
