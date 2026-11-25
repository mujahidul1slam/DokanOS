-- Rollback-only regression test. Run after the WooCommerce migrations.
BEGIN;
DO $$
DECLARE
  business uuid := '11111111-0000-0000-0000-000000000001';
  brand uuid := '8a000000-0000-0000-0000-00000000df01';
  store uuid := '89000000-0000-0000-0000-00000000df01';
  source uuid := '88000000-0000-0000-0000-00000000df01';
  connector uuid := '8c000000-0000-0000-0000-00000000df01';
  succeeded_id uuid;
  duplicate_id uuid;
BEGIN
  INSERT INTO public.stores(id,name,url) VALUES (store,'Duplicate finish test store','https://duplicate-finish.invalid');
  INSERT INTO public.brands(id,business_id,name,slug,woo_store_id) VALUES (brand,business,'Duplicate finish test brand','duplicate-finish-test',store);
  INSERT INTO public.order_sources(id,brand_id,name,type) VALUES (source,brand,'Duplicate finish source','woocommerce');
  INSERT INTO public.woocommerce_connectors(id,business_id,brand_id,store_id,order_source_id,external_store_url,external_store_key,credentials_ref,webhook_secret_ref,status)
  VALUES (connector,business,brand,store,source,'https://duplicate-finish.invalid','https://duplicate-finish.invalid','LOCAL_TEST_CREDENTIAL','LOCAL_TEST_SECRET','healthy');

  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, state)
  VALUES (connector, 'inbound', 'webhook', 99001, 'duplicate-finish-test', 'succeeded')
  RETURNING id INTO succeeded_id;

  INSERT INTO public.woocommerce_sync_work
    (connector_id, direction, kind, external_order_id, identity_key, state, lease_owner, lease_expires_at)
  VALUES (connector, 'inbound', 'webhook', 99001, 'duplicate-finish-test', 'leased', 'duplicate-test-owner', now() + interval '1 minute')
  RETURNING id INTO duplicate_id;

  IF NOT public.finish_woocommerce_sync_work(duplicate_id, 'duplicate-test-owner', 'succeeded') THEN
    RAISE EXCEPTION 'duplicate finish did not succeed';
  END IF;
  IF (SELECT state FROM public.woocommerce_sync_work WHERE id = duplicate_id) <> 'replayed'
     OR (SELECT state FROM public.woocommerce_sync_work WHERE id = succeeded_id) <> 'succeeded'
     OR (SELECT payload->'duplicate_finish'->>'replayed_to' FROM public.woocommerce_sync_work WHERE id = duplicate_id) <> succeeded_id::text THEN
    RAISE EXCEPTION 'duplicate finish was not non-destructive and auditable';
  END IF;
  IF NOT public.finish_woocommerce_sync_work(duplicate_id, 'duplicate-test-owner', 'succeeded') THEN
    RAISE EXCEPTION 'duplicate finish retry was not idempotent';
  END IF;
END $$;
ROLLBACK;
