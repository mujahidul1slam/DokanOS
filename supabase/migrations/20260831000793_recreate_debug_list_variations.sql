-- TEMPORARY verification oracle (Issue 3): anon cannot read product_variations
-- (correctly revoked in 20260412170009), so an end-to-end check of the
-- variation webhook needs a SECURITY DEFINER read. Returns the target
-- variation rows for one product. Dropped by 20260831000792.

CREATE OR REPLACE FUNCTION public.debug_list_variations(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
      'woo_variation_id', woo_variation_id,
      'name', name,
      'stock_quantity', stock_quantity,
      'updated_at', updated_at
    ) ORDER BY updated_at DESC)
    FROM public.product_variations
    WHERE product_id = p_product_id),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debug_list_variations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_list_variations(uuid) TO anon, authenticated, service_role;