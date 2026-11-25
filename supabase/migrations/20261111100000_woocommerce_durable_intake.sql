-- Durable accepted-only WooCommerce webhook intake. Legacy invalid and
-- quarantined deliveries remain untouched and are not part of accepted dedupe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.woocommerce_webhook_deliveries
    WHERE verification_result = 'accepted' AND nullif(btrim(delivery_id), '') IS NOT NULL
    GROUP BY connector_id, btrim(delivery_id) HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM public.woocommerce_webhook_deliveries
    WHERE verification_result = 'accepted' AND (delivery_id IS NULL OR btrim(delivery_id) = '')
    GROUP BY connector_id, btrim(delivery_fingerprint) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot install WooCommerce accepted delivery keys: duplicate accepted evidence requires manual review';
  END IF;
END $$;

ALTER TABLE public.woocommerce_webhook_deliveries
  DROP CONSTRAINT IF EXISTS woocommerce_webhook_deliveries_connector_id_delivery_fingerprint_key,
  DROP CONSTRAINT IF EXISTS woocommerce_webhook_deliveries_connector_id_delivery_fingerp_key,
  DROP CONSTRAINT IF EXISTS woocommerce_webhook_deliverie_connector_id_delivery_fingerp_key;
DROP INDEX IF EXISTS public.woocommerce_delivery_id_key;

CREATE UNIQUE INDEX woocommerce_delivery_accepted_id_key
  ON public.woocommerce_webhook_deliveries (connector_id, (btrim(delivery_id)))
  WHERE verification_result = 'accepted'
    AND delivery_id IS NOT NULL AND btrim(delivery_id) <> '';
CREATE UNIQUE INDEX woocommerce_delivery_accepted_fingerprint_key
  ON public.woocommerce_webhook_deliveries (connector_id, (btrim(delivery_fingerprint)))
  WHERE verification_result = 'accepted'
    AND (delivery_id IS NULL OR btrim(delivery_id) = '');

