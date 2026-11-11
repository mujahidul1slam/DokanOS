-- Rollback-only real PostgreSQL regression test. Run the new migration inside
-- the same outer transaction before executing this file's test block.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.accept_woocommerce_webhook_delivery(uuid,bigint,text,text,text,text,text,text,bytea,jsonb,bigint)') IS NULL THEN
    RAISE EXCEPTION 'missing accepted intake RPC';
  END IF;
END $$;

DO $$
DECLARE
 c uuid := '8c000000-0000-0000-0000-00000000d001';
 r jsonb; d1 uuid; d2 uuid; w1 uuid; w2 uuid; n integer;
BEGIN
 INSERT INTO public.stores(id,name,url) VALUES ('8f000000-0000-0000-0000-00000000d001','Durable test store','https://durable.invalid');
 INSERT INTO public.brands(id,business_id,name,slug,woo_store_id) VALUES ('8e000000-0000-0000-0000-00000000d001','11111111-0000-0000-0000-000000000001','Durable test brand','durable-intake-test','8f000000-0000-0000-0000-00000000d001');
 INSERT INTO public.order_sources(id,brand_id,name,type) VALUES ('8d000000-0000-0000-0000-00000000d001','8e000000-0000-0000-0000-00000000d001','Durable source','woocommerce');
 INSERT INTO public.woocommerce_connectors(id,business_id,brand_id,store_id,order_source_id,external_store_url,external_store_key,credentials_ref,webhook_secret_ref,status)
 VALUES(c,'11111111-0000-0000-0000-000000000001','8e000000-0000-0000-0000-00000000d001','8f000000-0000-0000-0000-00000000d001','8d000000-0000-0000-0000-00000000d001','https://durable.invalid','https://durable.invalid','LOCAL_TEST_CREDENTIAL','LOCAL_TEST_SECRET','healthy');

 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-test-1',repeat('a',64),'order.updated','order','https://durable.invalid','1',decode('01','hex'),jsonb_build_object('id',90001),90001::bigint);
 IF r->>'status'<>'accepted' THEN RAISE EXCEPTION 'expected accepted'; END IF;
 d1:=(r->>'delivery_id')::uuid; w1:=(r->>'work_id')::uuid;
 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-test-2',repeat('a',64),'order.updated','order','https://durable.invalid','1',decode('01','hex'),jsonb_build_object('id',90001),90001::bigint);
 IF r->>'status'<>'accepted' THEN RAISE EXCEPTION 'same fingerprint with different ID rejected'; END IF;
 d2:=(r->>'delivery_id')::uuid; w2:=(r->>'work_id')::uuid;
 IF d1=d2 OR w1<>w2 THEN RAISE EXCEPTION 'distinct evidence was not coalesced safely'; END IF;
 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-test-1',repeat('a',64),'order.updated','order','https://durable.invalid','1',decode('09','hex'),jsonb_build_object('id',90002),90002::bigint);
 IF r->>'status'<>'conflict' OR r->>'work_id' IS NOT NULL
    OR (SELECT count(*) FROM public.woocommerce_webhook_deliveries WHERE connector_id=c AND delivery_id='durable-test-1')<>1
    OR (SELECT count(*) FROM public.woocommerce_sync_work WHERE connector_id=c AND external_order_id=90002 AND direction='inbound' AND kind='webhook')<>0 THEN
   RAISE EXCEPTION 'accepted delivery ID reused for another order';
 END IF;
 IF (SELECT count(*) FROM public.woocommerce_webhook_deliveries WHERE connector_id=c AND delivery_id IN ('durable-test-1','durable-test-2'))<>2
    OR (SELECT count(*) FROM public.woocommerce_sync_work WHERE connector_id=c AND external_order_id=90001 AND state='pending')<>1
    OR NOT EXISTS(SELECT FROM public.woocommerce_sync_work WHERE id=w1 AND related_delivery_id=d1 AND identity_key='webhook:'||d1::text)
    OR EXISTS(SELECT FROM public.woocommerce_sync_work WHERE id=w2 AND related_delivery_id=d2) THEN RAISE EXCEPTION 'coalesced work/evidence links incorrect'; END IF;

 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,NULL,'  '||repeat('b',64)||'  ','order.updated','order','https://durable.invalid','1',decode('02','hex'),jsonb_build_object('id',90002),90002::bigint);
 d1:=(r->>'delivery_id')::uuid;
 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'   ','  '||repeat('b',64)||'  ','order.updated','order','https://durable.invalid','1',decode('02','hex'),jsonb_build_object('id',90002),90002::bigint);
 IF r->>'status'<>'duplicate' OR (r->>'delivery_id')::uuid<>d1 THEN RAISE EXCEPTION 'blank ID fallback failed'; END IF;
 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-test-1',repeat('c',64),'order.updated','order','https://durable.invalid','1',decode('03','hex'),jsonb_build_object('id',90002),90002::bigint);
 IF r->>'status'<>'conflict' THEN RAISE EXCEPTION 'changed fingerprint not conflict'; END IF;

 INSERT INTO public.woocommerce_webhook_deliveries(connector_id,delivery_id,delivery_fingerprint,raw_body,verification_result)
 VALUES(c,'durable-legacy-invalid',repeat('d',64),decode('04','hex'),'quarantined');
 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-legacy-invalid',repeat('d',64),'order.updated','order','https://durable.invalid','1',decode('04','hex'),jsonb_build_object('id',90002),90002::bigint);
 IF r->>'status'<>'accepted' OR (SELECT count(*) FROM public.woocommerce_webhook_deliveries WHERE connector_id=c AND delivery_id='durable-legacy-invalid')<>2 THEN RAISE EXCEPTION 'quarantine blocked or changed'; END IF;

 INSERT INTO public.woocommerce_webhook_deliveries(connector_id,delivery_id,delivery_fingerprint,raw_body,parsed_payload,verification_result,signature_present,signature_valid,source_valid,resource_valid)
 VALUES(c,'durable-accepted-orphan',repeat('e',64),decode('05','hex'),jsonb_build_object('id',90004),'accepted',true,true,true,true);
 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-accepted-orphan',repeat('e',64),'order.updated','order','https://durable.invalid','1',decode('05','hex'),jsonb_build_object('id',90004),90004::bigint);
 IF r->>'status'<>'duplicate' OR r->>'work_id' IS NULL OR NOT EXISTS(SELECT FROM public.woocommerce_sync_work WHERE related_delivery_id=(r->>'delivery_id')::uuid AND external_order_id=90004::bigint) THEN RAISE EXCEPTION 'orphan not safely repaired'; END IF;
  UPDATE public.woocommerce_sync_work SET state='succeeded' WHERE id=(r->>'work_id')::uuid;
  r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-accepted-orphan',repeat('e',64),'order.updated','order','https://durable.invalid','1',decode('05','hex'),jsonb_build_object('id',90004),90004::bigint);
  IF r->>'status'<>'duplicate' THEN RAISE EXCEPTION 'succeeded work not acknowledged'; END IF;

 CREATE FUNCTION pg_temp.fail_woo_intake_work() RETURNS trigger LANGUAGE plpgsql AS $trigger$ BEGIN IF NEW.identity_key LIKE 'webhook:%' THEN RAISE EXCEPTION 'simulated work insert failure'; END IF; RETURN NEW; END $trigger$;
 CREATE TRIGGER fail_woo_intake_work BEFORE INSERT ON public.woocommerce_sync_work FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_woo_intake_work();
 BEGIN
  PERFORM public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-rollback',repeat('f',64),'order.updated','order','https://durable.invalid','1',decode('06','hex'),jsonb_build_object('id',90003),90003::bigint);
  RAISE EXCEPTION 'work trigger did not fail';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='work trigger did not fail' THEN RAISE; END IF; END;
 DROP TRIGGER fail_woo_intake_work ON public.woocommerce_sync_work;
 IF EXISTS(SELECT FROM public.woocommerce_webhook_deliveries WHERE connector_id=c AND delivery_id='durable-rollback') THEN RAISE EXCEPTION 'delivery remained after work failure'; END IF;

 -- Distinct evidence coalesces into one pending order-level work row.
 SELECT count(*) INTO n FROM public.woocommerce_webhook_deliveries WHERE connector_id=c AND delivery_id IN ('durable-test-1','durable-test-2') AND parsed_payload->>'id'='90001';
 IF n<>2 OR (SELECT count(*) FROM public.woocommerce_sync_work WHERE connector_id=c AND external_order_id=90001 AND direction='inbound' AND kind='webhook' AND state='pending')<>1 THEN RAISE EXCEPTION 'coalesced delivery evidence/work mismatch'; END IF;
 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-test-3',repeat('a',64),'order.updated','order','https://durable.invalid','1',decode('07','hex'),jsonb_build_object('id',90001),90001::bigint);
 IF r->>'status'<>'accepted' OR (r->>'work_id')::uuid<>w1 OR (SELECT count(*) FROM public.woocommerce_sync_work WHERE connector_id=c AND external_order_id=90001 AND state='pending')<>1 THEN RAISE EXCEPTION 'third delivery created extra pending work'; END IF;
 UPDATE public.woocommerce_sync_work SET state='succeeded' WHERE id=w1;
 r:=public.accept_woocommerce_webhook_delivery(c,19::bigint,'durable-test-2',repeat('a',64),'order.updated','order','https://durable.invalid','1',decode('01','hex'),jsonb_build_object('id',90001),90001::bigint);
 IF r->>'status'<>'duplicate' OR (r->>'work_id')::uuid<>w1 OR EXISTS(SELECT FROM public.woocommerce_sync_work WHERE connector_id=c AND external_order_id=90001 AND state='pending') THEN RAISE EXCEPTION 'succeeded coalesced work was duplicated'; END IF;
 IF NOT has_function_privilege('service_role','public.accept_woocommerce_webhook_delivery(uuid,bigint,text,text,text,text,text,text,bytea,jsonb,bigint)','EXECUTE') THEN RAISE EXCEPTION 'service_role execute missing'; END IF;
 IF has_function_privilege('public','public.accept_woocommerce_webhook_delivery(uuid,bigint,text,text,text,text,text,text,bytea,jsonb,bigint)','EXECUTE') OR has_function_privilege('anon','public.accept_woocommerce_webhook_delivery(uuid,bigint,text,text,text,text,text,text,bytea,jsonb,bigint)','EXECUTE') OR has_function_privilege('authenticated','public.accept_woocommerce_webhook_delivery(uuid,bigint,text,text,text,text,text,text,bytea,jsonb,bigint)','EXECUTE') THEN RAISE EXCEPTION 'non-service role execute granted'; END IF;
END $$;
ROLLBACK;
