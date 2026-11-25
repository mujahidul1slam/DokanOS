-- Rollback-only regression test for multi-webhook bindings.
--
-- Proves one connector owns both its legacy order webhook id and extra
-- product webhook bindings, that resolution honours the binding only while it
-- is active, that a webhook id is globally unique with its own secret, and
-- that anon/authenticated have no grant on the table.
BEGIN;
DO $$
DECLARE
  c uuid := '9c000000-0000-0000-0000-00000000f020';
  store uuid := '9f000000-0000-0000-0000-00000000f020';
  brand uuid := '9e000000-0000-0000-0000-00000000f020';
  source uuid := '9d000000-0000-0000-0000-00000000f020';
  store_url text := 'https://multi-webhook.invalid/';
  v_connector uuid;
  v_count integer;
  v_secret_a text;
  v_secret_b text;
BEGIN
  INSERT INTO public.stores(id, name, url) VALUES (store, 'Multi-webhook store', store_url);
  INSERT INTO public.brands(id, business_id, name, slug, woo_store_id)
    VALUES (brand, '11111111-0000-0000-0000-000000000001', 'Multi-webhook brand', 'woo-multi-webhook', store);
  INSERT INTO public.order_sources(id, brand_id, name, type)
    VALUES (source, brand, 'Multi-webhook source', 'woocommerce');
  INSERT INTO public.woocommerce_connectors(id, business_id, brand_id, store_id, order_source_id, external_store_url, credentials_ref, webhook_secret_ref, status, outbound_enabled, intake_enabled, expected_webhook_id)
    VALUES (c, '11111111-0000-0000-0000-000000000001', brand, store, source, store_url, 'LOCAL', 'LOCAL', 'healthy', false, true, 42);

  -- Two bindings on one connector, each with its own signing secret.
  INSERT INTO public.woocommerce_webhook_bindings(connector_id, webhook_id, topic, secret_ref)
    VALUES (c, 77, 'product.updated', 'WOO_TEST_PRODUCT_SECRET');
  INSERT INTO public.woocommerce_webhook_bindings(connector_id, webhook_id, topic, secret_ref)
    VALUES (c, 78, 'product.created', 'WOO_TEST_PRODUCT_CREATED_SECRET');
  SELECT count(*), min(secret_ref), max(secret_ref) INTO v_count, v_secret_a, v_secret_b
    FROM public.woocommerce_webhook_bindings WHERE connector_id = c;
  IF v_count <> 2 OR v_secret_a IS NOT DISTINCT FROM v_secret_b THEN
    RAISE EXCEPTION 'S-15: expected two bindings with distinct secrets, got % / % / %', v_count, v_secret_a, v_secret_b;
  END IF;

  -- Resolution works via the binding id and via the legacy order id.
  SELECT r.connector_id INTO v_connector
    FROM public.resolve_woocommerce_connector(77, store_url) r;
  IF v_connector IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'S-15: binding id did not resolve the connector: %', v_connector;
  END IF;
  SELECT r.connector_id INTO v_connector
    FROM public.resolve_woocommerce_connector(42, store_url) r;
  IF v_connector IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'S-15: expected_webhook_id did not resolve the connector: %', v_connector;
  END IF;

  -- A paused binding must not resolve; the order id still must.
  UPDATE public.woocommerce_webhook_bindings SET status = 'paused' WHERE webhook_id = 77;
  SELECT count(*) INTO v_count FROM public.resolve_woocommerce_connector(77, store_url);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'S-15: paused binding still resolved (% rows)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.resolve_woocommerce_connector(42, store_url);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'S-15: pausing a binding broke the order id path';
  END IF;
  UPDATE public.woocommerce_webhook_bindings SET status = 'active' WHERE webhook_id = 77;

  -- Global uniqueness: a second row with the same webhook id fails closed.
  BEGIN
    INSERT INTO public.woocommerce_webhook_bindings(connector_id, webhook_id, topic, secret_ref)
      VALUES (c, 77, 'product.updated', 'WOO_TEST_OTHER_SECRET');
    RAISE EXCEPTION 'S-15: duplicate webhook id was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Secret references must be valid identifiers, not secret values.
  BEGIN
    INSERT INTO public.woocommerce_webhook_bindings(connector_id, webhook_id, topic, secret_ref)
      VALUES (c, 79, 'product.updated', 'literal-secret-value');
    RAISE EXCEPTION 'S-15: invalid secret reference was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- No anon/authenticated grant: the table is service_role only.
  IF has_table_privilege('anon', 'public.woocommerce_webhook_bindings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.woocommerce_webhook_bindings', 'SELECT')
     OR has_table_privilege('anon', 'public.woocommerce_webhook_bindings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.woocommerce_webhook_bindings', 'INSERT') THEN
    RAISE EXCEPTION 'S-15: anon/authenticated has a grant on woocommerce_webhook_bindings';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.woocommerce_webhook_bindings', 'SELECT') THEN
    RAISE EXCEPTION 'S-15: service_role lacks SELECT on woocommerce_webhook_bindings';
  END IF;
END $$;

ROLLBACK;
