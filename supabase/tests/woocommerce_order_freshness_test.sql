-- Rollback-only regression test for the WooCommerce order freshness watermark.
--
-- Calls the REAL `public.upsert_woocommerce_order(...)` twice against one
-- connector identity: first with a trusted external modified timestamp, then
-- with `NULL` (Woo returned no `date_modified_gmt`). A NULL observation must
-- not advance — and must not clear — the stored watermark.
--
-- Run the WooCommerce connector migration first (or `supabase db reset`).
BEGIN;
DO $$
DECLARE
  c uuid := '8c000000-0000-0000-0000-00000000c001';
  brand uuid := '8e000000-0000-0000-0000-00000000c001';
  store uuid := '8f000000-0000-0000-0000-00000000c001';
  source uuid := '8d000000-0000-0000-0000-00000000c001';
  trusted timestamptz := timestamptz '2026-01-01 00:00:00+00';
  preserved timestamptz;
  order_id uuid;
BEGIN
  INSERT INTO public.stores(id, name, url) VALUES (store, 'Freshness test store', 'https://freshness.invalid');
  INSERT INTO public.brands(id, business_id, name, slug, woo_store_id)
  VALUES (brand, '11111111-0000-0000-0000-000000000001', 'Freshness brand', 'woocommerce-freshness-test', store);
  INSERT INTO public.order_sources(id, brand_id, name, type) VALUES (source, brand, 'Freshness source', 'woocommerce');
  INSERT INTO public.woocommerce_connectors(
    id, business_id, brand_id, store_id, order_source_id, external_store_url,
    external_store_key, credentials_ref, webhook_secret_ref, status, outbound_enabled, intake_enabled)
  VALUES (c, '11111111-0000-0000-0000-000000000001', brand, store, source,
    'https://freshness.invalid', 'freshness', 'LOCAL_TEST_CREDENTIAL', 'LOCAL_TEST_SECRET', 'healthy', true, true);

  -- 1. Trusted observation establishes the watermark.
  order_id := public.upsert_woocommerce_order(
    c, 93001, '93001', 'processing', trusted, 100, 100, 0, 0, 'online',
    'pending', 'paid', 'Freshness Buyer', 'buyer@freshness.invalid', NULL, '1 Test St', 'Dhaka', NULL, NULL,
    NULL, timestamptz '2025-12-31 00:00:00+00', '[]'::jsonb, jsonb_build_object('status', 'processing'));
  SELECT last_external_modified_at INTO preserved
  FROM public.woocommerce_order_identities
  WHERE connector_id = c AND external_order_id = 93001;
  IF preserved IS DISTINCT FROM trusted THEN
    RAISE EXCEPTION 'trusted observation did not establish the watermark: %', preserved;
  END IF;

  -- 2. A NULL external timestamp must not advance the watermark.
  order_id := public.upsert_woocommerce_order(
    c, 93001, '93001', 'completed', NULL, 100, 100, 0, 0, 'online',
    'pending', 'paid', 'Freshness Buyer', 'buyer@freshness.invalid', NULL, '1 Test St', 'Dhaka', NULL, NULL,
    NULL, timestamptz '2025-12-31 00:00:00+00', '[]'::jsonb, jsonb_build_object('status', 'completed'));
  IF (SELECT last_external_modified_at FROM public.woocommerce_order_identities
      WHERE connector_id = c AND external_order_id = 93001) IS DISTINCT FROM trusted THEN
    RAISE EXCEPTION 'NULL external modified timestamp changed the identity watermark';
  END IF;
  IF (SELECT woocommerce_external_status_at FROM public.orders WHERE id = order_id) IS DISTINCT FROM trusted THEN
    RAISE EXCEPTION 'NULL external modified timestamp changed the order freshness column';
  END IF;
  IF (SELECT woocommerce_external_status FROM public.orders WHERE id = order_id) <> 'completed' THEN
    RAISE EXCEPTION 'NULL timestamp blocked the observed external status';
  END IF;

  -- 3. An older external timestamp is a stale conflict, not a watermark move.
  order_id := public.upsert_woocommerce_order(
    c, 93001, '93001', 'cancelled', timestamptz '2025-06-01 00:00:00+00', 100, 100, 0, 0, 'online',
    'pending', 'paid', 'Freshness Buyer', 'buyer@freshness.invalid', NULL, '1 Test St', 'Dhaka', NULL, NULL,
    NULL, timestamptz '2025-12-31 00:00:00+00', '[]'::jsonb, jsonb_build_object('status', 'cancelled'));
  IF (SELECT last_external_modified_at FROM public.woocommerce_order_identities
      WHERE connector_id = c AND external_order_id = 93001) IS DISTINCT FROM trusted THEN
    RAISE EXCEPTION 'stale external state moved the identity watermark';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.woocommerce_sync_conflicts
    WHERE connector_id = c AND external_order_id = 93001 AND reason = 'stale_external_state' AND resolution IS NULL
  ) THEN
    RAISE EXCEPTION 'stale external state was not recorded as a conflict';
  END IF;

  -- 4. A newer external timestamp does advance both watermark columns.
  order_id := public.upsert_woocommerce_order(
    c, 93001, '93001', 'processing', timestamptz '2026-02-01 00:00:00+00', 100, 100, 0, 0, 'online',
    'pending', 'paid', 'Freshness Buyer', 'buyer@freshness.invalid', NULL, '1 Test St', 'Dhaka', NULL, NULL,
    NULL, timestamptz '2025-12-31 00:00:00+00', '[]'::jsonb, jsonb_build_object('status', 'processing'));
  IF (SELECT last_external_modified_at FROM public.woocommerce_order_identities
      WHERE connector_id = c AND external_order_id = 93001) <> timestamptz '2026-02-01 00:00:00+00' THEN
    RAISE EXCEPTION 'newer external timestamp did not advance the identity watermark';
  END IF;
  IF (SELECT woocommerce_external_status_at FROM public.orders WHERE id = order_id) <> timestamptz '2026-02-01 00:00:00+00' THEN
    RAISE EXCEPTION 'newer external timestamp did not advance the order freshness column';
  END IF;
END $$;
ROLLBACK;
