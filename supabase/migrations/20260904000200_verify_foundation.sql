-- TEMPORARY Phase 0 verification oracle for the multi-business foundation.
CREATE OR REPLACE FUNCTION public.verify_multi_business_foundation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'businesses', (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug)) FROM public.businesses),
    'owners', (SELECT count(*) FROM public.user_business_access WHERE role = 'owner'),
    'brands', (SELECT jsonb_agg(jsonb_build_object('name', name, 'woo_store_id', woo_store_id) ORDER BY name) FROM public.brands),
    'locations', (SELECT jsonb_agg(jsonb_build_object('brand', b.name, 'loc', l.name, 'type', l.type, 'is_default', l.is_default) ORDER BY b.name) FROM public.locations l JOIN public.brands b ON b.id = l.brand_id),
    'selling_points', (SELECT jsonb_agg(jsonb_build_object('brand', b.name, 'sp', sp.name, 'type', sp.type, 'has_location', sp.location_id IS NOT NULL, 'woo_linked', sp.woo_store_id IS NOT NULL, 'sf_linked', sp.storefront_id IS NOT NULL) ORDER BY b.name, sp.type) FROM public.selling_points sp JOIN public.brands b ON b.id = sp.brand_id),
    'connectors', (SELECT jsonb_agg(jsonb_build_object('category', category, 'type', type, 'name', name, 'status', status) ORDER BY category, name) FROM public.connectors),
    'product_sources', (SELECT jsonb_agg(jsonb_build_object('brand', b.name, 'name', ps.name, 'type', ps.type, 'dir', ps.sync_direction) ORDER BY b.name) FROM public.product_sources ps JOIN public.brands b ON b.id = ps.brand_id),
    'customer_sources', (SELECT count(*) FROM public.customer_sources),
    'orders_with_sp', (SELECT count(*) FROM public.orders WHERE selling_point_id IS NOT NULL),
    'orders_total', (SELECT count(*) FROM public.orders),
    'product_locations', (SELECT count(*) FROM public.product_locations),
    'pos_shifts_with_sp', (SELECT count(*) FROM public.pos_shifts WHERE selling_point_id IS NOT NULL),
    'pos_shifts_total', (SELECT count(*) FROM public.pos_shifts)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.verify_multi_business_foundation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_multi_business_foundation() TO anon, authenticated, service_role;
