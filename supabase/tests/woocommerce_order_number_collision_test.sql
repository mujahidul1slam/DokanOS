-- Rollback-only regression test for WooCommerce external/local order-number collisions.
-- WooCommerce numbers are only unique within one external store. DokanOS
-- order_number is globally unique, so every new Woo import uses a deterministic
-- connector namespace while the raw number remains in the identity row.
BEGIN;
DO $$
DECLARE
  c uuid := '8c000000-0000-0000-0000-00000000f001';
  c2 uuid := '8c000000-0000-0000-0000-00000000f002';
  brand uuid := '8e000000-0000-0000-0000-00000000f001';
  brand2 uuid := '8e000000-0000-0000-0000-00000000f002';
  store uuid := '8f000000-0000-0000-0000-00000000f001';
  store2 uuid := '8f000000-0000-0000-0000-00000000f002';
  source uuid := '8d000000-0000-0000-0000-00000000f001';
  source2 uuid := '8d000000-0000-0000-0000-00000000f002';
  existing_order uuid := '8a000000-0000-0000-0000-00000000f001';
  imported_order uuid;
  imported_order_2 uuid;
  imported_number text;
  imported_number_2 text;
  order_count integer;
  identity_count integer;
BEGIN
  INSERT INTO public.stores(id, name, url)
  VALUES
    (store, 'Order number collision store', 'https://collision.invalid'),
    (store2, 'Order number collision store 2', 'https://collision-2.invalid');
  INSERT INTO public.brands(id, business_id, name, slug, woo_store_id)
  VALUES
    (brand, '11111111-0000-0000-0000-000000000001', 'Collision brand', 'woocommerce-order-number-collision', store),
    (brand2, '11111111-0000-0000-0000-000000000001', 'Collision brand 2', 'woocommerce-order-number-collision-2', store2);
  INSERT INTO public.order_sources(id, brand_id, name, type)
  VALUES
    (source, brand, 'Collision source', 'woocommerce'),
    (source2, brand2, 'Collision source 2', 'woocommerce');
  INSERT INTO public.woocommerce_connectors(
    id, business_id, brand_id, store_id, order_source_id,
    external_store_url, external_store_key, credentials_ref, webhook_secret_ref,
    status, outbound_enabled, intake_enabled
  ) VALUES
    (c, '11111111-0000-0000-0000-000000000001', brand, store, source,
     'https://collision.invalid', 'collision-test', 'LOCAL_TEST_CREDENTIAL', 'LOCAL_TEST_SECRET',
     'healthy', true, true),
    (c2, '11111111-0000-0000-0000-000000000001', brand2, store2, source2,
     'https://collision-2.invalid', 'collision-test-2', 'LOCAL_TEST_CREDENTIAL_2', 'LOCAL_TEST_SECRET_2',
     'healthy', true, true);

  -- Occupy the raw Woo number with an unrelated local order.
  INSERT INTO public.orders(id, business_id, store_id, order_number, source, status, payment_method, payment_status)
  VALUES (existing_order, '11111111-0000-0000-0000-000000000001', store, '8847', 'manual', 'pending', 'cod', 'unpaid');

  imported_order := public.upsert_woocommerce_order(
    c, 8847, '8847', 'processing', timestamptz '2026-01-01 00:00:00+00',
    100, 100, 0, 0, 'cod', 'pending', 'paid', 'Woo Buyer', 'buyer@collision.invalid', NULL,
    '1 Test St', 'Dhaka', NULL, NULL, NULL, timestamptz '2026-01-01 00:00:00+00',
    '[]'::jsonb, jsonb_build_object('status', 'processing', 'currency', 'BDT'));

  IF imported_order = existing_order THEN
    RAISE EXCEPTION 'Woo import reused an unrelated local order';
  END IF;
  imported_number := (SELECT order_number FROM public.orders WHERE id = imported_order);
  IF imported_number <> 'WC-8c000000-0000-0000-0000-00000000f001-8847' THEN
    RAISE EXCEPTION 'Woo import did not use the full deterministic connector namespace: %', imported_number;
  END IF;
  IF (SELECT external_order_number FROM public.woocommerce_order_identities
      WHERE connector_id = c AND external_order_id = 8847) <> '8847' THEN
    RAISE EXCEPTION 'Woo external order number was not preserved in the identity row';
  END IF;

  -- Repeated delivery/reconciliation for the same connector is idempotent.
  imported_order_2 := public.upsert_woocommerce_order(
    c, 8847, '8847', 'processing', timestamptz '2026-01-01 00:00:00+00',
    100, 100, 0, 0, 'cod', 'pending', 'paid', 'Woo Buyer', 'buyer@collision.invalid', NULL,
    '1 Test St', 'Dhaka', NULL, NULL, NULL, timestamptz '2026-01-01 00:00:00+00',
    '[]'::jsonb, jsonb_build_object('status', 'processing', 'currency', 'BDT'));
  IF imported_order_2 <> imported_order THEN
    RAISE EXCEPTION 'repeated Woo import did not return the existing identity order';
  END IF;

  SELECT count(*) INTO order_count
  FROM public.orders AS o
  WHERE o.source = 'woocommerce' AND o.store_id = store;
  SELECT count(*) INTO identity_count FROM public.woocommerce_order_identities WHERE connector_id = c AND external_order_id = 8847;
  IF order_count <> 1 OR identity_count <> 1 THEN
    RAISE EXCEPTION 'repeated Woo import created duplicate rows: orders=% identities=%', order_count, identity_count;
  END IF;

  -- A different connector may import the same external number independently.
  imported_order_2 := public.upsert_woocommerce_order(
    c2, 8847, '8847', 'processing', timestamptz '2026-01-01 00:00:00+00',
    100, 100, 0, 0, 'cod', 'pending', 'paid', 'Woo Buyer 2', 'buyer2@collision.invalid', NULL,
    '2 Test St', 'Dhaka', NULL, NULL, NULL, timestamptz '2026-01-01 00:00:00+00',
    '[]'::jsonb, jsonb_build_object('status', 'processing', 'currency', 'BDT'));
  imported_number_2 := (SELECT order_number FROM public.orders WHERE id = imported_order_2);
  IF imported_order_2 = imported_order OR imported_number_2 <> 'WC-8c000000-0000-0000-0000-00000000f002-8847' THEN
    RAISE EXCEPTION 'second connector did not receive its own deterministic namespace: id=% number=%', imported_order_2, imported_number_2;
  END IF;

  IF (SELECT order_number FROM public.orders WHERE id = existing_order) <> '8847' THEN
    RAISE EXCEPTION 'unrelated local order number was changed';
  END IF;
END $$;
ROLLBACK;
