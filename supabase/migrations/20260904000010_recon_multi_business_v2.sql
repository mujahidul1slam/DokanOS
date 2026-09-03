-- TEMPORARY recon oracle (multi-business restructure): read the tables that
-- drive the backfill design. Dropped right after.
CREATE OR REPLACE FUNCTION public.recon_multi_business()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'invoice_settings', (SELECT jsonb_agg(jsonb_build_object('id', id, 'business_name', business_name, 'logo_url', logo_url IS NOT NULL) ORDER BY business_name) FROM public.invoice_settings),
    'stores', (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'url', url, 'status', status) ORDER BY name) FROM public.stores),
    'profiles', (SELECT count(*) FROM public.profiles),
    'user_roles', (SELECT jsonb_object_agg(role, c) FROM (SELECT role, count(*) c FROM public.user_roles GROUP BY role) t),
    'user_store_access', (SELECT count(*) FROM public.user_store_access),
    'storefronts', (SELECT jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'store_id', store_id) ORDER BY name) FROM public.storefronts),
    'pathao_integrations', (SELECT count(*) FROM public.pathao_integrations),
    'order_sources', (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'is_default', is_default) ORDER BY sort_order) FROM public.order_sources),
    'pos_shifts_cols', (SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='pos_shifts'),
    'products_store_null', (SELECT count(*) FROM public.products WHERE store_id IS NULL),
    'products_total', (SELECT count(*) FROM public.products)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.recon_multi_business() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recon_multi_business() TO anon, authenticated, service_role;
