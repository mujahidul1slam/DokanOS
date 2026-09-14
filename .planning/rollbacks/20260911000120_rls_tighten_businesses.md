# Rollback — 20260911000120_rls_tighten_businesses.sql

Reverts the businesses write tightening (owner/admin-only) back to any-member FOR ALL.

```sql
BEGIN;
DROP POLICY IF EXISTS "Admins can insert businesses" ON public.businesses;
DROP POLICY IF EXISTS "Owners can update businesses" ON public.businesses;
DROP POLICY IF EXISTS "Admins can delete businesses" ON public.businesses;
CREATE POLICY "Members can write businesses" ON public.businesses
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id));
COMMIT;
```

"Members can read businesses" is never dropped — it stands in both paths.
