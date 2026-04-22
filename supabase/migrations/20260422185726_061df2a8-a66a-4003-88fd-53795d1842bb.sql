-- Enable trigram extension for fast ILIKE search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============ ORDERS ============
CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON public.orders (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_source ON public.orders (source);
CREATE INDEX IF NOT EXISTS idx_orders_store_id ON public.orders (store_id);
CREATE INDEX IF NOT EXISTS idx_orders_consignment_id ON public.orders (consignment_id) WHERE consignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tracking_status ON public.orders (tracking_status);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_type ON public.orders (fulfillment_type);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number_trgm ON public.orders USING gin (order_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_customer_name_trgm ON public.orders USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_trgm ON public.orders USING gin (customer_phone gin_trgm_ops);

-- ============ ORDER ITEMS ============
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);

-- ============ PRODUCTS ============
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products (name);
CREATE INDEX IF NOT EXISTS idx_products_store_id ON public.products (store_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_status ON public.products (stock_status);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON public.products (is_active);
CREATE INDEX IF NOT EXISTS idx_products_is_featured ON public.products (is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_sku_trgm ON public.products USING gin (sku gin_trgm_ops);

-- ============ PRODUCT CATEGORIES ============
CREATE INDEX IF NOT EXISTS idx_product_categories_product ON public.product_categories (product_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category ON public.product_categories (category_id);

-- ============ CUSTOMERS ============
CREATE INDEX IF NOT EXISTS idx_customers_created_at_desc ON public.customers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers (phone);
CREATE INDEX IF NOT EXISTS idx_customers_store_id ON public.customers (store_id);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON public.customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm ON public.customers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm ON public.customers USING gin (phone gin_trgm_ops);

-- ============ CUSTOMER ALIASES ============
CREATE INDEX IF NOT EXISTS idx_customer_aliases_customer ON public.customer_aliases (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_aliases_value_trgm ON public.customer_aliases USING gin (value gin_trgm_ops);

-- ============ CATEGORIES ============
CREATE INDEX IF NOT EXISTS idx_categories_store_id ON public.categories (store_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories (parent_id);

-- ============ ORDER TIMELINE ============
CREATE INDEX IF NOT EXISTS idx_order_timeline_order_id ON public.order_timeline (order_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON public.order_payments (order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_measurements_order_id ON public.order_item_measurements (order_id);

-- ============ AUDIT LOG ============
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at_desc ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log (entity_type, entity_id);