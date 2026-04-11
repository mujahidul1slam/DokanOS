-- Delete products that are actually variations (their woo_product_id matches a woo_variation_id)
DELETE FROM product_categories WHERE product_id IN (
  SELECT p.id FROM products p
  INNER JOIN product_variations pv ON p.woo_product_id = pv.woo_variation_id
);
DELETE FROM products WHERE id IN (
  SELECT p.id FROM products p
  INNER JOIN product_variations pv ON p.woo_product_id = pv.woo_variation_id
);