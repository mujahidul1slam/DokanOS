-- Fixes for the 2026-11-23 WooCommerce E2E findings.
-- D1/D2 preserve local payment facts and apply safe external cancellation.
-- D3-D5 harden outbound cancellation, webhook freshness, and duplicate finish.

CREATE OR REPLACE FUNCTION public.upsert_woocommerce_order(
  p_connector_id uuid, p_external_order_id bigint, p_external_order_number text,
  p_external_status text, p_external_modified_at timestamptz, p_total numeric,
  p_subtotal numeric, p_discount numeric, p_shipping numeric, p_payment_method text,
  p_local_status text, p_payment_status text, p_customer_name text,
  p_customer_email text, p_customer_phone text, p_customer_address text,
  p_customer_city text, p_customer_zone text, p_customer_area text, p_notes text,
  p_created_at timestamptz, p_items jsonb, p_safe_external_facts jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record; identity_row record; order_id uuid; customer_id uuid;
  existing_modified timestamptz; local_consignment text; local_status text;
  desired_order_number text; new_order_number text; item jsonb;
BEGIN
  IF p_external_status NOT IN ('pending','on-hold','processing','completed','cancelled','refunded','failed','trash','deleted') THEN
    RAISE EXCEPTION 'woocommerce_unsupported_status';
  END IF;
  SELECT id, business_id, store_id, order_source_id INTO c
    FROM public.woocommerce_connectors
   WHERE id = p_connector_id AND intake_enabled AND status IN ('healthy','degraded');
  IF c.id IS NULL THEN RAISE EXCEPTION 'WooCommerce connector is not enabled'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_connector_id::text || ':' || p_external_order_id::text, 0));
  SELECT * INTO identity_row FROM public.woocommerce_order_identities
   WHERE connector_id = p_connector_id AND external_order_id = p_external_order_id;

  IF identity_row.id IS NOT NULL THEN
    order_id := identity_row.order_id;
    existing_modified := identity_row.last_external_modified_at;
    IF p_external_modified_at IS NOT NULL AND existing_modified IS NOT NULL AND p_external_modified_at < existing_modified THEN
      INSERT INTO public.woocommerce_sync_conflicts
        (connector_id, external_order_id, order_id, reason, external_state, local_state)
      VALUES (p_connector_id, p_external_order_id, order_id, 'stale_external_state',
        jsonb_build_object('status', p_external_status, 'modified_at', p_external_modified_at),
        jsonb_build_object('last_external_modified_at', existing_modified))
      ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO UPDATE
        SET external_state = EXCLUDED.external_state;
      RETURN order_id;
    END IF;
    SELECT public.format_order_number(c.store_id, 'woo', format('WC-%s-%s', p_connector_id::text, coalesce(nullif(p_external_order_number, ''), p_external_order_id::text)))
      INTO desired_order_number;
    UPDATE public.orders AS target
       SET order_number = CASE WHEN target.order_number IS DISTINCT FROM desired_order_number
           AND NOT EXISTS (SELECT 1 FROM public.orders other WHERE other.order_number = desired_order_number AND other.id <> order_id)
           THEN desired_order_number ELSE target.order_number END,
           -- An inbound COD echo must never erase a collection recorded locally.
           payment_status = CASE
             WHEN target.payment_status IN ('paid','partial','refunded') AND coalesce(nullif(p_payment_status, ''), '') = 'unpaid'
               THEN target.payment_status
             ELSE coalesce(nullif(p_payment_status, ''), target.payment_status)
           END,
           -- External terminal state cancels only orders that have not entered fulfilment.
           status = CASE
             WHEN p_external_status IN ('cancelled','refunded','failed','trash','deleted')
               AND target.status IN ('pending','payment_pending','new_order','pre_order_pending')
                AND target.consignment_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.courier_shipments s
                                  WHERE s.order_id = target.id
                                    AND lower(coalesce(s.canonical_status,'')) NOT IN ('delivered','returned','cancelled')) THEN 'cancelled'
             ELSE target.status
           END,
           customer_name = coalesce(nullif(p_customer_name,''), target.customer_name),
           customer_email = coalesce(nullif(p_customer_email,''), target.customer_email),
           customer_phone = coalesce(nullif(p_customer_phone,''), target.customer_phone),
           customer_address = coalesce(nullif(p_customer_address,''), target.customer_address),
           customer_city = coalesce(nullif(p_customer_city,''), target.customer_city),
           woocommerce_external_status = p_external_status,
           woocommerce_external_status_at = coalesce(p_external_modified_at, target.woocommerce_external_status_at),
           woocommerce_external_deleted_at = CASE WHEN p_external_status IN ('trash','deleted') THEN now() ELSE target.woocommerce_external_deleted_at END
     WHERE target.id = order_id;
  ELSE
    SELECT id INTO customer_id FROM public.customers
     WHERE business_id = c.business_id
       AND ((p_customer_email IS NOT NULL AND lower(email) = lower(p_customer_email)) OR (p_customer_phone IS NOT NULL AND phone = p_customer_phone))
     ORDER BY updated_at DESC LIMIT 1;
    IF customer_id IS NULL THEN
      INSERT INTO public.customers (business_id, store_id, source, origin_kind, name, email, phone, address, city, zone, area)
      VALUES (c.business_id, c.store_id, 'woocommerce', 'woo_sync', coalesce(nullif(p_customer_name,''), 'WooCommerce customer'), p_customer_email, p_customer_phone, p_customer_address, p_customer_city, p_customer_zone, p_customer_area)
      RETURNING id INTO customer_id;
    END IF;
    new_order_number := public.format_order_number(c.store_id, 'woo', format('WC-%s-%s', p_connector_id::text, coalesce(nullif(p_external_order_number, ''), p_external_order_id::text)));
    INSERT INTO public.orders
      (business_id, store_id, customer_id, order_source_id, source, order_number, status, payment_status, payment_method, customer_name, customer_email, customer_phone, customer_address, customer_city, subtotal, discount, shipping_cost, total, notes, created_at, woocommerce_external_status, woocommerce_external_status_at, woocommerce_external_deleted_at)
    VALUES
      (c.business_id, c.store_id, customer_id, c.order_source_id, 'woocommerce', new_order_number,
       CASE WHEN p_external_status IN ('cancelled','refunded','failed','trash','deleted') THEN 'cancelled' ELSE coalesce(p_local_status,'pending') END,
       coalesce(p_payment_status,'unpaid'), p_payment_method, p_customer_name, p_customer_email, p_customer_phone, p_customer_address, p_customer_city, coalesce(p_subtotal,0), coalesce(p_discount,0), coalesce(p_shipping,0), coalesce(p_total,0), p_notes, coalesce(p_created_at, now()), p_external_status, p_external_modified_at, CASE WHEN p_external_status IN ('trash','deleted') THEN now() ELSE NULL END)
      RETURNING id INTO order_id;
    IF jsonb_typeof(coalesce(p_items,'[]'::jsonb)) = 'array' THEN
      FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO public.order_items (order_id, product_name, quantity, unit_price, line_total)
        VALUES (order_id, coalesce(item->>'name','WooCommerce item'), greatest(1, coalesce((item->>'quantity')::integer,1)), coalesce((item->>'price')::numeric,0), coalesce((item->>'total')::numeric,0));
      END LOOP;
    END IF;
    INSERT INTO public.woocommerce_order_identities (connector_id, external_order_id, order_id, external_order_number, last_external_status, last_external_modified_at, last_external_payload)
    VALUES (p_connector_id, p_external_order_id, order_id, p_external_order_number, p_external_status, p_external_modified_at, coalesce(p_safe_external_facts,'{}'::jsonb));
  END IF;

  IF identity_row.id IS NOT NULL THEN
    UPDATE public.woocommerce_order_identities
       SET last_external_status = p_external_status,
           last_external_modified_at = coalesce(p_external_modified_at, last_external_modified_at),
           last_external_payload = coalesce(p_safe_external_facts,'{}'::jsonb), last_seen_at = now()
     WHERE id = identity_row.id;
  END IF;

  SELECT status, consignment_id INTO local_status, local_consignment FROM public.orders WHERE id = order_id;
  IF p_external_status IN ('cancelled','refunded','failed','trash','deleted')
     AND (local_consignment IS NOT NULL OR local_status IN ('shipped','pickup_pending','in_transit','out_for_delivery','delivered','entered','accepted')) THEN
    INSERT INTO public.woocommerce_sync_conflicts (connector_id, external_order_id, order_id, reason, external_state, local_state)
    VALUES (p_connector_id, p_external_order_id, order_id,
      CASE WHEN p_external_status IN ('trash','deleted') THEN 'external_deleted_after_local_work' ELSE 'external_terminal_after_local_work' END,
      jsonb_build_object('status',p_external_status), jsonb_build_object('status',local_status,'consignment_id',local_consignment))
    ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO NOTHING;
  END IF;
  RETURN order_id;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_woocommerce_outbound_on_order_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE identity_row record; connector_row record; target_status text; origin text; normalized_status text;
  has_shipments boolean; any_not_delivered boolean; any_active_shipment boolean; active_consignment boolean; all_units_delivered boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.deleted_at IS NOT NULL OR NEW.woocommerce_external_deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT oi.connector_id, oi.external_order_id INTO identity_row FROM public.woocommerce_order_identities oi WHERE oi.order_id = NEW.id;
  IF identity_row.connector_id IS NULL THEN RETURN NEW; END IF;
  SELECT c.id, c.outbound_enabled, c.status INTO connector_row FROM public.woocommerce_connectors c WHERE c.id = identity_row.connector_id;
  IF connector_row.id IS NULL OR NOT connector_row.outbound_enabled OR connector_row.status NOT IN ('healthy','degraded') THEN RETURN NEW; END IF;
  normalized_status := lower(btrim(coalesce(NEW.status, '')));
  IF normalized_status IN ('processing','entered','accepted') THEN
    IF coalesce(NEW.payment_status, '') <> 'paid' THEN RETURN NEW; END IF;
    target_status := 'processing'; origin := CASE WHEN lower(btrim(coalesce(OLD.status, ''))) = 'entered' OR normalized_status = 'entered' THEN 'entered' ELSE 'accepted' END;
  ELSIF normalized_status = 'delivered' THEN
    IF coalesce(NEW.payment_status, '') <> 'paid' THEN RETURN NEW; END IF;
    target_status := 'completed'; origin := 'delivered';
  ELSIF normalized_status = 'cancelled' THEN
    -- Echo suppression: an inbound terminal status already reached WooCommerce,
    -- so writing a cancellation back would be an echo. Genuine local cancels
    -- still carry an open external status and flow through.
    IF lower(btrim(coalesce(NEW.woocommerce_external_status, ''))) IN ('cancelled','refunded','failed','trash','deleted') THEN RETURN NEW; END IF;
    target_status := 'cancelled'; origin := 'pre_dispatch_cancel';
  ELSE RETURN NEW;
  END IF;
  SELECT count(*) > 0, coalesce(bool_or(coalesce(lower(s.canonical_status), '') <> 'delivered'), false), coalesce(bool_or(coalesce(lower(s.canonical_status), '') NOT IN ('delivered','returned','cancelled')), false)
    INTO has_shipments, any_not_delivered, any_active_shipment FROM public.courier_shipments s WHERE s.order_id = NEW.id;
  -- OLD status is part of the dispatch fact: a delivered/entered order remains post-dispatch even without a consignment row.
  active_consignment := (NEW.consignment_id IS NOT NULL AND btrim(NEW.consignment_id) <> '') OR any_active_shipment
    OR lower(btrim(coalesce(OLD.status, ''))) IN ('accepted','entered','shipped','pickup_pending','in_transit','out_for_delivery','delivered');
  all_units_delivered := CASE WHEN has_shipments THEN NOT any_not_delivered ELSE true END;
  IF normalized_status = 'delivered' AND NOT all_units_delivered THEN RETURN NEW; END IF;
  IF normalized_status = 'cancelled' AND active_consignment THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.enqueue_woocommerce_status_write(identity_row.connector_id, identity_row.external_order_id, target_status, origin, NEW.woocommerce_external_status, NEW.updated_at, NEW.id, left(format('status_change:%s->%s', OLD.status, NEW.status), 200));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.woocommerce_sync_conflicts (connector_id, external_order_id, order_id, reason, external_state, local_state)
    VALUES (identity_row.connector_id, identity_row.external_order_id, NEW.id, 'outbound_enqueue_failed', jsonb_build_object('target_status',target_status,'origin',origin), jsonb_build_object('status',NEW.status,'error',SQLERRM))
    ON CONFLICT (connector_id, external_order_id, reason) WHERE resolution IS NULL DO NOTHING;
  END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.accept_woocommerce_webhook_delivery(
  p_connector_id uuid, p_webhook_id bigint, p_delivery_id text, p_delivery_fingerprint text,
  p_topic text, p_resource text, p_source_url text, p_payload_version text,
  p_raw_body bytea, p_parsed_payload jsonb, p_external_order_id bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_delivery_id uuid; v_work_id uuid; v_existing public.woocommerce_webhook_deliveries%ROWTYPE; v_existing_work public.woocommerce_sync_work%ROWTYPE;
  v_key text := nullif(btrim(p_delivery_id), ''); v_fingerprint text := nullif(btrim(p_delivery_fingerprint), '');
  v_incoming_modified timestamptz; v_existing_modified timestamptz; v_should_merge boolean;
BEGIN
  IF p_connector_id IS NULL OR p_external_order_id IS NULL OR p_external_order_id <= 0 OR nullif(btrim(v_fingerprint), '') IS NULL OR p_raw_body IS NULL THEN RAISE EXCEPTION 'accepted intake requires connector, positive external order ID, nonblank fingerprint and body' USING ERRCODE='22023'; END IF;
  -- Serialize per external order so concurrent deliveries for the same order
  -- cannot both claim / rewrite its pending work. A delivery-id/fingerprint
  -- lock alone serializes only identical deliveries.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('woo-order:' || p_connector_id::text || ':' || p_external_order_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_connector_id::text || ':' || CASE WHEN v_key IS NULL THEN 'fingerprint:' || v_fingerprint ELSE 'id:' || v_key END, 0));
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.woocommerce_webhook_deliveries WHERE connector_id=p_connector_id AND btrim(delivery_id)=v_key AND verification_result='accepted' ORDER BY received_at,id LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_existing FROM public.woocommerce_webhook_deliveries WHERE connector_id=p_connector_id AND btrim(delivery_fingerprint)=v_fingerprint AND (delivery_id IS NULL OR btrim(delivery_id)='') AND verification_result='accepted' ORDER BY received_at,id LIMIT 1 FOR UPDATE;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    -- Keep the prior semantic checks: a delivery id belongs to exactly one
    -- order, and its stored evidence must match the claimed external order.
    IF btrim(v_existing.delivery_fingerprint) IS DISTINCT FROM v_fingerprint
       OR v_existing.parsed_payload IS NULL
       OR NOT (v_existing.parsed_payload ? 'id')
       OR NOT ((v_existing.parsed_payload->>'id') ~ '^[0-9]+$')
       OR (v_existing.parsed_payload->>'id')::bigint <= 0
       OR (v_existing.parsed_payload->>'id')::bigint <> p_external_order_id
       OR (p_parsed_payload IS NOT NULL AND p_parsed_payload ? 'id'
           AND (p_parsed_payload->>'id') ~ '^[0-9]+$'
           AND (p_parsed_payload->>'id')::bigint <> p_external_order_id) THEN
      RETURN jsonb_build_object('status','conflict','delivery_id',v_existing.id,'work_id',NULL);
    END IF;
    SELECT * INTO v_existing_work FROM public.woocommerce_sync_work WHERE related_delivery_id=v_existing.id ORDER BY created_at,id LIMIT 1;
    IF v_existing_work.id IS NOT NULL THEN
      IF v_existing_work.connector_id <> p_connector_id OR v_existing_work.direction <> 'inbound'
         OR v_existing_work.kind <> 'webhook' OR v_existing_work.external_order_id <> p_external_order_id THEN
        RETURN jsonb_build_object('status','conflict','delivery_id',v_existing.id,'work_id',NULL);
      END IF;
      RETURN jsonb_build_object('status','duplicate','delivery_id',v_existing.id,'work_id',v_existing_work.id);
    END IF;
    -- Orphan evidence (accepted delivery whose work was lost): repair it under
    -- the order lock instead of silently dropping the observation.
    SELECT * INTO v_existing_work FROM public.woocommerce_sync_work
      WHERE connector_id=p_connector_id AND direction='inbound' AND kind='webhook'
        AND external_order_id=p_external_order_id
        AND state IN ('pending','leased','retrying','succeeded')
      ORDER BY CASE WHEN state='pending' THEN 0 ELSE 1 END, created_at, id LIMIT 1 FOR UPDATE;
    IF v_existing_work.id IS NOT NULL THEN
      UPDATE public.woocommerce_webhook_deliveries SET processed_at=coalesce(processed_at,now()) WHERE id=v_existing.id;
      RETURN jsonb_build_object('status','duplicate','delivery_id',v_existing.id,'work_id',v_existing_work.id,'repaired',true);
    END IF;
    INSERT INTO public.woocommerce_sync_work (connector_id,direction,kind,external_order_id,identity_key,payload,state,related_delivery_id)
    VALUES (p_connector_id,'inbound','webhook',p_external_order_id,'webhook:'||v_existing.id::text,
      jsonb_build_object('topic',v_existing.topic,'resource',v_existing.resource,'payload_version',v_existing.payload_version,'payload',coalesce(v_existing.parsed_payload,'{}'::jsonb)),'pending',v_existing.id)
    RETURNING id INTO v_work_id;
    RETURN jsonb_build_object('status','duplicate','delivery_id',v_existing.id,'work_id',v_work_id,'repaired',true);
  END IF;
  INSERT INTO public.woocommerce_webhook_deliveries (connector_id,webhook_id,delivery_id,delivery_fingerprint,topic,resource,source_url,payload_version,raw_body,parsed_payload,signature_present,signature_valid,source_valid,resource_valid,verification_result,verified_at)
  VALUES (p_connector_id,p_webhook_id,v_key,v_fingerprint,p_topic,p_resource,p_source_url,p_payload_version,p_raw_body,p_parsed_payload,true,true,true,true,'accepted',now()) RETURNING id INTO v_delivery_id;
  -- Guard the cast: a malformed date_modified must not reject an otherwise
  -- valid delivery (freshness simply falls back to arrival order).
  BEGIN
    IF p_parsed_payload->>'date_modified' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' THEN
      v_incoming_modified := (p_parsed_payload->>'date_modified')::timestamptz;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_incoming_modified := NULL; END;
  SELECT * INTO v_existing_work FROM public.woocommerce_sync_work WHERE connector_id=p_connector_id AND direction='inbound' AND kind='webhook' AND external_order_id=p_external_order_id AND state='pending' ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF v_existing_work.id IS NOT NULL THEN
    BEGIN
      IF v_existing_work.payload->'payload'->>'date_modified' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' THEN
        v_existing_modified := (v_existing_work.payload->'payload'->>'date_modified')::timestamptz;
      END IF;
    EXCEPTION WHEN OTHERS THEN v_existing_modified := NULL; END;
    -- Freshness gate: a late/older delivery never overwrites newer work. When
    -- neither carries a usable timestamp there is no freshness signal, so the
    -- latest arrival stays authoritative (the legacy coalescing behaviour).
    v_should_merge := (v_incoming_modified IS NOT NULL AND (v_existing_modified IS NULL OR v_incoming_modified > v_existing_modified))
                   OR (v_incoming_modified IS NULL AND v_existing_modified IS NULL);
    IF v_should_merge THEN
      -- Keep the stable identity_key: changing it to a delivery UUID breaks
      -- uniqueness and the worker's identity expectations. Only the mutable
      -- payload/evidence pointer is advanced.
      UPDATE public.woocommerce_sync_work SET
        payload=jsonb_build_object('topic',p_topic,'resource',p_resource,'payload_version',p_payload_version,'payload',coalesce(p_parsed_payload,'{}'::jsonb)),
        related_delivery_id=v_delivery_id, updated_at=now() WHERE id=v_existing_work.id;
      IF v_existing_work.related_delivery_id IS NOT NULL THEN UPDATE public.woocommerce_webhook_deliveries SET processed_at=coalesce(processed_at,now()) WHERE id=v_existing_work.related_delivery_id; END IF;
      RETURN jsonb_build_object('status','accepted','delivery_id',v_delivery_id,'work_id',v_existing_work.id,'merged',true);
    END IF;
    -- Older/equal delivery: keep its evidence as accepted, acknowledge it, and
    -- reuse the pending work so no duplicate work row is created.
    UPDATE public.woocommerce_webhook_deliveries SET processed_at=coalesce(processed_at,now()) WHERE id=v_delivery_id;
    RETURN jsonb_build_object('status','accepted','delivery_id',v_delivery_id,'work_id',v_existing_work.id,'merged',false);
  END IF;
  INSERT INTO public.woocommerce_sync_work (connector_id,direction,kind,external_order_id,identity_key,payload,state,related_delivery_id)
  VALUES (p_connector_id,'inbound','webhook',p_external_order_id,'webhook:'||v_delivery_id::text,jsonb_build_object('topic',p_topic,'resource',p_resource,'payload_version',p_payload_version,'payload',coalesce(p_parsed_payload,'{}'::jsonb)),'pending',v_delivery_id) RETURNING id INTO v_work_id;
  RETURN jsonb_build_object('status','accepted','delivery_id',v_delivery_id,'work_id',v_work_id);
