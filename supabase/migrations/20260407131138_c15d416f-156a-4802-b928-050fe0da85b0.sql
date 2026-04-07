
-- Drop partial indexes that don't work with upsert onConflict
DROP INDEX IF EXISTS idx_products_woo_product_id_store;
DROP INDEX IF EXISTS idx_orders_woo_order_id_store;
DROP INDEX IF EXISTS idx_customers_woo_customer_id_store;

-- Add actual unique constraints (non-partial) for upsert support
ALTER TABLE public.products ADD CONSTRAINT uq_products_woo_id_store UNIQUE (woo_product_id, store_id);
ALTER TABLE public.orders ADD CONSTRAINT uq_orders_woo_id_store UNIQUE (woo_order_id, store_id);
ALTER TABLE public.customers ADD CONSTRAINT uq_customers_woo_id_store UNIQUE (woo_customer_id, store_id);
