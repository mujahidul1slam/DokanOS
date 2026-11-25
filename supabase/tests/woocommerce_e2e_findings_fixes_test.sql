-- Rollback-only regression tests for the 2026-11-23 E2E findings fixes.
BEGIN;

DO $$
DECLARE
  c uuid := '8c000000-0000-0000-0000-00000000e901';
  store uuid := '8f000000-0000-0000-0000-00000000e901';
  brand uuid := '8e000000-0000-0000-0000-00000000e901';
  source uuid := '8d000000-0000-0000-0000-00000000e901';
  customer uuid := '8b000000-0000-0000-0000-00000000e901';
  o uuid := '8a000000-0000-0000-0000-00000000e901';
  old_delivery uuid; new_delivery uuid; work_id uuid; duplicate_id uuid; stale_delivery uuid;
  guard_order uuid; shipment_order uuid; created_order uuid;
  result jsonb; row_data record; writes_before integer; old_identity text; echo_before integer;
BEGIN
  INSERT INTO public.stores(id, name, url) VALUES (store, 'E2E fixes store', 'https://e2e-fixes.invalid');
  INSERT INTO public.brands(id, business_id, name, slug, woo_store_id) VALUES (brand, '11111111-0000-0000-0000-000000000001', 'E2E fixes brand', 'e2e-fixes', store);
  INSERT INTO public.order_sources(id, brand_id, name, type) VALUES (source, brand, 'E2E fixes source', 'woocommerce');
  INSERT INTO public.customers(id, business_id, store_id, name, email) VALUES (customer, '11111111-0000-0000-0000-000000000001', store, 'E2E Fixture', 'e2e-fixes@example.invalid');
  INSERT INTO public.woocommerce_connectors(id, business_id, brand_id, store_id, order_source_id, external_store_url, external_store_key, credentials_ref, webhook_secret_ref, status, outbound_enabled, intake_enabled)
    VALUES (c, '11111111-0000-0000-0000-000000000001', brand, store, source, 'https://e2e-fixes.invalid', 'e2e-fixes', 'LOCAL', 'LOCAL', 'healthy', false, true);
  INSERT INTO public.orders(id, business_id, store_id, customer_id, order_source_id, order_number, source, status, payment_method, payment_status, total)
    VALUES (o, '11111111-0000-0000-0000-000000000001', store, customer, source, 'E2E-FIXES-1', 'woocommerce', 'new_order', 'cod', 'paid', 1275);
  INSERT INTO public.woocommerce_order_identities(connector_id, external_order_id, order_id, external_order_number, last_external_status)
    VALUES (c, 93001, o, '93001', 'processing');

  -- D1 + D2: a COD echo cannot erase collection; a pre-dispatch Woo terminal state cancels locally.
  PERFORM public.upsert_woocommerce_order(c, 93001, '93001', 'cancelled', now(), 1275, 1195, 0, 80, 'cod', 'pending', 'unpaid', 'E2E Fixture', 'e2e-fixes@example.invalid', NULL, NULL, NULL, NULL, NULL, 'test', now(), '[]'::jsonb, '{}'::jsonb);
  IF (SELECT payment_status FROM public.orders WHERE id=o) <> 'paid' THEN RAISE EXCEPTION 'D1: paid COD was reset by inbound echo'; END IF;
  IF (SELECT status FROM public.orders WHERE id=o) <> 'cancelled' THEN RAISE EXCEPTION 'D2: pre-dispatch external terminal did not cancel local order'; END IF;

  -- D3: a delivered local order with no consignment must not enqueue a Woo cancellation.
  UPDATE public.woocommerce_connectors SET outbound_enabled=true WHERE id=c;
  -- Keep the external status open so this step isolates the OLD-status dispatch
  -- fact (not the terminal-echo guard added under D2).
  UPDATE public.orders SET status='delivered', payment_status='paid', woocommerce_external_status='processing' WHERE id=o;
  SELECT count(*) INTO writes_before FROM public.woocommerce_outbound_writes WHERE connector_id=c;
  UPDATE public.orders SET status='cancelled' WHERE id=o;
  IF (SELECT count(*) FROM public.woocommerce_outbound_writes WHERE connector_id=c) <> writes_before THEN
    RAISE EXCEPTION 'D3: delivered->cancelled created an unsafe outbound write';
  END IF;

  -- D2 echo: an inbound terminal state that already reached Woo must not be
  -- echoed back as a cancelled outbound write, but a genuine local cancel with
  -- an open external status still must write.
  UPDATE public.orders SET status='pending', woocommerce_external_status='processing' WHERE id=o;
  SELECT count(*) INTO echo_before FROM public.woocommerce_outbound_writes WHERE connector_id=c;
  PERFORM public.upsert_woocommerce_order(c, 93001, '93001', 'refunded', now(), 1275, 1195, 0, 80, 'cod', 'pending', 'unpaid', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'echo', now(), '[]'::jsonb, '{}'::jsonb);
  IF (SELECT status FROM public.orders WHERE id=o) <> 'cancelled' THEN RAISE EXCEPTION 'D2 echo: external refund did not cancel pre-dispatch order'; END IF;
  IF (SELECT count(*) FROM public.woocommerce_outbound_writes WHERE connector_id=c) <> echo_before THEN
    RAISE EXCEPTION 'D2 echo: inbound refund was echoed back as an outbound cancellation';
  END IF;
  UPDATE public.orders SET status='pending', woocommerce_external_status='processing' WHERE id=o;
  SELECT count(*) INTO echo_before FROM public.woocommerce_outbound_writes WHERE connector_id=c;
  UPDATE public.orders SET status='cancelled' WHERE id=o;
  IF (SELECT count(*) FROM public.woocommerce_outbound_writes WHERE connector_id=c) <= echo_before THEN
    RAISE EXCEPTION 'D2 echo: genuine local cancellation was suppressed';
  END IF;

  -- D4: the latest delivery replaces the pending payload and acknowledges the old evidence.
  result := public.accept_woocommerce_webhook_delivery(c, 1, 'delivery-one', 'fingerprint-one', 'order.updated', 'orders/93002', 'https://e2e-fixes.invalid', 'v3', decode('01','hex'), jsonb_build_object('id',93002,'date_modified','2026-11-24T01:00:00Z'), 93002);
  work_id := (result->>'work_id')::uuid; old_delivery := (result->>'delivery_id')::uuid;
  SELECT identity_key INTO old_identity FROM public.woocommerce_sync_work WHERE id=work_id;
  result := public.accept_woocommerce_webhook_delivery(c, 1, 'delivery-two', 'fingerprint-two', 'order.updated', 'orders/93002', 'https://e2e-fixes.invalid', 'v3', decode('02','hex'), jsonb_build_object('id',93002,'date_modified','2026-11-24T01:05:00Z'), 93002);
  new_delivery := (result->>'delivery_id')::uuid;
  IF (SELECT related_delivery_id FROM public.woocommerce_sync_work WHERE id=work_id) <> new_delivery
     OR (SELECT payload->'payload'->>'date_modified' FROM public.woocommerce_sync_work WHERE id=work_id) <> '2026-11-24T01:05:00Z'
     OR (SELECT identity_key FROM public.woocommerce_sync_work WHERE id=work_id) <> old_identity
     OR (SELECT processed_at FROM public.woocommerce_webhook_deliveries WHERE id=old_delivery) IS NULL THEN
    RAISE EXCEPTION 'D4: newer webhook payload/evidence was not merged or identity changed';
  END IF;
  -- A stale delivery is accepted (its evidence is retained) but must not
  -- overwrite the newer payload or related delivery.
  result := public.accept_woocommerce_webhook_delivery(c, 1, 'delivery-stale', 'fingerprint-stale', 'order.updated', 'orders/93002', 'https://e2e-fixes.invalid', 'v3', decode('03','hex'), jsonb_build_object('id',93002,'date_modified','2026-11-24T00:55:00Z'), 93002);
  stale_delivery := (result->>'delivery_id')::uuid;
  IF (SELECT related_delivery_id FROM public.woocommerce_sync_work WHERE id=work_id) <> new_delivery
     OR (SELECT payload->'payload'->>'date_modified' FROM public.woocommerce_sync_work WHERE id=work_id) <> '2026-11-24T01:05:00Z'
     OR (SELECT processed_at FROM public.woocommerce_webhook_deliveries WHERE id=stale_delivery) IS NULL THEN
    RAISE EXCEPTION 'D4: stale webhook overwrote newer work or was not acknowledged';
  END IF;
  -- Neither delivery carries date_modified: no freshness signal, so the latest
  -- arrival coalesces into one work row (legacy behaviour preserved).
  result := public.accept_woocommerce_webhook_delivery(c, 1, 'no-date-one', 'no-date-fp-one', 'order.updated', 'orders/93007', 'https://e2e-fixes.invalid', 'v3', decode('04','hex'), jsonb_build_object('id',93007), 93007);
  work_id := (result->>'work_id')::uuid; old_delivery := (result->>'delivery_id')::uuid;
  result := public.accept_woocommerce_webhook_delivery(c, 1, 'no-date-two', 'no-date-fp-two', 'order.updated', 'orders/93007', 'https://e2e-fixes.invalid', 'v3', decode('05','hex'), jsonb_build_object('id',93007), 93007);
  IF (result->>'merged') IS DISTINCT FROM 'true'
     OR (SELECT related_delivery_id FROM public.woocommerce_sync_work WHERE id=work_id) <> (result->>'delivery_id')::uuid
     OR (SELECT count(*) FROM public.woocommerce_sync_work WHERE connector_id=c AND external_order_id=93007 AND state='pending') <> 1 THEN
    RAISE EXCEPTION 'D4: no-timestamp deliveries did not coalesce by arrival order';
  END IF;

  -- D5: duplicate success remains replayed for uniqueness but is not an error.
  INSERT INTO public.woocommerce_sync_work(connector_id, direction, kind, external_order_id, identity_key, state)
    VALUES (c, 'inbound', 'webhook', 93003, 'duplicate-test', 'succeeded');
  INSERT INTO public.woocommerce_sync_work(connector_id, direction, kind, external_order_id, identity_key, state, lease_owner)
    VALUES (c, 'inbound', 'webhook', 93003, 'duplicate-test', 'leased', 'e2e-owner') RETURNING id INTO duplicate_id;
  IF NOT public.finish_woocommerce_sync_work(duplicate_id, 'e2e-owner', 'succeeded') THEN RAISE EXCEPTION 'D5: duplicate finish did not complete'; END IF;
  SELECT state, error_class, last_error INTO row_data FROM public.woocommerce_sync_work WHERE id=duplicate_id;
  IF row_data.state <> 'replayed' OR row_data.error_class IS NOT NULL OR row_data.last_error IS NOT NULL THEN RAISE EXCEPTION 'D5: benign duplicate still classified as an error'; END IF;
  -- Repeat success by the finishing owner is idempotent; a different owner is not.
  IF NOT public.finish_woocommerce_sync_work(duplicate_id, 'e2e-owner', 'succeeded') THEN RAISE EXCEPTION 'D5: repeat success by owner was not idempotent'; END IF;
  IF public.finish_woocommerce_sync_work(duplicate_id, 'other-owner', 'succeeded') THEN RAISE EXCEPTION 'D5: wrong owner was granted idempotent success'; END IF;

  -- D2 guard: an order already handed to a courier must not be cancelled by an
  -- inbound terminal status. Test both guard signals separately.
  guard_order := '8a000000-0000-0000-0000-00000000e902';
  INSERT INTO public.orders(id, business_id, store_id, customer_id, order_source_id, order_number, source, status, consignment_id, payment_method, payment_status, total)
    VALUES (guard_order, '11111111-0000-0000-0000-000000000001', store, customer, source, 'E2E-FIXES-2', 'woocommerce', 'pickup_pending', 'CN-GUARD', 'cod', 'unpaid', 100);
  INSERT INTO public.woocommerce_order_identities(connector_id, external_order_id, order_id, external_order_number, last_external_status)
    VALUES (c, 93004, guard_order, '93004', 'processing');
  PERFORM public.upsert_woocommerce_order(c, 93004, '93004', 'refunded', now(), 100, 90, 0, 10, 'cod', 'pending', 'unpaid', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'guard', now(), '[]'::jsonb, '{}'::jsonb);
  IF (SELECT status FROM public.orders WHERE id=guard_order) <> 'pickup_pending' THEN RAISE EXCEPTION 'D2 guard: consigned order was cancelled by inbound terminal'; END IF;

  shipment_order := '8a000000-0000-0000-0000-00000000e903';
  INSERT INTO public.orders(id, business_id, store_id, customer_id, order_source_id, order_number, source, status, payment_method, payment_status, total)
    VALUES (shipment_order, '11111111-0000-0000-0000-000000000001', store, customer, source, 'E2E-FIXES-3', 'woocommerce', 'pending', 'cod', 'unpaid', 100);
  INSERT INTO public.courier_shipments(order_id, provider, consignment_id, canonical_status)
    VALUES (shipment_order, 'pathao', 'CN-SHIPMENT-GUARD', 'in_transit');
  INSERT INTO public.woocommerce_order_identities(connector_id, external_order_id, order_id, external_order_number, last_external_status)
    VALUES (c, 93005, shipment_order, '93005', 'processing');
  PERFORM public.upsert_woocommerce_order(c, 93005, '93005', 'cancelled', now(), 100, 90, 0, 10, 'cod', 'pending', 'unpaid', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'guard', now(), '[]'::jsonb, '{}'::jsonb);
  IF (SELECT status FROM public.orders WHERE id=shipment_order) <> 'pending' THEN RAISE EXCEPTION 'D2 guard: order with active shipment was cancelled by inbound terminal'; END IF;

  -- D2 creation: a first-seen external terminal order must be created cancelled,
  -- not parked in pending/local status.
  PERFORM public.upsert_woocommerce_order(c, 93006, '93006', 'cancelled', now(), 100, 90, 0, 10, 'cod', 'pending', 'unpaid', 'New Terminal', NULL, NULL, NULL, NULL, NULL, NULL, 'created', now(), '[]'::jsonb, '{}'::jsonb);
  SELECT order_id INTO created_order FROM public.woocommerce_order_identities WHERE connector_id=c AND external_order_id=93006;
  IF created_order IS NULL OR (SELECT status FROM public.orders WHERE id=created_order) IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'D2 creation: external terminal order was not created cancelled'; END IF;
END $$;

ROLLBACK;
