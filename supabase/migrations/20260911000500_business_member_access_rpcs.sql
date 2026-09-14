-- ============================================================================
-- W7: Per-business member access RPCs. SECURITY DEFINER, guarded by the SAME
-- logic as the W1a RLS policies (elevation + last-owner), so PostgREST-direct
-- and RPC paths enforce one policy. House REVOKE/GRANT pattern.
-- ============================================================================

-- Businesses the caller manages (owner/admin of) — platform admin sees all.
CREATE OR REPLACE FUNCTION public.get_my_managed_businesses()
RETURNS TABLE (id uuid, name text, slug text, logo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.id, b.name, b.slug, b.logo_url
  FROM public.businesses b
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
     OR public.my_business_role(b.id, auth.uid()) IN ('owner', 'admin')
  ORDER BY b.name;
$$;
REVOKE ALL ON FUNCTION public.get_my_managed_businesses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_managed_businesses() TO authenticated;

-- A member's access in one business: business role, store ids, effective perms.
CREATE OR REPLACE FUNCTION public.get_member_access(p_user uuid, p_business uuid)
RETURNS TABLE (business_role text, store_ids uuid[], effective_perms text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_business_access(p_business, auth.uid()) THEN
    RAISE EXCEPTION 'Only business owners/admins can view member access' USING ERRCODE = '42501';
  END IF;
  SELECT public.my_business_role(p_business, p_user) INTO business_role;
  SELECT coalesce(array_agg(store_id), '{}'::uuid[]) INTO store_ids
    FROM public.user_store_access WHERE user_id = p_user;
  SELECT coalesce(array_agg(permission::text), '{}'::text[]) INTO effective_perms
    FROM public.get_user_permissions(p_user);
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.get_member_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_access(uuid, uuid) TO authenticated;

-- Set a member's business role. Guards mirror the W1a RLS policies exactly:
-- elevation (owner/admin grants require caller = owner of that business or
-- platform admin) and last-owner protection (lock-protected, F17).
CREATE OR REPLACE FUNCTION public.set_member_business_role(p_user uuid, p_business uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_current text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'member', 'viewer') THEN
    RAISE EXCEPTION 'invalid role: %', p_role USING ERRCODE = '23514';
  END IF;
  IF NOT public.can_manage_business_access(p_business, v_caller) THEN
    RAISE EXCEPTION 'Only business owners/admins can change member roles' USING ERRCODE = '42501';
  END IF;
  -- Elevation rule (mirrors W1a INSERT/UPDATE WITH CHECK): a uba-'admin' cannot
  -- manufacture an owner/admin — only business-owners or platform admins can.
  IF p_role IN ('owner', 'admin')
     AND NOT public.has_role(v_caller, 'admin'::app_role)
     AND public.my_business_role(p_business, v_caller) <> 'owner' THEN
    RAISE EXCEPTION 'Only business owners can grant owner/admin roles' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_current FROM public.user_business_access
   WHERE user_id = p_user AND business_id = p_business;
  IF v_current IS NULL THEN
    INSERT INTO public.user_business_access (user_id, business_id, role)
    VALUES (p_user, p_business, p_role);
  ELSE
    -- Last-owner protection (mirrors W1a USING guard; FOR UPDATE row lock inside)
    IF v_current = 'owner' AND p_role <> 'owner'
       AND NOT public.has_role(v_caller, 'admin'::app_role)
       AND NOT public.business_has_other_owner(p_business, p_user) THEN
      RAISE EXCEPTION 'cannot demote the last owner of this business' USING ERRCODE = '23514';
    END IF;
    UPDATE public.user_business_access SET role = p_role
     WHERE user_id = p_user AND business_id = p_business;
  END IF;
  -- Server-side audit insert (definer bypasses the admin-only SELECT RLS for writes)
  INSERT INTO public.audit_log (user_id, user_email, action, entity_type, entity_id, details)
  VALUES (v_caller,
          (SELECT email FROM auth.users WHERE id = v_caller),
          'update_role', 'user_business_access', p_user::text,
          jsonb_build_object('business_id', p_business, 'old_role', v_current, 'new_role', p_role));
END $$;
REVOKE ALL ON FUNCTION public.set_member_business_role(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_business_role(uuid, uuid, text) TO authenticated;

-- ROLLBACK (three DROP FUNCTIONs):
-- DROP FUNCTION IF EXISTS public.set_member_business_role(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.get_member_access(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.get_my_managed_businesses();