END $$;

CREATE OR REPLACE FUNCTION public.finish_woocommerce_sync_work(p_work_id uuid, p_owner text, p_state text, p_error_class text DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated_count integer; existing_succeeded public.woocommerce_sync_work;
BEGIN
  IF p_state NOT IN ('succeeded','retrying','quarantined','dead_letter','cancelled') THEN RAISE EXCEPTION 'invalid WooCommerce work completion state'; END IF;
  IF p_state='succeeded' THEN
    IF EXISTS (SELECT 1 FROM public.woocommerce_sync_work duplicate WHERE duplicate.id=p_work_id AND duplicate.state='replayed' AND duplicate.payload ? 'duplicate_finish' AND duplicate.payload->'duplicate_finish'->>'finished_by' = p_owner) THEN RETURN true; END IF;
    SELECT prior.* INTO existing_succeeded FROM public.woocommerce_sync_work current_work JOIN public.woocommerce_sync_work prior ON prior.connector_id=current_work.connector_id AND prior.identity_key=current_work.identity_key AND prior.state='succeeded' AND prior.id<>current_work.id WHERE current_work.id=p_work_id AND current_work.state='leased' AND current_work.lease_owner=p_owner ORDER BY prior.updated_at,prior.id LIMIT 1;
    IF existing_succeeded.id IS NOT NULL THEN
      UPDATE public.woocommerce_sync_work SET state='replayed', lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=NULL,
        error_class=NULL, last_error=NULL, payload=payload || jsonb_build_object('duplicate_finish',jsonb_build_object('reason','duplicate_succeeded','replayed_to',existing_succeeded.id,'finished_by',p_owner)), updated_at=now()
       WHERE id=p_work_id AND state='leased' AND lease_owner=p_owner;
      GET DIAGNOSTICS updated_count=ROW_COUNT; RETURN updated_count=1;
    END IF;
  END IF;
  UPDATE public.woocommerce_sync_work SET state=CASE WHEN p_state='retrying' AND attempt_count>=max_attempts THEN 'dead_letter' ELSE p_state END,
    lease_owner=NULL, lease_expires_at=NULL, heartbeat_at=NULL, error_class=p_error_class, last_error=p_error,
    next_attempt_at=CASE WHEN p_state='retrying' AND attempt_count<max_attempts THEN now()+make_interval(secs => (least(900::numeric,greatest(1::numeric,power(2::numeric,least(attempt_count,8))*(0.75+random()*0.5))))::double precision) ELSE next_attempt_at END, updated_at=now()
   WHERE id=p_work_id AND state='leased' AND lease_owner=p_owner;
  GET DIAGNOSTICS updated_count=ROW_COUNT; RETURN updated_count=1;
END $$;

COMMENT ON FUNCTION public.finish_woocommerce_sync_work(uuid, text, text, text, text) IS 'Finishes WooCommerce work; duplicate success is a benign replay without error classification.';
