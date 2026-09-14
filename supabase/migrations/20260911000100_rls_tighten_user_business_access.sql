-- ============================================================================
-- P0 fix: user_business_access write policies. Replaces "Users can write own
-- access" (FOR ALL, self OR admin) which let any authenticated user self-grant
-- owner on ANY business. House idiom: DROP POLICY IF EXISTS + CREATE.
-- The SELECT policy "Users can read own access" (20260904000100:368-370) is
-- deliberately left untouched: its logic (own rows OR platform admin) is the
-- exact target posture (CRITIQUE-v2 #5: no manager widening), and re-CREATEing
-- that name would raise 42710 (duplicate_object).
-- ============================================================================

-- Caller's role in a business (NULL when not a member). SECURITY DEFINER so
-- policies on user_business_access can read it without recursion. uba.role is
-- text CHECK (owner/admin/member/viewer) with UNIQUE (user_id, business_id)
-- (20260904000100:44-53), hence RETURNS text and exactly one row.
CREATE OR REPLACE FUNCTION public.my_business_role(p_business_id uuid, p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.role FROM public.user_business_access a
  WHERE a.business_id = p_business_id AND a.user_id = p_user;
$$;
REVOKE ALL ON FUNCTION public.my_business_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_business_role(uuid, uuid) TO authenticated;

-- Can caller manage memberships of this business?
CREATE OR REPLACE FUNCTION public.can_manage_business_access(p_business_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user, 'admin'::app_role)
      OR public.my_business_role(p_business_id, p_user) IN ('owner', 'admin');
$$;
REVOKE ALL ON FUNCTION public.can_manage_business_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_business_access(uuid, uuid) TO authenticated;

-- Business has at least one other owner besides p_user — WITH row lock.
-- VOLATILE (not STABLE): SELECT ... FOR UPDATE takes row locks — the F17
-- TOCTOU fix. Two concurrent last-owner mutations serialize; one side
-- deadlock-aborts (40P01) instead of both committing an ownerless business.
CREATE OR REPLACE FUNCTION public.business_has_other_owner(p_business_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.user_business_access
   WHERE business_id = p_business_id
     AND role = 'owner'
     AND user_id IS DISTINCT FROM p_user
     FOR UPDATE;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.business_has_other_owner(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_has_other_owner(uuid, uuid) TO authenticated;

-- Immutable identity columns: user_id/business_id may never change via UPDATE.
-- NIT-8c: SET search_path added — every new helper carries it, per §0.5.
CREATE OR REPLACE FUNCTION public.user_business_access_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'user_business_access user_id/business_id are immutable; delete and re-insert'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_uba_immutable ON public.user_business_access;
CREATE TRIGGER trg_uba_immutable BEFORE UPDATE ON public.user_business_access
  FOR EACH ROW EXECUTE FUNCTION public.user_business_access_immutable();

BEGIN;
ALTER TABLE public.user_business_access ENABLE ROW LEVEL SECURITY;

-- The ONLY policy dropped (the write hole, 20260904000100:371-374).
DROP POLICY IF EXISTS "Users can write own access" ON public.user_business_access;

-- INSERT: managers may add members/viewers; only business-owners or platform
-- admins may add owner/admin rows (symmetric with the UPDATE elevation rule —
-- a uba-'admin' cannot manufacture an owner, matching what UPDATE allows).
CREATE POLICY "Managers can add members" ON public.user_business_access
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      can_manage_business_access(business_id, auth.uid())
      AND (
        role NOT IN ('owner', 'admin')
        OR public.my_business_role(business_id, auth.uid()) = 'owner'
      )
    )
  );

-- UPDATE. USING (existing row): a manager may touch a row unless it is the
-- LAST owner's row — because role is the only mutable column, any mutation of
-- a last-owner row by a non-admin is a demotion in effect. WITH CHECK (new
-- row): elevation to owner/admin requires the caller to be an owner of that
-- business or a platform admin. Platform admins bypass both guards (first
-- disjunct) — the documented recovery backstop.
CREATE POLICY "Managers can update member roles" ON public.user_business_access
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      can_manage_business_access(business_id, auth.uid())
      AND (
        role IS DISTINCT FROM 'owner'
        OR public.business_has_other_owner(business_id, user_id)
      )
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      can_manage_business_access(business_id, auth.uid())
      AND (
        role NOT IN ('owner', 'admin')
        OR public.my_business_role(business_id, auth.uid()) = 'owner'
      )
    )
  );

-- DELETE: three disjoint branches (CRITIQUE-v2 #1 restructure):
--   1. platform admin — unconditional (recovery backstop);
--   2. self-service leave — own row, only while another owner exists
--      (for non-owner members this is trivially true: the invariant
--      guarantees an owner who is not them);
--   3. manager removal of ANOTHER member's row — denied only when the target
--      is the last owner. Self rows are excluded here (user_id IS DISTINCT
--      FROM auth.uid()) so this branch can never bypass branch 2's guard.
CREATE POLICY "Members can leave; managers can remove" ON public.user_business_access
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      user_id = auth.uid()
      AND public.business_has_other_owner(business_id, auth.uid())
    )
    OR (
      can_manage_business_access(business_id, auth.uid())
      AND user_id IS DISTINCT FROM auth.uid()
      AND (
        role IS DISTINCT FROM 'owner'
        OR public.business_has_other_owner(business_id, user_id)
      )
    )
  );
COMMIT;

-- ============================================================================
-- ROLLBACK (do not execute here — see .planning/rollbacks/20260911000100_rls_tighten_user_business_access.md):
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_uba_immutable ON public.user_business_access;
-- DROP FUNCTION IF EXISTS public.user_business_access_immutable();
-- DROP POLICY IF EXISTS "Managers can add members" ON public.user_business_access;
-- DROP POLICY IF EXISTS "Managers can update member roles" ON public.user_business_access;
-- DROP POLICY IF EXISTS "Members can leave; managers can remove" ON public.user_business_access;
-- CREATE POLICY "Users can write own access" ON public.user_business_access
--   FOR ALL TO authenticated
--   USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
--   WITH CHECK (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
-- COMMIT;
-- ("Users can read own access" was never touched. Helpers remain: harmless
--  orphans that W7's RPCs reuse.)
-- ============================================================================
