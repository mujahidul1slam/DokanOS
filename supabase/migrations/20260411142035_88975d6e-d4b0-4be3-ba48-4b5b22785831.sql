-- Fix existing products stock_status from WooCommerce format to our DB format
UPDATE products SET stock_status = 'in_stock' WHERE stock_status = 'instock';
UPDATE products SET stock_status = 'out_of_stock' WHERE stock_status = 'outofstock';
UPDATE products SET stock_status = 'on_backorder' WHERE stock_status = 'onbackorder';

-- Fix existing product_variations stock_status
UPDATE product_variations SET stock_status = 'in_stock' WHERE stock_status = 'instock';
UPDATE product_variations SET stock_status = 'out_of_stock' WHERE stock_status = 'outofstock';
UPDATE product_variations SET stock_status = 'on_backorder' WHERE stock_status = 'onbackorder';