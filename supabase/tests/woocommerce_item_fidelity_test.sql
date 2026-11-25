-- Rollback-only regression test for WooCommerce item/product/currency fidelity
-- (E2E finding W-11, scenario S-02).
--
-- The import contract must keep the external product facts WooCommerce sends:
-- SKU, external product id, external variation id, line tax, and the order
-- currency. It must also stay safe: a later echo without those facts may not
-- erase what was already stored, and a malformed external id must not abort the
-- import.
BEGIN;
DO $$
DECLARE
  c uuid := '8c000000-0000-0000-0000-00000000ea01';
  store uuid := '8f000000-0000-0000-0000-00000000ea01';
  brand uuid := '8e000000-0000-0000-0000-00000000ea01';
  source uuid := '8d000000-0000-0000-0000-00000000ea01';
  v_order uuid;
  v_currency text;
  v_sku text;
  v_product bigint;
  v_variation bigint;
  v_tax numeric;
  v_qty integer;
  v_unit numeric;
  v_total numeric;
  item_count integer;
BEGIN
  INSERT INTO public.stores(id, name, url) VALUES (store, 'Fidelity store', 'https://fidelity.invalid');
  INSERT INTO public.brands(id, business_id, name, slug, woo_store_id)
    VALUES (brand, '11111111-0000-0000-0000-000000000001', 'Fidelity brand', 'woo-fidelity', store);
  INSERT INTO public.order_sources(id, brand_id, name, type)
    VALUES (source, brand, 'Fidelity source', 'woocommerce');
  INSERT INTO public.woocommerce_connectors(id, business_id, brand_id, store_id, order_source_id, external_store_url, external_store_key, credentials_ref, webhook_secret_ref, status, outbound_enabled, intake_enabled)
    VALUES (c, '11111111-0000-0000-0000-000000000001', brand, store, source, 'https://fidelity.invalid', 'fidelity', 'LOCAL', 'LOCAL', 'healthy', false, true);

  -- A real WooCommerce product line: SKU, external product id, external
  -- variation id and line tax, plus the order currency in safe external facts.
  v_order := public.upsert_woocommerce_order(
    c, 94001, '94001', 'processing', timestamptz '2026-11-24 10:00:00+00',
    1275, 1195, 0, 80, 'cod', 'new_order', 'paid',
    'Fidelity Buyer', 'fidelity@example.invalid', NULL, NULL, NULL, NULL, NULL, NULL,
    timestamptz '2026-11-24 09:00:00+00',
    jsonb_build_array(
      jsonb_build_object('name', 'Contrast Polo T-shirts-Black - L', 'quantity', 1, 'price', 1195, 'total', '1195', 'sku', 'EV-6385-2', 'product_id', 6823, 'variation_id', 7331, 'total_tax', '0.00'),
      -- A simple product reports variation_id 0 and carries no SKU or tax.
      jsonb_build_object('name', 'Gift wrap', 'quantity', 2, 'price', 40, 'total', '80', 'variation_id', 0)
    ),
    jsonb_build_object('status', 'processing', 'currency', 'BDT')
  );

  SELECT o.currency INTO v_currency FROM public.orders o WHERE o.id = v_order;
  IF v_currency IS DISTINCT FROM 'BDT' THEN
    RAISE EXCEPTION 'W-11: order currency was not persisted: %', coalesce(v_currency, '<null>');
  END IF;

  SELECT count(*) INTO item_count FROM public.order_items oi WHERE oi.order_id = v_order;
  IF item_count <> 2 THEN
    RAISE EXCEPTION 'W-11: expected 2 imported line items, found %', item_count;
  END IF;

  SELECT oi.sku, oi.woocommerce_product_id, oi.woocommerce_variation_id, oi.tax_amount, oi.quantity, oi.unit_price, oi.line_total
    INTO v_sku, v_product, v_variation, v_tax, v_qty, v_unit, v_total
    FROM public.order_items oi
   WHERE oi.order_id = v_order AND oi.product_name = 'Contrast Polo T-shirts-Black - L';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'W-11: the product line item was not imported';
  END IF;
  IF v_sku IS DISTINCT FROM 'EV-6385-2' THEN
    RAISE EXCEPTION 'W-11: SKU was not persisted: %', coalesce(v_sku, '<null>');
  END IF;
  IF v_product IS DISTINCT FROM 6823 THEN
    RAISE EXCEPTION 'W-11: external product id was not persisted: %', coalesce(v_product::text, '<null>');
  END IF;
  IF v_variation IS DISTINCT FROM 7331 THEN
    RAISE EXCEPTION 'W-11: external variation id was not persisted: %', coalesce(v_variation::text, '<null>');
  END IF;
  IF v_tax IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'W-11: line tax was not persisted: %', coalesce(v_tax::text, '<null>');
  END IF;
  -- The money facts must not regress while fidelity is added.
  IF v_qty <> 1 OR v_unit <> 1195 OR v_total <> 1195 THEN
    RAISE EXCEPTION 'W-11: item money facts regressed: qty=% unit=% total=%', v_qty, v_unit, v_total;
  END IF;

  -- A simple product's variation_id 0 means "no variation", not a real id.
  SELECT oi.sku, oi.woocommerce_product_id, oi.woocommerce_variation_id, oi.tax_amount
    INTO v_sku, v_product, v_variation, v_tax
    FROM public.order_items oi
   WHERE oi.order_id = v_order AND oi.product_name = 'Gift wrap';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'W-11: the simple-product line item was not imported';
  END IF;
  IF v_variation IS NOT NULL THEN
    RAISE EXCEPTION 'W-11: variation id 0 was stored as a real external id';
  END IF;
  IF v_product IS NOT NULL OR v_sku IS NOT NULL OR v_tax IS NOT NULL THEN
    RAISE EXCEPTION 'W-11: absent external facts were invented for a simple product line';
  END IF;

  -- A later refresh may update the currency...
  PERFORM public.upsert_woocommerce_order(
    c, 94001, '94001', 'processing', timestamptz '2026-11-24 11:00:00+00',
    1275, 1195, 0, 80, 'cod', 'new_order', 'paid',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    timestamptz '2026-11-24 09:00:00+00', '[]'::jsonb,
    jsonb_build_object('status', 'processing', 'currency', 'USD')
  );
  SELECT o.currency INTO v_currency FROM public.orders o WHERE o.id = v_order;
  IF v_currency IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'W-11: a reported currency change was not applied: %', coalesce(v_currency, '<null>');
  END IF;

  -- ...but an echo without any currency fact must never erase it.
  PERFORM public.upsert_woocommerce_order(
    c, 94001, '94001', 'processing', timestamptz '2026-11-24 12:00:00+00',
    1275, 1195, 0, 80, 'cod', 'new_order', 'paid',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    timestamptz '2026-11-24 09:00:00+00', '[]'::jsonb,
    jsonb_build_object('status', 'processing')
  );
  SELECT o.currency INTO v_currency FROM public.orders o WHERE o.id = v_order;
  IF v_currency IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'W-11: an echo without currency erased the stored currency: %', coalesce(v_currency, '<null>');
  END IF;

  -- A refresh must not duplicate the already-imported lines.
  SELECT count(*) INTO item_count FROM public.order_items oi WHERE oi.order_id = v_order;
  IF item_count <> 2 THEN
    RAISE EXCEPTION 'W-11: a refresh duplicated line items: %', item_count;
  END IF;

  -- Malformed external ids are ignored, not fatal: the import still succeeds and
  -- the money facts survive.
  v_order := public.upsert_woocommerce_order(
    c, 94002, '94002', 'processing', timestamptz '2026-11-24 10:00:00+00',
    100, 100, 0, 0, 'cod', 'new_order', 'paid',
    'Malformed Buyer', 'malformed@example.invalid', NULL, NULL, NULL, NULL, NULL, NULL,
    timestamptz '2026-11-24 09:00:00+00',
    jsonb_build_array(
      jsonb_build_object('name', 'Odd line', 'quantity', 1, 'price', 100, 'total', '100', 'sku', '  ', 'product_id', 'not-a-number', 'variation_id', 'x', 'total_tax', 'free')
    ),
    jsonb_build_object('status', 'processing', 'currency', 'BDT')
  );
  SELECT oi.sku, oi.woocommerce_product_id, oi.woocommerce_variation_id, oi.tax_amount, oi.line_total
    INTO v_sku, v_product, v_variation, v_tax, v_total
    FROM public.order_items oi WHERE oi.order_id = v_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'W-11: the malformed-facts line item was not imported';
  END IF;
  IF v_sku IS NOT NULL OR v_product IS NOT NULL OR v_variation IS NOT NULL OR v_tax IS NOT NULL THEN
    RAISE EXCEPTION 'W-11: unparsable external facts were stored instead of ignored';
  END IF;
  IF v_total <> 100 THEN
    RAISE EXCEPTION 'W-11: malformed external facts aborted the money facts: %', v_total;
  END IF;
END $$;

ROLLBACK;
