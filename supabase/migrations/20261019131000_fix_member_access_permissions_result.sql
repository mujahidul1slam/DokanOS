-- A nonmember has no role (NULL). RPC guards use IF NOT this predicate;
-- returning NULL would skip rejection in PL/pgSQL. Fail closed instead.
CREATE OR REPLACE FUNCTION public.can_manage_business_access(p_business_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(public.has_role(p_user, 'admin'::app_role)
      OR public.my_business_role(p_business_id, p_user) IN ('owner', 'admin'), false);
$$;
REVOKE ALL ON FUNCTION public.can_manage_business_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_business_access(uuid, uuid) TO authenticated;

-- get_user_permissions returns one app_permission[], not rows with a
-- permission column. Preserve the RPC's existing authorization and shape.
CREATE OR REPLACE FUNCTION public.get_member_access(p_user uuid, p_business uuid)
RETURNS TABLE (business_role text, store_ids uuid[], effective_perms text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.can_manage_business_access(p_business, auth.uid()) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only business owners/admins can view member access' USING ERRCODE = '42501';
  END IF;
  SELECT public.my_business_role(p_business, p_user) INTO business_role;
  SELECT coalesce(array_agg(store_id), '{}'::uuid[]) INTO store_ids
    FROM public.user_store_access WHERE user_id = p_user;
  SELECT public.get_user_permissions(p_user)::text[] INTO effective_perms;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.get_member_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_access(uuid, uuid) TO authenticated;
