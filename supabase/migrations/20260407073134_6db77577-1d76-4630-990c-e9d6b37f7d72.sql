
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_woo_product_id_store
  ON public.products (woo_product_id, store_id)
  WHERE woo_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_woo_order_id_store
  ON public.orders (woo_order_id, store_id)
  WHERE woo_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_woo_customer_id_store
  ON public.customers (woo_customer_id, store_id)
  WHERE woo_customer_id IS NOT NULL;
