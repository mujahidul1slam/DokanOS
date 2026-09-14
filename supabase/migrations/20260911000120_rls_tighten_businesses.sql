-- ============================================================================
-- P0 fix: "Members can write businesses" (FOR ALL, any member) let ANY member
-- — including viewer — UPDATE and cascade-DELETE the businesses row.
-- CRITIQUE-v2 #2: the SELECT policy "Members can read businesses"
-- (20260904000100:355-357) already grants member-wide read and is NOT touched
-- here — CREATEing that name again would raise 42710 and abort this migration
-- mid-runbook. Only the FOR ALL write policy is dropped and replaced by three
-- explicit write policies. Depends on W1a's can_manage_business_access
-- (20260911000100) — runbook order …00100 → …00120.
-- ============================================================================
BEGIN;
DROP POLICY IF EXISTS "Members can write businesses" ON public.businesses;

-- Direct INSERT: platform admin only (new businesses have no members yet, so
-- is_business_member(new_id) is necessarily false — this matches today's
-- effective behavior through the old FOR ALL's WITH CHECK).
-- The W1b RPC path is SECURITY DEFINER and unaffected.
CREATE POLICY "Admins can insert businesses" ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- UPDATE: platform admin or owner/admin-of-business. USING == WITH CHECK by
-- design (the row cannot move between businesses; id is its identity).
CREATE POLICY "Owners can update businesses" ON public.businesses
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)
         OR can_manage_business_access(id, auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role)
              OR can_manage_business_access(id, auth.uid()));

-- Business deletion cascade-wipes 9 child tables incl. memberships:
-- platform admin only.
CREATE POLICY "Admins can delete businesses" ON public.businesses
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
COMMIT;

-- ============================================================================
-- ROLLBACK (see .planning/rollbacks/20260911000120_rls_tighten_businesses.md):
-- BEGIN;
-- DROP POLICY IF EXISTS "Admins can insert businesses" ON public.businesses;
-- DROP POLICY IF EXISTS "Owners can update businesses" ON public.businesses;
-- DROP POLICY IF EXISTS "Admins can delete businesses" ON public.businesses;
-- CREATE POLICY "Members can write businesses" ON public.businesses
--   FOR ALL TO authenticated
--   USING (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id))
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id));
-- COMMIT;
-- ("Members can read businesses" is never dropped — it stands in both paths.)
-- ============================================================================
