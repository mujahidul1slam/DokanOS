
-- Drop the partial indexes that can't be used for ON CONFLICT
DROP INDEX IF EXISTS idx_categories_woo_store;
DROP INDEX IF EXISTS idx_variations_woo_product;

-- Create proper unique constraints (not partial)
ALTER TABLE public.categories ADD CONSTRAINT uq_categories_woo_store UNIQUE (woo_category_id, store_id);
ALTER TABLE public.product_variations ADD CONSTRAINT uq_variations_woo_product UNIQUE (woo_variation_id, product_id);
