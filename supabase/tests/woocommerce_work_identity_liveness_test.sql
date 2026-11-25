-- Rollback-only regression test for WooCommerce work identity liveness.
--
-- The old key was UNIQUE (connector_id, identity_key, state), which forbade
-- duplicate STATE BUCKETS rather than duplicate identities. Because every
-- enqueue used ON CONFLICT (connector_id, identity_key, state) DO NOTHING, a
-- new sibling row with the SAME identity_key appeared as soon as the previous
-- row left 'pending'. Any later transition into an already-occupied terminal
-- state then raised
--   23505 duplicate key value violates unique constraint
--   "woocommerce_sync_work_connector_id_identity_key_state_key"
-- which the worker reported as woocommerce_finish_failed.
--
-- This test pins the replacement contract: at most one LIVE row per identity,
-- unbounded terminal history, and the production failure sequence (a second
-- demotion into an already-occupied 'replayed' state) must not raise 23505.
BEGIN;
DO $$
DECLARE
  business uuid := '11111111-0000-0000-0000-000000000001';
  brand uuid := '8a000000-0000-0000-0000-00000000e101';
  store uuid := '89000000-0000-0000-0000-00000000e101';
  source uuid := '88000000-0000-0000-0000-00000000e101';
  connector uuid := '8c000000-0000-0000-0000-00000000e101';
  succeeded_id uuid;
  leased_id uuid;
  second_leased_id uuid;
  replayed_count integer;
