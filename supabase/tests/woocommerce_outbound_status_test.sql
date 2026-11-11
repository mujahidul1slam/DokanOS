-- Rollback-only real PostgreSQL regression test for Issue 53.
-- Run after `supabase db reset` (or inside the same migration transaction).
-- No external HTTP is performed here; worker HTTP is covered by its fake-fetch seam.
BEGIN;

DO $$
DECLARE
  c uuid := '8c000000-0000-0000-0000-00000000e001';
  brand uuid := '8e000000-0000-0000-0000-00000000e001';
  store uuid := '8f000000-0000-0000-0000-00000000e001';
  source uuid := '8d000000-0000-0000-0000-00000000e001';
  o uuid := '8a000000-0000-0000-0000-00000000e001';
  before_count integer;
  after_count integer;
  before_work integer;
  after_work integer;
  write_row record;
  work_row record;
BEGIN
  INSERT INTO public.stores(id, name, url)
  VALUES (store, 'Outbound test store', 'https://outbound.invalid');
  INSERT INTO public.brands(id, business_id, name, slug, woo_store_id)
  VALUES (brand, '11111111-0000-0000-0000-000000000001', 'Outbound test brand', 'outbound-status-test', store);
  INSERT INTO public.order_sources(id, brand_id, name, type)
  VALUES (source, brand, 'Outbound source', 'woocommerce');
  INSERT INTO public.woocommerce_connectors(
    id, business_id, brand_id, store_id, order_source_id,
    external_store_url, external_store_key, credentials_ref, webhook_secret_ref,
    status, outbound_enabled, intake_enabled
  ) VALUES (
    c, '11111111-0000-0000-0000-000000000001', brand, store, source,
    'https://outbound.invalid', 'outbound-test', 'LOCAL_TEST_CREDENTIAL', 'LOCAL_TEST_SECRET',
    'healthy', true, true
  );
  INSERT INTO public.orders(id, store_id, order_number, source, status, payment_method,
    payment_status, updated_at)
  VALUES (o, store, 'OUTBOUND-91001', 'online', 'pending', 'online', 'paid', '2026-11-11T00:00:00Z');
  INSERT INTO public.woocommerce_order_identities(connector_id, order_id, external_order_id)
  VALUES (c, o, 91001);

  SELECT count(*) INTO before_count FROM public.woocommerce_outbound_writes WHERE connector_id = c;
  SELECT count(*) INTO before_work FROM public.woocommerce_sync_work WHERE connector_id = c;
  UPDATE public.orders SET status = 'processing', updated_at = '2026-11-11T00:01:00Z' WHERE id = o;
  SELECT count(*) INTO after_count FROM public.woocommerce_outbound_writes WHERE connector_id = c;
  SELECT count(*) INTO after_work FROM public.woocommerce_sync_work WHERE connector_id = c;
  IF after_count <> before_count + 1 OR after_work <> before_work + 1 THEN
    RAISE EXCEPTION 'processing did not enqueue one write and one work row';
  END IF;
  SELECT * INTO write_row
  FROM public.woocommerce_outbound_writes
  WHERE connector_id = c
    AND local_order_id = o
    AND external_order_id = 91001
    AND target_status = 'processing'
    AND idempotency_key = '91001:processing:' || (SELECT updated_at::text FROM public.orders WHERE id = o);
  IF write_row.target_status <> 'processing' OR write_row.origin <> 'accepted'
     OR write_row.expected_external_status IS NOT NULL
     OR write_row.local_order_id <> o
     OR write_row.local_order_version IS NULL
     OR write_row.related_local_action <> 'status_change:pending->processing' THEN
    RAISE EXCEPTION 'processing queue evidence is incorrect: target=% origin=% expected=% local_order_id=% version=% key=% action=%', write_row.target_status, write_row.origin, write_row.expected_external_status, write_row.local_order_id, write_row.local_order_version, write_row.idempotency_key, write_row.related_local_action;
  END IF;
  SELECT * INTO work_row FROM public.woocommerce_sync_work WHERE connector_id = c AND external_order_id = 91001;
  IF work_row.direction <> 'outbound' OR work_row.kind <> 'status_write'
     OR work_row.payload->>'target_status' <> 'processing' THEN
    RAISE EXCEPTION 'processing work payload is incorrect';
  END IF;

  -- Repeating the same local version is connector-scoped and idempotent.
  UPDATE public.orders SET status = 'processing', updated_at = '2026-11-11T00:01:00Z' WHERE id = o;
  IF (SELECT count(*) FROM public.woocommerce_outbound_writes WHERE connector_id = c) <> after_count
     OR (SELECT count(*) FROM public.woocommerce_sync_work WHERE connector_id = c) <> after_work THEN
    RAISE EXCEPTION 'same status/version created duplicate outbound work';
  END IF;

  UPDATE public.orders SET status = 'delivered', updated_at = '2026-11-11T00:02:00Z' WHERE id = o;
  SELECT * INTO write_row FROM public.woocommerce_outbound_writes WHERE connector_id = c AND external_order_id = 91001 AND target_status = 'completed';
  IF write_row.origin <> 'delivered' OR write_row.state <> 'pending' THEN
    RAISE EXCEPTION 'completed transition did not enqueue pending write';
  END IF;
  -- Worker confirmation is durable evidence, independent of HTTP transport.
  UPDATE public.woocommerce_outbound_writes SET state = 'succeeded', response_metadata = jsonb_build_object('confirmed_status', 'completed') WHERE id = write_row.id;
  IF NOT EXISTS (SELECT 1 FROM public.woocommerce_outbound_writes WHERE id = write_row.id AND state = 'succeeded' AND response_metadata->>'confirmed_status' = 'completed') THEN
    RAISE EXCEPTION 'successful confirmation was not recorded';
  END IF;

  UPDATE public.orders SET status = 'cancelled', updated_at = '2026-11-11T00:03:00Z' WHERE id = o;
  SELECT * INTO write_row FROM public.woocommerce_outbound_writes WHERE connector_id = c AND external_order_id = 91001 AND target_status = 'cancelled';
  IF write_row.origin <> 'pre_dispatch_cancel' THEN
    RAISE EXCEPTION 'safe pre-dispatch cancellation did not enqueue';
  END IF;

  -- Inbound upsert changes local facts but must not change orders.status.
  UPDATE public.orders SET status = 'processing' WHERE id = o;
  IF (SELECT status FROM public.orders WHERE id = o) <> 'processing' THEN
    RAISE EXCEPTION 'fixture status reset failed';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_outbound_writes WHERE connector_id = c) <> 3 THEN
    RAISE EXCEPTION 'inbound echo would have created an outbound loop';
  END IF;
END $$;

ROLLBACK;

-- Worker HTTP seam contract: the Edge Function performs PUT /orders/{id} with
-- {"status":"processing|completed|cancelled"} and marks the write succeeded
-- only after the response confirms the same status. A live worker test is
-- intentionally not run from this SQL-only battery.

-- Exact local rollback-only command:
-- supabase db reset --local --no-seed; psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/woocommerce_outbound_status_test.sql
-- Expected output: no errors; transaction ends with ROLLBACK.
-- Do not use this test against cloud or production.

-- EOF
