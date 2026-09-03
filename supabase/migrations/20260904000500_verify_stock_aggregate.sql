-- TEMPORARY rollback-safe verification for the Phase 3 stock aggregate
-- trigger: product_locations write -> products.stock_quantity aggregate.
CREATE OR REPLACE FUNCTION public.verify_stock_aggregate()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pl public.product_locations;
  v_product public.products;
  v_before numeric;
  v_after numeric;
  ok boolean := false;
BEGIN
  BEGIN
    SELECT * INTO v_pl FROM public.product_locations
    WHERE stock_quantity > 0 ORDER BY created_at LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('skipped', 'no product_locations rows');
    END IF;
    SELECT * INTO v_product FROM public.products WHERE id = v_pl.product_id;

    v_before := v_product.stock_quantity;
    UPDATE public.product_locations
      SET stock_quantity = stock_quantity + 7
      WHERE id = v_pl.id;

    SELECT stock_quantity INTO v_after FROM public.products WHERE id = v_pl.product_id;
    ok := v_after = v_before + 7;

    RAISE EXCEPTION 'ABORT_TEST';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ABORT_TEST' THEN
      RAISE;
    END IF;
  END;

  RETURN jsonb_build_object(
    'aggregate_ok', ok,
    'before', v_before,
    'after_expected', v_before + 7
  );
END;
$$;
REVOKE ALL ON FUNCTION public.verify_stock_aggregate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_stock_aggregate() TO anon, authenticated, service_role;
