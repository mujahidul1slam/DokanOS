-- Rollback-only regression test for S-10 WooCommerce product import.
--
-- Proves that upsert_woocommerce_product maps the Woo payload into a local
-- Product (name, SKU, price, description, images, attributes, provenance),
-- finds or creates categories by woo_category_id + store_id, imports variations
-- supplied by the worker, de-dupes on replay and ignores stale observations.
-- The migration is rehearsed by the runner inside this transaction.
BEGIN;
DO $$
DECLARE
  c uuid := '9c000000-0000-0000-0000-00000000f010';
  store uuid := '9f000000-0000-0000-0000-00000000f010';
  brand uuid := '9e000000-0000-0000-0000-00000000f010';
  source uuid := '9d000000-0000-0000-0000-00000000f010';
  v_product uuid;
  v_again uuid;
  v_price numeric;
  v_description text;
  v_image text;
  v_gallery jsonb;
  v_origin text;
  v_source_id uuid;
  v_cat_count integer;
  v_pc_count integer;
  v_var_count integer;
  v_map_count integer;
  v_var_sku text;
  v_last_modified timestamptz;
  v_payload jsonb;
  v_child_name text;
BEGIN
  INSERT INTO public.stores(id, name, url) VALUES (store, 'Product import store', 'https://product-import.invalid');
  INSERT INTO public.brands(id, business_id, name, slug, woo_store_id)
    VALUES (brand, '11111111-0000-0000-0000-000000000001', 'Product import brand', 'woo-product-import', store);
  INSERT INTO public.order_sources(id, brand_id, name, type)
    VALUES (source, brand, 'Product import source', 'woocommerce');
  INSERT INTO public.woocommerce_connectors(id, business_id, brand_id, store_id, order_source_id, external_store_url, credentials_ref, webhook_secret_ref, status, outbound_enabled, intake_enabled)
    VALUES (c, '11111111-0000-0000-0000-000000000001', brand, store, source, 'https://product-import.invalid', 'LOCAL', 'LOCAL', 'healthy', false, true);

  v_payload := jsonb_build_object(
    'id', 88001,
    'name', 'Import Widget',
    'sku', 'IW-1',
    'description', 'A long description',
    'short_description', 'A short description',
    'price', '199.00',
    'regular_price', '249.00',
    'sale_price', '199.00',
    'manage_stock', true,
    'stock_quantity', 7,
    'stock_status', 'instock',
    'backorders', 'no',
    'attributes', jsonb_build_array(jsonb_build_object('name', 'Color', 'options', jsonb_build_array('Red', 'Blue'))),
    'images', jsonb_build_array(jsonb_build_object('src', 'https://img.invalid/1.jpg'), jsonb_build_object('src', 'https://img.invalid/2.jpg')),
    'categories', jsonb_build_array(
      jsonb_build_object('id', 810, 'name', 'Shirts', 'slug', 'shirts', 'parent', 0),
      jsonb_build_object('id', 811, 'name', 'T-Shirts', 'slug', 't-shirts', 'parent', 810)
    ),
    'variations_data', jsonb_build_array(
      jsonb_build_object('id', 99001, 'name', 'Red', 'sku', 'IW-1-RED', 'price', '199.00', 'regular_price', '249.00', 'sale_price', '199.00', 'stock_quantity', 3, 'stock_status', 'instock', 'attributes', jsonb_build_array(jsonb_build_object('name', 'Color', 'option', 'Red'))),
      jsonb_build_object('id', 99002, 'name', 'Blue', 'sku', 'IW-1-BLUE', 'price', '199.00', 'stock_quantity', 4, 'stock_status', 'instock')
    )
  );

  v_product := public.upsert_woocommerce_product(c, 88001, v_payload, timestamptz '2026-11-26 10:00:00+00');

  SELECT p.price, p.description, p.image_url, p.image_urls, p.origin_kind, p.origin_order_source_id
    INTO v_price, v_description, v_image, v_gallery, v_origin, v_source_id
    FROM public.products p WHERE p.id = v_product;
  IF v_price <> 199 OR v_description IS DISTINCT FROM 'A long description'
     OR v_image IS DISTINCT FROM 'https://img.invalid/1.jpg'
     OR jsonb_array_length(v_gallery) <> 2
     OR v_origin IS DISTINCT FROM 'woo_sync' OR v_source_id IS DISTINCT FROM source THEN
    RAISE EXCEPTION 'S-10: product fields/images/provenance were not mapped: price=%, desc=%, image=%, gallery=%, origin=%, source=%',
      v_price, coalesce(v_description, '<null>'), coalesce(v_image, '<null>'), v_gallery, coalesce(v_origin, '<null>'), v_source_id;
  END IF;

  SELECT count(*) INTO v_cat_count FROM public.categories
    WHERE store_id = store AND woo_category_id IN (810, 811);
  SELECT count(*) INTO v_pc_count FROM public.product_categories WHERE product_id = v_product;
  IF v_cat_count <> 2 OR v_pc_count <> 2 THEN
    RAISE EXCEPTION 'S-10: expected 2 categories and 2 joins, got % and %', v_cat_count, v_pc_count;
  END IF;
  -- The child category must point at the parent created in the same delivery.
  SELECT c2.name INTO v_child_name FROM public.categories c2
    JOIN public.categories cp ON cp.id = c2.parent_id
   WHERE c2.store_id = store AND c2.woo_category_id = 811 AND cp.woo_category_id = 810;
  IF v_child_name IS DISTINCT FROM 'T-Shirts' THEN
    RAISE EXCEPTION 'S-10: category parent relationship was not resolved';
  END IF;

  SELECT count(*) INTO v_var_count FROM public.product_variations WHERE product_id = v_product;
  IF v_var_count <> 2 THEN
    RAISE EXCEPTION 'S-10: expected 2 variations, got %', v_var_count;
  END IF;
  -- External variation identity lives in woocommerce_product_map, not on the
  -- variation row (the legacy woo_variation_id column was retired).
  SELECT pv.sku INTO v_var_sku
    FROM public.woocommerce_product_map m
    JOIN public.product_variations pv ON pv.id = m.variation_id
   WHERE m.connector_id = c AND m.external_product_id = 88001
     AND m.external_variation_id = 99001;
  IF v_var_sku IS DISTINCT FROM 'IW-1-RED' THEN
    RAISE EXCEPTION 'S-10: variation SKU was not mapped: %', coalesce(v_var_sku, '<null>');
  END IF;

  SELECT count(*) INTO v_map_count FROM public.woocommerce_product_map
    WHERE connector_id = c AND external_product_id = 88001;
  IF v_map_count <> 3 THEN
    RAISE EXCEPTION 'S-10: expected 1 parent + 2 variation map rows, got %', v_map_count;
  END IF;

  -- Idempotent replay with a newer timestamp must reuse the same product,
  -- category and variation rows (no duplicates).
  v_again := public.upsert_woocommerce_product(c, 88001, v_payload, timestamptz '2026-11-26 11:00:00+00');
  IF v_again IS DISTINCT FROM v_product THEN
    RAISE EXCEPTION 'S-10: replay created a second product: % vs %', v_again, v_product;
  END IF;
  SELECT count(*) INTO v_var_count FROM public.product_variations WHERE product_id = v_product;
  SELECT count(*) INTO v_cat_count FROM public.categories WHERE store_id = store AND woo_category_id IN (810, 811);
  IF v_var_count <> 2 OR v_cat_count <> 2 THEN
    RAISE EXCEPTION 'S-10: replay duplicated variations or categories: vars=%, cats=%', v_var_count, v_cat_count;
  END IF;

  -- A stale observation (older than last_modified_at) must be ignored.
  UPDATE public.products SET name = 'Newer Name' WHERE id = v_product;
  v_again := public.upsert_woocommerce_product(c, 88001, v_payload, timestamptz '2026-11-26 09:00:00+00');
  SELECT p.name INTO v_child_name FROM public.products p WHERE p.id = v_product;
  IF v_child_name IS DISTINCT FROM 'Newer Name' THEN
    RAISE EXCEPTION 'S-10: a stale delivery overwrote a newer product: %', v_child_name;
  END IF;
  SELECT m.last_modified_at INTO v_last_modified FROM public.woocommerce_product_map m
    WHERE connector_id = c AND external_product_id = 88001 AND external_variation_id IS NULL;
  IF v_last_modified <> timestamptz '2026-11-26 11:00:00+00' THEN
    RAISE EXCEPTION 'S-10: stale replay rolled back the freshness watermark: %', v_last_modified;
  END IF;

  -- SKU dedupe within the store: a different external id with the same SKU
  -- must resolve to the existing local product, not create a second one.
  v_again := public.upsert_woocommerce_product(
    c, 88002,
    jsonb_build_object('id', 88002, 'name', 'Import Widget Copy', 'sku', 'IW-1', 'price', '199.00'),
    timestamptz '2026-11-26 12:00:00+00');
  IF v_again IS DISTINCT FROM v_product THEN
    RAISE EXCEPTION 'S-10: SKU dedupe failed, created product % instead of reusing %', v_again, v_product;
  END IF;
  SELECT count(*) INTO v_map_count FROM public.woocommerce_product_map WHERE connector_id = c;
  IF v_map_count <> 4 THEN
    RAISE EXCEPTION 'S-10: expected 4 map rows after SKU dedupe, got %', v_map_count;
  END IF;
END $$;

ROLLBACK;