BEGIN
  -- 0. Structural preconditions.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.woocommerce_sync_work'::regclass
       AND conname = 'woocommerce_sync_work_connector_id_identity_key_state_key'
  ) THEN
    RAISE EXCEPTION 'state-inclusive uniqueness constraint is still present';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'woocommerce_sync_work'
       AND indexname = 'woocommerce_sync_work_live_identity_key'
  ) THEN
    RAISE EXCEPTION 'partial live-identity index woocommerce_sync_work_live_identity_key is missing';
  END IF;

  INSERT INTO public.stores(id,name,url) VALUES (store,'Liveness test store','https://liveness.invalid');
  INSERT INTO public.brands(id,business_id,name,slug,woo_store_id) VALUES (brand,business,'Liveness test brand','liveness-test',store);
  INSERT INTO public.order_sources(id,brand_id,name,type) VALUES (source,brand,'Liveness source','woocommerce');
  INSERT INTO public.woocommerce_connectors(id,business_id,brand_id,store_id,order_source_id,external_store_url,external_store_key,credentials_ref,webhook_secret_ref,status)
  VALUES (connector,business,brand,store,source,'https://liveness.invalid','https://liveness.invalid','LOCAL_TEST_CREDENTIAL','LOCAL_TEST_SECRET','healthy');

  -- 1. Two LIVE rows for one identity, in DIFFERENT live states, are rejected.
  INSERT INTO public.woocommerce_sync_work
    (connector_id,direction,kind,external_order_id,identity_key,state)
  VALUES (connector,'inbound','webhook',99010,'liveness-live-pair','pending');
  BEGIN
    INSERT INTO public.woocommerce_sync_work
      (connector_id,direction,kind,external_order_id,identity_key,state)
    VALUES (connector,'inbound','webhook',99010,'liveness-live-pair','leased');
    RAISE EXCEPTION 'two live rows for one identity were accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- 2. Two rows in the SAME terminal state are accepted (previously 23505).
  INSERT INTO public.woocommerce_sync_work
    (connector_id,direction,kind,external_order_id,identity_key,state)
  VALUES (connector,'inbound','webhook',99011,'liveness-terminal-pair','replayed');
  INSERT INTO public.woocommerce_sync_work
    (connector_id,direction,kind,external_order_id,identity_key,state)
  VALUES (connector,'inbound','webhook',99011,'liveness-terminal-pair','replayed');

  -- 3. Unbounded terminal history for one identity.
  INSERT INTO public.woocommerce_sync_work
    (connector_id,direction,kind,external_order_id,identity_key,state)
  VALUES (connector,'inbound','webhook',99012,'liveness-history','succeeded'),
         (connector,'inbound','webhook',99012,'liveness-history','replayed'),
         (connector,'inbound','webhook',99012,'liveness-history','dead_letter'),
         (connector,'inbound','webhook',99012,'liveness-history','replayed');
  IF (SELECT count(*) FROM public.woocommerce_sync_work
       WHERE connector_id = connector AND identity_key = 'liveness-history') <> 4 THEN
    RAISE EXCEPTION 'terminal history was not fully retained';
  END IF;

  -- 4. The reconcile-tick case: a terminal row does NOT block a new live row.
  INSERT INTO public.woocommerce_sync_work
    (connector_id,direction,kind,external_order_id,identity_key,state)
  VALUES (connector,'inbound','webhook',99012,'liveness-history','pending');
  IF (SELECT count(*) FROM public.woocommerce_sync_work
       WHERE connector_id = connector AND identity_key = 'liveness-history'
         AND state IN ('pending','leased','retrying')) <> 1 THEN
    RAISE EXCEPTION 'exactly one live row expected after the reconcile tick';
  END IF;

  -- 5. Duplicate-finish semantics are preserved: a leased row finishing to
  --    'succeeded' while a 'succeeded' sibling exists is demoted to 'replayed'.
  INSERT INTO public.woocommerce_sync_work
    (connector_id,direction,kind,external_order_id,identity_key,state)
  VALUES (connector,'inbound','webhook',99013,'liveness-finish','succeeded')
  RETURNING id INTO succeeded_id;

  INSERT INTO public.woocommerce_sync_work
    (connector_id,direction,kind,external_order_id,identity_key,state,lease_owner,lease_expires_at)
  VALUES (connector,'inbound','webhook',99013,'liveness-finish','leased','liveness-owner',now() + interval '1 minute')
  RETURNING id INTO leased_id;

  IF NOT public.finish_woocommerce_sync_work(leased_id,'liveness-owner','succeeded') THEN
    RAISE EXCEPTION 'duplicate finish did not succeed';
  END IF;
  IF (SELECT state FROM public.woocommerce_sync_work WHERE id = leased_id) <> 'replayed' THEN
    RAISE EXCEPTION 'duplicate finish was not demoted to replayed';
  END IF;
  IF (SELECT payload->'duplicate_finish'->>'replayed_to' FROM public.woocommerce_sync_work WHERE id = leased_id)
     <> succeeded_id::text THEN
    RAISE EXCEPTION 'duplicate finish did not record replayed_to';
  END IF;

  -- 6. THE PRODUCTION REGRESSION: a second demotion into an already-occupied
  --    'replayed' state must NOT raise 23505.
  INSERT INTO public.woocommerce_sync_work
    (connector_id,direction,kind,external_order_id,identity_key,state,lease_owner,lease_expires_at)
  VALUES (connector,'inbound','webhook',99013,'liveness-finish','leased','liveness-owner',now() + interval '1 minute')
  RETURNING id INTO second_leased_id;

  IF NOT public.finish_woocommerce_sync_work(second_leased_id,'liveness-owner','succeeded') THEN
    RAISE EXCEPTION 'second duplicate finish did not succeed';
  END IF;

  SELECT count(*) INTO replayed_count
    FROM public.woocommerce_sync_work
   WHERE connector_id = connector AND identity_key = 'liveness-finish' AND state = 'replayed';
  IF replayed_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 replayed rows after the second duplicate finish, found %', replayed_count;
  END IF;
  IF (SELECT state FROM public.woocommerce_sync_work WHERE id = second_leased_id) <> 'replayed' THEN
    RAISE EXCEPTION 'second duplicate finish was not demoted to replayed';
  END IF;

  -- 7. Repeating the finish is harmless: the idempotency guard in
  --    finish_woocommerce_sync_work returns true for an already-'replayed' row
  --    whose duplicate_finish.replayed_to points at a still-'succeeded' row,
  --    without writing anything. Assert it stays true and the row is untouched.
  IF NOT public.finish_woocommerce_sync_work(leased_id,'liveness-owner','succeeded') THEN
    RAISE EXCEPTION 'repeating a duplicate finish was not idempotent';
  END IF;
  IF NOT public.finish_woocommerce_sync_work(leased_id,'liveness-owner','succeeded') THEN
    RAISE EXCEPTION 'repeating a duplicate finish a third time was not idempotent';
  END IF;
  IF (SELECT state FROM public.woocommerce_sync_work WHERE id = leased_id) <> 'replayed' THEN
    RAISE EXCEPTION 'repeated duplicate finish changed the row state';
  END IF;
  IF (SELECT lease_owner FROM public.woocommerce_sync_work WHERE id = leased_id) IS NOT NULL THEN
    RAISE EXCEPTION 'repeated duplicate finish left a lease owner';
  END IF;
  IF (SELECT count(*) FROM public.woocommerce_sync_work
       WHERE connector_id = connector AND identity_key = 'liveness-finish') <> 3 THEN
    RAISE EXCEPTION 'repeated duplicate finish created extra rows';
  END IF;

  -- 8. Both leases are cleared on every demoted row.
  IF EXISTS (
    SELECT 1 FROM public.woocommerce_sync_work
     WHERE connector_id = connector
       AND identity_key = 'liveness-finish'
       AND state = 'replayed'
       AND (lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'a demoted row still holds a lease';
  END IF;
END $$;
ROLLBACK;