CREATE OR REPLACE FUNCTION public.accept_woocommerce_webhook_delivery(
  p_connector_id uuid,
  p_webhook_id bigint,
  p_delivery_id text,
  p_delivery_fingerprint text,
  p_topic text,
  p_resource text,
  p_source_url text,
  p_payload_version text,
  p_raw_body bytea,
  p_parsed_payload jsonb,
  p_external_order_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery_id uuid;
  v_work_id uuid;
  v_existing public.woocommerce_webhook_deliveries%ROWTYPE;
  v_existing_work public.woocommerce_sync_work%ROWTYPE;
  v_key text := nullif(btrim(p_delivery_id), '');
  v_fingerprint text := nullif(btrim(p_delivery_fingerprint), '');
BEGIN
  IF p_connector_id IS NULL OR p_external_order_id IS NULL OR p_external_order_id <= 0
     OR nullif(btrim(v_fingerprint), '') IS NULL
     OR p_raw_body IS NULL THEN
    RAISE EXCEPTION 'accepted intake requires connector, positive external order ID, nonblank fingerprint and body'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize by connector and dedupe identity (opaque nonblank ID, otherwise
  -- fingerprint). Hash collisions only serialize unrelated inputs, never merge.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_connector_id::text || ':' || CASE WHEN v_key IS NULL THEN 'fingerprint:' || v_fingerprint ELSE 'id:' || v_key END, 0));

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.woocommerce_webhook_deliveries
      WHERE connector_id=p_connector_id AND btrim(delivery_id)=v_key
        AND verification_result='accepted'
      ORDER BY received_at, id LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_existing FROM public.woocommerce_webhook_deliveries
      WHERE connector_id=p_connector_id AND btrim(delivery_fingerprint)=v_fingerprint
        AND (delivery_id IS NULL OR btrim(delivery_id)='')
        AND verification_result='accepted'
      ORDER BY received_at, id LIMIT 1 FOR UPDATE;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    v_delivery_id := v_existing.id;
    IF btrim(v_existing.delivery_fingerprint) IS DISTINCT FROM v_fingerprint THEN
      RETURN jsonb_build_object('status','conflict','delivery_id',v_delivery_id,'work_id',NULL);
    END IF;
    -- An accepted delivery ID cannot be reused for another external order.
    IF v_existing.parsed_payload IS NULL
       OR NOT (v_existing.parsed_payload ? 'id')
       OR NOT ((v_existing.parsed_payload->>'id') ~ '^[0-9]+$')
       OR (v_existing.parsed_payload->>'id')::bigint <= 0
       OR (v_existing.parsed_payload->>'id')::bigint <> p_external_order_id THEN
      RETURN jsonb_build_object('status','conflict','delivery_id',v_delivery_id,'work_id',NULL);
    END IF;
    -- Evidence must predate all service writes, and only accepted evidence may
    -- authorize repair. Never change its immutable fields or verification state.
    SELECT * INTO v_existing_work FROM public.woocommerce_sync_work
      WHERE related_delivery_id=v_delivery_id
      ORDER BY created_at, id LIMIT 1;
    v_work_id := v_existing_work.id;
    IF v_existing.parsed_payload IS NULL
       OR NOT (v_existing.parsed_payload ? 'id')
       OR NOT ((v_existing.parsed_payload->>'id') ~ '^[0-9]+$')
       OR (v_existing.parsed_payload->>'id')::bigint <= 0
       OR (v_existing.parsed_payload->>'id')::bigint <> p_external_order_id THEN
      RETURN jsonb_build_object('status','conflict','delivery_id',v_delivery_id,'work_id',NULL);
    END IF;
    IF v_work_id IS NOT NULL AND (v_existing_work.connector_id <> p_connector_id
       OR v_existing_work.direction <> 'inbound' OR v_existing_work.kind <> 'webhook'
       OR v_existing_work.external_order_id <> p_external_order_id
       OR v_existing_work.related_delivery_id <> v_delivery_id
       OR v_existing_work.state NOT IN ('pending','leased','retrying','succeeded','dead_letter','quarantined','cancelled','replayed')) THEN
      RETURN jsonb_build_object('status','conflict','delivery_id',v_delivery_id,'work_id',NULL);
    END IF;
    IF v_existing.parsed_payload ? 'id'
       AND (v_existing.parsed_payload->>'id') ~ '^[0-9]+$'
       AND (v_existing.parsed_payload->>'id')::bigint > 0
       AND (v_existing.parsed_payload->>'id')::bigint <> p_external_order_id THEN
      RETURN jsonb_build_object('status','conflict','delivery_id',v_delivery_id,'work_id',NULL);
    END IF;
    IF v_work_id IS NULL THEN
      SELECT * INTO v_existing_work FROM public.woocommerce_sync_work WHERE connector_id=p_connector_id AND direction='inbound' AND kind='webhook' AND external_order_id=p_external_order_id AND state IN ('pending','leased','retrying','succeeded') ORDER BY CASE WHEN state='pending' THEN 0 ELSE 1 END, created_at, id LIMIT 1 FOR UPDATE;
      IF v_existing_work.id IS NOT NULL THEN
        v_work_id := v_existing_work.id;
      ELSE
        INSERT INTO public.woocommerce_sync_work (connector_id,direction,kind,external_order_id,identity_key,payload,state,related_delivery_id)
        VALUES (p_connector_id,'inbound','webhook',p_external_order_id,'webhook:'||v_delivery_id::text,jsonb_build_object('topic',v_existing.topic,'resource',v_existing.resource,'payload_version',v_existing.payload_version,'payload',coalesce(v_existing.parsed_payload,'{}'::jsonb)),'pending',v_delivery_id) RETURNING id INTO v_work_id;
      END IF;
    END IF;
    RETURN jsonb_build_object('status','duplicate','delivery_id',v_delivery_id,'work_id',v_work_id);
  END IF;

  INSERT INTO public.woocommerce_webhook_deliveries
    (connector_id,webhook_id,delivery_id,delivery_fingerprint,topic,resource,source_url,
     payload_version,raw_body,parsed_payload,signature_present,signature_valid,source_valid,
     resource_valid,verification_result,verified_at)
  VALUES (p_connector_id,p_webhook_id,v_key,v_fingerprint,p_topic,p_resource,p_source_url,
     p_payload_version,p_raw_body,p_parsed_payload,true,true,true,true,'accepted',now())
  RETURNING id INTO v_delivery_id;

  SELECT * INTO v_existing_work
    FROM public.woocommerce_sync_work
    WHERE connector_id=p_connector_id
      AND direction='inbound' AND kind='webhook'
      AND external_order_id=p_external_order_id
      AND state='pending'
    ORDER BY created_at, id
    LIMIT 1
    FOR UPDATE;

  IF v_existing_work.id IS NOT NULL THEN
    v_work_id := v_existing_work.id;
  ELSE
    INSERT INTO public.woocommerce_sync_work
      (connector_id,direction,kind,external_order_id,identity_key,payload,state,related_delivery_id)
    VALUES (p_connector_id,'inbound','webhook',p_external_order_id,'webhook:'||v_delivery_id::text,
      jsonb_build_object('topic',p_topic,'resource',p_resource,'payload_version',p_payload_version,'payload',coalesce(p_parsed_payload,'{}'::jsonb)),'pending',v_delivery_id)
    RETURNING id INTO v_work_id;
  END IF;

  RETURN jsonb_build_object('status','accepted','delivery_id',v_delivery_id,'work_id',v_work_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_woocommerce_webhook_delivery(uuid,bigint,text,text,text,text,text,text,bytea,jsonb,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_woocommerce_webhook_delivery(uuid,bigint,text,text,text,text,text,text,bytea,jsonb,bigint)
  TO service_role;
COMMENT ON FUNCTION public.accept_woocommerce_webhook_delivery(uuid,bigint,text,text,text,text,text,text,bytea,jsonb,bigint) IS
  'Atomically persists prevalidated WooCommerce delivery evidence and delivery-specific durable work; service_role only.';

-- Keep the deployed constraint that unrelated writers still depend on.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.woocommerce_sync_work'::regclass AND conname='woocommerce_sync_work_connector_id_identity_key_state_key') THEN
    RAISE EXCEPTION 'expected woocommerce_sync_work state uniqueness constraint is missing';
  END IF;
END $$;
