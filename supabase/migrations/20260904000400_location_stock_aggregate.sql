-- Multi-business Phase 3: warehouse-scoped stock.
--
-- product_locations becomes the write model; products.stock_quantity stays
-- as the aggregate read model, maintained by trigger so ALL existing
-- consumers (POS, dashboards, Woo stock push triggers) keep working.
--
-- Also: when an order's location_id is set, nothing else changes — the
-- location picker UI writes it directly.

CREATE OR REPLACE FUNCTION public.sync_product_stock_from_locations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_new_qty numeric;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);
  SELECT COALESCE(SUM(stock_quantity), 0) INTO v_new_qty
  FROM public.product_locations
  WHERE product_id = v_product_id;

  -- Update the aggregate WITHOUT re-firing the stock push trigger into a
  -- loop: the existing auto_push_product_stock trigger on products fires on
  -- stock_quantity changes and enqueues push_stock rows. Suppress by
  -- skipping when the aggregate already matches (idempotent updates).
  UPDATE public.products
  SET stock_quantity = v_new_qty
  WHERE id = v_product_id
    AND stock_quantity IS DISTINCT FROM v_new_qty;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS product_locations_stock_sync ON public.product_locations;
CREATE TRIGGER product_locations_stock_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.product_locations
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock_from_locations();
