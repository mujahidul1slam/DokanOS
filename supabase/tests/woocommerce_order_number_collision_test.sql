-- Rollback-only regression test for WooCommerce external/local order-number collisions.
-- WooCommerce numbers are only unique within one external store. DokanOS
-- order_number is globally unique, so every new Woo import uses the configured
-- prefix, Woo number, and one W source suffix. Ambiguous candidates fail closed
-- with woocommerce_order_number_collision; no UUID or numeric disambiguator is added.
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
  legacy_order uuid := '8a000000-0000-0000-0000-00000000f002';
  legacy_customer uuid := '8b000000-0000-0000-0000-00000000f002';
  imported_order uuid;
  imported_order_2 uuid;
  imported_number text;
  imported_number_2 text;
  order_count integer;
  identity_count integer;
BEGIN
  INSERT INTO public.stores(id, name, url, woo_order_prefix, woo_order_suffix)
  VALUES
    (store, 'Order number collision store', 'https://collision.invalid', 'SHOP-', '-W'),
    (store2, 'Order number collision store 2', 'https://collision-2.invalid', 'SHOP2-', '-W');
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
  VALUES
    (existing_order, '11111111-0000-0000-0000-000000000001', store, '8847', 'manual', 'pending', 'cod', 'unpaid'),
    (legacy_order, '11111111-0000-0000-0000-000000000001', store, '8848', 'woocommerce', 'pending', 'cod', 'unpaid');
  INSERT INTO public.customers(id, business_id, store_id, source, origin_kind, name, email, address, city)
  VALUES (legacy_customer, '11111111-0000-0000-0000-000000000001', store, 'woocommerce', 'woo_sync', 'Legacy Buyer', 'legacy@collision.invalid', 'Old St', 'Dhaka');
  UPDATE public.orders
  SET customer_id = legacy_customer
  WHERE id = legacy_order;
  INSERT INTO public.woocommerce_order_identities(
    connector_id, external_order_id, order_id, external_order_number, last_external_status,
    last_external_modified_at, last_external_payload
  ) VALUES (
    c, 8848, legacy_order, '8848', 'processing', timestamptz '2026-01-01 00:00:00+00', '{}'::jsonb
  );

  imported_order := public.upsert_woocommerce_order_v2(
    c, 8847, '8847', 'processing', timestamptz '2026-01-01 00:00:00+00',
    100, 100, 0, 0, 'cod', 'new_order', 'paid', 'Woo Buyer', 'buyer@collision.invalid', NULL,
    '1 Test St', 'Dhaka', NULL, NULL, NULL, timestamptz '2026-01-01 00:00:00+00',
    '[]'::jsonb, jsonb_build_object('status', 'processing', 'currency', 'BDT'), 'delivery', false);

  IF imported_order = existing_order THEN
    RAISE EXCEPTION 'Woo import reused an unrelated local order';
  END IF;
  imported_number := (SELECT order_number FROM public.orders WHERE id = imported_order);
  IF (SELECT status FROM public.orders WHERE id = imported_order) <> 'new_order' THEN
    RAISE EXCEPTION 'processing import did not create New Order: status=%',
      (SELECT status FROM public.orders WHERE id = imported_order);
  END IF;
  IF imported_number <> 'SHOP-8847-W' THEN
    RAISE EXCEPTION 'Woo import did not apply the human-readable prefix, Woo number, and one W suffix: %', imported_number;
  END IF;
  IF (SELECT external_order_number FROM public.woocommerce_order_identities
      WHERE connector_id = c AND external_order_id = 8847) <> '8847' THEN
    RAISE EXCEPTION 'Woo external order number was not preserved in the identity row';
  END IF;
  IF (SELECT customer_name FROM public.orders WHERE id = imported_order) IS DISTINCT FROM 'Woo Buyer'
     OR (SELECT customer_email FROM public.orders WHERE id = imported_order) IS DISTINCT FROM 'buyer@collision.invalid'
     OR (SELECT customer_phone FROM public.orders WHERE id = imported_order) IS NOT NULL
     OR (SELECT customer_address FROM public.orders WHERE id = imported_order) IS DISTINCT FROM '1 Test St'
     OR (SELECT customer_city FROM public.orders WHERE id = imported_order) IS DISTINCT FROM 'Dhaka' THEN
    RAISE EXCEPTION 'Woo order did not preserve the imported customer snapshot on the order row';
  END IF;
  IF (SELECT woo_order_prefix FROM public.stores WHERE id = store) <> 'SHOP-' THEN
    RAISE EXCEPTION 'Woo order prefix fixture was not configured';
  END IF;
  IF imported_number !~ '-W$' OR imported_number ~ '-W-W$' THEN
    RAISE EXCEPTION 'Woo order number must contain exactly one W source suffix: %', imported_number;
  END IF;
  IF imported_number !~ '^SHOP-' THEN
    RAISE EXCEPTION 'Woo order number did not preserve the configured brand prefix: %', imported_number;
  END IF;

  -- The reviewed backfill repairs rows imported before the snapshot/prefix fix.
  PERFORM public.backfill_woocommerce_order_snapshots();
  IF (SELECT order_number FROM public.orders WHERE id = legacy_order) <> 'SHOP-8848-W'
     OR (SELECT customer_name FROM public.orders WHERE id = legacy_order) IS DISTINCT FROM 'Legacy Buyer'
     OR (SELECT customer_email FROM public.orders WHERE id = legacy_order) IS DISTINCT FROM 'legacy@collision.invalid'
     OR (SELECT customer_address FROM public.orders WHERE id = legacy_order) IS DISTINCT FROM 'Old St' THEN
    RAISE EXCEPTION 'backfill did not repair order number and customer snapshot: number=% name=% email=% address=%',
      (SELECT order_number FROM public.orders WHERE id = legacy_order),
      (SELECT customer_name FROM public.orders WHERE id = legacy_order),
      (SELECT customer_email FROM public.orders WHERE id = legacy_order),
      (SELECT customer_address FROM public.orders WHERE id = legacy_order);
  END IF;

  -- A repeat delivery remains idempotent after the backfill.
  PERFORM public.upsert_woocommerce_order_v2(
    c, 8848, '8848', 'processing', timestamptz '2026-01-01 00:00:00+00',
    100, 100, 0, 0, 'cod', 'pending', 'paid', 'Legacy Buyer', 'legacy@collision.invalid', NULL,
    'Old St', 'Dhaka', NULL, NULL, NULL, timestamptz '2026-01-01 00:00:00+00',
    '[]'::jsonb, jsonb_build_object('status', 'processing', 'currency', 'BDT'), 'delivery', false);
  IF (SELECT order_number FROM public.orders WHERE id = legacy_order) <> 'SHOP-8848-W'
     OR (SELECT customer_name FROM public.orders WHERE id = legacy_order) IS DISTINCT FROM 'Legacy Buyer'
     OR (SELECT customer_email FROM public.orders WHERE id = legacy_order) IS DISTINCT FROM 'legacy@collision.invalid'
     OR (SELECT customer_address FROM public.orders WHERE id = legacy_order) IS DISTINCT FROM 'Old St' THEN
    RAISE EXCEPTION 'repeat Woo import did not repair order number and customer snapshot: number=% name=% email=% address=%',
      (SELECT order_number FROM public.orders WHERE id = legacy_order),
      (SELECT customer_name FROM public.orders WHERE id = legacy_order),
      (SELECT customer_email FROM public.orders WHERE id = legacy_order),
      (SELECT customer_address FROM public.orders WHERE id = legacy_order);
  END IF;

  -- Local fulfillment progress wins over a later Woo refresh.
  UPDATE public.orders
  SET status = 'shipped', fulfillment_type = 'delivery'
  WHERE id = imported_order;
  PERFORM public.upsert_woocommerce_order_v2(
    c, 8847, '8847', 'processing', timestamptz '2026-01-01 00:00:00+00',
    100, 100, 0, 0, 'cod', 'new_order', 'paid', 'Woo Buyer', 'buyer@collision.invalid', NULL,
    '1 Test St', 'Dhaka', NULL, NULL, NULL, timestamptz '2026-01-01 00:00:00+00',
    '[]'::jsonb, jsonb_build_object('status', 'processing'), 'walkin', false);
  IF (SELECT status FROM public.orders WHERE id = imported_order) <> 'shipped'
     OR (SELECT fulfillment_type FROM public.orders WHERE id = imported_order) <> 'delivery' THEN
    RAISE EXCEPTION 'Woo refresh regressed local fulfillment state: status=% fulfillment=%',
      (SELECT status FROM public.orders WHERE id = imported_order),
      (SELECT fulfillment_type FROM public.orders WHERE id = imported_order);
  END IF;

  -- An older Woo observation must not overwrite newer local status, fulfillment,
  -- or the repaired human-readable number after the identity RPC rejects it.
  PERFORM public.upsert_woocommerce_order_v2(
    c, 8847, '9999', 'pending', timestamptz '2025-12-31 00:00:00+00',
    100, 100, 0, 0, 'cod', 'pre_order_pending', 'unpaid', 'Stale Buyer', 'stale@collision.invalid', NULL,
    'Stale St', 'Dhaka', NULL, NULL, NULL, timestamptz '2025-12-31 00:00:00+00',
    '[]'::jsonb, jsonb_build_object('status', 'pending'), 'walkin', true);
  IF (SELECT order_number FROM public.orders WHERE id = imported_order) <> 'SHOP-8847-W'
     OR (SELECT status FROM public.orders WHERE id = imported_order) <> 'shipped'
     OR (SELECT fulfillment_type FROM public.orders WHERE id = imported_order) <> 'delivery'
     OR (SELECT last_external_modified_at FROM public.woocommerce_order_identities
         WHERE connector_id = c AND external_order_id = 8847)
        <> timestamptz '2026-01-01 00:00:00+00' THEN
    RAISE EXCEPTION 'stale Woo observation overwrote newer order state: number=% status=% fulfillment=% watermark=%',
      (SELECT order_number FROM public.orders WHERE id = imported_order),
      (SELECT status FROM public.orders WHERE id = imported_order),
      (SELECT fulfillment_type FROM public.orders WHERE id = imported_order),
      (SELECT last_external_modified_at FROM public.woocommerce_order_identities
       WHERE connector_id = c AND external_order_id = 8847);
  END IF;

  -- Repeated delivery/reconciliation for the same connector is idempotent.
  imported_order_2 := public.upsert_woocommerce_order_v2(
    c, 8847, '8847', 'processing', timestamptz '2026-01-01 00:00:00+00',
    100, 100, 0, 0, 'cod', 'new_order', 'paid', 'Woo Buyer', 'buyer@collision.invalid', NULL,
    '1 Test St', 'Dhaka', NULL, NULL, NULL, timestamptz '2026-01-01 00:00:00+00',
    '[]'::jsonb, jsonb_build_object('status', 'processing', 'currency', 'BDT'), 'delivery', false);
  IF imported_order_2 <> imported_order THEN
    RAISE EXCEPTION 'repeated Woo import did not return the existing identity order';
  END IF;

  SELECT count(*) INTO order_count
  FROM public.orders AS o
  WHERE o.source = 'woocommerce' AND o.store_id = store;
  SELECT count(*) INTO identity_count FROM public.woocommerce_order_identities WHERE connector_id = c AND external_order_id = 8847;
  IF order_count <> 2 OR identity_count <> 1 THEN
    RAISE EXCEPTION 'repeated Woo import created duplicate rows: orders=% identities=%', order_count, identity_count;
  END IF;

  -- A different connector with a distinct configured prefix may import the same external number independently.
  imported_order_2 := public.upsert_woocommerce_order_v2(
    c2, 8847, '8847', 'processing', timestamptz '2026-01-01 00:00:00+00',
    100, 100, 0, 0, 'cod', 'pending', 'paid', 'Woo Buyer 2', 'buyer2@collision.invalid', NULL,
    '2 Test St', 'Dhaka', NULL, NULL, NULL, timestamptz '2026-01-01 00:00:00+00',
    '[]'::jsonb, jsonb_build_object('status', 'processing', 'currency', 'BDT'), 'delivery', false);
  imported_number_2 := (SELECT order_number FROM public.orders WHERE id = imported_order_2);
  IF imported_order_2 = imported_order OR imported_number_2 <> 'SHOP2-8847-W' THEN
    RAISE EXCEPTION 'second connector did not receive its configured namespace: id=% number=%', imported_order_2, imported_number_2;
  END IF;

  -- A same-prefix collision is not made unique with a UUID or counter; the
  -- reviewed v2 contract fails closed for operator disposition.
  BEGIN
    PERFORM public.upsert_woocommerce_order_v2(
      c, 8849, '8847', 'processing', timestamptz '2026-01-01 00:00:00+00',
      100, 100, 0, 0, 'cod', 'new_order', 'paid', 'Collision Buyer', 'collision@invalid', NULL,
      '3 Test St', 'Dhaka', NULL, NULL, NULL, timestamptz '2026-01-01 00:00:00+00',
      '[]'::jsonb, '{}'::jsonb, 'delivery', false);
    RAISE EXCEPTION 'same-prefix collision was not rejected';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'woocommerce_order_number_collision' THEN RAISE; END IF;
  END;

  IF (SELECT order_number FROM public.orders WHERE id = existing_order) <> '8847' THEN
    RAISE EXCEPTION 'unrelated local order number was changed';
  END IF;
END $$;
ROLLBACK;
